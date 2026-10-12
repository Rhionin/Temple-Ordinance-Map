const test = require('node:test'), assert = require('node:assert');
const { parseOrdinances } = require('../lib/ordinances');
const { toEnglishOrdinance, CANONICAL, untranslatedEmissions } = require('../lib/ordinance-names');
const { toPublic } = require('../lib/lights');
const { planUpload } = require('../lib/upload');

const NOW = Date.parse('2026-10-11T00:00:00Z');

test('ordinance labels become the English FamilySearch names', () => {
  assert.deepEqual(CANONICAL, [
    'Baptism', 'Confirmation', 'Initiatory', 'Endowment', 'Sealing to Parents', 'Sealing to Spouse',
  ]);
  assert.equal(toEnglishOrdinance('Endaumentti'), 'Endowment');
  assert.equal(toEnglishOrdinance('Sinetöiminen vanhempiin'), 'Sealing to Parents');
  assert.equal(toEnglishOrdinance('Bautismo'), 'Baptism');
  assert.equal(toEnglishOrdinance('Investidura'), 'Endowment');
  assert.equal(toEnglishOrdinance('Sellamiento a los padres'), 'Sealing to Parents');
  assert.equal(toEnglishOrdinance('Batismo'), 'Baptism');
  assert.equal(toEnglishOrdinance('Taufe'), 'Baptism');
  assert.equal(toEnglishOrdinance('Siegelung an Eltern'), 'Sealing to Parents');
  assert.equal(toEnglishOrdinance('baptism'), 'Baptism');
  assert.equal(toEnglishOrdinance('Sealed to Spouse'), 'Sealing to Spouse');
  assert.deepEqual(parseOrdinances('["Endaumentti","Sinetöiminen vanhempiin"]'), [
    'Endowment', 'Sealing to Parents',
  ]);
});

test('an unknown ordinance is kept and logged once, and places are not renamed', () => {
  const errors = [];
  const original = console.error;
  console.error = (line) => errors.push(line);
  try {
    assert.equal(toEnglishOrdinance('Zigzag Rite'), 'Zigzag Rite');
    assert.equal(toEnglishOrdinance('Zigzag Rite'), 'Zigzag Rite');
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ordinance_untranslated/);
  assert.match(errors[0], /Zigzag Rite/);
  assert.equal(untranslatedEmissions('Zigzag Rite'), 1);
  assert.doesNotMatch(errors[0], /ABCD-/);

  const text = [
    '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"',
    '"N","ABCD-201","Birth, 1900, Helsinki, Finland","Endaumentti","2 March 2026","Temple"',
    '"N","ABCD-201","Birth, 1900, Helsinki, Finland","Sinetöiminen vanhempiin","15 September 2026","Temple"',
  ].join('\n');
  const plan = planUpload(text, { now: NOW, existingIds: new Set(), cache: {} });
  assert.equal(plan.pending.length, 1);
  assert.equal(plan.pending[0].place, 'Helsinki, Finland');
  assert.deepEqual(JSON.parse(plan.pending[0].ordinance), ['Endowment', 'Sealing to Parents']);

  const shown = toPublic({
    place: 'Helsinki, Finland',
    lat: 60.17,
    lon: 24.94,
    created: 5,
    ordinance: '["Endaumentti"]',
  });
  assert.equal(shown.place, 'Helsinki, Finland');
  assert.deepEqual(shown.ordinances, ['Endowment']);
  assert.equal(shown.id, undefined);
});

test('every locale in the header table has six ordinance labels', () => {
  const headers = require('../headers-by-locale.json');
  const bundles = require('../ordinances-by-locale.json');
  for (const locale of Object.keys(headers)) {
    assert.equal(bundles[locale].length, 6, locale);
  }
  assert.deepEqual(bundles.en, CANONICAL);
  assert.equal(bundles.fi[3], 'Endaumentti');
  assert.equal(bundles.fi[4], 'Sinetöiminen vanhempiin');
});
