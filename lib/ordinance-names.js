// English labels for FamilySearch ordinance cells. The TV always shows these
// six, matching an English Completed Ordinances export. ordinances-by-locale.json
// has one row per locale in headers-by-locale.json. edge.fscdn.org answers
// 403 from this environment, so the file keeps the English export labels for
// every locale and adds the translated labels we know (Finnish, and the
// Spanish and Portuguese fixture wording, plus other established export
// labels). Unknown cells stay as written and are logged once.
const headers = require('../headers-by-locale.json');
const bundles = require('../ordinances-by-locale.json');

const CANONICAL = ['Baptism', 'Confirmation', 'Initiatory', 'Endowment', 'Sealing to Parents', 'Sealing to Spouse'];
const MIN_FUZZY = 6;

const byFold = new Map();
const aliases = [];
const logged = new Set();
const emissions = new Map();

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/ +/g, ' ');
}

function add(label, canon) {
  const folded = fold(label);
  if (!folded) return;
  const prev = byFold.get(folded);
  if (prev && prev !== canon) throw new Error('ordinance alias conflict: ' + label);
  if (prev) return;
  byFold.set(folded, canon);
  aliases.push({ fold: folded, canon, len: folded.length });
}

if (JSON.stringify(bundles.en) !== JSON.stringify(CANONICAL)) {
  throw new Error('English ordinance labels do not match the canonical set');
}
for (const locale of Object.keys(headers)) {
  const labels = bundles[locale];
  if (!Array.isArray(labels) || labels.length !== CANONICAL.length) {
    throw new Error('missing ordinance labels for ' + locale);
  }
  labels.forEach((label, index) => add(label, CANONICAL[index]));
}
const extra = bundles._aliases || {};
for (const canon of CANONICAL) {
  for (const alias of extra[canon] || []) add(alias, canon);
}

function noteUnknown(value) {
  const key = fold(value);
  if (!key || logged.has(key)) return;
  logged.add(key);
  emissions.set(key, (emissions.get(key) || 0) + 1);
  console.error(JSON.stringify({ event: 'ordinance_untranslated', value }));
}

function toEnglishOrdinance(value) {
  const text = String(value ?? '').trim();
  const folded = fold(text);
  if (!folded) return '';
  const exact = byFold.get(folded);
  if (exact) return exact;
  let bestLen = 0;
  let bestCanon = '';
  let ambiguous = false;
  for (const alias of aliases) {
    if (alias.len < MIN_FUZZY || alias.len < bestLen) continue;
    if (!folded.includes(alias.fold)) continue;
    if (alias.len === bestLen && alias.canon !== bestCanon) {
      ambiguous = true;
      continue;
    }
    if (alias.len > bestLen) {
      bestLen = alias.len;
      bestCanon = alias.canon;
      ambiguous = false;
    }
  }
  if (bestCanon && !ambiguous) return bestCanon;
  noteUnknown(text);
  return text;
}

function untranslatedEmissions(value) {
  return emissions.get(fold(value)) || 0;
}

module.exports = { CANONICAL, fold, toEnglishOrdinance, untranslatedEmissions };
