// The master map folds every group that is not disabled, including soft-deleted groups.
import { foldLights } from '../lib/fold.js';
import { tally } from '../lib/stats.js';

const LIGHTS = `
  SELECT l.person_id, l.place, l.lat, l.lon, l.ordinance, l.created, l.updated, l.month, l.completed, l.country
  FROM lights l
  JOIN groups g ON g.id = l.group_id
  WHERE g.disabled = 0
`;

function sinceFilter(rows, since) {
  const min = Number(since) || 0;
  return rows.filter(row => Math.max(Number(row.updated) || 0, Number(row.created) || 0) > min);
}

export function masterStore(db) {
  return {
    async listLights(since) {
      const rows = await db.prepare(LIGHTS).all();
      return sinceFilter(foldLights(rows.results || []), since);
    },
    async stats() {
      const rows = await db.prepare(LIGHTS).all();
      const folded = foldLights(rows.results || []);
      const sharers = await db.prepare(
        `SELECT COUNT(DISTINCT s.id_hash) AS n
         FROM sharers s
         JOIN groups g ON g.id = s.group_id
         WHERE g.disabled = 0`
      ).first();
      return { ...tally(folded), sharers: Number(sharers && sharers.n) || 0 };
    },
  };
}
