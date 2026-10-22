const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { CAPTION, QUIET, enabled, targetFor, matrix, svg } = require('../public/qr-badge');
const { STAGE_H, insets, qrBadge, mapSize, badgeBox, padding, clearRect, frameStyle } = require('../public/stage-frame');

const FINDER = [
  '1111111',
  '1000001',
  '1011101',
  '1011101',
  '1011101',
  '1000001',
  '1111111',
];

function finderAt(rows, row, col) {
  for (let r = 0; r < 7; r += 1) {
    if (rows[row + r].slice(col, col + 7) !== FINDER[r]) return false;
  }
  return true;
}

function painted(svgText) {
  const cells = [];
  const re = /M(\d+),(\d+)l1,0 0,1 -1,0 0,-1z/g;
  let match = re.exec(svgText);
  while (match) {
    cells.push([Number(match[2]), Number(match[1])]);
    match = re.exec(svgText);
  }
  return cells;
}

test('group maps link to that share page and the master map links to /new', () => {
  const master = targetFor({
    origin: 'https://temple-ordinance-map.rhionin.com',
    host: 'temple-ordinance-map.rhionin.com',
    pathname: '/',
    search: '?mode=timeline',
  });
  assert.equal(master.href, 'https://temple-ordinance-map.rhionin.com/new');
  assert.equal(master.label, 'temple-ordinance-map.rhionin.com/new');
  assert.equal(master.caption, 'Add your ancestors');
  assert.equal(master.caption, CAPTION);

  const group = targetFor({
    origin: 'https://temple-ordinance-map.rhionin.com',
    host: 'temple-ordinance-map.rhionin.com',
    pathname: '/g/ward-party/map',
  });
  assert.equal(group.href, 'https://temple-ordinance-map.rhionin.com/g/ward-party');
  assert.equal(group.label, 'temple-ordinance-map.rhionin.com/g/ward-party');
  assert.equal(group.href.includes('/map'), false);

  const slash = targetFor({
    origin: 'http://127.0.0.1:3000',
    host: '127.0.0.1:3000',
    pathname: '/g/friends/map/',
  });
  assert.equal(slash.href, 'http://127.0.0.1:3000/g/friends');
  assert.equal(slash.label, '127.0.0.1:3000/g/friends');

  const encoded = targetFor({
    origin: 'https://example.com',
    pathname: '/g/ward%2Dparty/map',
  });
  assert.equal(encoded.href, 'https://example.com/g/ward-party');
  assert.equal(encoded.label, 'example.com/g/ward-party');
});

test('?qr=0 hides the badge and any other value leaves it up', () => {
  assert.equal(enabled(''), true);
  assert.equal(enabled('?mode=spotlight'), true);
  assert.equal(enabled('?qr=1'), true);
  assert.equal(enabled('?qr=off'), true);
  assert.equal(enabled('?qr=0'), false);
  assert.equal(enabled('?mode=timeline&qr=0'), false);
  assert.equal(enabled('qr=0'), false);
});

test('the QR is black on white with a quiet zone and finder patterns', () => {
  const href = 'https://temple-ordinance-map.rhionin.com/g/ward-party';
  const drawn = matrix(href);
  assert.equal(drawn.quiet, QUIET);
  assert.equal(drawn.ecc, 'Q');
  assert.equal(finderAt(drawn.rows, 0, 0), true);
  assert.equal(finderAt(drawn.rows, 0, drawn.count - 7), true);
  assert.equal(finderAt(drawn.rows, drawn.count - 7, 0), true);

  const image = svg(href);
  assert.match(image, /fill="white"/);
  assert.match(image, /fill="black"/);
  assert.match(image, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(image, /<script|https?:\/\/api\.|qrserver|chart\.googleapis/);
  const viewBox = image.match(/viewBox="0 0 (\d+) (\d+)"/);
  assert.ok(viewBox);
  const side = Number(viewBox[1]);
  assert.equal(side, drawn.count + QUIET * 2);
  assert.equal(viewBox[2], viewBox[1]);

  const cells = painted(image);
  const dark = [];
  for (let row = 0; row < drawn.count; row += 1) {
    for (let col = 0; col < drawn.count; col += 1) {
      if (drawn.rows[row][col] === '1') dark.push(row + ',' + col);
    }
  }
  const got = cells.map(cell => (cell[0] - QUIET) + ',' + (cell[1] - QUIET));
  assert.deepEqual(got.sort(), dark.sort());
  for (const cell of cells) {
    assert.ok(cell[0] >= QUIET && cell[1] >= QUIET);
    assert.ok(cell[0] < side - QUIET && cell[1] < side - QUIET);
  }

  const tricky = svg('https://example.com/new?a=1&b=<2>');
  assert.match(tricky, /&amp;/);
  assert.match(tricky, /&lt;/);
  assert.doesNotMatch(tricky, /b=<2>/);
});

test('the badge reserves the map corner the way the rail keeps the totals clear', () => {
  const ratio = qrBadge.code / STAGE_H;
  assert.ok(ratio >= 0.12 && ratio <= 0.15 + 1e-9);
  const size = mapSize();
  const badge = badgeBox();
  const clear = clearRect(size.width, size.height);
  assert.equal(padding().bottomRight.x > insets.right, true);
  assert.ok(badge.right <= size.width);
  assert.ok(badge.left >= clear.right + qrBadge.gap);
  assert.ok(badge.top >= clear.bottom + qrBadge.gap);
  assert.ok(badge.bottom <= size.height);
  assert.ok(clear.right - clear.left > 1000);
  assert.ok(clear.bottom - clear.top > 600);

  const totals = { left: size.width + 28, top: 72, right: 1920 - 24, bottom: 900 };
  assert.ok(badge.right <= totals.left);
  assert.ok(badge.top > totals.top);

  const hidden = clearRect(size.width, size.height, { qr: false });
  assert.equal(hidden.left, insets.left);
  assert.equal(hidden.top, insets.top);
  assert.equal(hidden.right, size.width - insets.right);
  assert.equal(hidden.bottom, size.height - insets.bottom);

  const style = frameStyle(true);
  assert.equal(style['--qr-code'], qrBadge.code + 'px');
  assert.equal(style['--qr-w'], badge.width + 'px');
  assert.equal(style['--qr-h'], badge.height + 'px');
  assert.ok(Number.parseFloat(style['--ticker-right']) >= qrBadge.width);
  assert.equal(frameStyle(false)['--ticker-right'], '32px');
  assert.equal(style['--attr-right'], (qrBadge.right + qrBadge.width + 12) + 'px');
  assert.equal(frameStyle(false)['--attr-right'], '0px');
});

test('the TV page draws the badge inside the stage and ?qr=0 removes it', () => {
  const root = path.join(__dirname, '..');
  const tv = fs.readFileSync(path.join(root, 'public', 'tv.html'), 'utf8');
  const upload = fs.readFileSync(path.join(root, 'public', 'upload.html'), 'utf8');
  assert.match(tv, /vendor\/qrcode\.js/);
  assert.match(tv, /qr-badge\.js/);
  assert.match(tv, /id="qr-badge"/);
  assert.match(tv, /id="qr-caption"/);
  assert.match(tv, /Add your ancestors/);
  assert.match(tv, /id="qr-url"/);
  assert.match(tv, /QrBadge\.enabled\(location\.search\)/);
  assert.match(tv, /QrBadge\.targetFor\(location\)/);
  assert.match(tv, /QrBadge\.svg\(target\.href\)/);
  assert.match(tv, /StageFrame\.frameStyle\(qrOn\)/);
  assert.match(tv, /padding\(\{ qr: qrOn \}\)/);
  assert.match(tv, /if \(!qrOn\)/);
  assert.match(tv, /#qr-badge\[hidden\]\{display:none !important\}/);
  assert.match(tv, /background:#fff/);
  assert.match(tv, /leaflet-bottom\.leaflet-right\{right:var\(--attr-right,0px\)\}/);
  assert.match(tv, /function frameOpening/);
  assert.ok(tv.indexOf('frameOpening()') < tv.indexOf('\npoll();'));
  assert.doesNotMatch(tv, /src="https?:/);
  assert.doesNotMatch(tv, /qrserver|chart\.googleapis|quickchart|goqr|cdn\.jsdelivr/);
  assert.doesNotMatch(upload, /qr-badge|id="qr-badge"/);
  const vendor = fs.readFileSync(path.join(root, 'public', 'vendor', 'qrcode.js'), 'utf8');
  assert.match(vendor, /Kazuhiko Arase/);
  assert.match(vendor, /MIT/);
});
