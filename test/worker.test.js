const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { planUpload } = require('../lib/upload');
const { simulateGeocode, MIN_GAP_MS, retryDelay } = require('../lib/geostep');
const { handleApi } = require('../lib/http');
const { tokensMatch } = require('../lib/token');
const { PUBLIC_KEYS } = require('../lib/lights');
const { parseOrdinances, serializeOrdinances } = require('../lib/ordinances');

const NOW = Date.parse('2026-10-11T00:00:00Z');
const en = fs.readFileSync(path.join(__dirname, 'fixtures', 'synthetic-en.csv'), 'utf8');

function memoryStore(seed = {}) {
  const lights = seed.lights || [];
  const jobs = seed.jobs || [];
  const cache = seed.cache || {};
  return {
    lights, jobs, cache,
    async ids() {
      return [...lights.map(light => light.id), ...jobs.filter(job => job.status !== 'failed').map(job => job.id)];
    },
    async known() {
      return [
        ...lights.map(light => ({ id: light.id, ordinance: light.ordinance })),
        ...jobs.filter(job => job.status !== 'failed').map(job => ({ id: job.id, ordinance: job.ordinance })),
      ];
    },
    async maxCreated() {
      return Math.max(0, ...lights.flatMap(light => [light.created || 0, light.updated || 0]), ...jobs.map(job => job.created || 0));
    },
    async cacheFor(queries) {
      const found = {};
      for (const query of queries) if (Object.prototype.hasOwnProperty.call(cache, query)) found[query] = cache[query];
      return found;
    },
    async listLights(since) {
      return lights.filter(light => Math.max(light.created || 0, light.updated || 0) > since);
    },
    async mergeOrdinances(merge) {
      const light = lights.find(existing => existing.id === merge.id);
      if (light) {
        light.ordinance = serializeOrdinances(merge.ordinance);
        light.updated = merge.updated;
        return true;
      }
      const job = jobs.find(existing => existing.id === merge.id && existing.status !== 'failed');
      if (job) {
        job.ordinance = serializeOrdinances(merge.ordinance);
        return true;
      }
      return false;
    },
    async insertLight(light) {
      if (lights.some(existing => existing.id === light.id)) return false;
      lights.push({ ...light });
      return true;
    },
    async insertJob(job) {
      if (lights.some(existing => existing.id === job.id) || jobs.some(existing => existing.id === job.id)) return false;
      jobs.push({ ...job, status: 'pending' });
      return true;
    },
    async clearLights() { lights.length = 0; jobs.length = 0; },
  };
}
function req(pathname, { method = 'GET', headers = {}, body = '' } = {}) {
  return {
    url: 'http://localhost' + pathname,
    method,
    headers: { get: name => headers[name.toLowerCase()] || null },
    text: async () => body,
  };
}
function storedKeys(row) {
  return Object.keys(row).sort();
}

test('upload plan keeps recent rows, drops names, and queues geocoding', () => {
  const plan = planUpload(en, { now: NOW, existingIds: new Set(), cache: {} });
  assert.equal(plan.ok, true);
  assert.equal(plan.stats.total, 3);
  assert.equal(plan.stats.pastYear, 2);
  assert.equal(plan.pending.length, 2);
  assert.equal(plan.immediate.length, 0);
  for (const job of plan.pending) {
    assert.deepEqual(storedKeys(job), ['cursor', 'id', 'ordinance', 'place']);
    assert.match(job.id, /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/);
    assert.equal(job.name, undefined);
    assert.equal(job.temple, undefined);
  }
  assert.ok(plan.pending.some(job => job.place === 'Cork, Ireland'));
  assert.ok(!plan.pending.some(job => job.id === 'ABCD-125'));
  assert.deepEqual(JSON.parse(plan.pending.find(job => job.id === 'ABCD-123').ordinance), ['Baptism']);
});

test('cached places become lights immediately and duplicates are skipped', () => {
  const cache = {
    'Ogden, Weber, Utah, United States': { lat: 41.22, lon: -111.97 },
    'Cork, Ireland': { lat: 51.9, lon: -8.47 },
  };
  const plan = planUpload(en, { now: NOW, existingIds: new Set(['ABCD-123']), cache });
  assert.equal(plan.stats.duplicate, 1);
  assert.equal(plan.immediate.length, 1);
  assert.equal(plan.immediate[0].id, 'ABCD-124');
  assert.equal(plan.immediate[0].name, undefined);
  assert.deepEqual(storedKeys(plan.immediate[0]), ['id', 'lat', 'lon', 'ordinance', 'place']);
});

test('known misses fall through to the next place candidate', () => {
  const cache = { 'Ogden, Weber, Utah, United States': null };
  const plan = planUpload(en, { now: NOW, existingIds: new Set(['ABCD-124']), cache });
  const ogden = plan.pending.find(job => job.id === 'ABCD-123');
  assert.ok(ogden);
  assert.equal(ogden.cursor, 1);
});

test('forty uncached places stay at or under one Nominatim request per second', () => {
  const jobs = Array.from({ length: 40 }, (_, i) => ({ id: 'ID' + i, place: 'Town' + i, ordinance: 'Baptism' }));
  const { calls, lights } = simulateGeocode(jobs, () => ({ lat: 10, lon: 20 }), 1_000_000);
  assert.equal(calls.length, 40);
  assert.equal(lights.length, 40);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].t - calls[i - 1].t >= MIN_GAP_MS);
  for (const light of lights) assert.equal(light.name, undefined);
});

test('nominatim policy errors back off longer than a transient failure', () => {
  assert.equal(retryDelay(403), 60_000);
  assert.equal(retryDelay(401), 60_000);
  assert.equal(retryDelay(429), 5000);
  assert.equal(retryDelay(500), 5000);
  assert.ok(retryDelay(429) >= MIN_GAP_MS);
});

test('fallback queries stay at least 1.1s apart', () => {
  const { calls, lights } = simulateGeocode(
    [{ id: 'ABCD-123', place: 'Ogden, Weber, Utah, United States', ordinance: 'Baptism' }],
    query => query === 'Ogden, United States' ? { lat: 41.2, lon: -112 } : null,
    5_000
  );
  assert.equal(lights.length, 1);
  assert.equal(lights[0].lat, 41.2);
  assert.ok(calls.length >= 2);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].t - calls[i - 1].t >= MIN_GAP_MS);
});

test('api upload queues work, hides private fields, and reset requires the token', async () => {
  const store = memoryStore();
  let kicks = 0;
  const ctx = { waitUntil(promise) { this.promise = promise; } };
  const uploaded = await handleApi(req('/api/upload', { method: 'POST', body: en }), {
    store,
    kick: () => { kicks++; },
    ctx,
  });
  assert.equal(uploaded.status, 200);
  const stats = await uploaded.json();
  assert.equal(stats.queued, 2);
  assert.equal(stats.added, 0);
  assert.equal(store.jobs.length, 2);
  for (const job of store.jobs) assert.equal(job.name, undefined);
  await ctx.promise;
  assert.equal(kicks, 1);

  const again = await handleApi(req('/api/upload', { method: 'POST', body: en }), { store });
  assert.equal((await again.json()).duplicate, 2);

  store.lights.push({
    id: 'ABCD-999', name: 'Hidden Person', temple: 'Somewhere', ordinance: 'Baptism',
    place: 'Cork, Ireland', lat: 51.9, lon: -8.47, created: 10,
  });
  store.lights.push({
    id: 'ABCD-998', ordinance: 'Endowment', place: 'Bergen, Norway', lat: 60.4, lon: 5.3, created: 20,
  });
  const listed = await handleApi(req('/api/lights?since=10'), { store });
  const body = await listed.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].place, 'Bergen, Norway');
  assert.deepEqual(Object.keys(body[0]).sort(), [...PUBLIC_KEYS].sort());
  assert.deepEqual(body[0].ordinances, ['Endowment']);
  assert.equal(body[0].updated, 20);
  assert.equal(body[0].name, undefined);
  assert.equal(body[0].id, undefined);
  assert.equal(body[0].ordinance, undefined);
  assert.equal(body[0].temple, undefined);

  assert.equal((await handleApi(req('/api/reset', { method: 'POST' }), { store, resetToken: '' })).status, 503);
  assert.equal((await handleApi(req('/api/reset', { method: 'POST', headers: { authorization: 'Bearer wrong' } }), { store, resetToken: 's3cret' })).status, 401);
  assert.equal(store.lights.length, 2);
  const cleared = await handleApi(req('/api/reset', { method: 'POST', headers: { authorization: 'Bearer s3cret' } }), { store, resetToken: 's3cret' });
  assert.equal(cleared.status, 200);
  assert.deepEqual(store.lights, []);
  assert.deepEqual(store.jobs, []);
  assert.equal(await tokensMatch('s3cret', 's3cret'), true);
  assert.equal(await tokensMatch('s3cret', 'other'), false);
});

test('oversized uploads are rejected before they are parsed', async () => {
  const store = memoryStore();
  const response = await handleApi(req('/api/upload', { method: 'POST', headers: { 'content-length': '5000001' }, body: 'nope' }), { store });
  assert.equal(response.status, 413);
  assert.equal(store.jobs.length, 0);
});

test('d1 migration stores deduped lights and the public query omits ids', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  const columns = db.prepare('PRAGMA table_info(lights)').all().map(column => column.name);
  assert.deepEqual(columns, ['person_id', 'place', 'lat', 'lon', 'ordinance', 'created', 'updated']);
  assert.ok(!columns.includes('name'));
  const insert = db.prepare('INSERT INTO lights (person_id, place, lat, lon, ordinance, created) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run('ABCD-123', 'Cork, Ireland', 51.9, -8.47, 'Endowment', 10);
  assert.throws(() => insert.run('ABCD-123', 'Other', 1, 2, 'Baptism', 11));
  const jobColumns = db.prepare('PRAGMA table_info(jobs)').all().map(column => column.name);
  assert.deepEqual(jobColumns, ['person_id', 'place', 'ordinance', 'created', 'cursor_idx', 'status']);
  const cacheColumns = db.prepare('PRAGMA table_info(geocache)').all().map(column => column.name);
  assert.deepEqual(cacheColumns, ['query', 'lat', 'lon', 'cached_at']);
  const pub = db.prepare(
    'SELECT place, lat, lon, ordinance, created, updated FROM lights WHERE created > ? OR updated > ? ORDER BY created'
  ).all(0, 0);
  assert.deepEqual(Object.keys(pub[0]).sort(), ['created', 'lat', 'lon', 'ordinance', 'place', 'updated']);
  assert.equal(pub[0].person_id, undefined);
});

function csv(rows) {
  const header = '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"\n';
  return header + rows.map(row => (
    `"N","${row.id}","Birth, 1900, ${row.place}","${row.ordinance}","15 September 2026","Temple"`
  )).join('\n');
}

test('two ordinances for one new person become one queued light', () => {
  const text = csv([
    { id: 'ABCD-123', place: 'Ogden, Weber, Utah, United States', ordinance: 'Baptism' },
    { id: 'ABCD-123', place: 'Ogden, Weber, Utah, United States', ordinance: 'Endowment' },
  ]);
  const plan = planUpload(text, { now: NOW, existingIds: new Set(), cache: {} });
  assert.equal(plan.pending.length, 1);
  assert.equal(plan.stats.queued, 1);
  assert.equal(plan.stats.duplicate, 0);
  assert.equal(plan.stats.pastYear, 2);
  assert.deepEqual(JSON.parse(plan.pending[0].ordinance), ['Baptism', 'Endowment']);
});

test('a new ordinance merges onto the existing person instead of a second light', async () => {
  const store = memoryStore({
    lights: [{
      id: 'ABCD-123', place: 'Ogden, Weber, Utah, United States', lat: 41.22, lon: -111.97,
      ordinance: '["Baptism"]', created: 5, updated: 5,
    }],
  });
  const text = csv([
    { id: 'ABCD-123', place: 'Ogden, Weber, Utah, United States', ordinance: 'Endowment' },
  ]);
  const response = await handleApi(req('/api/upload', { method: 'POST', body: text }), { store });
  const stats = await response.json();
  assert.equal(stats.merged, 1);
  assert.equal(stats.added, 0);
  assert.equal(stats.queued, 0);
  assert.equal(store.lights.length, 1);
  assert.equal(store.lights[0].created, 5);
  assert.ok(store.lights[0].updated > 5);
  assert.deepEqual(parseOrdinances(store.lights[0].ordinance), ['Baptism', 'Endowment']);
  const listed = await handleApi(req('/api/lights?since=5'), { store });
  const body = await listed.json();
  assert.equal(body.length, 1);
  assert.deepEqual(body[0].ordinances, ['Baptism', 'Endowment']);
  assert.equal(body[0].created, 5);
  assert.equal(body[0].id, undefined);
});

test('the same ordinance again is still a duplicate', () => {
  const text = csv([
    { id: 'ABCD-123', place: 'Ogden, Weber, Utah, United States', ordinance: 'baptism' },
  ]);
  const plan = planUpload(text, {
    now: NOW,
    existing: [{ id: 'ABCD-123', ordinance: 'Baptism' }],
    cache: {},
  });
  assert.equal(plan.stats.duplicate, 1);
  assert.equal(plan.stats.merged, 0);
  assert.deepEqual(plan.merges, []);
});

test('wrangler config has no account id and keeps the Tests-sized placeholder database id', () => {
  const toml = fs.readFileSync(path.join(__dirname, '..', 'wrangler.toml'), 'utf8');
  assert.match(toml, /name = "temple-ordinance-map"/);
  assert.match(toml, /database_id = "00000000-0000-0000-0000-000000000000"/);
  assert.match(toml, /new_sqlite_classes = \["Geocoder"\]/);
  assert.doesNotMatch(toml, /account_id\s*=/);
});
