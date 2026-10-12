// Decide which rows become lights immediately, which need geocoding, and which
// are duplicates. One person is one light. Extra ordinance types for that
// person are merged onto the light. Nothing returned here includes a name or
// a temple.
const { rowsFromCsv } = require('./rows');
const { candidates } = require('./places');
const { planStep } = require('./geostep');
const { mergeOrdinances, parseOrdinances, serializeOrdinances } = require('./ordinances');
const { earlierMonth, resolveMonth, completedForMonth } = require('./month');

function groupRows(rows) {
  const order = [];
  const byId = new Map();
  let repeated = 0;
  for (const row of rows) {
    if (!row.id) continue;
    let group = byId.get(row.id);
    if (!group) {
      group = { id: row.id, place: '', ordinances: [], month: null, completed: null };
      byId.set(row.id, group);
      order.push(group);
    }
    if (!group.place && row.place) group.place = row.place;
    const month = earlierMonth(group.month, row.month);
    group.completed = completedForMonth(month, group.completed, row.completed);
    group.month = month;
    const before = group.ordinances.length;
    group.ordinances = mergeOrdinances(group.ordinances, row.ordinance);
    if (group.ordinances.length === before && before > 0) repeated++;
  }
  return { order, repeated };
}

function indexExisting(existingIds, existing) {
  const map = new Map();
  if (Array.isArray(existing)) {
    for (const row of existing) {
      if (!row || !row.id) continue;
      const month = row.unknown ? null : resolveMonth(row.month, row.completed);
      map.set(row.id, row.unknown
        ? { unknown: true, ordinances: [], month: null, completed: null }
        : {
          unknown: false,
          ordinances: parseOrdinances(row.ordinances != null ? row.ordinances : row.ordinance),
          month,
          completed: completedForMonth(month, row.completed),
        });
    }
  }
  for (const id of existingIds || []) {
    if (!map.has(id)) map.set(id, { unknown: true, ordinances: [] });
  }
  return map;
}

function planUpload(text, { now = Date.now(), existingIds = new Set(), existing, cache = {} } = {}) {
  const parsed = rowsFromCsv(text, now);
  if (!parsed.ok) return parsed;
  const known = indexExisting(existingIds, existing);
  const immediate = [];
  const pending = [];
  const merges = [];
  const monthFixes = [];
  const grouped = groupRows(parsed.rows);
  const stats = {
    total: parsed.stats.total,
    pastYear: parsed.stats.pastYear,
    undatedIncluded: parsed.stats.undatedIncluded,
    added: 0,
    duplicate: grouped.repeated,
    merged: 0,
    geocoded: 0,
    queued: 0,
    unresolved: [],
  };
  for (const row of grouped.order) {
    const ordinance = serializeOrdinances(row.ordinances);
    const prior = known.get(row.id);
    if (prior) {
      if (prior.unknown) { stats.duplicate++; continue; }
      const combined = mergeOrdinances(prior.ordinances, row.ordinances);
      const month = earlierMonth(prior.month, row.month);
      const completed = completedForMonth(month, prior.completed, row.completed);
      if (combined.length === prior.ordinances.length) {
        stats.duplicate++;
        if (month && month !== prior.month) monthFixes.push({ id: row.id, month, completed });
        continue;
      }
      merges.push({ id: row.id, ordinances: combined, month, completed });
      stats.merged++;
      known.set(row.id, { unknown: false, ordinances: combined, month, completed });
      continue;
    }
    known.set(row.id, { unknown: false, ordinances: row.ordinances, month: row.month || null, completed: row.completed || null });
    if (!row.place) { stats.unresolved.push('(no place) ' + row.id); continue; }
    const plan = planStep({ job: { place: row.place, cursor: 0 }, cache, lastFetch: 0, now });
    const stored = { id: row.id, place: row.place, ordinance, month: row.month || null, completed: row.completed || null };
    if (plan.type === 'hit') {
      const hit = { ...stored, lat: plan.coord.lat, lon: plan.coord.lon };
      if (plan.coord.country) hit.country = plan.coord.country;
      immediate.push(hit);
      stats.added++;
      stats.geocoded++;
    } else if (plan.type === 'miss') {
      stats.unresolved.push(row.place);
    } else {
      pending.push({ ...stored, cursor: plan.index || 0 });
      stats.queued++;
    }
  }
  return { ok: true, stats, immediate, pending, merges, monthFixes };
}

function queriesForRows(rows) {
  const needed = new Set();
  for (const row of rows) for (const query of candidates(row.place)) needed.add(query);
  return [...needed];
}

module.exports = { planUpload, queriesForRows, candidates };
