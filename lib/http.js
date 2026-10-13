// HTTP API shared by tests and the Worker. The Node server uses the same
// upload planner and public light shape.
const { planUpload, queriesForRows } = require('./upload');
const { rowsFromCsv } = require('./rows');
const { toPublic, nextCreated, lightsSince } = require('./lights');
const { serializeOrdinances } = require('./ordinances');
const { tokensMatch, bearerToken, newAdminToken, hashToken } = require('./token');
const { normalizeSlug, publicGroup, uploadsAllowed, cleanText } = require('./groups');
const { securityHeaders } = require('./headers');
const { countsAsShare, sharerBasis, hashSharer } = require('./sharers');
const { readLimitedText } = require('./body');
const { planLimitReason, queueLimitReason, groupQueueLimitReason, recentLimitReason } = require('./quota');

const MAX_BYTES = 5_000_000;
const DEFAULT_RESET_PIN = '1337';
const SUPER_PIN = '1337';

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

async function acceptUpload(text, store, now = Date.now(), months = 12) {
  const parsed = rowsFromCsv(text, now, months);
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
  if (plan.pending.length && typeof store.groupPendingCount === 'function') {
    const busy = groupQueueLimitReason(await store.groupPendingCount(), plan.pending.length);
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
        completed: merge.completed || null,
      });
    }
  }
  if (typeof store.setMonth === 'function') {
    for (const fix of plan.monthFixes || []) {
      created = nextCreated(now, created);
      await store.setMonth({ id: fix.id, month: fix.month, completed: fix.completed || null, updated: created });
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

function groupApi(pathname) {
  const match = String(pathname || '').match(/^\/g\/([^/]+)\/api\/([a-z]+(?:\/[a-z]+)?)\/?$/);
  if (!match) return null;
  let slug = match[1];
  try { slug = decodeURIComponent(slug); } catch (error) { return null; }
  return { slug: normalizeSlug(slug), action: match[2] };
}

function publicGroupBody(group) {
  return {
    slug: group.slug,
    title: group.title || '',
    subtitle: group.subtitle || '',
    months: Number(group.months) || 12,
    uploadsOpen: group.uploads_open || '',
    uploadsClose: group.uploads_close || '',
  };
}

function windowDate(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error('use a date for the upload window');
    error.status = 400;
    throw error;
  }
  return new Date(parsed).toISOString();
}

function monthsValue(value) {
  const months = Number(value);
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    const error = new Error('choose a window from 1 to 120 months');
    error.status = 400;
    throw error;
  }
  return months;
}

async function superAllowed(request) {
  const pin = String(request.headers.get('x-admin-pin') || '').trim();
  return tokensMatch(pin, SUPER_PIN);
}

async function adminAllowed(request, group) {
  const provided = bearerToken(request.headers.get('authorization'));
  if (!provided || !group.admin_token_hash) return false;
  return tokensMatch(await hashToken(provided), group.admin_token_hash);
}

async function handleApi(request, deps) {
  const url = new URL(request.url);
  try {
    let path = url.pathname;
    let store = deps.store;
    let group = null;
    const scoped = groupApi(path);
    if (scoped) {
      if (!deps.groups || !scoped.slug) return json({ error: 'not found' }, 404);
      group = await deps.groups.find(scoped.slug);
      if (!publicGroup(group)) return json({ error: 'not found' }, 404);
      if (scoped.action === 'group' && request.method === 'GET') {
        return json(publicGroupBody(group), 200, { 'Cache-Control': 'no-store' });
      }
      store = deps.groups.store(group.id);
      if (scoped.action.startsWith('admin/')) {
        if (request.method !== 'POST') return json({ error: 'not found' }, 404);
        if (!(await adminAllowed(request, group))) return json({ error: 'unauthorized' }, 401);
        if (scoped.action === 'admin/reset') {
          await store.clearLights();
          return json({ ok: true }, 200);
        }
        if (scoped.action === 'admin/delete') {
          await deps.groups.remove(group.slug);
          return json({ ok: true }, 200);
        }
        if (scoped.action === 'admin/rotate') {
          const token = newAdminToken();
          await deps.groups.replaceToken(group.slug, await hashToken(token));
          return json({ adminToken: token, adminPath: '/g/' + group.slug + '/admin#' + token }, 200);
        }
        if (scoped.action === 'admin/settings') {
          let body = {};
          try { body = await request.json(); } catch (error) { body = {}; }
          const saved = await deps.groups.update(group.slug, {
            title: cleanText(body.title, 80),
            subtitle: cleanText(body.subtitle, 160),
            months: monthsValue(body.months),
            uploadsOpen: windowDate(body.uploadsOpen),
            uploadsClose: windowDate(body.uploadsClose),
          });
          return json(publicGroupBody(saved), 200);
        }
        return json({ error: 'not found' }, 404);
      }
      if (!['lights', 'stats', 'upload'].includes(scoped.action)) return json({ error: 'not found' }, 404);
      path = '/api/' + scoped.action;
    }
    if (path === '/api/admin/groups' || path.startsWith('/api/admin/groups/')) {
      if (!deps.groups || !(await superAllowed(request))) return json({ error: 'unauthorized' }, 401);
      if (request.method === 'GET' && path === '/api/admin/groups') {
        const rows = await deps.groups.list();
        return json(rows.map(row => ({
          slug: row.slug,
          title: row.title || '',
          disabled: Number(row.disabled) ? 1 : 0,
          deleted: Number(row.deleted) ? 1 : 0,
          created: row.created,
        })), 200, { 'Cache-Control': 'no-store' });
      }
      const action = path.match(/^\/api\/admin\/groups\/([^/]+)\/(disable|enable|delete)$/);
      if (!action || request.method !== 'POST') return json({ error: 'not found' }, 404);
      let slug = action[1];
      try { slug = decodeURIComponent(slug); } catch (error) { return json({ error: 'not found' }, 404); }
      if (action[2] === 'delete') {
        const removed = await deps.groups.remove(slug);
        if (!removed) return json({ error: 'not found' }, 404);
        return json({ ok: true }, 200);
      }
      const saved = await deps.groups.setDisabled(slug, action[2] === 'disable');
      if (!saved) return json({ error: 'not found' }, 404);
      return json({ slug: saved.slug, disabled: Number(saved.disabled) ? 1 : 0 }, 200);
    }
    if (request.method === 'POST' && path === '/api/groups') {
      if (!deps.groups || scoped) return json({ error: 'not found' }, 404);
      let body = {};
      try { body = await request.json(); } catch (error) { body = {}; }
      const token = newAdminToken();
      const created = await deps.groups.create({
        slug: body.slug,
        title: cleanText(body.title, 80),
        subtitle: cleanText(body.subtitle, 160),
        tokenHash: await hashToken(token),
        now: Date.now(),
      });
      return json({
        slug: created.slug,
        title: created.title || '',
        subtitle: created.subtitle || '',
        adminToken: token,
        sharePath: '/g/' + created.slug,
        mapPath: '/g/' + created.slug + '/map',
        adminPath: '/g/' + created.slug + '/admin#' + token,
      }, 201);
    }
    if (request.method === 'GET' && path === '/api/version') {
      const version = String(deps.buildId || '').trim() || 'dev';
      return json({ version }, 200, { 'Cache-Control': 'no-store' });
    }
    if (request.method === 'GET' && path === '/api/lights') {
      const since = Number(url.searchParams.get('since') || 0) || 0;
      const rows = await store.listLights(since);
      return json(rows.map(toPublic).sort((a, b) => a.created - b.created), 200, { 'Cache-Control': 'no-store' });
    }
    if (request.method === 'GET' && path === '/api/stats') {
      if (typeof store.stats !== 'function') return json({ error: 'not found' }, 404);
      return json(await store.stats(), 200, { 'Cache-Control': 'no-store' });
    }
    if (request.method === 'POST' && path === '/api/upload') {
      if (typeof store.ids !== 'function') return json({ error: 'not found' }, 404);
      if (group && !uploadsAllowed(group, Date.now())) {
        return json({ error: 'uploads are closed for this group' }, 403);
      }
      const text = await readLimitedText(request, MAX_BYTES);
      try {
        const stats = await acceptUpload(text, store, Date.now(), group ? Number(group.months) || 12 : 12);
        if (typeof store.noteSharer === 'function' && countsAsShare(stats)) {
          const hash = await hashSharer(sharerBasis(request.headers.get('x-sharer'), text));
          if (hash) await store.noteSharer(hash);
        }
        if (stats.queued > 0 && deps.kick) {
          const work = Promise.resolve().then(() => deps.kick());
          if (deps.ctx) deps.ctx.waitUntil(work);
          else await work;
        }
        return json(stats, 200);
      } catch (error) {
        const parsed = rowsFromCsv(text, Date.now(), group ? Number(group.months) || 12 : 12);
        error.rows = parsed.ok ? parsed.rows.length : 0;
        throw error;
      }
    }
    if (request.method === 'POST' && path === '/api/reset' && !group) {
      const expectedPin = String(deps.resetPin || DEFAULT_RESET_PIN);
      const { header, bodyPin } = await readResetPin(request);
      const headerOk = header ? await tokensMatch(header, expectedPin) : false;
      const bodyOk = bodyPin ? await tokensMatch(bodyPin, expectedPin) : false;
      if (headerOk || bodyOk) {
        await store.clearLights();
        return json({ ok: true }, 200);
      }
      if ((header || bodyPin) && !deps.resetToken) return json({ error: 'unauthorized' }, 401);
      if (!deps.resetToken) return json({ error: 'reset is not configured' }, 503);
      const allowed = await tokensMatch(bearerToken(request.headers.get('authorization')), deps.resetToken);
      if (!allowed) return json({ error: 'unauthorized' }, 401);
      await store.clearLights();
      return json({ ok: true }, 200);
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) {
      const log = { event: 'api_error', status, message: error.message };
      if (error.rows != null) log.rows = error.rows;
      console.error(JSON.stringify(log));
    }
    return json({ error: status === 500 ? 'Something went wrong, please try again' : error.message }, status);
  }
}

module.exports = { handleApi, acceptUpload, json, lightsSince, MAX_BYTES, DEFAULT_RESET_PIN };
