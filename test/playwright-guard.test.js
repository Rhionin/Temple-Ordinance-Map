const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { chromiumReady } = require('./browser-test');

test('chromiumReady skips when the executable is absent', () => {
  const priorRequire = process.env.REQUIRE_BROWSER_TESTS;
  delete process.env.REQUIRE_BROWSER_TESTS;
  const realExists = fs.existsSync;
  fs.existsSync = path => (String(path).includes('chrome-linux') ? false : realExists(path));
  try {
    let skipped = false;
    const fakeT = {
      skip() {
        skipped = true;
      },
    };
    const result = chromiumReady(fakeT);
    assert.equal(result, null);
    assert.equal(skipped, true);
  } finally {
    fs.existsSync = realExists;
    if (priorRequire == null) delete process.env.REQUIRE_BROWSER_TESTS;
    else process.env.REQUIRE_BROWSER_TESTS = priorRequire;
  }
});

test('chromiumReady fails when required but executable is absent', () => {
  const priorRequire = process.env.REQUIRE_BROWSER_TESTS;
  process.env.REQUIRE_BROWSER_TESTS = '1';
  const realExists = fs.existsSync;
  fs.existsSync = path => (String(path).includes('chrome-linux') ? false : realExists(path));
  try {
    const fakeT = { skip(message) { throw new Error('unexpected skip: ' + message); } };
    assert.throws(() => chromiumReady(fakeT), /REQUIRE_BROWSER_TESTS/);
  } finally {
    fs.existsSync = realExists;
    if (priorRequire == null) delete process.env.REQUIRE_BROWSER_TESTS;
    else process.env.REQUIRE_BROWSER_TESTS = priorRequire;
  }
});
