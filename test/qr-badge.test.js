const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { CAPTION, QUIET, PAPER, INK, enabled, targetFor, matrix, svg, fitCode } = require('../public/qr-badge');
const { insets, mapSize, padding, clearRect, frameStyle } = require('../public/stage-frame');

function channel(hex, index) {
  const n = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 1) + 0.0722 * channel(hex, 2);
}

function contrast(dark, light) {
  return (luminance(light) + 0.05) / (luminance(dark) + 0.05);
}

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

test('the QR is dark plum on parchment with a quiet zone and finder patterns', () => {
  const href = 'https://temple-ordinance-map.rhionin.com/g/ward-party';
  const drawn = matrix(href);
  assert.equal(drawn.quiet, QUIET);
  assert.equal(drawn.quiet, 4);
  assert.equal(drawn.ecc, 'Q');
  assert.ok(luminance(PAPER) > luminance(INK));
  assert.ok(contrast(INK, PAPER) >= 7);
  assert.equal(finderAt(drawn.rows, 0, 0), true);
  assert.equal(finderAt(drawn.rows, 0, drawn.count - 7), true);
  assert.equal(finderAt(drawn.rows, drawn.count - 7, 0), true);

  const image = svg(href);
  assert.match(image, new RegExp('fill="' + PAPER + '"'));
  assert.match(image, new RegExp('fill="' + INK + '"'));
  assert.ok(image.indexOf('fill="' + INK + '"') > image.indexOf('fill="' + PAPER + '"'));
  assert.doesNotMatch(image, /fill="white"|fill="black"/);
  assert.match(image, /shape-rendering="crispEdges"/);
  assert.doesNotMatch(image, /rx=|stroke-linejoin|round/);
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

test('the badge fits the rail under the totals and the camera keeps its original insets', () => {
  const size = mapSize();
  const clear = clearRect(size.width, size.height);
  assert.equal(clear.left, insets.left);
  assert.equal(clear.top, insets.top);
  assert.equal(clear.right, size.width - insets.right);
  assert.equal(clear.bottom, size.height - insets.bottom);
  assert.deepEqual(padding(), padding({ qr: true }));
  assert.deepEqual(frameStyle(), {
    '--rail': insets.rail + 'px',
    '--map-w': size.width + 'px',
  });
  assert.equal(frameStyle(true)['--attr-right'], undefined);
  assert.equal(frameStyle(true)['--ticker-right'], undefined);

  const chrome = 70;
  const innerWidth = 420;
  const open = fitCode({ statsBottom: 525, cardTop: 991, innerWidth: innerWidth, chrome: chrome });
  assert.equal(open.top, 525 + open.gap);
  assert.ok(open.code >= 160);
  assert.ok(open.code <= innerWidth);
  assert.ok(open.top + chrome + open.code + open.gap <= 991);

  const featured = fitCode({ statsBottom: 587, cardTop: 892, innerWidth: innerWidth, chrome: chrome });
  assert.ok(featured.top > 587);
  assert.ok(featured.code >= 160);
  assert.ok(featured.code <= innerWidth);
  assert.ok(featured.top + chrome + featured.code + featured.gap <= 892);

  const wrapped = fitCode({ statsBottom: 587, cardTop: 817, innerWidth: innerWidth, chrome: chrome });
  assert.ok(wrapped.code > 0);
  assert.ok(wrapped.code < featured.code);
  assert.ok(wrapped.top + chrome + wrapped.code + wrapped.gap <= 817);
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
  assert.match(tv, /StageFrame\.frameStyle\(\)/);
  assert.match(tv, /StageFrame\.padding\(\)/);
  assert.match(tv, /if \(!qrOn\)/);
  assert.match(tv, /function placeQr\(/);
  assert.match(tv, /QrBadge\.fitCode\(/);
  const paint = tv.slice(tv.indexOf('function paintTotals'), tv.indexOf('function mapApi'));
  assert.match(paint, /placeQr\(\)/);
  assert.match(tv, /#qr-badge\[hidden\]\{display:none !important\}/);
  assert.match(tv, /background:#fff4dc/);
  assert.match(tv, /#1c0a12|#fff4dc/);
  assert.match(tv, /border:2px solid #ffc478/);
  assert.match(tv, /border-radius:20px/);
  assert.match(tv, /rgba\(255,154,26,\.55\)/);
  assert.match(tv, /font-family:Georgia,serif/);
  assert.match(tv, /#qr-caption\{[^}]*#4a2410/);
  assert.match(tv, /#qr-url\{[^}]*#6b3a18/);
  assert.match(tv, /padding:14px 32px/);
  assert.doesNotMatch(tv, /--attr-right|--qr-right|--ticker-right|right:calc\(var\(--rail/);
  assert.doesNotMatch(tv, /background:#fff[;}]/);
  const rail = tv.slice(tv.indexOf('<aside id="rail">'), tv.indexOf('<div id="ticker">'));
  assert.ok(rail.indexOf('id="stats"') < rail.indexOf('id="qr-badge"'));
  assert.ok(rail.indexOf('id="qr-badge"') < rail.indexOf('id="card"'));
  assert.match(tv, /function frameOpening/);
  assert.ok(tv.indexOf('frameOpening()') < tv.indexOf('\npoll();'));
  assert.doesNotMatch(tv, /src="https?:/);
  assert.doesNotMatch(tv, /qrserver|chart\.googleapis|quickchart|goqr|cdn\.jsdelivr/);
  assert.doesNotMatch(upload, /qr-badge|id="qr-badge"/);
  const vendor = fs.readFileSync(path.join(root, 'public', 'vendor', 'qrcode.js'), 'utf8');
  assert.match(vendor, /Kazuhiko Arase/);
  assert.match(vendor, /MIT/);
});
