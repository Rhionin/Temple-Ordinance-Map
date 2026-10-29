#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'bench-artifacts', 'glow-compare');
const legacyRoot = process.env.LEGACY_ROOT || '/tmp/map-glow-fb43610';

function lights() {
  const rows = [];
  const now = Date.now();
  for (let i = 0; i < 120; i++) {
    rows.push({
      place: 'Ogden, Utah, United States',
      lat: 41.2 + (Math.random() - 0.5) * 4,
      lon: -111.9 + (Math.random() - 0.5) * 6,
      created: now - i * 5000,
      updated: now - i * 5000,
      ordinances: ['Endowment'],
      month: 6,
    });
  }
  return rows;
}

async function startServer(cwd) {
  const port = 9720 + Math.floor(Math.random() * 300);
  return new Promise(resolve => {
    const child = spawn('node', ['server.js'], { cwd, env: { ...process.env, PORT: String(port) } });
    setTimeout(() => resolve({ child, port }), 450);
  });
}

async function capture(label, cwd, contextOpts, query) {
  const { chromium } = await import('playwright');
  const bundle = lights();
  const { child, port } = await startServer(cwd);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/api/lights')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(bundle) });
    if (url.includes('/api/stats')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ancestors: 120, countries: 3, sharers: 2, ordinances: { Endowment: 120 } }) });
    if (url.includes('/api/version')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 404, body: '' });
  });
  const geo = await fs.readFile(path.join(root, 'public', 'world.geojson'), 'utf8');
  await page.route('**/world.geojson', r => r.fulfill({ contentType: 'application/json', body: geo }));
  await page.goto('http://127.0.0.1:' + port + '/?' + query, { waitUntil: 'networkidle', timeout: 120000 });
  for (let i = 0; i < 50; i++) {
    const n = await page.evaluate(() => (window.__perfStats ? window.__perfStats().lights : 0));
    if (n >= 40) break;
    await sleep(400);
  }
  await sleep(3000);
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, label + '.png');
  await page.screenshot({ path: file, animations: 'disabled', timeout: 10000 });
  await browser.close();
  child.kill('SIGTERM');
  return file;
}

async function main() {
  const desktop = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
  const iphone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const q = 'mode=spotlight&fps=1&cycle=30&show=90';
  const files = {
    legacyDesktop: await capture('legacy-fb43610-desktop', legacyRoot, desktop, q),
    canvasDesktop: await capture('canvas-desktop', root, desktop, q),
    legacyIphone: await capture('legacy-fb43610-iphone', legacyRoot, iphone, q),
    canvasIphone: await capture('canvas-iphone', root, iphone, q),
  };
  console.log(JSON.stringify(files, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
