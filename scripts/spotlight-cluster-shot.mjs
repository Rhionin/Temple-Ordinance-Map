#!/usr/bin/env node
/** Screenshot: spotlight in a dense European cluster for PR artifacts. */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'bench-artifacts');
const out = path.join(outDir, 'spotlight-europe-cluster.png');

async function main() {
  const { chromium } = await import('playwright');
  const port = 9820;
  const child = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) } });
  await sleep(500);
  const lights = [];
  const now = Date.now();
  const hubs = [
    { lat: 48.8566, lon: 2.3522, n: 120 },
    { lat: 51.5074, lon: -0.1278, n: 100 },
    { lat: 52.52, lon: 13.405, n: 90 },
    { lat: 41.9028, lon: 12.4964, n: 80 },
  ];
  let i = 0;
  for (const hub of hubs) {
    for (let j = 0; j < hub.n; j++) {
      lights.push({
        place: 'Ancestor ' + i + ', Europe',
        lat: hub.lat + (Math.random() - 0.5) * 2.2,
        lon: hub.lon + (Math.random() - 0.5) * 3.5,
        created: now - i * 3000,
        updated: now - i * 3000,
        ordinances: ['Endowment'],
        month: (i % 12) + 1,
      });
      i += 1;
    }
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/api/lights')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(lights) });
    }
    if (url.includes('/api/stats')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ancestors: lights.length }) });
    }
    if (url.includes('/api/version')) {
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ build: 'shot' }) });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  const geo = await fs.readFile(path.join(root, 'public', 'world.geojson'), 'utf8');
  await page.route('**/world.geojson', r => r.fulfill({ contentType: 'application/json', body: geo }));
  await page.goto('http://127.0.0.1:' + port + '/?mode=spotlight&fps=1&cycle=30&show=90', {
    waitUntil: 'networkidle',
    timeout: 120000,
  });
  for (let t = 0; t < 80; t++) {
    const st = await page.evaluate(() => (window.__perfStats ? window.__perfStats() : null));
    if (st && st.phase === 'spotlight' && st.lights >= 200) break;
    await sleep(500);
  }
  await sleep(7000);
  await fs.mkdir(outDir, { recursive: true });
  await page.screenshot({ path: out, animations: 'disabled' });
  await browser.close();
  child.kill('SIGTERM');
  console.log(out);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
