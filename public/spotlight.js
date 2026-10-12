// Spotlight order for the TV page. New lights play first. The rest rotate in
// a shuffle with no repeat until every light has been featured. Every few
// features the caller gets a world view so the whole map is seen.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Spotlight = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function lightKey(light) {
    const created = Number(light.created) || 0;
    const lat = Number(light.lat);
    const lon = Number(light.lon);
    return created + '|' + lat.toFixed(4) + '|' + lon.toFixed(4) + '|' + String(light.place || '');
  }

  function cleanOrdinances(value) {
    const list = Array.isArray(value) ? value : (value ? [value] : []);
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const text = String(item || '').trim();
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  }

  function ordinancesOf(light) {
    if (!light) return [];
    if (Array.isArray(light.ordinances)) return cleanOrdinances(light.ordinances);
    if (typeof light.ordinance === 'string' && light.ordinance.trim().startsWith('[')) {
      try { return cleanOrdinances(JSON.parse(light.ordinance)); } catch (error) { /* use the raw label */ }
    }
    return cleanOrdinances(light.ordinance ? [light.ordinance] : []);
  }

  function regionName(place) {
    const parts = String(place || '').split(',').map(part => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function regionCount(lights, place) {
    const region = regionName(place).toLowerCase();
    if (!region) return 0;
    return lights.filter(light => regionName(light.place).toLowerCase() === region).length;
  }

  function captionFor(light, lights) {
    const ordinances = ordinancesOf(light);
    const region = regionName(light && light.place);
    const count = region ? regionCount(lights || [], light.place) : 0;
    let regionText = '';
    if (region && count === 1) regionText = '1 ancestor in ' + region;
    else if (region && count > 1) regionText = count + ' ancestors in ' + region;
    return {
      place: String((light && light.place) || ''),
      ordinancesText: ordinances.length ? ordinances.join(' · ') : 'Temple ordinance',
      regionText,
    };
  }

  function shuffle(list, rng) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const swap = copy[i];
      copy[i] = copy[j];
      copy[j] = swap;
    }
    return copy;
  }

  function createRotation(options) {
    const settings = options || {};
    const every = Math.max(1, Number(settings.every) || 4);
    const rng = settings.rng || Math.random;
    const records = new Map();
    const fresh = [];
    let deck = [];
    let shown = 0;
    let singleToggle = false;

    function ingest(light, queueNew) {
      const key = lightKey(light);
      const prev = records.get(key);
      const ordinances = cleanOrdinances([...(prev ? prev.ordinances : []), ...ordinancesOf(light)]);
      if (prev) {
        prev.ordinances = ordinances;
        if (light.place) prev.place = String(light.place);
        return { key, isNew: false };
      }
      records.set(key, {
        key,
        place: String(light.place || ''),
        lat: Number(light.lat),
        lon: Number(light.lon),
        created: Number(light.created) || 0,
        ordinances,
      });
      if (queueNew) fresh.unshift(key);
      return { key, isNew: true };
    }

    function refill() {
      const waiting = new Set(fresh);
      deck = shuffle([...records.keys()].filter(key => !waiting.has(key)), rng);
    }

    return {
      seed(list) {
        const keys = [];
        for (const light of list || []) {
          const result = ingest(light, false);
          if (result.isNew) keys.push(result.key);
        }
        deck = shuffle(keys, rng);
        fresh.length = 0;
      },
      arrive(light) {
        return ingest(light, true);
      },
      update(light) {
        return ingest(light, false);
      },
      has(light) {
        return records.has(lightKey(light));
      },
      get(light) {
        return records.get(lightKey(light)) || null;
      },
      all() {
        return [...records.values()];
      },
      clear() {
        records.clear();
        fresh.length = 0;
        deck = [];
        shown = 0;
        singleToggle = false;
      },
      next() {
        const keys = [...records.keys()];
        if (!keys.length) return { type: 'idle' };
        if (keys.length === 1) {
          singleToggle = !singleToggle;
          if (singleToggle) return { type: 'light', light: records.get(keys[0]) };
          return { type: 'world' };
        }
        if (shown > 0 && shown % every === 0) {
          shown = 0;
          return { type: 'world' };
        }
        let key = fresh.shift();
        if (!key) {
          if (!deck.length) refill();
          key = deck.shift();
        }
        if (!key) return { type: 'world' };
        shown += 1;
        return { type: 'light', light: records.get(key) };
      },
    };
  }

  return { lightKey, regionName, regionCount, captionFor, createRotation };
});
