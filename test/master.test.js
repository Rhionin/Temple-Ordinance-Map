const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('../lib/http');

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
    sqlite,
  };
  return db;
}

test('the master map folds two groups, keeps a soft-deleted group, and skips a disabled one', async () => {
  const { directory } = await import('../src/directory.js');
  const { masterStore } = await import('../src/master.js');
  const db = openDb();
  const groups = directory(db);
  const alpha = await groups.create({ slug: 'alpha', title: 'Alpha', subtitle: '', tokenHash: 'a', now: 1_000 });
  const beta = await groups.create({ slug: 'beta', title: 'Beta', subtitle: '', tokenHash: 'b', now: 2_000 });
  const hidden = await groups.create({ slug: 'hidden', title: 'Hidden', subtitle: '', tokenHash: 'c', now: 3_000 });
  await groups.store(alpha.id).insertLight({
    id: 'ABCD-123', place: 'Cork', lat: 51.9, lon: -8.4, ordinance: '["Baptism"]',
    created: 10, updated: 10, month: '2026-03', completed: '2026-03-02',
  });
  await groups.store(beta.id).insertLight({
    id: 'ABCD-123', place: 'Provo', lat: 40.2, lon: -111.6, ordinance: '["Endowment"]',
    created: 20, updated: 25, month: '2026-01', completed: '2026-01-04',
  });
  await groups.store(hidden.id).insertLight({
    id: 'WXYZ-999', place: 'Lima', lat: -12, lon: -77, ordinance: '["Initiatory"]',
    created: 15, updated: 15,
  });
  db.sqlite.prepare('UPDATE groups SET deleted = 1 WHERE slug = ?').run('beta');
  db.sqlite.prepare('UPDATE groups SET disabled = 1 WHERE slug = ?').run('hidden');
  const response = await handleApi(new Request('http://localhost/api/lights'), { store: masterStore(db), groups });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].place, 'Cork');
  assert.equal(body[0].created, 10);
  assert.equal(body[0].updated, 25);
  assert.equal(body[0].month, '2026-01');
  assert.deepEqual(body[0].ordinances, ['Baptism', 'Endowment']);
  assert.equal(body[0].person_id, undefined);
  const stats = await handleApi(new Request('http://localhost/api/stats'), { store: masterStore(db) });
  assert.equal((await stats.json()).ancestors, 1);
  const upload = await handleApi(new Request('http://localhost/api/upload', { method: 'POST', body: 'nope' }), { store: masterStore(db) });
  assert.equal(upload.status, 404);
});
