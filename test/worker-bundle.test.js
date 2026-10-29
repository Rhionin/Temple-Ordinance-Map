const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const workerTree = ['src', 'lib'].flatMap(dir =>
  fs.readdirSync(path.join(root, dir))
    .filter(name => name.endsWith('.js') && !name.endsWith('.test.js'))
    .map(name => path.join(dir, name))
);

test('worker bundle tree avoids Node-only module loaders', () => {
  const forbidden = [
    /createRequire\s*\(/,
    /from\s+['"]node:module['"]/,
    /\.cjs['"]/,
  ];
  for (const rel of workerTree) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${rel} must not match ${pattern}`);
    }
  }
});

test('CI runs wrangler dry-run and worker bundle smoke', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(yml, /wrangler deploy --dry-run --outdir/);
  assert.match(yml, /worker-bundle-smoke\.mjs/);
  assert.match(yml, /npm ci/);
  assert.match(yml, /playwright install --with-deps chromium/);
  assert.match(yml, /ms-playwright/);
  assert.match(yml, /REQUIRE_BROWSER_TESTS/);
});
