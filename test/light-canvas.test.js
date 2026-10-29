const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  flickerOpacity,
  popScale,
  fadeOpacity,
  displaySize,
  throttle,
  MOVE_PAINT_MS,
  FRAME_MS,
  DISPLAY_NORMAL,
  DISPLAY_BLOOM,
  LIGHTS_PANE,
  LIGHTS_PANE_Z,
  SPOT_OTHER,
} = require('../public/light-canvas');

test('flicker and pop stay in a gentle visible range', () => {
  assert.equal(flickerOpacity(0, 0, true), 1);
  assert.equal(popScale(0, true), 1);
  const samples = [];
  for (let t = 0; t <= 5000; t += 120) samples.push(flickerOpacity(0.7, t, false));
  assert.ok(samples.every(v => v >= 0.7 && v <= 1.05), samples.join(','));
  assert.ok(popScale(0, false) > 1);
  assert.equal(popScale(2000, false), 1);
  assert.equal(displaySize(false, 1, false), DISPLAY_NORMAL);
  assert.ok(displaySize(true, 1, false) <= DISPLAY_BLOOM * 1.08);
  assert.ok(DISPLAY_NORMAL >= 50);
  assert.ok(DISPLAY_BLOOM >= 85);
  assert.equal(SPOT_OTHER, 0.3);
  assert.equal(fadeOpacity(null, 1000, false), 1);
  assert.ok(fadeOpacity(0, 900, false) < 0.5);
  assert.equal(fadeOpacity(0, 2000, false), 0);
});

test('country repaint throttle waits at least MOVE_PAINT_MS between calls', () => {
  let calls = 0;
  const now = { t: 0 };
  const fn = throttle(() => { calls += 1; }, MOVE_PAINT_MS);
  global.performance = { now: () => now.t };
  fn();
  assert.equal(calls, 1);
  now.t += 40;
  fn();
  assert.equal(calls, 1);
  now.t += 70;
  fn();
  assert.equal(calls, 2);
  delete global.performance;
});

test('the TV page draws lights on one canvas layer and throttles country paint', () => {
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.match(tv, /light-canvas\.js/);
  assert.match(tv, /LightCanvas\.createLayer/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'light-canvas.js'), 'utf8'), /L\.Renderer\.extend/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'light-canvas.js'), 'utf8'), /layerDrawPoint/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'light-canvas.js'), 'utf8'), /layerDrawPoint/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'light-canvas.js'), 'utf8'), /L\.DomUtil\.setPosition\(container/);
  assert.match(tv, /LightCanvas\.attachCountryRepaint/);
  assert.match(tv, /leaflet-lightsPane-pane/);
  assert.equal(LIGHTS_PANE, 'lightsPane');
  assert.equal(LIGHTS_PANE_Z, 450);
  assert.doesNotMatch(tv, /L\.divIcon/);
  assert.doesNotMatch(tv, /backdrop-filter/);
  assert.match(tv, /contain:layout paint/);
  assert.match(tv, /entry\.shown/);
  assert.match(tv, /setStatText/);
  assert.match(tv, /monthLabel\.textContent !== event\.label/);
  assert.equal(FRAME_MS > 0, true);
});
