import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readGz, writeGz } from '../server/lib/files.js';
import { readPbfBoundaries } from '../server/lib/osmpbf.js';
import { BORDER_LEVELS, readTowns, townsAmong, townsOf, writeTowns } from '../server/lib/towns.js';
import { makePbf } from './helpers.js';

/** A directory for files that is gone when the test ends. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-towns-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Nine places in three rows, a tenth of a degree apart:
//
//   49.6   7 ─── 8 ─── 9
//          │   Stadt   │
//   49.5   4 ─── 5 ─── 6
//          │ West│ Ost │
//   49.4   1 ─── 2 ─── 3
//        11.0  11.1  11.2
//
// West and Ost are municipalities and together the district Kreis, Stadt is
// a city that is a district of its own, and all of it is the state Land.
const PLACES = { 1: [49.4, 11.0], 2: [49.4, 11.1], 3: [49.4, 11.2], 4: [49.5, 11.0], 5: [49.5, 11.1], 6: [49.5, 11.2], 7: [49.6, 11.0], 8: [49.6, 11.1], 9: [49.6, 11.2] };
// The ways between them, by their ids: 106 is the one West and Ost share.
const WAYS = { 100: [1, 2], 101: [2, 3], 102: [3, 6], 103: [6, 5], 104: [5, 4], 105: [4, 1], 106: [2, 5], 107: [6, 9], 108: [9, 8, 7], 109: [7, 4] };
const BORDERS = [
  { id: 1, level: '8', name: 'West', ways: [100, 106, 104, 105] },
  { id: 2, level: '8', name: 'Ost', ways: [106, 101, 102, 103] },
  { id: 3, level: '6', name: 'Kreis', ways: [100, 101, 102, 103, 104, 105] },
  { id: 4, level: '6', name: 'Stadt', ways: [104, 103, 107, 108, 109] },
  { id: 5, level: '4', name: 'Land', ways: [100, 101, 102, 107, 108, 109, 105] },
];

const UNIT = 1e7;
/** A line through places in degrees, as the reader gives the points of a way. */
const line = (...places) => Int32Array.from(places.flat(), (degrees) => Math.round(degrees * UNIT));
/** What the reader gives for borders and ways like the ones above. */
const reading = (borders, ways = WAYS) => ({ borders, ways: new Map(Object.entries(ways).map(([id, nodes]) => [Number(id), line(...nodes.map((node) => PLACES[node]))])) });
/** The names of towns with their levels. */
const named = (towns) => towns.map((town) => `${town.name} (${town.level})`);

test('the borders of an extract: the administrative ones with a name and a wanted level, and each of their ways once', (t) => {
  const dir = tempDir(t);
  const members = (ways) => ways.map((way) => ['way', way, 'outer']);
  const nodes = [
    // (in no order, and with an id beyond 32 bits)
    ...[5, 1, 9, 2, 8, 3, 7, 4, 6].map((node) => [node, ...PLACES[node]]),
    [5000000000, 49.45, 11.05],
  ];
  const ways = [
    ...Object.entries(WAYS).map(([id, refs]) => [Number(id), refs, { boundary: 'administrative' }]),
    [110, [1, 5000000000, 5], {}],
    [111, [1, 99, 5], {}], // node 99 is not in the file
    [112, [1, 3], { highway: 'track' }],
  ];
  const relations = [
    ...BORDERS.map(({ id, level, name, ways: list }) => [id, { type: 'boundary', boundary: 'administrative', admin_level: level, name }, members(list)]),
    // what else a border has for members is left out, and a way that it names twice is given once
    [6, { boundary: 'administrative', admin_level: '8', name: 'Mitte' }, [['node', 5, 'admin_centre'], ['way', 110, 'outer'], ['relation', 1, 'subarea'], ['way', 106, ''], ['way', 110, 'outer']]],
    // one with a way that lacks a node, and with one that the file does not have
    [7, { boundary: 'administrative', admin_level: '8', name: 'Rand' }, members([111, 100, 999])],
    // no borders that are wanted
    [8, { boundary: 'administrative', admin_level: '8' }, members([112])],
    [9, { boundary: 'administrative', admin_level: '9', name: 'Viertel' }, members([112])],
    [10, { boundary: 'postal_code', admin_level: '8', name: '90000' }, members([112])],
    [11, { type: 'multipolygon', landuse: 'forest', name: 'Wald' }, members([112])],
  ];

  const expected = {
    borders: [...BORDERS, { id: 6, level: '8', name: 'Mitte', ways: [110, 106] }, { id: 7, level: '8', name: 'Rand', ways: [111, 100, 999] }],
    ways: [...Object.keys(WAYS).map(Number), 110],
  };
  for (const options of [{}, { sorted: true }, { backwards: true }]) {
    const file = path.join(dir, 'test.osm.pbf');
    fs.writeFileSync(file, makePbf(nodes, ways, relations, options));
    const read = readPbfBoundaries(file, BORDER_LEVELS);
    assert.deepEqual(read.borders, expected.borders, JSON.stringify(options));
    assert.deepEqual([...read.ways.keys()].sort((a, b) => a - b), expected.ways, JSON.stringify(options));
    // the points of a way in its order, in 1e-7 degrees
    assert.deepEqual(read.ways.get(108), Int32Array.of(496000000, 112000000, 496000000, 111000000, 496000000, 110000000));
    assert.deepEqual(read.ways.get(110), line(PLACES[1], [49.45, 11.05], PLACES[5]));
    // only the levels that are asked for
    assert.deepEqual(readPbfBoundaries(file, ['4']).borders.map((border) => border.name), ['Land']);
    assert.deepEqual([...readPbfBoundaries(file, ['4']).ways.keys()].sort((a, b) => a - b), BORDERS[4].ways.toSorted((a, b) => a - b));
  }

  // a file with roads and no borders
  const file = path.join(dir, 'roads.osm.pbf');
  fs.writeFileSync(file, makePbf(nodes, ways));
  assert.deepEqual(readPbfBoundaries(file, BORDER_LEVELS), { borders: [], ways: new Map() });
});

test('towns are the municipalities and the areas above them that have none in them', () => {
  // the district has municipalities and the state has districts: the city and the municipalities are the towns
  assert.deepEqual(named(townsAmong([reading(BORDERS)])), ['West (8)', 'Ost (8)', 'Stadt (6)']);
  // a state with nothing in it is a town as well, as Berlin is
  assert.deepEqual(named(townsAmong([reading(BORDERS.filter((border) => border.level === '4'))])), ['Land (4)']);
  // a district is none because of a single municipality in it
  assert.deepEqual(named(townsAmong([reading(BORDERS.filter((border) => border.name !== 'West'))])), ['Ost (8)', 'Stadt (6)']);
  assert.deepEqual(townsAmong([]), []);
  assert.deepEqual(townsAmong([reading([])]), []);
});

test('a border is a town only if it is whole, and it may be whole with two extracts together', () => {
  // without the way between West and Ost neither is whole: the district is, and is then taken for a town
  const without = (...missing) => Object.fromEntries(Object.entries(WAYS).filter(([id]) => !missing.includes(Number(id))));
  assert.deepEqual(named(townsAmong([reading(BORDERS, without(106))])), ['Kreis (6)', 'Stadt (6)']);
  // ways that are all there and do not close are no border either
  const open = [...BORDERS, { id: 6, level: '8', name: 'Offen', ways: [107, 108] }, { id: 7, level: '8', name: 'Leer', ways: [] }];
  assert.deepEqual(named(townsAmong([reading(open)])), ['West (8)', 'Ost (8)', 'Stadt (6)']);

  // an extract of the west and one of the east: each has the municipality on its side whole, and the others with both
  const west = reading(BORDERS, without(101, 102, 103, 107));
  const east = reading(BORDERS, without(100, 104, 105, 109));
  assert.deepEqual(named(townsAmong([west])), ['West (8)']);
  assert.deepEqual(named(townsAmong([east])), ['Ost (8)']);
  assert.deepEqual(named(townsAmong([west, east])), ['West (8)', 'Ost (8)', 'Stadt (6)']);
});

test('the towns are kept with every line once, and a place finds the town it is in', (t) => {
  const file = path.join(tempDir(t), 'osm-towns.json.gz');
  // Besides the three: a town with another one inside it that is not of it, further east, …
  const outer = [[49.4, 11.3], [49.4, 11.6], [49.6, 11.6], [49.6, 11.3], [49.4, 11.3]];
  const inner = [[49.45, 11.4], [49.45, 11.5], [49.55, 11.5], [49.55, 11.4], [49.45, 11.4]];
  // … and one of two parts, north and south of the others
  const parts = [[[49.7, 11.0], [49.7, 11.1], [49.8, 11.0], [49.7, 11.0]], [[49.2, 11.0], [49.2, 11.1], [49.3, 11.0], [49.2, 11.0]]];
  const read = reading(BORDERS);
  read.borders.push({ id: 6, level: '8', name: 'Umland', ways: [200, 201] }, { id: 7, level: '8', name: 'Insel', ways: [201] }, { id: 8, level: '6', name: 'Zweiteil', ways: [202, 203] });
  read.ways.set(200, line(...outer)).set(201, line(...inner)).set(202, line(...parts[0])).set(203, line(...parts[1]));
  const towns = townsAmong([read]);
  assert.deepEqual(named(towns), ['West (8)', 'Ost (8)', 'Umland (8)', 'Insel (8)', 'Stadt (6)', 'Zweiteil (6)']);

  const about = { fetchedAt: '2026-10-01T00:00:00.000Z', scope: 'area-1', sources: ['https://osm.example.org/a.osm.pbf', 'https://osm.example.org/b.osm.pbf'] };
  writeTowns(file, { ...about, towns });
  const kept = readTowns(file, about);
  assert.equal(kept.fetchedAt, about.fetchedAt);
  assert.deepEqual(kept.names, ['West', 'Ost', 'Umland', 'Insel', 'Stadt', 'Zweiteil']);
  assert.deepEqual([
    kept.at(49.45, 11.05), kept.at(49.45, 11.15), kept.at(49.55, 11.1), // in the three
    kept.at(49.42, 11.35), kept.at(49.5, 11.45), kept.at(49.58, 11.55), // around the island, on it, around it
    kept.at(49.72, 11.02), kept.at(49.22, 11.02), kept.at(49.78, 11.08), // in each of the two parts, and beside one
    kept.at(49.65, 11.1), kept.at(49.45, 10.95), kept.at(0, 0), kept.at(-49.45, -11.05), // in none
  ], ['West', 'Ost', 'Stadt', 'Umland', 'Insel', 'Umland', 'Zweiteil', 'Zweiteil', null, null, null, null, null]);

  // West and Ost have the way between them in common, and so have the town and the one inside it theirs
  const { lines, borders } = readGz(file);
  assert.equal(lines.length, 14);
  assert.deepEqual(borders.slice(0, 4).map((numbers) => numbers.length), [4, 4, 2, 1]);
  assert.deepEqual(borders[0].filter((number) => borders[1].includes(number)).length, 1);
  // a line as its first point and the steps from each point to the next
  assert.deepEqual(lines[borders[3][0]], [494500000, 114000000, 0, 1000000, 1000000, 0, 0, -1000000, -1000000, 0]);
});

test('where a place is in two towns it is in the municipality', (t) => {
  const file = path.join(tempDir(t), 'osm-towns.json.gz');
  // a city of the level of a district, and a municipality that reaches into it without lying in it
  const read = { borders: [{ id: 1, level: '6', name: 'Stadt', ways: [1] }, { id: 2, level: '8', name: 'Gemeinde', ways: [2] }], ways: new Map() };
  read.ways.set(1, line([49.4, 11.0], [49.4, 11.2], [49.6, 11.2], [49.6, 11.0], [49.4, 11.0]));
  read.ways.set(2, line([49.3, 11.1], [49.3, 11.5], [49.45, 11.5], [49.45, 11.1], [49.3, 11.1]));
  const towns = townsAmong([read]);
  assert.deepEqual(named(towns), ['Gemeinde (8)', 'Stadt (6)']);
  const about = { fetchedAt: 'then', scope: 'x', sources: [] };
  writeTowns(file, { ...about, towns });
  const kept = readTowns(file, about);
  assert.deepEqual([kept.at(49.42, 11.15), kept.at(49.5, 11.15), kept.at(49.35, 11.4)], ['Gemeinde', 'Stadt', 'Gemeinde']);
});

test('the towns that are kept are those of one reading of the extracts', (t) => {
  const file = path.join(tempDir(t), 'osm-towns.json.gz');
  const about = { fetchedAt: '2026-10-01T00:00:00.000Z', scope: 'area-1', sources: ['https://osm.example.org/a.osm.pbf'] };
  assert.equal(readTowns(file, about), null); // no file
  writeTowns(file, { ...about, towns: townsAmong([reading(BORDERS)]) });
  assert.equal(readTowns(file, about).at(49.45, 11.05), 'West');
  // another reading, another area, other extracts
  assert.equal(readTowns(file, { ...about, fetchedAt: '2026-10-02T00:00:00.000Z' }), null);
  assert.equal(readTowns(file, { ...about, scope: 'area-2' }), null);
  assert.equal(readTowns(file, { ...about, sources: [...about.sources, 'https://osm.example.org/b.osm.pbf'] }), null);
  // what a version of the server kept that kept it otherwise
  writeGz(file, { ...readGz(file), version: 0 });
  assert.equal(readTowns(file, about), null);
  fs.writeFileSync(file, 'no file of this kind');
  assert.equal(readTowns(file, about), null);
});

test('every station has the number of its town among the towns that have one', (t) => {
  const file = path.join(tempDir(t), 'osm-towns.json.gz');
  const about = { fetchedAt: 'then', scope: 'x', sources: [] };
  // two towns of one name, as there are many
  const read = reading(BORDERS.map((border) => (border.name === 'Stadt' ? { ...border, name: 'West' } : border)));
  writeTowns(file, { ...about, towns: townsAmong([read]) });
  // Stations in Ost, in West, in none, in the other West and in Ost again, and a platform of the first.
  const stops = { lat: [49.45, 49.45, 48.0, 49.55, 49.41, 49.45], lon: [11.15, 11.05, 11.0, 11.1, 11.19, 11.15], parent: [-1, -1, -1, -1, -1, 0] };
  const { names, of } = townsOf(stops, readTowns(file, about));
  assert.deepEqual(names, ['Ost', 'West']);
  assert.deepEqual(of, Int32Array.of(0, 1, -1, 1, 0, -1));
  assert.deepEqual(townsOf({ lat: [], lon: [], parent: [] }, readTowns(file, about)), { names: [], of: new Int32Array(0) });
});
