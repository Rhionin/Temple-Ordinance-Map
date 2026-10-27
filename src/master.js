// The master map folds every group that is not disabled, including soft-deleted groups.
import { foldLights } from '../lib/fold.js';
import { tally } from '../lib/stats.js';
import {
  getMasterLightsCache,
  getMasterStatsCache,
  masterAllLightRows,
  masterChangedSince,
  masterLightsForPersons,
  readMasterState,
  setMasterLightsCache,
  setMasterStatsCache,
} from '../lib/snapshot-cache.js';

function sinceFilter(rows, since) {
  const min = Number(since) || 0;
  return rows.filter(row => Math.max(Number(row.updated) || 0, Number(row.created) || 0) > min);
}

async function foldedMasterSnapshot(db, state) {
  let folded = getMasterLightsCache(state.key);
  if (folded) return folded;
  folded = foldLights(await masterAllLightRows(db));
  setMasterLightsCache(state.key, folded);
  return folded;
}

export function masterStore(db) {
  return {
    async listLights(since) {
      const min = Number(since) || 0;
      if (min > 0) {
        if (!(await masterChangedSince(db, min))) return [];
        const ids = await db.prepare(
          `SELECT DISTINCT l.person_id
           FROM lights l
           JOIN groups g ON g.id = l.group_id
           WHERE g.disabled = 0 AND (l.created > ? OR l.updated > ?)`
        ).bind(min, min).all();
        const personIds = (ids.results || []).map(row => row.person_id).filter(Boolean);
        const rows = await masterLightsForPersons(db, personIds);
        return sinceFilter(foldLights(rows), min);
      }
      const state = await readMasterState(db);
      return foldedMasterSnapshot(db, state);
    },
    async stats() {
      const state = await readMasterState(db);
      const cached = getMasterStatsCache(state.key);
      if (cached) return cached;
      const folded = await foldedMasterSnapshot(db, state);
      const stats = { ...tally(folded), sharers: state.sharers };
      setMasterStatsCache(state.key, stats);
      return stats;
    },
  };
}
