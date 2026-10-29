const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resetSnapshotCaches } = require('../lib/snapshot-cache');
const { resetPollCachesForTests } = require('../lib/poll-cache.js');

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
      const out = [];
      for (const statement of statements) {
        out.push(await statement.run());
      }
      return out;
    },
    sqlite,
  };
  return db;
}

test.beforeEach(() => {
  resetSnapshotCaches();
  resetPollCachesForTests();
});

test('master listLights(since) is empty when nothing changed and folds only touched ancestors', async () => {
  const { directory } = await import('../src/directory.js');
  const { masterStore } = await import('../src/master.js');
  const db = openDb();
  const groups = directory(db);
  const alpha = await groups.create({ slug: 'alpha', title: 'Alpha', subtitle: '', tokenHash: 'a', now: 1_000 });
  const beta = await groups.create({ slug: 'beta', title: 'Beta', subtitle: '', tokenHash: 'b', now: 2_000 });
  const store = masterStore(db);
  await groups.store(alpha.id).insertLight({
    id: 'ABCD-1', place: 'Cork', lat: 51.9, lon: -8.4, ordinance: '["Baptism"]',
    created: 100, updated: 100,
  });
  await groups.store(beta.id).insertLight({
    id: 'ABCD-1', place: 'Provo', lat: 40.2, lon: -111.6, ordinance: '["Endowment"]',
    created: 200, updated: 250,
  });
  const full = await store.listLights(0);
  assert.equal(full.length, 1);
  assert.deepEqual(full[0].ordinance, '["Baptism","Endowment"]');

  assert.deepEqual(await store.listLights(250), []);

  const delta = await store.listLights(150);
  assert.equal(delta.length, 1);
  assert.equal(delta[0].person_id, 'ABCD-1');
  assert.equal(delta[0].updated, 250);

  await groups.store(beta.id).insertLight({
    id: 'WXYZ-2', place: 'Lima', lat: -12, lon: -77, ordinance: '["Initiatory"]',
    created: 300, updated: 300,
  });
  assert.equal((await store.listLights(0)).length, 2);
  assert.equal((await store.listLights(299)).length, 1);
  assert.equal((await store.listLights(299))[0].person_id, 'WXYZ-2');
});

test('master and group caches invalidate when data or groups change', async () => {
  const { directory } = await import('../src/directory.js');
  const { masterStore } = await import('../src/master.js');
  const db = openDb();
  const groups = directory(db);
  const alpha = await groups.create({ slug: 'alpha', title: 'Alpha', subtitle: '', tokenHash: 'a', now: 1_000 });
  const ward = groups.store(alpha.id);
  const master = masterStore(db);

  await ward.insertLight({
    id: 'ABCD-1', place: 'Cork', lat: 51.9, lon: -8.4, ordinance: '["Baptism"]',
    created: 10, updated: 10, country: 'IE',
  });

  const stats1 = await master.stats();
  const stats2 = await master.stats();
  assert.deepEqual(stats1, stats2);
  assert.equal(stats1.ancestors, 1);

  await ward.insertLight({
    id: 'ABCD-2', place: 'Ogden', lat: 41.2, lon: -112, ordinance: '["Baptism"]',
    created: 20, updated: 20, country: 'US',
  });
  const stats3 = await master.stats();
  assert.equal(stats3.ancestors, 2);

  const lightsBefore = await ward.listLights(0);
  const lightsAgain = await ward.listLights(0);
  assert.deepEqual(lightsBefore, lightsAgain);
  assert.equal(lightsBefore.length, 2);

  await ward.clearLights();
  assert.equal((await master.stats()).ancestors, 0);
  assert.equal((await ward.listLights(0)).length, 0);
  assert.equal((await ward.stats()).ancestors, 0);

  await ward.insertLight({
    id: 'ABCD-3', place: 'Cork', lat: 51.9, lon: -8.4, ordinance: '["Baptism"]',
    created: 30, updated: 30, country: 'IE',
  });
  const beta = await groups.create({ slug: 'beta', title: 'Beta', subtitle: '', tokenHash: 'b', now: 3_000 });
  await groups.store(beta.id).insertLight({
    id: 'ABCD-4', place: 'Paris', lat: 48.8, lon: 2.3, ordinance: '["Baptism"]',
    created: 40, updated: 40, country: 'FR',
  });
  assert.equal((await master.stats()).ancestors, 2);
  await groups.setDisabled('beta', true);
  assert.equal((await master.stats()).ancestors, 1);
});

test('group stats backfills only missing countries and caches identical totals', async () => {
  const { d1Store, ensureParty } = await import('../src/d1.js');
  const db = openDb();
  const party = await ensureParty(db);
  const store = d1Store(db, party);
  await store.insertLight({
    id: 'ABCD-1', place: 'Cork', lat: 51.9, lon: -8.47, ordinance: '["Baptism"]',
    created: 1, updated: 1, country: 'IE',
  });
  db.sqlite.prepare(
    `INSERT INTO lights (group_id, person_id, place, lat, lon, ordinance, created, updated, month, country, completed)
     VALUES (?, 'ABCD-2', 'Lisbon', 38.72, -9.14, '["Baptism"]', 2, 2, NULL, NULL, NULL)`
  ).run(party);

  const first = await store.stats();
  const second = await store.stats();
  assert.deepEqual(first, second);
  assert.equal(first.countries, 2);
  assert.equal(first.ancestors, 2);

  const row = db.sqlite.prepare("SELECT country FROM lights WHERE person_id = 'ABCD-2'").get();
  assert.equal(row.country, 'PT');
});
