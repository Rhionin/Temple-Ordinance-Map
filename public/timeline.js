// Timeline playback for the TV page. The past 12 months play in order,
// then a short hold before the cycle restarts. A light with no month is
// placed in one of those months by a stable hash so the page never shows
// an unknown-date step.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Timeline = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

  function normalizeMonth(value) {
    if (value == null) return null;
    const text = String(value).trim();
    return MONTH_RE.test(text) ? text : null;
  }

  function monthsEnding(now, count) {
    const total = Math.max(1, count || 12);
    const date = new Date(now);
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const months = [];
    for (let i = total - 1; i >= 0; i--) {
      const cursor = new Date(end);
      cursor.setUTCMonth(cursor.getUTCMonth() - i);
      months.push(cursor.getUTCFullYear() + '-' + String(cursor.getUTCMonth() + 1).padStart(2, '0'));
    }
    return months;
  }

  function labelFor(month) {
    const text = normalizeMonth(month);
    if (!text) return '';
    const year = Number(text.slice(0, 4));
    const index = Number(text.slice(5, 7)) - 1;
    return NAMES[index] + ' ' + year;
  }

  // Person id when a caller still has one, otherwise the public place and
  // the light's own created time. The same light always lands in the same
  // slot of the twelve-month window.
  function slotKey(light) {
    if (!light || typeof light !== 'object') return '';
    const id = light.id || light.person_id;
    if (id) return 'id:' + String(id);
    return [
      'place',
      light.place || '',
      light.created != null ? light.created : '',
      light.lat != null ? light.lat : '',
      light.lon != null ? light.lon : '',
    ].join('|');
  }

  function slotFor(light, count) {
    const total = Math.max(1, count || 12);
    const text = slotKey(light);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) % total;
  }

  function placedIndex(source, months) {
    const light = source && typeof source === 'object' ? source : null;
    const month = normalizeMonth(light ? light.month : source);
    if (!month) return slotFor(light, months.length);
    const index = months.indexOf(month);
    if (index >= 0) return index;
    if (month < months[0]) return 0;
    return months.length - 1;
  }

  function frameIndex(source, now, count) {
    return placedIndex(source, monthsEnding(now, count));
  }

  function byCreated(a, b) {
    return (Number(a.created) || 0) - (Number(b.created) || 0);
  }

  function schedule(lights, now, count) {
    const months = monthsEnding(now, count);
    const buckets = new Map(months.map(month => [month, []]));
    for (const light of lights || []) {
      buckets.get(months[placedIndex(light, months)]).push(light);
    }
    for (const list of buckets.values()) list.sort(byCreated);
    const frames = months.map(month => ({ month, label: labelFor(month), lights: buckets.get(month) }));
    return { months, frames };
  }

  function timing(cycleMs) {
    const cycle = Math.max(12000, Number(cycleMs) || 75000);
    const fadeMs = 2000;
    const holdMs = Math.max(4000, Math.round(cycle * 0.12));
    const playMs = cycle - holdMs - fadeMs;
    return { cycle, fadeMs, holdMs, playMs };
  }

  function buildScript(lights, now, cycleMs, count) {
    const clock = timing(cycleMs);
    const plan = schedule(lights, now, count);
    const slot = clock.playMs / plan.frames.length;
    const events = [];
    plan.frames.forEach((frame, index) => {
      const start = slot * index;
      events.push({ t: start, type: 'frame', label: frame.label, month: frame.month, index, lights: frame.lights });
      const step = frame.lights.length ? slot / frame.lights.length : slot;
      frame.lights.forEach((light, lightIndex) => {
        events.push({ t: start + step * lightIndex, type: 'reveal', light, index });
      });
    });
    const played = clock.playMs;
    events.push({ t: played, type: 'hold', label: 'This year' });
    events.push({ t: played + clock.holdMs, type: 'fade' });
    events.push({ t: clock.cycle, type: 'restart' });
    return { events, total: clock.cycle, frames: plan.frames, holdMs: clock.holdMs, fadeMs: clock.fadeMs };
  }

  return { monthsEnding, labelFor, frameIndex, slotFor, schedule, buildScript, timing };
});
