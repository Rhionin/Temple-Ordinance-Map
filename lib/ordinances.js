// Ordinance types stored on a light. One person is one row; every ordinance
// they completed is kept in the existing ordinance column as a JSON list.
// A plain string from older rows still reads as a one-item list.
// Names are normalized to FamilySearch's English labels here, so ingest,
// merge, and the public read path (Worker and Node) all show English.
const { toEnglishOrdinance } = require('./ordinance-names');

function dedupe(items) {
  const out = [];
  const seen = new Set();
  for (const item of items) {
    if (typeof item !== 'string' && typeof item !== 'number') continue;
    const text = toEnglishOrdinance(String(item).trim());
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function parseOrdinances(value) {
  if (Array.isArray(value)) return dedupe(value);
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return dedupe(parsed);
    } catch (error) { /* a plain label that happens to start with [ */ }
  }
  return dedupe([text]);
}

function mergeOrdinances(...groups) {
  return dedupe(groups.flatMap(group => parseOrdinances(group)));
}

function serializeOrdinances(value) {
  return JSON.stringify(mergeOrdinances(value));
}

module.exports = { parseOrdinances, mergeOrdinances, serializeOrdinances };
