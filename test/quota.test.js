const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('../lib/http');
const { planLimitReason, queueLimitReason, recentLimitReason, MAX_PEOPLE, MAX_PAST_YEAR_ROWS, MAX_PENDING_JOBS, MAX_RECENT, RECENT_MS } = require('../lib/quota');
const { describeError } = require('../public/upload-status');

function pid(i) {
  return 'P' + String(i).padStart(3, '0') + '-' + String(i).padStart(3, '0');
}

function csv(rows) {
  const header = '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"\n';
  return header + rows.map(row => (
    `"N","${row.id}","Birth, 1900, ${row.place}","${row.ordinance}","15 September 2026","Temple"`
  )).join('\n');
}

function placeName(i) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const first = alphabet[Math.floor(i / 26) % 26];
  const second = alphabet[i % 26];
  return 'Place ' + first + second;
}

function peopleCsv(count, ordinances = ['Baptism']) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    for (const ordinance of ordinances) {
      rows.push({ id: pid(i), place: placeName(i), ordinance });
    }
  }
  return csv(rows);
}

function store(seed = {}) {
  const lights = seed.lights || [];
  const jobs = seed.jobs || [];
  return {
    lights,
    jobs,
    async ids() { return [...lights.map(light => light.id), ...jobs.map(job => job.id)]; },
    async known() {
      return [...lights, ...jobs].map(row => ({ id: row.id, ordinance: row.ordinance || '' }));
    },
    async maxCreated() { return 0; },
    async cacheFor() { return {}; },
    async pendingCount() {
      return jobs.filter(job => job.status !== 'done' && job.status !== 'failed').length;
    },
    async recentCount() {
      const since = Date.now() - RECENT_MS;
      return lights.filter(light => (light.created || 0) > since).length
        + jobs.filter(job => job.status !== 'done' && job.status !== 'failed' && (job.created || 0) > since).length;
    },
    async insertLight(light) {
      lights.push(light);
      return true;
    },
    async insertJob(job) {
      jobs.push({ ...job, status: 'pending' });
      return true;
    },
    async listLights() { return []; },
    async clearLights() {},
  };
}

test('one normal list is still accepted', async () => {
  const target = store();
  const response = await handleApi(
    new Request('http://localhost/api/upload', { method: 'POST', body: peopleCsv(2) }),
    { store: target }
  );
  assert.equal(response.status, 200);
  assert.equal(target.jobs.length, 2);
});

test('a file with more than 800 new people is refused and stores nothing', async () => {
  const target = store();
  const response = await handleApi(
    new Request('http://localhost/api/upload', { method: 'POST', body: peopleCsv(MAX_PEOPLE + 1) }),
    { store: target }
  );
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.equal(body.error, 'too many people in one file');
  assert.equal(target.jobs.length, 0);
  assert.equal(target.lights.length, 0);
});

test('three thousand past-year rows are accepted and one more is refused', async () => {
  assert.equal(MAX_PAST_YEAR_ROWS, 3000);
  const ordinances = ['Baptism', 'Confirmation', 'Initiatory', 'Endowment'];
  const atCap = store();
  const accepted = await handleApi(
    new Request('http://localhost/api/upload', {
      method: 'POST',
      body: peopleCsv(MAX_PAST_YEAR_ROWS / ordinances.length, ordinances),
    }),
    { store: atCap }
  );
  assert.equal(accepted.status, 200);
  assert.equal(atCap.jobs.length, MAX_PAST_YEAR_ROWS / ordinances.length);

  const people = Math.floor(MAX_PAST_YEAR_ROWS / ordinances.length) + 1;
  const over = store();
  const response = await handleApi(
    new Request('http://localhost/api/upload', {
      method: 'POST',
      body: peopleCsv(people, ordinances),
    }),
    { store: over }
  );
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.equal(body.error, 'too many rows in one file');
  assert.equal(over.jobs.length, 0);
});

test('a full geocode queue refuses another file', async () => {
  const jobs = Array.from({ length: MAX_PENDING_JOBS }, (_, i) => ({
    id: pid(i),
    status: 'pending',
    created: Date.now(),
    ordinance: '["Baptism"]',
  }));
  const target = store({ jobs });
  const response = await handleApi(
    new Request('http://localhost/api/upload', {
      method: 'POST',
      body: csv([{ id: 'ZZZZ-999', place: 'New Town', ordinance: 'Baptism' }]),
    }),
    { store: target }
  );
  const body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.error, 'the map is still catching up, try again in a few minutes');
  assert.equal(target.jobs.length, MAX_PENDING_JOBS);
});

test('eight thousand recent lights refuse another file', async () => {
  const lights = Array.from({ length: MAX_RECENT }, (_, i) => ({
    id: pid(i),
    created: Date.now(),
    ordinance: '["Baptism"]',
  }));
  const target = store({ lights });
  const response = await handleApi(
    new Request('http://localhost/api/upload', {
      method: 'POST',
      body: csv([{ id: 'ZZZZ-999', place: 'New Town', ordinance: 'Baptism' }]),
    }),
    { store: target }
  );
  assert.equal(response.status, 429);
  assert.equal(target.lights.length, MAX_RECENT);
  assert.equal(target.jobs.length, 0);
});

test('a chunked body over 5 MB is refused before it is stored', async () => {
  const target = store();
  let sent = 0;
  const total = 5_000_001;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const size = Math.min(64 * 1024, total - sent);
      controller.enqueue(new Uint8Array(size));
      sent += size;
    },
  });
  const request = new Request('http://localhost/api/upload', { method: 'POST', body: stream, duplex: 'half' });
  const response = await handleApi(request, { store: target });
  const body = await response.json();
  assert.equal(response.status, 413);
  assert.equal(body.error, 'file too large');
  assert.equal(target.jobs.length, 0);
});

test('D1 counts pending jobs and lights from the last 10 minutes', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { d1Store } = await import('../src/d1.js');
  const sqlite = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  const now = Date.now();
  sqlite.prepare(
    'INSERT INTO jobs (person_id, place, ordinance, created, status) VALUES (?, ?, ?, ?, ?)'
  ).run('AAAA-101', 'Cork', '[]', now, 'pending');
  sqlite.prepare(
    'INSERT INTO jobs (person_id, place, ordinance, created, status) VALUES (?, ?, ?, ?, ?)'
  ).run('AAAA-102', 'Cork', '[]', now - RECENT_MS - 1000, 'pending');
  sqlite.prepare(
    'INSERT INTO lights (person_id, place, lat, lon, ordinance, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run('AAAA-201', 'Cork', 51.9, -8.4, '[]', now, now);
  const db = {
    prepare(sql) {
      const statement = {
        bind(...args) {
          return {
            first: () => statement.first(args),
            all: () => statement.all(args),
            run: () => statement.run(args),
          };
        },
        async first(args = []) {
          return sqlite.prepare(sql).get(...args) || null;
        },
        async all(args = []) {
          return { results: sqlite.prepare(sql).all(...args) };
        },
        async run(args = []) {
          const info = sqlite.prepare(sql).run(...args);
          return { meta: { changes: info.changes } };
        },
      };
      return statement;
    },
  };
  const counted = d1Store(db);
  assert.equal(await counted.pendingCount(), 2);
  assert.equal(await counted.recentCount(now), 2);
});

test('the phone copy for a huge file names the Completed list', () => {
  assert.equal(describeError('large'), 'That file is too large. Use the Completed list from step 2.');
  assert.equal(planLimitReason({ ok: true, immediate: [], pending: new Array(MAX_PEOPLE + 1), stats: { pastYear: 1 } }), 'too many people in one file');
  assert.equal(queueLimitReason(MAX_PENDING_JOBS, 1), 'the map is still catching up, try again in a few minutes');
  assert.equal(recentLimitReason(0, 1), '');
});
