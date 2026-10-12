// Temple ordinance map. Zero dependencies (Node 18+).
// Local dev geocodes before the upload response returns. The Worker queues the
// same rows and resolves them in the background.
const http = require('http'), fs = require('fs'), path = require('path');
const { handleApi } = require('./lib/http');
const { securityHeaders } = require('./lib/headers');
const { planUpload } = require('./lib/upload');
const { candidates } = require('./lib/places');
const { nominatimUrl, parseNominatimBody } = require('./lib/nominatim');
const { MIN_GAP_MS } = require('./lib/geostep');
const { toPublic, nextCreated } = require('./lib/lights');
const { serializeOrdinances } = require('./lib/ordinances');
const { analyze, parseDate } = require('./lib/fscsv');

const PORT = process.env.PORT || 3000;
const DATA = path.join(__dirname, 'data');
const CACHE_F = path.join(DATA, 'geocache.json'), LIGHTS_F = path.join(DATA, 'lights.json'), UNRES_F = path.join(DATA, 'unresolved.log');
const UA = process.env.GEOCODE_UA || 'temple-ordinance-map/1.0';
const load = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
let cache = load(CACHE_F, {}), lights = load(LIGHTS_F, []);
const save = () => {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CACHE_F, JSON.stringify(cache, null, 1));
  fs.writeFileSync(LIGHTS_F, JSON.stringify(lights));
};

let last = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function nominatim(query) {
  if (Object.prototype.hasOwnProperty.call(cache, query)) return cache[query];
  const wait = last + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  try {
    const res = await fetch(nominatimUrl(query), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) { console.error(JSON.stringify({ event: 'geocode_http', status: res.status, query })); return null; }
    const coord = parseNominatimBody(await res.json());
    cache[query] = coord;
    save();
    return coord;
  } catch (error) {
    console.error(JSON.stringify({ event: 'geocode_error', query, message: error.message }));
    return null;
  }
}
async function geocode(place) {
  for (const query of candidates(place)) {
    const coord = await nominatim(query);
    if (coord) return { ...coord, matched: query };
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(UNRES_F, new Date().toISOString() + '\t' + place + '\n');
  return null;
}

const sseClients = new Set();
function publish(light) {
  const body = JSON.stringify(toPublic(light));
  for (const client of sseClients) client.write('data: ' + body + '\n\n');
}
function remember(light) {
  lights.push(light);
  save();
  publish(light);
}
function touch(light, ordinance, updated) {
  light.ordinance = ordinance;
  light.updated = updated;
  save();
  publish(light);
}

async function ingest(text) {
  const existing = lights.map(light => ({ id: light.id, ordinance: light.ordinance }));
  const plan = planUpload(text, { existing, cache });
  if (!plan.ok) {
    const error = new Error(plan.reason);
    error.status = 400;
    throw error;
  }
  const parsed = analyze(text);
  if (parsed.ok) {
    for (const record of parsed.records) {
      if (!parseDate(record.dateText)) {
        fs.mkdirSync(DATA, { recursive: true });
        fs.appendFileSync(UNRES_F, new Date().toISOString() + '\tUNPARSED DATE\t' + record.dateText + '\n');
      }
    }
  }
  let created = lights.reduce((max, light) => Math.max(max, light.updated || 0, light.created || light.added || 0), 0);
  for (const merge of plan.merges || []) {
    const light = lights.find(item => item.id === merge.id);
    if (!light) continue;
    created = nextCreated(Date.now(), created);
    touch(light, serializeOrdinances(merge.ordinances), created);
  }
  for (const row of plan.immediate) {
    created = nextCreated(Date.now(), created);
    remember({ id: row.id, place: row.place, lat: row.lat, lon: row.lon, ordinance: row.ordinance, created, updated: created });
  }
  for (const job of plan.pending) {
    const coord = await geocode(job.place);
    plan.stats.queued--;
    if (!coord) { plan.stats.unresolved.push(job.place); continue; }
    created = nextCreated(Date.now(), created);
    remember({ id: job.id, place: job.place, lat: coord.lat, lon: coord.lon, ordinance: job.ordinance, created, updated: created });
    plan.stats.added++;
    plan.stats.geocoded++;
  }
  return plan.stats;
}

const fileStore = {
  async listLights(since) {
    const min = Number(since) || 0;
    return lights.filter(light => Math.max(light.updated || 0, light.created || light.added || 0) > min);
  },
  async clearLights() {
    lights = [];
    save();
  },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 5e6) { req.destroy(); reject(Object.assign(new Error('file too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function send(res, response) {
  response.arrayBuffer().then(buf => {
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    res.writeHead(response.status, headers);
    res.end(Buffer.from(buf));
  });
}

const server = http.createServer(async (req, res) => {
  const writeHead = res.writeHead;
  res.writeHead = function (status, headers) {
    const merged = headers && typeof headers === 'object' ? { ...headers } : {};
    for (const [key, value] of Object.entries(securityHeaders())) {
      const present = Object.keys(merged).some(name => name.toLowerCase() === key.toLowerCase());
      if (!present) merged[key] = value;
    }
    return writeHead.call(this, status, merged);
  };
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api/upload') {
    try {
      const body = await readBody(req);
      const stats = await ingest(body.toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(stats));
    } catch (error) {
      const status = error.status || 400;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? 'server error' : error.message }));
    }
    return;
  }
  if (url.pathname === '/api/lights' || url.pathname === '/api/reset') {
    const request = new Request(url, { method: req.method, headers: req.headers });
    return send(res, await handleApi(request, { store: fileStore, resetToken: process.env.RESET_TOKEN || '' }));
  }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  const script = { '/spotlight.js': 'spotlight.js', '/upload-status.js': 'upload-status.js' }[url.pathname];
  if (script) {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', script)));
  }
  const page = { '/': 'upload.html', '/tv': 'tv.html' }[url.pathname];
  if (url.pathname === '/world.geojson') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'world.geojson')));
  }
  if (page) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', page)));
  }
  res.writeHead(404);
  res.end('not found');
});

if (require.main === module) {
  if (process.argv[2] === 'ingest') ingest(fs.readFileSync(process.argv[3], 'utf8')).then(stats => console.log(JSON.stringify(stats, null, 2)));
  else server.listen(PORT, () => console.log('http://localhost:' + PORT + '  (TV: /tv)'));
}

module.exports = { server, ingest };
