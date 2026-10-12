// One ancestor on the master map, even when two groups both hold that person.
const { mergeOrdinances, serializeOrdinances } = require('./ordinances');

function earliest(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return left < right ? left : right;
}

function foldLights(rows) {
  const byPerson = new Map();
  for (const row of rows || []) {
    const id = row && (row.person_id || row.id);
    if (!id) continue;
    const list = byPerson.get(id) || [];
    list.push(row);
    byPerson.set(id, list);
  }
  const folded = [];
  for (const [id, list] of byPerson) {
    const ordered = list.slice().sort((a, b) => (Number(a.created) || 0) - (Number(b.created) || 0));
    const oldest = ordered[0];
    let created = Number(oldest.created) || 0;
    let updated = 0;
    let month = null;
    let completed = null;
    for (const row of ordered) {
      const rowCreated = Number(row.created) || 0;
      created = Math.min(created, rowCreated || created);
      updated = Math.max(updated, Number(row.updated) || rowCreated || 0);
      month = earliest(month, row.month || null);
      completed = earliest(completed, row.completed || null);
    }
    folded.push({
      person_id: id,
      place: oldest.place,
      lat: oldest.lat,
      lon: oldest.lon,
      country: oldest.country || null,
      ordinance: serializeOrdinances(mergeOrdinances(...ordered.map(row => row.ordinance))),
      created,
      updated: Math.max(created, updated),
      month,
      completed,
    });
  }
  folded.sort((a, b) => a.created - b.created || (a.person_id < b.person_id ? -1 : 1));
  return folded;
}

module.exports = { foldLights };
