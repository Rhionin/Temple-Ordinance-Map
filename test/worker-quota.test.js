const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { handleApi, apiErrorResponse } = require('../lib/http');
const { resetPollCachesForTests } = require('../lib/poll-cache.js');

const QUOTA = "D1_ERROR: Your account has exceeded D1's free tier daily row read limit";

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
        return {
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
      for (const statement of statements) await statement.run();
    },
  };
  return db;
}

function quotaDb(inner) {
  const fail = () => {
    throw new Error(QUOTA);
  };
  return {
    prepare(sql) {
      const stmt = inner.prepare(sql);
      function wrap(bound) {
        return {
          all: fail,
          first: fail,
          run: fail,
          bind(...args) {
            return wrap(stmt.bind(...args));
          },
        };
      }
      return wrap(stmt);
    },
    batch: fail,
  };
}

async function fetchMasterApi(request, env, ctx = {}) {
  const { ensureParty } = await import('../src/d1.js');
  const { directory } = await import('../src/directory.js');
  const { masterStore } = await import('../src/master.js');
  const groups = directory(env.DB);
  try {
    try {
      await ensureParty(env.DB);
    } catch (error) {
      /* same as worker tryEnsureParty: non-fatal */
    }
    return await handleApi(request, {
      store: masterStore(env.DB),
      groups,
      resetToken: env.RESET_TOKEN || '',
      resetPin: env.RESET_PIN || '1337',
      buildId: env.BUILD_ID || '',
      kick: () => {},
      ctx,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

test.beforeEach(() => {
  resetPollCachesForTests();
});

test('ensureParty uses the per-isolate party id cache without another D1 read', async () => {
  const { ensureParty } = await import('../src/d1.js');
  const db = openDb();
  const partyId = await ensureParty(db);
  assert.ok(partyId > 0);
  const dead = {
    prepare() {
      throw new Error('D1 should not be queried when party id is cached');
    },
  };
  assert.equal(await ensureParty(dead), partyId);
});

test('ensureParty quota on the API path is non-fatal and stale poll data still returns 200', async () => {
  const db = openDb();
  const { ensureParty, d1Store } = await import('../src/d1.js');
  const { masterStore } = await import('../src/master.js');
  const partyId = await ensureParty(db);
  const store = d1Store(db, partyId);
  await store.insertLight({
    id: 'ABCD-1', place: 'Paris', lat: 48.8, lon: 2.3, ordinance: '["Baptism"]',
    created: 10, updated: 10, country: 'FR',
  });
  await masterStore(db).listLights(0);
  const { invalidateMasterPoll } = await import('../src/master.js');
  invalidateMasterPoll();

  const env = { DB: quotaDb(db), RESET_TOKEN: '', RESET_PIN: '1337', BUILD_ID: 'test' };
  const response = await fetchMasterApi(new Request('http://smoke.test/api/lights?since=0'), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Lights-Stale'), '1');
  const body = await response.json();
  assert.equal(body.length, 1);
  assert.equal(body[0].place, 'Paris');
});

test('ensureParty quota with no stale snapshot returns friendly 503 JSON', async () => {
  const env = { DB: quotaDb(openDb()), RESET_TOKEN: '', RESET_PIN: '1337', BUILD_ID: 'test' };
  const response = await fetchMasterApi(new Request('http://smoke.test/api/lights?since=0'), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '60');
  const body = await response.json();
  assert.match(body.error, /resting/i);
});

test('handleApi maps D1 quota errors to 503 without throwing', async () => {
  const store = {
    async listLights() {
      throw new Error(QUOTA);
    },
  };
  const response = await handleApi(new Request('http://localhost/api/lights'), { store });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Retry-After'), '60');
});

test('worker guards ensureParty and fetch so D1 quota cannot escape as 1101', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'src', 'worker.js'), 'utf8');
  assert.match(text, /await tryEnsureParty\(env\.DB\)/);
  assert.match(text, /ensure_party_failed/);
  assert.match(text, /worker_fetch_error/);
  assert.match(text, /apiErrorResponse/);
  assert.doesNotMatch(text, /if \(isApiPath\([\s\S]*?\) \{\s*await ensureParty\(env\.DB\)/);
});
