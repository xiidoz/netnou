// The realtime data of one fetch in columns (server/lib/snapshot.js): what is
// gathered a trip at a time is what is read, also after it has changed hands
// between threads.

import assert from 'node:assert/strict';
import test from 'node:test';
import { Gathering, Snapshot, memoryOf } from '../server/lib/snapshot.js';

/** What tripDelays() gives for a trip: its delays, what of them is reported for the stop itself, and the rest. */
const delays = (arrDelay, depDelay, more = {}) => ({
  arrDelay, depDelay, arrReported: Uint8Array.from(arrDelay, (delay) => (delay === null ? 0 : 1)), depReported: new Uint8Array(arrDelay.length), skipped: null, cancelled: false, first: 0, last: arrDelay.length - 1, ...more,
});
const NOTES = { tripNotes: new Map(), tripSources: new Map(), stationNotes: new Map(), matched: 0 };

test('what is gathered of the trips is what is read, by day and trip', () => {
  const gathered = new Gathering();
  // trips in no order, on two days, the same trip on both
  gathered.put('20261004', 70, delays([null, 60, 60], [0, 60, 90]));
  gathered.put('20261003', 900, delays([null, -120], [null, -90]));
  gathered.put('20261004', 3, delays([null, null, null, null], [null, null, null, null], { skipped: Uint8Array.from([1, 1, 1, 1]), cancelled: true }));
  gathered.put('20261003', 70, delays([21600, -21600, null], [null, 21600, -21600], { skipped: Uint8Array.from([0, 0, 1]), first: 0, last: 1 }));
  const snapshot = new Snapshot(gathered.columns({ ...NOTES, matched: 4 }));
  assert.deepEqual([snapshot.dates, snapshot.matched], [['20261003', '20261004'], 4]);
  assert.deepEqual([snapshot.day('20261003'), snapshot.day('20261004'), snapshot.day('20261005')], [0, 1, -1]);
  // the rows of a day are in the order of their trips
  assert.deepEqual([[...snapshot.trip], [...snapshot.dayStart]], [[70, 900, 3, 70], [0, 2, 4]]);
  assert.deepEqual([snapshot.row(0, 70), snapshot.row(0, 900), snapshot.row(1, 3), snapshot.row(1, 70)], [0, 1, 2, 3]);
  // a trip of which nothing is known has no row: on the other day, between two others, before and after them all
  assert.deepEqual([snapshot.row(0, 3), snapshot.row(1, 900), snapshot.row(0, 71), snapshot.row(0, 0), snapshot.row(0, 1e9)], [-1, -1, -1, -1, -1]);

  // delays up to six hours either way, and none
  const row = snapshot.row(0, 70);
  assert.deepEqual([0, 1, 2].map((p) => [snapshot.arrDelay(row, p), snapshot.depDelay(row, p), snapshot.skipped(row, p)]), [[21600, null, false], [-21600, 21600, false], [null, -21600, true]]);
  assert.deepEqual([snapshot.cancelled[row], snapshot.first[row], snapshot.last[row]], [0, 0, 1]);
  const gone = snapshot.row(1, 3);
  assert.deepEqual([snapshot.cancelled[gone], snapshot.skipped(gone, 3), snapshot.arrDelay(gone, 0)], [1, true, null]);
  assert.deepEqual([snapshot.arrDelay(snapshot.row(1, 70), 2), snapshot.depDelay(snapshot.row(1, 70), 0)], [60, 0]);

  // the same as maps, for looking at
  const maps = snapshot.byDate;
  assert.deepEqual([...maps.keys()], ['20261003', '20261004']);
  assert.deepEqual([...maps.get('20261003').keys()], [70, 900]);
  assert.deepEqual(maps.get('20261003').get(70), { arrDelay: [21600, -21600, null], depDelay: [null, 21600, -21600], skipped: Uint8Array.from([0, 0, 1]), cancelled: false, first: 0, last: 1 });
  assert.deepEqual(maps.get('20261003').get(900), { arrDelay: [null, -120], depDelay: [null, -90], skipped: null, cancelled: false, first: 0, last: 1 });
  assert.equal(maps.get('20261004').get(3).cancelled, true);
});

test('a later word on a trip takes the place of an earlier one, and coupled trains are brought into line', () => {
  const gathered = new Gathering();
  gathered.put('20261003', 5, delays([null, 30], [0, 30]));
  gathered.put('20261003', 6, delays([null, 120, 120], [60, 120, 120]));
  gathered.put('20261003', 5, delays([null, 300], [240, 300]));
  const rows = gathered.rows.get('20261003');
  assert.deepEqual([rows.get(5), rows.get(6), rows.get(9), gathered.rows.get('20261004')], [0, 1, undefined, undefined]);
  // what is reported for the stop itself, and what is only carried on
  assert.deepEqual([gathered.report(0, 1, 1), gathered.report(0, 0, 1), gathered.report(0, 0, 0)], [[300, true], [null, false], [240, false]]);
  // a trip the feed has no word on gets a row without anything, and then what the others say for one end of a way
  const blank = gathered.blank('20261003', 9, 3);
  assert.deepEqual([gathered.report(blank, 1, 1), gathered.report(blank, 1, 0)], [[null, false], [null, false]]);
  gathered.agree(blank, 1, 1, 120);
  assert.equal(rows.get(9), blank);
  gathered.agree(rows.get(6), 0, 0, -30);
  const snapshot = new Snapshot(gathered.columns(NOTES));
  assert.deepEqual([...snapshot.trip], [5, 6, 9]);
  const maps = snapshot.byDate.get('20261003');
  assert.deepEqual([maps.get(5).arrDelay, maps.get(5).depDelay], [[null, 300], [240, 300]]);
  assert.deepEqual([maps.get(6).depDelay, maps.get(9).arrDelay, maps.get(9).depDelay], [[-30, 120, 120], [null, 120, null], [null, null, null]]);
  assert.deepEqual([maps.get(9).cancelled, maps.get(9).first, maps.get(9).last], [false, 0, 2]);
});

test('notes are kept once each, whatever they are made of, and found by trip and station', () => {
  const long = 'Wegen einer Baustelle fährt die Linie eine Umleitung. – «Ölberg» entfällt 😀\nErsatz: Linie 5';
  const note = { title: 'Aufzug defekt', text: 'Der Aufzug zu Gleis 2 ist außer Betrieb.' };
  const columns = new Gathering().columns({
    tripNotes: new Map([[40, [long, 'Niederflur']], [7, ['Niederflur']], [1000000, [note]]]),
    tripSources: new Map([[40, 'VAG'], [7, 'DB Regio AG'], [8, 'VAG']]),
    stationNotes: new Map([[12, [note, long]]]),
    matched: 0,
  });
  // (as another thread gets it: the memory of the columns, and a copy of what is small)
  const memory = memoryOf(columns);
  assert.ok(memory.length > 5 && memory.every((buffer) => buffer instanceof ArrayBuffer) && new Set(memory).size === memory.length);
  const snapshot = new Snapshot(structuredClone(columns, { transfer: memory }));
  assert.equal(columns.noteBytes.byteLength, 0);
  assert.deepEqual([snapshot.notesOfTrip(40), snapshot.notesOfTrip(7), snapshot.notesOfTrip(1000000), snapshot.notesOfTrip(8)], [[long, 'Niederflur'], ['Niederflur'], [note], []]);
  assert.deepEqual([snapshot.notesOfStation(12), snapshot.notesOfStation(40)], [[note, long], []]);
  assert.deepEqual([40, 7, 8, 9].map((t) => snapshot.sourceOf(t)), ['VAG', 'DB Regio AG', 'VAG', null]);
  // three different notes, each once
  assert.equal(snapshot.columns.noteStart.length, 4);
  assert.deepEqual(snapshot.columns.sources, ['DB Regio AG', 'VAG']);
  // and no trip has realtime data
  assert.deepEqual([snapshot.dates, snapshot.day('20261003'), snapshot.byDate.size], [[], -1, 0]);
});
