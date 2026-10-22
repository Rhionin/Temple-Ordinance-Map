// The TV stage is 1920x1080. Totals and the place card live in a right rail
// beside the map, so a light cannot sit under them. The title and the
// month line stay on the map. A QR badge sits in the map's bottom-right
// corner. The Natural Earth credit slides left so the badge does not cover
// it. While the badge is showing, the camera insets grow so lights stay
// out of that corner. ?qr=0 drops back to the base insets.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StageFrame = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STAGE_W = 1920;
  const STAGE_H = 1080;
  const insets = {
    rail: 500,
    left: 40,
    top: 120,
    right: 40,
    bottom: 176,
  };
  // The code is 15% of the stage height so it can be scanned from across
  // the room. The box below it holds the caption and the short URL.
  const qrBadge = {
    right: 16,
    bottom: 14,
    width: 280,
    height: 292,
    gap: 28,
    code: 162,
  };
  const world = { south: -56, north: 78, west: -178, east: 178 };

  function mapSize() {
    return { width: STAGE_W - insets.rail, height: STAGE_H };
  }

  function badgeBox() {
    const width = mapSize().width;
    const left = width - qrBadge.right - qrBadge.width;
    const top = STAGE_H - qrBadge.bottom - qrBadge.height;
    return {
      left: left,
      top: top,
      right: left + qrBadge.width,
      bottom: top + qrBadge.height,
      width: qrBadge.width,
      height: qrBadge.height,
      code: qrBadge.code,
    };
  }

  function showing(options) {
    return !options || options.qr !== false;
  }

  function padding(options) {
    const badge = badgeBox();
    const map = mapSize();
    const qr = showing(options);
    const right = qr ? Math.max(insets.right, map.width - badge.left + qrBadge.gap) : insets.right;
    const bottom = qr ? Math.max(insets.bottom, STAGE_H - badge.top + qrBadge.gap) : insets.bottom;
    return {
      topLeft: { x: insets.left, y: insets.top },
      bottomRight: { x: right, y: bottom },
    };
  }

  function clearRect(width, height, options) {
    const pad = padding(options);
    const w = Number(width);
    const h = Number(height);
    return {
      left: pad.topLeft.x,
      top: pad.topLeft.y,
      right: w - pad.bottomRight.x,
      bottom: h - pad.bottomRight.y,
    };
  }

  function frameStyle(qrOn) {
    const badge = badgeBox();
    const show = qrOn !== false;
    return {
      '--rail': insets.rail + 'px',
      '--map-w': mapSize().width + 'px',
      '--qr-right': qrBadge.right + 'px',
      '--qr-b': qrBadge.bottom + 'px',
      '--qr-w': badge.width + 'px',
      '--qr-h': badge.height + 'px',
      '--qr-code': badge.code + 'px',
      '--ticker-right': (show ? qrBadge.right + qrBadge.width + 20 : 32) + 'px',
      // Leaflet's credit sits in the map's bottom-right. Slide it left of the badge.
      '--attr-right': (show ? qrBadge.right + qrBadge.width + 12 : 0) + 'px',
    };
  }

  function around(lat, lon) {
    const latitude = Number(lat);
    const longitude = Number(lon);
    const span = 0.05;
    return {
      south: latitude - span,
      north: latitude + span,
      west: longitude - span,
      east: longitude + span,
    };
  }

  return {
    STAGE_W: STAGE_W,
    STAGE_H: STAGE_H,
    insets: insets,
    qrBadge: qrBadge,
    world: world,
    mapSize: mapSize,
    badgeBox: badgeBox,
    padding: padding,
    clearRect: clearRect,
    frameStyle: frameStyle,
    around: around,
  };
});
