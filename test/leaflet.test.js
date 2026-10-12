const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { server, publicFile } = require('../server');

test('the TV page loads Leaflet from this host', async () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.equal(html.includes('unpkg.com'), false);
  assert.match(html, /href="\/vendor\/leaflet.css"/);
  assert.match(html, /src="\/vendor\/leaflet.js"/);

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const page = await fetch('http://127.0.0.1:' + port + '/tv');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /src="\/vendor\/leaflet.js"/);
    const script = await fetch('http://127.0.0.1:' + port + '/vendor/leaflet.js');
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.match(await script.text(), /Leaflet 1.9.4/);
    const css = await fetch('http://127.0.0.1:' + port + '/vendor/leaflet.css');
    assert.equal(css.status, 200);
    const icon = await fetch('http://127.0.0.1:' + port + '/vendor/images/marker-icon.png');
    assert.equal(icon.status, 200);
    const escaped = await fetch('http://127.0.0.1:' + port + '/vendor/../server.js');
    assert.equal(escaped.status, 404);
    assert.equal(publicFile('/vendor/../server.js'), null);
    assert.equal(publicFile('/vendor/%2e%2e/%2e%2e/server.js'), null);
    assert.equal(publicFile('/vendor/leaflet.js').endsWith(path.join('public', 'vendor', 'leaflet.js')), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
