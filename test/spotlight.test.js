const test = require('node:test'), assert = require('node:assert');
const { createRotation, lightKey, regionCount, captionFor } = require('../public/spotlight');

function light(place, lat, created, ordinances) {
  return { place, lat, lon: lat + 10, created, ordinances };
}

test('an empty map stays idle and a single light alternates with the world', () => {
  const empty = createRotation({ rng: () => 0 });
  assert.equal(empty.next().type, 'idle');
  assert.equal(empty.next().type, 'idle');

  const one = createRotation({ every: 4, rng: () => 0 });
  one.seed([light('Cork, Ireland', 51.9, 1, ['Endowment'])]);
  assert.equal(one.next().type, 'light');
  assert.equal(one.next().type, 'world');
  assert.equal(one.next().type, 'light');
  assert.equal(one.next().type, 'world');
  assert.equal(one.all().length, 1);
});

test('new arrivals play before a shuffle, with no repeat until each light is shown', () => {
  const rotation = createRotation({ every: 2, rng: () => 0 });
  rotation.seed([
    light('Ogden, Weber, Utah, United States', 41.2, 1, ['Baptism']),
    light('Cork, Ireland', 51.9, 2, ['Endowment']),
    light('Bergen, Norway', 60.4, 3, ['Sealing']),
  ]);
  rotation.arrive(light('Mérida, Mexico', 20.9, 4, ['Bautismo']));
  const steps = [];
  for (let i = 0; i < 6; i++) {
    const step = rotation.next();
    steps.push(step.type === 'light' ? step.light.place : step.type);
  }
  assert.equal(steps[0], 'Mérida, Mexico');
  assert.equal(steps[2], 'world');
  assert.equal(steps[5], 'world');
  const places = steps.filter(step => step !== 'world');
  assert.equal(new Set(places).size, 4);
  assert.deepEqual(places.slice().sort(), [
    'Bergen, Norway',
    'Cork, Ireland',
    'Mérida, Mexico',
    'Ogden, Weber, Utah, United States',
  ]);
});

test('an ordinance update refreshes the same light and does not add another', () => {
  const rotation = createRotation({ rng: () => 0 });
  const first = light('Cork, Ireland', 51.9, 7, ['Baptism']);
  rotation.seed([first]);
  const updated = { ...first, updated: 99, ordinances: ['Endowment'] };
  assert.equal(lightKey(first), lightKey(updated));
  const result = rotation.arrive(updated);
  assert.equal(result.isNew, false);
  assert.equal(rotation.all().length, 1);
  assert.deepEqual(rotation.get(first).ordinances, ['Baptism', 'Endowment']);
  const caption = captionFor(rotation.get(first), rotation.all());
  assert.equal(caption.place, 'Cork, Ireland');
  assert.equal(caption.ordinancesText, 'Baptism · Endowment');
  assert.equal(caption.regionText, '1 light in Ireland');
  assert.equal(regionCount(rotation.all(), 'Dublin, Ireland'), 1);
});

test('the world view returns on schedule and the cycle repeats without getting stuck', () => {
  const rotation = createRotation({ every: 2, rng: () => 0.99 });
  rotation.seed([
    light('A, United States', 1, 1, ['Baptism']),
    light('B, Ireland', 2, 2, ['Endowment']),
  ]);
  const kinds = [];
  for (let i = 0; i < 8; i++) kinds.push(rotation.next().type);
  assert.deepEqual(kinds, ['light', 'light', 'world', 'light', 'light', 'world', 'light', 'light']);
});
