const test = require('node:test');
const assert = require('node:assert');
const { server } = require('../server');
const { handleApi } = require('../lib/http');

function expectHardened(headers) {
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
  assert.equal(headers.get('x-frame-options'), 'DENY');
  assert.equal(headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  const csp = headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.equal(csp.includes('unpkg.com'), false);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
}

test('the upload page, the TV page, and the lights API send hardening headers', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    for (const path of ['/', '/tv', '/api/lights']) {
      const response = await fetch('http://127.0.0.1:' + port + path);
      assert.equal(response.status, 200);
      expectHardened(response.headers);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('an API Response is hardened before the Worker returns it', async () => {
  const response = await handleApi(
    new Request('http://localhost/api/lights'),
    { store: { async listLights() { return []; } } }
  );
  expectHardened(response.headers);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
});
