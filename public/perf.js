// Opt-in meter for the map stage. The page calls install only for ?fps=1.
// Each animation frame writes one timestamp into a ring and returns.
// The overlay, the heap read, and the console line stay off that path.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PerfOverlay = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FPS_WINDOW_MS = 1000;
  const HISTORY_MS = 60000;
  const SAMPLE_MS = 1000;
  const LOG_MS = 10000;
  const LONG_FRAME_MS = 50;
  // One second at a few hundred frames per second, plus a little slack.
  const RING = 256;
  // One sample a second for 60s, and the sample that lands on the 60s edge.
  const SAMPLES = 61;

  function enabled(search) {
    const text = search == null ? '' : String(search);
    const query = text.charAt(0) === '?' ? text.slice(1) : text;
    return new URLSearchParams(query).get('fps') === '1';
  }

  function pick(scope, key, fallback) {
    if (scope && Object.prototype.hasOwnProperty.call(scope, key)) return scope[key];
    return fallback();
  }

  function round1(value) {
    return Math.round(Number(value) * 10) / 10;
  }

  function readHeap(perf) {
    const memory = perf && perf.memory;
    if (!memory || typeof memory.usedJSHeapSize !== 'number' || !Number.isFinite(memory.usedJSHeapSize)) return null;
    return memory.usedJSHeapSize;
  }

  function countRendered(entries) {
    if (!entries) return 0;
    let n = 0;
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.marker || entry.shown) n += 1;
    }
    return n;
  }

  function ringIndex(head, count, cap, i) {
    let idx = (head - count + i) % cap;
    if (idx < 0) idx += cap;
    return idx;
  }

  function createMonitor(options) {
    const opts = options || {};
    const log = typeof opts.log === 'function' ? opts.log : null;
    const stamps = new Float64Array(RING);
    let head = 0;
    let count = 0;
    let lastStamp = null;
    let longFrames = 0;
    let longTasks = null;
    const sampleFps = new Float64Array(SAMPLES);
    const sampleAt = new Float64Array(SAMPLES);
    let sampleHead = 0;
    let sampleCount = 0;
    let lastSampleAt = null;
    let lastLogAt = null;

    function rolling(time) {
      if (count < 2) return 0;
      const cutoff = time - FPS_WINDOW_MS;
      let n = 0;
      let oldest = 0;
      let newest = 0;
      for (let i = 0; i < count; i++) {
        const stamp = stamps[ringIndex(head, count, RING, i)];
        if (stamp < cutoff) continue;
        if (n === 0) oldest = stamp;
        newest = stamp;
        n += 1;
      }
      if (n < 2) return 0;
      const span = newest - oldest;
      if (span <= 0) return 0;
      return (n - 1) * 1000 / span;
    }

    function history(time) {
      const cutoff = time - HISTORY_MS;
      let n = 0;
      let min = 0;
      let sum = 0;
      for (let i = 0; i < sampleCount; i++) {
        const idx = ringIndex(sampleHead, sampleCount, SAMPLES, i);
        if (sampleAt[idx] < cutoff) continue;
        const fps = sampleFps[idx];
        if (n === 0 || fps < min) min = fps;
        sum += fps;
        n += 1;
      }
      if (!n) return null;
      return { min: min, avg: sum / n };
    }

    function snapshot(time) {
      const now = Number.isFinite(time) ? time : (lastStamp == null ? 0 : lastStamp);
      const fps = rolling(now);
      const hist = history(now);
      const phase = typeof opts.phase === 'function' ? opts.phase() : '';
      const lights = typeof opts.lights === 'function' ? opts.lights() : 0;
      const heap = typeof opts.memory === 'function' ? opts.memory() : null;
      const shown = Number(lights);
      return {
        fps: round1(fps),
        fpsMin: round1(hist ? hist.min : fps),
        fpsAvg: round1(hist ? hist.avg : fps),
        longFrames: longFrames,
        longTasks: longTasks,
        phase: phase == null ? '' : String(phase),
        lights: Number.isFinite(shown) ? shown : 0,
        heap: heap == null ? null : heap,
      };
    }

    function pushSample(time, fps) {
      sampleFps[sampleHead] = fps;
      sampleAt[sampleHead] = time;
      sampleHead += 1;
      if (sampleHead === SAMPLES) sampleHead = 0;
      if (sampleCount < SAMPLES) sampleCount += 1;
    }

    function frame(time) {
      if (!Number.isFinite(time)) return;
      if (lastStamp != null && time - lastStamp > LONG_FRAME_MS) longFrames += 1;
      lastStamp = time;
      stamps[head] = time;
      head += 1;
      if (head === RING) head = 0;
      if (count < RING) count += 1;

      if (lastSampleAt == null) lastSampleAt = time;
      else if (time - lastSampleAt >= SAMPLE_MS) {
        pushSample(time, rolling(time));
        lastSampleAt = time;
      }

      if (lastLogAt == null) lastLogAt = time;
      else if (time - lastLogAt >= LOG_MS) {
        lastLogAt = time;
        if (log) log(snapshot(time));
      }
    }

    function addLongTasks(n) {
      const add = Number(n) || 0;
      if (add <= 0) return;
      if (longTasks == null) longTasks = 0;
      longTasks += add;
    }

    function supportLongTasks(on) {
      longTasks = on ? 0 : null;
    }

    return { frame: frame, snapshot: snapshot, addLongTasks: addLongTasks, supportLongTasks: supportLongTasks };
  }

  function formatHeap(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1024).toFixed(1) + ' KB';
  }

  function formatOverlay(stats) {
    const lines = [
      stats.fps.toFixed(1) + ' fps   min ' + stats.fpsMin.toFixed(1) + '   avg ' + stats.fpsAvg.toFixed(1),
      'long frames ' + stats.longFrames + '   long tasks ' + (stats.longTasks == null ? 'n/a' : String(stats.longTasks)),
      (stats.phase || '-') + '   lights ' + stats.lights,
    ];
    if (stats.heap != null) lines.push('heap ' + formatHeap(stats.heap));
    return lines.join('\n');
  }

  function watchLongTasks(monitor, Observer) {
    if (!Observer || !Observer.supportedEntryTypes || Observer.supportedEntryTypes.indexOf('longtask') === -1) {
      monitor.supportLongTasks(false);
      return null;
    }
    try {
      const obs = new Observer(function (list) {
        const entries = list && typeof list.getEntries === 'function' ? list.getEntries() : null;
        if (entries && entries.length) monitor.addLongTasks(entries.length);
      });
      try {
        obs.observe({ type: 'longtask', buffered: false });
      } catch (error) {
        obs.observe({ entryTypes: ['longtask'] });
      }
      monitor.supportLongTasks(true);
      return obs;
    } catch (error) {
      monitor.supportLongTasks(false);
      return null;
    }
  }

  function install(hooks, env) {
    const scope = env || {};
    const win = pick(scope, 'window', function () { return typeof window !== 'undefined' ? window : null; });
    const loc = pick(scope, 'location', function () { return typeof location !== 'undefined' ? location : { search: '' }; });
    if (!enabled(loc && loc.search)) return false;
    if (win && typeof win.__perfStats === 'function') return true;

    const perf = pick(scope, 'performance', function () { return typeof performance !== 'undefined' ? performance : null; });
    const doc = pick(scope, 'document', function () { return typeof document !== 'undefined' ? document : null; });
    const con = pick(scope, 'console', function () { return typeof console !== 'undefined' ? console : null; });
    const raf = pick(scope, 'requestAnimationFrame', function () {
      if (win && typeof win.requestAnimationFrame === 'function') {
        return function (cb) { return win.requestAnimationFrame(cb); };
      }
      return null;
    });
    const Observer = pick(scope, 'PerformanceObserver', function () {
      return typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : null;
    });
    const source = hooks || {};
    const monitor = createMonitor({
      phase: source.phase,
      lights: source.lights,
      memory: function () { return readHeap(perf); },
      log: function (stats) {
        if (!con || typeof con.log !== 'function') return;
        con.log(JSON.stringify(stats));
      },
    });

    let el = null;
    const parent = doc && typeof doc.getElementById === 'function' ? doc.getElementById('stage') : null;
    if (parent && typeof doc.createElement === 'function') {
      el = doc.createElement('div');
      el.id = 'perf';
      if (typeof el.setAttribute === 'function') el.setAttribute('aria-hidden', 'true');
      parent.appendChild(el);
    }

    function clock() {
      return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
    }

    let paintedAt = -1e15;
    function onFrame(t) {
      const time = typeof t === 'number' ? t : clock();
      monitor.frame(time);
      if (el && time - paintedAt >= SAMPLE_MS) {
        const text = formatOverlay(monitor.snapshot(time));
        if (el.textContent !== text) el.textContent = text;
        paintedAt = time;
      }
      if (raf) raf(onFrame);
    }
    if (raf) raf(onFrame);
    watchLongTasks(monitor, Observer);
    if (win) win.__perfStats = function () { return monitor.snapshot(clock()); };
    return true;
  }

  return {
    FPS_WINDOW_MS: FPS_WINDOW_MS,
    HISTORY_MS: HISTORY_MS,
    SAMPLE_MS: SAMPLE_MS,
    LOG_MS: LOG_MS,
    LONG_FRAME_MS: LONG_FRAME_MS,
    enabled: enabled,
    readHeap: readHeap,
    countRendered: countRendered,
    createMonitor: createMonitor,
    formatOverlay: formatOverlay,
    install: install,
  };
});
