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
  return readPbfWays(file, { keys: ['highway', 'railway'], classify: classifyWay, keepNode });
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
    assert.deepEqual(read.kinds, [{ net: 'road', factor: 1.3, dir: 3 }, { net: 'tram', factor: 1, dir: 1 }, { net: 'road', factor: 1.6, dir: 3 }], label);
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
  assert.equal(nets.rail.a.length + nets.subway.a.length, 0);

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
  assert.deepEqual(classifyWay({ highway: 'primary' }), { net: 'road', factor: 1, dir: 3 });
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
  assert.equal(classifyWay({ railway: 'subway' }).net, 'subway');
  assert.equal(classifyWay({ railway: 'rail', oneway: 'yes' }).dir, 3);
  assert.equal(classifyWay({ railway: 'tram', oneway: 'yes' }).dir, 1);
  assert.equal(classifyWay({ railway: 'rail', service: 'yard' }).factor, 3);
  assert.equal(classifyWay({ railway: 'abandoned' }), null);
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
  // tiles of 0.001 degrees the stops are too far apart for one.
  const log = [];
  const inTiles = buildSegments(dataset, graphs, area, (line) => log.push(line), { roadsAtOnce: 0, tile: 0.003 });
  assert.deepEqual([...inTiles.points], [...dataset.segments.points]);
  assert.deepEqual(buildSegments(dataset, graphs, area, (line) => log.push(line), { roadsAtOnce: 0, tile: 0.001 }).net.length, 0);
  assert.deepEqual(log.slice(-3), ['routing 1 hops', '1 hops on roads are too long for the tiles', 'hops routed: road 0/1, rail 0/0, subway 0/0, tram 0/0']);

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
