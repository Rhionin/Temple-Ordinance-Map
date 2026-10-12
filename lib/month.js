// Earliest completion month for a light, stored as YYYY-MM. A missing or
// unparsed ordinance date stays null so the TV can play it after the dated months.
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function monthFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (year < 1000 || month < 1 || month > 12) return null;
  return year + '-' + String(month).padStart(2, '0');
}

function normalizeMonth(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return MONTH_RE.test(text) ? text : null;
}

function earlierMonth(left, right) {
  const a = normalizeMonth(left);
  const b = normalizeMonth(right);
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

module.exports = { monthFromDate, normalizeMonth, earlierMonth };
