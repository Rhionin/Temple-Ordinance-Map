// One canvas draws every temple light. DOM divIcons and per-marker CSS animations
// do not scale to a few thousand points on a phone GPU.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LightCanvas = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const POP_MS = 1600;
  const FLICK_MS = 2400;
  const FADE_MS = 1600;
  const MOVE_PAINT_MS = 100;
  const FRAME_MS = 1000 / 30;
  const SPRITE = 96;

  function flickerKeyframes(phase) {
    const p = phase % 1;
    if (p < 0.25) return 0.75 + (1 - 0.75) * (p / 0.25);
    if (p < 0.5) return 1 + (0.85 - 1) * ((p - 0.25) / 0.25);
    if (p < 0.7) return 0.85 + (0.98 - 0.85) * ((p - 0.5) / 0.2);
    return 0.98 + (0.8 - 0.98) * ((p - 0.7) / 0.3);
  }

  function flickerOpacity(seed, timeMs, reduced) {
    if (reduced) return 1;
    const cycles = timeMs / FLICK_MS + seed;
    const forward = Math.floor(cycles) % 2 === 0;
    const phase = forward ? cycles % 1 : 1 - (cycles % 1);
    return flickerKeyframes(phase);
  }

  function popScale(ageMs, reduced) {
    if (reduced || ageMs >= POP_MS) return 1;
    const t = ageMs / POP_MS;
    if (t < 0.6) return 6 + (1.6 - 6) * (t / 0.6);
    return 1.6 + (1 - 1.6) * ((t - 0.6) / 0.4);
  }

  function fadeOpacity(startMs, timeMs, reduced) {
    if (startMs == null) return 1;
    if (reduced) return 0;
    const age = timeMs - startMs;
    if (age >= FADE_MS) return 0;
    return 1 - age / FADE_MS;
  }

  function paintGlow(ctx, size, bloom) {
    const r = size / 2;
    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, '#fff8e0');
    g.addColorStop(0.3, '#ffcf4d');
    g.addColorStop(0.6, '#ff8a00');
    g.addColorStop(0.72, 'rgba(255, 138, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'lighter';
    const halo = bloom ? 0.92 : 0.55;
    const spread = bloom ? 28 : 12;
    ctx.shadowColor = bloom ? 'rgba(255, 176, 0, 0.85)' : 'rgba(255, 154, 26, 0.6)';
    ctx.shadowBlur = spread;
    ctx.beginPath();
    ctx.arc(r, r, r * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 200, 80, ' + halo + ')';
    ctx.fill();
    ctx.shadowBlur = bloom ? 48 : 24;
    ctx.shadowColor = bloom ? 'rgba(255, 243, 200, 0.75)' : 'rgba(255, 106, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(r, r, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  }

  function makeSprites(doc) {
    const normal = doc.createElement('canvas');
    const bloom = doc.createElement('canvas');
    normal.width = normal.height = SPRITE;
    bloom.width = bloom.height = SPRITE;
    paintGlow(normal.getContext('2d'), SPRITE, false);
    paintGlow(bloom.getContext('2d'), SPRITE, true);
    return { normal: normal, bloom: bloom };
  }

  function throttle(fn, waitMs) {
    let last = -1e15;
    let timer = 0;
    function run() {
      timer = 0;
      last = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      fn();
    }
    return function () {
      const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      const gap = waitMs - (now - last);
      if (gap <= 0) {
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
        run();
        return;
      }
      if (!timer) timer = setTimeout(run, gap);
    };
  }

  function attachCountryRepaint(map, paintFn) {
    const throttled = throttle(paintFn, MOVE_PAINT_MS);
    map.on('move', throttled);
    map.on('zoom', throttled);
    return throttled;
  }

  function createLayer(map, options) {
    const L = typeof window !== 'undefined' ? window.L : null;
    if (!L || !map || typeof document === 'undefined') return null;
    const opts = options || {};
    const reduced = !!opts.reducedMotion;
    const sprites = makeSprites(document);
    const lights = new Map();
    let bloomKey = null;
    let canvas = null;
    let ctx = null;
    let raf = 0;
    let lastDraw = 0;
    let running = false;

    function resize() {
      if (!canvas || !map.getSize) return;
      const size = map.getSize();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(size.x * dpr));
      canvas.height = Math.max(1, Math.floor(size.y * dpr));
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(true);
    }

    function draw(force) {
      if (!ctx || !map._loaded) return;
      const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (!force && !reduced && now - lastDraw < FRAME_MS && !map._animatingZoom) return;
      lastDraw = now;
      const size = map.getSize();
      ctx.clearRect(0, 0, size.x, size.y);
      ctx.globalCompositeOperation = 'lighter';
      for (const entry of lights.values()) {
        if (!entry.visible) continue;
        const point = map.latLngToContainerPoint([entry.lat, entry.lon]);
        if (point.x < -SPRITE || point.y < -SPRITE || point.x > size.x + SPRITE || point.y > size.y + SPRITE) continue;
        const age = now - entry.addedAt;
        const pop = popScale(age, reduced);
        const flick = flickerOpacity(entry.seed, now, reduced);
        const fade = fadeOpacity(entry.fadeAt, now, reduced);
        const alpha = flick * fade;
        if (alpha <= 0.01) continue;
        const bloom = bloomKey === entry.key;
        const sprite = bloom ? sprites.bloom : sprites.normal;
        const scale = pop * (bloom ? 1.12 : 1);
        const w = SPRITE * scale;
        const h = SPRITE * scale;
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, point.x - w / 2, point.y - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function loop() {
      raf = 0;
      draw(false);
      if (running && !reduced) raf = requestAnimationFrame(loop);
    }

    function startLoop() {
      if (running || reduced) return;
      running = true;
      if (!raf) raf = requestAnimationFrame(loop);
    }

    function stopLoop() {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }

    const Layer = L.Layer.extend({
      onAdd() {
        canvas = L.DomUtil.create('canvas', 'leaflet-light-canvas');
        canvas.style.pointerEvents = 'none';
        const pane = map.getPane('overlayPane');
        pane.appendChild(canvas);
        ctx = canvas.getContext('2d', { alpha: true });
        resize();
        map.on('move', this._redraw, this);
        map.on('zoom', this._redraw, this);
        map.on('zoomanim', this._redraw, this);
        map.on('resize', this._resize, this);
        startLoop();
        draw(true);
      },
      onRemove() {
        stopLoop();
        map.off('move', this._redraw, this);
        map.off('zoom', this._redraw, this);
        map.off('zoomanim', this._redraw, this);
        map.off('resize', this._resize, this);
        if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
        canvas = null;
        ctx = null;
      },
      _redraw() { draw(true); },
      _resize() { resize(); },
    });

    const layer = new Layer();
    layer.addTo(map);

    function upsert(key, lat, lon) {
      const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      let entry = lights.get(key);
      if (!entry) {
        entry = {
          key: key,
          lat: lat,
          lon: lon,
          seed: Math.random() * 2,
          addedAt: now,
          fadeAt: null,
          visible: true,
        };
        lights.set(key, entry);
      } else {
        entry.lat = lat;
        entry.lon = lon;
        entry.visible = true;
        entry.fadeAt = null;
      }
      draw(true);
      startLoop();
      return entry;
    }

    return {
      upsert: upsert,
      remove(key) {
        lights.delete(key);
        draw(true);
      },
      clear() {
        lights.clear();
        bloomKey = null;
        draw(true);
      },
      setBloom(key) {
        bloomKey = key || null;
        draw(true);
      },
      fadeAll() {
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        for (const entry of lights.values()) entry.fadeAt = now;
        draw(true);
      },
      countRendered() {
        let n = 0;
        for (const entry of lights.values()) if (entry.visible) n += 1;
        return n;
      },
      latLngOf(key) {
        const entry = lights.get(key);
        return entry ? [entry.lat, entry.lon] : null;
      },
      destroy() {
        stopLoop();
        map.removeLayer(layer);
        lights.clear();
      },
    };
  }

  return {
    POP_MS: POP_MS,
    FLICK_MS: FLICK_MS,
    FADE_MS: FADE_MS,
    MOVE_PAINT_MS: MOVE_PAINT_MS,
    FRAME_MS: FRAME_MS,
    flickerOpacity: flickerOpacity,
    popScale: popScale,
    fadeOpacity: fadeOpacity,
    paintGlow: paintGlow,
    throttle: throttle,
    attachCountryRepaint: attachCountryRepaint,
    createLayer: createLayer,
  };
});
