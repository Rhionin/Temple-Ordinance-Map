const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { noteRemote, releaseBoundary, noteUpload, EVERY_MS } = require('../public/version');
const { resolveBuildId } = require('../lib/build-id');
const { handleApi } = require('../lib/http');

function req(pathname) {
  return {
    url: 'http://localhost' + pathname,
    method: 'GET',
    headers: { get: () => null },
    text: async () => '',
  };
}

test('a new build waits for a TV transition, and the upload page stays put while busy', () => {
  assert.equal(EVERY_MS, 60000);
  const first = noteRemote(null, 'aaa1111');
  assert.equal(first.action, 'stay');
  assert.equal(releaseBoundary(first.state).action, 'stay');

  const pending = noteRemote(first.state, 'bbb2222');
  assert.equal(pending.action, 'wait');
  assert.equal(releaseBoundary(pending.state).action, 'reload');
  assert.equal(releaseBoundary(releaseBoundary(pending.state).state).action, 'stay');

  const newer = noteRemote(pending.state, 'ccc3333');
  assert.equal(releaseBoundary(newer.state).state.current, 'ccc3333');

  const same = noteRemote(first.state, 'aaa1111');
  assert.equal(same.action, 'stay');
  assert.equal(noteRemote(first.state, '').action, 'stay');

  const busy = noteUpload(first.state, 'bbb2222', false);
  assert.equal(busy.action, 'notice');
  assert.equal(busy.state.current, 'aaa1111');
  const stillBusy = noteUpload(busy.state, 'bbb2222', false);
  assert.equal(stillBusy.action, 'notice');
  const idle = noteUpload(busy.state, 'bbb2222', true);
  assert.equal(idle.action, 'reload');
  assert.equal(idle.state.current, 'bbb2222');
  assert.equal(noteUpload(idle.state, 'bbb2222', true).action, 'stay');
});

test('version id comes from the deploy env, then git, then dev', () => {
  assert.equal(resolveBuildId('  abcdef1 '), 'abcdef1');
  assert.equal(resolveBuildId('', () => '0123456789abcdef\n'), '0123456789abcdef');
  assert.equal(resolveBuildId('', () => { throw new Error('no git'); }), 'dev');
  assert.equal(resolveBuildId('', () => 'not-a-sha'), 'dev');
  assert.equal(resolveBuildId(''), 'dev');
});

test('GET /api/version returns the build id and is not cached', async () => {
  const response = await handleApi(req('/api/version'), { buildId: 'abc123def' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { version: 'abc123def' });
  const fallback = await handleApi(req('/api/version'), {});
  assert.deepEqual(await fallback.json(), { version: 'dev' });
});

test('pages poll the build id and the deploy workflow injects the commit', () => {
  const root = path.join(__dirname, '..');
  const tv = fs.readFileSync(path.join(root, 'public', 'tv.html'), 'utf8');
  const upload = fs.readFileSync(path.join(root, 'public', 'upload.html'), 'utf8');
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');
  const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  assert.match(tv, /version\.js/);
  assert.match(tv, /\.boundary\(\)/);
  assert.match(upload, /version\.js/);
  assert.match(upload, /Updated, refresh/);
  assert.match(upload, /mode:\s*'upload'/);
  assert.match(yml, /wrangler deploy --var BUILD_ID:\$\{\{ github\.sha \}\}/);
  assert.match(toml, /BUILD_ID = "dev"/);
  assert.doesNotMatch(yml, /RESET_TOKEN/);
  assert.doesNotMatch(yml, /\/api\/reset/);
});
