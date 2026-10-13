const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('../lib/http');
const { hashToken } = require('../lib/token');

function openDb() {
  const { DatabaseSync } = require('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const select = /^\s*select/i.test(sql);
      function bindTo(args) {
        return {
          _select: select,
          all: async () => ({ results: args.length ? statement.all(...args) : statement.all() }),
          first: async () => (args.length ? statement.get(...args) : statement.get()) || null,
          run: async () => ({ meta: { changes: (args.length ? statement.run(...args) : statement.run()).changes } }),
        };
      }
      const unbound = bindTo([]);
      unbound.bind = (...args) => bindTo(args);
      return unbound;
    },
    async batch(statements) {
      const out = [];
      for (const statement of statements) out.push(statement._select ? await statement.all() : await statement.run());
      return out;
    },
    sqlite,
  };
}

function auth(token) {
  return { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
}

test('the owner can edit, reset, and soft-delete, and a wrong token is refused', async () => {
  const { directory } = await import('../src/directory.js');
  const { masterStore } = await import('../src/master.js');
  const db = openDb();
  const groups = directory(db);
  const created = await handleApi(new Request('http://localhost/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'owners', title: 'Owners' }),
  }), { groups });
  const made = await created.json();
  const token = made.adminToken;
  await groups.store((await groups.find('owners')).id).insertLight({
    id: 'ABCD-123', place: 'Cork', lat: 1, lon: 2, ordinance: '["Baptism"]', created: 10, updated: 10,
  });

  const denied = await handleApi(new Request('http://localhost/g/owners/api/admin/settings', {
    method: 'POST',
    headers: auth('nope'),
    body: JSON.stringify({ title: 'Nope', months: 12 }),
  }), { groups });
  assert.equal(denied.status, 401);

  const saved = await handleApi(new Request('http://localhost/g/owners/api/admin/settings', {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ title: 'Family night', subtitle: 'This year', months: 6, uploadsOpen: '', uploadsClose: '' }),
  }), { groups });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.title, 'Family night');
  assert.equal(savedBody.months, 6);

  const reset = await handleApi(new Request('http://localhost/g/owners/api/admin/reset', {
    method: 'POST',
    headers: auth(token),
  }), { groups });
  assert.equal(reset.status, 200);
  const lights = await handleApi(new Request('http://localhost/g/owners/api/lights'), { groups });
  assert.equal((await lights.json()).length, 0);

  await groups.store((await groups.find('owners')).id).insertLight({
    id: 'ABCD-123', place: 'Cork', lat: 1, lon: 2, ordinance: '["Baptism"]', created: 10, updated: 10,
  });
  const removed = await handleApi(new Request('http://localhost/g/owners/api/admin/delete', {
    method: 'POST',
    headers: auth(token),
  }), { groups });
  assert.equal(removed.status, 200);
  const share = await handleApi(new Request('http://localhost/g/owners/api/lights'), { groups });
  assert.equal(share.status, 404);
  const master = await handleApi(new Request('http://localhost/api/lights'), { store: masterStore(db), groups });
  const folded = await master.json();
  assert.equal(folded.length, 1);
  assert.equal(folded[0].place, 'Cork');
  const stored = db.sqlite.prepare('SELECT admin_token_hash, deleted FROM groups WHERE slug = ?').get('owners');
  assert.equal(stored.deleted, 1);
  assert.equal(stored.admin_token_hash, await hashToken(token));
});
