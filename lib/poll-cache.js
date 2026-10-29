// TTL snapshots for TV polling. One D1 refresh per group/master per window (~60s).
// Serves stale data when D1 is unavailable (quota / transient errors).

import { foldLights } from './fold.js';
import { tally } from './stats.js';
import { markPollStale, resetPollStale } from './poll-meta.js';
import {
  backfillGroupCountries,
  masterAllLightRows,
  readGroupState,
  readMasterState,
  resetSnapshotCaches,
} from './snapshot-cache.js';

export const POLL_TTL_MS = 60_000;

const masterEntry = { until: 0, folded: null, stats: null };
const groupEntries = new Map();
const masterStale = { folded: null, stats: null };
const groupStale = new Map();
const slugEntries = new Map();
const slugStale = new Map();

let partyIdCache = null;
let d1QueryCount = 0;

export function resetPollQueryCount() {
  d1QueryCount = 0;
}

export function pollQueryCount() {
  return d1QueryCount;
}

export function noteD1Query() {
  d1QueryCount += 1;
}

export function isD1ReadError(error) {
  const msg = String(error && error.message || error || '');
  return /exceeded.*row read|row read limit|5[\d,]*\s*rows?\s*read/i.test(msg);
}

export function invalidateMasterPoll() {
  masterEntry.until = 0;
  resetSnapshotCaches();
}

export function invalidateGroupPoll(groupId) {
  const id = Number(groupId);
  if (Number.isFinite(id)) {
    const entry = groupEntries.get(id);
    if (entry) entry.until = 0;
  }
  invalidateMasterPoll();
}

export function invalidateAllPoll() {
  masterEntry.until = 0;
  groupEntries.clear();
  slugEntries.clear();
  resetSnapshotCaches();
}

export function cachedPartyId() {
  return partyIdCache;
}

export function rememberPartyId(id) {
  partyIdCache = Number(id) || null;
}

function fresh(until) {
  return until > Date.now();
}

function sinceFilter(rows, since) {
  const min = Number(since) || 0;
  if (min <= 0) return rows;
  return rows.filter(row => Math.max(Number(row.updated) || 0, Number(row.created) || 0) > min);
}

async function refreshMaster(db) {
  noteD1Query();
  const state = await readMasterState(db);
  noteD1Query();
  const raw = await masterAllLightRows(db);
  const folded = foldLights(raw);
  const stats = { ...tally(folded), sharers: state.sharers };
  const entry = { until: Date.now() + POLL_TTL_MS, folded, stats };
  masterEntry.until = entry.until;
  masterEntry.folded = folded;
  masterEntry.stats = stats;
  masterStale.folded = folded;
  masterStale.stats = stats;
  return entry;
}

export async function masterPollBundle(db) {
  if (fresh(masterEntry.until) && masterEntry.folded) {
    return { folded: masterEntry.folded, stats: masterEntry.stats, stale: false };
  }
  try {
    const entry = await refreshMaster(db);
    return { folded: entry.folded, stats: entry.stats, stale: false };
  } catch (error) {
    if (isD1ReadError(error) && masterStale.folded) {
      markPollStale(true);
      return { folded: masterStale.folded, stats: masterStale.stats, stale: true };
    }
    throw error;
  }
}

async function refreshGroup(db, groupId) {
  const group = Number(groupId);
  noteD1Query();
  await backfillGroupCountries(db, group);
  noteD1Query();
  const state = await readGroupState(db, group);
  noteD1Query();
  const rows = await db.prepare(
    `SELECT person_id, place, lat, lon, ordinance, created, updated, month, completed, country
     FROM lights
     WHERE group_id = ?
     ORDER BY created`
  ).bind(group).all();
  const lights = rows.results || [];
  const stats = { ...tally(lights), sharers: state.sharers };
  const entry = { until: Date.now() + POLL_TTL_MS, lights, stats };
  groupEntries.set(group, entry);
  groupStale.set(group, { lights, stats });
  return entry;
}

export async function groupPollBundle(db, groupId) {
  const group = Number(groupId);
  const cached = groupEntries.get(group);
  if (cached && fresh(cached.until)) {
    return { lights: cached.lights, stats: cached.stats, stale: false };
  }
  try {
    const entry = await refreshGroup(db, group);
    return { lights: entry.lights, stats: entry.stats, stale: false };
  } catch (error) {
    if (isD1ReadError(error) && groupStale.has(group)) {
      markPollStale(true);
      const stale = groupStale.get(group);
      return { lights: stale.lights, stats: stale.stats, stale: true };
    }
    throw error;
  }
}

export function groupLightsSince(bundle, since) {
  return sinceFilter(bundle.lights, since);
}

export function invalidateGroupSlug(slug) {
  const key = String(slug || '').trim();
  slugEntries.delete(key);
}

export function rememberGroupRow(slug, row) {
  const key = String(slug || '').trim();
  if (!key || !row) return;
  slugEntries.set(key, { until: Date.now() + POLL_TTL_MS, row });
  slugStale.set(key, row);
}

export function cachedGroupRow(slug) {
  const key = String(slug || '').trim();
  const hit = slugEntries.get(key);
  if (hit && fresh(hit.until)) return hit.row;
  return null;
}

export function staleGroupRow(slug) {
  return slugStale.get(String(slug || '').trim()) || null;
}

export function resetPollCachesForTests() {
  masterEntry.until = 0;
  masterEntry.folded = null;
  masterEntry.stats = null;
  groupEntries.clear();
  slugEntries.clear();
  masterStale.folded = null;
  masterStale.stats = null;
  groupStale.clear();
  slugStale.clear();
  partyIdCache = null;
  d1QueryCount = 0;
  resetPollStale();
  masterEntry.until = 0;
  masterEntry.folded = null;
  masterEntry.stats = null;
  groupEntries.clear();
  slugEntries.clear();
  masterStale.folded = null;
  masterStale.stats = null;
  groupStale.clear();
  slugStale.clear();
  partyIdCache = null;
  resetSnapshotCaches();
}
