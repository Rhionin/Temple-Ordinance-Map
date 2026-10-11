// Temple ordinance map. Zero dependencies (Node 18+).
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
const CACHE_F = path.join(DATA, 'geocache.json'), LIGHTS_F = path.join(DATA, 'lights.json'), UNRES_F = path.join(DATA, 'unresolved.log');
const UA = process.env.GEOCODE_UA || 'temple-ordinance-map/1.0';
const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
let cache = load(CACHE_F, {}), lights = load(LIGHTS_F, []); // lights: {id, place, lat, lon, ordinance, added}
const save = () => { fs.writeFileSync(CACHE_F, JSON.stringify(cache, null, 1)); fs.writeFileSync(LIGHTS_F, JSON.stringify(lights)); };

const { analyze, parseDate, extractPlace } = require('./lib/fscsv');

// Geocoding: Nominatim, 1 req/s, disk cache, progressive fallbacks.
let last = 0; const sleep = ms => new Promise(r => setTimeout(r, ms));
async function nominatim(q) {
  if (q in cache) return cache[q];
  const wait = last + 1100 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
  let r = null;
  try {
    const res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'User-Agent': UA } });
    const j = await res.json(); if (j[0]) r = { lat: +j[0].lat, lon: +j[0].lon };
  } catch (e) { console.error('geocode error', q, e.message); return null; } // don't cache network errors
  cache[q] = r; save(); return r;
}
const NOISE = /\b(parish|sogn|sn|herred|amt|county|co\.|township|twp|district|hundred|municipality|kommune|socken|landsogn)\b/gi;
function candidates(place) {
  const out = [], push = s => { s = s.replace(/\s+/g, ' ').replace(/^,|,$/g, '').trim(); if (s && !out.includes(s)) out.push(s); };
  const p = place.split(',').map(s => s.trim()).filter(Boolean);
  push(p.join(', '));
  const clean = p.map(s => s.replace(NOISE, '').trim()).filter(Boolean); push(clean.join(', '));
  if (clean.length > 2) push(clean[0] + ', ' + clean[clean.length - 1]); // town + country/state
  for (let i = 1; i < clean.length; i++) push(clean.slice(i).join(', '));      // drop leading (most specific) segments
  for (let i = clean.length - 1; i >= 2; i--) push([clean[0], ...clean.slice(1, i)].join(', ')); // drop trailing
  return out;
}
async function geocode(place) {
  for (const c of candidates(place)) { const r = await nominatim(c); if (r) return { ...r, matched: c }; }
  fs.appendFileSync(UNRES_F, new Date().toISOString() + '\t' + place + '\n'); return null;
}

const sseClients = new Set();
async function ingest(text) {
  const A = analyze(text); if (!A.ok) throw new Error(A.reason);
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  const stats = { total: A.records.length, pastYear: 0, undatedIncluded: 0, added: 0, duplicate: 0, geocoded: 0, unresolved: [] };
  for (const r of A.records) {
    const d = parseDate(r.dateText);
    if (!d) { stats.undatedIncluded++; fs.appendFileSync(UNRES_F, new Date().toISOString() + '\tUNPARSED DATE\t' + r.dateText + '\n'); }
    else if (d < cutoff) continue;
    stats.pastYear++;
    const id = r.id; if (!id) continue;
    if (lights.some(l => l.id === id)) { stats.duplicate++; continue; }
    const place = extractPlace(r.event); if (!place) { stats.unresolved.push('(no place) ' + id); continue; }
    const g = await geocode(place);
    if (!g) { stats.unresolved.push(place); continue; }
    stats.geocoded++;
    const L = { id, place, lat: g.lat, lon: g.lon, ordinance: r.ordinance, added: Date.now() }; // no names stored
    lights.push(L); stats.added++; save();
    const pub = JSON.stringify({ place: L.place, lat: L.lat, lon: L.lon });
    for (const c of sseClients) c.write('data: ' + pub + '\n\n');
  }
  return stats;
}
const publicLights = () => lights.map(l => ({ place: l.place, lat: l.lat, lon: l.lon }));

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/api/upload') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 5e6) req.destroy(); });
    req.on('end', async () => {
      try { const s = await ingest(body); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(s)); }
      catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    }); return;
  }
  if (u.pathname === '/api/lights') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(publicLights())); }
  if (u.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': hi\n\n'); sseClients.add(res); req.on('close', () => sseClients.delete(res)); return;
  }
  const f = { '/': 'upload.html', '/tv': 'tv.html' }[u.pathname];
  if (u.pathname === '/world.geojson') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' }); return res.end(fs.readFileSync(path.join(__dirname, 'public', 'world.geojson'))); }
  if (f) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(__dirname, 'public', f))); }
  res.writeHead(404); res.end('not found');
});
if (require.main === module) {
  if (process.argv[2] === 'ingest') ingest(fs.readFileSync(process.argv[3], 'utf8')).then(s => console.log(JSON.stringify(s, null, 2)));
  else server.listen(PORT, () => console.log('http://localhost:' + PORT + '  (TV: /tv)'));
}
