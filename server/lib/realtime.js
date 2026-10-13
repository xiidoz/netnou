// Polls the GTFS-Realtime feed and turns its TripUpdates into per-stop delays
// for the trips of the timetable. Fetching, reading and matching happen in a
// thread of their own (realtime-worker.js), which is told from here when.

import { Worker } from 'node:worker_threads';
import { reason } from './files.js';
import { Gathering, Snapshot } from './snapshot.js';
import { serviceDayStart, timeZone } from './time.js';

const REL_SKIPPED = 1;
const REL_NO_DATA = 2;
const TRIP_CANCELED = 3;
// A predicted time this far from the schedule means the update belongs to a
// different timetable version, not to a late vehicle.
const MAX_PLAUSIBLE_DELAY_S = 6 * 3600;
// When fetching fails the last delays are kept until they are this old. The
// page calls realtime data "live" up to the same age (LIVE_MAX_AGE_S in
// public/app.js).
const STALE_AFTER_S = 180;

function eventDelay(event, scheduled) {
  if (!event) return null;
  const delay = event.time !== null ? event.time - scheduled : event.delay;
  return delay === null || Math.abs(delay) > MAX_PLAUSIBLE_DELAY_S ? null : delay;
}

/**
 * Per-stop delays of one trip, following the GTFS-Realtime rule that a delay
 * carries forward to later stops until the next update. Returns null if the
 * update does not fit the timetable (stop ids differ – e.g. during the daily
 * switch to a new static feed).
 */
export function tripDelays(timetable, t, date, update) {
  const stops = timetable.stopsOf(t);
  const n = stops.length;
  const base = serviceDayStart(date);
  const updates = update.stopTimeUpdates.filter((u) => u.seq !== null).sort((a, b) => a.seq - b.seq);

  const arrDelay = new Array(n).fill(null);
  const depDelay = new Array(n).fill(null);
  // Which of them the feed reports for that stop itself, as opposed to those
  // carried on from an earlier stop or taken from the other event of the stop.
  const arrReported = new Uint8Array(n);
  const depReported = new Uint8Array(n);
  let skipped = null;
  let skippedCount = 0;
  let carried = null;
  let u = 0;

  for (let p = 0; p < n; p++) {
    const seq = timetable.seq(t, p);
    while (u < updates.length && updates[u].seq < seq) u++;
    const stu = u < updates.length && updates[u].seq === seq ? updates[u] : null;

    if (stu) {
      if (stu.stopId && !timetable.stops.id.is(stops[p], stu.stopId)) return null;
      if (stu.rel === REL_NO_DATA) {
        carried = null;
        continue;
      }
      if (stu.rel === REL_SKIPPED) {
        (skipped ??= new Uint8Array(n))[p] = 1;
        skippedCount++;
      } else {
        const dep = eventDelay(stu.dep, base + timetable.schedDep(t, p));
        const reached = eventDelay(stu.arr, base + timetable.schedArr(t, p));
        const arr = reached ?? carried ?? dep;
        if (reached !== null) arrReported[p] = 1;
        if (dep !== null) depReported[p] = 1;
        arrDelay[p] = arr;
        depDelay[p] = carried = dep ?? arr;
        continue;
      }
    }
    arrDelay[p] = depDelay[p] = carried;
  }

  const cancelled = update.trip.rel === TRIP_CANCELED || skippedCount === n;
  let first = 0;
  let last = n - 1;
  if (skipped && !cancelled) {
    while (skipped[first]) first++;
    while (skipped[last]) last--;
  }
  return { arrDelay, depDelay, arrReported, depReported, skipped, cancelled, first, last };
}

/**
 * The delay that counts for all the portions of a coupled train, at one end
 * of a way they share. What the feed reports for that stop itself counts
 * before what is only carried on from an earlier stop: with any of the first
 * kind, the others are left out. Of those that count, it is the delay most
 * of them have – and the largest one, where as many have one as the other.
 * @param reports one per portion: [delay or null, whether it is reported for the stop itself]
 * @returns the delay, or null if nothing is known of any of them
 */
export function agreedDelay(reports) {
  const known = reports.filter(([delay]) => delay !== null);
  const own = known.filter(([, reported]) => reported);
  const counts = new Map();
  for (const [delay] of own.length ? own : known) counts.set(delay, (counts.get(delay) ?? 0) + 1);
  let agreed = null;
  let most = 0;
  for (const [delay, count] of counts) {
    if (count > most || (count === most && delay > agreed)) {
      agreed = delay;
      most = count;
    }
  }
  return agreed;
}

/**
 * Trains that run coupled are a trip each, in the timetable and in the feed,
 * and the feed may report a delay for one of them and not for the others. One
 * train cannot be at two places: on every way they share, all of them get
 * the same delay at either end (see agreedDelay). A portion the feed has no
 * word on gets what the others say for that way, and nothing else.
 * @param gathered the delays of all trips (a Gathering), changed in place
 */
function shareDelays(timetable, gathered) {
  for (const [date, rows] of gathered.rows) {
    for (const way of timetable.sharedWays) {
      // (no word on any of them: nothing to share)
      if (!way.some(([t]) => rows.has(t))) continue;
      const running = way.filter(([t]) => timetable.runsOn(t, date) && !(rows.has(t) && gathered.cancelled.array[rows.get(t)]));
      if (running.length < 2) continue;
      // The two ends of a way: the departure from the stop it begins at (0), the arrival at the next one (1).
      for (const arrival of [0, 1]) {
        const agreed = agreedDelay(running.map(([t, p]) => (rows.has(t) ? gathered.report(rows.get(t), p + arrival, arrival) : [null, false])));
        if (agreed === null) continue;
        for (const [t, p] of running) gathered.agree(rows.get(t) ?? gathered.blank(date, t, timetable.stopCount(t)), p + arrival, arrival, agreed);
      }
    }
  }
}

/**
 * Takes one trip update of the feed: if it is for a trip of the timetable on
 * a day it runs, and fits it, its delays are written down.
 * @param gathered a Gathering
 * @returns whether it was
 */
export function takeTripUpdate(timetable, gathered, update) {
  const t = timetable.tripIndex.get(update.trip.tripId);
  const date = update.trip.startDate;
  if (t === undefined || !date || !timetable.runsOn(t, date)) return false;
  const rt = tripDelays(timetable, t, date, update);
  if (!rt) return false;
  gathered.put(date, t, rt);
  return true;
}

// gtfs.de names the provider of a trip's realtime data in an "alert" of its
// own: "Echtzeitdaten aufbereitet von GTFS.de, bereitgestellt von <operator>".
// That is not a disruption, so the operator is offered as the `source` of the
// trip instead of a note. With another feed nothing matches and there simply
// is no source.
const SOURCE_NOTE = /^Echtzeitdaten aufbereitet von GTFS\.de, bereitgestellt von (.+)$/s;

// An alert's text with its lines as the operator set them, but without what
// only takes room: blanks at either end of a line, and more than one empty
// line in a row, of which some leave a dozen.
const tidy = (text) => text.replace(/\r\n?/g, '\n').replace(/^[ \t\u00a0]+|[ \t\u00a0]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

/**
 * What an alert says, as a note: its `text` in full, and as its `title` the
 * headline the feed gives it – null where it has none of its own, as the
 * short ones ("Niederflur") do not. Some operators write whole pages into the
 * text; whoever shows a note has the title to keep to then.
 * @returns null for an alert that says nothing
 */
function noteOf(alert) {
  const title = tidy(alert.header).replace(/\s+/g, ' ');
  const text = tidy(alert.description) || title;
  return text ? { title: title && title !== text.replace(/\s+/g, ' ') ? title : null, text } : null;
}

/**
 * What one fetch of the feed says of the trips and stops of the timetable, as
 * a Snapshot (snapshot.js): that has it in columns of numbers and is what the
 * timetable is asked with. For whoever wants to look at it, it also has
 *   byDate        service date -> trip index -> delays (see tripDelays), those
 *                 of coupled trains made the same where they share their way
 *   tripNotes     trip index -> notes (see noteOf): disruption reasons, vehicle features
 *   tripSources   trip index -> who provides the realtime data (see SOURCE_NOTE)
 *   stationNotes  station index -> notes, e.g. broken lifts
 * @param now epoch seconds; alerts are only taken while one of their active periods is current
 * @param taken the trip updates that were taken one by one while the feed was
 *   read (takeTripUpdate), where it is not left to this to go through them:
 *   { gathered, matched }
 */
export function buildRealtime(timetable, feed, now = Math.floor(Date.now() / 1000), taken = { gathered: new Gathering(), matched: 0 }) {
  const tripNotes = new Map();
  const tripSources = new Map();
  const stationNotes = new Map();
  const addNote = (map, key, note) => {
    const list = map.get(key);
    if (!list) map.set(key, [note]);
    else if (!list.some((other) => other.title === note.title && other.text === note.text)) list.push(note);
  };
  for (const alert of feed.alerts) {
    const note = noteOf(alert);
    if (!note) continue;
    // Without active periods an alert applies for as long as it is in the feed.
    if (alert.periods.length && !alert.periods.some((p) => p.start <= now && (!p.end || now < p.end))) continue;
    const source = SOURCE_NOTE.exec(note.text)?.[1].trim();
    for (const target of alert.informed) {
      const t = timetable.tripIndex.get(target.tripId);
      if (t !== undefined) {
        if (source) tripSources.set(t, source);
        else addNote(tripNotes, t, note);
      }
      const s = timetable.stopIndex.get(target.stopId);
      if (s !== undefined && !source) addNote(stationNotes, timetable.stationOf[s], note);
    }
  }

  const { gathered } = taken;
  let { matched } = taken;
  for (const update of feed.tripUpdates) if (takeTripUpdate(timetable, gathered, update)) matched++;
  shareDelays(timetable, gathered);
  return Object.assign(new Snapshot(gathered.columns({ tripNotes, tripSources, stationNotes, matched })), { tripNotes, tripSources, stationNotes });
}

/**
 * Has the feed fetched on an interval, but only while somebody is looking: it
 * is about 15 MB per request, so idle polling would cost tens of GB per day
 * for nothing. The fetching, the reading and the matching are done by a
 * thread of their own, which lives for as long as there is polling for one
 * timetable. A turn of the interval that comes while a fetch is still running
 * is left out.
 */
export class RealtimePoller {
  /** @param userAgent how the server names itself to the provider of the feed */
  constructor({ url, intervalMs, idleMs, getTimetable, log, userAgent }) {
    this.url = url;
    this.intervalMs = intervalMs;
    this.idleMs = idleMs;
    this.getTimetable = getTimetable;
    this.log = log;
    this.userAgent = userAgent;
    /** The realtime data in use: a Snapshot (snapshot.js), or null for the timetable alone. */
    this.snapshot = null;
    // (fetches and failures count since the server started)
    this.status = { polling: false, fetchedAt: null, feedTimestamp: null, matchedTrips: 0, error: null, fetches: 0, failures: 0 };
    this.lastTouch = 0;
    this.timer = null;
    this.busy = false;
    this.etag = null;
    // The thread that reads the feed, with the timetable it was started for
    // and what waits for its answer: { worker, timetable, waiting }.
    this.thread = null;
  }

  /** Called for every client request that needs realtime data. */
  touch() {
    this.lastTouch = Date.now();
    if (!this.timer) {
      this.log('Realtime: polling started');
      this.status.polling = true;
      this.timer = setInterval(() => this.tick(), this.intervalMs);
      this.tick();
    }
  }

  /** Back to the timetable alone, until a fetch brings realtime data again. */
  forget() {
    this.snapshot = null;
    this.etag = null;
  }

  /** Forget everything derived from the previous timetable, and end the thread that read the feed for it. */
  reset() {
    this.forget();
    const thread = this.thread;
    this.thread = null;
    if (thread) {
      thread.waiting?.reject(new Error('the timetable was replaced or the polling paused'));
      thread.worker.terminate();
    }
  }

  /**
   * Has the thread fetch the feed and read it against this timetable; a thread
   * is started if there is none for it.
   * @returns what the thread answers: { columns, etag, timestamp } or { unchanged: true }
   */
  fetch(timetable) {
    if (this.thread && this.thread.timetable !== timetable) this.reset();
    if (!this.thread) {
      if (!timetable.shared) throw new Error('the timetable is not in memory that threads share');
      const worker = new Worker(new URL('./realtime-worker.js', import.meta.url), {
        workerData: { shared: timetable.shared, timeZone: timeZone(), url: this.url, userAgent: this.userAgent },
      });
      const thread = { worker, timetable, waiting: null };
      const settle = (how, value) => {
        const { waiting } = thread;
        thread.waiting = null;
        waiting?.[how](value);
      };
      worker.on('message', (answer) => (answer.error ? settle('reject', new Error(answer.error)) : settle('resolve', answer)));
      // A thread that fails or ends is not used again: the next turn starts another.
      const gone = (err) => {
        if (this.thread === thread) this.thread = null;
        settle('reject', err);
      };
      worker.on('error', gone);
      worker.on('exit', (code) => gone(new Error(`the thread that reads the feed stopped (exit code ${code})`)));
      // (it does not keep the server from ending)
      worker.unref();
      this.thread = thread;
    }
    const { thread } = this;
    return new Promise((resolve, reject) => {
      thread.waiting = { resolve, reject };
      thread.worker.postMessage({ etag: this.etag });
    });
  }

  async tick() {
    if (Date.now() - this.lastTouch > this.idleMs) {
      this.log('Realtime: no requests any more, polling paused');
      clearInterval(this.timer);
      this.timer = null;
      this.status.polling = false;
      // Stale delays are worse than none.
      this.reset();
      return;
    }
    const timetable = this.getTimetable();
    if (!timetable) return;
    if (this.busy) return this.dropStale();
    this.busy = true;
    this.status.fetches++;
    // Meanwhile the timetable may be replaced or the polling paused: what
    // arrives then, or fails to, belongs to neither.
    const current = () => timetable === this.getTimetable() && this.timer !== null;
    try {
      // (a thread for another timetable has been ended by reset())
      const answer = await this.fetch(timetable);
      if (!current()) return;
      if (!answer.unchanged) {
        this.snapshot = new Snapshot(answer.columns);
        this.etag = answer.etag;
        this.status.feedTimestamp = answer.timestamp;
        this.status.matchedTrips = this.snapshot.matched;
      }
      this.status.fetchedAt = Math.floor(Date.now() / 1000);
      this.status.error = null;
    } catch (err) {
      if (!current()) return;
      this.status.failures++;
      this.status.error = reason(err);
      this.log(`Realtime: update failed: ${this.status.error}`);
      this.dropStale();
    } finally {
      this.busy = false;
    }
  }

  /** The last delays stay in use for a short while when fetching fails, then it is back to the schedule. */
  dropStale() {
    if (this.status.fetchedAt && Date.now() / 1000 - this.status.fetchedAt > STALE_AFTER_S) this.forget();
  }
}
