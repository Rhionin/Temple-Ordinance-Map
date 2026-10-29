#!/usr/bin/env node
// Bundle + local workerd smoke: catches module-load crashes (e.g. import.meta.url in Workers).
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unstable_startWorker } from 'wrangler';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`${cmd} ${args.join(' ')} exited ${result.status}`);
  }
  return result.stdout;
}

async function main() {
  const outdir = process.env.WRANGLER_OUTDIR || fs.mkdtempSync(path.join(os.tmpdir(), 'wrangler-smoke-'));
  if (!process.env.WRANGLER_OUTDIR) {
    console.log('wrangler dry-run outdir', outdir);
    run('npx', ['wrangler', 'deploy', '--dry-run', '--outdir', outdir]);
    const bundled = path.join(outdir, 'worker.js');
    if (!fs.existsSync(bundled)) throw new Error('dry-run did not produce worker.js');
  }

  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'temple-ordinance-map', '--local']);

  const worker = await unstable_startWorker({
    config: path.join(root, 'wrangler.toml'),
    local: true,
    persist: false,
  });
  try {
    const home = await worker.fetch('http://smoke.test/');
    if (home.status !== 200) {
      throw new Error(`GET / expected 200, got ${home.status}: ${(await home.text()).slice(0, 200)}`);
    }
    const lights = await worker.fetch('http://smoke.test/api/lights?since=0');
    if (lights.status !== 200) {
      throw new Error(`GET /api/lights expected 200, got ${lights.status}: ${(await lights.text()).slice(0, 200)}`);
    }
    const body = await lights.json();
    if (!Array.isArray(body)) throw new Error('/api/lights body is not an array');
    console.log(JSON.stringify({ event: 'worker_smoke_ok', lights: body.length, bundle: outdir }));
  } finally {
    await worker.dispose();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ event: 'worker_smoke_failed', message: error.message }));
  process.exit(1);
});
