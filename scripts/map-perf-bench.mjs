#!/usr/bin/env node
// Headless Chromium bench for the TV map. Mocks 3k lights; never hits live data.
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const COUNT = 3000;

function syntheticLights(n) {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const lat = (Math.random() * 140 - 60);
    const lon = (Math.random() * 360 - 180);
    rows.push({
      place: 'Place ' + i + ', Region',
      lat,
      lon,
      created: now - (n - i) * 1000,
      updated: now - (n - i) * 1000,
      ordinances: ['Baptism', 'Endowment'],
      month: (i % 12) + 1,
    });
  }
  return rows;
}

async function startServer() {
  const port = 9876 + Math.floor(Math.random() * 500);
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { out += chunk; });
    child.on('error', reject);
    child.on('exit', code => {
      if (code) reject(new Error('server exited ' + code + ': ' + out));
    });
    setTimeout(() => resolve({ child, port }), 400);
  });
}

async function runBench(label) {
  const { chromium } = await import('playwright');
  const lights = syntheticLights(COUNT);
  const stats = {
    ancestors: COUNT,
    countries: 42,
    sharers: 12,
    ordinances: {
      Baptism: COUNT,
      Confirmation: COUNT,
      Initiatory: COUNT,
      Endowment: COUNT,
      'Sealing to Parents': COUNT,
      'Sealing to Spouse': COUNT,
    },
  };
  const { child, port } = await startServer();
  const base = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ headless: true });
  const shotDir = path.join(root, 'bench-artifacts');
  await import('node:fs/promises').then(fs => fs.mkdir(shotDir, { recursive: true }));
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    recordVideo: { dir: shotDir, size: { width: 1920, height: 1080 } },
  });
  const page = await context.newPage();
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
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 'bench' }) });
      return;
    }
    await route.fulfill({ status: 404, body: 'not found' });
  });
  await page.route('**/world.geojson', async route => {
    const geo = await import('node:fs/promises').then(fs =>
      fs.readFile(path.join(root, 'public', 'world.geojson'), 'utf8'));
    await route.fulfill({ contentType: 'application/json', body: geo });
  });

  const url = base + '/?mode=show&fps=1&cycle=30&show=90';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__perfStats === 'function', null, { timeout: 60000 });
  async function sample() {
    return page.evaluate(() => window.__perfStats());
  }
  let midTimeline = await sample();
  await sleep(15000);
  midTimeline = await sample();
  await page.waitForFunction(
    () => {
      const s = window.__perfStats && window.__perfStats();
      return s && s.phase === 'spotlight' && s.lights >= 2500;
    },
    null,
    { timeout: 120000 },
  ).catch(() => {});
  await sleep(6000);
  const endTimeline = await sample();
  await sleep(10000);
  const spotlight = await sample();
  await page.screenshot({
    path: path.join(shotDir, label + '-spotlight.png'),
    fullPage: false,
    timeout: 5000,
    animations: 'disabled',
  });
  const video = page.video();
  await context.close();
  if (video) {
    const dest = path.join(shotDir, label + '-timeline.webm');
    await video.saveAs(dest);
  }
  await browser.close();
  child.kill('SIGTERM');
  return { label, midTimeline, endTimeline, spotlight };
}

const label = process.argv[2] || 'after';
runBench(label)
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
