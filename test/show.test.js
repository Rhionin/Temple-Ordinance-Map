const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createDeck, captionFor } = require('../public/spotlight');
const { SHOW_MS, naturalTimelineMs, planCycle } = require('../public/show');
const { monthsEnding, dataWindowMonths, buildScript } = require('../public/timeline');

const NOW = Date.parse('2026-10-11T00:00:00Z');
const DWELL_MS = 9000;

function light(place, created, month, ordinances) {
  return {
    place,
    lat: created,
    lon: created + 10,
    created,
    month: month || null,
    ordinances: ordinances || ['Baptism'],
  };
}

function take(deck, count) {
  const places = [];
  for (let i = 0; i < count; i++) places.push(deck.next().place);
  return places;
}

test('spotlight order walks across cycles without a repeat, then skips the light just shown', () => {
  const deck = createDeck({ rng: () => 0 });
  deck.seed([1, 2, 3, 4, 5, 6].map(n => light('P' + n, n)));
  const first = take(deck, 2);
  const second = take(deck, 2);
  const third = take(deck, 2);
  const shown = [...first, ...second, ...third];
  assert.equal(new Set(shown).size, 6);
  assert.notDeepEqual(first, second);
  assert.notDeepEqual(second, third);
  const last = shown[shown.length - 1];
  assert.notEqual(deck.next().place, last);

  const again = createDeck({ rng: () => 0 });
  again.seed([light('Only', 1, null, ['Endowment'])]);
  assert.equal(again.next().place, 'Only');
  assert.equal(again.next().place, 'Only');
  assert.equal(createDeck({ rng: () => 0 }).next(), null);
});

test('a reshuffle does not open on the light that just played', () => {
  const seq = [0, 0.999, 0];
  let n = 0;
  const deck = createDeck({ rng: () => seq[n++] });
  deck.seed([light('A', 1), light('B', 2)]);
  assert.deepEqual(take(deck, 2), ['B', 'A']);
  assert.equal(deck.next().place, 'B');
});

test('a live light joins the pool and is shown before the order starts over', () => {
  const deck = createDeck({ rng: () => 0 });
  deck.seed([light('A', 1), light('B', 2), light('C', 3)]);
  const first = deck.next().place;
  const joined = deck.arrive(light('New', 9, '2026-06', ['Endowment']));
  assert.equal(joined.isNew, true);
  const rest = take(deck, 3);
  assert.deepEqual(rest, ['C', 'A', 'New']);
  assert.equal(rest.includes(first), false);
  const update = deck.arrive({ ...light('New', 9, '2026-06', ['Endowment']), ordinances: ['Sealing to Spouse'] });
  assert.equal(update.isNew, false);
  assert.equal(deck.all().length, 4);
  assert.deepEqual(deck.get(light('New', 9)).ordinances, ['Endowment', 'Sealing to Spouse']);
});

test('a spotlight caption is the place and the ordinance, never a name', () => {
  const deck = createDeck({ rng: () => 0 });
  deck.seed([{
    name: 'Hidden Person',
    id: 'ABCD-123',
    place: 'Cork, Ireland',
    lat: 51.9,
    lon: -8.4,
    created: 3,
    ordinances: ['Baptism', 'Baptism'],
  }]);
  const shown = deck.next();
  assert.equal(shown.name, undefined);
  assert.equal(shown.id, undefined);
  const caption = captionFor(shown, deck.all());
  assert.equal(caption.place, 'Cork, Ireland');
  assert.equal(caption.ordinancesText, 'Baptism');
  const text = Object.values(caption).join(' ');
  assert.equal(text.includes('Hidden'), false);
  assert.equal(text.includes('ABCD'), false);
});

test('a five-minute cycle plays the time-lapse first and compresses it when the window is too long', () => {
  assert.equal(SHOW_MS, 5 * 60 * 1000);
  assert.equal(dataWindowMonths([light('Recent', 1, '2026-06')], NOW, 12), 12);
  assert.equal(dataWindowMonths([], NOW, 24), 24);
  const span = monthsEnding(NOW, 120);
  const old = dataWindowMonths([light('Old', 1, '2024-01'), light('Undated', 2, null)], NOW, 12);
  assert.equal(old, 120 - span.indexOf('2024-01'));
  assert.ok(old > 12);
  assert.equal(dataWindowMonths([light('Ancient', 1, '1990-01')], NOW, 12), 120);

  const steady = planCycle(naturalTimelineMs(12, 75000), SHOW_MS);
  assert.equal(steady.naturalMs, 75000);
  assert.equal(steady.timelineMs, 75000);
  assert.equal(steady.spotlightMs, 225000);
  assert.equal(steady.compressed, false);
  assert.equal(steady.timelineMs + steady.spotlightMs, SHOW_MS);
  assert.equal(Math.floor(steady.spotlightMs / DWELL_MS) * DWELL_MS, steady.spotlightMs);

  const wider = planCycle(naturalTimelineMs(old, 75000), SHOW_MS);
  assert.equal(wider.timelineMs + wider.spotlightMs, SHOW_MS);
  assert.ok(wider.timelineMs > steady.timelineMs);
  assert.equal(wider.compressed, false);

  const huge = planCycle(naturalTimelineMs(120, 75000), SHOW_MS);
  assert.ok(huge.naturalMs > SHOW_MS);
  assert.equal(huge.timelineMs, SHOW_MS);
  assert.equal(huge.spotlightMs, 0);
  assert.equal(huge.compressed, true);

  const script = buildScript([light('Old', 1, '2024-01')], NOW, wider.timelineMs, old);
  assert.equal(script.frames[0].month, monthsEnding(NOW, old)[0]);
  assert.equal(script.frames[0].month, '2024-01');
  const hold = script.events.find(event => event.type === 'hold');
  assert.equal(hold.label, 'This year');
  assert.ok(hold.t > 0 && hold.t < script.total);
  assert.equal(script.total, wider.timelineMs);

  const compressed = buildScript([light('Ancient', 1, '1990-01')], NOW, huge.timelineMs, 120);
  assert.equal(compressed.total, SHOW_MS);
  assert.equal(compressed.frames[0].month, monthsEnding(NOW, 120)[0]);
  assert.equal(compressed.events.find(event => event.type === 'hold').label, 'This year');
  assert.equal(compressed.events.at(-1).t, SHOW_MS);
});

test('both map displays run the five-minute show', () => {
  const root = path.join(__dirname, '..');
  const tv = fs.readFileSync(path.join(root, 'public', 'tv.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');
  assert.match(tv, /show\.js/);
  assert.match(tv, /Spotlight\.createDeck/);
  assert.match(tv, /Show\.planCycle/);
  assert.match(tv, /Show\.naturalTimelineMs/);
  assert.match(tv, /Show\.SHOW_MS/);
  assert.match(tv, /Timeline\.dataWindowMonths/);
  assert.match(tv, /deck\.arrive/);
  assert.match(tv, /playMode !== 'show'/);
  assert.match(server, /\/map' \? 'tv\.html'/);
  assert.match(worker, /mapPage/);
  assert.match(worker, /\/tv\.html/);
  assert.match(server, /'\/': 'tv\.html'/);
  assert.match(worker, /'\/': '\/tv\.html'/);
});
