// Public map points. person id and ordinance type stay in storage only.
function toPublic(row) {
  return {
    place: String(row.place),
    lat: Number(row.lat),
    lon: Number(row.lon),
    created: Number(row.created != null ? row.created : row.added) || 0,
  };
}

function nextCreated(now, last) {
  const n = Number(now) || 0;
  const prev = Number(last) || 0;
  return Math.max(n, prev + 1);
}

function lightsSince(rows, since) {
  const min = Number(since) || 0;
  return rows
    .filter(row => ((row.created != null ? row.created : row.added) || 0) > min)
    .map(toPublic)
    .sort((a, b) => a.created - b.created);
}

const PUBLIC_KEYS = ['place', 'lat', 'lon', 'created'];

module.exports = { toPublic, nextCreated, lightsSince, PUBLIC_KEYS };
