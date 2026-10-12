const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fromGeoJSON } = require('../public/country-at');
const { countryAt } = require('../lib/country');
const { tally, sharersShown } = require('../public/visible-totals');

test('a point in a drawn country uses that outline and skips a code of -99', () => {
  const square = fromGeoJSON({
    features: [
      {
        properties: { ISO_A2: '-99', ISO_A2_EH: '-99', NAME: 'Nowhere' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
      },
      {
        properties: { ISO_A2: 'ZZ' },
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
      },
    ],
  });
  assert.equal(square(5, 5), 'ZZ');
  assert.equal(square(1, 1), 'ZZ');
  assert.equal(square(20, 20), null);
  const world = fromGeoJSON(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'world.geojson'), 'utf8')));
  assert.equal(world(51.9, -8.47), countryAt(51.9, -8.47));
  assert.equal(world(40.76, -111.89), 'US');
});

test('visible totals count people and ordinances, and sharers wait until every person is shown', () => {
  const totals = tally([
    { lat: 51.9, lon: -8.47, ordinances: ['Baptism', 'Endowment'] },
    { lat: 37.8, lon: -84.8, ordinances: ['Initiatory', 'Nope'] },
    { lat: 0, lon: 0, ordinance: '["Sealing to Parents"]' },
  ], (lat, lon) => (lon < -10 ? 'US' : (lat > 40 ? 'IE' : null)));
  assert.equal(totals.ancestors, 3);
  assert.equal(totals.countries, 2);
  assert.equal(totals.ordinances.Baptism, 1);
  assert.equal(totals.ordinances.Endowment, 1);
  assert.equal(totals.ordinances.Initiatory, 1);
  assert.equal(totals.ordinances['Sealing to Parents'], 1);
  assert.equal(totals.ordinances.Confirmation, 0);
  assert.equal(totals.ordinances.Nope, undefined);
  assert.equal(sharersShown(2, 3, 5), 0);
  assert.equal(sharersShown(3, 3, 5), 5);
  assert.equal(sharersShown(0, 0, 5), 0);
});

test('the TV is a 16:9 stage, the headline counts ancestors, and timeline reveals name the place', () => {
  const tv = fs.readFileSync(path.join(__dirname, '..', 'public', 'tv.html'), 'utf8');
  assert.match(tv, /id="stage"/);
  assert.match(tv, /width:1920px/);
  assert.match(tv, /height:1080px/);
  assert.match(tv, /stage-fit\.js/);
  assert.match(tv, /StageFit\.visibleBox/);
  assert.match(tv, /StageFit\.fit\(view\.width,\s*view\.height/);
  const stageFit = fs.readFileSync(path.join(__dirname, '..', 'public', 'stage-fit.js'), 'utf8');
  assert.match(stageFit, /\/\s*1920/);
  assert.match(stageFit, /\/\s*1080/);
  assert.match(tv, /ancestor this year/);
  assert.match(tv, /ancestors this year/);
  assert.doesNotMatch(tv, /lights of temple work this year/);
  assert.match(tv, /visible-totals\.js/);
  assert.match(tv, /country-at\.js/);
  assert.match(tv, /function revealLight/);
  const reveal = tv.slice(tv.indexOf('function revealLight'), tv.indexOf('function revealMissed'));
  assert.match(reveal, /showCard/);
  assert.match(reveal, /paintTotals/);
  assert.match(tv, /version\.js/);
  assert.match(tv, /versions\.boundary\(\)/);
  assert.match(tv, /mapEpoch/);
  assert.match(tv, /padding:\s*0\.8/);
  assert.match(tv, /1337/);
  assert.doesNotMatch(tv, /@media \(max-width:700px\)/);
});
