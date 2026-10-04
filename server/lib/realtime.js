// Polls the GTFS-Realtime feed and turns its TripUpdates into per-stop delays
// for the trips of the regional timetable.

import { publicUrl, reason } from './files.js';
import { decodeFeed } from './pb.js';
import { serviceDayStart } from './time.js';

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
  const stops = timetable.trips.stops[t];
  const schedArr = timetable.trips.arr[t];
  const schedDep = timetable.trips.dep[t];
  const n = stops.length;
  const base = serviceDayStart(date);
  const updates = update.stopTimeUpdates.filter((u) => u.seq !== null).sort((a, b) => a.seq - b.seq);

  const arrDelay = new Array(n).fill(null);
  const depDelay = new Array(n).fill(null);
  let skipped = null;
  let skippedCount = 0;
  let carried = null;
  let u = 0;

  for (let p = 0; p < n; p++) {
    const seq = timetable.seq(t, p);
    while (u < updates.length && updates[u].seq < seq) u++;
    const stu = u < updates.length && updates[u].seq === seq ? updates[u] : null;

    if (stu) {
      if (stu.stopId && stu.stopId !== timetable.stops.id[stops[p]]) return null;
      if (stu.rel === REL_NO_DATA) {
        carried = null;
        continue;
      }
      if (stu.rel === REL_SKIPPED) {
        (skipped ??= new Uint8Array(n))[p] = 1;
        skippedCount++;
      } else {
        const dep = eventDelay(stu.dep, base + schedDep[p]);
        const arr = eventDelay(stu.arr, base + schedArr[p]) ?? carried ?? dep;
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
  return { arrDelay, depDelay, skipped, cancelled, first, last };
}

// gtfs.de names the provider of a trip's realtime data in an "alert" of its
// own: "Echtzeitdaten aufbereitet von GTFS.de, bereitgestellt von <operator>".
// That is not a disruption, so the operator is offered as the `source` of the
// trip instead of a note. With another feed nothing matches and there simply
// is no source.
const SOURCE_NOTE = /^Echtzeitdaten aufbereitet von GTFS\.de, bereitgestellt von (.+)$/s;

/**
 * Snapshot of one feed fetch:
 *   byDate        service date -> trip index -> delays (see tripDelays)
 *   tripNotes     trip index -> alert texts (disruption reasons, vehicle features)
 *   tripSources   trip index -> who provides the realtime data (see SOURCE_NOTE)
 *   stationNotes  station index -> alert texts (e.g. broken lifts)
 * @param now epoch seconds; alerts are only taken while one of their active periods is current
 */
export function buildRealtime(timetable, feed, now = Math.floor(Date.now() / 1000)) {
  const byDate = new Map();
  const tripNotes = new Map();
  const tripSources = new Map();
  const stationNotes = new Map();
  const addNote = (map, key, text) => {
    const list = map.get(key);
    if (!list) map.set(key, [text]);
    else if (!list.includes(text)) list.push(text);
  };
  for (const alert of feed.alerts) {
    const text = alert.description || alert.header;
    if (!text) continue;
    // Without active periods an alert applies for as long as it is in the feed.
    if (alert.periods.length && !alert.periods.some((p) => p.start <= now && (!p.end || now < p.end))) continue;
    const source = SOURCE_NOTE.exec(text)?.[1].trim();
    for (const target of alert.informed) {
      const t = timetable.tripIndex.get(target.tripId);
      if (t !== undefined) {
        if (source) tripSources.set(t, source);
        else addNote(tripNotes, t, text);
      }
      const s = timetable.stopIndex.get(target.stopId);
      if (s !== undefined && !source) addNote(stationNotes, timetable.stationOf[s], text);
    }
  }

  let matched = 0;
  for (const update of feed.tripUpdates) {
    const t = timetable.tripIndex.get(update.trip.tripId);
    const date = update.trip.startDate;
    if (t === undefined || !date || !timetable.runsOn(t, date)) continue;
    const rt = tripDelays(timetable, t, date, update);
    if (!rt) continue;
    let trips = byDate.get(date);
    if (!trips) byDate.set(date, (trips = new Map()));
    trips.set(t, rt);
    matched++;
  }
  return { byDate, tripNotes, tripSources, stationNotes, matched };
}

/**
 * Fetches the feed on an interval, but only while somebody is looking: the
 * feed is ~20 MB per request and served uncompressed, so idle polling would
 * cost tens of GB per day for nothing.
 */
export class RealtimePoller {
  constructor({ url, intervalMs, idleMs, getTimetable, log }) {
    this.url = url;
    this.intervalMs = intervalMs;
    this.idleMs = idleMs;
    this.getTimetable = getTimetable;
    this.log = log;
    this.snapshot = null;
    this.status = { polling: false, fetchedAt: null, feedTimestamp: null, matchedTrips: 0, error: null };
    this.lastTouch = 0;
    this.timer = null;
    this.busy = false;
    this.etag = null;
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

  /** Forget everything derived from the previous timetable. */
  reset() {
    this.snapshot = null;
    this.etag = null;
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
    if (this.busy || !timetable) return;
    this.busy = true;
    try {
      const res = await fetch(this.url, {
        headers: this.etag ? { 'If-None-Match': this.etag } : {},
        signal: AbortSignal.timeout(Math.max(this.intervalMs - 2000, 10000)),
      });
      if (res.status === 304) {
        await res.body?.cancel();
      } else {
        if (!res.ok) throw new Error(`GET ${publicUrl(this.url)}: HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const feed = decodeFeed(buf, {
          wantTrip: (trip) => timetable.tripIndex.has(trip.tripId),
          wantAlert: (alert) => alert.informed.some((e) => timetable.tripIndex.has(e.tripId) || timetable.stopIndex.has(e.stopId)),
        });
        // The timetable may have been replaced while the download was running.
        if (timetable !== this.getTimetable()) return;
        this.snapshot = buildRealtime(timetable, feed);
        this.etag = res.headers.get('etag');
        this.status.feedTimestamp = feed.timestamp || null;
        this.status.matchedTrips = this.snapshot.matched;
      }
      this.status.fetchedAt = Math.floor(Date.now() / 1000);
      this.status.error = null;
    } catch (err) {
      this.status.error = reason(err);
      this.log(`Realtime: update failed: ${this.status.error}`);
      // Keep showing the last delays for a short while, then fall back to schedule.
      if (this.status.fetchedAt && Date.now() / 1000 - this.status.fetchedAt > STALE_AFTER_S) this.reset();
    } finally {
      this.busy = false;
    }
  }
}
