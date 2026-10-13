// What one fetch of the realtime feed comes to, as the server keeps it: columns
// of numbers in place of a map with an object and its arrays for every trip.
// For all of Germany that is 10 MB where the maps were 170 MB, and it is what
// the thread that reads the feed hands to the one that answers requests
// (realtime-worker.js): the memory changes hands, nothing is copied. A
// Gathering fills the columns while the feed is read, a Snapshot reads them.
//
//   dates, dayStart   the service days with realtime data, in their order, and
//                     where the rows of each begin (and the last one ends)
//   trip              for each row its trip, as an index into the timetable;
//                     the rows of a day are in the order of their trips, so
//                     that a trip is found by looking through them
//   at                where the stops of a row begin in arr, dep and skip
//                     (and where those of the last row end)
//   first, last       the first and the last stop that is served
//   cancelled         1 if the trip does not run
//   arr, dep          for each stop the delay of the arrival and of the
//                     departure in seconds, NONE where nothing is known
//   skip              1 for a stop that is passed
//   noteBytes, noteStart  every note once, as JSON, one after the other
//   noteWarns         for each of these notes 1 if it warns (see warns)
//   tripNote…, stationNote…  the trips and the stations with notes, in their
//                     order (keys), and for each where its notes begin (start)
//                     in the list of them (ids, which point into the notes)
//   sourceKeys, sourceIds, sources  the trips whose realtime data names who
//                     provides it, and who that is

import { Numbers } from './dataset.js';

/** In the columns of delays: nothing is known for this stop. Delays are within six hours either way (realtime.js). */
const NONE = -32768;

/**
 * Whether a note warns: of what is wrong with a trip or a stop right now,
 * such as the reason for a delay. The notes realtime.js makes say how serious
 * the feed takes them (noteOf there); a note made of anything else does not
 * warn.
 */
const warns = (note) => note?.severity === 'warning' || note?.severity === 'severe';

/** Where `value` is in sorted[from … to - 1], or -1. */
function find(sorted, from, to, value) {
  let low = from;
  let high = to - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] === value) return middle;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

// What is kept of a stop while the feed is gathered: besides that it is
// passed, whether its delays are reported for the stop itself or only carried
// on from an earlier one. Coupled trains are brought into line by that.
const SKIPPED = 1;
const ARR_OWN = 2;
const DEP_OWN = 4;

/**
 * Gathers the realtime data of one fetch a trip at a time, in columns that
 * grow: what a trip update comes to is written down and let go of, so that
 * reading the feed of a whole country leaves no object for every trip behind.
 */
export class Gathering {
  constructor() {
    /** service date -> trip -> its row */
    this.rows = new Map();
    // of each row: where its stops begin and how many they are, the first
    // and last one served, and whether the trip is cancelled
    this.at = new Numbers(1 << 12);
    this.count = new Numbers(1 << 12);
    this.first = new Numbers(1 << 12);
    this.last = new Numbers(1 << 12);
    this.cancelled = new Numbers(1 << 12);
    // of each stop: the delays, and SKIPPED, ARR_OWN, DEP_OWN
    this.arr = new Numbers();
    this.dep = new Numbers();
    this.flags = new Numbers();
  }

  #row(date, t, count) {
    let rows = this.rows.get(date);
    if (!rows) this.rows.set(date, (rows = new Map()));
    let row = rows.get(t);
    if (row === undefined) {
      row = this.at.length;
      rows.set(t, row);
      for (const column of [this.at, this.count, this.first, this.last, this.cancelled]) column.push(0);
    }
    // (stops of its own at the end of the columns; a later word on a trip takes the place of an earlier one)
    this.at.array[row] = this.arr.length;
    this.count.array[row] = count;
    return row;
  }

  /**
   * Writes down what is known of trip t on a service day.
   * @param rt as tripDelays() in realtime.js gives it
   */
  put(date, t, { arrDelay, depDelay, arrReported, depReported, skipped, cancelled, first, last }) {
    const row = this.#row(date, t, arrDelay.length);
    this.first.array[row] = first;
    this.last.array[row] = last;
    this.cancelled.array[row] = cancelled ? 1 : 0;
    for (let p = 0; p < arrDelay.length; p++) {
      this.arr.push(arrDelay[p] ?? NONE);
      this.dep.push(depDelay[p] ?? NONE);
      this.flags.push((skipped?.[p] ? SKIPPED : 0) | (arrReported[p] ? ARR_OWN : 0) | (depReported[p] ? DEP_OWN : 0));
    }
  }

  /** A row for a trip of `count` stops of which nothing is known yet. */
  blank(date, t, count) {
    const row = this.#row(date, t, count);
    this.last.array[row] = count - 1;
    for (let p = 0; p < count; p++) {
      this.arr.push(NONE);
      this.dep.push(NONE);
      this.flags.push(0);
    }
    return row;
  }

  /**
   * What is known of the arrival at the stop at position p of a row, or of
   * the departure from it: [the delay or null, whether the feed reports it
   * for that stop itself].
   */
  report(row, p, arrival) {
    const k = this.at.array[row] + p;
    const delay = (arrival ? this.arr : this.dep).array[k];
    return [delay === NONE ? null : delay, (this.flags.array[k] & (arrival ? ARR_OWN : DEP_OWN)) !== 0];
  }

  /** Sets the delay of the arrival at a stop of a row, or of the departure from it. */
  agree(row, p, arrival, delay) {
    (arrival ? this.arr : this.dep).array[this.at.array[row] + p] = delay;
  }

  /**
   * All of it as the columns a Snapshot reads, the rows of each day in the
   * order of their trips.
   * @param notes { tripNotes, tripSources, stationNotes, matched } as buildRealtime() in realtime.js has them
   */
  columns({ tripNotes, tripSources, stationNotes, matched }) {
    const dates = [...this.rows.keys()].sort();
    let rows = 0;
    let stops = 0;
    for (const ofDay of this.rows.values()) {
      rows += ofDay.size;
      for (const row of ofDay.values()) stops += this.count.array[row];
    }
    const dayStart = new Int32Array(dates.length + 1);
    const trip = new Int32Array(rows);
    const at = new Int32Array(rows + 1);
    const first = new Int32Array(rows);
    const last = new Int32Array(rows);
    const cancelled = new Uint8Array(rows);
    const arr = new Int16Array(stops);
    const dep = new Int16Array(stops);
    const skip = new Uint8Array(stops);
    let r = 0;
    let k = 0;
    dates.forEach((date, d) => {
      dayStart[d] = r;
      const ofDay = this.rows.get(date);
      for (const t of Int32Array.from(ofDay.keys()).sort()) {
        const row = ofDay.get(t);
        const from = this.at.array[row];
        trip[r] = t;
        at[r] = k;
        first[r] = this.first.array[row];
        last[r] = this.last.array[row];
        cancelled[r] = this.cancelled.array[row];
        for (let p = 0; p < this.count.array[row]; p++, k++) {
          arr[k] = this.arr.array[from + p];
          dep[k] = this.dep.array[from + p];
          skip[k] = this.flags.array[from + p] & SKIPPED;
        }
        r++;
      }
    });
    dayStart[dates.length] = r;
    at[r] = k;

    // Every note once, whatever it is made of: as the JSON of it.
    const texts = [];
    const urgent = [];
    const known = new Map();
    const idOf = (note) => {
      const json = JSON.stringify(note);
      let id = known.get(json);
      if (id === undefined) {
        known.set(json, (id = texts.length));
        texts.push(Buffer.from(json));
        urgent.push(warns(note) ? 1 : 0);
      }
      return id;
    };
    /** A map from a number to a list of notes, as columns. */
    const lists = (map) => {
      const keys = Int32Array.from(map.keys()).sort();
      const start = new Int32Array(keys.length + 1);
      const ids = [];
      keys.forEach((key, i) => {
        start[i] = ids.length;
        for (const note of map.get(key)) ids.push(idOf(note));
      });
      start[keys.length] = ids.length;
      return { keys, start, ids: Int32Array.from(ids) };
    };
    const ofTrips = lists(tripNotes);
    const ofStations = lists(stationNotes);
    const noteStart = new Int32Array(texts.length + 1);
    texts.forEach((text, i) => { noteStart[i + 1] = noteStart[i] + text.length; });
    // (memory of its own, which can change hands: not a piece of the pool that Buffer.from cuts small buffers from)
    const noteBytes = new Uint8Array(noteStart[texts.length]);
    texts.forEach((text, i) => noteBytes.set(text, noteStart[i]));

    const sources = [];
    const sourceIndex = new Map();
    const sourceKeys = Int32Array.from(tripSources.keys()).sort();
    const sourceIds = Int32Array.from(sourceKeys, (t) => {
      const name = tripSources.get(t);
      if (!sourceIndex.has(name)) {
        sourceIndex.set(name, sources.length);
        sources.push(name);
      }
      return sourceIndex.get(name);
    });

    return {
      dates, dayStart, trip, at, first, last, cancelled, arr, dep, skip,
      noteBytes, noteStart, noteWarns: Uint8Array.from(urgent),
      tripNoteKeys: ofTrips.keys, tripNoteStart: ofTrips.start, tripNoteIds: ofTrips.ids,
      stationNoteKeys: ofStations.keys, stationNoteStart: ofStations.start, stationNoteIds: ofStations.ids,
      sourceKeys, sourceIds, sources,
      matched,
    };
  }
}

/** The memory of the columns, for handing them to another thread without a copy. */
export function memoryOf(columns) {
  return [...new Set(Object.values(columns).filter(ArrayBuffer.isView).map((column) => column.buffer))];
}

/**
 * The realtime data of one fetch, read from its columns. A trip with realtime
 * data on a service day has a row; what is known of it is asked for by that
 * row, and of its stops by their position in the trip.
 */
export class Snapshot {
  /** @param columns from Gathering.columns(), made in this thread or handed over by another */
  constructor(columns) {
    this.columns = columns;
    this.dates = columns.dates;
    /** For each row its trip. The rows of the day at place d are dayStart[d] to dayStart[d + 1] - 1. */
    this.trip = columns.trip;
    this.dayStart = columns.dayStart;
    /** For each row 1 if the trip does not run, and its first and last stop that is served. */
    this.cancelled = columns.cancelled;
    this.first = columns.first;
    this.last = columns.last;
    /** How many trips of the feed are trips of the timetable. */
    this.matched = columns.matched;
  }

  /**
   * The delays as maps, for whoever wants to look at them: service date ->
   * trip -> { arrDelay, depDelay: for each stop seconds or null; skipped:
   * for each stop 1 or 0, or null if none is passed; cancelled, first, last }.
   * Made from the columns each time it is asked for.
   */
  get byDate() {
    const { at, arr, dep, skip } = this.columns;
    return new Map(this.dates.map((date, d) => [date, new Map(Array.from({ length: this.dayStart[d + 1] - this.dayStart[d] }, (_, i) => {
      const r = this.dayStart[d] + i;
      const delays = (column) => Array.from(column.subarray(at[r], at[r + 1]), (delay) => (delay === NONE ? null : delay));
      const passed = skip.slice(at[r], at[r + 1]);
      return [this.trip[r], { arrDelay: delays(arr), depDelay: delays(dep), skipped: passed.includes(1) ? passed : null, cancelled: this.cancelled[r] === 1, first: this.first[r], last: this.last[r] }];
    }))]));
  }

  /** The place of a service day among those with realtime data, or -1. */
  day(date) {
    return this.dates.indexOf(date);
  }

  /** The row of trip t on the day at place d (see day), or -1 if nothing is known of it. */
  row(d, t) {
    return find(this.trip, this.dayStart[d], this.dayStart[d + 1], t);
  }

  /** The delay in seconds of the arrival at the stop at position p of the trip of row r; null if none is known. */
  arrDelay(r, p) {
    const delay = this.columns.arr[this.columns.at[r] + p];
    return delay === NONE ? null : delay;
  }

  /** The delay of the departure, likewise. */
  depDelay(r, p) {
    const delay = this.columns.dep[this.columns.at[r] + p];
    return delay === NONE ? null : delay;
  }

  /** Whether the trip of row r passes its stop at position p. */
  skipped(r, p) {
    return this.columns.skip[this.columns.at[r] + p] === 1;
  }

  /** @param warning only the notes that warn: the others are not even read */
  #notes(keys, start, ids, key, warning = false) {
    const i = find(keys, 0, keys.length, key);
    if (i < 0) return [];
    const { noteBytes, noteStart, noteWarns } = this.columns;
    const bytes = Buffer.from(noteBytes.buffer, noteBytes.byteOffset, noteBytes.byteLength);
    const of = ids.subarray(start[i], start[i + 1]);
    return Array.from(warning ? of.filter((id) => noteWarns[id] === 1) : of, (id) => JSON.parse(bytes.toString('utf8', noteStart[id], noteStart[id + 1])));
  }

  /** The notes on trip t: disruption reasons, vehicle features. */
  notesOfTrip(t) {
    return this.#notes(this.columns.tripNoteKeys, this.columns.tripNoteStart, this.columns.tripNoteIds, t);
  }

  /** Those of the notes on trip t that warn: what is wrong with it right now, such as the reason for a delay. */
  warningsOfTrip(t) {
    return this.#notes(this.columns.tripNoteKeys, this.columns.tripNoteStart, this.columns.tripNoteIds, t, true);
  }

  /** The notes on a station, e.g. broken lifts. */
  notesOfStation(station) {
    return this.#notes(this.columns.stationNoteKeys, this.columns.stationNoteStart, this.columns.stationNoteIds, station);
  }

  /** Who provides the realtime data of trip t, or null where the feed does not say. */
  sourceOf(t) {
    const { sourceKeys, sourceIds, sources } = this.columns;
    const i = find(sourceKeys, 0, sourceKeys.length, t);
    return i < 0 ? null : sources[sourceIds[i]];
  }
}
