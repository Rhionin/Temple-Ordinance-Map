// D1 access for lights, the place cache, and the geocode queue.
// Stored columns: person id, place, lat/lon, ordinance list, created, updated.
// Never a name. created stays put when ordinances are merged; updated moves.

import { serializeOrdinances } from '../lib/ordinances.js';

export function d1Store(db) {
  return {
    async ids() {
      const lights = await db.prepare('SELECT person_id FROM lights').all();
      const jobs = await db.prepare("SELECT person_id FROM jobs WHERE status = 'pending'").all();
      return [...(lights.results || []), ...(jobs.results || [])].map(row => row.person_id);
    },
    async known() {
      const lights = await db.prepare('SELECT person_id, ordinance, month FROM lights').all();
      const jobs = await db.prepare("SELECT person_id, ordinance, month FROM jobs WHERE status = 'pending'").all();
      return [...(lights.results || []), ...(jobs.results || [])].map(row => ({
        id: row.person_id,
        ordinance: row.ordinance,
        month: row.month,
      }));
    },
    async maxCreated() {
      const row = await db.prepare(
        `SELECT MAX(stamp) AS created FROM (
           SELECT created AS stamp FROM lights
           UNION ALL SELECT updated AS stamp FROM lights
           UNION ALL SELECT created AS stamp FROM jobs
         )`
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
      const min = Number(since) || 0;
      const rows = await db.prepare(
        `SELECT place, lat, lon, ordinance, created, updated, month
         FROM lights
         WHERE created > ? OR updated > ?
         ORDER BY created`
      ).bind(min, min).all();
      return rows.results || [];
    },
    async insertLight(light) {
      const result = await db.prepare(
        `INSERT INTO lights (person_id, place, lat, lon, ordinance, created, updated, month)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(person_id) DO NOTHING`
      ).bind(
        light.id, light.place, light.lat, light.lon, light.ordinance || '',
        light.created, light.updated || light.created, light.month || null
      ).run();
      return result.meta.changes > 0;
    },
    async mergeOrdinances(merge) {
      const ordinance = serializeOrdinances(merge.ordinance);
      const month = merge.month || null;
      const light = await db.prepare(
        'UPDATE lights SET ordinance = ?, updated = ?, month = COALESCE(?, month) WHERE person_id = ?'
      ).bind(ordinance, merge.updated, month, merge.id).run();
      if (light.meta.changes > 0) return true;
      const job = await db.prepare(
        "UPDATE jobs SET ordinance = ?, month = COALESCE(?, month) WHERE person_id = ? AND status = 'pending'"
      ).bind(ordinance, month, merge.id).run();
      return job.meta.changes > 0;
    },
    async setMonth(update) {
      const month = update.month || null;
      if (!month) return false;
      const light = await db.prepare(
        'UPDATE lights SET month = ?, updated = ? WHERE person_id = ? AND (month IS NULL OR month > ?)'
      ).bind(month, update.updated, update.id, month).run();
      if (light.meta.changes > 0) return true;
      const job = await db.prepare(
        "UPDATE jobs SET month = ? WHERE person_id = ? AND status = 'pending' AND (month IS NULL OR month > ?)"
      ).bind(month, update.id, month).run();
      return job.meta.changes > 0;
    },
    async insertJob(job) {
      const result = await db.prepare(
        `INSERT INTO jobs (person_id, place, ordinance, created, cursor_idx, status, month)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(person_id) DO UPDATE SET
           place = excluded.place,
           ordinance = excluded.ordinance,
           created = excluded.created,
           cursor_idx = excluded.cursor_idx,
           status = 'pending',
           month = excluded.month
         WHERE jobs.status = 'failed'`
      ).bind(job.id, job.place, job.ordinance || '', job.created, job.cursor || 0, job.month || null).run();
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
