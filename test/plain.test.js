const test = require('node:test');
const assert = require('node:assert');
const { planUpload } = require('../lib/upload');
const { toPublic } = require('../lib/lights');

function csv(place, ordinance) {
  return [
    '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"',
    `"N","ABCD-123","Birth, 1900, ${place}","${ordinance}","15 September 2026","Temple"`,
  ].join('\n');
}

test('a formula prefix and a bidi override never become the place or the ordinance', () => {
  const plan = planUpload(csv('=\tCork\u202E, Ireland', '=Baptism'), {
    now: Date.parse('2026-10-11T00:00:00Z'),
    cache: {},
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.pending.length, 1);
  assert.equal(plan.pending[0].place, 'Cork, Ireland');
  assert.deepEqual(JSON.parse(plan.pending[0].ordinance), ['Baptism']);
});

test('a stored place with a control character is cleaned on the way to the TV', () => {
  const light = toPublic({
    place: 'Cork\u0000, Ireland\u202E',
    lat: 51.9,
    lon: -8.47,
    created: 10,
    ordinance: '=\tBaptism',
  });
  assert.equal(light.place, 'Cork, Ireland');
  assert.deepEqual(light.ordinances, ['Baptism']);
  assert.equal(light.id, undefined);
});

test('an ordinary place and ordinance are unchanged', () => {
  const plan = planUpload(csv('Ogden, Weber, Utah, United States', 'Baptism'), {
    now: Date.parse('2026-10-11T00:00:00Z'),
    cache: { 'Ogden, Weber, Utah, United States': { lat: 41.2, lon: -111.9 } },
  });
  assert.equal(plan.immediate.length, 1);
  assert.equal(plan.immediate[0].place, 'Ogden, Weber, Utah, United States');
  assert.deepEqual(JSON.parse(plan.immediate[0].ordinance), ['Baptism']);
});
