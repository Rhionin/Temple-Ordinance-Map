const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeSlug, onMaster, publicGroup, countsTowardCap, creationBlock, uploadsAllowed, MAX_GROUPS,
} = require('../lib/groups');
const { foldLights } = require('../lib/fold');

test('slugs are short, lowercase, and not reserved', () => {
  assert.equal(normalizeSlug(' Ward-Party '), 'ward-party');
  assert.equal(normalizeSlug('tv'), '');
  assert.equal(normalizeSlug('admin'), '');
  assert.equal(normalizeSlug('-nope'), '');
  assert.equal(normalizeSlug('a'), 'a');
  assert.equal(normalizeSlug('has space'), '');
});

test('disable hides the master map and soft delete hides the group page', () => {
  const live = { disabled: 0, deleted: 0 };
  const disabled = { disabled: 1, deleted: 0 };
  const removed = { disabled: 0, deleted: 1 };
  const both = { disabled: 1, deleted: 1 };
  assert.equal(onMaster(live), true);
  assert.equal(publicGroup(live), true);
  assert.equal(countsTowardCap(live), true);
  assert.equal(onMaster(disabled), false);
  assert.equal(publicGroup(disabled), false);
  assert.equal(countsTowardCap(disabled), true);
  assert.equal(onMaster(removed), true);
  assert.equal(publicGroup(removed), false);
  assert.equal(countsTowardCap(removed), false);
  assert.equal(onMaster(both), false);
  assert.equal(countsTowardCap(both), false);
});

test('creation stops at 50 groups and at 10 creates in an hour', () => {
  assert.equal(creationBlock({ existing: MAX_GROUPS - 1, createdInWindow: 0 }), '');
  assert.match(creationBlock({ existing: MAX_GROUPS, createdInWindow: 0 }), /as many groups/);
  assert.match(creationBlock({ existing: 1, createdInWindow: 10 }), /this hour/);
});

test('an upload window refuses files and still describes a public group', () => {
  const group = { disabled: 0, deleted: 0, uploads_open: '2026-10-01T00:00:00Z', uploads_close: '2026-10-29T00:00:00Z' };
  assert.equal(uploadsAllowed(group, Date.parse('2026-10-12T00:00:00Z')), true);
  assert.equal(uploadsAllowed(group, Date.parse('2026-11-01T00:00:00Z')), false);
  assert.equal(publicGroup(group), true);
});

test('the master fold counts one ancestor and keeps the oldest place', () => {
  const folded = foldLights([
    {
      person_id: 'ABCD-123', place: 'Cork', lat: 51.9, lon: -8.4, country: 'IE',
      ordinance: '["Baptism"]', created: 10, updated: 10, month: '2026-03', completed: '2026-03-02',
    },
    {
      person_id: 'ABCD-123', place: 'Provo', lat: 40.2, lon: -111.6, country: 'US',
      ordinance: '["Endowment"]', created: 20, updated: 25, month: '2026-01', completed: '2026-01-04',
    },
    {
      person_id: 'WXYZ-999', place: 'Lima', lat: -12.0, lon: -77.0, country: 'PE',
      ordinance: '["Initiatory"]', created: 15, updated: 15, month: '2026-05', completed: '2026-05-01',
    },
  ]);
  assert.equal(folded.length, 2);
  assert.equal(folded[0].person_id, 'ABCD-123');
  assert.equal(folded[0].place, 'Cork');
  assert.equal(folded[0].lat, 51.9);
  assert.equal(folded[0].country, 'IE');
  assert.equal(folded[0].created, 10);
  assert.equal(folded[0].updated, 25);
  assert.equal(folded[0].month, '2026-01');
  assert.equal(folded[0].completed, '2026-01-04');
  assert.deepEqual(JSON.parse(folded[0].ordinance), ['Baptism', 'Endowment']);
  assert.equal(folded[1].place, 'Lima');
});
