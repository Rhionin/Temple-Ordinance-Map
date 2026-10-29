const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { POP_MS, popMultiplier, flickerOpacity } = require('../public/light-canvas');

test('pop completes once and spotlight timing does not reset bornAt or seed', () => {
  const entry = { bornAt: 500, seed: 0.42, popDone: false };
  const born = entry.bornAt;
  const seed = entry.seed;
  assert.ok(popMultiplier(entry, born + 200, false) > 1);
  assert.equal(entry.popDone, false);
  assert.equal(popMultiplier(entry, born + POP_MS + 10, false), 1);
  assert.equal(entry.popDone, true);
  // simulate spotlight flyTo zoom window later
  assert.equal(popMultiplier(entry, born + 60000, false), 1);
  assert.equal(entry.bornAt, born);
  assert.equal(entry.seed, seed);
  assert.equal(entry.popDone, true);
  const t = born + 60000;
  assert.equal(flickerOpacity(seed, t, false), flickerOpacity(entry.seed, t, false));
});

test('show spotlight handoff keeps canvas entries instead of clearing', () => {
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  const block = tv.match(/function startShowSpotlights\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'startShowSpotlights');
  assert.doesNotMatch(block[1], /clearMarkers\(\)/);
  assert.match(block[1], /clearFade\(\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'light-canvas.js'), 'utf8'), /popDone/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'light-canvas.js'), 'utf8'), /syncCanvasSize/);
});
