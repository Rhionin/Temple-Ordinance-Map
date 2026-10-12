// The TV stage is 1920x1080. Totals and the place card live in a right rail
// beside the map, so a light cannot sit under them. The headline and the
// month line stay on the map. Every camera view uses the same insets, so
// the open rectangle does not move when a row or a card appears.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StageFrame = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const STAGE_W = 1920;
  const STAGE_H = 1080;
  const insets = {
    rail: 500,
    left: 40,
    top: 188,
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

  return { STAGE_W, STAGE_H, insets, world, mapSize, padding, clearRect, around };
});
