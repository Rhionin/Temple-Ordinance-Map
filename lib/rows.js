// Turn a Completed Ordinances CSV into rows worth lighting.
// Output never includes the person's name or the temple.
const { analyze, parseDate, extractPlace } = require('./fscsv');
const { plainLabel } = require('./plain');
const { monthFromDate, completedFromDate } = require('./month');

function cutoffFrom(now, months = 12) {
  const cutoff = new Date(now);
  const span = Number(months);
  const monthsBack = Number.isFinite(span) && span >= 1 ? Math.min(Math.floor(span), 120) : 12;
  if (monthsBack === 12) cutoff.setFullYear(cutoff.getFullYear() - 1);
  else cutoff.setMonth(cutoff.getMonth() - monthsBack);
  return cutoff;
}

function rowsFromCsv(text, now = Date.now(), months = 12) {
  const parsed = analyze(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  const cutoff = cutoffFrom(now, months);
  const stats = { total: parsed.records.length, pastYear: 0, undatedIncluded: 0 };
  const rows = [];
  for (const record of parsed.records) {
    const date = parseDate(record.dateText);
    if (!date) stats.undatedIncluded++;
    else if (date < cutoff) continue;
    stats.pastYear++;
    rows.push({
      id: record.id,
      place: plainLabel(extractPlace(record.event)),
      ordinance: plainLabel(record.ordinance || ''),
      month: monthFromDate(date),
      completed: completedFromDate(date),
    });
  }
  return { ok: true, stats, rows };
}

module.exports = { rowsFromCsv, cutoffFrom };
