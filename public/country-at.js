// Country code for a map point, from the Natural Earth outlines already drawn
// on the TV. Northern Cyprus and Somaliland have no usable ISO code here.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CountryAt = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function codeOf(props) {
    const primary = String((props && props.ISO_A2) || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(primary)) return primary;
    const extra = String((props && props.ISO_A2_EH) || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(extra) ? extra : null;
  }

  function boundsOf(geometry) {
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    const walk = coords => {
      if (typeof coords[0] === 'number') {
        const lon = coords[0], lat = coords[1];
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
        return;
      }
      for (const part of coords) walk(part);
    };
    walk(geometry.coordinates);
    return { minLon, minLat, maxLon, maxLat };
  }

  function ringHits(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const crosses = (yi > lat) !== (yj > lat);
      if (crosses && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function geometryHits(lon, lat, geometry) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      let inside = false;
      for (const ring of polygon) if (ringHits(lon, lat, ring)) inside = !inside;
      if (inside) return true;
    }
    return false;
  }

  function fromGeoJSON(collection) {
    const features = [];
    for (const feature of (collection && collection.features) || []) {
      const code = codeOf(feature.properties);
      if (!code || !feature.geometry) continue;
      features.push({
        code,
        geometry: feature.geometry,
        bounds: boundsOf(feature.geometry),
      });
    }
    return function countryAt(lat, lon) {
      const y = Number(lat), x = Number(lon);
      if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
      for (const feature of features) {
        const box = feature.bounds;
        if (x < box.minLon || x > box.maxLon || y < box.minLat || y > box.maxLat) continue;
        if (geometryHits(x, y, feature.geometry)) return feature.code;
      }
      return null;
    };
  }

  return { fromGeoJSON, codeOf };
});
