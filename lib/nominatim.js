const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=';

function nominatimUrl(query) {
  return NOMINATIM_SEARCH + encodeURIComponent(query);
}

function parseNominatimBody(json) {
  const row = Array.isArray(json) ? json[0] : null;
  if (!row) return null;
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

module.exports = { NOMINATIM_SEARCH, nominatimUrl, parseNominatimBody };
