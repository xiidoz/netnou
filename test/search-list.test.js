// The list the page searches in, as the server makes it
// (server/lib/search-list.js). What the page finds in it is covered by
// search.test.js.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchList } from '../server/lib/search-list.js';

const MODES = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'other'];
const station = (name, lat, lon, modes = ['bus'], service = 1) => ({ name, lat, lon, modes, service });
const line = (name, mode, agency, lat, lon, to = ['Irgendwo'], service = 1) => ({ name, mode, agency, to, lat, lon, service });

/** What was sent as the difference from the one before it. */
const summed = (differences) => differences.map(((sum) => (difference) => (sum += difference))(0));

test('a station is its name, its place, what stops there and how much, each in a column', () => {
  const { list } = searchList([
    station('Nürnberg Hbf', 49.44561, 11.08299, ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance'], 13695),
    station('Fürth Rathaus', 49.47765, 10.98859, ['subway', 'bus'], 4714),
    station('Buchdorf, Alte B2', 48.78667, 10.81775, ['bus'], 44),
  ], [], MODES);
  assert.deepEqual(list.modes, MODES);
  const names = list.stations.names.split('\n');
  assert.deepEqual(names.toSorted(), ['Buchdorf, Alte B2', 'Fürth Rathaus', 'Nürnberg Hbf']);
  const [hbf, rathaus, buchdorf] = ['Nürnberg Hbf', 'Fürth Rathaus', 'Buchdorf, Alte B2'].map((name) => names.indexOf(name));
  // the places in 1e-5 degrees, each as the difference from the one before
  const [lat, lon] = [summed(list.stations.lat), summed(list.stations.lon)];
  assert.deepEqual([lat[hbf], lon[hbf]], [4944561, 1108299]);
  assert.deepEqual([lat[rathaus], lon[rathaus]], [4947765, 1098859]);
  assert.deepEqual([lat[buchdorf], lon[buchdorf]], [4878667, 1081775]);
  // a bit for each mode, in the order of their names
  assert.deepEqual([hbf, rathaus, buchdorf].map((i) => list.stations.modes[i]), [0b111111, 0b000101, 0b000100]);
  assert.deepEqual([hbf, rathaus, buchdorf].map((i) => list.stations.service[i]), [13695, 4714, 44]);
  // (no town is known of these)
  assert.deepEqual([list.stations.town, list.stations.towns, list.stations.districts], [[-1, -1, -1], [], []]);
  assert.deepEqual(Object.keys(list.stations), ['names', 'lat', 'lon', 'modes', 'service', 'town', 'towns', 'districts']);
});

test('the towns are named once, towns of one name apart with their districts, and a station has the number of its own', () => {
  // (as the timetable has them: the district of a town that is one itself is not known)
  const towns = [
    { name: 'München', district: null },
    { name: 'Stuttgart', district: 'Region Stuttgart' },
    { name: 'Neuenkirchen', district: 'Kreis Steinfurt' },
    { name: 'Neuenkirchen', district: 'Landkreis Osnabrück' },
    { name: 'Ohnehalt', district: 'Kreis Irgendwo' },
    // (a town that OpenStreetMap has twice, in one district)
    { name: 'Neuenkirchen', district: 'Kreis Steinfurt' },
  ];
  const stations = [
    { ...station('Marienplatz', 48.13725, 11.57542), town: 0 },
    { ...station('Sendlinger Tor', 48.1335, 11.5668), town: 0 },
    { ...station('Marienplatz', 48.7709, 9.1728), town: 1 },
    { ...station('Amsterdam Centraal', 52.3791, 4.9003), town: -1 },
    station('Salzburg Hbf', 47.8128, 13.0457),
    { ...station('Pasing', 48.1499, 11.4613), town: 0 },
    { ...station('Neuenkirchen, Realschule', 52.24, 7.375), town: 2 },
    { ...station('Neuenkirchen(b Bramsche) Kirche', 52.418, 7.838), town: 3 },
    { ...station('Neuenkirchen, Feldhof', 52.244, 7.374), town: 5 },
  ];
  const { list } = searchList(stations, [], MODES, towns);
  const names = list.stations.names.split('\n');
  const { town, towns: named, districts } = list.stations;
  // each town that has a station once; a district only where another town has the name too
  assert.deepEqual(named.map((name, i) => `${name} ${districts[i]}`.trim()).toSorted(), ['München', 'Neuenkirchen Kreis Steinfurt', 'Neuenkirchen Landkreis Osnabrück', 'Stuttgart']);
  assert.deepEqual(names.map((name, i) => `${name}: ${named[town[i]] ?? '-'}`).toSorted(), [
    'Amsterdam Centraal: -', 'Marienplatz: München', 'Marienplatz: Stuttgart', 'Neuenkirchen(b Bramsche) Kirche: Neuenkirchen', 'Neuenkirchen, Feldhof: Neuenkirchen', 'Neuenkirchen, Realschule: Neuenkirchen', 'Pasing: München', 'Salzburg Hbf: -', 'Sendlinger Tor: München',
  ]);
  // the two of Kreis Steinfurt are one, and that of Landkreis Osnabrück another
  assert.equal(town[names.indexOf('Neuenkirchen, Realschule')], town[names.indexOf('Neuenkirchen, Feldhof')]);
  assert.notEqual(town[names.indexOf('Neuenkirchen, Realschule')], town[names.indexOf('Neuenkirchen(b Bramsche) Kirche')]);
  // in the order in which the list comes to them: the first town it names has the number 0
  assert.equal(town.find((number) => number >= 0), 0);
});

test('stations follow each other as they lie on the map, whatever order they come in', () => {
  // A stop on every place of a square of 64 by 64, which is one the curve
  // goes through from end to end: every stop is next to the one before it.
  const square = [];
  for (let row = 0; row < 64; row++) for (let column = 0; column < 64; column++) square.push(station(`${row}/${column}`, (4944000 + row) / 1e5, (1108032 + column) / 1e5));
  let seed = 7;
  const shuffled = square.map((stop) => [(seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), stop]).sort((a, b) => a[0] - b[0]).map(([, stop]) => stop);
  const { list } = searchList(shuffled, [], MODES);
  const steps = list.stations.lat.slice(1).map((difference, i) => Math.abs(difference) + Math.abs(list.stations.lon[i + 1]));
  assert.deepEqual(steps, new Array(64 * 64 - 1).fill(1));
  assert.deepEqual(list, searchList(square, [], MODES).list);
  assert.equal(list.stations.names.split('\n').length, 64 * 64);

  // A town of 32 by 32 stops, 100 m apart: a step or two of them from one to the next.
  const town = [];
  for (let row = 0; row < 32; row++) for (let column = 0; column < 32; column++) town.push(station(`${row}/${column}`, 49 + row / 1000, 11 + column / 1000));
  const { stations } = searchList(town, [], MODES).list;
  const far = stations.lat.slice(1).reduce((sum, difference, i) => sum + Math.abs(difference) + Math.abs(stations.lon[i + 1]), 0) / (town.length - 1);
  assert.ok(far < 150, `${far} on average`);
});

test('a station of the list is found again by its place', () => {
  const stations = [station('A', 49.44561, 11.08299), station('B', 49.47765, 10.98859), station('C', -33.86785, 151.20732), station('D', 0, 0)];
  const { at } = searchList(stations, [], MODES);
  assert.equal(at(49.44561, 11.08299), 0);
  assert.equal(at(49.47765, 10.98859), 1);
  assert.equal(at(-33.86785, 151.20732), 2);
  assert.equal(at(0, 0), 3);
  // (written with more digits than the list has, it is still that place)
  assert.equal(at(49.445611, 11.082989), 0);
  for (const [lat, lon] of [[49.44562, 11.08299], [49.44561, 11.083], [11.08299, 49.44561], [NaN, 11.08299], [1e9, -1e9]]) assert.equal(at(lat, lon), -1, `${lat},${lon}`);
  assert.equal(searchList([], [], MODES).at(49.44561, 11.08299), -1);
});

test('where a feed has several stations at one place, each has a place of its own in the list', () => {
  // three at one place, and a fourth where the second would be moved to
  const stations = [station('Markt', 49.5, 11), station('Markt (Bus)', 49.5, 11), station('Markt', 49.500001, 11.000002), station('Kirche', 49.5, 11.00001)];
  const { list, at } = searchList(stations, [], MODES);
  const names = list.stations.names.split('\n');
  const [lat, lon] = [summed(list.stations.lat), summed(list.stations.lon)];
  const places = names.map((name, i) => `${lat[i]},${lon[i]}`);
  assert.equal(new Set(places).size, 4);
  // each a metre on from the one before, to the east; the first where it is
  assert.deepEqual(places.toSorted(), ['4950000,1100000', '4950000,1100001', '4950000,1100002', '4950000,1100003']);
  assert.deepEqual([at(49.5, 11), at(49.5, 11.00001), at(49.5, 11.00002), at(49.5, 11.00003)], [0, 1, 2, 3]);
  // every station of the list is found by what the list says of it
  names.forEach((name, i) => assert.equal(stations[at(lat[i] / 1e5, lon[i] / 1e5)].name, name));
});

test('a name stays on its line', () => {
  const { list } = searchList([station('Am Hang\nOst', 49, 11), station('Tal\r\n', 49.1, 11)], [], MODES);
  assert.deepEqual(list.stations.names.split('\n').toSorted(), ['Am Hang Ost', 'Tal ']);
});

test('lines are in the order of their operators, each of which is named once', () => {
  const { list } = searchList([], [
    line('U1', 'subway', 'VerkehrsAG Nürnberg', 49.44428, 11.05986, ['Fürth Hardhöhe', 'Langwasser Süd'], 1911),
    line('33', 'bus', 'Stadtverkehr Fürth', 49.48582, 11.03156, ['Fürth Hauptbahnhof', 'Flughafen N U E'], 296),
    line('5', 'tram', 'VerkehrsAG Nürnberg', 49.44298, 11.10032, ['Tiergarten', 'Christuskirche'], 1149),
    line('5', 'bus', 'VerkehrsAG Nürnberg', 49.4, 11.1, ['Hafen'], 3),
  ], MODES);
  assert.deepEqual(list.lines, {
    name: ['33', '5', '5', 'U1'],
    // (the number of a mode in the names of them all)
    mode: [2, 2, 1, 0],
    agencies: ['Stadtverkehr Fürth', 'VerkehrsAG Nürnberg'],
    agency: [0, 1, 1, 1],
    to: [['Fürth Hauptbahnhof', 'Flughafen N U E'], ['Hafen'], ['Tiergarten', 'Christuskirche'], ['Fürth Hardhöhe', 'Langwasser Süd']],
    // the middle of its stops in 1e-5 degrees, as the difference from the line before
    lat: [4948582, 4940000 - 4948582, 4944298 - 4940000, 4944428 - 4944298],
    lon: [1103156, 1110000 - 1103156, 1110032 - 1110000, 1105986 - 1110032],
    service: [296, 3, 1149, 1911],
  });
  assert.deepEqual(searchList([], [], MODES).list, { modes: MODES, stations: { names: '', lat: [], lon: [], modes: [], service: [], town: [], towns: [], districts: [] }, lines: { name: [], mode: [], agencies: [], agency: [], to: [], lat: [], lon: [], service: [] } });
});
