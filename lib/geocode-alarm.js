const { planStep, retryDelay, MIN_GAP_MS } = require('./geostep');
const { candidates } = require('./places');
const { loadGeocache } = require('./query-cache');
const { nominatimUrl, parseNominatimBody } = require('./nominatim');
const { nextCreated } = require('./lights');
const { countryForLight } = require('./country');

const BATCH_LIMIT = 40;

async function runGeocodeAlarm({ db, storage, ua, fetchImpl, now = Date.now }) {
  if (!ua) {
    console.error(JSON.stringify({ event: 'geocode_skipped', reason: 'GEOCODE_UA unset' }));
    const pending = await db.prepare("SELECT person_id FROM jobs WHERE status = 'pending' LIMIT 1").first();
    if (pending) await storage.setAlarm(now() + 60_000);
    return;
  }

  let lastFetch = (await storage.get('lastFetch')) || 0;
  for (let step = 0; step < BATCH_LIMIT; step++) {
    const job = await db.prepare(
      "SELECT group_id, person_id, place, ordinance, created, cursor_idx, month, completed FROM jobs WHERE status = 'pending' ORDER BY created, group_id, person_id LIMIT 1"
    ).first();
    if (!job) return;

    const cache = await cacheForPlace(db, job.place);
    const plan = planStep({
      job: { place: job.place, cursor: job.cursor_idx || 0 },
      cache,
      lastFetch,
      now: now(),
    });

    if (plan.type === 'wait') {
      await storage.setAlarm(now() + plan.wait);
      return;
    }
    if (plan.type === 'hit') {
      await finishLight(db, job, plan.coord, now);
      continue;
    }
    if (plan.type === 'miss') {
      await db.prepare("UPDATE jobs SET status = 'failed' WHERE group_id = ? AND person_id = ? AND status = 'pending'").bind(job.group_id, job.person_id).run();
      console.log(JSON.stringify({ event: 'geocode_unresolved', place: job.place }));
      continue;
    }

    let coord = null;
    try {
      const res = await fetchImpl(nominatimUrl(plan.query), {
        headers: { 'User-Agent': ua, Accept: 'application/json' },
      });
      lastFetch = now();
      await storage.put('lastFetch', lastFetch);
      if (res.ok) {
        coord = parseNominatimBody(await res.json());
      } else {
        console.error(JSON.stringify({ event: 'geocode_http', status: res.status, query: plan.query }));
        await storage.setAlarm(now() + retryDelay(res.status));
        return;
      }
    } catch (error) {
      lastFetch = now();
      await storage.put('lastFetch', lastFetch);
      console.error(JSON.stringify({ event: 'geocode_error', query: plan.query, message: error.message }));
      await storage.setAlarm(now() + retryDelay(0));
      return;
    }

    await db.prepare(
      `INSERT INTO geocache (query, lat, lon, country, cached_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(query) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, country = excluded.country, cached_at = excluded.cached_at`
    ).bind(plan.query, coord ? coord.lat : null, coord ? coord.lon : null, coord && coord.country ? coord.country : null, now()).run();

    if (coord) await finishLight(db, job, coord, now);
    else {
      await db.prepare(
        "UPDATE jobs SET cursor_idx = ? WHERE group_id = ? AND person_id = ? AND status = 'pending'"
      ).bind(plan.index + 1, job.group_id, job.person_id).run();
    }

    const more = await db.prepare("SELECT person_id FROM jobs WHERE status = 'pending' LIMIT 1").first();
    if (more) await storage.setAlarm(now() + MIN_GAP_MS);
    return;
  }

  await rearmIfJobsRemain(db, storage, now);
}

async function rearmIfJobsRemain(db, storage, now) {
  const leftover = await db.prepare("SELECT person_id FROM jobs WHERE status = 'pending' LIMIT 1").first();
  if (leftover) await storage.setAlarm(now());
}

async function cacheForPlace(db, place) {
  return loadGeocache(db, candidates(place));
}

async function finishLight(db, job, coord, now) {
  const row = await db.prepare('SELECT MAX(created) AS created, MAX(updated) AS updated FROM lights').first();
  const created = nextCreated(now(), Math.max((row && row.created) || 0, (row && row.updated) || 0));
  const country = countryForLight(coord);
  await db.batch([
    db.prepare(
      `INSERT INTO lights (person_id, place, lat, lon, ordinance, created, updated, month, country, completed, group_id)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM jobs WHERE group_id = ? AND person_id = ? AND status = 'pending')
       ON CONFLICT(group_id, person_id) DO NOTHING`
    ).bind(
      job.person_id, job.place, coord.lat, coord.lon, job.ordinance || '', created, created,
      job.month || null, country, job.completed || null, job.group_id, job.group_id, job.person_id
    ),
    db.prepare("UPDATE jobs SET status = 'done' WHERE group_id = ? AND person_id = ? AND status = 'pending'").bind(job.group_id, job.person_id),
  ]);
  try {
    const { invalidateGroupPoll } = await import('./poll-cache.js');
    invalidateGroupPoll(job.group_id);
  } catch (error) { /* local server without ESM poll cache */ }
}

module.exports = { runGeocodeAlarm, BATCH_LIMIT };
