// D1 access for lights, the place cache, and the geocode queue.
// Stored columns: person id, place, lat/lon, ordinance, created. Never a name.

export function d1Store(db) {
  return {
    async ids() {
      const lights = await db.prepare('SELECT person_id FROM lights').all();
      const jobs = await db.prepare("SELECT person_id FROM jobs WHERE status = 'pending'").all();
      return [...(lights.results || []), ...(jobs.results || [])].map(row => row.person_id);
    },
    async maxCreated() {
      const row = await db.prepare(
        'SELECT MAX(created) AS created FROM (SELECT created FROM lights UNION ALL SELECT created FROM jobs)'
      ).first();
      return row && row.created ? row.created : 0;
    },
    async cacheFor(queries) {
      const cache = {};
      if (!queries.length) return cache;
      const marks = queries.map(() => '?').join(',');
      const rows = await db.prepare(`SELECT query, lat, lon FROM geocache WHERE query IN (${marks})`).bind(...queries).all();
      for (const row of rows.results || []) {
        cache[row.query] = row.lat == null || row.lon == null ? null : { lat: row.lat, lon: row.lon };
      }
      return cache;
    },
    async listLights(since) {
      const rows = await db.prepare(
        'SELECT place, lat, lon, created FROM lights WHERE created > ? ORDER BY created'
      ).bind(Number(since) || 0).all();
      return rows.results || [];
    },
    async insertLight(light) {
      const result = await db.prepare(
        `INSERT INTO lights (person_id, place, lat, lon, ordinance, created)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(person_id) DO NOTHING`
      ).bind(light.id, light.place, light.lat, light.lon, light.ordinance || '', light.created).run();
      return result.meta.changes > 0;
    },
    async insertJob(job) {
      const result = await db.prepare(
        `INSERT INTO jobs (person_id, place, ordinance, created, cursor_idx, status)
         VALUES (?, ?, ?, ?, ?, 'pending')
         ON CONFLICT(person_id) DO UPDATE SET
           place = excluded.place,
           ordinance = excluded.ordinance,
           created = excluded.created,
           cursor_idx = excluded.cursor_idx,
           status = 'pending'
         WHERE jobs.status = 'failed'`
      ).bind(job.id, job.place, job.ordinance || '', job.created, job.cursor || 0).run();
      return result.meta.changes > 0;
    },
    async clearLights() {
      await db.batch([
        db.prepare('DELETE FROM lights'),
        db.prepare('DELETE FROM jobs'),
      ]);
    },
  };
}
