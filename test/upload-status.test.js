const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { describeUpload, describeProgress, describeError } = require('../public/upload-status');

test('a successful upload names the counts and the map', () => {
  const queued = describeUpload({ pastYear: 12, added: 2, queued: 3, duplicate: 4 });
  assert.equal(queued.kind, 'success');
  assert.equal(queued.title, 'Your 5 lights are being added to the map');
  assert.equal(queued.doneTitle, 'Your 5 lights are on the map');
  assert.equal(queued.pastYear, 12);
  assert.equal(queued.added, 2);
  assert.equal(queued.duplicate, 4);
  assert.equal(queued.arriving, 5);
  assert.equal(queued.mapHref, '/tv');
  assert.equal(queued.mapLabel, 'See the map');
  assert.equal(describeProgress(2, 5, false), 'Finding places — 2 of 5');
  assert.equal(describeProgress(5, 5, false), 'All 5 new lights are on the map');

  const done = describeUpload({ pastYear: 1, added: 1, queued: 0, duplicate: 0 });
  assert.equal(done.title, 'Your 1 light is on the map');

  const already = describeUpload({ pastYear: 3, added: 0, queued: 0, duplicate: 3 });
  assert.equal(already.kind, 'success');
  assert.equal(already.title, 'Your lights are already on the map');
});

test('empty lists and bad files get a clear error', () => {
  const none = describeUpload({ pastYear: 0, added: 0, queued: 0, duplicate: 0, total: 8 });
  assert.equal(none.kind, 'empty');
  assert.match(none.message, /past year/);
  const unplaced = describeUpload({ pastYear: 2, added: 0, queued: 0, duplicate: 0 });
  assert.equal(unplaced.kind, 'empty');
  assert.match(unplaced.message, /place/);
  assert.match(describeError('file'), /Completed list/);
  assert.match(describeError('network'), /connection/);
  assert.match(describeError('server', 'file too large'), /file too large/);
  assert.match(describeProgress(0, 2, true), /Found 0 of 2/);
});

test('the upload and TV pages expose the success card and the spotlight', () => {
  const upload = fs.readFileSync(path.join(__dirname, '..', 'public', 'upload.html'), 'utf8');
  assert.match(upload, /upload-status\.js/);
  assert.match(upload, /Past-year ordinances found/);
  assert.match(upload, /New lights added/);
  assert.match(upload, /Already on the map/);
  assert.match(upload, /id="see-map" href="\/tv"/);
  assert.match(upload, /See the map/);
  assert.equal((upload.match(/Scroll all the way to the bottom/g) || []).length, 2);
  assert.match(upload, /class="os ios"><b>Scroll all the way to the bottom<\/b> of the list and tap <b>Download List<\/b>/);
  assert.match(upload, /class="os android"><b>Scroll all the way to the bottom<\/b> of the list and tap <b>Download List<\/b>/);
  assert.match(upload, /class="candles"/);
  assert.match(upload, /<html lang="en">/);
  assert.match(upload, /<title>Light a candle 🕯️<\/title>/);
  assert.doesNotMatch(upload, /Nuestros|Antepasados/);
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.match(tv, /spotlight\.js/);
  assert.match(tv, /id="card"/);
  assert.match(tv, /flick 2\.4s/);
  assert.match(tv, /<html lang="en">/);
  assert.match(tv, /<title>Temple Ordinance Lights<\/title>/);
  assert.match(tv, /Light a candle for our ancestors/);
  assert.doesNotMatch(tv, /Our Ancestors/);
  assert.doesNotMatch(tv, /id="count"/);
  assert.match(tv, /paintCountriesDuringMove/);
  assert.match(tv, /padding: 0\.8/);
  assert.doesNotMatch(tv, /Nuestros|Antepasados/);
});
