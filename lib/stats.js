// Live totals for the TV. Ordinance counts are ordinances, not people.
// Unknown labels stay out of the six buckets. Country codes are not names.
const { parseOrdinances } = require('./ordinances');
const { normalizeCountry } = require('./country');

const ORDINANCES = [
  'Baptism',
  'Confirmation',
  'Initiatory',
  'Endowment',
  'Sealing to Parents',
  'Sealing to Spouse',
];

const BY_KEY = new Map(ORDINANCES.map(name => [name.toLowerCase(), name]));

function ordinanceKey(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function tally(lights) {
  const ordinances = {};
  for (const name of ORDINANCES) ordinances[name] = 0;
  const countries = new Set();
  for (const light of lights || []) {
    const country = normalizeCountry(light.country);
    if (country) countries.add(country);
    const names = parseOrdinances(light.ordinances != null ? light.ordinances : light.ordinance);
    for (const name of names) {
      const canon = BY_KEY.get(ordinanceKey(name));
      if (canon) ordinances[canon]++;
    }
  }
  return { ancestors: (lights || []).length, countries: countries.size, ordinances };
}

module.exports = { ORDINANCES, tally, ordinanceKey };
