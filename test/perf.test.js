const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { insets } = require('../public/stage-frame');
const {
  FPS_WINDOW_MS,
  HISTORY_MS,
  LOG_MS,
  LONG_FRAME_MS,
  enabled,
  readHeap,
  countRendered,
  createMonitor,
  formatOverlay,
  install,
} = require('../public/perf');

const KEYS = ['fps', 'fpsMin', 'fpsAvg', 'longFrames', 'longTasks', 'phase', 'lights', 'heap'];

function pump(mon, from, to, step) {
  for (let t = from; t <= to + 1e-9; t += step) mon.frame(t);
}

test('the meter is on only for fps=1', () => {
  assert.equal(LONG_FRAME_MS, 50);
  assert.equal(FPS_WINDOW_MS, 1000);
  assert.equal(HISTORY_MS, 60000);
  assert.equal(LOG_MS, 10000);
  assert.equal(enabled(''), false);
  assert.equal(enabled('?'), false);
  assert.equal(enabled('?fps=0'), false);
  assert.equal(enabled('?fps=true'), false);
  assert.equal(enabled('?fps=01'), false);
  assert.equal(enabled('?FPS=1'), false);
  assert.equal(enabled('?mode=timeline'), false);
  assert.equal(enabled('?fps=1'), true);
  assert.equal(enabled('fps=1'), true);
  assert.equal(enabled('?mode=spotlight&fps=1'), true);
  assert.equal(enabled('?fps=1&cycle=75'), true);
});

test('rolling fps uses the last second, and a gap over 50ms is a long frame', () => {
  const mon = createMonitor();
  mon.frame(0);
  mon.frame(50);
  mon.frame(100);
  assert.equal(mon.snapshot(100).longFrames, 0);
  mon.frame(150.1);
  assert.equal(mon.snapshot(150.1).longFrames, 1);

  const steady = createMonitor();
  for (let i = 0; i <= 60; i++) steady.frame(i * (1000 / 60));
  assert.equal(steady.snapshot(1000).fps, 60);
  assert.equal(steady.snapshot(1000).longFrames, 0);

  const windowed = createMonitor();
  windowed.frame(0);
  windowed.frame(1000);
  assert.equal(windowed.snapshot(1000).fps, 1);
  pump(windowed, 1100, 2000, 100);
  const mid = windowed.snapshot(2000);
  assert.equal(mid.fps, 10);
  assert.equal(mid.fpsMin, 1);
  assert.equal(mid.fpsAvg, 5.5);

  const fast = createMonitor();
  for (let i = 0; i < 400; i++) fast.frame(i * 16);
  const end = 399 * 16;
  assert.ok(Math.abs(fast.snapshot(end).fps - (1000 / 16)) < 1);
  assert.equal(fast.snapshot(end).longFrames, 0);
  fast.frame(end + 80);
  assert.equal(fast.snapshot(end + 80).longFrames, 1);
});

test('min and avg cover the last 60s and drop the older rate', () => {
  const mon = createMonitor();
  pump(mon, 0, 60000, 100);
  const slow = mon.snapshot(60000);
  assert.equal(slow.fps, 10);
  assert.equal(slow.fpsMin, 10);
  assert.equal(slow.fpsAvg, 10);
  assert.equal(slow.longFrames, 600);

  pump(mon, 60020, 130000, 20);
  const paced = mon.snapshot(130000);
  assert.equal(paced.fps, 50);
  assert.ok(paced.fpsMin > 48, String(paced.fpsMin));
  assert.ok(paced.fpsAvg > 48, String(paced.fpsAvg));
  assert.equal(paced.longFrames, 600);
});

test('a frame does not read the page, and the 10s line matches the snapshot', () => {
  let calls = 0;
  const logs = [];
  const mon = createMonitor({
    phase() { calls += 1; return 'spotlight'; },
    lights() { calls += 1; return 4; },
    memory() { calls += 1; return 2048; },
    log(stats) { logs.push(stats); },
  });
  pump(mon, 0, 5000, 16);
  assert.equal(calls, 0);
  assert.equal(logs.length, 0);
  mon.frame(10000);
  assert.equal(logs.length, 1);
  assert.equal(calls, 3);
  const again = mon.snapshot(10000);
  assert.notEqual(again, logs[0]);
  assert.deepEqual(again, logs[0]);
  assert.deepEqual(Object.keys(again), KEYS);
  assert.equal(again.phase, 'spotlight');
  assert.equal(again.lights, 4);
  assert.equal(again.heap, 2048);
  assert.equal(again.longTasks, null);
  assert.equal(JSON.stringify(again).includes('\n'), false);
  mon.frame(19999);
  assert.equal(logs.length, 1);
  mon.frame(20000);
  assert.equal(logs.length, 2);
  logs[0].fps = 0;
  assert.notEqual(mon.snapshot(10000).fps, 0);
});

test('heap and rendered lights are read only from what the browser actually has', () => {
  assert.equal(readHeap(null), null);
  assert.equal(readHeap({}), null);
  assert.equal(readHeap({ memory: {} }), null);
  assert.equal(readHeap({ memory: { usedJSHeapSize: 12345678 } }), 12345678);
  assert.equal(countRendered(null), 0);
  assert.equal(countRendered([{ marker: {} }, { marker: null }, { shown: true }, {}, null]), 2);
  assert.equal(countRendered(new Map([['a', { marker: 1 }], ['b', { shown: true }], ['c', { marker: null }]]).values()), 2);

  const withHeap = {
    fps: 59.5, fpsMin: 40, fpsAvg: 55.5, longFrames: 2, longTasks: 1,
    phase: 'timeline', lights: 12, heap: 2 * 1048576,
  };
  const text = formatOverlay(withHeap);
  assert.match(text, /59\.5 fps   min 40\.0   avg 55\.5/);
  assert.match(text, /long frames 2   long tasks 1/);
  assert.match(text, /timeline   lights 12/);
  assert.match(text, /heap 2\.0 MB/);
  const without = formatOverlay(Object.assign({}, withHeap, { heap: null, longTasks: null, phase: '' }));
  assert.match(without, /long tasks n\/a/);
  assert.match(without, /^-   lights 12/m);
  assert.equal(without.includes('heap'), false);
});

function stageDocument() {
  const stage = { id: 'stage', children: [], appendChild(child) { this.children.push(child); } };
  const map = { id: 'map', children: [], appendChild(child) { this.children.push(child); } };
  const body = { id: 'body', children: [], appendChild(child) { this.children.push(child); } };
  return {
    stage: stage,
    map: map,
    body: body,
    document: {
      createElement() {
        return {
          id: '',
          textContent: '',
          attrs: {},
          setAttribute(name, value) { this.attrs[name] = value; },
        };
      },
      getElementById(id) {
        if (id === 'stage') return stage;
        if (id === 'map') return map;
        return null;
      },
      body: body,
    },
  };
}

test('install stays idle unless fps=1, then publishes the same object the console logs', () => {
  const dom = stageDocument();
  const win = {};
  let loops = 0;
  assert.equal(install({
    phase() { throw new Error('should not read the page'); },
    lights() { throw new Error('should not read the page'); },
  }, {
    location: { search: '?mode=timeline&fps=0' },
    window: win,
    document: dom.document,
    requestAnimationFrame() { loops += 1; throw new Error('raf'); },
    PerformanceObserver: class { observe() { throw new Error('observe'); } },
    console: { log() { throw new Error('log'); } },
  }), false);
  assert.equal(loops, 0);
  assert.equal(win.__perfStats, undefined);
  assert.equal(dom.stage.children.length, 0);

  let phase = 'timeline';
  let lights = 3;
  let now = 0;
  let loop = null;
  let rafs = 0;
  const lines = [];
  const seen = [];
  class Observer {
    static get supportedEntryTypes() { return ['longtask']; }
    constructor(cb) { this.cb = cb; Observer.last = this; }
    observe(options) { seen.push(options); }
  }
  const hooked = stageDocument();
  const page = {};
  assert.equal(install({
    phase() { return phase; },
    lights() { return lights; },
  }, {
    location: { search: '?cycle=75&fps=1' },
    window: page,
    document: hooked.document,
    performance: {
      now() { return now; },
      memory: { usedJSHeapSize: 3 * 1048576 },
    },
    requestAnimationFrame(cb) { rafs += 1; loop = cb; return rafs; },
    PerformanceObserver: Observer,
    console: { log(line) { lines.push(line); } },
  }), true);
  assert.equal(rafs, 1);
  assert.equal(typeof page.__perfStats, 'function');
  assert.equal(hooked.stage.children.length, 1);
  assert.equal(hooked.map.children.length, 0);
  assert.equal(hooked.body.children.length, 0);
  const node = hooked.stage.children[0];
  assert.equal(node.id, 'perf');
  assert.equal(node.attrs['aria-hidden'], 'true');
  assert.deepEqual(seen, [{ type: 'longtask', buffered: false }]);

  assert.equal(install({ phase() { return 'nope'; } }, {
    location: { search: '?fps=1' },
    window: page,
    requestAnimationFrame() { rafs += 1; },
  }), true);
  assert.equal(rafs, 1);

  loop(0);
  assert.match(node.textContent, /timeline/);
  assert.match(node.textContent, /lights 3/);
  assert.match(node.textContent, /heap 3\.0 MB/);
  assert.match(node.textContent, /long tasks 0/);
  assert.equal(lines.length, 0);
  Observer.last.cb({ getEntries() { return [{}, {}]; } });
  phase = 'spotlight';
  lights = 9;
  now = 10000;
  loop(10000);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].includes('\n'), false);
  const logged = JSON.parse(lines[0]);
  assert.deepEqual(logged, page.__perfStats());
  assert.deepEqual(Object.keys(logged), KEYS);
  assert.equal(logged.phase, 'spotlight');
  assert.equal(logged.lights, 9);
  assert.equal(logged.longTasks, 2);
  assert.equal(logged.heap, 3 * 1048576);
  assert.match(node.textContent, /spotlight/);
  assert.match(node.textContent, /lights 9/);
  now = 19999;
  loop(19999);
  assert.equal(lines.length, 1);
  now = 20000;
  loop(20000);
  assert.equal(lines.length, 2);
});

test('long tasks stay uncounted when the observer is missing or refuses to start', () => {
  function boot(Observer) {
    const page = {};
    let loop = null;
    install({ phase() { return 'timeline'; }, lights() { return 0; } }, {
      location: { search: '?fps=1' },
      window: page,
      document: { getElementById() { return null; }, createElement() { throw new Error('no stage'); } },
      performance: { now() { return 0; } },
      requestAnimationFrame(cb) { loop = cb; },
      PerformanceObserver: Observer,
      console: { log() {} },
    });
    return page;
  }

  const missing = boot(null);
  assert.equal(missing.__perfStats().longTasks, null);

  const unsupported = boot(class { static supportedEntryTypes = ['measure']; observe() { throw new Error('no'); } });
  assert.equal(unsupported.__perfStats().longTasks, null);

  const seen = [];
  class Fallback {
    static supportedEntryTypes = ['longtask'];
    observe(options) {
      seen.push(options);
      if (options.type) throw new Error('type unsupported');
    }
  }
  const fell = boot(Fallback);
  assert.deepEqual(seen, [{ type: 'longtask', buffered: false }, { entryTypes: ['longtask'] }]);
  assert.equal(fell.__perfStats().longTasks, 0);

  class Boom {
    static supportedEntryTypes = ['longtask'];
    observe() { throw new Error('nope'); }
  }
  assert.equal(boot(Boom).__perfStats().longTasks, null);
});

test('both map pages can show the meter, and it stays off the lights', () => {
  const root = path.join(__dirname, '..');
  const tv = fs.readFileSync(path.join(root, 'public', 'tv.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'public', 'perf.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
  assert.match(server, /\/map' \? 'tv\.html'/);
  assert.match(server, /'\/': 'tv\.html'/);
  assert.match(worker, /\/map' \? '\/tv\.html'/);
  assert.match(worker, /'\/': '\/tv\.html'/);
  assert.match(tv, /src="\/perf\.js"/);
  assert.equal((tv.match(/PerfOverlay\.install/g) || []).length, 1);
  assert.match(tv, /params\.get\('fps'\) === '1'/);
  assert.match(tv, /phase\(\) \{ return act; \}/);
  assert.match(tv, /PerfOverlay\.countRendered\(markers\.values\(\)\)/);
  assert.doesNotMatch(tv, /id="perf"/);

  const rule = tv.match(/#perf\{[^}]+\}/)[0];
  assert.match(rule, /position:absolute/);
  assert.match(rule, /top:6px/);
  assert.match(rule, /right:72px/);
  assert.match(rule, /font:10px/);
  assert.match(rule, /pointer-events:none/);
  const perfRight = Number(rule.match(/right:(\d+)px/)[1]);
  const maxWidth = Number(rule.match(/max-width:(\d+)px/)[1]);
  const perfZ = Number(rule.match(/z-index:(\d+)/)[1]);
  assert.ok(perfRight + maxWidth < insets.rail);
  const railZ = Number(tv.match(/#rail\{[^}]*z-index:(\d+)/)[1]);
  assert.ok(perfZ > railZ);
  const reset = tv.match(/#reset\{[^}]+\}/)[0];
  const resetRight = Number(reset.match(/right:(\d+)px/)[1]);
  const resetWidth = Number(reset.match(/width:(\d+)px/)[1]);
  assert.ok(perfRight >= resetRight + resetWidth);
  const statsTop = Number(tv.match(/#stats\{[^}]*top:(\d+)px/)[1]);
  const lines = 4;
  const height = 6 + 2 * 2 + lines * 10 * 1.2;
  assert.ok(height < statsTop);

  assert.doesNotMatch(source, /setInterval|setTimeout|fetch\(|XMLHttpRequest|\/api\//);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /longtask/);
  assert.match(source, /__perfStats/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'public', 'upload.html'), 'utf8'), /perf\.js|__perfStats/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'public', 'group-admin.html'), 'utf8'), /perf\.js|__perfStats/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'public', 'super-admin.html'), 'utf8'), /perf\.js|__perfStats/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'public', 'new.html'), 'utf8'), /perf\.js|__perfStats/);
});
