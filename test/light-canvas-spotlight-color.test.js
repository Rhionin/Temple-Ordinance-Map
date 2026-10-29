const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  SPOT_COLOR_EASE_MS,
  spotColorLevel,
  beginSpotColorEase,
  paintSpotlightGlow,
  paintGlow,
  SPRITE,
} = require('../public/light-canvas');

test('spotlight color eases in over SPOT_COLOR_EASE_MS and reverts when cleared', () => {
  const state = { active: null };
  beginSpotColorEase(state, 1, 0);
  assert.equal(spotColorLevel(0, state.active), 0);
  assert.ok(spotColorLevel(SPOT_COLOR_EASE_MS / 2, state.active) > 0.4);
  assert.equal(spotColorLevel(SPOT_COLOR_EASE_MS, state.active), 1);
  beginSpotColorEase(state, 0, 1000);
  assert.equal(spotColorLevel(1000, state.active), 1);
  assert.equal(spotColorLevel(1000 + SPOT_COLOR_EASE_MS, state.active), 0);
});

test('spotlight sprites are baked once and the featured light draws last', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'light-canvas.js'), 'utf8');
  assert.match(src, /paintSpotlightGlow/);
  assert.match(src, /sprites\.spotlight/);
  assert.match(src, /spotlightPass/);
  assert.match(src, /if \(featured && spotlightDim && bloomKey\)/);
  assert.match(src, /makeSprites[\s\S]*paintSpotlightGlow/);
});

test('setSpotlight resets candle cross-fade from marigold on each new key', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'light-canvas.js'), 'utf8');
  assert.match(src, /spotColorState\.active = \{ from: 0, to: 1, at: now \}/);
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.match(tv, /lightCanvas\.setSpotlight/);
});

test('spotlight glow palette differs from marigold bloom stops', () => {
  assert.match(paintSpotlightGlow.toString(), /e85d62|ff9a82/i);
  assert.match(paintGlow.toString(), /ff8a00|ffcf4d/);
  assert.equal(SPOT_COLOR_EASE_MS, 400);
  assert.equal(SPRITE, 96);
});
