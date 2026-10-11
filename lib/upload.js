// Decide which rows become lights immediately, which need geocoding, and which
// are duplicates. Nothing returned here includes a name or a temple.
const { rowsFromCsv } = require('./rows');
const { candidates } = require('./places');
const { planStep } = require('./geostep');

function planUpload(text, { now = Date.now(), existingIds = new Set(), cache = {} } = {}) {
  const parsed = rowsFromCsv(text, now);
  if (!parsed.ok) return parsed;
  const seen = new Set();
  const immediate = [];
  const pending = [];
  const stats = {
    total: parsed.stats.total,
    pastYear: parsed.stats.pastYear,
    undatedIncluded: parsed.stats.undatedIncluded,
    added: 0,
    duplicate: 0,
    geocoded: 0,
    queued: 0,
    unresolved: [],
  };
  for (const row of parsed.rows) {
    if (!row.id) continue;
    if (existingIds.has(row.id) || seen.has(row.id)) { stats.duplicate++; continue; }
    seen.add(row.id);
    if (!row.place) { stats.unresolved.push('(no place) ' + row.id); continue; }
    const plan = planStep({ job: { place: row.place, cursor: 0 }, cache, lastFetch: 0, now });
    if (plan.type === 'hit') {
      immediate.push({ id: row.id, place: row.place, ordinance: row.ordinance, lat: plan.coord.lat, lon: plan.coord.lon });
      stats.added++;
      stats.geocoded++;
    } else if (plan.type === 'miss') {
      stats.unresolved.push(row.place);
    } else {
      pending.push({ id: row.id, place: row.place, ordinance: row.ordinance, cursor: plan.index || 0 });
      stats.queued++;
    }
  }
  return { ok: true, stats, immediate, pending };
}

function queriesForRows(rows) {
  const needed = new Set();
  for (const row of rows) for (const query of candidates(row.place)) needed.add(query);
  return [...needed];
}

module.exports = { planUpload, queriesForRows, candidates };
