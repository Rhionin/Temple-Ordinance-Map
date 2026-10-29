#!/usr/bin/env node
// Visual checks: lights above land, dot size, iPhone portrait + desktop. Mocks API only.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'bench-artifacts', 'visual-verify');

async function waitLights(page, min, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const n = await page.evaluate(() => (window.__perfStats ? window.__perfStats().lights : 0));
    if (n >= min) return n;
    await sleep(500);
  }
  throw new Error('lights timeout');
}

async function waitPhase(page, phase, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(p => window.__perfStats && window.__perfStats().phase === p, phase);
    if (ok) return;
    await sleep(500);
  }
}

function syntheticLights(n) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    rows.push({
      place: 'Place ' + i + ', Utah, United States',
      lat: 37 + (Math.random() - 0.5) * 12,
      lon: -111 + (Math.random() - 0.5) * 18,
      created: now - (n - i) * 800,
      updated: now - (n - i) * 800,
      ordinances: ['Baptism'],
      month: (i % 12) + 1,
    });
  }
  return rows;
}

async function startServer(cwd) {
  const port = 9765 + Math.floor(Math.random() * 400);
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['server.js'], {
      cwd,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('exit', code => { if (code) reject(new Error('server exit ' + code + err)); });
    setTimeout(() => resolve({ child, port }), 450);
  });
}

async function mockRoutes(page, lights) {
  const stats = {
    ancestors: lights.length,
    countries: 12,
    sharers: 5,
    ordinances: {
      Baptism: lights.length,
      Confirmation: 0,
      Initiatory: 0,
      Endowment: 0,
      'Sealing to Parents': 0,
      'Sealing to Spouse': 0,
    },
  };
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
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 'verify' }) });
      return;
    }
    await route.fulfill({ status: 404, body: 'not found' });
  });
  const geo = await fs.readFile(path.join(root, 'public', 'world.geojson'), 'utf8');
  await page.route('**/world.geojson', route =>
    route.fulfill({ contentType: 'application/json', body: geo }));
}

async function capture(label, cwd, contextOpts, urlQuery) {
  const { chromium } = await import('playwright');
  const lights = syntheticLights(800);
  const { child, port } = await startServer(cwd);
  const base = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  await mockRoutes(page, lights);
  const url = base + '/?' + urlQuery;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  await waitLights(page, 200, 90000);
  await sleep(3000);
  await fs.mkdir(outDir, { recursive: true });
  const timelinePath = path.join(outDir, label + '-timeline.png');
  await page.screenshot({ path: timelinePath, timeout: 10000, animations: 'disabled' });
  await waitPhase(page, 'spotlight', 120000).catch(() => {});
  await sleep(4000);
  const spotPath = path.join(outDir, label + '-spotlight.png');
  await page.screenshot({ path: spotPath, timeout: 10000, animations: 'disabled' });
  const stackOk = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.leaflet-light-canvas');
    const svg = document.querySelector('.leaflet-overlay-pane svg');
    if (!svg) return { ok: false, reason: 'no svg' };
    if (!canvas) return { ok: true, legacy: true, reason: 'divIcon era' };
    const pane = canvas.closest('.leaflet-pane');
    const cp = pane ? parseInt(getComputedStyle(pane).zIndex, 10) : 0;
    const sp = parseInt(getComputedStyle(svg.closest('.leaflet-pane')).zIndex, 10);
    return { ok: cp > sp, canvasPaneZ: cp, svgPaneZ: sp, canvasZ: getComputedStyle(canvas).zIndex };
  });
  await browser.close();
  child.kill('SIGTERM');
  return { label, timelinePath, spotPath, stackOk };
}

const legacyCwd = process.env.LEGACY_MAP_CWD || '';
const jobs = [
  capture('iphone-dpr3', root, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  }, 'mode=timeline&fps=1&cycle=30&show=60'),
  capture('desktop-1080', root, {
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  }, 'mode=timeline&fps=1&cycle=30&show=60'),
];

if (legacyCwd) {
  jobs.push(capture('legacy-fb43610', legacyCwd, {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  }, 'mode=timeline&fps=1&cycle=30&show=60'));
}

Promise.all(jobs)
  .then(results => {
    console.log(JSON.stringify(results, null, 2));
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
