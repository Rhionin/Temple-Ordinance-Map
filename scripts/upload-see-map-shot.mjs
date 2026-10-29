#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'bench-artifacts', 'upload-see-map');

async function startServer() {
  const port = 9701 + Math.floor(Math.random() * 200);
  return new Promise(resolve => {
    const child = spawn('node', ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port) } });
    setTimeout(() => resolve({ child, port }), 450);
  });
}

async function ensureGroup(port) {
  const base = 'http://127.0.0.1:' + port;
  const response = await fetch(base + '/api/groups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'party', title: 'Party upload', subtitle: 'Share your list' }),
  });
  if (response.status !== 201 && response.status !== 409) {
    throw new Error('group create ' + response.status);
  }
}

async function shot(label, port, urlPath, viewport, dpr) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    isMobile: dpr > 1,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:' + port + urlPath, { waitUntil: 'networkidle', timeout: 60000 });
  const href = await page.locator('#browse-map').getAttribute('href');
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, label + '.png');
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  await browser.close();
  return { file, href };
}

async function main() {
  const { child, port } = await startServer();
  await ensureGroup(port);
  const groupDesktop = await shot('group-desktop', port, '/g/party', { width: 900, height: 720 }, 1);
  const groupMobile = await shot('group-mobile', port, '/g/party', { width: 390, height: 844 }, 3);
  child.kill('SIGTERM');
  console.log(JSON.stringify({ groupDesktop, groupMobile }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
