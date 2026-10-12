// One count per person who shared a list, without storing who they are.
// A browser id is hashed with a client: prefix. A request without one is
// hashed from the sorted person ids in the file, with a file: prefix, so the
// two kinds of basis cannot collide. The raw id is not kept.
const { sha256 } = require('./token');
const { analyze, PID_RE } = require('./fscsv');

const CLIENT_ID = /^[A-Za-z0-9_-]{1,80}$/;

function countsAsShare(stats) {
  if (!stats) return false;
  return (stats.pastYear || 0) + (stats.added || 0) + (stats.duplicate || 0) + (stats.merged || 0) + (stats.queued || 0) > 0;
}

function sharerBasis(header, csvText) {
  const raw = String(header || '').trim();
  if (CLIENT_ID.test(raw)) return 'client:' + raw;
  const parsed = analyze(String(csvText || ''));
  if (!parsed.ok) return null;
  const ids = [...new Set(parsed.records.map(record => record.id).filter(id => PID_RE.test(id || '')))].sort();
  if (!ids.length) return null;
  return 'file:' + ids.join('\n');
}

async function hashSharer(basis) {
  if (!basis) return null;
  const bytes = await sha256(basis);
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

module.exports = { countsAsShare, sharerBasis, hashSharer };
