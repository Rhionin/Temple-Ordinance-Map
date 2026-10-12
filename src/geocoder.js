import { DurableObject } from 'cloudflare:workers';
import { planStep, retryDelay, MIN_GAP_MS } from '../lib/geostep.js';
import { candidates } from '../lib/places.js';
import { nominatimUrl, parseNominatimBody } from '../lib/nominatim.js';
import { nextCreated } from '../lib/lights.js';

// One Durable Object paces every Nominatim call for the map. A single
// coordinator is the rate-limit atom: parallel uploads must still stay at or
// under one request per second. Lights themselves live in D1.
export class Geocoder extends DurableObject {
  async kick() {
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null) await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    const db = this.env.DB;
    const ua = this.env.GEOCODE_UA;
    if (!ua) {
      console.error(JSON.stringify({ event: 'geocode_skipped', reason: 'GEOCODE_UA unset' }));
      const pending = await db.prepare("SELECT person_id FROM jobs WHERE status = 'pending' LIMIT 1").first();
      if (pending) await this.ctx.storage.setAlarm(Date.now() + 60_000);
      return;
    }

    let lastFetch = (await this.ctx.storage.get('lastFetch')) || 0;
    for (let step = 0; step < 40; step++) {
      const job = await db.prepare(
        "SELECT person_id, place, ordinance, created, cursor_idx FROM jobs WHERE status = 'pending' ORDER BY created, person_id LIMIT 1"
      ).first();
      if (!job) return;

      const cache = await cacheForPlace(db, job.place);
      const now = Date.now();
      const plan = planStep({
        job: { place: job.place, cursor: job.cursor_idx || 0 },
        cache,
        lastFetch,
        now,
      });

      if (plan.type === 'wait') {
        await this.ctx.storage.setAlarm(now + plan.wait);
        return;
      }
      if (plan.type === 'hit') {
        await finishLight(db, job, plan.coord);
        continue;
      }
      if (plan.type === 'miss') {
        await db.prepare("UPDATE jobs SET status = 'failed' WHERE person_id = ? AND status = 'pending'").bind(job.person_id).run();
        console.log(JSON.stringify({ event: 'geocode_unresolved', place: job.place }));
        continue;
      }

      let coord = null;
      try {
        const res = await fetch(nominatimUrl(plan.query), {
          headers: { 'User-Agent': ua, Accept: 'application/json' },
        });
        lastFetch = Date.now();
        await this.ctx.storage.put('lastFetch', lastFetch);
        if (res.ok) {
          coord = parseNominatimBody(await res.json());
        } else {
          console.error(JSON.stringify({ event: 'geocode_http', status: res.status, query: plan.query }));
          await this.ctx.storage.setAlarm(Date.now() + retryDelay(res.status));
          return;
        }
      } catch (error) {
        lastFetch = Date.now();
        await this.ctx.storage.put('lastFetch', lastFetch);
        console.error(JSON.stringify({ event: 'geocode_error', query: plan.query, message: error.message }));
        await this.ctx.storage.setAlarm(Date.now() + retryDelay(0));
        return;
      }

      await db.prepare(
        `INSERT INTO geocache (query, lat, lon, cached_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(query) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, cached_at = excluded.cached_at`
      ).bind(plan.query, coord ? coord.lat : null, coord ? coord.lon : null, Date.now()).run();

      if (coord) await finishLight(db, job, coord);
      else {
        await db.prepare(
          "UPDATE jobs SET cursor_idx = ? WHERE person_id = ? AND status = 'pending'"
        ).bind(plan.index + 1, job.person_id).run();
      }

      const more = await db.prepare("SELECT person_id FROM jobs WHERE status = 'pending' LIMIT 1").first();
      if (more) await this.ctx.storage.setAlarm(Date.now() + MIN_GAP_MS);
      return;
    }
  }
}

async function cacheForPlace(db, place) {
  const queries = candidates(place);
  const cache = {};
  if (!queries.length) return cache;
  const marks = queries.map(() => '?').join(',');
  const rows = await db.prepare(`SELECT query, lat, lon FROM geocache WHERE query IN (${marks})`).bind(...queries).all();
  for (const row of rows.results || []) {
    cache[row.query] = row.lat == null || row.lon == null ? null : { lat: row.lat, lon: row.lon };
  }
  return cache;
}

async function finishLight(db, job, coord) {
  const row = await db.prepare('SELECT MAX(created) AS created, MAX(updated) AS updated FROM lights').first();
  const created = nextCreated(Date.now(), Math.max((row && row.created) || 0, (row && row.updated) || 0));
  await db.batch([
    db.prepare(
      `INSERT INTO lights (person_id, place, lat, lon, ordinance, created, updated)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM jobs WHERE person_id = ? AND status = 'pending')
       ON CONFLICT(person_id) DO NOTHING`
    ).bind(job.person_id, job.place, coord.lat, coord.lon, job.ordinance || '', created, created, job.person_id),
    db.prepare("UPDATE jobs SET status = 'done' WHERE person_id = ? AND status = 'pending'").bind(job.person_id),
  ]);
}
