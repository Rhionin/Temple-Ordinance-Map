// One step of the geocode queue. At most one Nominatim fetch, and never sooner
// than MIN_GAP_MS after the previous fetch. Cache hits and known misses do not
// count as a request.
const { candidates } = require('./places');

const MIN_GAP_MS = 1100;

function retryDelay(status, minGap = MIN_GAP_MS) {
  if (status === 401 || status === 403 || status === 429 || status === 503) return 60_000;
  return Math.max(minGap, 5000);
}

function planStep({ job, cache, lastFetch, now, minGap = MIN_GAP_MS }) {
  if (!job) return { type: 'idle' };
  const list = candidates(job.place);
  let idx = job.cursor || 0;
  while (idx < list.length) {
    const query = list[idx];
    if (!Object.prototype.hasOwnProperty.call(cache, query)) {
      const wait = (lastFetch || 0) + minGap - now;
      if (lastFetch && wait > 0) return { type: 'wait', wait };
      return { type: 'fetch', query, index: idx };
    }
    if (cache[query]) return { type: 'hit', query, index: idx, coord: cache[query] };
    idx++;
  }
  return { type: 'miss' };
}

// Drive a queue the way the Durable Object alarm does: cache-only progress is
// free, and each network lookup is followed by a gap before the next one.
function simulateGeocode(jobs, lookup, start = 0) {
  const cache = {};
  const pending = jobs.map(job => ({ ...job, cursor: job.cursor || 0, status: 'pending' }));
  const calls = [];
  const lights = [];
  let now = start;
  let lastFetch = 0;
  let guard = 0;
  while (pending.some(job => job.status === 'pending')) {
    if (++guard > 10000) throw new Error('geocode simulation did not finish');
    const job = pending.find(item => item.status === 'pending');
    const plan = planStep({ job, cache, lastFetch, now });
    if (plan.type === 'wait') { now += plan.wait; continue; }
    if (plan.type === 'hit') {
      lights.push({ id: job.id, place: job.place, ordinance: job.ordinance || '', lat: plan.coord.lat, lon: plan.coord.lon });
      job.status = 'done';
      continue;
    }
    if (plan.type === 'miss') { job.status = 'failed'; continue; }
    calls.push({ t: now, query: plan.query });
    const coord = lookup(plan.query);
    cache[plan.query] = coord || null;
    lastFetch = now;
    if (coord) {
      lights.push({ id: job.id, place: job.place, ordinance: job.ordinance || '', lat: coord.lat, lon: coord.lon });
      job.status = 'done';
    } else {
      job.cursor = plan.index + 1;
    }
    if (pending.some(item => item.status === 'pending')) now += MIN_GAP_MS;
  }
  return { calls, lights, pending };
}

module.exports = { MIN_GAP_MS, planStep, simulateGeocode, retryDelay };
