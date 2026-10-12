// ISO 3166-1 alpha-2 for a light. Nominatim's code wins when we just fetched
// one. Otherwise the Natural Earth outlines fill it in, including rows that
// were saved before a country was stored. lib/countries.json is those
// outlines (public/world.geojson) with only a 2-letter code and the rings,
// so the Worker can bundle them. Northern Cyprus and Somaliland have no
// usable code in this file and are skipped.
const OUTLINES = require('./countries.json');

function normalizeCountry(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
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

const FEATURES = OUTLINES.map(feature => ({
  code: feature.code,
  geometry: { type: feature.type, coordinates: feature.coordinates },
  bounds: boundsOf({ coordinates: feature.coordinates }),
}));

function countryAt(lat, lon) {
  const y = Number(lat), x = Number(lon);
  if (!Number.isFinite(y) || !Number.isFinite(x)) return null;
  for (const feature of FEATURES) {
    const box = feature.bounds;
    if (x < box.minLon || x > box.maxLon || y < box.minLat || y > box.maxLat) continue;
    if (geometryHits(x, y, feature.geometry)) return feature.code;
  }
  return null;
}

function countryForLight(light) {
  const given = normalizeCountry(light && light.country);
  if (given) return given;
  return countryAt(light && light.lat, light && light.lon);
}

function fillCountries(lights) {
  const updates = [];
  for (const light of lights) {
    const before = normalizeCountry(light.country);
    const code = countryForLight(light);
    if (!code) continue;
    light.country = code;
    if (code !== before) updates.push({ id: light.person_id || light.id, country: code });
  }
  return updates;
}

module.exports = { normalizeCountry, countryAt, countryForLight, fillCountries };
