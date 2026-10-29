const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { seedNames, parseWranglerJson, resultRows } = require('../scripts/prepare-d1-migrations');

test('migration seed matches schema that is already present', () => {
  assert.deepEqual(seedNames({ lights: false, updatedColumn: false }), []);
  assert.deepEqual(seedNames({ lights: false, updatedColumn: true }), []);
  assert.deepEqual(seedNames({ lights: true, updatedColumn: false }), ['0001_init.sql']);
  assert.deepEqual(seedNames({ lights: true, updatedColumn: true }), ['0001_init.sql', '0002_light_updated.sql']);
});

test('wrangler execute JSON can be read from mixed log output', () => {
  const payload = parseWranglerJson('note\n[{"results":[{"name":"lights"}],"success":true}]\n');
  assert.deepEqual(resultRows(payload), [{ name: 'lights' }]);
});

test('deploy workflow tests, migrates, then deploys without calling reset', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  assert.match(yml, /branches: \[main\]/);
  assert.match(yml, /workflow_dispatch/);
  assert.match(yml, /group: deploy-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/);
  assert.match(yml, /cancel-in-progress: false/);
  assert.match(yml, /attempt=1/);
  assert.match(yml, /\[ "\$attempt" -ge 3 \]/);
  assert.match(yml, /sleep 60/);
  assert.match(yml, /node-version: '22'/);
  assert.match(yml, /node --test test\//);
  assert.match(yml, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(yml, /CLOUDFLARE_ACCOUNT_ID: cdaf2135c9b5b619074a6cfbb97f49af/);
  const seed = yml.indexOf('scripts/prepare-d1-migrations.js');
  const apply = yml.indexOf('wrangler d1 migrations apply temple-ordinance-map --remote');
  const deploy = yml.indexOf('wrangler deploy');
  assert.ok(seed > 0 && apply > seed && deploy > apply);
  assert.match(yml, /continue-on-error: true/);
  assert.match(yml, /D1 migration summary/);
  assert.doesNotMatch(yml, /\/api\/reset/);
  assert.doesNotMatch(yml, /RESET_TOKEN/);
});

test('poll index migration 0007 is optional and needs no app code dependency', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0007_poll_indexes.sql'), 'utf8');
  assert.match(sql, /CREATE INDEX IF NOT EXISTS/);
  assert.doesNotMatch(sql, /DROP TABLE|ALTER TABLE|NOT NULL/i);
  const poll = fs.readFileSync(path.join(__dirname, '..', 'lib', 'poll-cache.js'), 'utf8');
  assert.doesNotMatch(poll, /0007_poll_indexes/);
});
