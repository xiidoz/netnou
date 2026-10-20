import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Area } from '../server/lib/area.js';
import { readDataset, writeDataset } from '../server/lib/dataset.js';
import { packDataset } from '../server/lib/importer.js';
import { Network, buildNetworks, classifyWay, pathLength, simplify, tilesOf, windowOf } from '../server/lib/network.js';
import { readPbfWays } from '../server/lib/osmpbf.js';
import { KeptRoutes } from '../server/lib/kept-routes.js';
import { buildSegments } from '../server/lib/shapes.js';
import { serviceDayStart } from '../server/lib/time.js';
import { Timetable, positionAt } from '../server/lib/timetable.js';
import { makePbf } from './helpers.js';

/** A directory for files that is gone when the test ends. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-pbf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** What readPbfWays reads of an extract made of these nodes and ways. */
function readMade(dir, nodes, ways, { keepNode, ...options } = {}) {
  const file = path.join(dir, `extract-${fs.readdirSync(dir).length}.osm.pbf`);
  fs.writeFileSync(file, makePbf(nodes, ways, [], options));
  return readPbfWays(file, { keys: ['highway', 'railway', 'route', 'aerialway'], classify: classifyWay, keepNode });
}

const EXTRACT = {
  nodes: [[10, 49.4, 11.0], [11, 49.41, 11.0], [20, 49.42, 11.0], [5000000000, 49.43, 11.01], [5000000001, 52.0, 13.0], [5000000002, 49.44, 11.02], [5000000003, 49.45, 11.02], [30, 49.46, 11.03], [31, 49.47, 11.03]],
  ways: [
    [100, [10, 11, 20, 5000000000], { highway: 'residential', name: 'Teststraße' }],
    [101, [10, 11], { building: 'yes' }],
    [102, [20, 5000000000, 5000000001, 5000000002, 5000000003], { railway: 'tram', oneway: 'yes' }],
    [103, [30, 31], { highway: 'footway' }],
    [104, [5000000003, 99], { highway: 'service' }], // the file has no node 99
  ],
};
// (Node 5000000001 lies outside, far to the north-east.)
const inside = (lat, lon) => lat > 49 && lat < 50 && lon > 10 && lon < 12;

test('the reader takes the ways that classify keeps, and then the places of just their nodes', (t) => {
  const dir = tempDir(t);
  for (const options of [{}, { sorted: true }, { backwards: true }]) {
    const read = readMade(dir, EXTRACT.nodes, EXTRACT.ways, { keepNode: inside, ...options });
    const label = JSON.stringify(options);
    assert.deepEqual(read.kinds, [{ net: 'road', factor: 1.3, dir: 3 }, { net: 'tram', factor: 1, dir: 1, shared: ['subway'] }, { net: 'road', factor: 1.6, dir: 3 }], label);
    assert.deepEqual(Array.from(read.ways.id), [100, 102, 104], label);
    assert.deepEqual(Array.from(read.ways.kind), [0, 1, 2], label);
    // the nodes of a way as places, by their ids: none for one that is not kept or not there
    const nodesOf = (w) => Array.from(read.nodes.subarray(read.ways.start[w], read.ways.start[w + 1]), (place) => (place < 0 ? null : read.places.id[place]));
    assert.deepEqual([0, 1, 2].map(nodesOf), [[10, 11, 20, 5000000000], [20, 5000000000, null, 5000000002, 5000000003], [5000000003, null]], label);
    // the nodes of those ways that the file has and that are kept, in 1e-7 degrees
    assert.deepEqual(Array.from(read.places.id), [10, 11, 20, 5000000000, 5000000002, 5000000003], label);
    assert.deepEqual(Array.from(read.places.lat), [494000000, 494100000, 494200000, 494300000, 494400000, 494500000], label);
    assert.deepEqual(Array.from(read.places.lon), [110000000, 110000000, 110000000, 110100000, 110200000, 110200000], label);
  }
});

test('the networks of extracts: ways cut where a node is not kept, nodes numbered as they first come up, a way of two extracts once', (t) => {
  const dir = tempDir(t);
  const first = readMade(dir, EXTRACT.nodes, EXTRACT.ways, { keepNode: inside });
  const nets = buildNetworks([first]);
  assert.deepEqual(Array.from(nets.road.lat), [494000000, 494100000, 494200000, 494300000]);
  assert.deepEqual([nets.road.a, nets.road.b, nets.road.f, nets.road.d].map((list) => Array.from(list)), [[0, 1, 2], [1, 2, 3], [130, 130, 130], [3, 3, 3]]);
  // the tram line is cut where its node lies outside
  assert.deepEqual([nets.tram.a, nets.tram.b, nets.tram.d].map((list) => Array.from(list)), [[0, 2], [1, 3], [1, 1]]);
  assert.deepEqual(Array.from(nets.tram.lat), [494200000, 494300000, 494400000, 494500000]);
  // … and is on the network of the U-Bahn as well, at a higher cost, as a track of another kind (4)
  assert.deepEqual([nets.subway.a, nets.subway.b, nets.subway.f, nets.subway.d].map((list) => Array.from(list)), [[0, 2], [1, 3], [150, 150], [5, 5]]);
  assert.equal(nets.rail.a.length, 0);

  // A second extract has the residential street again, and a road that goes on from node 20.
  const second = readMade(dir, [[10, 49.4, 11.0], [11, 49.41, 11.0], [20, 49.42, 11.0], [5000000000, 49.43, 11.01], [40, 49.42, 10.99]], [
    [100, [10, 11, 20, 5000000000], { highway: 'residential' }],
    [105, [20, 40], { highway: 'primary' }],
  ]);
  const both = buildNetworks([first, second]);
  assert.deepEqual([both.road.a, both.road.b, both.road.f].map((list) => Array.from(list)), [[0, 1, 2, 2], [1, 2, 3, 4], [130, 130, 130, 100]]);
  assert.deepEqual(Array.from(both.road.lon), [110000000, 110000000, 110000000, 110100000, 109900000]);
});

test('the part of a network in some tiles has their nodes and the edges between them', () => {
  // six nodes in a row to the east, across tiles of 0.01 degrees
  const lon = [11.0, 11.005, 11.012, 11.025, 11.034, 11.047];
  const graph = {
    lat: Int32Array.from(lon, () => 495000000),
    lon: Int32Array.from(lon, (x) => Math.round(x * 1e7)),
    a: Int32Array.of(0, 1, 2, 3, 4),
    b: Int32Array.of(1, 2, 3, 4, 5),
    f: Uint16Array.of(100, 130, 100, 100, 160),
    d: Uint8Array.of(3, 3, 1, 3, 3),
  };
  const tiles = tilesOf(graph, 0.01);
  assert.equal(tiles.keys.length, 5);
  const [r, c] = [tiles.row(495000000), tiles.col(110120000)];
  const scratch = new Int32Array(6).fill(-1);
  const around = [-1, 0, 1].flatMap((dc) => [-1, 0, 1].map((dr) => tiles.key(r + dr, c + dc)));
  const part = windowOf(graph, tiles, around, scratch);
  // the nodes of the columns 11.00, 11.01 and 11.02, and the edges between them
  assert.deepEqual(Array.from(part.global), [0, 1, 2, 3]);
  assert.deepEqual([part.a, part.b, part.f, part.d].map((list) => Array.from(list)), [[0, 1, 2], [1, 2, 3], [100, 130, 100], [3, 3, 1]]);
  assert.deepEqual(Array.from(part.lon), [110000000, 110050000, 110120000, 110250000]);
  assert.ok(scratch.every((x) => x === -1));
  // and to the east of it
  const east = windowOf(graph, tiles, [-1, 0, 1].map((dc) => tiles.key(r, c + 2 + dc)), scratch);
  assert.deepEqual([Array.from(east.global), Array.from(east.a), Array.from(east.b)], [[3, 4, 5], [0, 1], [1, 2]]);
});

test('classifyWay: networks, access, one-way rules and bus exceptions', () => {
  // the main roads, on which the long hops of a country are routed, with their links (#131)
  assert.deepEqual(classifyWay({ highway: 'primary' }), { net: 'road', factor: 1, dir: 3, main: true });
  for (const highway of ['motorway', 'motorway_link', 'trunk', 'primary_link']) assert.equal(classifyWay({ highway }).main, true, highway);
  for (const highway of ['secondary', 'tertiary', 'residential', 'busway']) assert.equal(classifyWay({ highway }).main, undefined, highway);
  assert.equal(classifyWay({ highway: 'residential', oneway: 'yes' }).dir, 1);
  assert.equal(classifyWay({ highway: 'residential', oneway: '-1' }).dir, 2);
  assert.equal(classifyWay({ highway: 'residential', oneway: 'yes', 'oneway:bus': 'no' }).dir, 3);
  assert.equal(classifyWay({ highway: 'motorway' }).dir, 1);
  assert.equal(classifyWay({ highway: 'tertiary', junction: 'roundabout' }).dir, 1);
  assert.equal(classifyWay({ highway: 'primary_link' }).factor, 1);
  assert.equal(classifyWay({ highway: 'footway' }), null);
  assert.equal(classifyWay({ highway: 'service', access: 'private' }), null);
  assert.equal(classifyWay({ highway: 'service', access: 'private', bus: 'yes' }).factor, 1);
  assert.equal(classifyWay({ highway: 'service', service: 'parking_aisle' }), null);
  assert.equal(classifyWay({ highway: 'pedestrian' }), null);
  assert.equal(classifyWay({ highway: 'pedestrian', psv: 'yes' }).net, 'road');
  // the U-Bahn and trams share each other's tracks and those of the light rail (#128)
  assert.deepEqual(classifyWay({ railway: 'subway' }), { net: 'subway', factor: 1, dir: 3, shared: ['tram'] });
  assert.deepEqual(classifyWay({ railway: 'tram' }), { net: 'tram', factor: 1, dir: 3, shared: ['subway'] });
  assert.deepEqual(classifyWay({ railway: 'light_rail' }), { net: 'rail', factor: 1, dir: 3, shared: ['subway', 'tram'] });
  assert.deepEqual(classifyWay({ railway: 'rail' }), { net: 'rail', factor: 1, dir: 3 });
  assert.equal(classifyWay({ railway: 'rail', oneway: 'yes' }).dir, 3);
  assert.equal(classifyWay({ railway: 'tram', oneway: 'yes' }).dir, 1);
  assert.equal(classifyWay({ railway: 'rail', service: 'yard' }).factor, 3);
  assert.equal(classifyWay({ railway: 'abandoned' }), null);
  // ferries on their routes across the water, both ways
  assert.deepEqual(classifyWay({ route: 'ferry' }), { net: 'ferry', factor: 1, dir: 3 });
  // cable cars and monorails together with funiculars and rack railways, whole narrow gauge and the track of a tram with a rack among them
  for (const tags of [{ railway: 'monorail' }, { railway: 'funicular', gauge: '1000' }, { railway: 'narrow_gauge', rack: 'no' }, { railway: 'tram', rack: 'riggenbach' }, { railway: 'rail', rack: 'abt' }, { aerialway: 'gondola' }, { aerialway: 'cable_car' }, { aerialway: 'chair_lift' }]) {
    assert.deepEqual(classifyWay(tags), { net: 'cable', factor: 1, dir: 3 }, JSON.stringify(tags));
  }
  assert.equal(classifyWay({ railway: 'monorail', service: 'yard' }).factor, 3);
  // a track that has no rack stays that of the trains, and not every lift carries people as a line does
  assert.equal(classifyWay({ railway: 'rail', rack: 'no' }).net, 'rail');
  assert.equal(classifyWay({ railway: 'tram' }).net, 'tram');
  assert.equal(classifyWay({ aerialway: 'drag_lift' }), null);
  assert.equal(classifyWay({ aerialway: 'station' }), null);
});

test('ferries follow their routes across the water, cable cars and monorails their own ways', (t) => {
  const dir = tempDir(t);
  // A ferry from a pier to an island 22 km to the north, its route one edge as
  // across open sea; a monorail of 1 km; and a ferry 132 m across a river,
  // whose route ends in a jetty of 20 m on the far bank.
  const nodes = [[1, 49.5, 11.0], [2, 49.7, 11.05], [3, 49.5, 11.1], [4, 49.509, 11.1], [5, 49.6, 10.95], [6, 49.601186, 10.95], [7, 49.601366, 10.95]];
  const graphs = buildNetworks([readMade(dir, nodes, [[10, [1, 2], { route: 'ferry' }], [11, [3, 4], { railway: 'monorail' }], [12, [5, 6, 7], { route: 'ferry' }]])]);
  // (the long edge is in the cells of the grid along it, not in all 183 × 30 of its rectangle; halfway, 100 m beside it, it is found)
  const ferry = new Network(graphs.ferry, { originLat: 49.6, snapRadius: 600, snapPenalty: 1 });
  assert.ok(ferry.grid.size < 400, `${ferry.grid.size} cells`);
  assert.equal(ferry.candidates(49.6, 11.0262).length, 1);

  const area = Area.fromBbox([49.4, 10.9, 49.8, 11.2]);
  // (the stop on the near bank is 33 m beside the start of the crossing, and 136 m from the jetty: were
  // snapping as cheap as a metre of the way, it would be put on the jetty, with the stop over there, and
  // the crossing would be a route of no length, which is none)
  const dataset = packDataset({
    stops: { id: ['P', 'Q', 'S', 'T', 'X', 'Y'], name: ['Pier', 'Island', 'Valley', 'Top', 'Near bank', 'Far bank'], lat: [49.5004, 49.6996, 49.5002, 49.5088, 49.6, 49.601276], lon: [11.0, 11.05, 11.1003, 11.1003, 10.949542, 10.950014], parent: [-1, -1, -1, -1, -1, -1], platform: ['', '', '', '', '', ''], region: [1, 1, 1, 1, 1, 1] },
    routes: { id: ['F', 'C', 'R'], short: ['F1', '60', 'F2'], long: ['', '', ''], type: [4, 7, 4], color: ['', '', ''], text: ['', '', ''], agency: ['', '', ''] },
    headsigns: ['Island', 'Top', 'Far bank'],
    dates: ['20261003'],
    services: [[0]],
    trips: { id: ['TF', 'TC', 'TR'], route: [0, 1, 2], service: [0, 0, 0], headsign: [0, 1, 2], stops: [[0, 1], [2, 3], [4, 5]], arr: [[36000, 39600], [36000, 36300], [36000, 36300]], dep: [[36000, 39600], [36000, 36300], [36000, 36300]], seq: [null, null, null] },
  });
  const log = [];
  const segments = buildSegments(dataset, graphs, area, (line) => log.push(line));
  assert.deepEqual(Array.from(segments.net, (n) => segments.nets[n]), ['ferry', 'ferry', 'cable']);
  assert.equal(log.at(-1), 'hops routed: road 0/0, rail 0/0, subway 0/0, tram 0/0, ferry 2/2, cable 1/1');
});

test('a hop too long for the tiles takes the main roads between the roads near its stops (#131)', (t) => {
  const dir = tempDir(t);
  // Stop A and stop B 36 km apart, each 11 m south of the end of a local road
  // of 556 m that leads to a motorway, which runs on east to 11.8 degrees. A
  // secondary road goes from A straight to B, 1.1 km shorter than the way on
  // the motorway. Stop C lies to the north-east beyond the end of the
  // motorway, stop D on a road of its own, 556 m north of the motorway.
  const nodes = [[1, 49.5, 11.0], [2, 49.505, 11.0], [3, 49.505, 11.25], [4, 49.505, 11.5], [5, 49.5, 11.5], [6, 49.505, 11.8], [7, 49.51, 11.24], [8, 49.51, 11.26]];
  const secondary = Array.from({ length: 9 }, (_, i) => [10 + i, 49.5, 11.05 + i * 0.05]);
  const graphs = buildNetworks([readMade(dir, [...nodes, ...secondary], [
    [20, [1, 2], { highway: 'residential' }],
    [21, [2, 3, 4, 6], { highway: 'motorway', oneway: 'no' }],
    [22, [4, 5], { highway: 'residential' }],
    [23, [1, ...secondary.map(([id]) => id), 5], { highway: 'secondary' }],
    [24, [7, 8], { highway: 'residential' }],
  ])]);
  const area = Area.fromBbox([49.4, 10.9, 49.7, 12.6]);
  const dataset = packDataset({
    stops: { id: ['A', 'B', 'C', 'D'], name: ['A', 'B', 'C', 'D'], lat: [49.4999, 49.4999, 49.55, 49.5101], lon: [11.0, 11.5, 12.5, 11.25], parent: [-1, -1, -1, -1], platform: ['', '', '', ''], region: [1, 1, 1, 1] },
    routes: { id: ['X'], short: ['X1'], long: [''], type: [3], color: [''], text: [''], agency: [''] },
    headsigns: ['B', 'C', 'D'],
    dates: ['20261003'],
    services: [[0]],
    trips: { id: ['TB', 'TC', 'TD'], route: [0, 0, 0], service: [0, 0, 0], headsign: [0, 1, 2], stops: [[0, 1], [0, 2], [0, 3]], arr: [[36000, 38400], [36000, 40000], [36000, 38400]], dep: [[36000, 38400], [36000, 40000], [36000, 38400]], seq: [null, null, null] },
  });
  // On the roads of a region, one network, A to B on the secondary road
  const region = routesOf(buildSegments(dataset, graphs, area));
  assert.ok(region[0].points.filter((_, i) => i % 2 === 0).every((lat) => lat === 4950000), `${region[0].points}`);
  // On those of a country, in tiles too small for these hops: A to B on the
  // local roads and the motorway, as the middle of the secondary road is not
  // near the stops; A to C on the motorway to its end and on in a straight
  // line; A to D not at all.
  const log = [];
  const country = routesOf(buildSegments(dataset, graphs, area, (line) => log.push(line), { roadsAtOnce: 0, tile: 0.05 }));
  assert.deepEqual(log.slice(-2), ['3 hops on roads are too long for the tiles: routing them on the main roads', 'hops routed: road 2/3, rail 0/0, subway 0/0, tram 0/0, ferry 0/0, cable 0/0']);
  const lats = country[0].points.filter((_, i) => i % 2 === 0);
  assert.ok(lats.length >= 4 && lats.slice(1, -1).every((lat) => lat === 4950500), `${country[0].points}`);
  assert.ok(Math.abs(metres(country[0].points) - 37260) < 30, `${metres(country[0].points)}`);
  const toC = country[1].points;
  assert.ok(toC.some((v, i) => i % 2 === 0 && v === 4950500 && toC[i + 1] === 1180000) && toC.slice(-2).join() === '4955000,1250000', `${toC}`);
});

test('the U-Bahn and trams share their tracks and those of the light rail, and keep to their own where they can (#128)', (t) => {
  const dir = tempDir(t);
  // Light rail from P to Q, 723 m to the east, on which a Stadtbahn runs that
  // the feed calls U-Bahn. From X to Y a track of the U-Bahn that bends 300 m
  // to the north, 940 m long, and one of trams straight, 723 m. A track of
  // trams that ends at K, 109 m before the stop Z, under which a tunnel of the
  // U-Bahn runs from south to north. And a stop U of the U-Bahn 22 m beside
  // its track, with ten edges of a stub of trams 6 to 29 m away.
  const nodes = [[1, 49.5, 11.0], [2, 49.5, 11.01], [3, 49.52, 11.0], [4, 49.5227, 11.005], [5, 49.52, 11.01], [6, 49.54, 11.0], [7, 49.54, 11.008], [8, 49.535, 11.0095], [9, 49.545, 11.0095], [20, 49.56, 10.995], [21, 49.56, 11.005]];
  const stub = Array.from({ length: 11 }, (_, i) => [30 + i, 49.56025, 10.9995 + i * 0.0001]);
  const graphs = buildNetworks([readMade(dir, [...nodes, ...stub], [
    [10, [1, 2], { railway: 'light_rail' }],
    [11, [3, 4, 5], { railway: 'subway' }],
    [12, [3, 5], { railway: 'tram' }],
    [13, [6, 7], { railway: 'tram' }],
    [14, [8, 9], { railway: 'subway', tunnel: 'yes' }],
    [15, [20, 21], { railway: 'subway' }],
    [16, stub.map(([id]) => id), { railway: 'tram' }],
  ])]);

  const candidates = new Network(graphs.subway, { originLat: 49.56, snapRadius: 250, snapPenalty: 2 }).candidates(49.5602, 11.0);
  assert.deepEqual(candidates.map((c) => c.shared), [true, true, true, true, true, true, false]);
  assert.ok(Math.abs(candidates.at(-1).penalty - 2 * 22.3) < 0.5, `${candidates.at(-1).penalty}`);

  const area = Area.fromBbox([49.4, 10.9, 49.7, 11.2]);
  const dataset = packDataset({
    stops: { id: ['P', 'Q', 'X', 'Y', 'W', 'Z'], name: ['P', 'Q', 'X', 'Y', 'W', 'Z'], lat: [49.5001, 49.5001, 49.5199, 49.5199, 49.5401, 49.5401], lon: [11.0, 11.01, 11.0, 11.01, 11.0, 11.0095], parent: [-1, -1, -1, -1, -1, -1], platform: ['', '', '', '', '', ''], region: [1, 1, 1, 1, 1, 1] },
    routes: { id: ['U1', 'U2', 'T1', 'T2'], short: ['U1', 'U2', '1', '2'], long: ['', '', '', ''], type: [1, 1, 0, 0], color: ['', '', '', ''], text: ['', '', '', ''], agency: ['', '', '', ''] },
    headsigns: ['Q', 'Y', 'Y', 'Z'],
    dates: ['20261003'],
    services: [[0]],
    trips: { id: ['A', 'B', 'C', 'D'], route: [0, 1, 2, 3], service: [0, 0, 0, 0], headsign: [0, 1, 2, 3], stops: [[0, 1], [2, 3], [2, 3], [4, 5]], arr: [[36000, 36120], [36000, 36120], [36000, 36120], [36000, 36120]], dep: [[36000, 36120], [36000, 36120], [36000, 36120], [36000, 36120]], seq: [null, null, null, null] },
  });
  const log = [];
  const routes = routesOf(buildSegments(dataset, graphs, area, (line) => log.push(line)));
  assert.equal(log.at(-1), 'hops routed: road 0/0, rail 0/0, subway 2/2, tram 2/2, ferry 0/0, cable 0/0');
  assert.deepEqual(routes.map((route) => route.net), ['subway', 'subway', 'tram', 'tram']);
  // P to Q on the light rail; from X to Y the U-Bahn on its own track round
  // the bend (940 m, where the straight track of trams would cost as much as
  // 1,085 m) and the trams on theirs; from W to Z the trams as far as their
  // track goes, and on in a straight line: the tunnel does not lead there.
  const lengths = routes.map((route) => metres(route.points));
  [723, 940, 723, 687].forEach((expected, i) => assert.ok(Math.abs(lengths[i] - expected) < 3, `${lengths}`));
  assert.deepEqual(routes[3].points.slice(-4), [4954000, 1100800, 4954010, 1100950]);
});

// A small road grid around (49.5, 11.0); 0.001° is ~111 m north and ~72 m east.
//
//   D --- E --- F        A–B–C: main road, D–E–F: residential,
//   |     ^     |        B→E is one-way northbound (E→B forbidden),
//   A --- B --- C        A–D and C–F: residential
//
const LAT = 49.5;
const LON = 11.0;
const NODES = { A: [0, 0], B: [0, 0.002], C: [0, 0.004], D: [0.002, 0], E: [0.002, 0.002], F: [0.002, 0.004] };
function gridNetworks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-grid-'));
  try {
    const nodes = Object.entries(NODES).map(([name, [dLat, dLon]]) => [name.charCodeAt(0), LAT + dLat, LON + dLon]);
    const id = (names) => names.map((n) => n.charCodeAt(0));
    return buildNetworks([
      readMade(dir, nodes, [
        [1, id(['A', 'B', 'C']), { highway: 'secondary' }],
        [2, id(['D', 'E', 'F']), { highway: 'residential' }],
        [3, id(['B', 'E']), { highway: 'residential', oneway: 'yes' }],
        [4, id(['A', 'D']), { highway: 'residential' }],
        [5, id(['C', 'F']), { highway: 'residential' }],
        [9, id(['A', 'B', 'C']), { railway: 'tram' }],
      ]),
      // the same way from a second extract: counted once
      readMade(dir, nodes, [[1, id(['A', 'B', 'C']), { highway: 'secondary' }]]),
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const at = (dLat, dLon) => [LAT + dLat, LON + dLon];
const corner = (name) => at(...NODES[name]);
const lengthOf = (route) => Math.round(pathLength(route));
const close = (actual, expected, tolerance, label) => {
  assert.equal(actual.length, expected.length, label);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, `${label}: ${actual} vs ${expected}`));
};
// Stops sit ~11 m beside the road they belong to, like real stop poles.
const STOP = {
  mainWest: at(-0.0001, 0.0005), // south of A–B
  mainEast: at(-0.0001, 0.0035), // south of B–C
  atB: at(-0.0001, 0.002),
  onLink: at(0.0019, 0.002), // on the one-way link, just below E
  north: at(0.0021, 0.0035), // north of E–F
};

test('routing follows the network, respects one-way streets and the detour limit', () => {
  const graphs = gridNetworks();
  assert.equal(graphs.road.a.length, 7);
  assert.equal(graphs.tram.a.length, 2);
  const road = new Network(graphs.road, { originLat: LAT, snapRadius: 70, snapPenalty: 4 });
  const snap = (stop) => road.candidates(...STOP[stop]);

  // straight along the main road, through B: 0.003° of longitude
  const direct = road.route(snap('mainWest'), snap('mainEast'), 2000);
  assert.ok(Math.abs(lengthOf(direct) - 0.003 * 111320 * Math.cos((LAT * Math.PI) / 180)) < 2, `direct ${lengthOf(direct)} m`);
  assert.equal(direct.length / 2, 3);

  // B → E may use the one-way link, E → B has to go around the block
  const up = lengthOf(road.route(snap('atB'), snap('onLink'), 5000));
  const down = lengthOf(road.route(snap('onLink'), snap('atB'), 5000));
  assert.ok(up > 200 && up < 230, `B→E ${up} m`);
  assert.ok(down > 480, `E→B ${down} m`);
  // … and is rejected when that exceeds the allowed detour
  assert.equal(road.route(snap('onLink'), snap('atB'), 300), null);

  // two stops on the same edge need no search
  const short = road.route(road.candidates(LAT, LON + 0.0005), road.candidates(LAT, LON + 0.0015), 500);
  assert.equal(short.length, 4);
  // a stop too far from any road has no candidates
  assert.deepEqual(road.candidates(LAT + 0.01, LON), []);

  // towards a stop far to the east: follow the road to the edge of the area, then straight
  const [farX, farY] = road.toXY(LAT, LON + 1);
  const [limitX] = road.toXY(LAT, LON + 0.003);
  const leaving = road.routeBeyond(snap('mainWest'), farX, farY, (x) => x < limitX, false, 200000);
  const [cx, cy] = road.toXY(...corner('C'));
  close(leaving.slice(-4), [cx, cy, farX, farY], 0.01, 'leaves the area at C');
  const arriving = road.routeBeyond(snap('mainWest'), farX, farY, (x) => x < limitX, true, 200000);
  close(arriving.slice(0, 4), [farX, farY, cx, cy], 0.01, 'enters the area at C');
  assert.equal(arriving.length, leaving.length);

  // Towards a stop some way east of C, where the main road ends within the area
  // (as at the edge of the OSM data) while the streets to the north leave it:
  // the route goes as far as the road leads towards the stop, and does not
  // turn north to get out of the area.
  const [nearX, nearY] = road.toXY(LAT, LON + 0.012);
  const [, limitY] = road.toXY(LAT + 0.001, LON);
  const southOnly = (x, y) => y < limitY;
  const cutOff = road.routeBeyond(snap('mainWest'), nearX, nearY, southOnly, false, 1500);
  close(cutOff.slice(-4), [cx, cy, nearX, nearY], 0.01, 'leaves the road where it ends');
  // … nor does it look further than a route may be long
  close(road.routeBeyond(snap('mainWest'), nearX, nearY, southOnly, false, 900).slice(-4), [cx, cy, nearX, nearY], 0.01, 'the same within a short limit');
  assert.equal(road.routeBeyond(snap('mainWest'), nearX, nearY, southOnly, false, 100), null);
});

test('a train does not turn back at a switch between two stops, but may leave a stop either way (#243)', () => {
  // A track from the west forks at a switch (node 1) into a northern and a
  // southern branch to the east; the two meet again 3 km further east, by a
  // loop round which a train can turn.
  const LAT0 = 48;
  const east = 111320 * Math.cos((LAT0 * Math.PI) / 180);
  const at = (x, y) => [LAT0 + y / 111320, 11 + x / east];
  const points = [[-1000, 0], [0, 0], [1000, 100], [1000, -100]];
  for (let i = 0; i <= 8; i++) points.push([3000 + 120 * Math.sin((i * Math.PI) / 8), 120 * Math.cos((i * Math.PI) / 8)]);
  const edges = [[0, 1], [1, 2], [1, 3], [2, 4], ...Array.from({ length: 8 }, (_, i) => [4 + i, 5 + i]), [12, 3]];
  const graph = {
    lat: Int32Array.from(points, ([x, y]) => Math.round(at(x, y)[0] * 1e7)),
    lon: Int32Array.from(points, ([x, y]) => Math.round(at(x, y)[1] * 1e7)),
    a: Int32Array.from(edges, ([a]) => a),
    b: Int32Array.from(edges, ([, b]) => b),
    f: Uint16Array.from(edges, () => 100),
    d: Uint8Array.from(edges, () => 3),
  };
  const options = { originLat: LAT0, snapRadius: 50, snapPenalty: 1 };
  const free = new Network(graph, options);
  const rail = new Network(graph, { ...options, maxTurn: 90 });
  const STOPS = { north: at(900, 90), south: at(900, -90), west: at(-900, 0) };
  const route = (network, from, to) => network.route(network.candidates(...STOPS[from]), network.candidates(...STOPS[to]), 10000);

  // from the northern branch to the southern one: through the switch, turning back there …
  assert.ok(Math.abs(lengthOf(route(free, 'north', 'south')) - 1810) < 10, `${lengthOf(route(free, 'north', 'south'))} m`);
  // … where a train goes round the loop
  const round = lengthOf(route(rail, 'north', 'south'));
  assert.ok(round > 4500 && round < 4700, `${round} m`);
  assert.equal(rail.route(rail.candidates(...STOPS.north), rail.candidates(...STOPS.south), 3000), null);
  // … unless asked for any route, where a train does turn back between two stops
  assert.equal(lengthOf(rail.route(rail.candidates(...STOPS.north), rail.candidates(...STOPS.south), 3000, null, false)), lengthOf(route(free, 'north', 'south')));
  // through the switch the way it faces, and back from a stop the way it came
  assert.ok(Math.abs(lengthOf(route(rail, 'west', 'north')) - 1805) < 10, `${lengthOf(route(rail, 'west', 'north'))} m`);
  assert.ok(Math.abs(lengthOf(route(rail, 'north', 'west')) - 1805) < 10, `${lengthOf(route(rail, 'north', 'west'))} m`);
  // towards a stop far to the west, off the network
  const [farX, farY] = rail.toXY(LAT0, 10);
  const [limitX] = rail.toXY(LAT0, 11 - 500 / east);
  const leaving = rail.routeBeyond(rail.candidates(...STOPS.south), farX, farY, (x) => x > limitX, false, 200000);
  close(leaving.slice(-4), [...rail.toXY(...at(-1000, 0)), farX, farY], 0.5, 'leaves at the west end');
});

test('a stop of trains may be on any track a little further away than the nearest, as in a large station (#243)', () => {
  // ten tracks of a station from west to east, 10 m apart, each of five edges
  const LAT0 = 48;
  const east = 111320 * Math.cos((LAT0 * Math.PI) / 180);
  const points = [];
  const edges = [];
  for (let track = 0; track < 10; track++) {
    for (let i = 0; i <= 5; i++) points.push([i * 100, track * 10]);
    for (let i = 0; i < 5; i++) edges.push([track * 6 + i, track * 6 + i + 1]);
  }
  const graph = {
    lat: Int32Array.from(points, ([, y]) => Math.round((LAT0 + y / 111320) * 1e7)),
    lon: Int32Array.from(points, ([x]) => Math.round((11 + x / east) * 1e7)),
    a: Int32Array.from(edges, ([a]) => a),
    b: Int32Array.from(edges, ([, b]) => b),
    f: Uint16Array.from(edges, () => 100),
    d: Uint8Array.from(edges, () => 3),
  };
  const stop = [LAT0 + 2 / 111320, 11 + 250 / east]; // 2 m north of the first track, in the middle of the platforms
  const options = { originLat: LAT0, snapRadius: 400, snapPenalty: 1.5 };
  // (which tracks the candidates are on, counted from the first; each lies on the one it was snapped to)
  const tracksOf = (list) => [...new Set(list.map((c) => Math.round((c.y - list[0].y) / 10)))].sort((p, q) => p - q);
  // the six nearest edges: the middle ones of the first tracks
  assert.deepEqual(tracksOf(new Network(graph, options).candidates(...stop)), [0, 1, 2, 3, 4, 5]);
  // within 50 m of the nearest: the tracks up to 52 m away
  const spread = new Network(graph, { ...options, snapSpread: 50, maxCandidates: 64 }).candidates(...stop);
  assert.deepEqual(tracksOf(spread), [0, 1, 2, 3, 4, 5]);
  assert.ok(spread.length > 6, `${spread.length} candidates`);
  assert.deepEqual(tracksOf(new Network(graph, { ...options, snapSpread: 100, maxCandidates: 64 }).candidates(...stop)), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a network measures lengths and the distances of stops at their own latitude, wherever its plane is right', () => {
  // an edge of 0.01 degrees from west to east at 55 degrees north, on a network whose plane is right at 47
  const graph = { lat: Int32Array.of(550000000, 550000000), lon: Int32Array.of(100000000, 100100000), a: Int32Array.of(0), b: Int32Array.of(1), f: Uint16Array.of(100), d: Uint8Array.of(3) };
  const network = new Network(graph, { originLat: 47, snapRadius: 70, snapPenalty: 1 });
  const east = 111320 * Math.cos((55 * Math.PI) / 180); // metres in a degree of longitude there
  assert.ok(Math.abs(network.len[0] - 0.01 * east) < 0.01, `${network.len[0]} m`);
  // a stop north of the middle of the edge, and one east of its end: 64 m there, 76 m at 47 degrees
  assert.ok(Math.abs(network.candidates(55.0005, 10.005)[0].penalty - 0.0005 * 111320) < 0.01);
  const [beside] = network.candidates(55, 10.011);
  assert.ok(Math.abs(beside.penalty - 0.001 * east) < 0.01, `${beside.penalty} m`);
});

test('simplify drops points on a straight line only', () => {
  assert.deepEqual(simplify([0, 0, 50, 0.5, 100, 0, 100, 80, 100, 160], 1.5), [0, 0, 100, 0, 100, 160]);
  assert.deepEqual(simplify([0, 0, 50, 20, 100, 0], 1.5), [0, 0, 50, 20, 100, 0]);
});

/** The points of route geometry as buildSegments gives it, latitude, longitude, … in 1e-5 degrees, from its first points and steps. */
function pointsOf(segments) {
  const points = [];
  for (let s = 0; s < segments.key.length; s++) {
    let [lat, lon] = [segments.origin[2 * s], segments.origin[2 * s + 1]];
    for (let k = segments.start[s]; k < segments.start[s + 1]; k++) {
      if (k > segments.start[s]) [lat, lon] = [lat + segments.step[2 * k], lon + segments.step[2 * k + 1]];
      points.push(lat, lon);
    }
  }
  return points;
}

/** Each segment of route geometry: its network and its points, as pointsOf has them. */
function routesOf(segments) {
  return Array.from(segments.key, (_, s) => ({
    net: segments.nets[segments.net[s]],
    points: pointsOf({ key: [0], origin: segments.origin.subarray(2 * s, 2 * s + 2), start: [0, segments.start[s + 1] - segments.start[s]], step: segments.step.subarray(2 * segments.start[s], 2 * segments.start[s + 1]) }),
  }));
}

/** The length of points in 1e-5 degrees, in metres. */
function metres(points) {
  let length = 0;
  for (let i = 2; i < points.length; i += 2) length += Math.hypot((points[i + 1] - points[i - 1]) * Math.cos((points[i] / 1e5) * (Math.PI / 180)), points[i] - points[i - 2]) * 1.1132;
  return length;
}

test('vehicles and trip paths follow the routed geometry', () => {
  // Bus 1 from a stop on the main road to one on the northern street,
  // 10:00 → 10:10. The cheapest road route turns north at B over the link.
  const area = Area.fromBbox([49.4, 10.9, 49.6, 11.1]);
  const dataset = packDataset({
    stops: { id: ['P', 'Q'], name: ['P', 'Q'], lat: [STOP.mainWest[0], STOP.north[0]], lon: [STOP.mainWest[1], STOP.north[1]], parent: [-1, -1], platform: ['', ''], region: [1, 1] },
    routes: { id: ['R'], short: ['1'], long: [''], type: [3], color: [''], text: [''], agency: [''] },
    headsigns: ['Q'],
    dates: ['20261003'],
    services: [[0]],
    trips: { id: ['T'], route: [0], service: [0], headsign: [0], stops: [[0, 1]], arr: [[36000, 36600]], dep: [[36000, 36600]], seq: [null] },
  });
  const graphs = gridNetworks();
  dataset.segments = buildSegments(dataset, graphs, area);
  assert.deepEqual(Array.from(dataset.segments.net, (n) => dataset.segments.nets[n]), ['road']);
  // The same on the roads of a country, cut into tiles of 0.003 degrees; on
  // tiles of 0.001 degrees the stops are too far apart for one, and the hop
  // is routed on the main roads and the roads near its stops, which here are
  // all of them.
  const log = [];
  const inTiles = buildSegments(dataset, graphs, area, (line) => log.push(line), { roadsAtOnce: 0, tile: 0.003 });
  assert.deepEqual(pointsOf(inTiles), pointsOf(dataset.segments));
  assert.deepEqual(pointsOf(buildSegments(dataset, graphs, area, (line) => log.push(line), { roadsAtOnce: 0, tile: 0.001 })), pointsOf(dataset.segments));
  assert.deepEqual(log.slice(-3), ['routing 1 hops', '1 hops on roads are too long for the tiles: routing them on the main roads', 'hops routed: road 1/1, rail 0/0, subway 0/0, tram 0/0, ferry 0/0, cable 0/0']);

  // A route that is kept is taken as it is, without routing: here a made-up one, straight from P to Q.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-kept-'));
  try {
    const networks = { fetchedAt: 'then', scope: 'x' };
    const keptRoute = [Math.round(STOP.mainWest[0] * 1e5), Math.round(STOP.mainWest[1] * 1e5), Math.round(STOP.north[0] * 1e5), Math.round(STOP.north[1] * 1e5)];
    const made = new KeptRoutes(dir, networks);
    made.add(0, STOP.mainWest, STOP.north, keptRoute);
    made.flush();
    const kept = new KeptRoutes(dir, networks);
    const fromKept = buildSegments(dataset, graphs, area, (line) => log.push(line), { kept });
    assert.deepEqual(pointsOf(fromKept), keptRoute);
    assert.equal(log.at(-2), 'routing 0 hops, 1 kept from before');
    // A step longer than 16 bits take is cut into shorter ones, with points on the
    // straight line between: here a degree to the north and back, in 1e-5 degrees.
    const [lat0, lon0] = keptRoute;
    const roundabout = [lat0, lon0, lat0 + 100000, lon0, ...keptRoute.slice(2)];
    const far = new KeptRoutes(dir, { ...networks, fetchedAt: 'far' });
    far.add(0, STOP.mainWest, STOP.north, roundabout);
    const long = buildSegments(dataset, graphs, area, () => {}, { kept: far });
    const decoded = pointsOf(long);
    assert.deepEqual([decoded.slice(0, 2), decoded.slice(8, 10), decoded.slice(-2)], [roundabout.slice(0, 2), roundabout.slice(2, 4), roundabout.slice(-2)]);
    assert.deepEqual(decoded.filter((_, i) => i % 2 === 0).slice(0, 5), [0, 25000, 50000, 75000, 100000].map((d) => lat0 + d));
    assert.ok(Array.from(long.step).every((value) => Math.abs(value) <= 32000));
    // the shares go up with the length: a quarter of the way north at the first cut, then half of it …
    const shares = Array.from(long.share);
    assert.ok(shares.every((value, i) => !i || value >= shares[i - 1]) && shares[0] === 0 && shares.at(-1) === 65535);
    assert.ok(Math.abs(shares[1] / 65535 - 25000 / (2 * 100000 - (keptRoute[2] - lat0))) < 0.002, `${shares}`);
    // and one that is routed is kept
    const routedNow = new KeptRoutes(dir, { ...networks, fetchedAt: 'now' });
    buildSegments(dataset, graphs, area, () => {}, { kept: routedNow });
    assert.deepEqual([...new KeptRoutes(dir, { ...networks, fetchedAt: 'now' }).find(0, STOP.mainWest, STOP.north)], pointsOf(dataset.segments));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // (as the server has it: written to a file and read again)
  const file = path.join(os.tmpdir(), `netnou-shapes-${process.pid}.dataset`);
  writeDataset(file, dataset);
  const timetable = new Timetable(readDataset(file));
  fs.rmSync(file);
  const trip = timetable.trip('T', '20261003', null);
  // the stop snapped onto A–B, then B, E, and the last stop snapped onto E–F
  assert.equal(trip.path.length / 2, 4);
  close(trip.path, [LAT, STOP.mainWest[1], ...corner('B'), ...corner('E'), LAT + 0.002, STOP.north[1]], 1e-5, 'path');

  const start = serviceDayStart('20261003') + 36000;
  const [vehicle] = timetable.vehicles(start + 300, null);
  // Halfway in time is halfway along the route: on the one-way link between B and E.
  const [lat, lon] = positionAt(vehicle.knots, start + 300);
  assert.ok(Math.abs(lon - corner('B')[1]) < 1e-5, `lon ${lon}`);
  assert.ok(lat > corner('B')[0] && lat < corner('E')[0], `lat ${lat}`);
  // Knots are ordered in time, start at or before "now" and reach past the
  // 90 s the browser may have to animate without fresh data.
  const times = vehicle.knots.filter((_, i) => i % 3 === 0);
  assert.ok(times[0] <= start + 300 && times.every((t, i) => !i || t >= times[i - 1]));
  assert.ok(times.at(-1) > start + 390, `last knot ${times.at(-1) - start} s after departure`);
  // Close to the terminus they end there.
  assert.equal(timetable.vehicles(start + 590, null)[0].knots.at(-3), start + 600);
});
