// HTTP API shared by tests and the Worker. The Node server uses the same
// upload planner and public light shape.
const { planUpload, queriesForRows } = require('./upload');
const { rowsFromCsv } = require('./rows');
const { toPublic, nextCreated, lightsSince } = require('./lights');
const { serializeOrdinances } = require('./ordinances');
const { tokensMatch, bearerToken } = require('./token');

const MAX_BYTES = 5_000_000;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function acceptUpload(text, store, now = Date.now()) {
  const parsed = rowsFromCsv(text, now);
  if (!parsed.ok) {
    const error = new Error(parsed.reason);
    error.status = 400;
    throw error;
  }
  const existingIds = new Set(await store.ids());
  const existing = typeof store.known === 'function' ? await store.known() : undefined;
  const cache = await store.cacheFor(queriesForRows(parsed.rows));
  const plan = planUpload(text, { now, existingIds, existing, cache });
  let created = await store.maxCreated();
  if (typeof store.mergeOrdinances === 'function') {
    for (const merge of plan.merges || []) {
      created = nextCreated(now, created);
      await store.mergeOrdinances({
        id: merge.id,
        ordinance: serializeOrdinances(merge.ordinances),
        updated: created,
      });
    }
  }
  for (const row of plan.immediate) {
    created = nextCreated(now, created);
    const inserted = await store.insertLight({ ...row, created, updated: created });
    if (!inserted) {
      plan.stats.added--;
      plan.stats.geocoded--;
      plan.stats.duplicate++;
    }
  }
  for (const job of plan.pending) {
    created = nextCreated(now, created);
    const inserted = await store.insertJob({ ...job, created });
    if (!inserted) {
      plan.stats.queued--;
      plan.stats.duplicate++;
    }
  }
  return plan.stats;
}

async function handleApi(request, deps) {
  const url = new URL(request.url);
  try {
    if (request.method === 'GET' && url.pathname === '/api/lights') {
      const since = Number(url.searchParams.get('since') || 0) || 0;
      const rows = await deps.store.listLights(since);
      return json(rows.map(toPublic).sort((a, b) => a.created - b.created), 200, { 'Cache-Control': 'no-store' });
    }
    if (request.method === 'POST' && url.pathname === '/api/upload') {
      const declared = Number(request.headers.get('content-length') || 0);
      if (declared > MAX_BYTES) return json({ error: 'file too large' }, 413);
      const text = await request.text();
      if (text.length > MAX_BYTES) return json({ error: 'file too large' }, 413);
      const stats = await acceptUpload(text, deps.store);
      if (stats.queued > 0 && deps.kick) {
        const work = Promise.resolve().then(() => deps.kick());
        if (deps.ctx) deps.ctx.waitUntil(work);
        else await work;
      }
      return json(stats, 200);
    }
    if (request.method === 'POST' && url.pathname === '/api/reset') {
      if (!deps.resetToken) return json({ error: 'reset is not configured' }, 503);
      const allowed = await tokensMatch(bearerToken(request.headers.get('authorization')), deps.resetToken);
      if (!allowed) return json({ error: 'unauthorized' }, 401);
      await deps.store.clearLights();
      return json({ ok: true }, 200);
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(JSON.stringify({ event: 'api_error', status, message: error.message }));
    return json({ error: status === 500 ? 'server error' : error.message }, status);
  }
}

module.exports = { handleApi, acceptUpload, json, lightsSince, MAX_BYTES };
