#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'bench-artifacts', 'glow-compare', 'spotlight-dim-desktop.png');

async function main() {
  const { chromium } = await import('playwright');
  const port = 9810;
  const child = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) } });
  await sleep(500);
  const lights = [];
  const now = Date.now();
  for (let i = 0; i < 200; i++) {
    lights.push({
      place: 'Paris, France',
      lat: 48.85 + (Math.random() - 0.5) * 3,
      lon: 2.35 + (Math.random() - 0.5) * 4,
      created: now - i * 4000,
      updated: now - i * 4000,
      ordinances: ['Baptism'],
      month: 5,
    });
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    if (url.includes('/api/lights')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(lights) });
    if (url.includes('/api/stats')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    if (url.includes('/api/version')) return route.fulfill({ contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 404, body: '' });
  });
  const geo = await fs.readFile(path.join(root, 'public', 'world.geojson'), 'utf8');
  await page.route('**/world.geojson', r => r.fulfill({ contentType: 'application/json', body: geo }));
  await page.goto('http://127.0.0.1:' + port + '/?mode=spotlight&fps=1&cycle=30&show=90', { waitUntil: 'networkidle', timeout: 120000 });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => window.__perfStats ? window.__perfStats() : null);
    if (st && st.phase === 'spotlight' && st.lights >= 80) break;
    await sleep(500);
  }
  await sleep(6000);
  await page.screenshot({ path: out, animations: 'disabled' });
  await browser.close();
  child.kill('SIGTERM');
  console.log(out);
}

main().catch(e => { console.error(e); process.exit(1); });
