// Module-memory snapshots keyed by cheap SQL fingerprints so polls stay under CPU limits.

import { fillCountries } from './country.js';

const LIGHTS_SELECT = `
  SELECT l.person_id, l.place, l.lat, l.lon, l.ordinance, l.created, l.updated, l.month, l.completed, l.country
  FROM lights l
  JOIN groups g ON g.id = l.group_id
  WHERE g.disabled = 0
`;

const CHANGED_SINCE = `
  SELECT 1 AS hit
  FROM lights l
  JOIN groups g ON g.id = l.group_id
  WHERE g.disabled = 0 AND (l.created > ? OR l.updated > ?)
  LIMIT 1
`;

const PERSON_IDS_SINCE = `
  SELECT DISTINCT l.person_id
  FROM lights l
  JOIN groups g ON g.id = l.group_id
  WHERE g.disabled = 0 AND (l.created > ? OR l.updated > ?)
`;

const LIGHTS_FOR_PERSONS = (marks) => `
  SELECT l.person_id, l.place, l.lat, l.lon, l.ordinance, l.created, l.updated, l.month, l.completed, l.country
  FROM lights l
  JOIN groups g ON g.id = l.group_id
  WHERE g.disabled = 0 AND l.person_id IN (${marks})
`;

const MASTER_FINGERPRINT = `
  SELECT
    (SELECT COALESCE(SUM(id), 0) FROM groups WHERE disabled = 0) AS enabled_sig,
    COUNT(*) AS n,
    COALESCE(MAX(l.created), 0) AS max_created,
    COALESCE(MAX(l.updated), 0) AS max_updated,
    COALESCE(SUM(CASE WHEN l.country IS NULL OR l.country = '' THEN 1 ELSE 0 END), 0) AS missing_country,
    (SELECT COUNT(DISTINCT s.id_hash)
     FROM sharers s
     JOIN groups g2 ON g2.id = s.group_id
     WHERE g2.disabled = 0) AS sharers
  FROM lights l
  JOIN groups g ON g.id = l.group_id
  WHERE g.disabled = 0
`;

const GROUP_FINGERPRINT = `
  SELECT
    COUNT(*) AS n,
    COALESCE(MAX(created), 0) AS max_created,
    COALESCE(MAX(updated), 0) AS max_updated,
    COALESCE(SUM(CASE WHEN country IS NULL OR country = '' THEN 1 ELSE 0 END), 0) AS missing_country,
    (SELECT COUNT(*) FROM sharers WHERE group_id = ?) AS sharers
  FROM lights
  WHERE group_id = ?
`;

const COUNTRY_BACKFILL_LIMIT = 40;

function keyFromRow(row, prefix) {
  if (!row) return null;
  return [
    prefix,
    row.enabled_sig != null ? row.enabled_sig : '',
    row.n,
    row.max_created,
    row.max_updated,
    row.missing_country,
    row.sharers,
  ].join('|');
}

function groupKey(groupId, row) {
  return keyFromRow(row, `g:${groupId}`);
}

const masterCache = { key: null, lights: null, stats: null };
const groupCaches = new Map();

export function resetSnapshotCaches() {
  masterCache.key = null;
  masterCache.lights = null;
  masterCache.stats = null;
  groupCaches.clear();
}

export async function readMasterState(db) {
  const row = await db.prepare(MASTER_FINGERPRINT).first();
  return {
    key: keyFromRow(row, 'm'),
    sharers: Number(row && row.sharers) || 0,
  };
}

export async function readGroupState(db, groupId) {
  const group = Number(groupId);
  const row = await db.prepare(GROUP_FINGERPRINT).bind(group, group).first();
  return {
    key: groupKey(group, row),
    sharers: Number(row && row.sharers) || 0,
  };
}

export async function masterChangedSince(db, since) {
  const row = await db.prepare(CHANGED_SINCE).bind(since, since).first();
  return Boolean(row && row.hit);
}

export async function masterLightsForPersons(db, personIds) {
  if (!personIds.length) return [];
  const marks = personIds.map(() => '?').join(',');
  const rows = await db.prepare(LIGHTS_FOR_PERSONS(marks)).bind(...personIds).all();
  return rows.results || [];
}

export async function masterAllLightRows(db) {
  const rows = await db.prepare(LIGHTS_SELECT).all();
  return rows.results || [];
}

export function getMasterLightsCache(key) {
  if (!key || masterCache.key !== key) return null;
  return masterCache.lights;
}

export function setMasterLightsCache(key, lights) {
  masterCache.key = key;
  masterCache.lights = lights;
  if (masterCache.stats && masterCache.stats.key !== key) masterCache.stats = null;
}

export function getMasterStatsCache(key) {
  if (!key || !masterCache.stats || masterCache.stats.key !== key) return null;
  return masterCache.stats.value;
}

export function setMasterStatsCache(key, stats) {
  masterCache.stats = { key, value: stats };
}

export function getGroupLightsCache(groupId, key) {
  const entry = groupCaches.get(Number(groupId));
  if (!entry || entry.key !== key) return null;
  return entry.lights;
}

export function setGroupLightsCache(groupId, key, lights) {
  const id = Number(groupId);
  const entry = groupCaches.get(id) || {};
  entry.key = key;
  entry.lights = lights;
  groupCaches.set(id, entry);
}

export function getGroupStatsCache(groupId, key) {
  const entry = groupCaches.get(Number(groupId));
  if (!entry || entry.key !== key || !entry.stats) return null;
  return entry.stats;
}

export function setGroupStatsCache(groupId, key, stats) {
  const id = Number(groupId);
  const entry = groupCaches.get(id) || { key };
  entry.key = key;
  entry.stats = stats;
  groupCaches.set(id, entry);
}

export async function backfillGroupCountries(db, groupId) {
  const group = Number(groupId);
  const rows = await db.prepare(
    `SELECT person_id, lat, lon, ordinance, country
     FROM lights
     WHERE group_id = ? AND (country IS NULL OR country = '')
     LIMIT ?`
  ).bind(group, COUNTRY_BACKFILL_LIMIT).all();
  const lights = rows.results || [];
  if (!lights.length) return 0;
  const updates = fillCountries(lights);
  for (const update of updates) {
    await db.prepare(
      'UPDATE lights SET country = ? WHERE group_id = ? AND person_id = ?'
    ).bind(update.country, group, update.id).run();
  }
  return updates.length;
}

export { LIGHTS_SELECT, COUNTRY_BACKFILL_LIMIT };
