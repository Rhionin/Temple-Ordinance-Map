const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { chromiumReady } = require('./browser-test');

test('chromiumReady skips when the executable is absent', async t => {
  const priorBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const priorRequire = process.env.REQUIRE_BROWSER_TESTS;
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, 'fixtures', 'empty-playwright-browsers');
  delete process.env.REQUIRE_BROWSER_TESTS;
  fs.mkdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH, { recursive: true });
  await t.test('inner skip', async inner => {
    const result = chromiumReady(inner);
    assert.equal(result, null);
  });
  process.env.PLAYWRIGHT_BROWSERS_PATH = priorBrowsers;
  if (priorRequire == null) delete process.env.REQUIRE_BROWSER_TESTS;
  else process.env.REQUIRE_BROWSER_TESTS = priorRequire;
});

test('chromiumReady fails when required but executable is absent', () => {
  const priorBrowsers = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const priorRequire = process.env.REQUIRE_BROWSER_TESTS;
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, 'fixtures', 'empty-playwright-browsers');
  process.env.REQUIRE_BROWSER_TESTS = '1';
  fs.mkdirSync(process.env.PLAYWRIGHT_BROWSERS_PATH, { recursive: true });
  const fakeT = { skip(message) { throw new Error('unexpected skip: ' + message); } };
  assert.throws(() => chromiumReady(fakeT), /REQUIRE_BROWSER_TESTS/);
  process.env.PLAYWRIGHT_BROWSERS_PATH = priorBrowsers;
  if (priorRequire == null) delete process.env.REQUIRE_BROWSER_TESTS;
  else process.env.REQUIRE_BROWSER_TESTS = priorRequire;
});
