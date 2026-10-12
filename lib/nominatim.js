const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=1&q=';

function nominatimUrl(query) {
  return NOMINATIM_SEARCH + encodeURIComponent(query);
}

function countryCode(row) {
  const address = row && row.address;
  const raw = address && address.country_code;
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

function parseNominatimBody(json) {
  const row = Array.isArray(json) ? json[0] : null;
  if (!row) return null;
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const country = countryCode(row);
  return country ? { lat, lon, country } : { lat, lon };
}

module.exports = { NOMINATIM_SEARCH, nominatimUrl, parseNominatimBody };
