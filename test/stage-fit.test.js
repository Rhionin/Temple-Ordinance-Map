const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fit, containerPoint } = require('../public/stage-fit');

function placed(width, height) {
  const portrait = height >= width;
  const box = fit(width, height, portrait);
  return {
    ...box,
    visualWidth: (portrait ? 1080 : 1920) * box.fit,
    visualHeight: (portrait ? 1920 : 1080) * box.fit,
  };
}

test('a portrait phone turns the landscape stage and the landscape sizes stay put', () => {
  const phone = placed(430, 900);
  assert.equal(phone.turn, '90deg');
  assert.ok(Math.abs(phone.visualWidth - 430) < 0.01);
  assert.ok(phone.visualHeight <= 900);
  assert.ok(phone.visualHeight > 700);

  for (const [width, height] of [[900, 430], [1280, 720], [1920, 1080]]) {
    const box = placed(width, height);
    assert.equal(box.turn, '0deg');
    assert.ok(box.visualWidth <= width + 0.01);
    assert.ok(box.visualHeight <= height + 0.01);
  }
  assert.equal(placed(1920, 1080).fit, 1);
  assert.ok(Math.abs(placed(1280, 720).fit - 720 / 1080) < 1e-9);
  assert.equal(placed(900, 430).fit, placed(430, 900).fit);
  assert.equal(fit(0, 0, false).fit, 1);
});

test('a rotated click lands on the same stage point the finger is over', () => {
  const scale = 430 / 1080;
  const rect = { left: 0, top: (900 - 1920 * scale) / 2, width: 1080 * scale, height: 1920 * scale };
  const center = containerPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, 1920, 1080, '90deg');
  assert.ok(Math.abs(center.x - 960) < 0.01);
  assert.ok(Math.abs(center.y - 540) < 0.01);
  const corner = containerPoint(rect.left, rect.top, rect, 1920, 1080, '90deg');
  assert.ok(Math.abs(corner.x) < 0.01);
  assert.ok(Math.abs(corner.y - 1080) < 0.01);
  const plain = containerPoint(10, 20, { left: 0, top: 0, width: 960, height: 540 }, 1920, 1080, '0deg');
  assert.ok(Math.abs(plain.x - 20) < 0.01);
  assert.ok(Math.abs(plain.y - 40) < 0.01);
});

test('the TV page turns only itself, and the upload page does not', () => {
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  const upload = fs.readFileSync(path.join(__dirname, '..', 'public', 'upload.html'), 'utf8');
  assert.match(tv, /stage-fit\.js/);
  assert.match(tv, /StageFit\.fit\(window\.innerWidth,\s*window\.innerHeight/);
  assert.match(tv, /orientation:\s*portrait/);
  assert.match(tv, /rotate\(var\(--turn/);
  assert.match(tv, /containerPoint/);
  assert.match(tv, /addEventListener\('resize', fitStage\)/);
  assert.match(tv, /addEventListener\('change', fitStage\)/);
  const patchAt = tv.indexOf('L.Draggable.prototype._onDown');
  const mapAt = tv.indexOf("L.map('map'");
  assert.ok(patchAt > 0 && patchAt < mapAt);
  assert.doesNotMatch(upload, /stage-fit|rotate\(var\(--turn/);
});
