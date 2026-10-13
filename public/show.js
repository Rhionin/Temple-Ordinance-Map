// Five-minute TV show. The time-lapse keeps the twelve-month pace: each
// extra month of the data window adds the same slice. Past five minutes,
// that time-lapse is compressed so the cycle still ends on time. The
// remainder spotlights lights.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Show = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SHOW_MS = 5 * 60 * 1000;
  const BASE_MONTHS = 12;
  const BASE_MS = 75000;

  function naturalTimelineMs(months, baseMs) {
    const count = Math.max(1, Math.round(Number(months)) || BASE_MONTHS);
    const base = Number(baseMs) > 0 ? Number(baseMs) : BASE_MS;
    return Math.max(12000, Math.round(base * count / BASE_MONTHS));
  }

  function planCycle(naturalMs, showMs) {
    const show = Number(showMs) > 0 ? Number(showMs) : SHOW_MS;
    const natural = Math.max(0, Number(naturalMs) || 0);
    const timelineMs = Math.min(natural, show);
    return {
      showMs: show,
      naturalMs: natural,
      timelineMs,
      spotlightMs: show - timelineMs,
      compressed: natural > show,
    };
  }

  return { SHOW_MS, BASE_MONTHS, BASE_MS, naturalTimelineMs, planCycle };
});
