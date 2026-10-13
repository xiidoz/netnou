// What a zoomed-out map leaves out where a screen cannot take every vehicle
// (server/lib/thinning.js): nothing while it fits, else the same share of
// every kind by chance, but what there is little of whole, and the first of
// every square.

import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDGET, sharesFor, thinOut, ZOOM_ALL, ZOOM_MIN } from '../server/lib/thinning.js';
import { MODES, mix } from '../server/lib/timetable.js';

let made = 0;
/** A number from -1 to 1 by chance, the same at every run. */
const chance = (n) => (mix(n) / 2 ** 32) * 2 - 1;
/** `count` vehicles of a kind scattered around a place, up to `spread` degrees to each side. */
function around(mode, count, lat, lon, spread) {
  return Array.from({ length: count }, () => {
    const n = ++made;
    return { mode, rank: mix(n), lat: lat + chance(n ^ 0x1111) * spread, lon: lon + chance(n ^ 0x2222) * spread };
  });
}
/** How many of the vehicles are shown, of those that `where` picks. */
const count = (vehicles, thinned, where = () => true) => vehicles.filter((v, i) => (!thinned || thinned.shown[i]) && where(v)).length;
const of = (mode) => (v) => v.mode === mode;
const share = (shares, zoom, mode) => shares[zoom - ZOOM_MIN][MODES.indexOf(mode)];

test('what a screen can take is not thinned out', () => {
  // as many as the budget, all at one place: the busiest screen there can be
  const vehicles = around('bus', BUDGET, 50, 10, 0.1);
  const shares = sharesFor(vehicles);
  assert.equal(shares.length, ZOOM_ALL - ZOOM_MIN);
  assert.ok(shares.every((ofZoom) => ofZoom.length === MODES.length && ofZoom.every((part) => part === 1)));
  for (const zoom of [ZOOM_MIN, 7.5, ZOOM_ALL - 0.25, ZOOM_ALL, 15]) assert.equal(thinOut(vehicles, zoom, shares), null, `at zoom ${zoom}`);
});

test('where a screen cannot take them all, the same share of every kind is shown', () => {
  const vehicles = [...around('bus', 6000, 50, 10, 0.1), ...around('tram', 3000, 50, 10, 0.1), ...around('suburban', 600, 50, 10, 0.1)];
  const shares = sharesFor(vehicles);
  const part = share(shares, 5, 'bus');
  assert.ok(part > 0.2 && part < 0.3, `a share of ${part}`);
  assert.deepEqual([share(shares, 5, 'tram'), share(shares, 5, 'suburban')], [part, part]);
  // (a kind that is not there at all is not thinned out)
  assert.equal(share(shares, 5, 'regional'), 1);

  const thinned = thinOut(vehicles, 5, shares);
  // twice as many buses as trams, and five times as many trams as S-Bahn trains: on the map as well
  const [buses, trams, trains] = ['bus', 'tram', 'suburban'].map((mode) => count(vehicles, thinned, of(mode)));
  assert.ok(Math.abs(buses / trams - 2) < 0.2 && Math.abs(trams / trains - 5) < 1, `${buses} buses, ${trams} trams, ${trains} trains`);
  // as many as fit: no more, and hardly fewer
  assert.ok(count(vehicles, thinned) <= BUDGET && count(vehicles, thinned) > 0.97 * BUDGET, `${count(vehicles, thinned)} shown`);
  // the answer says of which kind it holds what share
  assert.deepEqual(thinned.shares, { tram: Math.round(part * 1000) / 1000, bus: Math.round(part * 1000) / 1000, suburban: Math.round(part * 1000) / 1000 });
  // a share is taken by the rank: the same vehicles from one moment to the next, wherever they have got to
  const moved = vehicles.map((v) => ({ ...v, lat: v.lat + 0.01, lon: v.lon - 0.01 }));
  const later = thinOut(moved, 5, shares);
  const changed = vehicles.filter((v, i) => thinned.shown[i] !== later.shown[i]).length;
  assert.ok(changed < 0.01 * count(vehicles, thinned), `${changed} came or went`);
});

test('a kind of which there are only a few is shown whole, and of a larger one at least as many', () => {
  // ten buses to six S-Bahn trains, three long-distance trains among them, and five hundred trams
  const vehicles = [...around('bus', 10000, 50, 10, 0.1), ...around('suburban', 6000, 50, 10, 0.1), ...around('longdistance', 3, 50, 10, 0.1), ...around('tram', 500, 50, 10, 0.1)];
  const shares = sharesFor(vehicles);
  const part = share(shares, 5, 'bus');
  assert.ok(part > 0.1 && part < 0.2, `a share of ${part}`);
  assert.equal(share(shares, 5, 'suburban'), part);
  const thinned = thinOut(vehicles, 5, shares);
  const [buses, trains] = [count(vehicles, thinned, of('bus')), count(vehicles, thinned, of('suburban'))];
  assert.ok(Math.abs(buses / trains - 10 / 6) < 0.15, `${buses} buses and ${trains} S-Bahn trains`);
  // all three long-distance trains, whatever the share
  assert.equal(share(shares, 5, 'longdistance'), 1);
  assert.equal(count(vehicles, thinned, of('longdistance')), 3);
  assert.ok(!('longdistance' in thinned.shares));
  // of the trams a twentieth of what a screen holds, where the share of the others would leave 75 or so
  assert.equal(share(shares, 5, 'tram'), BUDGET / 20 / 500);
  const trams = count(vehicles, thinned, of('tram'));
  assert.ok(trams >= 105 && trams <= 150, `${trams} trams`);
  assert.ok(count(vehicles, thinned) <= BUDGET && count(vehicles, thinned) > 0.97 * BUDGET, `${count(vehicles, thinned)} shown`);
});

test('kinds that a map does not show take no room', () => {
  const vehicles = [...around('bus', 6000, 50, 10, 0.1), ...around('tram', 3000, 50, 10, 0.1), ...around('suburban', 600, 50, 10, 0.1)];
  const all = sharesFor(vehicles);
  // without the buses: more of the trams and the trains
  const noBuses = sharesFor(vehicles, MODES.map((mode) => mode !== 'bus'));
  assert.ok(share(noBuses, 5, 'tram') > 2 * share(all, 5, 'tram'), `${share(noBuses, 5, 'tram')} against ${share(all, 5, 'tram')}`);
  assert.equal(share(noBuses, 5, 'suburban'), share(noBuses, 5, 'tram'));
  const thinned = thinOut(vehicles, 5, noBuses);
  const shown = count(vehicles, thinned, (v) => v.mode !== 'bus');
  assert.ok(shown <= BUDGET && shown > 0.97 * BUDGET, `${shown} trams and trains`);
  // with the S-Bahn alone there is room for all of it
  const trains = sharesFor(vehicles, MODES.map((mode) => mode === 'suburban'));
  assert.ok(trains.every((ofZoom) => ofZoom.every((part) => part === 1)));
  assert.equal(thinOut(vehicles, 5, trains), null);
});

test('a city keeps its share, and a vehicle far from all others is always on the map', () => {
  const alone = { mode: 'bus', rank: 2 ** 32 - 1, lat: 46, lon: 5 }; // (the rank that chance favours least)
  const vehicles = [...around('bus', 5000, 50, 10, 0.05), ...around('bus', 500, 51.5, 12, 0.05), ...around('tram', 20, 50, 10, 0.05), alone];
  const shares = sharesFor(vehicles);
  const inCity = (v) => v.mode === 'bus' && Math.abs(v.lat - 50) < 0.1;
  const inTown = (v) => v.mode === 'bus' && Math.abs(v.lat - 51.5) < 0.1;
  for (const zoom of [5, 6, 7]) {
    const thinned = thinOut(vehicles, zoom, shares);
    assert.ok(share(shares, zoom, 'bus') < 0.6, `buses at ${share(shares, zoom, 'bus')} at zoom ${zoom}`);
    // ten times the buses in the city, and about ten times as many of them on the map
    const ratio = count(vehicles, thinned, inCity) / count(vehicles, thinned, inTown);
    assert.ok(ratio > 7 && ratio < 14, `${count(vehicles, thinned, inCity)} in the city and ${count(vehicles, thinned, inTown)} in the town at zoom ${zoom}`);
    assert.equal(thinned.shown[vehicles.indexOf(alone)], 1, `the one far out at zoom ${zoom}`);
    // (and the few trams of the city all)
    assert.equal(count(vehicles, thinned, of('tram')), 20);
  }
});

test('zooming in adds vehicles and takes none away', () => {
  const vehicles = [...around('bus', 30000, 50, 10, 0.5), ...around('tram', 2000, 50, 10, 0.2), ...around('subway', 300, 50, 10, 0.1)];
  const shares = sharesFor(vehicles);
  // (the shares of a zoom are never above those of the next one)
  for (let zoom = ZOOM_MIN; zoom + 1 < ZOOM_ALL; zoom++) {
    for (const mode of MODES) assert.ok(share(shares, zoom, mode) <= share(shares, zoom + 1, mode), `${mode} at zoom ${zoom}`);
  }
  assert.ok(share(shares, ZOOM_MIN, 'bus') < 0.1 && share(shares, ZOOM_ALL - 1, 'bus') === 1);
  let before = null;
  let last = 0;
  for (let zoom = ZOOM_MIN; zoom < ZOOM_ALL; zoom += 0.25) {
    const thinned = thinOut(vehicles, zoom, shares);
    const shown = thinned ? thinned.shown : new Uint8Array(vehicles.length).fill(1);
    if (before) assert.ok(before.every((was, i) => !was || shown[i]), `a vehicle went away at zoom ${zoom}`);
    assert.ok(count(vehicles, thinned) >= last);
    [before, last] = [shown, count(vehicles, thinned)];
  }
  assert.equal(last, vehicles.length);
  // below the lowest zoom of the map as at it
  assert.deepEqual(thinOut(vehicles, 2, shares), thinOut(vehicles, ZOOM_MIN, shares));
  // Between two whole zooms, by quarters: more than at the lower one and
  // fewer than at the upper one, where a screen there holds less of the ground than it can take.
  const zoom = [5, 6, 7, 8, 9, 10].find((whole) => share(shares, whole + 1, 'bus') > share(shares, whole, 'bus'));
  const [lower, upper] = [thinOut(vehicles, zoom, shares), thinOut(vehicles, zoom + 1, shares)];
  assert.deepEqual(thinOut(vehicles, zoom + 0.2, shares), lower);
  const between = count(vehicles, thinOut(vehicles, zoom + 0.5, shares));
  assert.ok(between > count(vehicles, lower) && between < count(vehicles, upper), `${between} at zoom ${zoom + 0.5}`);
});
