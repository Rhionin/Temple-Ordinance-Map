const assert = require('node:assert');
const fs = require('node:fs');

function chromiumReady(t) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (error) {
    if (process.env.REQUIRE_BROWSER_TESTS === '1') {
      assert.fail('playwright is not installed but REQUIRE_BROWSER_TESTS=1');
    }
    t.skip('playwright not installed');
    return null;
  }
  let executablePath = '';
  try {
    executablePath = playwright.chromium.executablePath();
  } catch (error) {
    executablePath = '';
  }
  if (!executablePath || !fs.existsSync(executablePath)) {
    if (process.env.REQUIRE_BROWSER_TESTS === '1') {
      assert.fail(
        'Chromium executable is missing but REQUIRE_BROWSER_TESTS=1 (path: '
        + (executablePath || '(none)') + ')'
      );
    }
    t.skip('playwright chromium executable missing');
    return null;
  }
  return playwright;
}

module.exports = { chromiumReady };
