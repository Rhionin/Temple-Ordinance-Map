const test = require('node:test');
const assert = require('node:assert');
const { runGeocodeAlarm, BATCH_LIMIT } = require('../lib/geocode-alarm');
const { retryDelay } = require('../lib/geostep');

function world(jobCount, { cached = true } = {}) {
  const jobs = [];
  for (let i = 0; i < jobCount; i++) {
    jobs.push({
      person_id: 'P' + String(i).padStart(3, '0') + '-001',
      place: 'Town' + i,
      ordinance: 'Baptism',
      created: i + 1,
      cursor_idx: 0,
      month: '2026-01',
      completed: '2026-01-15',
      status: 'pending',
    });
  }
  const geocache = {};
  if (cached) {
    for (const job of jobs) geocache[job.place] = { lat: 10, lon: 20 };
  }
  const lights = [];
  const alarms = [];
  let lastFetch = 0;
  const clock = 1_700_000_000_000;

  function pending() {
    return jobs
      .filter(job => job.status === 'pending')
      .sort((a, b) => a.created - b.created || (a.person_id < b.person_id ? -1 : 1));
  }

  const db = {
    prepare(sql) {
      const statement = {
        bind(...args) {
          return {
            first: () => statement.first(),
            all: () => statement.all(args),
            run: () => statement.run(args),
            _select: sql.includes('FROM geocache'),
          };
        },
        async first() {
          if (sql.includes('MAX(created)')) {
            return {
              created: lights.reduce((max, light) => Math.max(max, light.created || 0), 0),
              updated: lights.reduce((max, light) => Math.max(max, light.updated || 0), 0),
            };
          }
          if (sql.includes('FROM jobs')) return pending()[0] || null;
          return null;
        },
        async all(args = []) {
          if (!sql.includes('FROM geocache')) return { results: [] };
          const results = [];
          for (const query of args) {
            if (Object.prototype.hasOwnProperty.call(geocache, query)) {
              const hit = geocache[query];
              results.push({
                query,
                lat: hit ? hit.lat : null,
                lon: hit ? hit.lon : null,
                country: hit && hit.country ? hit.country : null,
              });
            }
          }
          return { results };
        },
        async run(args = []) {
          if (sql.includes('INSERT INTO lights')) {
            const id = args[0];
            const stillPending = jobs.find(job => job.person_id === args[10] && job.status === 'pending');
            if (stillPending && !lights.some(light => light.person_id === id)) {
              lights.push({
                person_id: id,
                place: args[1],
                lat: args[2],
                lon: args[3],
                ordinance: args[4],
                created: args[5],
                updated: args[6],
                month: args[7],
                country: args[8],
                completed: args[9],
              });
            }
          }
          if (sql.includes("status = 'done'")) {
            const job = jobs.find(item => item.person_id === args[0] && item.status === 'pending');
            if (job) job.status = 'done';
          }
          if (sql.includes("status = 'failed'")) {
            const job = jobs.find(item => item.person_id === args[0] && item.status === 'pending');
            if (job) job.status = 'failed';
          }
          if (sql.includes('SET cursor_idx')) {
            const job = jobs.find(item => item.person_id === args[1] && item.status === 'pending');
            if (job) job.cursor_idx = args[0];
          }
          if (sql.includes('INSERT INTO geocache')) {
            geocache[args[0]] = args[1] == null ? null : { lat: args[1], lon: args[2] };
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    batch(statements) {
      return Promise.all(statements.map(statement => (
        statement._select ? statement.all() : statement.run()
      )));
    },
  };

  const storage = {
    async get() { return lastFetch; },
    async put(key, value) { if (key === 'lastFetch') lastFetch = value; },
    async setAlarm(when) { alarms.push(when); },
  };

  return { db, storage, alarms, jobs, lights, clock };
}

test('a full cache-hit batch rearms while a job is still pending', async () => {
  const fixture = world(BATCH_LIMIT + 1);
  await runGeocodeAlarm({
    db: fixture.db,
    storage: fixture.storage,
    ua: 'test-agent',
    fetchImpl: async () => { throw new Error('cache hits must not fetch'); },
    now: () => fixture.clock,
  });
  assert.equal(fixture.lights.length, BATCH_LIMIT);
  assert.equal(fixture.lights[0].month, '2026-01');
  assert.equal(fixture.lights[0].completed, '2026-01-15');
  assert.equal(fixture.jobs.filter(job => job.status === 'pending').length, 1);
  assert.deepEqual(fixture.alarms, [fixture.clock]);
});

test('a batch that finishes the queue does not schedule another alarm', async () => {
  const fixture = world(BATCH_LIMIT);
  await runGeocodeAlarm({
    db: fixture.db,
    storage: fixture.storage,
    ua: 'test-agent',
    fetchImpl: async () => { throw new Error('cache hits must not fetch'); },
    now: () => fixture.clock,
  });
  assert.equal(fixture.lights.length, BATCH_LIMIT);
  assert.equal(fixture.jobs.filter(job => job.status === 'pending').length, 0);
  assert.deepEqual(fixture.alarms, []);
});

test('a Nominatim 429 keeps the job and waits out the penalty', async () => {
  const fixture = world(1, { cached: false });
  await runGeocodeAlarm({
    db: fixture.db,
    storage: fixture.storage,
    ua: 'test-agent',
    fetchImpl: async () => ({ ok: false, status: 429, async json() { return []; } }),
    now: () => fixture.clock,
  });
  assert.equal(fixture.lights.length, 0);
  assert.equal(fixture.jobs[0].status, 'pending');
  assert.deepEqual(fixture.alarms, [fixture.clock + retryDelay(429)]);
});
