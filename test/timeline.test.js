const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { planUpload } = require('../lib/upload');
const { monthsEnding, labelFor, frameIndex, schedule, buildScript } = require('../public/timeline');

const NOW = Date.parse('2026-10-11T00:00:00Z');

test('the timeline walks the past twelve months and leaves undated lights last', () => {
  assert.deepEqual(monthsEnding(NOW, 12)[0], '2025-11');
  assert.deepEqual(monthsEnding(NOW, 12).at(-1), '2026-10');
  assert.equal(labelFor('2026-06'), 'June 2026');
  assert.equal(labelFor(null), 'Date unknown');

  const plan = schedule([
    { place: 'June', month: '2026-06', created: 2 },
    { place: 'June earlier', month: '2026-06', created: 1 },
    { place: 'Old', month: '2020-01', created: 3 },
    { place: 'Future', month: '2027-01', created: 4 },
    { place: 'Undated', month: null, created: 5 },
    { place: 'Garbage', month: 'nope', created: 6 },
  ], NOW, 12);

  assert.equal(plan.frames.length, 13);
  assert.deepEqual(plan.frames.find(frame => frame.month === '2026-06').lights.map(light => light.place), ['June earlier', 'June']);
  assert.equal(plan.frames[0].lights[0].place, 'Old');
  assert.equal(plan.frames.at(-2).lights[0].place, 'Future');
  assert.deepEqual(plan.frames.at(-1).lights.map(light => light.place), ['Undated', 'Garbage']);
  assert.equal(frameIndex('2026-06', NOW, 12), monthsEnding(NOW).indexOf('2026-06'));
  assert.equal(frameIndex(null, NOW, 12), 12);
  assert.equal(frameIndex('2020-01', NOW, 12), 0);
});

test('a timeline cycle lasts the requested time and reveals lights inside their month', () => {
  const script = buildScript([
    { place: 'Cork, Ireland', month: '2026-06', created: 1, lat: 51.9, lon: -8.5 },
    { place: 'Lisbon, Portugal', month: null, created: 2, lat: 38.7, lon: -9.1 },
  ], NOW, 75000);
  assert.equal(script.total, 75000);
  assert.equal(script.events.at(-1).type, 'restart');
  assert.equal(script.events.at(-1).t, 75000);
  assert.equal(script.events.find(event => event.type === 'hold').label, 'This year');
  const reveal = script.events.find(event => event.type === 'reveal' && event.light.place === 'Cork, Ireland');
  const frame = script.events.find(event => event.type === 'frame' && event.month === '2026-06');
  const next = script.events.find(event => event.type === 'frame' && event.t > frame.t);
  assert.ok(reveal.t >= frame.t && reveal.t < next.t);
  const undated = script.events.find(event => event.type === 'reveal' && event.light.place === 'Lisbon, Portugal');
  assert.equal(undated.index, 12);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.match(html, /timeline\.js/);
  assert.match(html, /mode/);
  assert.match(html, /cycle/);
  assert.match(html, /This year/);
});

test('the earliest past-year month is kept and an unparsed date stays null', () => {
  const text = [
    '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"',
    '"N","ABCD-123","Birth, 1900, Cork, Ireland","Endowment","2 March 2026","Temple"',
    '"N","ABCD-123","Birth, 1900, Cork, Ireland","Baptism","15 September 2026","Temple"',
    '"N","ABCD-124","Birth, 1900, Cork, Ireland","Baptism","not a date","Temple"',
  ].join('\n');
  const plan = planUpload(text, { now: NOW, existingIds: new Set(), cache: {} });
  assert.equal(plan.pending.find(job => job.id === 'ABCD-123').month, '2026-03');
  assert.equal(plan.pending.find(job => job.id === 'ABCD-123').completed, '2026-03-02');
  assert.equal(plan.pending.find(job => job.id === 'ABCD-124').month, null);
  assert.equal(plan.pending.find(job => job.id === 'ABCD-124').completed, null);
});

test('a repeated file can fill a missing month without adding an ordinance', () => {
  const header = '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"\n';
  const text = header + '"N","ABCD-123","Birth, 1900, Ogden, Weber, Utah, United States","Baptism","15 September 2026","Temple"';
  const plan = planUpload(text, {
    now: NOW,
    existing: [{ id: 'ABCD-123', ordinance: 'Baptism', month: null }],
    cache: {},
  });
  assert.equal(plan.stats.duplicate, 1);
  assert.equal(plan.stats.merged, 0);
  assert.deepEqual(plan.merges, []);
  assert.deepEqual(plan.monthFixes, [{ id: 'ABCD-123', month: '2026-09', completed: '2026-09-15' }]);
});

test('a newly merged ordinance can move the completion month earlier', () => {
  const header = '"Person","Id Number","Qualifying Event","Ordinances","Date","Temple"\n';
  const text = header + '"N","ABCD-123","Birth, 1900, Ogden, Weber, Utah, United States","Endowment","2 March 2026","Temple"';
  const plan = planUpload(text, {
    now: NOW,
    existing: [{ id: 'ABCD-123', ordinance: 'Baptism', month: '2026-09' }],
    cache: {},
  });
  assert.equal(plan.stats.merged, 1);
  assert.equal(plan.merges[0].month, '2026-03');
  assert.equal(plan.merges[0].completed, '2026-03-02');
});
