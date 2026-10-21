// The favourites of a visitor (public/favourites.js, #245): what is kept of
// them in the browser, and when a stop or a line of another timetable is the
// one kept. Where they are in the search: test/search.test.js.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { favouritesFrom, isFavourite, lineFavourite, sameLine, sameStop, stopFavourite, withFavourite } from '../public/favourites.js';

const PLAERRER = { name: 'Nürnberg Plärrer', lat: 49.44809, lon: 11.0648 };
const U1 = { name: 'U1', mode: 'subway', agency: 'VerkehrsAG Nürnberg', lat: 49.44428, lon: 11.05986 };

test('what was stored is taken as far as it has the shape of favourites', () => {
  const none = { stops: [], lines: [] };
  for (const stored of [null, undefined, 'x', 3, [], {}, { stops: 'x', lines: {} }]) assert.deepEqual(favouritesFrom(stored), none);
  assert.deepEqual(favouritesFrom({
    stops: [PLAERRER, { name: 'no place' }, { name: 1, lat: 2, lon: 3 }, null, { ...PLAERRER, lat: Number.NaN }, { ...PLAERRER, id: '123' }, { ...PLAERRER, modes: ['tram', 3] }],
    lines: [U1, { ...U1, mode: undefined }, PLAERRER],
    more: [1],
  }), { stops: [PLAERRER, PLAERRER, PLAERRER], lines: [U1] });
  // (a stop keeps the kinds that call there, where they were kept)
  assert.deepEqual(favouritesFrom({ stops: [{ ...PLAERRER, modes: ['subway', 'tram'] }] }).stops, [{ ...PLAERRER, modes: ['subway', 'tram'] }]);
});

test('a stop and a line are kept as their answers say them, to 1e-5 degrees', () => {
  const modes = ['subway', 'tram', 'bus'];
  assert.deepEqual(stopFavourite({ id: '258216', name: 'Nürnberg Plärrer', lat: 49.448093, lon: 11.064804, departures: [] }, modes), { ...PLAERRER, modes });
  assert.deepEqual(lineFavourite({ name: 'U1', mode: 'subway', agency: 'VerkehrsAG Nürnberg', at: [49.444281, 11.059857], vehicles: [] }), U1);
});

test('a stop of the same name up to 1 km away is the one kept, a line of the same name, mode and operator up to 10 km', () => {
  assert.ok(sameStop(PLAERRER, { ...PLAERRER, lat: PLAERRER.lat + 0.008 }));
  assert.ok(!sameStop(PLAERRER, { ...PLAERRER, lat: PLAERRER.lat + 0.01 }));
  assert.ok(!sameStop(PLAERRER, { ...PLAERRER, name: 'Hersbruck Plärrer' }));
  assert.ok(sameLine(U1, { ...U1, lat: U1.lat + 0.08 }));
  assert.ok(!sameLine(U1, { ...U1, lat: U1.lat + 0.1 }));
  assert.ok(!sameLine(U1, { ...U1, mode: 'bus' }));
  assert.ok(!sameLine(U1, { ...U1, agency: 'Stadtwerke München' }));
});

test('a stop or a line is made a favourite at the end of the list, and is one no longer with every one kept for it', () => {
  let favourites = favouritesFrom(null);
  assert.ok(!isFavourite(favourites, 'stops', PLAERRER));
  favourites = withFavourite(favourites, 'stops', PLAERRER, true);
  favourites = withFavourite(favourites, 'lines', U1, true);
  const hbf = { name: 'Nürnberg Hbf', lat: 49.44561, lon: 11.08299 };
  favourites = withFavourite(favourites, 'stops', hbf, true);
  assert.deepEqual(favourites, { stops: [PLAERRER, hbf], lines: [U1] });
  assert.ok(isFavourite(favourites, 'stops', { ...PLAERRER, lon: 11.065 }));
  assert.ok(isFavourite(favourites, 'lines', U1));
  assert.ok(!isFavourite(favourites, 'lines', { ...U1, name: 'U2' }));
  // (the same stop once more, moved a little: kept once, where it is now)
  const moved = { ...PLAERRER, lat: 49.4482 };
  assert.deepEqual(withFavourite(favourites, 'stops', moved, true).stops, [hbf, moved]);
  assert.deepEqual(withFavourite({ ...favourites, stops: [PLAERRER, hbf, moved] }, 'stops', PLAERRER, false).stops, [hbf]);
  assert.deepEqual(withFavourite(favourites, 'lines', U1, false), { stops: [PLAERRER, hbf], lines: [] });
});
