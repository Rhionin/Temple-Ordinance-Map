// D1 access for lights, the place cache, and the geocode queue.
// Stored columns: person id, place, lat/lon, ordinance list, created, updated.
// Never a name. created stays put when ordinances are merged; updated moves.

import { serializeOrdinances } from '../lib/ordinances.js';
import { countryForLight, fillCountries } from '../lib/country.js';
import { tally } from '../lib/stats.js';
import { RECENT_MS } from '../lib/quota.js';
import { resolveMonth } from '../lib/month.js';

export function d1Store(db) {
  return {
    async ids() {
      const lights = await db.prepare('SELECT person_id FROM lights').all();
      const jobs = await db.prepare("SELECT person_id FROM jobs WHERE status = 'pending'").all();
      return [...(lights.results || []), ...(jobs.results || [])].map(row => row.person_id);
    },
    async known() {
      const lights = await db.prepare('SELECT person_id, ordinance, month, completed FROM lights').all();
      const jobs = await db.prepare("SELECT person_id, ordinance, month, completed FROM jobs WHERE status = 'pending'").all();
      return [...(lights.results || []), ...(jobs.results || [])].map(row => ({
        id: row.person_id,
        ordinance: row.ordinance,
        month: resolveMonth(row.month, row.completed),
        completed: row.completed,
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
      const rows = await db.prepare(`SELECT query, lat, lon, country FROM geocache WHERE query IN (${marks})`).bind(...queries).all();
      for (const row of rows.results || []) {
        cache[row.query] = row.lat == null || row.lon == null ? null : { lat: row.lat, lon: row.lon, country: row.country || null };
      }
      return cache;
    },
    async listLights(since) {
      const min = Number(since) || 0;
      const rows = await db.prepare(
        `SELECT place, lat, lon, ordinance, created, updated, month, completed
         FROM lights
         WHERE created > ? OR updated > ?
         ORDER BY created`
      ).bind(min, min).all();
      return rows.results || [];
    },
    async insertLight(light) {
      const country = countryForLight(light);
      const result = await db.prepare(
        `INSERT INTO lights (person_id, place, lat, lon, ordinance, created, updated, month, country, completed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(person_id) DO NOTHING`
      ).bind(
        light.id, light.place, light.lat, light.lon, light.ordinance || '',
        light.created, light.updated || light.created, light.month || null, country, light.completed || null
      ).run();
      return result.meta.changes > 0;
    },
    async mergeOrdinances(merge) {
      const ordinance = serializeOrdinances(merge.ordinance);
      const month = merge.month || null;
      const completed = merge.completed || null;
      const light = await db.prepare(
        'UPDATE lights SET ordinance = ?, updated = ?, month = COALESCE(?, month), completed = COALESCE(?, completed) WHERE person_id = ?'
      ).bind(ordinance, merge.updated, month, completed, merge.id).run();
      if (light.meta.changes > 0) return true;
      const job = await db.prepare(
        "UPDATE jobs SET ordinance = ?, month = COALESCE(?, month), completed = COALESCE(?, completed) WHERE person_id = ? AND status = 'pending'"
      ).bind(ordinance, month, completed, merge.id).run();
      return job.meta.changes > 0;
    },
    async setMonth(update) {
      const month = update.month || null;
      if (!month) return false;
      const completed = update.completed || null;
      const light = await db.prepare(
        'UPDATE lights SET month = ?, completed = COALESCE(?, completed), updated = ? WHERE person_id = ? AND (month IS NULL OR month > ?)'
      ).bind(month, completed, update.updated, update.id, month).run();
      if (light.meta.changes > 0) return true;
      const job = await db.prepare(
        "UPDATE jobs SET month = ?, completed = COALESCE(?, completed) WHERE person_id = ? AND status = 'pending' AND (month IS NULL OR month > ?)"
      ).bind(month, completed, update.id, month).run();
      return job.meta.changes > 0;
    },
    async insertJob(job) {
      const result = await db.prepare(
        `INSERT INTO jobs (person_id, place, ordinance, created, cursor_idx, status, month, completed)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(person_id) DO UPDATE SET
           place = excluded.place,
           ordinance = excluded.ordinance,
           created = excluded.created,
           cursor_idx = excluded.cursor_idx,
           status = 'pending',
           month = excluded.month,
           completed = excluded.completed
         WHERE jobs.status = 'failed'`
      ).bind(job.id, job.place, job.ordinance || '', job.created, job.cursor || 0, job.month || null, job.completed || null).run();
      return result.meta.changes > 0;
    },
    async pendingCount() {
      const row = await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending'").first();
      return Number(row && row.n) || 0;
    },
    async recentCount(now = Date.now()) {
      const since = now - RECENT_MS;
      const row = await db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM lights WHERE created > ?) +
           (SELECT COUNT(*) FROM jobs WHERE status = 'pending' AND created > ?) AS n`
      ).bind(since, since).first();
      return Number(row && row.n) || 0;
    },
    async clearLights() {
      await db.batch([
        db.prepare('DELETE FROM lights'),
        db.prepare('DELETE FROM jobs'),
        db.prepare('DELETE FROM sharers'),
      ]);
    },
    async noteSharer(hash) {
      if (!hash) return;
      await db.prepare('INSERT OR IGNORE INTO sharers (id_hash, created) VALUES (?, ?)').bind(hash, Date.now()).run();
    },
    async stats() {
      const rows = await db.prepare('SELECT person_id, lat, lon, ordinance, country FROM lights').all();
      const lights = rows.results || [];
      for (const update of fillCountries(lights)) {
        await db.prepare('UPDATE lights SET country = ? WHERE person_id = ?').bind(update.country, update.id).run();
      }
      const sharers = await db.prepare('SELECT COUNT(*) AS n FROM sharers').first();
      return { ...tally(lights), sharers: sharers && sharers.n ? sharers.n : 0 };
    },
  };
}
