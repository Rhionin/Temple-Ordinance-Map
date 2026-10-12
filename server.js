// Temple ordinance map. Zero dependencies (Node 18+).
// Local dev geocodes before the upload response returns. The Worker queues the
// same rows and resolves them in the background.
const http = require('http'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { handleApi } = require('./lib/http');
const { securityHeaders } = require('./lib/headers');
const { resolveBuildId } = require('./lib/build-id');
const { planUpload } = require('./lib/upload');
const { candidates } = require('./lib/places');
const { nominatimUrl, parseNominatimBody } = require('./lib/nominatim');
const { MIN_GAP_MS } = require('./lib/geostep');
const { toPublic, nextCreated } = require('./lib/lights');
const { serializeOrdinances } = require('./lib/ordinances');
const { analyze, parseDate } = require('./lib/fscsv');
const { countryForLight, fillCountries } = require('./lib/country');
const { tally } = require('./lib/stats');
const { countsAsShare, sharerBasis, hashSharer } = require('./lib/sharers');
const { publicGroup, uploadsAllowed, onMaster } = require('./lib/groups');
const { foldLights } = require('./lib/fold');
const { localDirectory } = require('./lib/local-groups');
const { planLimitReason, recentLimitReason, RECENT_MS } = require('./lib/quota');

const PORT = process.env.PORT || 3000;
const PUBLIC_ROOT = path.join(__dirname, 'public');
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function publicFile(urlPath) {
  let decoded = urlPath;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  const target = path.normalize(path.join(PUBLIC_ROOT, decoded));
  if (target !== PUBLIC_ROOT && !target.startsWith(PUBLIC_ROOT + path.sep)) return null;
  try {
    if (!fs.statSync(target).isFile()) return null;
  } catch {
    return null;
  }
  return target;
}
const DATA = path.join(__dirname, 'data');
const CACHE_F = path.join(DATA, 'geocache.json'), LIGHTS_F = path.join(DATA, 'lights.json'), SHARERS_F = path.join(DATA, 'sharers.json'), GROUPS_F = path.join(DATA, 'groups.json'), UNRES_F = path.join(DATA, 'unresolved.log');
const UA = process.env.GEOCODE_UA || 'temple-ordinance-map/1.0';
const load = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
let cache = load(CACHE_F, {}), lights = load(LIGHTS_F, []), sharers = new Set(load(SHARERS_F, []));
const groupRows = load(GROUPS_F, []);
const save = () => {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(CACHE_F, JSON.stringify(cache, null, 1));
  fs.writeFileSync(LIGHTS_F, JSON.stringify(lights));
  fs.writeFileSync(SHARERS_F, JSON.stringify([...sharers]));
  fs.writeFileSync(GROUPS_F, JSON.stringify(groupRows));
};
const groups = localDirectory(groupRows, save);
function partyGroup() {
  const existing = groupRows.find(group => group.slug === 'party');
  if (existing) return existing;
  const row = {
    id: groupRows.reduce((max, group) => Math.max(max, group.id || 0), 0) + 1,
    slug: 'party', title: '', subtitle: '', months: 12,
    uploads_open: null, uploads_close: null, admin_token_hash: '',
    disabled: 0, deleted: 0, created: Date.now(),
  };
  groupRows.push(row);
  save();
  return row;
}
const party = partyGroup();
for (const light of lights) if (!light.groupId) light.groupId = party.id;
function inGroup(light, groupId) {
  return (light.groupId || party.id) === groupId;
}

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
function touch(light, ordinance, updated, month, completed) {
  light.ordinance = ordinance;
  light.updated = updated;
  if (month && (!light.month || month < light.month)) {
    light.month = month;
    if (completed) light.completed = completed;
  }
  save();
  publish(light);
}

async function ingest(text, sharerHeader, groupId = party.id) {
  const mine = lights.filter(light => inGroup(light, groupId));
  const existing = mine.map(light => ({ id: light.id, ordinance: light.ordinance, month: light.month || null, completed: light.completed || null }));
  const plan = planUpload(text, { existing, cache });
  if (!plan.ok) {
    const error = new Error(plan.reason);
    error.status = 400;
    throw error;
  }
  const limited = planLimitReason(plan);
  if (limited) {
    const error = new Error(limited);
    error.status = 413;
    throw error;
  }
  const incoming = plan.immediate.length + plan.pending.length;
  const recent = lights.filter(light => (light.created || 0) > Date.now() - RECENT_MS).length;
  const busy = recentLimitReason(recent, incoming);
  if (busy) {
    const error = new Error(busy);
    error.status = 429;
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
    const light = lights.find(item => item.id === merge.id && inGroup(item, groupId));
    if (!light) continue;
    created = nextCreated(Date.now(), created);
    touch(light, serializeOrdinances(merge.ordinances), created, merge.month || null, merge.completed || null);
  }
  for (const fix of plan.monthFixes || []) {
    const light = lights.find(item => item.id === fix.id && inGroup(item, groupId));
    if (!light || !fix.month || (light.month && light.month <= fix.month)) continue;
    created = nextCreated(Date.now(), created);
    touch(light, light.ordinance, created, fix.month, fix.completed || null);
  }
  for (const row of plan.immediate) {
    created = nextCreated(Date.now(), created);
    remember({ id: row.id, groupId, place: row.place, lat: row.lat, lon: row.lon, ordinance: row.ordinance, month: row.month || null, completed: row.completed || null, country: countryForLight(row), created, updated: created });
  }
  for (const job of plan.pending) {
    const coord = await geocode(job.place);
    plan.stats.queued--;
    if (!coord) { plan.stats.unresolved.push(job.place); continue; }
    created = nextCreated(Date.now(), created);
    remember({ id: job.id, groupId, place: job.place, lat: coord.lat, lon: coord.lon, ordinance: job.ordinance, month: job.month || null, completed: job.completed || null, country: countryForLight(coord), created, updated: created });
    plan.stats.added++;
    plan.stats.geocoded++;
  }
  if (countsAsShare(plan.stats)) {
    const hash = await hashSharer(sharerBasis(sharerHeader, text));
    if (hash && !sharers.has(hash)) { sharers.add(hash); save(); }
  }
  return plan.stats;
}

function fileStoreFor(groupId) {
  return {
    async listLights(since) {
      const min = Number(since) || 0;
      return lights.filter(light => inGroup(light, groupId) && Math.max(light.updated || 0, light.created || light.added || 0) > min);
    },
    async stats() {
      const mine = lights.filter(light => inGroup(light, groupId));
      const updates = fillCountries(mine);
      if (updates.length) save();
      return { ...tally(mine), sharers: 0 };
    },
    async clearLights() {
      lights = lights.filter(light => !inGroup(light, groupId));
      save();
    },
  };
}
groups.store = fileStoreFor;

function visibleLights() {
  return lights.filter(light => {
    const group = groupRows.find(item => item.id === (light.groupId || party.id));
    return onMaster(group);
  });
}

const master = {
  async listLights(since) {
    const min = Number(since) || 0;
    return foldLights(visibleLights()).filter(row => Math.max(Number(row.updated) || 0, Number(row.created) || 0) > min);
  },
  async stats() {
    return { ...tally(foldLights(visibleLights())), sharers: sharers.size };
  },
};

const fileStore = {
  async listLights(since) {
    return fileStoreFor(party.id).listLights(since);
  },
  async clearLights() {
    lights = lights.filter(light => !inGroup(light, party.id));
    save();
  },
  async noteSharer(hash) {
    if (!hash || sharers.has(hash)) return;
    sharers.add(hash);
    save();
  },
  async stats() {
    const body = await fileStoreFor(party.id).stats();
    return { ...body, sharers: sharers.size };
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
      const stats = await ingest(body.toString('utf8'), req.headers['x-sharer']);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(stats));
    } catch (error) {
      const status = error.status || 400;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? 'server error' : error.message }));
    }
    return;
  }
  if (req.method === 'POST' && url.pathname === '/api/groups') {
    const body = await readBody(req);
    const request = new Request(url, { method: 'POST', headers: req.headers, body });
    return send(res, await handleApi(request, {
      store: fileStore,
      groups,
      resetToken: process.env.RESET_TOKEN || '',
      resetPin: process.env.RESET_PIN || '1337',
    }));
  }
  const groupApi = url.pathname.match(/^\/g\/([^/]+)\/api\/([a-z]+(?:\/[a-z]+)?)\/?$/);
  if (groupApi) {
    let slug = groupApi[1];
    try { slug = decodeURIComponent(slug); } catch (error) { slug = ''; }
    const group = await groups.find(slug);
    if (!publicGroup(group)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: 'not found' }));
    }
    if (req.method === 'POST' && groupApi[2] === 'upload') {
      if (!uploadsAllowed(group, Date.now())) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: 'uploads are closed for this group' }));
      }
      try {
        const body = await readBody(req);
        const stats = await ingest(body.toString('utf8'), req.headers['x-sharer'], group.id);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(stats));
      } catch (error) {
        const status = error.status || 400;
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: status === 500 ? 'server error' : error.message }));
      }
      return;
    }
    const init = { method: req.method, headers: req.headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await readBody(req);
    const request = new Request(url, init);
    return send(res, await handleApi(request, {
      store: fileStore,
      groups,
      resetToken: process.env.RESET_TOKEN || '',
      resetPin: process.env.RESET_PIN || '1337',
    }));
  }
  if (url.pathname === '/api/lights' || url.pathname === '/api/reset' || url.pathname === '/api/stats') {
    const init = { method: req.method, headers: req.headers };
    if (req.method === 'POST' && url.pathname === '/api/reset') init.body = await readBody(req);
    const request = new Request(url, init);
    return send(res, await handleApi(request, {
      store: url.pathname === '/api/reset' ? fileStore : master,
      resetToken: process.env.RESET_TOKEN || '',
      resetPin: process.env.RESET_PIN || '1337',
    }));
  }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': hi\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  const script = { '/spotlight.js': 'spotlight.js', '/upload-status.js': 'upload-status.js', '/timeline.js': 'timeline.js', '/version.js': 'version.js' }[url.pathname];
  if (script) {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', script)));
  }
  if (url.pathname === '/new') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'new.html')));
  }
  const groupPage = url.pathname.match(/^\/g\/([^/]+)(\/map|\/admin)?\/?$/);
  if (groupPage) {
    let slug = groupPage[1];
    try { slug = decodeURIComponent(slug); } catch (error) { slug = ''; }
    const group = await groups.find(slug);
    if (!publicGroup(group)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    const file = groupPage[2] === '/map' ? 'tv.html' : groupPage[2] === '/admin' ? 'group-admin.html' : 'upload.html';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', file)));
  }
  const page = { '/': 'tv.html' }[url.pathname];
  if (url.pathname === '/world.geojson') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'world.geojson')));
  }
  if (page) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', page)));
  }
  if (url.pathname === '/api/version') {
    const request = new Request(url, { method: req.method, headers: req.headers });
    const buildId = resolveBuildId(process.env.BUILD_ID, () => execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      cwd: __dirname,
    }));
    return send(res, await handleApi(request, {
      store: fileStore,
      resetToken: process.env.RESET_TOKEN || '',
      resetPin: process.env.RESET_PIN || '1337',
      buildId,
    }));
  }
  const asset = publicFile(url.pathname);
  if (asset) {
    const type = TYPES[path.extname(asset)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' });
    return res.end(fs.readFileSync(asset));
  }
  res.writeHead(404);
  res.end('not found');
});

if (require.main === module) {
  if (process.argv[2] === 'ingest') ingest(fs.readFileSync(process.argv[3], 'utf8')).then(stats => console.log(JSON.stringify(stats, null, 2)));
  else server.listen(PORT, () => console.log('http://localhost:' + PORT + '  (map: /)'));
}

module.exports = { server, ingest, publicFile };
