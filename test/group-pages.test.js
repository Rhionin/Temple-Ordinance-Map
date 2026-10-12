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
  const db = {
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
      for (const statement of statements) out.push(await statement.all());
      return out;
    },
  };
  return db;
}

function csv(id, place) {
  return '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"\n'
    + `"N","${id}","Birth, 1900, ${place}","Baptism","15 September 2026","Temple"\n`;
}

test('a group upload stays off the other group and off an unknown slug', async () => {
  const { directory } = await import('../src/directory.js');
  const db = openDb();
  const groups = directory(db);
  const created = await handleApi(new Request('http://localhost/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'Friends', title: '=Ward', subtitle: 'Bring a list' }),
  }), { groups });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.slug, 'friends');
  assert.equal(body.title, 'Ward');
  assert.match(body.adminToken, /^[0-9a-f]{64}$/);
  assert.equal(body.adminPath, '/g/friends/admin#' + body.adminToken);
  const stored = await groups.find('friends');
  assert.notEqual(stored.admin_token_hash, body.adminToken);
  assert.ok(stored.admin_token_hash);

  const again = await handleApi(new Request('http://localhost/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'friends' }),
  }), { groups });
  assert.equal(again.status, 409);

  const reserved = await handleApi(new Request('http://localhost/api/groups', {
    method: 'POST',
    body: JSON.stringify({ slug: 'admin' }),
  }), { groups });
  assert.equal(reserved.status, 400);

  const other = await groups.create({ slug: 'other', title: '', subtitle: '', tokenHash: 'abc', now: Date.now() });
  const uploaded = await handleApi(new Request('http://localhost/g/friends/api/upload', {
    method: 'POST',
    body: csv('ABCD-123', 'Cork'),
  }), { groups, store: groups.store(other.id) });
  assert.equal(uploaded.status, 200);
  const friends = await handleApi(new Request('http://localhost/g/friends/api/lights'), { groups });
  const theirs = await handleApi(new Request('http://localhost/g/other/api/lights'), { groups });
  assert.equal((await friends.json()).length, 0);
  assert.equal((await theirs.json()).length, 0);
  const jobs = await db.prepare("SELECT group_id, person_id FROM jobs").all();
  assert.equal(jobs.results.length, 1);
  assert.equal(jobs.results[0].group_id, stored.id);
  assert.equal(jobs.results[0].person_id, 'ABCD-123');

  const missing = await handleApi(new Request('http://localhost/g/missing/api/lights'), { groups });
  assert.equal(missing.status, 404);
  const info = await handleApi(new Request('http://localhost/g/friends/api/group'), { groups });
  assert.deepEqual(await info.json(), { slug: 'friends', title: 'Ward', subtitle: 'Bring a list', months: 12 });
});

test('the share page, the group map, and /new are served, and an unknown slug is a 404', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  try {
    const home = await fetch(base + '/');
    const tv = await fetch(base + '/tv');
    const created = await fetch(base + '/new');
    const party = await fetch(base + '/g/party');
    const map = await fetch(base + '/g/party/map');
    const missing = await fetch(base + '/g/missing');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /leaflet.js/);
    assert.equal(tv.status, 404);
    assert.equal(created.status, 200);
    assert.match(await created.text(), /Start a group/);
    assert.equal(party.status, 200);
    assert.match(await party.text(), /Choose my list/);
    assert.equal(map.status, 200);
    assert.match(await map.text(), /leaflet.js/);
    assert.equal(missing.status, 404);
    const made = await fetch(base + '/api/groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'shot' + Date.now().toString(36), title: 'Screenshot night' }),
    });
    assert.equal(made.status, 201);
    const madeBody = await made.json();
    const share = await fetch(base + madeBody.sharePath);
    assert.equal(share.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
