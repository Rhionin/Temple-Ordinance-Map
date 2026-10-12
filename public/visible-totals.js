// Totals for the lights currently on the TV. One light is one person.
// Ordinance numbers count ordinances. A sharer is not a light, so that
// total stays hidden until every person in the catalog is on the map.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisibleTotals = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ORDINANCES = [
    'Baptism',
    'Confirmation',
    'Initiatory',
    'Endowment',
    'Sealing to Parents',
    'Sealing to Spouse',
  ];
  const BY_KEY = new Map(ORDINANCES.map(name => [name.toLowerCase(), name]));

  function namesOf(light) {
    if (!light) return [];
    if (Array.isArray(light.ordinances)) return light.ordinances;
    const raw = light.ordinance;
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
      try { return JSON.parse(raw); } catch (error) { return [raw]; }
    }
    return raw ? [raw] : [];
  }

  function tally(lights, countryAt) {
    const locate = typeof countryAt === 'function' ? countryAt : function () { return null; };
    const ordinances = {};
    for (const name of ORDINANCES) ordinances[name] = 0;
    const countries = new Set();
    for (const light of lights || []) {
      const country = locate(light.lat, light.lon);
      if (country) countries.add(country);
      for (const name of namesOf(light)) {
        const canon = BY_KEY.get(String(name || '').trim().replace(/\s+/g, ' ').toLowerCase());
        if (canon) ordinances[canon]++;
      }
    }
    return { ancestors: (lights || []).length, countries: countries.size, ordinances };
  }

  function sharersShown(revealed, catalogSize, sharerTotal) {
    const shown = Number(revealed) || 0;
    const total = Number(catalogSize) || 0;
    if (!total || shown < total) return 0;
    return Number(sharerTotal) || 0;
  }

  return { ORDINANCES, tally, sharersShown };
});
