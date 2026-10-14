// Imports a GTFS feed as the server does and prints what it comes to: how
// many trips, how much of them repeats, how large the dataset is in the file
// and in memory, and how long the server takes to say which vehicles are
// under way. For judging what a machine has to have for an area, and for
// seeing what a change to the import or the timetable does.
//
//   node tools/measure-feed.mjs <feed.zip> [VGN | Germany | south,west,north,east] [operators]
//
// The second word is the area as NETNOU_AREA or NETNOU_BBOX gives it, without
// one it is the VGN; Germany is everything the feed has. The operators are names as agency.txt of the
// feed has them, separated by commas. Route geometry is left out: it needs
// OpenStreetMap data and is measured where that is routed.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, parseBox } from '../server/config.js';
import { readDataset, writeDataset } from '../server/lib/dataset.js';
import { buildDataset } from '../server/lib/importer.js';
import { addDays, serviceDayStart } from '../server/lib/time.js';
import { Timetable } from '../server/lib/timetable.js';

const [zipPath, where, operators] = process.argv.slice(2);
const box = where === undefined ? null : parseBox(where);
if (!zipPath || (where !== undefined && !box && !['vgn', 'germany'].includes(where.toLowerCase()))) {
  console.error('usage: node tools/measure-feed.mjs <feed.zip> [VGN | Germany | south,west,north,east] [operators]');
  process.exit(1);
}
// (as the server reads its settings: the built-in area unless something else is said)
const { area, agencies } = loadConfig({
  ...(box ? { NETNOU_BBOX: where } : where ? { NETNOU_AREA: where } : {}),
  ...(operators ? { NETNOU_AGENCIES: operators } : {}),
});

const megabytes = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;
const number = (n) => n.toLocaleString('en-US');
const seconds = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const timed = (fn) => {
  const start = performance.now();
  const result = fn();
  return [result, performance.now() - start];
};
const row = (what, value) => console.log(`${what.padEnd(46)} ${value}`);
const collect = () => globalThis.gc?.();

const start = performance.now();
const data = await buildDataset({ zipPath, area, agencies });
const importMs = performance.now() - start;
const tripCount = data.trips.pattern.length;
let stopTimes = 0;
for (let t = 0; t < tripCount; t++) stopTimes += data.patterns.start[data.trips.pattern[t] + 1] - data.patterns.start[data.trips.pattern[t]];

row('Trips', number(tripCount));
row('Stop times', number(stopTimes));
row('Stops, with stations and platforms', number(data.stops.id.length));
row('Stop sequences', `${number(data.patterns.start.length - 1)} with ${number(data.patterns.stops.length)} stops`);
row('Sets of running times', `${number(data.profiles.start.length - 1)} with ${number(data.profiles.times.length / 2)} pairs of times`);
row('Ways on which trains run coupled', number(data.sharedWays.start.length - 1));
row('Days of the timetable', `${data.dates.length}, ${data.dates[0]} to ${data.dates.at(-1)}`);
row('Import', `${seconds(importMs)}, ${megabytes(process.resourceUsage().maxRSS * 1024)} at its peak`);

const file = path.join(os.tmpdir(), `netnou-measure-${process.pid}.bin`);
try {
  const [, writeMs] = timed(() => writeDataset(file, data));
  row('Dataset as a file', `${megabytes(fs.statSync(file).size)}, written in ${seconds(writeMs)}`);
  collect();
  const before = process.memoryUsage();
  const [read, readMs] = timed(() => readDataset(file));
  const [timetable, buildMs] = timed(() => new Timetable(read));
  collect();
  const after = process.memoryUsage();
  row('Read again', `${seconds(readMs)}, and ${seconds(buildMs)} for what is worked out from it`);
  // (the columns lie outside the heap of JavaScript: both are counted)
  const held = after.heapUsed - before.heapUsed + (after.arrayBuffers - before.arrayBuffers);
  row('In memory', globalThis.gc ? megabytes(held) : `${megabytes(held)} (run with --expose-gc for a figure that can be trusted)`);
  row('Stations', number(timetable.stations.length));
  row('Lines', number(timetable.lines.length));

  // The busiest half hour of the day with the most trips.
  const busiest = data.dates.map((date) => [date, timetable.activeTrips(date).length]).sort((a, b) => b[1] - a[1])[0][0];
  let peak = { count: -1 };
  for (let half = 8; half < 52; half++) {
    const rel = half * 1800;
    const count = timetable.underWay(busiest, rel, null).length + timetable.underWay(addDays(busiest, -1), rel + 86400, null).length;
    if (count > peak.count) peak = { count, rel };
  }
  const now = serviceDayStart(busiest) + peak.rel;
  const clock = `${String(Math.floor(peak.rel / 3600)).padStart(2, '0')}:${String((peak.rel % 3600) / 60).padStart(2, '0')}`;
  timetable.vehicles(now, null);
  const runs = 10;
  const [vehicles, vehiclesMs] = timed(() => {
    let list;
    for (let i = 0; i < runs; i++) list = timetable.vehicles(now + i, null);
    return list;
  });
  row('Day with the most trips', `${busiest}, ${number(timetable.activeTrips(busiest).length)} trips`);
  row(`Vehicles under way at ${clock}`, number(vehicles.length));
  row('Working out which and where', `${(vehiclesMs / runs).toFixed(1)} ms`);
  const some = vehicles.slice(0, 500);
  const [, knotsMs] = timed(() => some.forEach((vehicle) => vehicle.knots));
  row(`Knots of ${some.length} of them`, `${knotsMs.toFixed(1)} ms`);
  const sectionOf = vehicles[Math.floor(vehicles.length / 2)];
  const [inSection, sectionMs] = timed(() => vehicles.filter((v) => Math.abs(v.lat - sectionOf.lat) < 0.15 && Math.abs(v.lon - sectionOf.lon) < 0.25));
  row('Picking those of a map section', `${sectionMs.toFixed(2)} ms for ${number(inSection.length)}`);
} finally {
  fs.rmSync(file, { force: true });
}
