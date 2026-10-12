// HTTP API shared by tests and the Worker. The Node server uses the same
// upload planner and public light shape.
const { planUpload, queriesForRows } = require('./upload');
const { rowsFromCsv } = require('./rows');
const { toPublic, nextCreated, lightsSince } = require('./lights');
const { serializeOrdinances } = require('./ordinances');
const { tokensMatch, bearerToken } = require('./token');
const { securityHeaders } = require('./headers');
const { countsAsShare, sharerBasis, hashSharer } = require('./sharers');
const { readLimitedText } = require('./body');
const { planLimitReason, queueLimitReason, recentLimitReason } = require('./quota');

const MAX_BYTES = 5_000_000;
const DEFAULT_RESET_PIN = '1337';

async function readResetPin(request) {
  const header = String(request.headers.get('x-reset-pin') || '').trim();
  let bodyPin = '';
  if (typeof request.text === 'function') {
    const raw = String(await request.text() || '').trim();
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.pin != null) bodyPin = String(parsed.pin).trim();
      } catch (error) { /* a non-JSON body is not a pin */ }
    } else if (raw) bodyPin = raw;
  }
  return { header, bodyPin };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...securityHeaders(), ...headers },
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
  if (!plan.ok) {
    const error = new Error(plan.reason);
    error.status = 400;
    throw error;
  }
  const limited = planLimitReason(plan);
  if (limited) {
    const error = new Error(limited);
    error.status = 413;
    throw error;
  }
  const incoming = plan.immediate.length + plan.pending.length;
  if (plan.pending.length && typeof store.pendingCount === 'function') {
    const busy = queueLimitReason(await store.pendingCount(), plan.pending.length);
    if (busy) {
      const error = new Error(busy);
      error.status = 429;
      throw error;
    }
  }
  if (incoming && typeof store.recentCount === 'function') {
    const busy = recentLimitReason(await store.recentCount(), incoming);
    if (busy) {
      const error = new Error(busy);
      error.status = 429;
      throw error;
    }
  }
  let created = await store.maxCreated();
  if (typeof store.mergeOrdinances === 'function') {
    for (const merge of plan.merges || []) {
      created = nextCreated(now, created);
      await store.mergeOrdinances({
        id: merge.id,
        ordinance: serializeOrdinances(merge.ordinances),
        updated: created,
        month: merge.month || null,
      });
    }
  }
  if (typeof store.setMonth === 'function') {
    for (const fix of plan.monthFixes || []) {
      created = nextCreated(now, created);
      await store.setMonth({ id: fix.id, month: fix.month, updated: created });
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
    if (request.method === 'GET' && url.pathname === '/api/version') {
      const version = String(deps.buildId || '').trim() || 'dev';
      return json({ version }, 200, { 'Cache-Control': 'no-store' });
    }
    if (request.method === 'GET' && url.pathname === '/api/lights') {
      const since = Number(url.searchParams.get('since') || 0) || 0;
      const rows = await deps.store.listLights(since);
      return json(rows.map(toPublic).sort((a, b) => a.created - b.created), 200, { 'Cache-Control': 'no-store' });
    }
    if (request.method === 'GET' && url.pathname === '/api/stats') {
      if (typeof deps.store.stats !== 'function') return json({ error: 'not found' }, 404);
      return json(await deps.store.stats(), 200, { 'Cache-Control': 'no-store' });
    }
    if (request.method === 'POST' && url.pathname === '/api/upload') {
      const text = await readLimitedText(request, MAX_BYTES);
      const stats = await acceptUpload(text, deps.store);
      if (typeof deps.store.noteSharer === 'function' && countsAsShare(stats)) {
        const hash = await hashSharer(sharerBasis(request.headers.get('x-sharer'), text));
        if (hash) await deps.store.noteSharer(hash);
      }
      if (stats.queued > 0 && deps.kick) {
        const work = Promise.resolve().then(() => deps.kick());
        if (deps.ctx) deps.ctx.waitUntil(work);
        else await work;
      }
      return json(stats, 200);
    }
    if (request.method === 'POST' && url.pathname === '/api/reset') {
      const expectedPin = String(deps.resetPin || DEFAULT_RESET_PIN);
      const { header, bodyPin } = await readResetPin(request);
      const headerOk = header ? await tokensMatch(header, expectedPin) : false;
      const bodyOk = bodyPin ? await tokensMatch(bodyPin, expectedPin) : false;
      if (headerOk || bodyOk) {
        await deps.store.clearLights();
        return json({ ok: true }, 200);
      }
      if ((header || bodyPin) && !deps.resetToken) return json({ error: 'unauthorized' }, 401);
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

module.exports = { handleApi, acceptUpload, json, lightsSince, MAX_BYTES, DEFAULT_RESET_PIN };
