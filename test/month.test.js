const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { planUpload } = require('../lib/upload');
const { handleApi } = require('../lib/http');
const { toPublic, PUBLIC_KEYS } = require('../lib/lights');
const { resolveMonth } = require('../lib/month');
const { schedule } = require('../public/timeline');

const NOW = Date.parse('2026-10-11T00:00:00Z');

function header() {
  return '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"\n';
}

test('a null month is derived from the completion day and stays off the public payload', () => {
  const dated = toPublic({
    place: 'Cork, Ireland', lat: 51.9, lon: -8.5, created: 1, updated: 1,
    ordinance: '["Baptism"]', month: null, completed: '2026-06-15',
  });
  const undated = toPublic({
    place: 'Mercer, Kentucky', lat: 37.8, lon: -84.8, created: 2, updated: 2,
    ordinance: '["Endowment"]', month: null, completed: null,
  });
  assert.equal(dated.month, '2026-06');
  assert.equal(undated.month, null);
  assert.equal(dated.completed, undefined);
  assert.deepEqual(Object.keys(dated).sort(), [...PUBLIC_KEYS].sort());
  assert.equal(resolveMonth('2026-01', '2026-08-01'), '2026-01');
  assert.equal(resolveMonth(null, '2026-02-31'), null);

  const plan = schedule([dated, undated], NOW, 12);
  assert.equal(plan.frames.length, 12);
  assert.equal(plan.frames.find(frame => frame.month === '2026-06').lights[0].place, 'Cork, Ireland');
  const placed = plan.frames.find(frame => frame.lights.some(light => light.place === 'Mercer, Kentucky'));
  assert.ok(placed);
  assert.match(placed.label, /^(January|February|March|April|May|June|July|August|September|October|November|December) /);
});

test('english and finnish completion dates are stored as months', () => {
  const text = header() + [
    '"N","ABCD-123","Birth, 1900, Cork, Ireland","Baptism","15 September 2026","Temple"',
    '"N","ABCD-124","Syntymä, 1900, Helsinki, Finland","Kaste","15. syyskuuta 2026","Temppeli"',
    '"N","ABCD-125","Syntymä, 1900, Tampere, Finland","Endaumentti","2.10.2026.","Temppeli"',
    '"N","EFGH-12","Syntymä, 1900, Turku, Finland","Konfirmaatio","\u200e15.9.2026\u200e","Temppeli"',
    '"N","IJKL-10","Syntymä, 1900, Oulu, Finland","Initiaatio","2. lokakuuta 2026","Temppeli"',
  ].join('\n');
  const plan = planUpload(text, { now: NOW, existingIds: new Set(), cache: {} });
  assert.equal(plan.ok, true);
  const monthOf = id => plan.pending.find(job => job.id === id);
  assert.equal(monthOf('ABCD-123').month, '2026-09');
  assert.equal(monthOf('ABCD-123').completed, '2026-09-15');
  assert.equal(monthOf('ABCD-124').month, '2026-09');
  assert.equal(monthOf('ABCD-124').completed, '2026-09-15');
  assert.equal(monthOf('ABCD-125').month, '2026-10');
  assert.equal(monthOf('ABCD-125').completed, '2026-10-02');
  assert.equal(monthOf('EFGH-12').month, '2026-09');
  assert.equal(monthOf('IJKL-10').month, '2026-10');
});

test('re-uploading the same list fills a missing month without a reset', async () => {
  const lights = [{
    id: 'ABCD-123', ordinance: '["Baptism"]', month: null, completed: null,
    place: 'Helsinki, Finland', lat: 60.17, lon: 24.94, created: 5, updated: 5,
  }];
  const store = {
    lights,
    async ids() { return lights.map(light => light.id); },
    async known() {
      return lights.map(light => ({ id: light.id, ordinance: light.ordinance, month: light.month || null, completed: light.completed || null }));
    },
    async maxCreated() { return 5; },
    async cacheFor() { return {}; },
    async listLights() { return lights; },
    async setMonth(update) {
      const light = lights.find(item => item.id === update.id);
      if (!light || !update.month || (light.month && light.month <= update.month)) return false;
      light.month = update.month;
      light.completed = update.completed || light.completed;
      light.updated = update.updated;
      return true;
    },
  };
  const text = header() + '"N","ABCD-123","Birth, 1900, Helsinki, Finland","Kaste","15. syyskuuta 2026","Temppeli"';
  const response = await handleApi({
    url: 'http://localhost/api/upload',
    method: 'POST',
    headers: { get: () => null },
    text: async () => text,
  }, { store });
  assert.equal(response.status, 200);
  assert.equal(lights[0].month, '2026-09');
  assert.equal(lights[0].completed, '2026-09-15');
  assert.ok(lights[0].updated > 5);
  const listed = await handleApi({
    url: 'http://localhost/api/lights?since=0',
    method: 'GET',
    headers: { get: () => null },
  }, { store });
  const body = await listed.json();
  assert.equal(body[0].month, '2026-09');
  assert.equal(body[0].completed, undefined);
});

test('the completed-day migration backfills month and leaves a dateless row alone', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const dir = path.join(__dirname, '..', 'migrations');
  for (const name of fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
  }
  const insert = db.prepare(
    'INSERT INTO lights (group_id, person_id, place, lat, lon, ordinance, created, updated, month, completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  insert.run(1, 'PRE1-001', 'Mercer', 1, 2, '[]', 1, 1, null, null);
  insert.run(1, 'DATE-001', 'Cork', 1, 2, '[]', 2, 2, null, '2026-06-15');
  insert.run(1, 'KEEP-001', 'Texas', 1, 2, '[]', 3, 3, '2026-01', '2026-08-01');
  insert.run(1, 'BAD1-001', 'Oulu', 1, 2, '[]', 4, 4, null, 'not-a-date');
  const sql = fs.readFileSync(path.join(dir, '0005_light_completed.sql'), 'utf8');
  const updates = sql.split(';').map(part => part.trim()).filter(part => /^UPDATE\b/i.test(part));
  assert.equal(updates.length, 2);
  for (const statement of updates) db.exec(statement);
  const monthOf = id => db.prepare('SELECT month, updated FROM lights WHERE person_id = ?').get(id);
  assert.equal(monthOf('PRE1-001').month, null);
  assert.equal(monthOf('PRE1-001').updated, 1);
  assert.equal(monthOf('DATE-001').month, '2026-06');
  assert.equal(monthOf('DATE-001').updated, 2);
  assert.equal(monthOf('KEEP-001').month, '2026-01');
  assert.equal(monthOf('BAD1-001').month, null);
  for (const statement of updates) db.exec(statement);
  assert.equal(monthOf('DATE-001').month, '2026-06');
  assert.equal(monthOf('DATE-001').updated, 2);
  assert.equal(monthOf('KEEP-001').month, '2026-01');
});
