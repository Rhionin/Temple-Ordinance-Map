const CHUNK = 90;

function uniqueQueries(queries) {
  const out = [];
  const seen = new Set();
  for (const query of queries || []) {
    if (typeof query !== 'string' || !query || seen.has(query)) continue;
    seen.add(query);
    out.push(query);
  }
  return out;
}

function chunksOf(items, size = CHUNK) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function loadGeocache(db, queries) {
  const cache = {};
  const unique = uniqueQueries(queries);
  if (!unique.length) return cache;
  const statements = chunksOf(unique).map(chunk => {
    const marks = chunk.map(() => '?').join(',');
    return db.prepare(
      `SELECT query, lat, lon, country FROM geocache WHERE query IN (${marks})`
    ).bind(...chunk);
  });
  const parts = await db.batch(statements);
  for (const part of parts || []) {
    for (const row of (part && part.results) || []) {
      cache[row.query] = row.lat == null || row.lon == null
        ? null
        : { lat: row.lat, lon: row.lon, country: row.country || null };
    }
  }
  return cache;
}

module.exports = { CHUNK, uniqueQueries, chunksOf, loadGeocache };
