const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cover, spanBox, zoomOutOnly, ancestorLabel } = require('../public/timeline-camera');

test('timeline bounds only grow and the zoom only goes out', () => {
  const first = cover(null, [{ lat: 51.9, lon: -8.47 }]);
  assert.equal(first.grew, true);
  assert.equal(first.box.south, 51.9);
  const inside = cover(first.box, [{ lat: 51.9, lon: -8.47 }, { lat: 'nope', lon: 1 }]);
  assert.equal(inside.grew, false);
  assert.deepEqual(inside.box, first.box);
  const wider = cover(first.box, [{ lat: 60.17, lon: 24.94 }]);
  assert.equal(wider.grew, true);
  assert.ok(wider.box.north > first.box.north);
  assert.ok(wider.box.east > first.box.east);
  assert.ok(wider.box.south <= first.box.south);
  assert.ok(wider.box.west <= first.box.west);
  const again = cover(wider.box, [{ lat: 51.9, lon: -8.47 }]);
  assert.equal(again.grew, false);
  assert.deepEqual(again.box, wider.box);
  assert.equal(zoomOutOnly(4.2, 8), 4.2);
  assert.equal(zoomOutOnly(4.2, 2.8), 2.8);
  assert.equal(zoomOutOnly(undefined, 4.2), 4.2);
  const view = spanBox({ south: 10, north: 10, west: 20, east: 20 }, 2);
  assert.equal(view.north - view.south, 2);
  assert.equal(view.east - view.west, 2);
});

test('the ancestor headline names the year only on the final view', () => {
  assert.equal(ancestorLabel(0, false), 'ancestors');
  assert.equal(ancestorLabel(1, false), 'ancestor');
  assert.equal(ancestorLabel(35, false), 'ancestors');
  assert.equal(ancestorLabel(1, true), 'ancestor this year');
  assert.equal(ancestorLabel(35, true), 'ancestors this year');
});

test('the timeline page expands the camera and still flies in spotlight', () => {
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.match(tv, /timeline-camera\.js/);
  assert.match(tv, /expandTimelineCamera/);
  assert.match(tv, /frameFirstLights/);
  assert.match(tv, /timelineWide = true/);
  assert.doesNotMatch(tv, /ancestorLabel/);
  assert.doesNotMatch(tv, /id="count"/);
  assert.doesNotMatch(tv, /focusLights/);
  assert.match(tv, /flyToBounds\(lightBounds\(focusOf\(step\.light\)\)/);
  assert.match(tv, /maxZoom: SPOT_ZOOM/);
  assert.match(tv, /zoomOutOnly/);
  assert.match(tv, /paintCountriesDuringMove/);
  assert.match(tv, /showCard\(entry\.light/);
  const reveal = tv.slice(tv.indexOf('function revealLight'), tv.indexOf('function revealMissed'));
  assert.match(reveal, /showCard/);
  assert.match(reveal, /expandTimelineCamera/);
});
