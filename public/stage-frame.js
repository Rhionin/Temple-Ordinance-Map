// The TV stage is 1920x1080. Totals, the QR badge, and the place card live
// in a right rail beside the map, so a light cannot sit under them. The
// title and the month line stay on the map. The badge used to sit in the
// map's bottom-right corner and the camera grew to clear it; it is in the
// rail now, so the insets stay at the original bands.
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
  const world = { south: -56, north: 78, west: -178, east: 178 };

  function mapSize() {
    return { width: STAGE_W - insets.rail, height: STAGE_H };
  }

  function padding() {
    return {
      topLeft: { x: insets.left, y: insets.top },
      bottomRight: { x: insets.right, y: insets.bottom },
    };
  }

  function clearRect(width, height) {
    const pad = padding();
    const w = Number(width);
    const h = Number(height);
    return {
      left: pad.topLeft.x,
      top: pad.topLeft.y,
      right: w - pad.bottomRight.x,
      bottom: h - pad.bottomRight.y,
    };
  }

  function frameStyle() {
    return {
      '--rail': insets.rail + 'px',
      '--map-w': mapSize().width + 'px',
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
    world: world,
    mapSize: mapSize,
    padding: padding,
    clearRect: clearRect,
    frameStyle: frameStyle,
    around: around,
  };
});
