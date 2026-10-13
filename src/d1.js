// D1 access for lights, the place cache, and the geocode queue.
// Every light, job, and sharer row belongs to one group.
// Stored columns: group id, person id, place, lat/lon, ordinance list, created, updated.
// Never a name. created stays put when ordinances are merged; updated moves.

import { serializeOrdinances } from '../lib/ordinances.js';
import { countryForLight, fillCountries } from '../lib/country.js';
import { tally } from '../lib/stats.js';
import { RECENT_MS } from '../lib/quota.js';
import { loadGeocache } from '../lib/query-cache.js';
import { resolveMonth } from '../lib/month.js';

export async function ensureParty(db) {
  const read = () => db.prepare("SELECT id FROM groups WHERE slug = 'party'").first();
  const existing = await read();
  if (existing && existing.id) return existing.id;
  try {
    await db.prepare(
      `INSERT INTO groups (slug, title, subtitle, months, admin_token_hash, disabled, deleted, created)
       VALUES ('party', '', '', 12, '', 0, 0, ?)`
    ).bind(Date.now()).run();
  } catch (error) {
    const again = await read();
    if (again && again.id) return again.id;
    throw error;
  }
  const created = await read();
  return created.id;
}

export function d1Store(db, groupId) {
  const group = Number(groupId);
  return {
    async ids() {
      const lights = await db.prepare('SELECT person_id FROM lights WHERE group_id = ?').bind(group).all();
      const jobs = await db.prepare("SELECT person_id FROM jobs WHERE group_id = ? AND status = 'pending'").bind(group).all();
      return [...(lights.results || []), ...(jobs.results || [])].map(row => row.person_id);
    },
    async known() {
      const lights = await db.prepare('SELECT person_id, ordinance, month, completed FROM lights WHERE group_id = ?').bind(group).all();
      const jobs = await db.prepare("SELECT person_id, ordinance, month, completed FROM jobs WHERE group_id = ? AND status = 'pending'").bind(group).all();
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
      return loadGeocache(db, queries);
    },
    async listLights(since) {
      const min = Number(since) || 0;
      const rows = await db.prepare(
        `SELECT person_id, place, lat, lon, ordinance, created, updated, month, completed, country
         FROM lights
         WHERE group_id = ? AND (created > ? OR updated > ?)
         ORDER BY created`
      ).bind(group, min, min).all();
      return rows.results || [];
    },
    async insertLight(light) {
      const country = countryForLight(light);
      const result = await db.prepare(
        `INSERT INTO lights (group_id, person_id, place, lat, lon, ordinance, created, updated, month, country, completed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(group_id, person_id) DO NOTHING`
      ).bind(
        group, light.id, light.place, light.lat, light.lon, light.ordinance || '',
        light.created, light.updated || light.created, light.month || null, country, light.completed || null
      ).run();
      return result.meta.changes > 0;
    },
    async mergeOrdinances(merge) {
      const ordinance = serializeOrdinances(merge.ordinance);
      const month = merge.month || null;
      const completed = merge.completed || null;
      const light = await db.prepare(
        'UPDATE lights SET ordinance = ?, updated = ?, month = COALESCE(?, month), completed = COALESCE(?, completed) WHERE group_id = ? AND person_id = ?'
      ).bind(ordinance, merge.updated, month, completed, group, merge.id).run();
      if (light.meta.changes > 0) return true;
      const job = await db.prepare(
        "UPDATE jobs SET ordinance = ?, month = COALESCE(?, month), completed = COALESCE(?, completed) WHERE group_id = ? AND person_id = ? AND status = 'pending'"
      ).bind(ordinance, month, completed, group, merge.id).run();
      return job.meta.changes > 0;
    },
    async setMonth(update) {
      const month = update.month || null;
      if (!month) return false;
      const completed = update.completed || null;
      const light = await db.prepare(
        'UPDATE lights SET month = ?, completed = COALESCE(?, completed), updated = ? WHERE group_id = ? AND person_id = ? AND (month IS NULL OR month > ?)'
      ).bind(month, completed, update.updated, group, update.id, month).run();
      if (light.meta.changes > 0) return true;
      const job = await db.prepare(
        "UPDATE jobs SET month = ?, completed = COALESCE(?, completed) WHERE group_id = ? AND person_id = ? AND status = 'pending' AND (month IS NULL OR month > ?)"
      ).bind(month, completed, group, update.id, month).run();
      return job.meta.changes > 0;
    },
    async insertJob(job) {
      const result = await db.prepare(
        `INSERT INTO jobs (group_id, person_id, place, ordinance, created, cursor_idx, status, month, completed)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(group_id, person_id) DO UPDATE SET
           place = excluded.place,
           ordinance = excluded.ordinance,
           created = excluded.created,
           cursor_idx = excluded.cursor_idx,
           status = 'pending',
           month = excluded.month,
           completed = excluded.completed
         WHERE jobs.status = 'failed'`
      ).bind(group, job.id, job.place, job.ordinance || '', job.created, job.cursor || 0, job.month || null, job.completed || null).run();
      return result.meta.changes > 0;
    },
    async pendingCount() {
      const row = await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending'").first();
      return Number(row && row.n) || 0;
    },
    async groupPendingCount() {
      const row = await db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE group_id = ? AND status = 'pending'").bind(group).first();
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
        db.prepare('DELETE FROM lights WHERE group_id = ?').bind(group),
        db.prepare('DELETE FROM jobs WHERE group_id = ?').bind(group),
        db.prepare('DELETE FROM sharers WHERE group_id = ?').bind(group),
      ]);
    },
    async noteSharer(hash) {
      if (!hash) return;
      await db.prepare('INSERT OR IGNORE INTO sharers (group_id, id_hash, created) VALUES (?, ?, ?)').bind(group, hash, Date.now()).run();
    },
    async stats() {
      const rows = await db.prepare('SELECT person_id, lat, lon, ordinance, country FROM lights WHERE group_id = ?').bind(group).all();
      const lights = rows.results || [];
      for (const update of fillCountries(lights)) {
        await db.prepare('UPDATE lights SET country = ? WHERE group_id = ? AND person_id = ?').bind(update.country, group, update.id).run();
      }
      const sharers = await db.prepare('SELECT COUNT(*) AS n FROM sharers WHERE group_id = ?').bind(group).first();
      return { ...tally(lights), sharers: sharers && sharers.n ? sharers.n : 0 };
    },
  };
}
