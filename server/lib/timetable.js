// In-memory view of the dataset produced by importer.js, plus the queries the
// API needs: vehicles right now, one trip, departures of a station.
//
// The dataset is columns of numbers (see importer.js): nothing in here holds
// an array for every trip. What a trip has is asked for by its number:
// stopsOf(t), schedArr(t, p), schedDep(t, p).
//
// Terms used throughout server/:
//   area     the region covered (NETNOU_BBOX or NETNOU_AREA_FILE), see area.js
//   stop     a row of stops.txt, often a single platform
//   station  the stop that groups platforms (parent_station) – what the map
//            shows and a departure board is for
//   pattern  a sequence of stops, stored once for all the trips that run it
//   profile  a set of running times, stored once: arrival and departure at
//            every stop, counted from the first departure
//   hop      two consecutive stops of a trip
//   segment  the routed geometry of a hop on one net (road, rail, subway or
//            tram), see shapes.js
//   knots    [time, lat, lon, …] along a vehicle's way ahead; the page
//            interpolates between them

import { NETS } from './network.js';
import { searchList } from './search-list.js';
import { addDays, localDate, serviceDayStart } from './time.js';

// The ids are part of the API; the page has a colour and a label for each.
export const MODES = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'other'];
// The OSM network (see network.js) a mode travels on.
export const NET_OF_MODE = { bus: 'road', tram: 'tram', subway: 'subway', suburban: 'rail', regional: 'rail', longdistance: 'rail' };

const LONG_DISTANCE = /^(ICE|IC|ECE|EC|RJX|RJ|NJ|EN|TGV|FLX|D)\s?\d/;

// GTFS has one route_type for all trains. The kinds of train are told apart by
// the line name as used in Germany and its neighbours ("S1", "ICE 29"); only
// the basic route types 0–3 are known, everything else is 'other'.
export function routeMode(type, shortName) {
  if (type === 0) return 'tram';
  if (type === 1) return 'subway';
  if (type === 3) return 'bus';
  if (type === 2) {
    if (/^S\s?\d/.test(shortName)) return 'suburban';
    if (LONG_DISTANCE.test(shortName)) return 'longdistance';
    return 'regional';
  }
  return 'other';
}

/**
 * Goes along the points of a segment of route geometry, from its first one
 * on: each is the one before and its step. One for each timetable, used for
 * one segment at a time.
 */
class Walk {
  constructor(timetable) {
    this.timetable = timetable;
  }

  /** Begins at the first point of segment s. @returns this */
  along(s) {
    const { segmentStart, segmentOrigin } = this.timetable;
    this.k = segmentStart[s];
    this.end = segmentStart[s + 1];
    this.lat = segmentOrigin[2 * s];
    this.lon = segmentOrigin[2 * s + 1];
    return this;
  }

  /** Whether there is a point after this one. */
  more() {
    return this.k + 1 < this.end;
  }

  /** On to the next point. */
  next() {
    const { segmentStep } = this.timetable;
    this.k++;
    this.lat += segmentStep[2 * this.k];
    this.lon += segmentStep[2 * this.k + 1];
  }

  /** The share of the segment's length up to this point, and up to the next one. */
  share() {
    return this.timetable.segmentShare[this.k] / 65_535;
  }

  shareAhead() {
    return this.timetable.segmentShare[this.k + 1] / 65_535;
  }
}

/** Key of the hop from stop index `from` to stop index `to` on network index `net` (see NETS). */
export const hopKey = (net, from, to, stopCount) => (net * stopCount + from) * stopCount + to;

// A vehicle is shown at its first stop shortly before departure and stays
// visible briefly after reaching its last stop.
const LEAD_S = 30;
const TRAIL_S = 15;
// No time of a timetable is as much before the start of its service day as
// this: what is added to a time to sort it as a number that is not negative.
const EARLIEST_S = 30 * 86400;
// Whose vehicles can run coupled: trains of any kind. Two buses with the same
// times are two buses, or one that the feed has twice.
const COUPLED_MODES = new Set(['subway', 'tram', 'suburban', 'regional', 'longdistance']);
// How far into the future the knots sent to the browser reach. Must comfortably
// exceed the browser's polling interval so animation survives a missed poll.
const HORIZON_S = 90;
// In the reduced form of a vehicle (see lite()) the browser gets its position
// now and this many seconds ahead.
export const LITE_AHEAD_S = 60;

const round5 = (x) => Math.round(x * 1e5) / 1e5;
/**
 * Spreads the bits of a whole number (the last step of MurmurHash3): numbers
 * that follow each other come out far apart, as whole numbers below 2^32.
 */
export const mix = (h) => {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};
// The time of a knot along route geometry, in tenths of a second.
const round10 = (x) => Math.round(x * 10) / 10;

/** What tells one line from another: its name, its mode and its operator together. */
const lineKey = ({ name, mode, agency }) => JSON.stringify([name, mode, agency]);

/**
 * Trains that run coupled are a trip each, and nothing in the feed says that
 * they belong together. What gives them away is that they share the way from
 * one stop to the next at the same times of the timetable. Most trips share
 * their ways only with themselves on other days; found here are the ways on
 * which two trips run on the same day at least once.
 * @param data a dataset as importer.js puts it together, in which it is stored
 * @returns { start, trip, position }: way i is the entries start[i] to
 *   start[i + 1] - 1, each a trip and the position in it of the stop the way
 *   begins at
 */
export function findSharedWays(data) {
  const { trips, patterns, profiles, routes, services } = data;
  const tripCount = trips.pattern.length;
  const coupled = routes.type.map((type, r) => COUPLED_MODES.has(routeMode(type, routes.short[r])) ? MODES.indexOf(routeMode(type, routes.short[r])) : -1);
  const hopsOf = (t) => patterns.start[trips.pattern[t] + 1] - patterns.start[trips.pattern[t]] - 1;

  let hopCount = 0;
  for (let t = 0; t < tripCount; t++) if (coupled[trips.route[t]] >= 0) hopCount += hopsOf(t);
  const hopTrip = new Int32Array(hopCount);
  const hopPosition = new Int32Array(hopCount);

  // The way of hop h as five numbers: mode, the two stops, departure and arrival.
  const way = new Int32Array(5);
  const read = (h) => {
    const t = hopTrip[h];
    const p = hopPosition[h];
    const stop = patterns.start[trips.pattern[t]] + p;
    const time = profiles.start[trips.profile[t]] + 2 * p;
    way[0] = coupled[trips.route[t]];
    way[1] = patterns.stops[stop];
    way[2] = patterns.stops[stop + 1];
    way[3] = trips.start[t] + profiles.times[time + 1];
    way[4] = trips.start[t] + profiles.times[time + 2];
  };
  const key = () => {
    let a = 2166136261 | 0;
    let b = 374761393 | 0;
    for (let i = 0; i < 5; i++) {
      a = Math.imul(a ^ way[i], 16777619);
      b = Math.imul(b ^ (way[i] + 0x9e3779b1), 16777619);
    }
    return (a >>> 0) * 2097152 + ((b >>> 0) & 0x1fffff);
  };

  const keys = new Float64Array(hopCount);
  let h = 0;
  for (let t = 0; t < tripCount; t++) {
    if (coupled[trips.route[t]] < 0) continue;
    for (let p = 0, n = hopsOf(t); p < n; p++, h++) {
      hopTrip[h] = t;
      hopPosition[h] = p;
      read(h);
      keys[h] = key();
    }
  }
  // Hops with the same key are neighbours once the hops are sorted into
  // buckets by the low bits of their keys: a bucket holds a handful of them.
  const buckets = 1 << Math.min(21, Math.max(4, Math.ceil(Math.log2(hopCount + 1))));
  const bucketStart = new Int32Array(buckets + 1);
  for (h = 0; h < hopCount; h++) bucketStart[(keys[h] % buckets) + 1]++;
  for (let b = 0; b < buckets; b++) bucketStart[b + 1] += bucketStart[b];
  const sorted = new Int32Array(hopCount);
  {
    const next = bucketStart.slice(0, buckets);
    for (h = 0; h < hopCount; h++) sorted[next[keys[h] % buckets]++] = h;
  }

  const days = services.map((dateIdxs) => new Set(dateIdxs));
  const meeting = new Map(); // two services -> whether they have a day in common
  const meet = (a, b) => {
    if (a === b) return days[a].size > 0;
    const pair = a < b ? a * days.length + b : b * days.length + a;
    let known = meeting.get(pair);
    if (known === undefined) {
      const [few, many] = days[a].size < days[b].size ? [days[a], days[b]] : [days[b], days[a]];
      known = false;
      for (const day of few) {
        if (many.has(day)) {
          known = true;
          break;
        }
      }
      meeting.set(pair, known);
    }
    return known;
  };

  const start = [0];
  const trip = [];
  const position = [];
  const same = new Int32Array(5);
  for (let b = 0; b < buckets; b++) {
    for (let i = bucketStart[b]; i < bucketStart[b + 1]; i++) {
      const one = sorted[i];
      if (one < 0) continue;
      // The hops on the same way as this one. Two ways may have the same key:
      // they are told apart by their numbers.
      let sharers = null;
      for (let j = i + 1; j < bucketStart[b + 1]; j++) {
        const other = sorted[j];
        if (other < 0 || keys[other] !== keys[one]) continue;
        if (!sharers) {
          read(one);
          same.set(way);
          sharers = [one];
        }
        read(other);
        if (way[0] !== same[0] || way[1] !== same[1] || way[2] !== same[2] || way[3] !== same[3] || way[4] !== same[4]) continue;
        sharers.push(other);
        sorted[j] = -1;
      }
      if (!sharers || sharers.length < 2) continue;
      if (!sharers.some((hop, k) => sharers.some((second, l) => l > k && meet(trips.service[hopTrip[hop]], trips.service[hopTrip[second]])))) continue;
      for (const hop of sharers) {
        trip.push(hopTrip[hop]);
        position.push(hopPosition[hop]);
      }
      start.push(trip.length);
    }
  }
  return { start: Int32Array.from(start), trip: Int32Array.from(trip), position: Int32Array.from(position) };
}

/**
 * A vehicle under way, as vehicles() hands it out. Its id and its knots are
 * only made when they are asked for: an answer for a map section needs those
 * of the vehicles in it, and there are tens of thousands in a large timetable.
 */
class Vehicle {
  #timetable;
  #trip;
  #date;
  #realtime;
  #row;
  #from;
  #last;
  #now;
  #id = null;
  #knots = null;

  /** @param realtime, row the realtime data and the row of the trip in it (Snapshot in snapshot.js); -1 without any */
  constructor(timetable, t, date, realtime, row, from, last, now, lat, lon) {
    this.#timetable = timetable;
    this.#trip = t;
    this.#date = date;
    this.#realtime = realtime;
    this.#row = row;
    this.#from = from;
    this.#last = last;
    this.#now = now;
    const route = timetable.tripRoute[t];
    const next = Math.min(from + 1, last);
    this.line = timetable.lineName(route);
    this.mode = timetable.routeModes[route];
    this.to = timetable.headsign(t);
    // Delay at the next stop in seconds; null when there is no realtime data.
    this.delay = row < 0 ? null : realtime.arrDelay(row, next);
    // current position, for filtering by map section (not sent to the browser)
    this.lat = lat;
    this.lon = lon;
    // for the vehicles of one line: which it is, the stop ahead and how many are left
    this.lineIndex = timetable.lineOf[route];
    this.next = timetable.stops.name[timetable.patternStops[timetable.patternStart[timetable.tripPattern[t]] + next]];
    this.stopsLeft = last - next;
  }

  /** Whether it is the vehicle of this trip on this service day: what its id says, without making it. */
  is(t, date) {
    return this.#trip === t && this.#date === date;
  }

  /**
   * A number by chance, below 2^32, that a trip keeps for as long as it runs.
   * Where a zoomed-out map cannot show every vehicle, the numbers decide
   * which ones it shows (thinning.js): the same ones from one moment to the next.
   */
  get rank() {
    return mix(this.#trip + 1);
  }

  /** The id of its trip and its service day: "671753_20261004". */
  get id() {
    return (this.#id ??= `${this.#timetable.tripId(this.#trip)}_${this.#date}`);
  }

  /** Those of the notes of its trip that warn: what is wrong with it right now (Snapshot.warningsOfTrip). */
  get warnings() {
    return this.#realtime?.warningsOfTrip(this.#trip) ?? [];
  }

  /** [time, lat, lon, …] along its way ahead, see Timetable.knots. */
  get knots() {
    if (!this.#knots) {
      const { arr, dep } = this.#timetable.times(this.#trip, this.#date, this.#realtime, this.#row);
      this.#knots = this.#timetable.knots(this.#trip, arr, dep, this.#from, this.#last, this.#now);
    }
    return this.#knots;
  }
}

/**
 * A list of ids in which one is found without a map that has an entry for
 * each of them: by looking through `order`, the places of the ids in the
 * order of their bytes (the import writes it beside them).
 * @param ids a Texts
 */
function finder(ids, order) {
  const get = (id) => {
    if (typeof id !== 'string') return undefined;
    const wanted = Buffer.from(id);
    const { bytes, start } = ids;
    let low = 0;
    let high = order.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const i = order[middle];
      const side = bytes.compare(wanted, 0, wanted.length, start[i], start[i + 1]);
      if (side === 0) return i;
      if (side < 0) low = middle + 1;
      else high = middle - 1;
    }
    return undefined;
  };
  return { get, has: (id) => get(id) !== undefined, keys: () => ids[Symbol.iterator]() };
}

/**
 * The timetable as far as realtime data is matched against it: the trips
 * with their stops and times, the days they run on, the ways that coupled
 * trains share, and trips and stops found by their ids. It lies over the
 * columns of a dataset and works out next to nothing, so that the thread
 * that reads the realtime feed has one of its own over the same memory
 * (realtime-worker.js), also over a dataset without its lists of texts.
 */
export class Schedule {
  /** @param data dataset from importer.js */
  constructor(data) {
    this.stops = data.stops;
    this.dates = data.dates;

    const { trips, patterns, profiles, seqLists } = data;
    this.tripIds = trips.id;
    this.tripPattern = trips.pattern;
    this.tripProfile = trips.profile;
    this.tripStart = trips.start;
    this.tripSeq = trips.seq;
    this.tripRoute = trips.route;
    this.tripService = trips.service;
    this.tripHeadsign = trips.headsign;
    this.patternStart = patterns.start;
    this.patternStops = patterns.stops;
    this.profileStart = profiles.start;
    this.profileTimes = profiles.times;
    this.seqStart = seqLists.start;
    this.seqNumbers = seqLists.seq;
    this.tripCount = trips.pattern.length;
    // Trips and stops are found by their ids in the lists of them in the
    // order of their ids: there is no map with an entry for each.
    this.tripIndex = finder(trips.id, trips.byId);
    this.stopIndex = finder(this.stops.id, this.stops.byId);
    this.dateIndex = new Map(this.dates.map((d, i) => [d, i]));

    // serviceOnDate[dateIdx][serviceIdx] = 1 if the service runs that day.
    this.serviceOnDate = this.dates.map(() => new Uint8Array(data.services.length));
    data.services.forEach((dateIdxs, s) => {
      for (const d of dateIdxs) this.serviceOnDate[d][s] = 1;
    });

    // The ways on which trains run coupled, each with the trips on it and the
    // position in each trip of the stop the way begins at: [[trip, position], …]
    // (see findSharedWays, which the import has run).
    this.sharedWays = [];
    const shared = data.sharedWays;
    for (let w = 0; shared && w + 1 < shared.start.length; w++) {
      const sharers = [];
      for (let k = shared.start[w]; k < shared.start[w + 1]; k++) sharers.push([shared.trip[k], shared.position[k]]);
      this.sharedWays.push(sharers);
    }

    // Stations group the platforms of one stop; they are what the map shows
    // and what a departure board is requested for.
    const stopCount = this.stops.id.length;
    this.stationOf = new Int32Array(stopCount);
    for (let i = 0; i < stopCount; i++) this.stationOf[i] = this.stops.parent[i] >= 0 ? this.stops.parent[i] : i;
  }

  /** The stops of trip t, as indexes of stops, in the order it calls at them. */
  stopsOf(t) {
    const pattern = this.tripPattern[t];
    return this.patternStops.subarray(this.patternStart[pattern], this.patternStart[pattern + 1]);
  }

  stopCount(t) {
    const pattern = this.tripPattern[t];
    return this.patternStart[pattern + 1] - this.patternStart[pattern];
  }

  /** The arrival of trip t at its stop at position p as the timetable has it, in seconds since the start of the service day; may exceed 86400. */
  schedArr(t, p) {
    return this.tripStart[t] + this.profileTimes[this.profileStart[this.tripProfile[t]] + 2 * p];
  }

  /** The departure, likewise. */
  schedDep(t, p) {
    return this.tripStart[t] + this.profileTimes[this.profileStart[this.tripProfile[t]] + 2 * p + 1];
  }

  tripId(t) {
    return this.tripIds.get(t);
  }

  seq(t, p) {
    const list = this.tripSeq[t];
    return list < 0 ? p : this.seqNumbers[this.seqStart[list] + p];
  }

  runsOn(t, date) {
    const d = this.dateIndex.get(date);
    return d !== undefined && this.serviceOnDate[d][this.tripService[t]] === 1;
  }

}

export class Timetable extends Schedule {
  /**
   * @param data dataset from importer.js (plus segments from shapes.js)
   * @param shared the bytes the dataset lies over, where they are in memory
   *   that threads can share (loadDataset in dataset.js): the thread for the
   *   realtime data lays a schedule of its own over them
   */
  constructor(data, shared = null) {
    super(data);
    this.shared = shared;
    this.source = data.source ?? {};
    this.routes = data.routes;
    this.headsigns = data.headsigns;

    const { trips, patterns, profiles } = data;
    const { tripCount } = this;
    this.routeModes = this.routes.type.map((type, r) => routeMode(type, this.routes.short[r]));
    this.tripsOnDate = new Map();

    // How long a trip runs, from its first departure to its last arrival, and
    // the earliest and latest departure in it, for every profile.
    const profileCount = profiles.start.length - 1;
    this.profileRun = new Int32Array(profileCount);
    const profileEarliest = new Int32Array(profileCount);
    const profileLatest = new Int32Array(profileCount);
    for (let r = 0; r < profileCount; r++) {
      this.profileRun[r] = profiles.times[profiles.start[r + 1] - 2];
      let earliest = Infinity;
      let latest = -Infinity;
      for (let k = profiles.start[r] + 1; k < profiles.start[r + 1]; k += 2) {
        earliest = Math.min(earliest, profiles.times[k]);
        latest = Math.max(latest, profiles.times[k]);
      }
      profileEarliest[r] = earliest;
      profileLatest[r] = latest;
    }

    const stopCount = this.stops.id.length;
    // The rectangle around the stops of the instance, [south, west, north,
    // east]: what an instance without an area has for one (its extent).
    this.bbox = null;
    for (let i = 0; i < stopCount; i++) {
      if (!this.stops.region[i]) continue;
      const [lat, lon] = [this.stops.lat[i], this.stops.lon[i]];
      this.bbox = this.bbox ? [Math.min(this.bbox[0], lat), Math.min(this.bbox[1], lon), Math.max(this.bbox[2], lat), Math.max(this.bbox[3], lon)] : [lat, lon, lat, lon];
    }

    // A line is what its passengers take for one: the routes of the feed with
    // the same name, mode and operator. The name alone does not say which line
    // it is – several operators number their lines from 1, and a replacement
    // bus runs under the name of its train.
    this.lines = [];
    this.lineIndex = new Map();
    this.lineOf = this.routes.type.map((_, route) => {
      const line = { name: this.lineName(route), mode: this.routeModes[route], agency: this.routes.agency[route] };
      const key = lineKey(line);
      if (!this.lineIndex.has(key)) {
        this.lineIndex.set(key, this.lines.length);
        // (trips, where they go, and where in the area they stop: filled in below)
        this.lines.push({ ...line, trips: 0, headsigns: new Map(), lat: 0, lon: 0, stops: 0 });
      }
      return this.lineIndex.get(key);
    });

    // What a pattern has of all the trips that run it: how many they are, of
    // which modes, how early and late a stop of it is left, and the trips
    // themselves in the order of their first departures.
    const patternCount = patterns.start.length - 1;
    const patternTrips = new Int32Array(patternCount);
    const patternModes = new Uint8Array(patternCount);
    this.patternEarliest = new Int32Array(patternCount).fill(2 ** 31 - 1);
    this.patternLatest = new Int32Array(patternCount).fill(-(2 ** 31));
    for (let t = 0; t < tripCount; t++) {
      const pattern = trips.pattern[t];
      patternTrips[pattern]++;
      patternModes[pattern] |= 1 << MODES.indexOf(this.routeModes[trips.route[t]]);
      this.patternEarliest[pattern] = Math.min(this.patternEarliest[pattern], profileEarliest[trips.profile[t]]);
      this.patternLatest[pattern] = Math.max(this.patternLatest[pattern], profileLatest[trips.profile[t]]);
    }
    this.patternFirst = new Int32Array(patternCount + 1);
    for (let i = 0; i < patternCount; i++) this.patternFirst[i + 1] = this.patternFirst[i] + patternTrips[i];
    this.tripsOfPattern = new Int32Array(tripCount);
    {
      const next = this.patternFirst.slice(0, patternCount);
      for (let t = 0; t < tripCount; t++) this.tripsOfPattern[next[trips.pattern[t]]++] = t;
      for (let i = 0; i < patternCount; i++) {
        this.tripsOfPattern.subarray(this.patternFirst[i], this.patternFirst[i + 1]).sort((a, b) => trips.start[a] - trips.start[b] || a - b);
      }
    }

    // A station knows the patterns that stop at it, each with the position of
    // the stop in the pattern: visitPattern and visitPosition from
    // visitStart[station] on. Stations are listed in the order in which the
    // trips first come to them.
    const visits = new Int32Array(stopCount + 1);
    const order = [];
    const stationModes = new Uint8Array(stopCount);
    const stationService = new Float64Array(stopCount);
    // (the stops of a pattern that are in the area, and the sum of their positions, for the lines)
    const inArea = new Int32Array(patternCount);
    const latSum = new Float64Array(patternCount);
    const lonSum = new Float64Array(patternCount);
    const seen = new Uint8Array(patternCount);
    const eachVisit = (pattern, visit) => {
      for (let k = patterns.start[pattern]; k < patterns.start[pattern + 1]; k++) {
        const stop = patterns.stops[k];
        if (this.stops.region[stop]) visit(this.stationOf[stop], k - patterns.start[pattern], stop);
      }
    };
    for (let t = 0; t < tripCount; t++) {
      const pattern = trips.pattern[t];
      if (seen[pattern]) continue;
      seen[pattern] = 1;
      eachVisit(pattern, (station, position, stop) => {
        if (!visits[station + 1]++) order.push(station);
        stationModes[station] |= patternModes[pattern];
        stationService[station] += patternTrips[pattern];
        inArea[pattern]++;
        latSum[pattern] += this.stops.lat[stop];
        lonSum[pattern] += this.stops.lon[stop];
      });
    }
    for (let i = 0; i < stopCount; i++) visits[i + 1] += visits[i];
    this.visitStart = visits;
    this.visitPattern = new Int32Array(visits[stopCount]);
    this.visitPosition = new Int32Array(visits[stopCount]);
    {
      const next = visits.slice(0, stopCount);
      for (let pattern = 0; pattern < patternCount; pattern++) {
        if (!seen[pattern]) continue;
        eachVisit(pattern, (station, position) => {
          this.visitPattern[next[station]] = pattern;
          this.visitPosition[next[station]++] = position;
        });
      }
    }
    for (let t = 0; t < tripCount; t++) {
      const line = this.lines[this.lineOf[trips.route[t]]];
      const headsign = this.headsign(t);
      line.trips++;
      line.headsigns.set(headsign, (line.headsigns.get(headsign) ?? 0) + 1);
      line.lat += latSum[trips.pattern[t]];
      line.lon += lonSum[trips.pattern[t]];
      line.stops += inArea[trips.pattern[t]];
    }

    this.stations = order.map((s) => ({
      id: this.stops.id.get(s),
      name: this.stops.name[s],
      lat: round5(this.stops.lat[s]),
      lon: round5(this.stops.lon[s]),
      modes: MODES.filter((_, bit) => stationModes[s] & (1 << bit)),
    }));
    // How often a trip stops at each station, over the whole timetable: it
    // says how much is going on there compared with the others.
    this.stationService = order.map((s) => stationService[s]);
    // The town each station is in, by its name, or null where none is known (towns.js).
    this.stationTown = order.map((s) => data.towns[this.stops.town[s]] ?? null);

    // Route geometry per hop (see shapes.js); absent until OSM data was loaded.
    // A hop is found by its key among the keys in their order. The points of
    // all hops are one column, in 1e-5 degrees: the first point of a hop as it
    // is, each of the others as its step from the one before, so a hop is
    // gone through from its first point on (Walk). For every point there is
    // also the share of the hop's length covered so far – a vehicle is
    // assumed to move along the hop at constant speed.
    this.routeNets = this.routeModes.map((mode) => NETS.indexOf(NET_OF_MODE[mode]));
    const segments = data.segments;
    this.segmentKey = segments?.key ?? new Float64Array(0);
    this.segmentStart = segments?.start ?? new Int32Array(1);
    this.segmentOrigin = segments?.origin ?? new Int32Array(0);
    this.segmentStep = segments?.step ?? new Int16Array(0);
    this.segmentShare = segments?.share ?? new Uint16Array(0);
    this.segmentCount = this.segmentKey.length;
    this.walk = new Walk(this);
    // Where position() leaves its answer.
    this.at = new Float64Array(2);
  }

  /** Index of the route geometry for the hop from stop position p to p + 1, or -1. */
  segment(t, p) {
    const stops = this.patternStart[this.tripPattern[t]] + p;
    const net = this.routeNets[this.tripRoute[t]];
    const wanted = hopKey(net, this.patternStops[stops], this.patternStops[stops + 1], this.stops.id.length);
    const keys = this.segmentKey;
    let low = 0;
    let high = keys.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (keys[middle] === wanted) return middle;
      if (keys[middle] < wanted) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }

  /**
   * Knots [time, lat, lon, …] describing where trip t is from `now` on, given
   * that stop position i is the one it left last. Follows the route geometry
   * where there is one and a straight line between the stops otherwise.
   */
  knots(t, arr, dep, i, last, now) {
    const stops = this.stopsOf(t);
    const { lat, lon } = this.stops;
    const horizon = now + HORIZON_S;
    const knots = [];
    let endLat = round5(lat[stops[i]]);
    let endLon = round5(lon[stops[i]]);

    for (let j = i + 1; j <= last; j++) {
      const t0 = dep[j - 1];
      const t1 = arr[j];
      const s = this.segment(t, j - 1);
      if (s >= 0) {
        const walk = this.walk.along(s);
        // Of the points already passed only the last one is needed.
        if (!knots.length) while (walk.more() && t0 + (t1 - t0) * walk.shareAhead() <= now) walk.next();
        for (;;) {
          const time = t0 + (t1 - t0) * walk.share();
          knots.push(round10(time), walk.lat / 1e5, walk.lon / 1e5);
          if (time > horizon) return knots;
          if (!walk.more()) break;
          walk.next();
        }
        endLat = walk.lat / 1e5;
        endLon = walk.lon / 1e5;
      } else {
        if (!knots.length) knots.push(t0, endLat, endLon);
        endLat = round5(lat[stops[j]]);
        endLon = round5(lon[stops[j]]);
        knots.push(t1, endLat, endLon);
        if (t1 > horizon) return knots;
      }
      if (j < last && dep[j] > t1) knots.push(dep[j], endLat, endLon);
    }
    if (!knots.length) knots.push(dep[i], endLat, endLon);
    return knots;
  }

  /**
   * Where trip t is at `now`, given that stop position i is the one it left
   * last, at t0, and that it reaches the next one at t1: what
   * positionAt(knots, now) gives for the knots of that moment, without making
   * them. The answer is left in this.at: latitude and longitude.
   */
  position(t, i, last, t0, t1, now) {
    const stops = this.patternStart[this.tripPattern[t]];
    const { lat, lon } = this.stops;
    const { at } = this;
    const here = this.patternStops[stops + i];
    const s = i === last ? -1 : this.segment(t, i);
    if (s < 0) {
      at[0] = round5(lat[here]);
      at[1] = round5(lon[here]);
      if (i === last || now <= t0) return;
      const next = this.patternStops[stops + i + 1];
      const f = now >= t1 ? 1 : (now - t0) / (t1 - t0);
      const toLat = round5(lat[next]);
      const toLon = round5(lon[next]);
      at[0] = f === 1 ? toLat : at[0] + (toLat - at[0]) * f;
      at[1] = f === 1 ? toLon : at[1] + (toLon - at[1]) * f;
      return;
    }
    const walk = this.walk.along(s);
    while (walk.more() && t0 + (t1 - t0) * walk.shareAhead() <= now) walk.next();
    const passed = round10(t0 + (t1 - t0) * walk.share());
    const ahead = walk.more() && now > passed ? round10(t0 + (t1 - t0) * walk.shareAhead()) : 0;
    // (at the point passed last, at the one ahead, or between the two)
    const between = walk.more() && now > passed && now < ahead;
    if (walk.more() && now > passed && now >= ahead) walk.next();
    at[0] = walk.lat / 1e5;
    at[1] = walk.lon / 1e5;
    if (between) {
      const f = (now - passed) / (ahead - passed);
      walk.next();
      at[0] += (walk.lat / 1e5 - at[0]) * f;
      at[1] += (walk.lon / 1e5 - at[1]) * f;
    }
  }

  headsign(t) {
    const h = this.tripHeadsign[t];
    if (h >= 0) return this.headsigns[h];
    const pattern = this.tripPattern[t];
    return this.stops.name[this.patternStops[this.patternStart[pattern + 1] - 1]];
  }

  /**
   * The way of a trip from the stop at position p to the next one, with the
   * times the timetable has for it. Trips with the same way are coupled
   * there, if they are trains and run on the same day.
   */
  way(t, p) {
    const stops = this.patternStart[this.tripPattern[t]] + p;
    return `${this.routeModes[this.tripRoute[t]]}|${this.patternStops[stops]}|${this.patternStops[stops + 1]}|${this.schedDep(t, p)}|${this.schedArr(t, p + 1)}`;
  }

  /** What a line is called: its short name ("U1") or, lacking one, the long name. */
  lineName(route) {
    return this.routes.short[route] || this.routes.long[route];
  }

  /** Trips whose service runs on the given date, in the order of their first departures. */
  activeTrips(date) {
    let list = this.tripsOnDate.get(date);
    if (!list) {
      const d = this.dateIndex.get(date);
      const running = [];
      if (d !== undefined) {
        const active = this.serviceOnDate[d];
        const service = this.tripService;
        for (let t = 0; t < this.tripCount; t++) if (active[service[t]]) running.push(t);
      }
      // In the order of a time, and trips with the same one in the order of
      // their numbers. Time and trip are sorted as one number each: for the
      // 800,000 trips of a day in a large timetable that takes a tenth of
      // what asking a function for every comparison does.
      const span = this.tripCount;
      const inOrder = (time) => {
        const keys = new Float64Array(running.length);
        for (let k = 0; k < running.length; k++) keys[k] = (time(running[k]) + EARLIEST_S) * span + running[k];
        keys.sort();
        return Int32Array.from(keys, (key) => key % span);
      };
      const start = this.tripStart;
      list = inOrder((t) => start[t]);
      // The same trips in the order of their last arrivals (see underWay).
      list.byEnd = inOrder((t) => start[t] + this.profileRun[this.tripProfile[t]]);
      if (this.tripsOnDate.size > 6) this.tripsOnDate.clear();
      this.tripsOnDate.set(date, list);
    }
    return list;
  }

  /**
   * Predicted arrival/departure epoch seconds at every stop of a trip:
   * schedule plus realtime delay, forced to be non-decreasing because the
   * browser interpolates along these times.
   * @param realtime, row the realtime data and the row of the trip in it; -1 without any
   */
  times(t, date, realtime = null, row = -1) {
    const base = serviceDayStart(date) + this.tripStart[t];
    const times = this.profileTimes;
    const from = this.profileStart[this.tripProfile[t]];
    const n = this.stopCount(t);
    const arr = new Array(n);
    const dep = new Array(n);
    let prev = -Infinity;
    for (let i = 0; i < n; i++) {
      let a = base + times[from + 2 * i] + (row < 0 ? 0 : realtime.arrDelay(row, i) ?? 0);
      let d = base + times[from + 2 * i + 1] + (row < 0 ? 0 : realtime.depDelay(row, i) ?? 0);
      if (a < prev) a = prev;
      if (d < a) d = a;
      arr[i] = a;
      dep[i] = d;
      prev = d;
    }
    return { arr, dep };
  }

  /**
   * The trips of a service day that may be under way at `rel`, seconds since
   * the start of that day, in the order of their numbers. The trips of the day
   * are there in the order of their first departures and in that of their
   * last arrivals: those that have started are the beginning of the one
   * list, those that have not arrived yet the end of the other, and the
   * shorter of the two is gone through. A trip with realtime data may be
   * under way outside the times the timetable has for it.
   * @param realtime, day the realtime data and the place of the service day in it; -1 without any
   */
  underWay(date, rel, realtime = null, day = -1) {
    const found = [];
    const start = this.tripStart;
    const run = this.profileRun;
    const profile = this.tripProfile;
    const list = this.activeTrips(date);
    const { byEnd } = list;
    // how many have started, and how many of the others have arrived
    let started = 0;
    for (let high = list.length; started < high;) {
      const middle = (started + high) >> 1;
      if (start[list[middle]] - LEAD_S <= rel) started = middle + 1;
      else high = middle;
    }
    let arrived = 0;
    for (let high = byEnd.length; arrived < high;) {
      const middle = (arrived + high) >> 1;
      const t = byEnd[middle];
      if (start[t] + run[profile[t]] + TRAIL_S < rel) arrived = middle + 1;
      else high = middle;
    }
    if (started <= byEnd.length - arrived) {
      for (let k = 0; k < started; k++) {
        const t = list[k];
        if (start[t] + run[profile[t]] + TRAIL_S >= rel) found.push(t);
      }
    } else {
      for (let k = arrived; k < byEnd.length; k++) {
        const t = byEnd[k];
        if (start[t] - LEAD_S <= rel) found.push(t);
      }
    }
    for (let r = day < 0 ? 0 : realtime.dayStart[day]; day >= 0 && r < realtime.dayStart[day + 1]; r++) {
      const t = realtime.trip[r];
      if (realtime.cancelled[r] || (start[t] - LEAD_S <= rel && start[t] + run[profile[t]] + TRAIL_S >= rel)) continue;
      const [first, last] = [realtime.first[r], realtime.last[r]];
      if (rel >= this.schedDep(t, first) + (realtime.depDelay(r, first) ?? 0) - LEAD_S && rel <= this.schedArr(t, last) + (realtime.arrDelay(r, last) ?? 0) + TRAIL_S) found.push(t);
    }
    return Int32Array.from(found).sort();
  }

  /**
   * Vehicles under way at `now` (epoch seconds), wherever they are: a trip is
   * followed along its whole run, also far outside the area – there without
   * route geometry, i.e. in straight lines between stops. The feed has no vehicle
   * positions, so each vehicle is described by "knots" – (time, lat, lon)
   * triples along its upcoming route – between which the browser interpolates.
   * They are made when a vehicle is asked for them (see Vehicle).
   * `realtime` is the realtime data (a Snapshot, see snapshot.js) or null
   * (schedule only).
   *
   * Trains that run coupled are a trip each in the feed, which has no word on
   * that they belong together. They are found by what they share: the way
   * from one stop to the next, at the same times of the timetable. Such
   * vehicles get the same `unit`. (Their delays on that way are the same
   * too: buildRealtime() in realtime.js sees to that.)
   */
  vehicles(now, realtime) {
    const today = localDate(now);
    const out = [];
    const ways = new Map(); // a way from stop to stop at its times → the first vehicle found on it
    const units = new Map(); // unit → its vehicles
    const couple = (a, b) => {
      if (a.unit && a.unit === b.unit) return;
      const unit = a.unit ?? b.unit ?? a.id;
      const members = units.get(unit) ?? [];
      for (const v of [a, b]) {
        // (one that is in another unit already brings that whole unit along)
        const joining = v.unit && v.unit !== unit ? units.get(v.unit) : [v];
        if (v.unit && v.unit !== unit) units.delete(v.unit);
        for (const member of joining) {
          if (member.unit === unit) continue;
          member.unit = unit;
          members.push(member);
        }
      }
      units.set(unit, members);
    };
    const times = this.profileTimes;

    // Yesterday's service day is still running after midnight (times > 24:00).
    for (const date of [addDays(today, -1), today]) {
      const dayStart = serviceDayStart(date);
      const rel = now - dayStart;
      const day = realtime ? realtime.day(date) : -1;

      for (const t of this.underWay(date, rel, realtime, day)) {
        const row = day < 0 ? -1 : realtime.row(day, t);
        let first = 0;
        let last = this.stopCount(t) - 1;
        if (row >= 0) {
          if (realtime.cancelled[row]) continue;
          first = realtime.first[row];
          last = realtime.last[row];
          // (without realtime data underWay has looked at the times already)
          if (rel < this.schedDep(t, first) + (realtime.depDelay(row, first) ?? 0) - LEAD_S) continue;
          if (rel > this.schedArr(t, last) + (realtime.arrDelay(row, last) ?? 0) + TRAIL_S) continue;
        }

        // i = the stop the vehicle left most recently (or its first stop),
        // left at t0; t1 is when it reaches the next one. The times are those
        // of times(), worked out stop by stop up to where the vehicle is.
        const base = dayStart + this.tripStart[t];
        const from = this.profileStart[this.tripProfile[t]];
        let i = first;
        let t0 = 0;
        let t1 = 0;
        let arrived = false; // at the stop ahead, where it still stands
        let prev = -Infinity;
        for (let p = 0; p <= last; p++) {
          let a = base + times[from + 2 * p] + (row < 0 ? 0 : realtime.arrDelay(row, p) ?? 0);
          let d = base + times[from + 2 * p + 1] + (row < 0 ? 0 : realtime.depDelay(row, p) ?? 0);
          if (a < prev) a = prev;
          if (d < a) d = a;
          prev = d;
          if (p === i) t0 = d;
          else if (p === i + 1) {
            if (d <= now) {
              i = p;
              t0 = d;
            } else {
              t1 = a;
              arrived = a <= now;
              break;
            }
          }
        }

        this.position(t, i, last, t0, t1, now);
        const vehicle = new Vehicle(this, t, date, realtime, row, i, last, now, this.at[0], this.at[1]);
        const { mode } = vehicle;
        const next = Math.min(i + 1, last);
        out.push(vehicle);

        if (!COUPLED_MODES.has(mode)) continue;
        // The way it is on, or has just come: from the stop it left to the one
        // ahead. Standing at that one, the way on from there counts as well,
        // so that trains are coupled from when they stand together to when
        // the first of them leaves.
        for (const begin of next < last && arrived ? [i, next] : [i]) {
          if (begin >= last) continue;
          const way = `${date}|${this.way(t, begin)}`;
          const other = ways.get(way);
          if (other) couple(other, vehicle);
          else ways.set(way, vehicle);
        }
      }
    }
    return out;
  }

  /**
   * What the page searches in: all stations with their service and all lines
   * (search-list.js).
   * @returns { list, stationAt }: what api/search sends, and a function that
   *   says for a place of that list the id of the station there, if one is
   */
  searchList() {
    const stations = this.stations.map((station, i) => ({ ...station, service: this.stationService[i], town: this.stationTown[i] }));
    // A line that only passes the area without a stop in it has no place there.
    const lines = this.lines.filter((line) => line.stops > 0).map((line) => ({
      name: line.name,
      mode: line.mode,
      agency: line.agency,
      // The feed has no word on where a line runs: the two destinations most of its trips have say it best.
      to: [...line.headsigns].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([headsign]) => headsign),
      // the middle of its stops in the area
      lat: line.lat / line.stops,
      lon: line.lon / line.stops,
      service: line.trips,
    }));
    const { list, at } = searchList(stations, lines, MODES);
    return { list, stationAt: (lat, lon) => this.stations[at(lat, lon)]?.id };
  }

  /** The number of a line as vehicles carry it (lineIndex), or undefined if there is no such line. */
  lineNumber(line) {
    return this.lineIndex.get(lineKey(line));
  }

  /**
   * The vehicles of one line among those under way, by where they go and how
   * far they have got, or null if there is no such line.
   * @param vehicles from vehicles()
   */
  lineVehicles(line, vehicles) {
    const index = this.lineNumber(line);
    if (index === undefined) return null;
    const { name, mode, agency } = this.lines[index];
    const list = vehicles
      .filter((v) => v.lineIndex === index)
      .sort((a, b) => a.to.localeCompare(b.to) || a.stopsLeft - b.stopsLeft)
      .map((v) => ({ id: v.id, to: v.to, next: v.next, delay: v.delay, lat: round5(v.lat), lon: round5(v.lon), warnings: v.warnings }));
    return { name, mode, agency, vehicles: list };
  }

  trip(tripId, date, realtime) {
    const t = this.tripIndex.get(tripId);
    if (t === undefined || !this.runsOn(t, date)) return null;
    const day = realtime ? realtime.day(date) : -1;
    const row = day < 0 ? -1 : realtime.row(day, t);
    const base = serviceDayStart(date);
    const route = this.tripRoute[t];
    const stops = this.stopsOf(t);

    // The whole route as one line [lat, lon, …].
    const path = [];
    for (let p = 0; p + 1 < stops.length; p++) {
      const s = this.segment(t, p);
      if (s >= 0) {
        const walk = this.walk.along(s);
        path.push(walk.lat / 1e5, walk.lon / 1e5);
        while (walk.more()) {
          walk.next();
          path.push(walk.lat / 1e5, walk.lon / 1e5);
        }
      } else {
        path.push(this.stops.lat[stops[p]], this.stops.lon[stops[p]], this.stops.lat[stops[p + 1]], this.stops.lon[stops[p + 1]]);
      }
    }

    return {
      id: `${tripId}_${date}`,
      line: this.lineName(route),
      mode: this.routeModes[route],
      to: this.headsign(t),
      agency: this.routes.agency[route],
      realtime: row >= 0,
      // Who provides the realtime data of this trip, if the feed says so.
      source: realtime?.sourceOf(t) ?? null,
      cancelled: row >= 0 && realtime.cancelled[row] === 1,
      notes: realtime?.notesOfTrip(t) ?? [],
      path,
      stops: Array.from(stops, (s, p) => ({
        station: this.stops.id.get(this.stationOf[s]),
        name: this.stops.name[s],
        platform: this.stops.platform[s],
        lat: this.stops.lat[s],
        lon: this.stops.lon[s],
        arr: base + this.schedArr(t, p),
        dep: base + this.schedDep(t, p),
        arrDelay: row < 0 ? null : realtime.arrDelay(row, p),
        depDelay: row < 0 ? null : realtime.depDelay(row, p),
        skipped: row >= 0 && realtime.skipped(row, p),
      })),
    };
  }

  /** Departures from a station (all its platforms) in the next `windowS` seconds. */
  departures(stationId, now, realtime, { windowS = 7200, limit = 40 } = {}) {
    const station = this.stopIndex.get(stationId);
    if (station === undefined || this.visitStart[station] === this.visitStart[station + 1]) return null;

    const today = localDate(now);
    const start = this.tripStart;
    const found = [];
    [addDays(today, -1), today, addDays(today, 1)].forEach((date, day) => {
      const d = this.dateIndex.get(date);
      if (d === undefined) return;
      const active = this.serviceOnDate[d];
      const base = serviceDayStart(date);
      const rtDay = realtime ? realtime.day(date) : -1;

      for (let visit = this.visitStart[station]; visit < this.visitStart[station + 1]; visit++) {
        const pattern = this.visitPattern[visit];
        const p = this.visitPosition[visit];
        if (p === this.patternStart[pattern + 1] - this.patternStart[pattern] - 1) continue; // terminus: nothing departs
        // The trips of the pattern are in the order of their first
        // departures: those that can leave here in time begin at `k`. Cheap
        // pre-filter; delays of more than three hours are not expected.
        const earliest = now - 3 * 3600 - base - this.patternLatest[pattern];
        const latest = now + windowS - base - this.patternEarliest[pattern];
        let k = this.patternFirst[pattern];
        for (let high = this.patternFirst[pattern + 1]; k < high;) {
          const middle = (k + high) >> 1;
          if (start[this.tripsOfPattern[middle]] < earliest) k = middle + 1;
          else high = middle;
        }
        for (; k < this.patternFirst[pattern + 1]; k++) {
          const t = this.tripsOfPattern[k];
          if (start[t] > latest) break;
          if (!active[this.tripService[t]]) continue;
          const planned = base + this.schedDep(t, p);
          if (planned > now + windowS || planned < now - 3 * 3600) continue;
          const row = rtDay < 0 ? -1 : realtime.row(rtDay, t);
          const delay = row < 0 ? null : realtime.depDelay(row, p);
          const expected = planned + (delay ?? 0);
          if (expected < now - 30 || expected > now + windowS) continue;
          found.push({ day, t, p, date, planned, delay, cancelled: row >= 0 && (realtime.cancelled[row] === 1 || realtime.skipped(row, p)) });
        }
      }
    });
    // By when they leave; those that leave at the same time by day, trip and stop.
    found.sort((a, b) => a.planned + (a.delay ?? 0) - (b.planned + (b.delay ?? 0)) || a.day - b.day || a.t - b.t || a.p - b.p);
    return {
      id: stationId,
      name: this.stops.name[station],
      lat: this.stops.lat[station],
      lon: this.stops.lon[station],
      notes: realtime?.notesOfStation(station) ?? [],
      departures: found.slice(0, limit).map(({ t, p, date, planned, delay, cancelled }) => {
        const route = this.tripRoute[t];
        return {
          trip: `${this.tripId(t)}_${date}`,
          line: this.lineName(route),
          mode: this.routeModes[route],
          to: this.headsign(t),
          platform: this.stops.platform[this.patternStops[this.patternStart[this.tripPattern[t]] + p]],
          planned,
          delay,
          cancelled,
          // What is wrong with the trip right now, for a list that marks such a departure.
          warnings: realtime?.warningsOfTrip(t) ?? [],
        };
      }),
    };
  }
}

/**
 * A vehicle reduced to a straight line from where it is now to where it will
 * be in a minute. Enough for zoomed-out views, where hundreds of vehicles are
 * visible and the route geometry is smaller than a pixel.
 */
export function lite(vehicle, now) {
  const [lat, lon] = positionAt(vehicle.knots, now + LITE_AHEAD_S);
  return [now, round5(vehicle.lat), round5(vehicle.lon), now + LITE_AHEAD_S, round5(lat), round5(lon)];
}

/**
 * Linear interpolation along knots [t0, lat0, lon0, t1, lat1, lon1, …].
 * The page animates the vehicles with a copy of this function (positionAt in
 * public/app.js); keep the two in step.
 */
export function positionAt(knots, t) {
  const n = knots.length;
  if (t <= knots[0]) return [knots[1], knots[2]];
  for (let k = 3; k < n; k += 3) {
    if (t < knots[k]) {
      const span = knots[k] - knots[k - 3];
      const f = span > 0 ? (t - knots[k - 3]) / span : 1;
      return [knots[k - 2] + (knots[k + 1] - knots[k - 2]) * f, knots[k - 1] + (knots[k + 2] - knots[k - 1]) * f];
    }
  }
  return [knots[n - 2], knots[n - 1]];
}
