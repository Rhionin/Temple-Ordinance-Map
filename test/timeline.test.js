const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { planUpload } = require('../lib/upload');
const { monthsEnding, labelFor, frameIndex, slotFor, schedule, buildScript } = require('../public/timeline');

const NOW = Date.parse('2026-10-11T00:00:00Z');

test('the timeline walks the past twelve months and spreads undated lights through them', () => {
  assert.deepEqual(monthsEnding(NOW, 12)[0], '2025-11');
  assert.deepEqual(monthsEnding(NOW, 12).at(-1), '2026-10');
  assert.equal(labelFor('2026-06'), 'June 2026');
  assert.equal(labelFor(null), '');

  const undated = { id: 'UNDATED-1', place: 'Undated', month: null, created: 5 };
  const garbage = { id: 'GARBAGE-1', place: 'Garbage', month: 'nope', created: 6 };
  const plan = schedule([
    { place: 'June', month: '2026-06', created: 2 },
    { place: 'June earlier', month: '2026-06', created: 1 },
    { place: 'Old', month: '2020-01', created: 3 },
    { place: 'Future', month: '2027-01', created: 4 },
    undated,
    garbage,
  ], NOW, 12);

  assert.equal(plan.frames.length, 12);
  assert.ok(plan.frames.every(frame => frame.month && frame.label && frame.label !== 'Date unknown'));
  assert.deepEqual(plan.frames.find(frame => frame.month === '2026-06').lights.map(light => light.place), ['June earlier', 'June']);
  assert.equal(plan.frames[0].lights[0].place, 'Old');
  assert.equal(plan.frames.at(-1).lights[0].place, 'Future');
  assert.equal(plan.frames[slotFor(undated, 12)].lights.some(light => light.place === 'Undated'), true);
  assert.equal(plan.frames[slotFor(garbage, 12)].lights.some(light => light.place === 'Garbage'), true);
  assert.equal(frameIndex('2026-06', NOW, 12), monthsEnding(NOW).indexOf('2026-06'));
  assert.equal(frameIndex(undated, NOW, 12), slotFor(undated, 12));
  assert.equal(frameIndex('2020-01', NOW, 12), 0);
  assert.equal(slotFor(undated, 12), slotFor({ id: 'UNDATED-1', place: 'Somewhere else' }, 12));
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'public', 'timeline.js'), 'utf8'), /Date unknown/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8'), /Date unknown/);
});

test('undated lights spread across the twelve months and stay in that month', () => {
  const lights = [];
  for (let i = 0; i < 120; i++) {
    lights.push({ id: 'P' + String(i).padStart(3, '0'), place: 'Same town', month: null, created: 1000 });
  }
  const plan = schedule(lights, NOW, 12);
  const counts = plan.frames.map(frame => frame.lights.length);
  assert.equal(counts.reduce((sum, n) => sum + n, 0), 120);
  assert.ok(Math.min(...counts) >= 1);
  assert.ok(Math.max(...counts) <= 24);
  const again = schedule(lights, NOW, 12);
  assert.deepEqual(again.frames.map(frame => frame.lights.map(light => light.id)), plan.frames.map(frame => frame.lights.map(light => light.id)));
  const samePlace = [
    { place: 'Lisbon, Portugal', month: null, created: 1, lat: 38.7, lon: -9.1 },
    { place: 'Lisbon, Portugal', month: null, created: 2, lat: 38.7, lon: -9.1 },
  ];
  assert.notEqual(slotFor(samePlace[0], 12), slotFor(samePlace[1], 12));
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
  assert.ok(undated.index >= 0 && undated.index < 12);
  assert.equal(undated.index, slotFor(undated.light, 12));
  assert.equal(script.frames.length, 12);
  assert.ok(script.frames.every(frame => frame.label !== 'Date unknown'));
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
