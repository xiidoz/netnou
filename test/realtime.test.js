// The RealtimePoller against a local feed server that takes its time, and the
// thread it has read the feed. What becomes of a feed is covered by
// pipeline.test.js and server.test.js.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { datasetFrom, loadDataset, writeDataset } from '../server/lib/dataset.js';
import { packDataset } from '../server/lib/importer.js';
import { RealtimePoller } from '../server/lib/realtime.js';
import { serviceDayStart } from '../server/lib/time.js';
import { Timetable } from '../server/lib/timetable.js';
import { encodeFeed } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, what) {
  for (let waited = 0; !condition(); waited += 5) {
    assert.ok(waited < 10_000, `timed out waiting for ${what}`);
    await sleep(5);
  }
}

const DAY = '20261003';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-realtime-'));
/**
 * A timetable as the server has it: its dataset in a file, and that in memory
 * which the thread that reads the feed shares. One trip from A to B to C,
 * leaving at 10:00, 10:10 and 10:20.
 */
function load(name, tripId = 'T1') {
  const file = path.join(dir, `${name}.bin`);
  writeDataset(file, packDataset({
    stops: { id: ['A', 'B', 'C'], name: ['Alpha', 'Beta', 'Gamma'], lat: [49.4, 49.41, 49.42], lon: [11, 11.01, 11.02], parent: [-1, -1, -1], platform: ['', '', ''], region: [1, 1, 1] },
    routes: { id: ['R'], short: ['1'], long: [''], type: [3], color: [''], text: [''], agency: ['Testbetrieb'] },
    headsigns: ['Gamma'],
    dates: [DAY],
    services: [[0]],
    trips: { id: [tripId], route: [0], service: [0], headsign: [0], stops: [[0, 1, 2]], arr: [[36000, 36600, 37200]], dep: [[36000, 36600, 37200]], seq: [null] },
  }));
  const shared = loadDataset(file);
  return new Timetable(datasetFrom(shared), shared);
}
let timetable = load('first');

// The feed: two minutes late from B on, and a note on the trip.
const FEED = encodeFeed({
  timestamp: 1791148698,
  tripUpdates: [{ tripId: 'T1', startDate: DAY, stops: [{ seq: 1, stopId: 'B', arr: { delay: 120 } }] }],
  alerts: [{ tripId: 'T1', text: 'Umleitung' }],
});
const upstream = { requests: 0, answers: 0, agents: [], delay: 0, status: 200 };
const server = http.createServer((req, res) => {
  upstream.requests++;
  upstream.agents.push(req.headers['user-agent']);
  setTimeout(() => {
    res.writeHead(upstream.status);
    res.end(FEED, () => { upstream.answers++; });
  }, upstream.delay);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/realtime.pb`;
const pollers = [];
after(() => {
  for (const instance of pollers) {
    clearInterval(instance.timer);
    instance.reset();
  }
  server.close();
  server.closeAllConnections();
  fs.rmSync(dir, { recursive: true, force: true });
});

function poller(options) {
  Object.assign(upstream, { requests: 0, answers: 0, agents: [], delay: 0, status: 200 });
  const lines = [];
  const instance = new RealtimePoller({ url, getTimetable: () => timetable, log: (line) => lines.push(line), userAgent: 'Netnou/test', ...options });
  pollers.push(instance);
  return { instance, lines, stop: () => clearInterval(instance.timer) };
}

test('a fetch that takes longer than the interval is waited for, and the turns in between are left out', async () => {
  const { instance, lines, stop } = poller({ intervalMs: 40, idleMs: 60_000 });
  upstream.delay = 600;
  instance.touch();
  await until(() => upstream.requests, 'the request');
  await sleep(200);
  // No further turns from here on: one that came right after the answer would
  // begin a fetch of its own, which this test and the next would trip over.
  stop();
  // several turns have come and gone, and the first fetch is still the only one
  assert.equal(upstream.requests, 1);
  assert.equal(instance.status.fetches, 1);
  assert.equal(instance.snapshot, null);
  await until(() => instance.snapshot, 'the slow answer');
  assert.equal(instance.status.feedTimestamp, 1791148698);
  assert.equal(instance.status.error, null);
  assert.deepEqual([instance.status.fetches, instance.status.failures], [1, 0]);
  assert.deepEqual(upstream.agents, ['Netnou/test']);
  assert.deepEqual(lines, ['Realtime: polling started']);

  // What the thread made of the feed, against the timetable it shares with
  // this one: the trip is late from B on, and has its note.
  assert.equal(instance.status.matchedTrips, 1);
  const trip = timetable.trip('T1', DAY, instance.snapshot);
  assert.deepEqual(trip.stops.map((stop) => [stop.name, stop.arr - serviceDayStart(DAY), stop.arrDelay]), [['Alpha', 36000, null], ['Beta', 36600, 120], ['Gamma', 37200, 120]]);
  assert.deepEqual([trip.realtime, trip.cancelled, trip.notes], [true, false, [{ title: null, text: 'Umleitung' }]]);
  assert.equal(timetable.trip('T1', DAY, null).stops[1].arrDelay, null);
});

test('a failed fetch is counted and named, and the next turn tries again', async () => {
  const { instance, lines, stop } = poller({ intervalMs: 200, idleMs: 60_000 });
  upstream.status = 503;
  instance.touch();
  await until(() => instance.status.failures, 'the failure');
  assert.match(instance.status.error, /^GET http:\/\/127\.0\.0\.1:\d+\/realtime\.pb: HTTP 503$/);
  assert.equal(lines.at(-1), `Realtime: update failed: ${instance.status.error}`);
  assert.equal(instance.snapshot, null);

  upstream.status = 200;
  await until(() => instance.snapshot, 'the next turn');
  stop();
  assert.equal(instance.status.error, null);
  assert.deepEqual([instance.status.fetches, instance.status.failures], [2, 1]);
});

test('pausing ends the thread and its fetch, and nothing of it is used', async () => {
  const { instance, lines } = poller({ intervalMs: 50, idleMs: 150 });
  upstream.delay = 1500;
  // Somebody is looking until the thread is up and has asked for the feed,
  // however long a machine takes to start it, and then no more.
  for (let waited = 0; !upstream.requests; waited += 10) {
    assert.ok(waited < 20_000, 'timed out waiting for the request');
    instance.touch();
    await sleep(10);
  }
  assert.notEqual(instance.thread, null);
  await until(() => !instance.status.polling, 'the pause');
  assert.equal(instance.thread, null);
  // (long enough for the answer to have come, had anybody waited for it)
  await sleep(1700);
  assert.equal(upstream.requests, 1);
  assert.equal(instance.timer, null);
  assert.equal(instance.snapshot, null);
  assert.deepEqual([instance.status.fetchedAt, instance.status.error, instance.status.failures], [null, null, 0]);
  assert.deepEqual(lines, ['Realtime: polling started', 'Realtime: no requests any more, polling paused']);
});

test('a new timetable gets a thread of its own, and a thread that ends is replaced', async () => {
  const { instance, lines, stop } = poller({ intervalMs: 50, idleMs: 60_000 });
  instance.touch();
  await until(() => instance.snapshot, 'the first answer');
  const first = instance.thread;
  assert.equal(first.timetable, timetable);
  assert.equal(instance.snapshot.matched, 1);

  // Another timetable, in which the trip of the feed is not: as the server
  // does it, the timetable is replaced and the poller told.
  const before = timetable;
  timetable = load('second', 'T2');
  instance.reset();
  try {
    assert.equal(instance.snapshot, null);
    await until(() => instance.snapshot, 'an answer for the new timetable');
    assert.notEqual(instance.thread, first);
    assert.equal(instance.thread.timetable, timetable);
    assert.equal(instance.snapshot.matched, 0);
    assert.equal(timetable.trip('T2', DAY, instance.snapshot).realtime, false);

    // Its thread ends without having been told to: that is a failed fetch at
    // most, and the next turn has a new one.
    const lost = instance.thread;
    await lost.worker.terminate();
    await until(() => instance.thread && instance.thread !== lost, 'another thread');
    const fetches = instance.status.fetches;
    await until(() => instance.status.fetches > fetches + 1 && instance.status.error === null, 'a fetch by it');
    assert.equal(instance.snapshot.matched, 0);
    assert.ok(instance.status.failures <= 1);
    assert.ok(lines.every((line) => line === 'Realtime: polling started' || /^Realtime: update failed: the thread that reads the feed stopped/.test(line)), lines.join('\n'));
  } finally {
    stop();
    timetable = before;
  }
});
