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
  const LIGHTS_PANE = 'lightsPane';
  const LIGHTS_PANE_Z = 450;
  // Visual match for pre-#68 .glow (14px core + CSS box-shadow halos at scale 1).
  const CORE_PX = 14;
  const DISPLAY_NORMAL = 58;
  const DISPLAY_BLOOM = 96;
  const SPRITE = 96;
  const DRAW_ALPHA = 0.82;
  const BLOOM_ALPHA = 1;
  const SPOT_OTHER = 0.3;
  const DIM_EASE_MS = 400;

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

  function popMultiplier(entry, now, reduced) {
    if (!entry || entry.popDone || reduced) return 1;
    const age = now - entry.bornAt;
    if (age >= POP_MS) {
      entry.popDone = true;
      return 1;
    }
    return popScale(age, reduced);
  }

  function displaySize(bloom, popMult, reduced) {
    const pop = popMult == null ? 1 : popMult;
    const base = (bloom ? DISPLAY_BLOOM : DISPLAY_NORMAL) * pop;
    if (bloom) return Math.min(base * 1.05, DISPLAY_BLOOM * 6);
    return Math.min(base, DISPLAY_NORMAL * 6);
  }

  function paintGlow(ctx, size, bloom) {
    const r = size / 2;
    const core = (CORE_PX / 58) * (size / 2);
    ctx.clearRect(0, 0, size, size);
    const g = ctx.createRadialGradient(r, r, 0, r, r, core * 1.15);
    g.addColorStop(0, '#fff8e0');
    g.addColorStop(0.3, '#ffcf4d');
    g.addColorStop(0.6, '#ff8a00');
    g.addColorStop(0.72, 'rgba(255, 138, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(r, r, core * 1.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    if (bloom) {
      ctx.shadowColor = 'rgba(255, 243, 200, 0.93)';
      ctx.shadowBlur = 22;
      ctx.fillStyle = 'rgba(255, 200, 100, 0.85)';
      ctx.beginPath();
      ctx.arc(r, r, core * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 60;
      ctx.shadowColor = 'rgba(255, 176, 0, 0.8)';
      ctx.fillStyle = 'rgba(255, 154, 26, 0.55)';
      ctx.beginPath();
      ctx.arc(r, r, core * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#fff8e0';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(r, r, core * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.shadowColor = 'rgba(255, 154, 26, 0.6)';
      ctx.shadowBlur = 12;
      ctx.fillStyle = 'rgba(255, 154, 26, 0.55)';
      ctx.beginPath();
      ctx.arc(r, r, core * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 30;
      ctx.shadowColor = 'rgba(255, 106, 0, 0.33)';
      ctx.fillStyle = 'rgba(255, 106, 0, 0.35)';
      ctx.beginPath();
      ctx.arc(r, r, core * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
  }

  function layerDrawPoint(map, bounds, lat, lon) {
    const lp = map.latLngToLayerPoint([lat, lon]);
    return { x: lp.x - bounds.min.x, y: lp.y - bounds.min.y };
  }

  function dimOthersLevel(now, state) {
    if (!state) return 1;
    const elapsed = now - state.at;
    if (elapsed >= DIM_EASE_MS) return state.to;
    const t = elapsed / DIM_EASE_MS;
    const ease = t * (2 - t);
    return state.from + (state.to - state.from) * ease;
  }

  function beginDimEase(state, target, now) {
    const from = state.active ? dimOthersLevel(now, state.active) : 1;
    state.active = { from: from, to: target, at: now };
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

  function ensureLightsPane(map) {
    if (map.getPane(LIGHTS_PANE)) return map.getPane(LIGHTS_PANE);
    map.createPane(LIGHTS_PANE);
    const pane = map.getPane(LIGHTS_PANE);
    pane.style.zIndex = String(LIGHTS_PANE_Z);
    pane.style.pointerEvents = 'none';
    return pane;
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
    if (!L || !L.Renderer || !map || typeof document === 'undefined') return null;
    const opts = options || {};
    const reduced = !!opts.reducedMotion;
    const sprites = makeSprites(document);
    const lights = new Map();
    let bloomKey = null;
    const dimState = { active: null };
    let spotlightDim = false;
    let raf = 0;
    let lastDraw = 0;
    let running = false;
    let dpr = 1;
    let renderer = null;
    let canvasLayout = { w: 0, h: 0, minX: NaN, minY: NaN };

    function syncCanvasSize(container, bounds) {
      const size = bounds.getSize();
      const min = bounds.min;
      const nextDpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(size.x * nextDpr));
      const h = Math.max(1, Math.floor(size.y * nextDpr));
      const moved = canvasLayout.minX !== min.x || canvasLayout.minY !== min.y;
      const resized = canvasLayout.w !== w || canvasLayout.h !== h || dpr !== nextDpr;
      dpr = nextDpr;
      container.style.width = size.x + 'px';
      container.style.height = size.y + 'px';
      L.DomUtil.setPosition(container, min);
      if (resized) {
        container.width = w;
        container.height = h;
        canvasLayout = { w: w, h: h, minX: min.x, minY: min.y };
      } else if (moved) {
        canvasLayout.minX = min.x;
        canvasLayout.minY = min.y;
      }
      return resized || moved;
    }

    const LightRenderer = L.Renderer.extend({
      options: { padding: 0, pane: LIGHTS_PANE },

      getPane() {
        ensureLightsPane(this._map);
        return this._map.getPane(LIGHTS_PANE);
      },

      getEvents() {
        const events = L.Renderer.prototype.getEvents.call(this);
        events.move = this._onMoveWhileAnimating;
        events.moveend = this._onMoveEnd;
        events.viewreset = this._onViewReset;
        events.resize = this._onViewReset;
        events.zoom = this._onZoomDraw;
        return events;
      },

      onAdd() {
        L.Renderer.prototype.onAdd.call(this);
        startLoop();
      },

      onRemove() {
        stopLoop();
        L.Renderer.prototype.onRemove.call(this);
      },

      _initContainer() {
        this._container = L.DomUtil.create('canvas', 'leaflet-light-canvas leaflet-layer');
        this._canvas = this._container;
        this._container.style.pointerEvents = 'none';
        this._container.style.zIndex = String(LIGHTS_PANE_Z);
        this._ctx = this._container.getContext('2d', { alpha: true });
      },

      _destroyContainer() {
        L.DomUtil.remove(this._container);
        this._ctx = null;
        delete this._canvas;
        delete this._container;
      },

      _onViewReset() {
        this._reset();
        this._draw(true);
      },

      _onMoveEnd() {
        this._syncLayout(true);
        this._draw(true);
      },

      _onZoomDraw() {
        L.Renderer.prototype._onZoom.call(this);
        this._draw(true);
      },

      _onMoveWhileAnimating() {
        if (this._map._animatingZoom) return;
        this._syncLayout(false);
        this._draw(true);
      },

      _syncLayout(forceReset) {
        if (this._map._animatingZoom && this._bounds && !forceReset) return;
        L.Renderer.prototype._update.call(this);
        if (!this._bounds || !this._container) return;
        syncCanvasSize(this._container, this._bounds);
      },

      _update() {
        if (this._map._animatingZoom && this._bounds) return;
        this._syncLayout(false);
      },

      _updatePaths() {
        this._draw(true);
      },

      _draw(force) {
        if (!this._ctx || !this._map._loaded || !this._bounds) return;
        if (this._map._animatingZoom) return;
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        if (!force && !reduced && now - lastDraw < FRAME_MS && !this._map._animatingZoom) return;
        lastDraw = now;
        const size = this._bounds.getSize();
        this._ctx.save();
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._ctx.clearRect(0, 0, size.x, size.y);
        this._ctx.globalCompositeOperation = 'screen';
        const pad = DISPLAY_BLOOM * 6;
        for (const entry of lights.values()) {
          if (!entry.visible) continue;
          const point = layerDrawPoint(this._map, this._bounds, entry.lat, entry.lon);
          if (point.x < -pad || point.y < -pad || point.x > size.x + pad || point.y > size.y + pad) continue;
          const pop = popMultiplier(entry, now, reduced);
          const flick = flickerOpacity(entry.seed, now, reduced);
          const fade = fadeOpacity(entry.fadeAt, now, reduced);
          const bloom = bloomKey === entry.key;
          const w = displaySize(bloom, pop, reduced);
          const tone = bloom ? BLOOM_ALPHA : DRAW_ALPHA;
          const dim = spotlightDim && bloomKey && !bloom
            ? dimOthersLevel(now, dimState.active)
            : 1;
          const alpha = flick * fade * tone * dim;
          if (alpha <= 0.01 || w <= 0.5) continue;
          const sprite = bloom ? sprites.bloom : sprites.normal;
          this._ctx.globalAlpha = alpha;
          this._ctx.drawImage(sprite, point.x - w / 2, point.y - w / 2, w, w);
        }
        this._ctx.restore();
        this._ctx.globalAlpha = 1;
        this._ctx.globalCompositeOperation = 'source-over';
      },
    });

    renderer = new LightRenderer();
    renderer.addTo(map);

    function loop() {
      raf = 0;
      if (renderer) renderer._draw(false);
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

    function upsert(key, lat, lon) {
      const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      let entry = lights.get(key);
      if (!entry) {
        entry = {
          key: key,
          lat: lat,
          lon: lon,
          seed: Math.random() * 2,
          bornAt: now,
          popDone: false,
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
      if (renderer) renderer._updatePaths();
      startLoop();
      return entry;
    }

    function alignError(lat, lon) {
      if (!renderer || !renderer._bounds || !renderer._map) return { px: null, animating: true };
      const mapRef = renderer._map;
      if (mapRef._animatingZoom) return { px: null, animating: true };
      const expected = mapRef.latLngToContainerPoint([lat, lon]);
      const local = layerDrawPoint(mapRef, renderer._bounds, lat, lon);
      const canvas = renderer._canvas;
      if (!canvas) return { px: null, animating: true };
      const pos = L.DomUtil.getPosition(canvas);
      const layerAt = L.point(pos.x + local.x, pos.y + local.y);
      const fromCanvas = mapRef.layerPointToContainerPoint(layerAt);
      return {
        px: Math.hypot(expected.x - fromCanvas.x, expected.y - fromCanvas.y),
        animating: false,
      };
    }

    return {
      upsert: upsert,
      remove(key) {
        lights.delete(key);
        if (renderer) renderer._updatePaths();
      },
      clear() {
        lights.clear();
        bloomKey = null;
        spotlightDim = false;
        dimState.active = null;
        if (renderer) renderer._updatePaths();
      },
      setBloom(key) {
        bloomKey = key || null;
        if (renderer) renderer._updatePaths();
      },
      setSpotlight(key) {
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        bloomKey = key || null;
        spotlightDim = !!key;
        beginDimEase(dimState, key ? SPOT_OTHER : 1, now);
        if (renderer) renderer._updatePaths();
      },
      clearFade() {
        for (const entry of lights.values()) {
          entry.fadeAt = null;
          entry.visible = true;
        }
        if (renderer) renderer._updatePaths();
      },
      snapshotAnimation() {
        const rows = [];
        for (const entry of lights.values()) {
          rows.push({
            key: entry.key,
            bornAt: entry.bornAt,
            seed: entry.seed,
            popDone: entry.popDone,
          });
        }
        return rows;
      },
      fadeAll() {
        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        for (const entry of lights.values()) entry.fadeAt = now;
        if (renderer) renderer._updatePaths();
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
      alignError: alignError,
      _renderer: function () { return renderer; },
      destroy() {
        stopLoop();
        map.removeLayer(renderer);
        lights.clear();
        renderer = null;
      },
    };
  }

  return {
    POP_MS: POP_MS,
    FLICK_MS: FLICK_MS,
    FADE_MS: FADE_MS,
    MOVE_PAINT_MS: MOVE_PAINT_MS,
    FRAME_MS: FRAME_MS,
    LIGHTS_PANE: LIGHTS_PANE,
    LIGHTS_PANE_Z: LIGHTS_PANE_Z,
    DISPLAY_NORMAL: DISPLAY_NORMAL,
    DISPLAY_BLOOM: DISPLAY_BLOOM,
    SPRITE: SPRITE,
    SPOT_OTHER: SPOT_OTHER,
    DIM_EASE_MS: DIM_EASE_MS,
    dimOthersLevel: dimOthersLevel,
    flickerOpacity: flickerOpacity,
    popScale: popScale,
    fadeOpacity: fadeOpacity,
    popMultiplier: popMultiplier,
    displaySize: displaySize,
    layerDrawPoint: layerDrawPoint,
    paintGlow: paintGlow,
    ensureLightsPane: ensureLightsPane,
    throttle: throttle,
    attachCountryRepaint: attachCountryRepaint,
    createLayer: createLayer,
  };
});
