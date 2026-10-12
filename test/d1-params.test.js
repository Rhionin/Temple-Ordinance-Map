const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { handleApi } = require('../lib/http');
const { queriesForRows } = require('../lib/upload');
const { rowsFromCsv } = require('../lib/rows');

const PLACES = 300;
const ROWS_PER_PLACE = 10;
const ORDINANCES = [
  'Baptism', 'Confirmation', 'Initiatory', 'Endowment', 'Sealing to Parents', 'Sealing to Spouse',
  'Baptism', 'Confirmation', 'Initiatory', 'Endowment',
];

function pid(i) {
  return 'P' + String(i).padStart(3, '0') + '-' + String(i).padStart(3, '0');
}

function placeName(i) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const first = alphabet[Math.floor(i / 26) % 26];
  const second = alphabet[i % 26];
  return 'Place ' + first + second;
}

function wideCsv() {
  const header = '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"\n';
  const lines = [];
  for (let i = 0; i < PLACES; i++) {
    for (let n = 0; n < ROWS_PER_PLACE; n++) {
      lines.push(
        `"N","${pid(i)}","Birth, 1900, ${placeName(i)}","${ORDINANCES[n]}","15 September 2026","Temple"`
      );
    }
  }
  return header + lines.join('\n');
}

function openSchema() {
  const { DatabaseSync } = require('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  return sqlite;
}

function d1WithCap(sqlite, cap = 100) {
  const bound = [];
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const select = /^\s*select/i.test(sql);
      function bindTo(args) {
        if (args.length > cap) throw new Error('D1_ERROR: too many SQL variables');
        if (sql.includes('FROM geocache') && sql.includes(' IN ')) bound.push(args.length);
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
  return { db, bound };
}

test('three hundred places and three thousand rows upload without a 100-parameter statement', async () => {
  const { d1Store } = await import('../src/d1.js');
  const sqlite = openSchema();
  const { db, bound } = d1WithCap(sqlite);
  for (let i = 0; i < 5; i++) {
    sqlite.prepare('INSERT INTO geocache (query, lat, lon, country, cached_at) VALUES (?, ?, ?, ?, ?)').run(
      placeName(i), 10 + i, 20 + i, 'US', 1
    );
  }
  const text = wideCsv();
  const parsed = rowsFromCsv(text);
  assert.equal(parsed.rows.length, PLACES * ROWS_PER_PLACE);
  assert.ok(queriesForRows(parsed.rows).length > 100);

  const response = await handleApi(
    new Request('http://localhost/api/upload', { method: 'POST', body: text }),
    { store: d1Store(db) }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.pastYear, 3000);
  assert.equal(body.geocoded, 5);
  assert.equal(body.queued, 295);
  assert.ok(bound.length > 1);
  assert.ok(bound.every(count => count <= 90));
  assert.equal(bound.reduce((sum, count) => sum + count, 0), queriesForRows(parsed.rows).length);
  const jobs = sqlite.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending'").get();
  assert.equal(jobs.n, 295);
});

test('a failed upload tells the guest to try again and logs the row count', async () => {
  const text = wideCsv();
  const logs = [];
  const original = console.error;
  console.error = line => logs.push(String(line));
  try {
    const response = await handleApi(
      new Request('http://localhost/api/upload', { method: 'POST', body: text }),
      {
        store: {
          async ids() { return []; },
          async known() { return []; },
          async cacheFor() { throw new Error('D1_ERROR: too many SQL variables'); },
        },
      }
    );
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error, 'Something went wrong, please try again');
    const logged = JSON.parse(logs[0]);
    assert.equal(logged.event, 'api_error');
    assert.equal(logged.rows, 3000);
    assert.match(logged.message, /too many SQL variables/);
  } finally {
    console.error = original;
  }
});
