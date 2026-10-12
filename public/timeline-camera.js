// Timeline camera rules. The opening frame may sit on the first lights.
// After that the covered area only grows, and the zoom only goes out.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TimelineCamera = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function cover(box, points) {
    let next = box || null;
    let grew = !box;
    for (const point of points || []) {
      const lat = finite(point && point.lat);
      const lon = finite(point && point.lon);
      if (lat == null || lon == null) continue;
      if (!next) {
        next = { south: lat, north: lat, west: lon, east: lon };
        grew = true;
        continue;
      }
      if (lat < next.south || lat > next.north || lon < next.west || lon > next.east) {
        grew = true;
        next = {
          south: Math.min(next.south, lat),
          north: Math.max(next.north, lat),
          west: Math.min(next.west, lon),
          east: Math.max(next.east, lon),
        };
      }
    }
    return { box: next, grew: !!next && grew };
  }

  function spanBox(box, minSpan) {
    const span = Number(minSpan) > 0 ? Number(minSpan) : 1;
    const latSpan = Math.max(box.north - box.south, span);
    const lonSpan = Math.max(box.east - box.west, span);
    const latMid = (box.south + box.north) / 2;
    const lonMid = (box.west + box.east) / 2;
    return {
      south: latMid - latSpan / 2,
      north: latMid + latSpan / 2,
      west: lonMid - lonSpan / 2,
      east: lonMid + lonSpan / 2,
    };
  }

  function zoomOutOnly(currentZoom, targetZoom) {
    const target = finite(targetZoom);
    const current = finite(currentZoom);
    if (target == null) return current;
    if (current == null) return target;
    return Math.min(current, target);
  }

  function ancestorLabel(count, yearView) {
    const noun = Number(count) === 1 ? 'ancestor' : 'ancestors';
    return yearView ? noun + ' this year' : noun;
  }

  return { cover, spanBox, zoomOutOnly, ancestorLabel };
});
