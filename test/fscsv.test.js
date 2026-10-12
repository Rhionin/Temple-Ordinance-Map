// Run: node --test test/
// Fixtures named synthetic-* are made-up data, not real FamilySearch output.
// test/package.json "main" is test/run.js, which loads every *.test.js file.
// That keeps `node --test test/` working on Node 21+, which executes a directory
// argument instead of searching inside it.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { analyze, parseDate, extractPlace } = require('../lib/fscsv');
const F = n => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const iso = s => parseDate(s)?.toISOString().slice(0, 10);
const NOW = new Date('2026-10-11'), CUT = new Date('2025-10-11');
const recent = A => A.records.filter(r => { const d = parseDate(r.dateText); return !d || d >= CUT; });

test('dates across locales', () => {
  for (const [s, e] of [['15 September 2026', '2026-09-15'], ['15 de septiembre de 2026', '2026-09-15'], ['10 de outubro de 2026', '2026-10-10'],
    ['5 de mai. de 2024', '2024-05-05'], ['1. Juli 2026', '2026-07-01'], ['20. Dezember 2024', '2024-12-20'], ['15 septembre 2026', '2026-09-15'],
    ['15 settembre 2026', '2026-09-15'], ['15 сентября 2026 г.', '2026-09-15'], ['2026年8月1日', '2026-08-01'], ['2026년 3월 15일', '2026-03-15'],
    ['2026-09-15', '2026-09-15'], ['15/09/2026', '2026-09-15'], ['15 Setyembre 2026', '2026-09-15']]) assert.strictEqual(iso(s), e, s);
  assert.strictEqual(parseDate('fecha desconocida'), null);
  assert.strictEqual(iso('15. syyskuuta 2026'), '2026-09-15');
  assert.strictEqual(iso('2. lokakuuta 2026'), '2026-10-02');
  assert.strictEqual(iso('2.10.2026'), '2026-10-02');
  assert.strictEqual(iso('15.9.2026'), '2026-09-15');
  assert.strictEqual(iso('2.10.2026.'), '2026-10-02');
  assert.strictEqual(iso('\u200e15.9.2026\u200e'), '2026-09-15');
  assert.strictEqual(iso('="15 September 2026"'), '2026-09-15');
});

test('place extraction', () => {
  assert.strictEqual(extractPlace('Birth, 1885, Patrixbourne, Kent'), 'Patrixbourne, Kent');
  assert.strictEqual(extractPlace('Nacimiento, 3 de marzo de 1890, Guadalajara, Jalisco, México'), 'Guadalajara, Jalisco, México');
  assert.strictEqual(extractPlace('Bautizo, , Oaxaca, México'), 'Oaxaca, México');
  assert.strictEqual(extractPlace('Death, Cork, Ireland'), 'Cork, Ireland');
  assert.strictEqual(extractPlace('Birth, abt 1700, Bergen, Norway'), 'Bergen, Norway');
  assert.strictEqual(extractPlace('誕生, 1870年5月3日, 広島, 日本'), '広島, 日本');
  assert.strictEqual(extractPlace('Óbito, dez. de 1950, Recife, Pernambuco, Brasil'), 'Recife, Pernambuco, Brasil');
  assert.strictEqual(extractPlace('Birth, 1885, '), '');
});

function checkStructure(file, total, rec) {
  const A = analyze(F(file));
  assert.ok(A.ok, A.reason); assert.strictEqual(A.records.length, total); assert.strictEqual(recent(A).length, rec);
  for (const r of A.records) { assert.match(r.id, /^[A-Z0-9]{4}-[A-Z0-9]{2,4}$/); }
  for (const r of recent(A)) assert.ok(extractPlace(r.event), 'place for ' + r.id);
}
const cases = { 'synthetic-en.csv': [3, 2], 'synthetic-es.csv': [3, 2], 'synthetic-pt.csv': [2, 1], 'synthetic-ja.csv': [2, 1],
  'synthetic-ko.csv': [2, 2], 'synthetic-de.csv': [2, 1] };
for (const [f, [total, rec]] of Object.entries(cases)) test('structure: ' + f, () => checkStructure(f, total, rec));
// Optional local export. Not in the repo (privacy). Drop the file in fixtures/ to run this case.
const realName = 'real-cj-en.csv';
const realPath = path.join(__dirname, 'fixtures', realName);
test('structure: ' + realName, {
  skip: fs.existsSync(realPath) ? false : 'optional fixture test/fixtures/real-cj-en.csv is absent'
}, () => checkStructure(realName, 86, 43));
test('rejects non-list CSV', () => assert.ok(!analyze(F('not-a-list.csv')).ok));
