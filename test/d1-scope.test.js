const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

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
      const select = /^\s*(select|with)/i.test(sql);
      function bindTo(args) {
        const run = () => {
          const info = args.length ? statement.run(...args) : statement.run();
          return { meta: { changes: info.changes } };
        };
        const all = () => ({ results: args.length ? statement.all(...args) : statement.all() });
        const first = () => (args.length ? statement.get(...args) : statement.get()) || null;
        return {
          _select: select,
          all: async () => all(),
          first: async () => first(),
          run: async () => run(),
        };
      }
      const unbound = bindTo([]);
      unbound.bind = (...args) => bindTo(args);
      return unbound;
    },
    async batch(statements) {
      const out = [];
      for (const statement of statements) {
        out.push(statement._select ? await statement.all() : await statement.run());
      }
      return out;
    },
  };
  return { sqlite, db };
}

test('two groups keep the same person, and reset clears only one group', async () => {
  const { d1Store, ensureParty } = await import('../src/d1.js');
  const { sqlite, db } = openDb();
  const party = await ensureParty(db);
  const again = await ensureParty(db);
  assert.equal(again, party);
  assert.equal(await ensureParty({ prepare() { throw new Error('cached party id must skip D1'); } }), party);
  sqlite.prepare(
    `INSERT INTO groups (slug, title, subtitle, months, admin_token_hash, disabled, deleted, created)
     VALUES ('friends', '', '', 12, '', 0, 0, 1)`
  ).run();
  const friends = sqlite.prepare("SELECT id FROM groups WHERE slug = 'friends'").get().id;
  const ward = d1Store(db, party);
  const other = d1Store(db, friends);
  assert.equal(await ward.insertLight({
    id: 'ABCD-123', place: 'Cork', lat: 51.9, lon: -8.4, ordinance: '["Baptism"]', created: 10, updated: 10,
  }), true);
  assert.equal(await other.insertLight({
    id: 'ABCD-123', place: 'Lima', lat: -12, lon: -77, ordinance: '["Endowment"]', created: 11, updated: 11,
  }), true);
  const wardLights = await ward.listLights(0);
  const otherLights = await other.listLights(0);
  assert.equal(wardLights.length, 1);
  assert.equal(wardLights[0].place, 'Cork');
  assert.equal(otherLights[0].place, 'Lima');
  await ward.clearLights();
  assert.equal((await ward.listLights(0)).length, 0);
  assert.equal((await other.listLights(0)).length, 1);
  const cache = sqlite.prepare('SELECT COUNT(*) AS n FROM geocache').get();
  assert.equal(cache.n, 0);
});
