// Earliest completion month for a light, stored as YYYY-MM. The completion
// day is YYYY-MM-DD. A missing or unparsed ordinance date stays null so the
// TV can play it after the dated months. When month is null, the day is
// enough to place the light.
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const COMPLETED_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function monthFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (year < 1000 || month < 1 || month > 12) return null;
  return year + '-' + String(month).padStart(2, '0');
}

function completedFromDate(date) {
  const month = monthFromDate(date);
  if (!month) return null;
  return month + '-' + String(date.getUTCDate()).padStart(2, '0');
}

function normalizeMonth(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return MONTH_RE.test(text) ? text : null;
}

function normalizeCompleted(value) {
  if (value == null) return null;
  const text = String(value).trim();
  const match = text.match(COMPLETED_RE);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1000) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return text;
}

function monthFromCompleted(value) {
  const text = normalizeCompleted(value);
  return text ? text.slice(0, 7) : null;
}

function resolveMonth(month, completed) {
  return normalizeMonth(month) || monthFromCompleted(completed);
}

function earlierMonth(left, right) {
  const a = normalizeMonth(left);
  const b = normalizeMonth(right);
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function completedForMonth(month, ...values) {
  const target = normalizeMonth(month);
  if (!target) return null;
  let best = null;
  for (const value of values) {
    const text = normalizeCompleted(value);
    if (!text || text.slice(0, 7) !== target) continue;
    if (!best || text < best) best = text;
  }
  return best;
}

module.exports = {
  monthFromDate,
  completedFromDate,
  normalizeMonth,
  normalizeCompleted,
  monthFromCompleted,
  resolveMonth,
  earlierMonth,
  completedForMonth,
};
