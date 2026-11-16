import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Addresses } from '../server/lib/addresses.js';
import { readDataset, writeDataset } from '../server/lib/dataset.js';
import { packDataset } from '../server/lib/importer.js';
import { kindsFromTracks, reachedBy } from '../server/lib/kinds.js';
import { buildNetworks, classifyWay } from '../server/lib/network.js';
import { readPbfWays } from '../server/lib/osmpbf.js';
import { serviceDayStart } from '../server/lib/time.js';
import { Timetable } from '../server/lib/timetable.js';
import { makePbf } from './helpers.js';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-kinds-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The networks of an extract made of these ways, each a line of nodes from west to east at one latitude. */
function networksOf(dir, ways) {
  const nodes = [];
  const made = ways.map(([lat, from, to, tags], w) => {
    const ids = [];
    for (let lon = from; lon <= to + 1e-9; lon += 0.002) ids.push(nodes.push([nodes.length + 1, lat, Math.round(lon * 1e4) / 1e4]));
    return [100 + w, ids, tags];
  });
  const file = path.join(dir, `extract-${fs.readdirSync(dir).length}.osm.pbf`);
  fs.writeFileSync(file, makePbf(nodes, made));
  return buildNetworks([readPbfWays(file, { keys: ['highway', 'railway'], classify: classifyWay })]);
}

// Around 49.5, 11.0: a street, with tram tracks 11 m north of its western
// half; a railway 1.1 km to the north, with a street beside it; nothing at all
// near 49.6 (beyond the map data).
const STREET = [49.5, 11.0, 11.02, { highway: 'residential' }];
const TRAM = [49.5001, 11.0, 11.01, { railway: 'tram' }];
const RAILWAY = [49.5101, 11.0, 11.02, { railway: 'rail' }];
const BY_THE_RAILWAY = [49.5103, 11.0, 11.02, { highway: 'residential' }];

// Stops: T at the tram tracks, B in the street east of them (22 m from the
// street, no tracks), R at the railway, F far away.
const STOPS = [
  ['T1', 49.5002, 11.0], ['T2', 49.5002, 11.003], ['T3', 49.5002, 11.006], ['T4', 49.5002, 11.009],
  ['B1', 49.5002, 11.012], ['B2', 49.5002, 11.015], ['B3', 49.5002, 11.018],
  ['R1', 49.5102, 11.002], ['R2', 49.5102, 11.008], ['R3', 49.5102, 11.014],
  ['F1', 49.6, 11.0], ['F2', 49.6, 11.01],
];
const at = Object.fromEntries(STOPS.map(([id], i) => [id, i]));

// Routes: [id, name, route type, its stops]
const ROUTES = [
  ['TRAM', '4', 0, ['T1', 'T2', 'T3', 'T4']], // a tram at its tracks: stays
  ['BUS-AS-TRAM', '36', 0, ['B1', 'B2', 'B3']], // a bus given as a tram: a bus
  ['TRAM-TRAIN', '1', 0, ['R1', 'R2', 'R3']], // a tram-train along the railway: stays (tracks of any kind)
  ['FAR', '7', 0, ['F1', 'F2']], // stops the map data does not reach: no say, stays
  ['BUS', '36', 3, ['B3', 'B2', 'B1']], // a bus, and the other way of the line 36
  ['BUS-AS-UBAHN', '336', 1, ['B1', 'B2']], // a bus given as a U-Bahn: a bus
  ['NAMED-U', 'U9', 0, ['B1', 'B2', 'B3']], // given as a tram, named as a U-Bahn (#302), not at tracks: a bus
  ['THREE-OF-FIVE', '8', 0, ['T1', 'T2', 'T3', 'B1', 'B2']], // 6 of 10 at tracks: stays
  ['TWO-OF-FIVE', '9', 0, ['T1', 'T2', 'B1', 'B2', 'B3']], // fewer: a bus
];

function dataset() {
  return packDataset({
    stops: { id: STOPS.map(([id]) => id), name: STOPS.map(([id]) => `Stop ${id}`), lat: STOPS.map(([, lat]) => lat), lon: STOPS.map(([, , lon]) => lon), parent: STOPS.map(() => -1), platform: STOPS.map(() => ''), region: STOPS.map(() => 1) },
    routes: { id: ROUTES.map(([id]) => id), short: ROUTES.map(([, name]) => name), long: ROUTES.map(() => ''), type: ROUTES.map(([, , type]) => type), color: ROUTES.map(() => ''), text: ROUTES.map(() => ''), agency: ROUTES.map(() => 'Testbetrieb') },
    headsigns: ['Ost'],
    dates: ['20261003'],
    services: [[0]],
    trips: {
      id: ROUTES.map(([id]) => `trip-${id}`),
      route: ROUTES.map((_, r) => r),
      service: ROUTES.map(() => 0),
      headsign: ROUTES.map(() => 0),
      stops: ROUTES.map(([, , , stops]) => stops.map((id) => at[id])),
      arr: ROUTES.map(([, , , stops]) => stops.map((_, k) => 36000 + k * 120)),
      dep: ROUTES.map(([, , , stops]) => stops.map((_, k) => 36000 + k * 120)),
      seq: ROUTES.map(() => null),
    },
  });
}

const typeOf = (data, id) => data.routes.type[data.routes.id.indexOf(id)];

test('a route given as a tram or a U-Bahn is a bus where fewer than 6 in 10 of its stops are at tracks of any kind (#358)', (t) => {
  const graphs = networksOf(tempDir(t), [STREET, TRAM, RAILWAY, BY_THE_RAILWAY]);
  const data = dataset();
  const given = data.routes.type.slice();
  assert.deepEqual(kindsFromTracks(data, graphs, 49.5), ['BUS-AS-TRAM', 'BUS-AS-UBAHN', 'NAMED-U', 'TWO-OF-FIVE']);
  for (const id of ['BUS-AS-TRAM', 'BUS-AS-UBAHN', 'NAMED-U', 'TWO-OF-FIVE']) assert.equal(typeOf(data, id), 3, id);
  for (const id of ['TRAM', 'TRAM-TRAIN', 'FAR', 'BUS', 'THREE-OF-FIVE']) assert.equal(typeOf(data, id), given[data.routes.id.indexOf(id)], id);
  // (what the timetable gives is kept, for every route)
  assert.deepEqual(data.routes.listed, given);

  // Decided again, as with newer map data: from what the timetable gives, not from what was decided.
  assert.deepEqual(kindsFromTracks(data, graphs, 49.5), ['BUS-AS-TRAM', 'BUS-AS-UBAHN', 'NAMED-U', 'TWO-OF-FIVE']);
  const tracked = networksOf(tempDir(t), [STREET, TRAM, RAILWAY, BY_THE_RAILWAY, [49.5001, 11.01, 11.02, { railway: 'tram' }]]);
  assert.deepEqual(kindsFromTracks(data, tracked, 49.5), []);
  assert.deepEqual(data.routes.type, given);
});

test('without railways in the map data, no route changes its kind (#358)', (t) => {
  const graphs = networksOf(tempDir(t), [STREET, BY_THE_RAILWAY]);
  const data = dataset();
  const given = data.routes.type.slice();
  assert.deepEqual(kindsFromTracks(data, graphs, 49.5), []);
  assert.deepEqual(data.routes.type, given);
});

test('without the roads of map data, no route changes its kind (#358)', (t) => {
  const graphs = networksOf(tempDir(t), [TRAM, RAILWAY]);
  const data = dataset();
  const given = data.routes.type.slice();
  assert.deepEqual(kindsFromTracks(data, graphs, 49.5), []);
  assert.deepEqual(data.routes.type, given);
  assert.deepEqual(kindsFromTracks(data, null, 49.5), []);
});

test('the map data reaches a place where its roads have a node within a cell of it', (t) => {
  const graphs = networksOf(tempDir(t), [STREET]);
  const reached = reachedBy(graphs.road, 0.002);
  assert.equal(reached(49.5002, 11.01), true);
  assert.equal(reached(49.5035, 11.01), true); // (the next cell but one: 390 m)
  assert.equal(reached(49.51, 11.01), false);
  assert.equal(reached(49.6, 11.0), false);
  assert.equal(reached(49.5, 11.06), false);
});

test('a bus the timetable gives as a tram says so, and is found by that kind (#358)', (t) => {
  const dir = tempDir(t);
  const data = dataset();
  kindsFromTracks(data, networksOf(dir, [STREET, TRAM, RAILWAY, BY_THE_RAILWAY]), 49.5);
  const file = path.join(dir, 'dataset.bin');
  writeDataset(file, { ...data, segments: null });
  const timetable = new Timetable(readDataset(file));

  // The 36 given as a tram and the 36 given as a bus are one line, a bus, of which the timetable gives some trips as a tram.
  const bus36 = timetable.lineNumber({ name: '36', mode: 'bus', agency: 'Testbetrieb' });
  assert.equal(timetable.lineIndex.get(JSON.stringify(['36', 'tram', 'Testbetrieb'])), undefined);
  assert.deepEqual(timetable.lines[bus36].listed, { modes: ['tram'], partly: true });
  assert.deepEqual(timetable.lineVehicles(bus36, [], () => '').listed, { modes: ['tram'], partly: true });
  // (all of the 336, as a U-Bahn; the tram 4 nothing)
  const bus336 = timetable.lineNumber({ name: '336', mode: 'bus', agency: 'Testbetrieb' });
  assert.deepEqual(timetable.lines[bus336].listed, { modes: ['subway'], partly: false });
  const tram4 = timetable.lineNumber({ name: '4', mode: 'tram', agency: 'Testbetrieb' });
  assert.equal('listed' in timetable.lineVehicles(tram4, [], () => ''), false);

  // A trip says the kind the timetable gives it, where that is another.
  assert.equal(timetable.trip('trip-BUS-AS-TRAM', '20261003', null).listedMode, 'tram');
  assert.equal(timetable.trip('trip-BUS-AS-TRAM', '20261003', null).mode, 'bus');
  assert.equal('listedMode' in timetable.trip('trip-BUS', '20261003', null), false);

  // Asked for as a tram, as a favourite kept before may be, it is the bus; so is its address of a tram.
  assert.equal(timetable.lineNumber({ name: '36', mode: 'tram', agency: 'Testbetrieb' }), bus36);
  assert.equal(timetable.lineNumber({ name: '336', mode: 'subway', agency: 'Testbetrieb' }), bus336);
  const addresses = new Addresses(timetable);
  assert.equal(addresses.line({ agency: 'testbetrieb', mode: 'tram', name: '36' }), bus36);
  assert.equal(addresses.linePath(bus36), 'line/testbetrieb/bus/36');
  // (a line that is a tram is not found as a bus)
  assert.equal(addresses.line({ agency: 'testbetrieb', mode: 'bus', name: '4' }), -1);

  // A stop's lines chosen by that kind before still choose it; its direction says that key too.
  const now = serviceDayStart('20261003') + 36000 - 60;
  const left = (lines) => timetable.departures('B1', now, null, { lines }).departures.map((d) => `${d.mode} ${d.line}`).sort();
  // (of the 36 only the trip given as a tram leaves B1: the one given as a bus ends there)
  assert.deepEqual(left(['tram/36']), ['bus 36']);
  assert.deepEqual(left(['bus/36']), ['bus 36']);
  assert.deepEqual(left(['tram/4']), []);
  const towards = timetable.directions('B1').find((direction) => direction.line === '36' && direction.next === 'Stop B2');
  assert.deepEqual([towards.key, towards.also], ['bus/36~stop-b2', ['tram/36~stop-b2']]);
  assert.deepEqual(timetable.directions('B1').find((direction) => direction.line === '336').also, ['subway/336~stop-b2']);
  assert.equal('also' in timetable.directions('B1').find((direction) => direction.line === '8'), false);
});
