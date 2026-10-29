const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  resetPollCachesForTests,
  resetPollQueryCount,
  pollQueryCount,
  isD1ReadError,
  POLL_TTL_MS,
} = require('../lib/poll-cache.js');

function openDb() {
  const { DatabaseSync } = require('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      function bindTo(args) {
        const run = () => ({ meta: { changes: (args.length ? statement.run(...args) : statement.run()).changes } });
        const all = () => ({ results: args.length ? statement.all(...args) : statement.all() });
        const first = () => (args.length ? statement.get(...args) : statement.get()) || null;
        return { all: async () => all(), first: async () => first(), run: async () => run() };
      }
      const unbound = bindTo([]);
      unbound.bind = (...args) => bindTo(args);
      return unbound;
    },
    async batch(statements) {
      for (const statement of statements) await statement.run();
    },
    sqlite,
  };
  return db;
}

test.beforeEach(() => {
  resetPollCachesForTests();
});

test('a burst of stats and lights polls hits D1 once per TTL window', async () => {
  const { directory } = await import('../src/directory.js');
  const db = openDb();
  const groups = directory(db);
  const group = await groups.create({ slug: 'ward', title: 'Ward', subtitle: '', tokenHash: 'x', now: 1 });
  const store = groups.store(group.id);
  await store.insertLight({
    id: 'ABCD-1', place: 'Paris', lat: 48.8, lon: 2.3, ordinance: '["Baptism"]',
    created: 10, updated: 10, country: 'FR',
  });

  resetPollQueryCount();
  await store.stats();
  const afterFirst = pollQueryCount();
  assert.ok(afterFirst >= 1);

  for (let i = 0; i < 40; i += 1) {
    await store.stats();
    await store.listLights(0);
    await store.listLights(5);
  }
  assert.equal(pollQueryCount(), afterFirst);

  const { invalidateGroupPoll } = await import('../lib/poll-cache.js');
  invalidateGroupPoll(group.id);
  resetPollQueryCount();
  await store.stats();
  assert.ok(pollQueryCount() >= 1);
});

test('upload invalidates the poll cache so the next read refreshes D1', async () => {
  const { directory } = await import('../src/directory.js');
  const db = openDb();
  const groups = directory(db);
  const group = await groups.create({ slug: 'ward', title: 'Ward', subtitle: '', tokenHash: 'x', now: 1 });
  const store = groups.store(group.id);
  await store.insertLight({
    id: 'ABCD-1', place: 'Paris', lat: 48.8, lon: 2.3, ordinance: '["Baptism"]',
    created: 10, updated: 10, country: 'FR',
  });
  await store.stats();
  resetPollQueryCount();
  await store.stats();
  assert.equal(pollQueryCount(), 0);
  await store.insertLight({
    id: 'ABCD-2', place: 'Rome', lat: 41.9, lon: 12.5, ordinance: '["Endowment"]',
    created: 20, updated: 20, country: 'IT',
  });
  resetPollQueryCount();
  const stats = await store.stats();
  assert.ok(pollQueryCount() >= 1);
  assert.equal(stats.ancestors, 2);
});

test('stale-if-error serves the last good snapshot', async () => {
  const db = openDb();
  const { directory } = await import('../src/directory.js');
  const groups = directory(db);
  const group = await groups.create({ slug: 'ward', title: 'Ward', subtitle: '', tokenHash: 'x', now: 1 });
  const store = groups.store(group.id);
  await store.insertLight({
    id: 'ABCD-1', place: 'Paris', lat: 48.8, lon: 2.3, ordinance: '["Baptism"]',
    created: 10, updated: 10, country: 'FR',
  });
  const warm = await store.stats();
  assert.equal(warm.ancestors, 1);

  const realPrepare = db.prepare.bind(db);
  db.prepare = () => {
    throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit");
  };
  const stale = await store.stats();
  assert.equal(stale.ancestors, 1);
  assert.equal(isD1ReadError(new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit")), true);
  assert.equal(isD1ReadError(new Error('D1_ERROR: too many SQL variables')), false);
  db.prepare = realPrepare;
});

test('poll TTL defaults to about one minute', () => {
  assert.equal(POLL_TTL_MS, 60_000);
});
