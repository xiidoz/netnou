// The stations the search suggests near the map before anything is typed
// (public/nearby.js, #257), on a list as the server makes it and the search
// has it. The stations are real ones of the feed of 20 October 2026, with
// how many trips stop at each a day: Hamburg's Hbf is four of them there,
// and the one the trains call at has the fewest trips.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearby, nearbyBeside, placesOf } from '../public/nearby.js';
import { buildIndex, stopOf } from '../public/search.js';
import { searchList } from '../server/lib/search-list.js';
import { MODES } from '../server/lib/timetable.js';

// [name, lat, lon, service, modes, town]
const STATIONS = [
  ['Hamburg Hbf', 53.553, 10.0069, 2643, ['bus', 'regional', 'longdistance'], 0],
  ['Hamburg, HBF/Kirchenallee', 53.5522, 10.0085, 8151, ['bus', 'suburban'], 0],
  ['Hamburg, Hauptbahnhof Süd', 53.5525, 10.0075, 4726, ['subway'], 0],
  ['Hamburg, HBF/Steintordamm', 53.5535, 10.006, 6644, ['bus'], 0],
  ['Hamburg, Bf. Altona', 53.5517, 9.9346, 12000, ['bus'], 0],
  ['Hamburg-Altona', 53.552, 9.935, 6318, ['suburban', 'regional', 'longdistance'], 0],
  ['Hamburg, Jungfernstieg', 53.5527, 9.9925, 7688, ['subway', 'suburban'], 0],
  ['Hamburg, Berliner Tor', 53.5527, 10.0249, 10151, ['subway', 'bus', 'suburban'], 0],
  ['Nürnberg Hbf', 49.4456, 11.083, 12094, ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance'], 1],
  ['Nürnberg Plärrer', 49.4481, 11.0648, 10902, ['subway', 'tram', 'bus'], 1],
];
const { list } = searchList(STATIONS.map(([name, lat, lon, service, modes, town]) => ({ name, lat, lon, service, modes, town })), [], MODES, [{ name: 'Hamburg', district: null }, { name: 'Nürnberg', district: null }]);
const index = buildIndex(list);
const places = placesOf(index);
const numberOf = (name) => Array.from({ length: index.count }, (_, i) => i).find((i) => stopOf(index, i).name === name);
const names = (near, options) => nearby(places, near, options).map((i) => stopOf(index, i).name);

const HAMBURG = { lat: 53.552, lon: 9.99, km: 8 };
const GERMANY = { lat: 51.165, lon: 10.455, km: 480 };

test('stations within 300 m are one place, which counts all their trips, and it is suggested by the station of its trains', () => {
  // (the bus station of Altona has the most trips of any one station, and Hamburg Hbf the fewest of its four)
  assert.deepEqual(names(HAMBURG, { limit: 4 }), ['Hamburg Hbf', 'Hamburg-Altona', 'Hamburg, Berliner Tor', 'Hamburg, Jungfernstieg']);
});

test('a station counts its trips as many times as kinds stop there: an interchange outweighs a bus station', () => {
  const two = buildIndex(searchList([
    { name: 'Hamburg, Bf. Altona', lat: 53.5517, lon: 9.9346, service: 12000, modes: ['bus'], town: 0 },
    { name: 'Hamburg, Berliner Tor', lat: 53.5527, lon: 10.0249, service: 10151, modes: ['subway', 'bus', 'suburban'], town: 0 },
  ], [], MODES, [{ name: 'Hamburg', district: null }]).list);
  assert.deepEqual(nearby(placesOf(two), HAMBURG).map((i) => stopOf(two, i).name), ['Hamburg, Berliner Tor', 'Hamburg, Bf. Altona']);
});

test('zoomed out further than a town, the towns with the most trips are suggested, each by its biggest place', () => {
  assert.deepEqual(names(GERMANY), ['Hamburg Hbf', 'Nürnberg Hbf']);
  // and only as many as asked for
  assert.deepEqual(names(GERMANY, { limit: 1 }), ['Hamburg Hbf']);
});

test('zoomed in, places suggested together are apart: none within 600 m of another, or a tenth of the view', () => {
  // Jungfernstieg and Berliner Tor are about a kilometre from the Hbf: in a view that reaches 8 km (800 m apart) both are suggested, in one of 12 km neither
  assert.deepEqual(names(HAMBURG, { limit: 4 }), ['Hamburg Hbf', 'Hamburg-Altona', 'Hamburg, Berliner Tor', 'Hamburg, Jungfernstieg']);
  assert.deepEqual(names({ ...HAMBURG, km: 12 }, { limit: 3 }), ['Hamburg Hbf', 'Hamburg-Altona', 'Nürnberg Hbf']);
});

test('near the visitor where their position is shown, as the order of the search has it', () => {
  // (at Altona: the Hbf, 4.7 km away, before Jungfernstieg at 3.7 km, as its place has twice the trips)
  assert.deepEqual(names({ lat: 53.5518, lon: 9.9348 }, { limit: 2 }), ['Hamburg-Altona', 'Hamburg Hbf']);
  // and without either, by the places alone: Nürnberg Hbf, of six kinds, before the Hbf of Hamburg
  assert.deepEqual(names(null, { limit: 3 }), ['Nürnberg Hbf', 'Hamburg Hbf', 'Nürnberg Plärrer']);
});

test('a favourite is not suggested, nor any station of its place', () => {
  const except = [numberOf('Hamburg Hbf')];
  assert.deepEqual(names(HAMBURG, { limit: 3, except }), ['Hamburg-Altona', 'Hamburg, Berliner Tor', 'Hamburg, Jungfernstieg']);
  assert.deepEqual(names(GERMANY, { except }), ['Nürnberg Hbf']);
  assert.deepEqual(names(HAMBURG, { limit: 0 }), []);
});

test('five are suggested below up to two favourites, one fewer for each more, and two from five on', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 30].map(nearbyBeside), [5, 5, 5, 4, 3, 2, 2, 2]);
});
