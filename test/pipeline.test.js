import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Area, scopeId } from '../server/lib/area.js';
import { eachLine, parseCsvLine } from '../server/lib/csv.js';
import { readDataset, writeDataset } from '../server/lib/dataset.js';
import { buildDataset } from '../server/lib/importer.js';
import { decodeFeed } from '../server/lib/pb.js';
import { agreedDelay, buildRealtime } from '../server/lib/realtime.js';
import { addDays, localDate, serviceDayStart, setTimeZone, weekday } from '../server/lib/time.js';
import { Timetable, lite, positionAt, routeMode } from '../server/lib/timetable.js';
import { openZip } from '../server/lib/zip.js';
import { encodeFeed, makeZip } from './helpers.js';

// A tiny feed: stops A–C lie inside the box, X and Y far outside.
//   T1  U1  A 10:00 → B 10:10/10:12 → C 10:20   (daily)
//   T2  ICE X 09:00 → B 10:00/10:05 → Y 11:00   (daily; passes through the box)
//   T3  99  X 12:00 → Y 13:00                   (never touches the box)
//   T4  U1  C 25:00 → A 25:30                   (Fridays only, after midnight)
const FEED = {
  'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\n1,Testbetrieb,https://example.org,Europe/Berlin\n',
  'stops.txt': [
    'stop_name,parent_station,stop_id,stop_lat,stop_lon,location_type,platform_code',
    'Alpha,,SA,49.40,11.00,1,',
    'Alpha,SA,A,49.40,11.00,,1',
    '"Beta, Markt",,B,49.50,11.00,,',
    'Gamma,,C,49.60,11.10,,',
    'Fern Nord,,X,52.00,13.00,,',
    'Fern Süd,,Y,48.00,11.50,,',
  ].join('\r\n') + '\r\n',
  'routes.txt': 'route_long_name,route_short_name,agency_id,route_type,route_id,route_color,route_text_color\n,U1,1,1,R1,,\n,ICE 5,1,2,R2,,\n,99,1,3,R3,,\n',
  'trips.txt': 'route_id,service_id,trip_id\nR1,DAILY,T1\nR2,DAILY,T2\nR3,DAILY,T3\nR1,FRI,T4\n',
  'calendar.txt': [
    'monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date,service_id',
    '1,1,1,1,1,1,1,20261001,20261007,DAILY',
    '0,0,0,0,1,0,0,20261001,20261007,FRI',
  ].join('\n') + '\n',
  'calendar_dates.txt': 'service_id,exception_type,date\nDAILY,2,20261005\nDAILY,1,20261010\n',
  'stop_times.txt': [
    'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type',
    'T1,10:00:00,10:00:00,A,0,"Gamma, Endstation",,',
    'T1,10:10:00,10:12:00,B,1,"Gamma, Endstation",,',
    'T1,10:20:00,10:20:00,C,2,"Gamma, Endstation",,',
    'T2,9:00:00,9:00:00,X,0,Fern Süd,,',
    'T2,10:00:00,10:05:00,B,1,Fern Süd,,',
    'T2,11:00:00,11:00:00,Y,2,Fern Süd,,',
    'T3,12:00:00,12:00:00,X,0,Fern Süd,,',
    'T3,13:00:00,13:00:00,Y,1,Fern Süd,,',
    'T4,25:00:00,25:00:00,C,0,Alpha,,',
    'T4,25:30:00,25:30:00,A,1,Alpha,,',
  ].join('\n') + '\n',
};
const AREA = Area.fromBbox([49.3, 10.8, 49.7, 11.3]);
const DAY = '20261003'; // a Saturday, CEST (UTC+2)
const at = (hhmm, date = DAY) => serviceDayStart(date) + +hhmm.slice(0, 2) * 3600 + +hhmm.slice(3) * 60;

let dir;
let timetable;

/**
 * Imports FEED with some of its files replaced.
 * @param options for buildDataset, e.g. another area or the operators to keep
 */
async function importFeed(files = {}, name = 'feed.zip', options = {}) {
  const zipPath = path.join(dir, name);
  fs.writeFileSync(zipPath, makeZip({ ...FEED, ...files }, { store: ['agency.txt'] }));
  const data = await buildDataset({ zipPath, area: AREA, ...options });
  // The server stores the dataset as a file and loads that: so does the test.
  const file = path.join(dir, `${name}.dataset`);
  writeDataset(file, data);
  return new Timetable(readDataset(file));
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-test-'));
  timetable = await importFeed();
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('parseCsvLine handles quotes, escaped quotes and empty fields', () => {
  assert.deepEqual(parseCsvLine('a,b,,d'), ['a', 'b', '', 'd']);
  assert.deepEqual(parseCsvLine('1,"Rostock, Allee",,'), ['1', 'Rostock, Allee', '', '']);
  assert.deepEqual(parseCsvLine('"say ""hi""",x'), ['say "hi"', 'x']);
  assert.deepEqual(parseCsvLine('x,"last"'), ['x', 'last']);
  assert.deepEqual(parseCsvLine("'s-Heerenberg,,1"), ["'s-Heerenberg", '', '1']);
});

test('eachLine finds the lines however the bytes arrive', async () => {
  const bytes = Buffer.from('a,b\r\nGrün,Süd\n\nlast', 'utf8');
  // every chunk size: each line break and each two-byte character is cut in two at some point
  for (let size = 1; size <= bytes.length; size++) {
    const chunks = [];
    for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
    const lines = [];
    await eachLine(chunks, (line) => lines.push(line));
    assert.deepEqual(lines, ['a,b', 'Grün,Süd', '', 'last'], `chunks of ${size} bytes`);
  }
});

test('zip reader streams deflated and stored members', async () => {
  const zipPath = path.join(dir, 'feed.zip');
  const zip = await openZip(zipPath);
  try {
    for (const name of ['agency.txt', 'stop_times.txt']) {
      const chunks = [];
      for await (const chunk of await zip.stream(name)) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString('utf8'), FEED[name]);
    }
    await assert.rejects(zip.stream('missing.txt'), /not found/);
  } finally {
    await zip.close();
  }
});

test('a zip64 archive is read the same way', async () => {
  const zipPath = path.join(dir, 'zip64.zip');
  fs.writeFileSync(zipPath, makeZip(FEED, { store: ['agency.txt'], zip64: true }));
  const zip = await openZip(zipPath);
  try {
    assert.deepEqual([...zip.entries.keys()], Object.keys(FEED));
    for (const name of ['agency.txt', 'stop_times.txt']) {
      const chunks = [];
      for await (const chunk of await zip.stream(name)) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString('utf8'), FEED[name]);
    }
  } finally {
    await zip.close();
  }
  const data = await buildDataset({ zipPath, area: AREA });
  assert.deepEqual([...data.trips.id].sort(), ['T1', 'T2', 'T4']);
});

test('service days follow Europe/Berlin including the DST switch', () => {
  assert.equal(serviceDayStart('20261003'), Date.UTC(2026, 9, 2, 22) / 1000); // CEST
  assert.equal(serviceDayStart('20261201'), Date.UTC(2026, 10, 30, 23) / 1000); // CET
  // Clocks go back on 25 Oct 2026: GTFS counts from noon minus 12 h, not from midnight.
  assert.equal(serviceDayStart('20261025'), Date.UTC(2026, 9, 24, 23) / 1000);
  assert.equal(localDate(Date.UTC(2026, 9, 3, 21, 59) / 1000), '20261003');
  assert.equal(localDate(Date.UTC(2026, 9, 3, 22, 0) / 1000), '20261004');
  assert.equal(addDays('20261031', 1), '20261101');
  assert.equal(weekday('20261003'), 5);
});

test('the time zone of the feed can be set', () => {
  const berlin = at('10:05');
  setTimeZone('America/New_York');
  try {
    assert.equal(serviceDayStart('20261003'), Date.UTC(2026, 9, 3, 4) / 1000); // EDT (UTC-4)
    assert.equal(serviceDayStart('20261201'), Date.UTC(2026, 11, 1, 5) / 1000); // EST (UTC-5)
    // Clocks go back on 1 Nov 2026: the service day starts an hour after local midnight.
    assert.equal(serviceDayStart('20261101'), Date.UTC(2026, 10, 1, 5) / 1000);
    assert.equal(localDate(Date.UTC(2026, 9, 3, 3, 59) / 1000), '20261002');
    assert.equal(localDate(Date.UTC(2026, 9, 3, 4, 0) / 1000), '20261003');
    // the same timetable now runs six hours later
    assert.equal(at('10:05') - berlin, 6 * 3600);
    assert.ok(timetable.vehicles(at('10:05'), null).some((v) => v.id === `T1_${DAY}`));
    assert.deepEqual(timetable.vehicles(berlin, null), []);
    assert.equal(timetable.trip('T1', DAY, null).stops[0].dep, at('10:00'));
  } finally {
    setTimeZone('Europe/Berlin');
  }
  assert.equal(at('10:05'), berlin);
  assert.throws(() => setTimeZone('Mars/Olympus_Mons'), RangeError);
  assert.equal(at('10:05'), berlin);
});

test('importer keeps exactly the trips that touch the box', () => {
  assert.deepEqual([...timetable.tripIndex.keys()].sort(), ['T1', 'T2', 'T4']);
  // stops outside the box are kept for trips that continue beyond it
  assert.ok(timetable.stopIndex.has('X'));
  assert.equal(timetable.headsign(timetable.tripIndex.get('T1')), 'Gamma, Endstation');
  assert.equal(timetable.stops.name[timetable.stopIndex.get('B')], 'Beta, Markt');
  // platform A is grouped under its parent station SA
  assert.deepEqual(timetable.stations.map((s) => s.id).sort(), ['B', 'C', 'SA']);
  assert.deepEqual(timetable.stations.find((s) => s.id === 'B').modes, ['subway', 'longdistance']);
});

test('importer copes with a byte order mark, rows out of order, missing times and trip_headsign', async () => {
  const other = await importFeed({
    // a quoted header behind a byte order mark, as some exporters write it
    'stops.txt': [
      '\uFEFF"stop_name","parent_station","stop_id","stop_lat","stop_lon"',
      'Alpha,,SA,49.40,11.00',
      'Alpha,SA,A,49.40,11.00',
      '"Beta, Markt",,B,49.50,11.00',
      'Gamma,,C,49.60,11.10',
      'Fern Nord,,X,52.00,13.00',
      'Fern Süd,,Y,48.00,11.50',
    ].join('\n'),
    'trips.txt': '\uFEFFroute_id,service_id,trip_id,trip_headsign\nR1,DAILY,T1,Gamma über Beta\nR2,DAILY,T2,\nR1,DAILY,T5,Gamma\nR1,DAILY,T6,Gamma\n',
    'stop_times.txt': [
      '\uFEFFtrip_id,arrival_time,departure_time,stop_id,stop_sequence',
      // T1 backwards, with no times at the stop in the middle
      'T1,10:20:00,10:20:00,C,30',
      'T1,,,B,20',
      'T1,10:00:00,10:02:00,A,10',
      'T2,9:00:00,9:00:00,X,0',
      'T2,10:00:00,10:05:00,B,1',
      'T2,11:00:00,11:00:00,Y,2',
      // times missing at the first or the last stop cannot be filled in
      'T5,,,A,0',
      'T5,10:10:00,10:10:00,B,1',
      'T6,10:00:00,10:00:00,A,0',
      'T6,,,B,1',
    ].join('\n'),
  }, 'other.zip');
  assert.deepEqual([...other.tripIndex.keys()].sort(), ['T1', 'T2']);
  assert.deepEqual(other.stations.map((s) => s.id).sort(), ['B', 'C', 'SA']);

  const t1 = other.tripIndex.get('T1');
  assert.deepEqual(Array.from(other.stopsOf(t1), (s) => other.stops.id.get(s)), ['A', 'B', 'C']);
  assert.deepEqual([0, 1, 2].map((p) => other.seq(t1, p)), [10, 20, 30]);
  // B lies halfway between the departure from A and the arrival at C
  assert.deepEqual([0, 1, 2].map((p) => other.schedArr(t1, p)), [36000, 36660, 37200]);
  assert.deepEqual([0, 1, 2].map((p) => other.schedDep(t1, p)), [36120, 36660, 37200]);
  // stop_times.txt has no stop_headsign: trips.txt is asked, then the last stop
  assert.equal(other.headsign(t1), 'Gamma über Beta');
  assert.equal(other.headsign(other.tripIndex.get('T2')), 'Fern Süd');

  // realtime updates are matched by stop_sequence, not by position
  const rt = buildRealtime(other, decodeFeed(encodeFeed({ timestamp: 1, tripUpdates: [{ tripId: 'T1', startDate: DAY, stops: [{ seq: 20, stopId: 'B', arr: { delay: 60 } }] }] })));
  assert.deepEqual(rt.byDate.get(DAY).get(t1).arrDelay, [null, 60, 60]);
});

test('a trip whose rows come in two runs is put together, where the feed first names it', async () => {
  const split = await importFeed({
    'stop_times.txt': [
      'trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type',
      // T1 as far as B, which is a trip already; its last stop follows further down
      'T1,10:00:00,10:00:00,A,0,"Gamma, Endstation",,',
      'T1,10:10:00,10:12:00,B,1,"Gamma, Endstation",,',
      // one stop of T4, which is none yet
      'T4,25:00:00,25:00:00,C,0,Alpha,,',
      'T2,9:00:00,9:00:00,X,0,Fern Süd,,',
      'T2,10:00:00,10:05:00,B,1,Fern Süd,,',
      'T2,11:00:00,11:00:00,Y,2,Fern Süd,,',
      'T1,10:20:00,10:20:00,C,2,"Gamma, Endstation",,',
      'T4,25:30:00,25:30:00,A,1,Alpha,,',
    ].join('\n') + '\n',
  }, 'split.zip');
  assert.deepEqual([...split.tripIndex.keys()], ['T1', 'T4', 'T2']);
  for (const [id, date] of [['T1', DAY], ['T2', DAY], ['T4', '20261002']]) {
    assert.deepEqual(split.trip(id, date, null), timetable.trip(id, date, null), id);
  }
  // T1 shared its two stops with nobody; the three it has now are one sequence, as in the feed that has them together
  const t1 = split.tripIndex.get('T1');
  assert.deepEqual(Array.from(split.stopsOf(t1), (s) => split.stops.id.get(s)), ['A', 'B', 'C']);
  assert.deepEqual(split.vehicles(at('10:05'), null).map((v) => [v.id, v.lat, v.lon]), timetable.vehicles(at('10:05'), null).map((v) => [v.id, v.lat, v.lon]));
});

test('an area without stops is reported with a hint at the settings', async () => {
  const zipPath = path.join(dir, 'feed.zip');
  await assert.rejects(buildDataset({ zipPath, area: Area.fromBbox([10.8, 49.3, 11.3, 49.7]) }), /no stops in the area; check NETNOU_BBOX or NETNOU_AREA_FILE/);
});

test('without an area an instance has everything the feed has', async () => {
  const all = await importFeed({}, 'all.zip', { area: null });
  assert.deepEqual([...all.tripIndex.keys()].sort(), ['T1', 'T2', 'T3', 'T4']);
  // every stop belongs to it: the stations far outside the box are listed and have departures
  assert.deepEqual(all.stations.map((s) => s.id).sort(), ['B', 'C', 'SA', 'X', 'Y']);
  assert.deepEqual(all.departures('X', at('11:55'), null).departures.map((d) => d.line), ['99']);
  assert.equal(timetable.departures('X', at('11:55'), null), null);
  // what it covers is the rectangle around its stops
  assert.deepEqual(all.bbox, [48, 11, 52, 13]);
  // the bus that never touches the box is under way
  assert.deepEqual(all.vehicles(at('12:30'), null).map((v) => v.id), [`T3_${DAY}`]);
  assert.deepEqual(timetable.vehicles(at('12:30'), null), []);
  // (with an area it is the stops in and around it that count)
  assert.deepEqual(timetable.bbox, [49.4, 11, 49.6, 11.1]);
});

// The feed with a second operator, whose one line (the 99) never touches the box.
const OPERATORS = {
  'agency.txt': FEED['agency.txt'] + '2,"Fernbus, Nord GmbH",https://example.org,Europe/Berlin\n',
  'routes.txt': FEED['routes.txt'].replace(',99,1,3,R3', ',99,2,3,R3'),
};
const operator = (name) => ({ name, key: name.trim().toLowerCase() });

test('an instance may keep the trips of some operators, in its area or wherever they run', async () => {
  const zipPath = path.join(dir, 'operators.zip');
  fs.writeFileSync(zipPath, makeZip({ ...FEED, ...OPERATORS }));
  const ids = async (options) => [...(await buildDataset({ zipPath, ...options })).trips.id].sort();

  // one operator without an area: its trips and no others
  const fernbus = await importFeed(OPERATORS, 'operators.zip', { area: null, agencies: [operator('Fernbus, Nord GmbH')] });
  assert.deepEqual([...fernbus.tripIndex.keys()], ['T3']);
  assert.deepEqual(fernbus.stations.map((s) => s.id).sort(), ['X', 'Y']);
  assert.deepEqual(fernbus.bbox, [48, 11.5, 52, 13]);
  assert.deepEqual(fernbus.searchList().list.lines.agencies, ['Fernbus, Nord GmbH']);
  // the name counts without its capitals
  assert.deepEqual(await ids({ area: null, agencies: [operator('TESTBETRIEB')] }), ['T1', 'T2', 'T4']);
  // an area and operators: a trip has to pass both
  assert.deepEqual(await ids({ area: AREA, agencies: [operator('Testbetrieb')] }), ['T1', 'T2', 'T4']);
  assert.deepEqual(await ids({ area: AREA, agencies: [operator('Testbetrieb'), operator('Fernbus, Nord GmbH')] }), ['T1', 'T2', 'T4']);
  assert.deepEqual(await ids({ area: null, agencies: [operator('Testbetrieb'), operator('Fernbus, Nord GmbH')] }), ['T1', 'T2', 'T3', 'T4']);
  await assert.rejects(buildDataset({ zipPath, area: AREA, agencies: [operator('Fernbus, Nord GmbH')] }), /^Error: no trip of the operators in NETNOU_AGENCIES serves a stop in the area; NETNOU_AREA=Germany takes their trips wherever they run$/);

  // a name the feed does not have is named, with what the feed has that is like it
  await assert.rejects(
    buildDataset({ zipPath, area: null, agencies: [operator('Testbetrieb'), operator('Fernbus Nord')] }),
    /^Error: the feed has no operator "Fernbus Nord" \(it has "Fernbus, Nord GmbH"\); NETNOU_AGENCIES takes the names as agency\.txt of the feed has them \(agency_name\), of which there are 2$/,
  );
  await assert.rejects(buildDataset({ zipPath, area: AREA, agencies: [operator('Bahn'), operator('Bus')] }), /^Error: the feed has no operator "Bahn" and none called "Bus"; /);

  // what a dataset was made for is in it: an area alone as before, else the area and the operators
  const made = async (options) => (await buildDataset({ zipPath, ...options })).area;
  assert.equal(await made({ area: AREA }), AREA.id);
  assert.equal(await made({ area: null }), scopeId(null, null));
  assert.equal(await made({ area: AREA, agencies: [operator('Testbetrieb')] }), scopeId(AREA, ['testbetrieb']));
});

test('a line is the trips of a name, mode and operator that share stations: of one name in places apart each is a line (#152)', async () => {
  // a second U1 of the operator, between two stops of its own in the area
  const apart = await importFeed({
    'stops.txt': `${FEED['stops.txt']}Delta,,D,49.35,10.90,,\r\nEpsilon,,E,49.36,10.90,,\r\n`,
    'routes.txt': `${FEED['routes.txt']},U1,1,1,R5,,\n`,
    'trips.txt': `${FEED['trips.txt']}R5,DAILY,T5\n`,
    'stop_times.txt': `${FEED['stop_times.txt']}T5,10:00:00,10:00:00,D,0,,,\nT5,10:10:00,10:10:00,E,1,,,\n`,
  }, 'apart.zip');
  const [first, second] = apart.lines.flatMap((line, i) => (line.name === 'U1' ? [i] : []));
  // the U1 from Alpha by way of Beta to Gamma and back on Fridays, and the one from Delta to Epsilon, each with the
  // middle of its stations
  assert.deepEqual([first, second].map((i) => [apart.lines[i].trips, apart.lines[i].place]), [[2, [49.5, 11.03333]], [1, [49.355, 10.9]]]);
  assert.deepEqual(timetable.lines.filter((line) => line.name === 'U1').length, 1);
  // asked for by its name, the busiest; by its place too, the nearest
  const u1 = { name: 'U1', mode: 'subway', agency: 'Testbetrieb' };
  assert.equal(apart.lineNumber(u1), first);
  assert.equal(apart.lineNumber(u1, [49.36, 10.91]), second);
  assert.equal(apart.lineNumber(u1, [49.6, 11.1]), first);
  // a trip knows the place of its line, and its vehicle the line
  assert.deepEqual(apart.trip('T5', DAY, null).lineAt, [49.355, 10.9]);
  const lineOf = Object.fromEntries(apart.vehicles(at('10:05'), null).map((v) => [v.id.split('_')[0], v.lineIndex]));
  assert.deepEqual([lineOf.T1, lineOf.T5], [first, second]);
  // where each runs, and the search lists both
  assert.deepEqual(apart.lineRoute(second, at('10:05')), { paths: [[49.35, 10.9, 49.36, 10.9]], stations: [49.35, 10.9, 49.36, 10.9], bounds: [49.35, 10.9, 49.36, 10.9] });
  assert.equal(apart.searchList().list.lines.name.filter((name) => name === 'U1').length, 2);
});

test('calendar and calendar_dates decide which days a trip runs', () => {
  const t1 = timetable.tripIndex.get('T1');
  assert.ok(timetable.runsOn(t1, '20261003'));
  assert.ok(!timetable.runsOn(t1, '20261005')); // removed by exception
  assert.ok(timetable.runsOn(t1, '20261010')); // added by exception
  assert.ok(!timetable.runsOn(t1, '20261008')); // outside the calendar range
  const t4 = timetable.tripIndex.get('T4');
  assert.ok(timetable.runsOn(t4, '20261002') && !timetable.runsOn(t4, '20261003'));
});

test('routeMode tells S-Bahn, regional and long-distance trains apart', () => {
  assert.equal(routeMode(2, 'S1'), 'suburban');
  assert.equal(routeMode(2, 'RE10'), 'regional');
  assert.equal(routeMode(2, 'ICE 29'), 'longdistance');
  assert.equal(routeMode(2, 'IC 61'), 'longdistance');
  assert.equal(routeMode(0, 'D'), 'tram');
  assert.equal(routeMode(1, 'U1'), 'subway');
  assert.equal(routeMode(3, 'N3'), 'bus');
  assert.equal(routeMode(700, '36'), 'other'); // the extended route types of buses, trams and trains are not known
});

test('routeMode makes ferries and cable cars and monorails kinds of their own, and trolleybuses buses', () => {
  const kinds = (types) => types.map((type) => routeMode(type, ''));
  // ferries; of the extended types water transport (1000s) and ferry service (1200)
  assert.deepEqual(kinds([4, 1000, 1008, 1021, 1200]), Array(5).fill('ferry'));
  // cable tram, aerial lift, funicular (in the feed of Germany: suspension railways, rack railways, cable cars), monorail;
  // of the extended types monorail (405), aerial lifts (1300s) and funiculars (1400s)
  assert.deepEqual(kinds([5, 6, 7, 12, 405, 1300, 1304, 1400, 1402]), Array(9).fill('cable'));
  // trolleybuses; of the extended types trolleybus service (800)
  assert.deepEqual(kinds([11, 800]), ['bus', 'bus']);
  // everything else
  assert.deepEqual(kinds([1100, 1500, 1700, 99]), Array(4).fill('other'));
});

test('vehicles are interpolated between stops along the schedule', () => {
  const vehicles = timetable.vehicles(at('10:05'), null);
  const u1 = vehicles.find((v) => v.id === `T1_${DAY}`);
  assert.equal(u1.line, 'U1');
  assert.equal(u1.mode, 'subway');
  assert.equal(u1.delay, null);
  const [lat, lon] = positionAt(u1.knots, at('10:05'));
  assert.ok(Math.abs(lat - 49.45) < 1e-6 && Math.abs(lon - 11.0) < 1e-6); // halfway A → B
  // the reduced form for zoomed-out maps: where it is now and in a minute
  const reduced = lite(u1, at('10:05'));
  assert.deepEqual([reduced[0], reduced[3]], [at('10:05'), at('10:06')]);
  assert.ok(Math.abs(reduced[1] - 49.45) < 1e-5 && Math.abs(reduced[4] - 49.46) < 1e-5, `lite ${reduced}`);
  // dwelling at B between 10:10 and 10:12
  assert.deepEqual(positionAt(timetable.vehicles(at('10:11'), null).find((v) => v.id === u1.id).knots, at('10:11')), [49.5, 11.0]);

  // the ICE stands at B inside the box at 10:02 – and is followed outside the
  // box as well: ten minutes after leaving X it is still far in the north
  assert.ok(timetable.vehicles(at('10:02'), null).some((v) => v.id === `T2_${DAY}`));
  const ice = timetable.vehicles(at('09:10'), null).find((v) => v.id === `T2_${DAY}`);
  assert.ok(ice.lat > 51.5 && ice.lat < 51.7, `ICE at ${ice.lat}`);
  // nothing runs before the first departure or after the last arrival
  assert.deepEqual(timetable.vehicles(at('08:00'), null), []);
  assert.deepEqual(timetable.vehicles(at('12:00'), null), []);
});

// The feed knows nothing of trains that run coupled. What gives them away is
// that they share the way from stop to stop, at the same times.
// RE14 (T5) and RE28 (T6) leave A as one train and part at B; two buses (T7, T8) have the same times all the way.
const COUPLED = {
  'routes.txt': FEED['routes.txt'] + ',RE14,1,2,R4,,\n,RE28,1,2,R5,,\n',
  'trips.txt': FEED['trips.txt'] + 'R4,DAILY,T5\nR5,DAILY,T6\nR3,DAILY,T7\nR3,DAILY,T8\n',
  'stop_times.txt': FEED['stop_times.txt'] + [
    'T5,10:30:00,10:30:00,A,0,Gamma,,',
    'T5,10:40:00,10:44:00,B,1,Gamma,,',
    'T5,10:55:00,10:55:00,C,2,Gamma,,',
    'T6,10:30:00,10:30:00,A,0,Fern Nord,,',
    'T6,10:40:00,10:46:00,B,1,Fern Nord,,',
    'T6,12:00:00,12:00:00,X,2,Fern Nord,,',
    'T7,10:30:00,10:30:00,A,0,Gamma,,',
    'T7,10:40:00,10:40:00,B,1,Gamma,,',
    'T8,10:30:00,10:30:00,A,0,Gamma,,',
    'T8,10:40:00,10:40:00,B,1,Gamma,,',
  ].join('\n') + '\n',
};

test('trains that share their way and its times are one unit until they part', async () => {
  const coupled = await importFeed(COUPLED, 'coupled.zip');
  const unitsAt = (hhmm) => Object.fromEntries(coupled.vehicles(at(hhmm), null).map((v) => [v.id.split('_')[0], v.unit]));

  // under way from A to B, and before that at A, about to leave
  for (const time of ['10:35', '10:30']) {
    const units = unitsAt(time);
    assert.ok(units.T5, `${time}: the RE14 is part of a unit`);
    assert.equal(units.T5, units.T6, `${time}: the same one as the RE28`);
    // buses are not coupled, whatever their times
    assert.equal(units.T7, undefined);
    assert.equal(units.T8, undefined);
  }
  // standing at B, where they arrived together
  assert.equal(unitsAt('10:42').T5, unitsAt('10:42').T6);
  assert.ok(unitsAt('10:42').T5);
  // the RE14 has left, the RE28 still stands there: two trains
  assert.equal(unitsAt('10:45').T5, undefined);
  assert.equal(unitsAt('10:45').T6, undefined);
  // the U1 runs the same way at other times and belongs to nobody
  assert.equal(unitsAt('10:05').T1, undefined);
  // none of this is sent for a vehicle that is on its own
  assert.ok(!('unit' in JSON.parse(JSON.stringify(coupled.vehicles(at('10:05'), null)[0]))));
});

// One train cannot be at two places. Which of the delays its portions report counts for all of them:
test('of the delays reported for the portions of a coupled train, one counts for all', () => {
  const reported = (delay) => [delay, true];
  const carried = (delay) => [delay, false];
  // what is reported for the stop itself, before what is carried on from an earlier stop
  assert.equal(agreedDelay([carried(0), reported(180), carried(0), carried(0)]), 180);
  assert.equal(agreedDelay([carried(300), reported(0)]), 0);
  // the one that several have, before a larger one
  assert.equal(agreedDelay([reported(0), reported(0), reported(180)]), 0);
  assert.equal(agreedDelay([reported(180), reported(60), reported(60)]), 60);
  // no two the same, or as many of one as of the other: the largest
  assert.equal(agreedDelay([reported(60), reported(180), reported(120)]), 180);
  assert.equal(agreedDelay([reported(0), reported(180), reported(0), reported(180)]), 180);
  assert.equal(agreedDelay([reported(-60), reported(-120)]), -60);
  // nothing reported for the stop: the same among those carried on
  assert.equal(agreedDelay([carried(0), carried(0), carried(300)]), 0);
  assert.equal(agreedDelay([carried(null), carried(120)]), 120);
  // nothing known of any of them
  assert.equal(agreedDelay([carried(null), carried(null)]), null);
});

test('the portions of a coupled train stay together when the feed reports a delay for one of them only', async () => {
  const coupled = await importFeed(COUPLED, 'coupled.zip');
  const [re14, re28, bus] = ['T5', 'T6', 'T7'].map((id) => coupled.tripIndex.get(id));
  // The RE14 left A on time, and that is all the feed says about it. The RE28
  // is to reach B three minutes late and to leave it one minute late.
  const feed = decodeFeed(encodeFeed({
    timestamp: at('10:31'),
    tripUpdates: [
      { tripId: 'T5', startDate: DAY, stops: [{ seq: 0, stopId: 'A', dep: { delay: 0 } }] },
      { tripId: 'T6', startDate: DAY, stops: [{ seq: 1, stopId: 'B', arr: { delay: 180 }, dep: { delay: 60 } }] },
      { tripId: 'T7', startDate: DAY, stops: [{ seq: 1, stopId: 'B', arr: { delay: 180 } }] },
    ],
  }));
  const rt = buildRealtime(coupled, feed);
  const delays = rt.byDate.get(DAY);
  // on the way they share, both have what is reported for its ends: on time at A, three minutes late at B
  assert.deepEqual([delays.get(re14).depDelay[0], delays.get(re28).depDelay[0]], [0, 0]);
  assert.deepEqual([delays.get(re14).arrDelay[1], delays.get(re28).arrDelay[1]], [180, 180]);
  // from B on each goes its own way, with its own delays
  assert.deepEqual([delays.get(re14).depDelay[1], delays.get(re28).depDelay[1]], [0, 60]);
  // buses are not coupled: the other one, of which the feed says nothing, stays without
  assert.equal(delays.get(bus).arrDelay[1], 180);
  assert.ok(!delays.has(coupled.tripIndex.get('T8')));
  assert.equal(rt.matched, 3);

  // so they are at the same place all the way, and one unit
  for (const time of ['10:31', '10:36', '10:42']) {
    const [a, b] = ['T5', 'T6'].map((id) => coupled.vehicles(at(time), rt).find((v) => v.id === `${id}_${DAY}`));
    assert.deepEqual([a.lat, a.lon], [b.lat, b.lon], `${time}: at the same place`);
    assert.equal(a.delay, 180, `${time}: the RE14 with the delay that counts`);
    assert.equal(b.delay, 180);
    assert.ok(a.unit && a.unit === b.unit, `${time}: one unit`);
  }
  // they reach B at 10:43, not at 10:40: a minute before, both are still under way
  const [early] = coupled.vehicles(at('10:42'), rt).filter((v) => v.id === `T5_${DAY}`);
  assert.ok(early.lat < 49.5, `still south of B at ${early.lat}`);
  // and what the details of the RE14 say agrees with the map
  assert.equal(coupled.trip('T5', DAY, rt).stops[1].arrDelay, 180);

  // a portion the feed has no word on gets what the other says about the way they share, and nothing else
  const one = buildRealtime(coupled, decodeFeed(encodeFeed({ timestamp: at('10:31'), tripUpdates: [{ tripId: 'T6', startDate: DAY, stops: [{ seq: 1, stopId: 'B', arr: { delay: 120 }, dep: { delay: 120 } }] }] })));
  assert.deepEqual(one.byDate.get(DAY).get(re14).arrDelay, [null, 120, null]);
  assert.deepEqual(one.byDate.get(DAY).get(re14).depDelay, [null, null, null]);
  assert.equal(one.matched, 1);
});

test('trips after midnight belong to the previous service day', () => {
  const now = at('25:15', '20261002'); // Saturday 01:15 local time
  assert.equal(localDate(now), '20261003');
  const vehicles = timetable.vehicles(now, null);
  assert.deepEqual(vehicles.map((v) => v.id), ['T4_20261002']);
});

test('realtime delays shift positions and carry forward to later stops', () => {
  const feed = decodeFeed(
    encodeFeed({
      timestamp: at('10:05'),
      tripUpdates: [
        { tripId: 'T1', startDate: DAY, stops: [{ seq: 0, stopId: 'A', dep: { delay: 300, time: at('10:05') } }] },
        { tripId: 'T3', startDate: DAY, stops: [{ seq: 0, stopId: 'X', dep: { delay: 60 } }] },
      ],
      alerts: [
        { tripId: 'T1', text: 'Echtzeitdaten aufbereitet von GTFS.de, bereitgestellt von VAG Nürnberg' },
        { tripId: 'T1', text: 'Technische Störung am Zug' },
        { stopId: 'A', text: 'Aufzug außer Betrieb' },
      ],
    }),
    { wantTrip: (trip) => timetable.tripIndex.has(trip.tripId) },
  );
  assert.equal(feed.timestamp, at('10:05'));
  assert.equal(feed.tripUpdates.length, 1); // T3 is not part of the regional timetable

  const rt = buildRealtime(timetable, feed);
  assert.equal(rt.matched, 1);
  const t1 = timetable.tripIndex.get('T1');
  const delays = rt.byDate.get(DAY).get(t1);
  assert.deepEqual(delays.depDelay, [300, 300, 300]);
  assert.deepEqual(delays.arrDelay, [300, 300, 300]);

  // five minutes late: at 10:10 the train is where the schedule had it at 10:05
  const v = timetable.vehicles(at('10:10'), rt).find((x) => x.id === `T1_${DAY}`);
  assert.equal(v.delay, 300);
  const [lat] = positionAt(v.knots, at('10:10'));
  assert.ok(Math.abs(lat - 49.45) < 1e-6);
  // and it is still under way after its scheduled arrival at the terminus
  assert.ok(timetable.vehicles(at('10:23'), rt).some((x) => x.id === v.id));
  assert.ok(!timetable.vehicles(at('10:23'), null).some((x) => x.id === v.id));

  const trip = timetable.trip('T1', DAY, rt);
  // the gtfs.de note about where the data comes from is the source, not a note
  assert.equal(trip.source, 'VAG Nürnberg');
  assert.deepEqual(trip.notes, [{ title: null, text: 'Technische Störung am Zug', severity: null }]);
  assert.equal(trip.stops[1].depDelay, 300);
  assert.equal(trip.stops[0].station, 'SA');
  assert.equal(timetable.trip('T1', '20261005', rt), null); // does not run that day
  assert.equal(timetable.trip('T2', DAY, rt).source, null);
  assert.equal(timetable.trip('T1', DAY, null).source, null);

  const board = timetable.departures('SA', at('09:58'), rt);
  assert.deepEqual(board.notes, [{ title: null, text: 'Aufzug außer Betrieb', severity: null }]);
  assert.deepEqual(board.departures.map((d) => [d.line, d.to, d.planned, d.delay]), [['U1', 'Gamma, Endstation', at('10:00'), 300]]);
  // a terminus has no departures: T4 ends at A, T1 ends at C
  assert.deepEqual(timetable.departures('C', at('10:15'), rt).departures, []);
});

test('alerts are shown only during their active periods', () => {
  const feed = decodeFeed(encodeFeed({
    timestamp: 1,
    alerts: [
      { tripId: 'T1', text: 'always' },
      { tripId: 'T1', text: 'in the morning', periods: [{ start: at('06:00'), end: at('12:00') }] },
      { tripId: 'T1', text: 'in the evening and from tomorrow', periods: [{ start: at('20:00'), end: at('22:00') }, { start: at('24:00') }] },
      { stopId: 'A', text: 'until noon', periods: [{ end: at('12:00') }] },
    ],
  }));
  const t1 = timetable.tripIndex.get('T1');
  const sa = timetable.stopIndex.get('SA');
  const notes = (now) => {
    const rt = buildRealtime(timetable, feed, now);
    return [rt.tripNotes.get(t1), rt.stationNotes.get(sa) ?? []].map((list) => list.map((note) => note.text));
  };
  assert.deepEqual(notes(at('05:00')), [['always'], ['until noon']]);
  assert.deepEqual(notes(at('06:00')), [['always', 'in the morning'], ['until noon']]);
  assert.deepEqual(notes(at('12:00')), [['always'], []]);
  assert.deepEqual(notes(at('21:00')), [['always', 'in the evening and from tomorrow'], []]);
  assert.deepEqual(notes(at('23:00')), [['always'], []]);
  assert.deepEqual(notes(at('30:00')), [['always', 'in the evening and from tomorrow'], []]);
});

test('a note is the text of an alert, and its headline where that says something else', () => {
  const notes = (...alerts) => {
    const feed = decodeFeed(encodeFeed({ timestamp: 1, alerts: alerts.map((alert) => ({ tripId: 'T1', ...alert })) }));
    return (buildRealtime(timetable, feed).tripNotes.get(timetable.tripIndex.get('T1')) ?? []).map(({ title, text }) => ({ title, text }));
  };
  assert.deepEqual(
    notes(
      { text: 'Niederflur' },
      { title: 'WLAN verfügbar', text: 'WLAN verfügbar' },
      { title: 'Umleitung wegen Bauarbeiten' },
      { title: 'Haltestelle Burg entfällt', text: 'Bis Sonntag wird die Haltestelle Burg nicht bedient.' },
    ),
    [
      { title: null, text: 'Niederflur' },
      { title: null, text: 'WLAN verfügbar' },
      { title: null, text: 'Umleitung wegen Bauarbeiten' },
      { title: 'Haltestelle Burg entfällt', text: 'Bis Sonntag wird die Haltestelle Burg nicht bedient.' },
    ],
  );
  // The lines of a text stay, the room operators leave around them does not; a headline is one line.
  assert.deepEqual(
    notes({ title: ' Linie 345:\n Umleitung ', text: '\n\n   \n        \nLinie 345: \r\n\u00a0Die Linie wird umgeleitet.\n \n \n\n  Dauer: bis Januar\u00a0\n' }),
    [{ title: 'Linie 345: Umleitung', text: 'Linie 345:\nDie Linie wird umgeleitet.\n\nDauer: bis Januar' }],
  );
  assert.deepEqual(notes({ title: 'Bus hält   nicht', text: 'Bus hält\nnicht' }), [{ title: null, text: 'Bus hält\nnicht' }]);
  // the same note twice is one; the same text under another headline is another
  assert.deepEqual(
    notes({ title: 'A', text: 'gesperrt' }, { title: 'A', text: 'gesperrt' }, { title: 'B', text: 'gesperrt' }).map((note) => note.title),
    ['A', 'B'],
  );
  // an alert that says nothing is no note
  assert.deepEqual(notes({ text: ' \n ' }, { title: '', text: '' }), []);
  assert.deepEqual(notes({ title: 'Nur die Überschrift', text: ' \n' }), [{ title: null, text: 'Nur die Überschrift' }]);
});

test('a note says how serious the feed takes it, and what warns comes first', () => {
  const feed = decodeFeed(encodeFeed({
    timestamp: 1,
    alerts: [
      { tripId: 'T1', text: 'Niederflur', severity: 2 },
      { tripId: 'T1', text: 'WLAN verfügbar' },
      { tripId: 'T1', text: 'Verspätetes Personal aus vorheriger Fahrt', severity: 3 },
      { tripId: 'T1', text: 'Barrierefreies Fahrzeug', severity: 1 },
      { tripId: 'T1', text: 'Reparatur an der Strecke', severity: 4 },
      { tripId: 'T1', text: 'Polizeieinsatz', severity: 3 },
      // a level the feed may come to know one day: no warning as long as nobody knows what it means
      { tripId: 'T1', text: 'Etwas Neues', severity: 9 },
      { stopId: 'A', text: 'Aufzug außer Betrieb', severity: 2 },
      { stopId: 'A', text: 'Bahnsteig gesperrt', severity: 3 },
    ],
  }));
  const rt = buildRealtime(timetable, feed);
  const said = (notes) => notes.map((note) => [note.text, note.severity]);
  // the most severe first, then the other warnings, then the rest, each kind in the order of the feed
  assert.deepEqual(said(rt.tripNotes.get(timetable.tripIndex.get('T1'))), [
    ['Reparatur an der Strecke', 'severe'],
    ['Verspätetes Personal aus vorheriger Fahrt', 'warning'],
    ['Polizeieinsatz', 'warning'],
    ['Niederflur', 'info'],
    ['WLAN verfügbar', null],
    ['Barrierefreies Fahrzeug', null],
    ['Etwas Neues', null],
  ]);
  assert.deepEqual(said(rt.stationNotes.get(timetable.stopIndex.get('SA'))), [['Bahnsteig gesperrt', 'warning'], ['Aufzug außer Betrieb', 'info']]);
  // and so they are handed out
  assert.deepEqual(said(timetable.trip('T1', DAY, rt).notes).slice(0, 2), [['Reparatur an der Strecke', 'severe'], ['Verspätetes Personal aus vorheriger Fahrt', 'warning']]);
  // A board says of each departure what is wrong with its trip, and nothing else of the trip's notes.
  assert.deepEqual(
    timetable.departures('SA', at('09:58'), rt).departures.map((d) => [d.line, said(d.warnings)]),
    [['U1', [['Reparatur an der Strecke', 'severe'], ['Verspätetes Personal aus vorheriger Fahrt', 'warning'], ['Polizeieinsatz', 'warning']]]],
  );
  assert.deepEqual(timetable.departures('SA', at('09:58'), null).departures.map((d) => d.warnings), [[]]);
});

test('negative delays, skipped stops, cancellations and stale updates', () => {
  const decode = (tripUpdates) => buildRealtime(timetable, decodeFeed(encodeFeed({ timestamp: 1, tripUpdates })));
  const t1 = timetable.tripIndex.get('T1');
  const t2 = timetable.tripIndex.get('T2');

  // early at B (negative int32 on the wire), then NO_DATA at C
  let rt = decode([{ tripId: 'T1', startDate: DAY, stops: [{ seq: 1, stopId: 'B', arr: { delay: -90 }, dep: { delay: -30 } }, { seq: 2, stopId: 'C', rel: 2 }] }]);
  let delays = rt.byDate.get(DAY).get(t1);
  assert.deepEqual(delays.arrDelay, [null, -90, null]);
  assert.deepEqual(delays.depDelay, [null, -30, null]);

  // the ICE skips B: it still runs, but B is flagged
  rt = decode([{ tripId: 'T2', startDate: DAY, stops: [{ seq: 0, stopId: 'X', dep: { delay: 120 } }, { seq: 1, stopId: 'B', rel: 1 }] }]);
  delays = rt.byDate.get(DAY).get(t2);
  assert.deepEqual([...delays.skipped], [0, 1, 0]);
  assert.equal(delays.cancelled, false);
  assert.deepEqual(delays.arrDelay, [120, 120, 120]);
  assert.equal(timetable.departures('B', at('09:59'), rt).departures.find((d) => d.line === 'ICE 5').cancelled, true);

  // every stop skipped = cancelled: no vehicle on the map
  rt = decode([{ tripId: 'T1', startDate: DAY, stops: [0, 1, 2].map((seq) => ({ seq, stopId: 'ABC'[seq], rel: 1 })) }]);
  assert.equal(rt.byDate.get(DAY).get(t1).cancelled, true);
  assert.ok(!timetable.vehicles(at('10:05'), rt).some((v) => v.id === `T1_${DAY}`));

  // update from another timetable version (stop does not match) or for a day without service: ignored
  rt = decode([
    { tripId: 'T1', startDate: DAY, stops: [{ seq: 0, stopId: 'C', dep: { delay: 60 } }] },
    { tripId: 'T1', startDate: '20261005', stops: [{ seq: 0, stopId: 'A', dep: { delay: 60 } }] },
  ]);
  assert.equal(rt.matched, 0);
});
