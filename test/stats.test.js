const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { countryAt, countryForLight, fillCountries } = require('../lib/country');
const { tally, ORDINANCES } = require('../lib/stats');
const { countsAsShare, sharerBasis, hashSharer } = require('../lib/sharers');
const { parseNominatimBody, NOMINATIM_SEARCH } = require('../lib/nominatim');
const { handleApi } = require('../lib/http');
const { planUpload } = require('../lib/upload');
const { PUBLIC_KEYS } = require('../lib/lights');

const NOW = Date.parse('2026-10-11T00:00:00Z');
const en = fs.readFileSync(path.join(__dirname, 'fixtures', 'synthetic-en.csv'), 'utf8');

function req(pathname, { method = 'GET', headers = {}, body = '' } = {}) {
  return {
    url: 'http://localhost' + pathname,
    method,
    headers: { get: name => headers[name.toLowerCase()] || null },
    text: async () => body,
  };
}

function shareStore(seed = {}) {
  const lights = seed.lights || [];
  const jobs = [];
  const sharers = new Set();
  return {
    lights, jobs, sharers,
    async ids() { return [...lights.map(light => light.id), ...jobs.map(job => job.id)]; },
    async known() { return lights.map(light => ({ id: light.id, ordinance: light.ordinance, month: light.month || null })); },
    async maxCreated() { return Math.max(0, ...lights.map(light => light.created || 0), ...jobs.map(job => job.created || 0)); },
    async cacheFor() { return {}; },
    async listLights() { return lights; },
    async insertLight(light) { lights.push({ ...light }); return true; },
    async insertJob(job) { jobs.push(job); return true; },
    async mergeOrdinances() { return false; },
    async setMonth() { return false; },
    async clearLights() { lights.length = 0; jobs.length = 0; sharers.clear(); },
    async noteSharer(hash) { if (hash) sharers.add(hash); },
    async stats() { return { ...tally(lights), sharers: sharers.size }; },
  };
}

test('bundled outlines are the Natural Earth file, without the two codes it does not have', () => {
  const geo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'world.geojson'), 'utf8'));
  const bundled = require('../lib/countries.json');
  function codeOf(props) {
    const primary = String(props.ISO_A2 || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(primary)) return primary;
    const extra = String(props.ISO_A2_EH || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(extra) ? extra : null;
  }
  const fromGeo = geo.features.map(feature => {
    const code = codeOf(feature.properties || {});
    if (!code) return null;
    return { code, type: feature.geometry.type, coordinates: feature.geometry.coordinates };
  }).filter(Boolean);
  assert.equal(bundled.length, fromGeo.length);
  assert.equal(JSON.stringify(bundled), JSON.stringify(fromGeo));
  const skipped = geo.features.filter(feature => !codeOf(feature.properties || {})).map(feature => feature.properties.NAME);
  assert.deepEqual(skipped.sort(), ['N. Cyprus', 'Somaliland']);
});

test('country outlines place the known points and skip a code Nominatim already gave', () => {
  assert.equal(countryAt(51.9, -8.47), 'IE');
  assert.equal(countryAt(38.72, -9.14), 'PT');
  assert.equal(countryAt(40.76, -111.89), 'US');
  assert.equal(countryAt(60.39, 5.32), 'NO');
  assert.equal(countryAt(48.86, 2.35), 'FR');
  assert.equal(countryAt(42.66, 21.16), 'XK');
  assert.equal(countryAt(0, 0), null);
  assert.equal(countryForLight({ lat: 51.9, lon: -8.47, country: 'fr' }), 'FR');
  const kept = [{ id: 'ABCD-1', lat: 51.9, lon: -8.47, country: 'FR' }];
  assert.deepEqual(fillCountries(kept), []);
  assert.equal(kept[0].country, 'FR');
  const missing = [{ person_id: 'ABCD-2', lat: 51.9, lon: -8.47, country: null }];
  assert.deepEqual(fillCountries(missing), [{ id: 'ABCD-2', country: 'IE' }]);
  assert.equal(missing[0].country, 'IE');
});

test('ordinance totals count each ordinance and ignore unknown labels', () => {
  const body = tally([
    { ordinance: '["Baptism","Endowment"]', country: 'IE' },
    { ordinance: 'Endaumentti', country: 'ie' },
    { ordinance: '["Sealing to spouse","Nope"]', country: null },
    { ordinance: '  Baptism  ', country: 'US' },
    { ordinances: ['Sealing   to Parents'], country: 'usa' },
  ]);
  assert.equal(body.ancestors, 5);
  assert.equal(body.countries, 2);
  assert.deepEqual(Object.keys(body.ordinances), ORDINANCES);
  assert.equal(body.ordinances.Baptism, 2);
  assert.equal(body.ordinances.Endowment, 2);
  assert.equal(body.ordinances.Confirmation, 0);
  assert.equal(body.ordinances.Initiatory, 0);
  assert.equal(body.ordinances['Sealing to Parents'], 1);
  assert.equal(body.ordinances['Sealing to Spouse'], 1);
  assert.equal(body.ordinances.Nope, undefined);
  assert.equal(body.ordinances.Endaumentti, undefined);
});

test('nominatim keeps an uppercase country code when the search returns one', () => {
  assert.match(NOMINATIM_SEARCH, /addressdetails=1/);
  assert.deepEqual(
    parseNominatimBody([{ lat: '51.9', lon: '-8.47', address: { country_code: 'ie' } }]),
    { lat: 51.9, lon: -8.47, country: 'IE' }
  );
  assert.deepEqual(parseNominatimBody([{ lat: '1', lon: '2' }]), { lat: 1, lon: 2 });
});

test('a cached country code is kept on the light plan', () => {
  const plan = planUpload(en, {
    now: NOW,
    existingIds: new Set(['ABCD-123']),
    cache: { 'Cork, Ireland': { lat: 51.9, lon: -8.47, country: 'IE' } },
  });
  assert.equal(plan.immediate[0].country, 'IE');
  assert.equal(plan.immediate[0].id, 'ABCD-124');
});

test('stats stay on the public totals and uploads count a sharer once', async () => {
  const store = shareStore({
    lights: [
      { id: 'ABCD-1', ordinance: '["Baptism","Endowment"]', country: 'IE', place: 'Cork', lat: 51.9, lon: -8.47, created: 1 },
      { id: 'ABCD-2', ordinance: '["Baptism"]', country: 'US', place: 'Ogden', lat: 41.2, lon: -112, created: 2 },
    ],
  });
  const listed = await handleApi(req('/api/stats'), { store });
  const body = await listed.json();
  assert.equal(body.ancestors, 2);
  assert.equal(body.countries, 2);
  assert.equal(body.sharers, 0);
  assert.equal(body.ordinances.Baptism, 2);
  assert.equal(body.ordinances.Endowment, 1);
  assert.deepEqual(Object.keys(body).sort(), ['ancestors', 'countries', 'ordinances', 'sharers']);
  assert.ok(!PUBLIC_KEYS.includes('country'));
  assert.equal(JSON.stringify(body).includes('ABCD'), false);

  const client = '11111111-1111-4111-8111-111111111111';
  const first = await handleApi(req('/api/upload', { method: 'POST', headers: { 'x-sharer': client }, body: en }), { store });
  const uploaded = await first.json();
  assert.equal(uploaded.queued, 2);
  assert.equal(JSON.stringify(uploaded).includes(client), false);
  assert.equal(store.sharers.size, 1);
  const hash = [...store.sharers][0];
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash.includes(client), false);

  await handleApi(req('/api/upload', { method: 'POST', headers: { 'x-sharer': client }, body: en.replace('ABCD-124', 'WXYZ-124') }), { store });
  assert.equal(store.sharers.size, 1);

  await handleApi(req('/api/upload', { method: 'POST', body: en }), { store });
  assert.equal(store.sharers.size, 2);
  await handleApi(req('/api/upload', { method: 'POST', headers: { 'x-sharer': 'not a valid id' }, body: en }), { store });
  assert.equal(store.sharers.size, 2);

  const other = en.replace('ABCD-123', 'QRST-123');
  await handleApi(req('/api/upload', { method: 'POST', body: other }), { store });
  assert.equal(store.sharers.size, 3);

  const oldOnly = en.replace('15 September 2026', '1 January 2020').replace('30 June 2026', '1 January 2020');
  const skipped = await handleApi(req('/api/upload', { method: 'POST', body: oldOnly }), { store });
  assert.equal((await skipped.json()).pastYear, 0);
  assert.equal(store.sharers.size, 3);

  const bad = await handleApi(req('/api/upload', { method: 'POST', headers: { 'x-sharer': client }, body: 'not a list' }), { store });
  assert.equal(bad.status, 400);
  assert.equal(store.sharers.size, 3);

  const cleared = await handleApi(req('/api/reset', { method: 'POST', headers: { authorization: 'Bearer s3cret' } }), { store, resetToken: 's3cret' });
  assert.equal(cleared.status, 200);
  assert.equal(store.sharers.size, 0);
  assert.equal(store.lights.length, 0);
});

test('a file hash uses every person id, including rows outside the past year', async () => {
  const header = '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"\n';
  const row = (id, date) => `"N","${id}","Birth, 1900, Cork, Ireland","Baptism","${date}","Temple"`;
  const text = header + [row('ABCD-123', '1 January 2020'), row('ABCD-124', '15 September 2026')].join('\n');
  const again = header + [row('ABCD-124', '2 March 2026'), row('ABCD-123', '1 June 2019')].join('\n');
  assert.equal(sharerBasis('  ', text), sharerBasis('', again));
  assert.equal(sharerBasis('good-id', text).startsWith('client:'), true);
  assert.notEqual(sharerBasis('good-id', text), sharerBasis('', text));
  assert.equal(await hashSharer(sharerBasis('', text)), await hashSharer(sharerBasis('', again)));
  assert.equal(countsAsShare({ pastYear: 0, added: 0, duplicate: 0, merged: 0, queued: 0 }), false);
  assert.equal(countsAsShare({ pastYear: 1 }), true);
  assert.equal(sharerBasis('bad id', 'nope'), null);
});

test('the TV panel lists the six ordinances and does not ask for sound', () => {
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.match(tv, /id="stats"/);
  assert.match(tv, /id="stat-ancestors"/);
  assert.match(tv, /id="stat-countries"/);
  assert.match(tv, /id="stat-sharers"/);
  assert.match(tv, /id="stat-ordinances"/);
  assert.match(tv, /\/api\/stats/);
  for (const name of ORDINANCES) assert.match(tv, new RegExp(name));
  assert.doesNotMatch(tv, /stats\.hidden\s*=\s*true/);
  assert.doesNotMatch(tv, /new-upload\.mp3|enable sound|Click to enable sound|<audio/i);
  const upload = fs.readFileSync(path.join(__dirname, '..', 'public', 'upload.html'), 'utf8');
  assert.match(upload, /tom-sharer/);
  assert.match(upload, /X-Sharer/);
  assert.match(upload, /Scroll all the way to the bottom/);
});
