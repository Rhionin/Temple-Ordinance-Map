// Turn a Completed Ordinances CSV into rows worth lighting.
// Output never includes the person's name or the temple.
const { analyze, parseDate, extractPlace } = require('./fscsv');

function cutoffFrom(now) {
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  return cutoff;
}

function rowsFromCsv(text, now = Date.now()) {
  const parsed = analyze(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const cutoff = cutoffFrom(now);
  const stats = { total: parsed.records.length, pastYear: 0, undatedIncluded: 0 };
  const rows = [];
  for (const record of parsed.records) {
    const date = parseDate(record.dateText);
    if (!date) stats.undatedIncluded++;
    else if (date < cutoff) continue;
    stats.pastYear++;
    rows.push({
      id: record.id,
      place: extractPlace(record.event),
      ordinance: record.ordinance || '',
    });
  }
  return { ok: true, stats, rows };
}

module.exports = { rowsFromCsv, cutoffFrom };
