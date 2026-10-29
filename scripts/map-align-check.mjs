#!/usr/bin/env node
// Assert light canvas pixels align with map.latLngToContainerPoint after flyTos.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'bench-artifacts', 'align-check');
const PROBE = { lat: 48.8566, lon: 2.3522, label: 'paris' };

function lightsBundle() {
  const rows = [];
  const now = Date.now();
  const anchors = [
    { lat: PROBE.lat, lon: PROBE.lon, place: 'Paris, France' },
    { lat: 19.4326, lon: -99.1332, place: 'Mexico City, Mexico' },
    { lat: 51.5074, lon: -0.1278, place: 'London, United Kingdom' },
  ];
  for (let i = 0; i < 900; i++) {
    const base = anchors[i % anchors.length];
    rows.push({
      place: base.place + ' ' + i,
      lat: base.lat + (Math.random() - 0.5) * 2.5,
      lon: base.lon + (Math.random() - 0.5) * 2.5,
      created: now - (900 - i) * 700,
      updated: now - (900 - i) * 700,
      ordinances: ['Endowment'],
      month: (i % 12) + 1,
    });
  }
  rows[0].lat = PROBE.lat;
  rows[0].lon = PROBE.lon;
  return rows;
}

async function startServer() {
  const port = 9865 + Math.floor(Math.random() * 400);
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', reject);
    setTimeout(() => resolve({ child, port }), 450);
  });
}

async function mockApi(page, lights) {
  const stats = { ancestors: lights.length, countries: 8, sharers: 3, ordinances: { Endowment: lights.length } };
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/api/lights')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(lights) });
      return;
    }
    if (url.includes('/api/stats')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(stats) });
      return;
    }
    if (url.includes('/api/version')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 'align' }) });
      return;
    }
    await route.fulfill({ status: 404, body: 'not found' });
  });
  const geo = await fs.readFile(path.join(root, 'public', 'world.geojson'), 'utf8');
  await page.route('**/world.geojson', route => route.fulfill({ contentType: 'application/json', body: geo }));
}

async function waitLights(page, min) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const n = await page.evaluate(() => (window.__perfStats ? window.__perfStats().lights : 0));
    if (n >= min) return;
    await sleep(400);
  }
  throw new Error('timeout waiting for lights');
}

async function runScenario(label, contextOpts) {
  const { chromium } = await import('playwright');
  const lights = lightsBundle();
  const { child, port } = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  await mockApi(page, lights);
  const url = 'http://127.0.0.1:' + port + '/?mode=timeline&align=1&fps=1&cycle=30&show=75';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  await waitLights(page, 120);
  const samples = [];
  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    const sample = await page.evaluate(({ lat, lon }) => {
      if (typeof window.__lightAlign !== 'function') return { px: 999, missing: true, animating: true };
      const err = window.__lightAlign(lat, lon);
      const perf = window.__perfStats ? window.__perfStats() : {};
      return { px: err.px, animating: err.animating, phase: perf.phase || '', lights: perf.lights || 0 };
    }, PROBE);
    if (!sample.animating && sample.px != null) samples.push({ t: Date.now(), ...sample });
    await sleep(800);
  }
  await fs.mkdir(outDir, { recursive: true });
  const shot = path.join(outDir, label + '-late-timeline.png');
  await page.screenshot({ path: shot, timeout: 10000, animations: 'disabled' });
  await browser.close();
  child.kill('SIGTERM');
  const maxPx = samples.reduce((m, s) => (s.px != null && s.px > m ? s.px : m), 0);
  if (!samples.length) return { label, maxPx: 999, samples: 0, shot, worst: null };
  return { label, maxPx, samples: samples.length, shot, worst: samples.sort((a, b) => b.px - a.px)[0] };
}

async function main() {
  const results = [];
  results.push(await runScenario('iphone-dpr3', {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  }));
  results.push(await runScenario('desktop-1080', {
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  }));
  console.log('__ALIGN_RESULT__' + JSON.stringify({ ok: results.every(r => r.maxPx <= 4 && r.samples > 0), results }));
  if (!results.every(r => r.maxPx <= 4 && r.samples > 0)) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
