const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('path');

test('light canvas stays aligned with the map through timeline flyTos', async t => {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (error) {
    t.skip('playwright not installed');
    return;
  }
  if (!playwright.chromium) {
    t.skip('playwright chromium missing');
    return;
  }
  const script = path.join(__dirname, '..', 'scripts', 'map-align-check.mjs');
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: path.join(__dirname, '..'), env: process.env });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, out, err }));
  });
  if (result.code !== 0) {
    assert.fail((result.err || '') + (result.out || '') || 'align check failed');
  }
  const marker = result.out.split('\n').find(line => line.startsWith('__ALIGN_RESULT__'));
  assert.ok(marker, 'align script output missing marker');
  const parsed = JSON.parse(marker.slice('__ALIGN_RESULT__'.length));
  assert.equal(parsed.ok, true, JSON.stringify(parsed.results, null, 2));
  for (const row of parsed.results) {
    assert.ok(row.maxPx <= 4, row.label + ' maxPx ' + row.maxPx);
  }
});
