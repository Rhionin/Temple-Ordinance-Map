const test = require('node:test');
const assert = require('node:assert');
const { planUpload } = require('../lib/upload');
const { toPublic } = require('../lib/lights');
const { readLimitedText } = require('../lib/body');
const { repairUtf8 } = require('../lib/plain');

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

test('a joiner inside a place name stays', () => {
  const plan = planUpload(csv('Nam\u200Daste, India', 'Baptism'), {
    now: Date.parse('2026-10-11T00:00:00Z'),
    cache: {},
  });
  assert.equal(plan.pending[0].place, 'Nam\u200Daste, India');
});

test('a Hungarian place keeps its accents through upload and onto the map', async () => {
  const place = 'Nagyrábé, Bihar, Hungary';
  const mojibake = Buffer.from(place, 'utf8').toString('latin1');
  assert.equal(mojibake, 'NagyrÃ¡bÃ©, Bihar, Hungary');
  assert.equal(repairUtf8(mojibake), place);
  assert.equal(repairUtf8(place), place);
  const gyor = 'Győr, Hungary';
  assert.equal(repairUtf8(Buffer.from(gyor, 'utf8').toString('latin1')), gyor);
  const cp1252 = Buffer.from(gyor, 'utf8').map(byte => byte).reduce((out, byte) => {
    const extra = { 0x91: '\u2018' };
    return out + (extra[byte] || String.fromCharCode(byte));
  }, '');
  assert.equal(repairUtf8(cp1252), gyor);
  assert.equal(repairUtf8('Åland, Finland'), 'Åland, Finland');
  assert.equal(repairUtf8('広島, 日本'), '広島, 日本');

  const now = Date.parse('2026-10-11T00:00:00Z');
  const garbled = planUpload(csv(mojibake, 'Baptism'), { now, cache: {} });
  assert.equal(garbled.ok, true);
  assert.equal(garbled.pending[0].place, place);

  const bytes = Buffer.from(csv(place, 'Baptism'), 'utf8');
  const request = new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: bytes,
  });
  const text = await readLimitedText(request, 1_000_000);
  const decoded = planUpload(text, {
    now,
    cache: { 'Nagyrábé, Bihar, Hungary': { lat: 47.2, lon: 21.33 } },
  });
  assert.equal(decoded.immediate[0].place, place);
  assert.equal(decoded.immediate[0].place.includes('Ã'), false);

  const light = toPublic({
    place: mojibake,
    lat: 47.2,
    lon: 21.33,
    created: 10,
    ordinance: 'Baptism',
  });
  assert.equal(light.place, place);
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
