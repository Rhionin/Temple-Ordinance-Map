import { DurableObject } from 'cloudflare:workers';
import { runGeocodeAlarm } from '../lib/geocode-alarm.js';

// One Durable Object paces every Nominatim call for the map. A single
// coordinator is the rate-limit atom: parallel uploads must still stay at or
// under one request per second. Lights themselves live in D1.
export class Geocoder extends DurableObject {
  async kick() {
    const existing = await this.ctx.storage.getAlarm();
    if (existing == null) await this.ctx.storage.setAlarm(Date.now());
  }

  async alarm() {
    await runGeocodeAlarm({
      db: this.env.DB,
      storage: this.ctx.storage,
      ua: this.env.GEOCODE_UA,
      fetchImpl: globalThis.fetch.bind(globalThis),
    });
  }
}
