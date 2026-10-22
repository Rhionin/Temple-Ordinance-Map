const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { insets, world, mapSize, padding, clearRect, around } = require('../public/stage-frame');

test('the open map is the stage minus the rail and the overlay bands', () => {
  const size = mapSize();
  assert.equal(size.width, 1920 - insets.rail);
  assert.equal(size.height, 1080);
  assert.ok(size.width > 1200);
  const clear = clearRect(size.width, size.height, { qr: false });
  assert.equal(clear.left, insets.left);
  assert.equal(clear.top, insets.top);
  assert.equal(clear.right, size.width - insets.right);
  assert.equal(clear.bottom, size.height - insets.bottom);
  assert.ok(clear.right - clear.left > 1000);
  assert.ok(clear.bottom - clear.top > 600);
  const pad = padding({ qr: false });
  assert.deepEqual(pad.topLeft, { x: insets.left, y: insets.top });
  assert.deepEqual(pad.bottomRight, { x: insets.right, y: insets.bottom });
  const box = around(60.17, 24.94);
  assert.ok(box.north > 60.17 && box.south < 60.17);
  assert.ok(box.east > 24.94 && box.west < 24.94);
  assert.ok(world.north > world.south);
  assert.ok(world.east > world.west);
});

test('the TV rail and the camera insets stay on the same numbers', () => {
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.match(tv, /stage-frame\.js/);
  assert.match(tv, new RegExp('--rail,' + insets.rail + 'px'));
  assert.match(tv, new RegExp('--map-w,' + mapSize().width + 'px'));
  assert.match(tv, /id="rail"/);
  assert.match(tv, /paddingTopLeft: padPoint\('topLeft'\)/);
  assert.match(tv, /paddingBottomRight: padPoint\('bottomRight'\)/);
  assert.match(tv, /flyToBounds\(lightBounds\(focusOf\(step\.light\)\)/);
  assert.match(tv, /maxZoom: SPOT_ZOOM/);
  assert.match(tv, /worldCamera\(WORLD\.zoom\)/);
  assert.match(tv, /id="stat-sharers-row" hidden/);
  assert.match(tv, /#stat-sharers-row\[hidden\]\{display:none !important\}/);
  assert.match(tv, /sharersRow\.hidden = !yearView\(\)/);
  assert.match(tv, /people shared/);
  const upload = fs.readFileSync(path.join(__dirname, '..', 'public', 'upload.html'), 'utf8');
  assert.doesNotMatch(upload, /stage-frame|id="rail"/);
});
