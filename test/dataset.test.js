// The dataset as a file, and the lists in it of which every different one is
// stored once.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { SharedLists, Texts, byteOrder, datasetFrom, loadDataset, readDataset, writeDataset } from '../server/lib/dataset.js';
import { packDataset } from '../server/lib/importer.js';
import { Timetable } from '../server/lib/timetable.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-dataset-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('a dataset is read as it was written: columns, texts, long lists and what is small', () => {
  const names = Array.from({ length: 200 }, (_, i) => (i % 7 ? `Haltestelle ${i}, Süd` : ''));
  const data = {
    version: 6,
    area: null,
    source: { etag: '"v1"', osm: null },
    numbers: Int32Array.from([3, -1, 2 ** 31 - 1]),
    positions: Float64Array.from([49.45, 11.0767, -0.5]),
    marks: Uint8Array.from([1, 0, 255]),
    none: new Int32Array(0),
    ids: Texts.from(['T1', 'Zug 😀', '', 'Ölberg']),
    names,
    few: ['a', 'b'],
    withBreak: Array.from({ length: 100 }, (_, i) => `two\nlines ${i}`),
    nested: { services: [[0, 1], []], segments: null },
  };
  const file = path.join(dir, 'round.bin');
  writeDataset(file, data);
  const read = readDataset(file);

  assert.deepEqual(read.numbers, data.numbers);
  assert.ok(read.numbers instanceof Int32Array && read.positions instanceof Float64Array && read.marks instanceof Uint8Array);
  assert.deepEqual(read.positions, data.positions);
  assert.deepEqual(read.marks, data.marks);
  assert.equal(read.none.length, 0);
  assert.deepEqual([...read.ids], ['T1', 'Zug 😀', '', 'Ölberg']);
  assert.equal(read.ids.get(3), 'Ölberg');
  assert.deepEqual(read.names, names);
  assert.deepEqual(read.few, ['a', 'b']);
  assert.deepEqual(read.withBreak, data.withBreak);
  assert.deepEqual([read.version, read.area, read.source, read.nested], [6, null, data.source, data.nested]);
  // nothing is left of the writing but the file
  assert.deepEqual(fs.readdirSync(dir), ['round.bin']);

  // Of the long lists of texts only those that are named, where not all are
  // wanted: the others are null. What is in the head of the file is there
  // all the same: a short list, and one whose texts have line breaks.
  const none = datasetFrom(loadDataset(file), { lists: [] });
  assert.deepEqual([none.names, none.withBreak, none.few], [null, data.withBreak, ['a', 'b']]);
  assert.deepEqual([[...none.ids], [...none.numbers]], [[...data.ids], [...data.numbers]]);
  assert.deepEqual(datasetFrom(loadDataset(file), { lists: ['names'] }).names, names);

  // what is no dataset, or only the beginning of one, is refused
  fs.writeFileSync(path.join(dir, 'other.bin'), 'something else entirely, and long enough to hold a head');
  assert.throws(() => readDataset(path.join(dir, 'other.bin')), /not a dataset/);
  fs.writeFileSync(path.join(dir, 'cut.bin'), fs.readFileSync(file).subarray(0, fs.statSync(file).size - 40));
  assert.throws(() => readDataset(path.join(dir, 'cut.bin')), /cut short/);
  fs.rmSync(path.join(dir, 'other.bin'));
  fs.rmSync(path.join(dir, 'cut.bin'));
});

test('a dataset is loaded into memory that threads share, and each lays its own over it', async () => {
  const file = path.join(dir, 'shared.bin');
  writeDataset(file, { version: 7, counts: Int32Array.from([1, 2, 3]), ids: Texts.from(['A', 'Ölberg']), names: Array.from({ length: 80 }, (_, i) => `Halt ${i}`) });
  const shared = loadDataset(file);
  assert.ok(shared instanceof SharedArrayBuffer);
  const mine = datasetFrom(shared);
  assert.deepEqual([[...mine.counts], [...mine.ids], mine.names.length], [[1, 2, 3], ['A', 'Ölberg'], 80]);
  assert.equal(mine.counts.buffer, shared);
  // Another thread reads the same and writes into it: this one sees that, for
  // there is one memory and no copy of it. It does without the list of names.
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.module).then(({ datasetFrom }) => {
      const theirs = datasetFrom(workerData.shared, { lists: [] });
      const seen = { counts: [...theirs.counts], ids: [...theirs.ids], names: theirs.names };
      theirs.counts[1] = 20;
      parentPort.postMessage(seen);
    });`, { eval: true, workerData: { shared, module: new URL('../server/lib/dataset.js', import.meta.url).href } });
  const seen = await new Promise((resolve, reject) => worker.once('message', resolve).once('error', reject));
  assert.deepEqual(seen, { counts: [1, 2, 3], ids: ['A', 'Ölberg'], names: null });
  assert.deepEqual([...mine.counts], [1, 20, 3]);
  await worker.terminate();
  // (read the plain way, a dataset is this thread's alone)
  assert.ok(!(readDataset(file).counts.buffer instanceof SharedArrayBuffer));
  fs.rmSync(file);
});

test('whether a text is a given one is told without making a string of it', () => {
  const texts = Texts.from(['de:09564:704', 'Ölberg', '', 'Zug 😀', 'é']);
  for (const [i, text] of ['de:09564:704', 'Ölberg', '', 'Zug 😀', 'é'].entries()) assert.ok(texts.is(i, text), text);
  assert.ok(!texts.is(0, 'de:09564:705'));
  assert.ok(!texts.is(0, 'de:09564:70'));
  assert.ok(!texts.is(0, ''));
  assert.ok(!texts.is(2, 'x'));
  assert.ok(!texts.is(1, 'Olberg'));
  // as many characters as the other has bytes, and the same ones byte for byte: still another text
  assert.ok(!texts.is(4, 'Ã©'));
  assert.ok(!texts.is(1, 'Ã\u0096lberg'));
});

test('a text is found among texts in the order of their bytes', () => {
  // (the last two are where plain "<" and the bytes disagree)
  const ids = ['10', '9', 'Zug', 'a', 'ä', 'Ölberg', '', '😀', ''].sort(byteOrder);
  assert.deepEqual(ids, ['', '10', '9', 'Zug', 'a', 'Ölberg', 'ä', '', '😀']);
  const texts = Texts.from(ids);
  ids.forEach((id, i) => assert.equal(texts.indexOf(id), i, id));
  for (const missing of ['1', '99', 'b', 'Zug ', '😁']) assert.equal(texts.indexOf(missing), -1, missing);
  assert.equal(Texts.from([]).indexOf('a'), -1);
});

test('a list is stored once, and two lists with the same hash stay two', () => {
  for (const options of [{}, { hash: () => 7 }, { hash: (numbers) => numbers[0] }]) {
    const lists = new SharedLists(options);
    const scratch = Int32Array.from([1, 2, 3, 99]);
    const a = lists.add(scratch, 3);
    const b = lists.add([1, 2, 4], 3);
    const c = lists.add([1, 2], 2);
    const empty = lists.add([], 0);
    assert.deepEqual([lists.add([1, 2, 3], 3), lists.add([1, 2, 4], 3), lists.add(scratch, 2), lists.add([], 0)], [a, b, c, empty]);
    assert.equal(new Set([a, b, c, empty]).size, 4);
    const { start, values } = lists.done();
    const list = (i) => [...values.subarray(start[i], start[i + 1])];
    assert.deepEqual([list(a), list(b), list(c), list(empty)], [[1, 2, 3], [1, 2, 4], [1, 2], []]);
    assert.equal(start.length, 5);
  }
});

// Three trips of one line: two run the same way with the same running times
// an hour apart, the third takes longer.
const PLAIN = {
  stops: { id: ['A', 'B', 'C'], name: ['Alpha', 'Beta', 'Gamma'], lat: [49.4, 49.5, 49.6], lon: [11, 11, 11.1], parent: [-1, -1, -1], platform: ['', '', ''], region: [1, 1, 1] },
  routes: { id: ['R'], short: ['1'], long: [''], type: [3], color: [''], text: [''], agency: ['Testbetrieb'] },
  headsigns: ['Gamma'],
  dates: ['20261003'],
  services: [[0]],
  trips: {
    id: ['late', 'early', 'slow'],
    route: [0, 0, 0],
    service: [0, 0, 0],
    headsign: [0, 0, 0],
    stops: [[0, 1, 2], [0, 1, 2], [0, 1, 2]],
    arr: [[39600, 40200, 40800], [36000, 36600, 37200], [43200, 44000, 45000]],
    dep: [[39600, 40320, 40800], [36000, 36720, 37200], [43200, 44100, 45000]],
    seq: [null, null, [1, 5, 9]],
  },
};

test('trips that run the same way share their stop sequence, and those with the same running times these', () => {
  const data = packDataset(PLAIN);
  assert.equal(data.patterns.start.length - 1, 1);
  assert.equal(data.profiles.start.length - 1, 2);
  assert.deepEqual([...data.trips.pattern], [0, 0, 0]);
  assert.equal(data.trips.profile[0], data.trips.profile[1]);
  assert.notEqual(data.trips.profile[0], data.trips.profile[2]);
  assert.deepEqual([...data.trips.start], [39600, 36000, 43200]);
  // the trips stay in the order they were given in, and are found by their ids
  assert.deepEqual([...data.trips.id], ['late', 'early', 'slow']);
  assert.deepEqual([...data.trips.byId], [1, 0, 2]);

  const timetable = new Timetable(data);
  for (const [t, id] of PLAIN.trips.id.entries()) {
    assert.equal(timetable.tripIndex.get(id), t);
    assert.deepEqual([...timetable.stopsOf(t)], PLAIN.trips.stops[t]);
    assert.deepEqual([0, 1, 2].map((p) => timetable.schedArr(t, p)), PLAIN.trips.arr[t]);
    assert.deepEqual([0, 1, 2].map((p) => timetable.schedDep(t, p)), PLAIN.trips.dep[t]);
  }
  assert.deepEqual([0, 1, 2].map((p) => timetable.seq(2, p)), [1, 5, 9]);
  assert.deepEqual([0, 1, 2].map((p) => timetable.seq(0, p)), [0, 1, 2]);
  assert.equal(timetable.tripIndex.get('missing'), undefined);
  assert.equal(timetable.tripIndex.get(undefined), undefined);
  assert.ok(timetable.tripIndex.has('slow') && !timetable.tripIndex.has(''));
});

test('with every hash the same the trips are still what they were', () => {
  const data = packDataset({ ...PLAIN, trips: { ...PLAIN.trips, stops: [[0, 1, 2], [0, 2, 1], [0, 1, 2]] } }, { hash: () => 1 });
  assert.equal(data.patterns.start.length - 1, 2);
  assert.equal(data.profiles.start.length - 1, 2);
  const timetable = new Timetable(data);
  assert.deepEqual([0, 1, 2].map((t) => [...timetable.stopsOf(t)]), [[0, 1, 2], [0, 2, 1], [0, 1, 2]]);
  assert.deepEqual([0, 1, 2].map((t) => timetable.schedDep(t, 1)), [40320, 36720, 44100]);
});
