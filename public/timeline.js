// Timeline playback for the TV page. The past 12 months play in order,
// then lights with no parsed date, then a short hold before the cycle restarts.
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
    if (!text) return 'Date unknown';
    const year = Number(text.slice(0, 4));
    const index = Number(text.slice(5, 7)) - 1;
    return NAMES[index] + ' ' + year;
  }

  function frameIndex(month, now, count) {
    const months = monthsEnding(now, count);
    const text = normalizeMonth(month);
    if (!text) return months.length;
    const index = months.indexOf(text);
    if (index >= 0) return index;
    if (text < months[0]) return 0;
    return months.length - 1;
  }

  function byCreated(a, b) {
    return (Number(a.created) || 0) - (Number(b.created) || 0);
  }

  function schedule(lights, now, count) {
    const months = monthsEnding(now, count);
    const buckets = new Map(months.map(month => [month, []]));
    const undated = [];
    for (const light of lights || []) {
      const month = normalizeMonth(light && light.month);
      if (!month) {
        undated.push(light);
        continue;
      }
      if (month < months[0]) buckets.get(months[0]).push(light);
      else if (buckets.has(month)) buckets.get(month).push(light);
      else buckets.get(months[months.length - 1]).push(light);
    }
    for (const list of buckets.values()) list.sort(byCreated);
    undated.sort(byCreated);
    const frames = months.map(month => ({ month, label: labelFor(month), lights: buckets.get(month) }));
    frames.push({ month: null, label: 'Date unknown', lights: undated });
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

  return { monthsEnding, labelFor, frameIndex, schedule, buildScript, timing };
});
