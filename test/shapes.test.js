import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Area } from '../server/lib/area.js';
import { Network, NetworkBuilder, classifyWay, pathLength, simplify } from '../server/lib/network.js';
import { readPbfWays } from '../server/lib/osmpbf.js';
import { buildSegments } from '../server/lib/shapes.js';
import { serviceDayStart } from '../server/lib/time.js';
import { Timetable, positionAt } from '../server/lib/timetable.js';
import { makePbf } from './helpers.js';

test('osm.pbf reader returns wanted ways with positions and cuts them where nodes are dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-pbf-'));
  try {
    const file = path.join(dir, 'test.osm.pbf');
    fs.writeFileSync(file, makePbf(
      [[10, 49.4, 11.0], [11, 49.41, 11.0], [20, 49.42, 11.0], [5000000000, 49.43, 11.01], [5000000001, 52.0, 13.0], [5000000002, 49.44, 11.02], [5000000003, 49.45, 11.02]],
      [
        [100, [10, 11, 20, 5000000000], { highway: 'residential', name: 'Teststraße' }],
        [101, [10, 11], { building: 'yes' }],
        [102, [20, 5000000000, 5000000001, 5000000002, 5000000003], { railway: 'tram', oneway: 'yes' }],
      ],
    ));
    const ways = [];
    const keep = (lat, lon) => lat > 49 && lat < 50 && lon > 10 && lon < 12;
    readPbfWays(file, keep, ['highway', 'railway'], (way) => ways.push(way));
    assert.deepEqual(ways.map((w) => [w.id, w.nodes]), [
      [100, [10, 11, 20, 5000000000]],
      [102, [20, 5000000000]], // node 5000000001 lies outside: the way is split there
      [102, [5000000002, 5000000003]],
    ]);
    assert.deepEqual(ways[0].tags, { highway: 'residential', name: 'Teststraße' });
    assert.deepEqual([ways[0].lat[3], ways[0].lon[3]], [49.43, 11.01]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  const builder = new NetworkBuilder();
  const way = (id, names, tags) => builder.addWay({
    id,
    tags,
    nodes: names.map((n) => n.charCodeAt(0)),
    lat: names.map((n) => LAT + NODES[n][0]),
    lon: names.map((n) => LON + NODES[n][1]),
  });
  way(1, ['A', 'B', 'C'], { highway: 'secondary' });
  way(2, ['D', 'E', 'F'], { highway: 'residential' });
  way(3, ['B', 'E'], { highway: 'residential', oneway: 'yes' });
  way(4, ['A', 'D'], { highway: 'residential' });
  way(5, ['C', 'F'], { highway: 'residential' });
  way(1, ['A', 'B', 'C'], { highway: 'secondary' }); // same way from a second extract: ignored
  way(9, ['A', 'B', 'C'], { railway: 'tram' });
  return builder.result();
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
  const leaving = road.routeBeyond(snap('mainWest'), farX, farY, (x) => x < limitX, false);
  const [cx, cy] = road.toXY(...corner('C'));
  close(leaving.slice(-4), [cx, cy, farX, farY], 0.01, 'leaves the area at C');
  const arriving = road.routeBeyond(snap('mainWest'), farX, farY, (x) => x < limitX, true);
  close(arriving.slice(0, 4), [farX, farY, cx, cy], 0.01, 'enters the area at C');
  assert.equal(arriving.length, leaving.length);
});

test('simplify drops points on a straight line only', () => {
  assert.deepEqual(simplify([0, 0, 50, 0.5, 100, 0, 100, 80, 100, 160], 1.5), [0, 0, 100, 0, 100, 160]);
  assert.deepEqual(simplify([0, 0, 50, 20, 100, 0], 1.5), [0, 0, 50, 20, 100, 0]);
});

test('vehicles and trip paths follow the routed geometry', () => {
  // Bus 1 from a stop on the main road to one on the northern street,
  // 10:00 → 10:10. The cheapest road route turns north at B over the link.
  const area = Area.fromBbox([49.4, 10.9, 49.6, 11.1]);
  const dataset = {
    stops: { id: ['P', 'Q'], name: ['P', 'Q'], lat: [STOP.mainWest[0], STOP.north[0]], lon: [STOP.mainWest[1], STOP.north[1]], parent: [-1, -1], platform: ['', ''], region: [1, 1] },
    routes: { id: ['R'], short: ['1'], long: [''], type: [3], color: [''], text: [''], agency: [''] },
    headsigns: ['Q'],
    dates: ['20261003'],
    services: [[0]],
    trips: { id: ['T'], route: [0], service: [0], headsign: [0], stops: [[0, 1]], arr: [[36000, 36600]], dep: [[36000, 36600]], seq: [null] },
  };
  dataset.segments = buildSegments(dataset, gridNetworks(), area);
  assert.deepEqual(dataset.segments.net.map((n) => dataset.segments.nets[n]), ['road']);

  const timetable = new Timetable(JSON.parse(JSON.stringify(dataset)), area);
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
