const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('../lib/http');
const { server } = require('../server');

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
  };
}

test('PIN 1337 lists groups, disable removes them from the master map, and delete is soft', async () => {
  const { directory } = await import('../src/directory.js');
  const { masterStore } = await import('../src/master.js');
  const db = openDb();
  const groups = directory(db);
  await groups.create({ slug: 'visible', title: 'Visible', subtitle: '', tokenHash: 'a', now: 1_000 });
  const hidden = await groups.create({ slug: 'quiet', title: 'Quiet', subtitle: '', tokenHash: 'b', now: 2_000 });
  await groups.store(hidden.id).insertLight({
    id: 'ABCD-123', place: 'Cork', lat: 1, lon: 2, ordinance: '["Baptism"]', created: 10, updated: 10,
  });
  const locked = await handleApi(new Request('http://localhost/api/admin/groups'), { groups });
  assert.equal(locked.status, 401);
  const pin = { 'x-admin-pin': '1337' };
  const listed = await handleApi(new Request('http://localhost/api/admin/groups', { headers: pin }), { groups });
  const rows = await listed.json();
  assert.equal(listed.status, 200);
  assert.deepEqual(rows.map(row => row.slug).sort(), ['quiet', 'visible']);
  assert.equal(rows[0].admin_token_hash, undefined);
  const off = await handleApi(new Request('http://localhost/api/admin/groups/quiet/disable', { method: 'POST', headers: pin }), { groups });
  assert.equal(off.status, 200);
  const master = await handleApi(new Request('http://localhost/api/lights'), { store: masterStore(db) });
  assert.equal((await master.json()).length, 0);
  const share = await handleApi(new Request('http://localhost/g/quiet/api/lights'), { groups });
  assert.equal(share.status, 404);
  const on = await handleApi(new Request('http://localhost/api/admin/groups/quiet/enable', { method: 'POST', headers: pin }), { groups });
  assert.equal(on.status, 200);
  const back = await handleApi(new Request('http://localhost/api/lights'), { store: masterStore(db) });
  assert.equal((await back.json()).length, 1);
  const removed = await handleApi(new Request('http://localhost/api/admin/groups/quiet/delete', { method: 'POST', headers: pin }), { groups });
  assert.equal(removed.status, 200);
  const still = await handleApi(new Request('http://localhost/api/lights'), { store: masterStore(db) });
  assert.equal((await still.json()).length, 1);
  const page = await handleApi(new Request('http://localhost/g/quiet/api/group'), { groups });
  assert.equal(page.status, 404);
});

test('the super-admin page is served', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const response = await fetch('http://127.0.0.1:' + port + '/admin');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Super-admin/);
    assert.equal(html.includes('1337'), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
