// Public map points. Person id stays in storage. Ordinance types are shown.
const { parseOrdinances } = require('./ordinances');
const { normalizeMonth } = require('./month');

function toPublic(row) {
  const created = Number(row.created != null ? row.created : row.added) || 0;
  const updated = Number(row.updated) || created;
  return {
    place: String(row.place),
    lat: Number(row.lat),
    lon: Number(row.lon),
    created,
    updated: Math.max(created, updated),
    ordinances: parseOrdinances(row.ordinances != null ? row.ordinances : row.ordinance),
    month: normalizeMonth(row.month),
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
    .filter(row => Math.max(row.updated || 0, (row.created != null ? row.created : row.added) || 0) > min)
    .map(toPublic)
    .sort((a, b) => a.created - b.created);
}

const PUBLIC_KEYS = ['place', 'lat', 'lon', 'created', 'updated', 'ordinances', 'month'];

module.exports = { toPublic, nextCreated, lightsSince, PUBLIC_KEYS };
