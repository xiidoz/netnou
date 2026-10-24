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

import { stopPath } from '../../public/address.js';
import { bearing, choiceKey, inChoice } from '../../public/choice.js';
import { NETS } from './network.js';
import { searchList } from './search-list.js';
import { addDays, localDate, serviceDayStart } from './time.js';

// The ids are part of the API; the page has a colour and a label for each.
// 'cable' stands for cable cars and monorails, funiculars and rack railways
// with them: all that the feed of Germany gives the route type of a funicular.
export const MODES = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'ferry', 'cable', 'other'];
// The OSM network (see network.js) a mode travels on.
export const NET_OF_MODE = { bus: 'road', tram: 'tram', subway: 'subway', suburban: 'rail', regional: 'rail', longdistance: 'rail', ferry: 'ferry', cable: 'cable' };

const LONG_DISTANCE = /^(ICE|IC|ECE|EC|RJX|RJ|NJ|EN|TGV|FLX|D)\s?\d/;

// GTFS has one route_type for all trains. The kinds of train are told apart by
// the line name as used in Germany and its neighbours ("S1", "ICE 29"). Of the
// other route types, ferries are a kind of their own, and so are cable cars,
// funiculars and monorails; trolleybuses are buses. Of the extended route
// types (developers.google.com/transit/gtfs/reference/extended-route-types)
// those of the same things count likewise; everything else is 'other'.
export function routeMode(type, shortName) {
  if (type === 0) return 'tram';
  if (type === 1) return 'subway';
  if (type === 3 || type === 11 || (type >= 800 && type < 900)) return 'bus';
  if (type === 2) {
    if (/^S\s?\d/.test(shortName)) return 'suburban';
    if (LONG_DISTANCE.test(shortName)) return 'longdistance';
    return 'regional';
  }
  // (1000s: water transport; 1200: ferry service)
  if (type === 4 || (type >= 1000 && type < 1100) || (type >= 1200 && type < 1300)) return 'ferry';
  // (5 cable tram, 6 aerial lift, 7 funicular, 12 monorail; 405: monorail; 1300s: aerial lifts; 1400s: funiculars)
  if (type === 5 || type === 6 || type === 7 || type === 12 || type === 405 || (type >= 1300 && type < 1500)) return 'cable';
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
// The stops of a line (#256) say below a station that some of its trips start
// or end there where at least this share of the trips of that direction do:
// a trip from the depot now and then would put it below most of them.
const TURNING = 0.05;
// How far ahead the page is told where they will be, in seconds (lineStops).
const TRACK_S = 900;
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
// Modes of a station whose stops are this near each other are at one of its
// places (placesOf).
const PLACE_MERGE_M = 25;
const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180), lat2 - lat1) * 111_320;

/**
 * The places of a station where its modes stop apart (#234): each mode at the
 * middle of the stops it calls at, weighted by its trips there, and modes
 * within PLACE_MERGE_M of each other at one place, the busiest first. Null
 * where they are all at one place.
 * @param middles for each mode of the station: { mode, lat, lon, weight }
 */
export function placesOf(middles) {
  const places = [];
  for (const middle of [...middles].sort((a, b) => b.weight - a.weight)) {
    const near = places.find((place) => metres(place.lat, place.lon, middle.lat, middle.lon) <= PLACE_MERGE_M);
    if (near) near.modes.push(middle.mode);
    else places.push({ lat: middle.lat, lon: middle.lon, modes: [middle.mode] });
  }
  if (places.length < 2) return null;
  return places.map(({ lat, lon, modes }) => ({ lat: round5(lat), lon: round5(lon), modes: MODES.filter((mode) => modes.includes(mode)) }));
}
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

/** What a line is called by: its name, its mode and its operator together; lines in places apart may share it (findLines). */
const lineKey = ({ name, mode, agency }) => JSON.stringify([name, mode, agency]);

/**
 * The lines of a timetable (Timetable): the trips of a name, mode and
 * operator, as many lines as they make in places apart, where trips that
 * share a station, also through others, are of one. Each line with the
 * middle of its stations, `place`, which tells it from others of its name;
 * its trips and the rest are counted by the Timetable.
 * @returns { lines, tripLine }: the lines, and the number of the line of each trip
 */
function findLines(tt) {
  const { patternStart, patternStops, stationOf, tripCount } = tt;
  const { lat, lon } = tt.stops;
  const routeCount = tt.routes.type.length;
  const patternCount = patternStart.length - 1;
  const stopCount = tt.stops.id.length;
  // the routes of a name, mode and operator
  const named = new Map();
  const names = [];
  const nameOf = new Int32Array(routeCount);
  for (let route = 0; route < routeCount; route++) {
    const line = { name: tt.lineName(route), mode: tt.routeModes[route], agency: tt.routes.agency[route] };
    if (!named.has(lineKey(line))) named.set(lineKey(line), names.push(line) - 1);
    nameOf[route] = named.get(lineKey(line));
  }
  // The patterns run under each name, as pairs of a name and a pattern, and
  // the pair of every trip. A pattern is run under one name nearly always.
  const firstName = new Int32Array(patternCount).fill(-1);
  const firstPair = new Int32Array(patternCount);
  const morePairs = new Map();
  const pairName = [];
  const pairPattern = [];
  const tripLine = new Int32Array(tripCount);
  for (let t = 0; t < tripCount; t++) {
    const name = nameOf[tt.tripRoute[t]];
    const pattern = tt.tripPattern[t];
    let pair;
    if (firstName[pattern] === name) pair = firstPair[pattern];
    else if (firstName[pattern] === -1) {
      pair = firstPair[pattern] = pairName.push(name) - 1;
      firstName[pattern] = name;
      pairPattern.push(pattern);
    } else {
      pair = morePairs.get(`${name} ${pattern}`);
      if (pair === undefined) {
        pair = pairName.push(name) - 1;
        pairPattern.push(pattern);
        morePairs.set(`${name} ${pattern}`, pair);
      }
    }
    tripLine[t] = pair;
  }
  // the pairs in the order of their names, and in their own under one name
  const pairCount = pairName.length;
  const byName = new Int32Array(pairCount);
  {
    const next = new Int32Array(names.length + 1);
    for (const name of pairName) next[name + 1]++;
    for (let i = 0; i < names.length; i++) next[i + 1] += next[i];
    for (let pair = 0; pair < pairCount; pair++) byName[next[pairName[pair]]++] = pair;
  }
  // The pairs of a name that come to the same station are of one line: a
  // station keeps the pair that came to it first, under the name of the moment.
  const up = new Int32Array(pairCount);
  for (let pair = 0; pair < pairCount; pair++) up[pair] = pair;
  const root = (i) => {
    while (up[i] !== i) i = up[i] = up[up[i]];
    return i;
  };
  const keeper = new Int32Array(stopCount);
  const keptFor = new Int32Array(stopCount).fill(-1);
  for (const pair of byName) {
    const name = pairName[pair];
    for (let k = patternStart[pairPattern[pair]]; k < patternStart[pairPattern[pair] + 1]; k++) {
      const station = stationOf[patternStops[k]];
      if (keptFor[station] === name) up[root(pair)] = root(keeper[station]);
      else {
        keptFor[station] = name;
        keeper[station] = pair;
      }
    }
  }
  // a line for each set of pairs, with the middle of its stations, each counted once
  const lines = [];
  const lineOfRoot = new Int32Array(pairCount).fill(-1);
  const pairLine = new Int32Array(pairCount);
  const counted = new Int32Array(stopCount).fill(-1);
  const sums = []; // of each line: latitudes, longitudes, stations
  for (const pair of byName) {
    const set = root(pair);
    if (lineOfRoot[set] === -1) {
      lineOfRoot[set] = lines.push({ ...names[pairName[pair]], trips: 0, headsigns: new Map(), lat: 0, lon: 0, stops: 0, place: null }) - 1;
      sums.push([0, 0, 0]);
    }
    const line = (pairLine[pair] = lineOfRoot[set]);
    const sum = sums[line];
    for (let k = patternStart[pairPattern[pair]]; k < patternStart[pairPattern[pair] + 1]; k++) {
      const station = stationOf[patternStops[k]];
      if (counted[station] === line) continue;
      counted[station] = line;
      sum[0] += lat[station];
      sum[1] += lon[station];
      sum[2]++;
    }
  }
  lines.forEach((line, i) => (line.place = [round5(sums[i][0] / sums[i][2]), round5(sums[i][1] / sums[i][2])]));
  for (let t = 0; t < tripCount; t++) tripLine[t] = pairLine[tripLine[t]];
  return { lines, tripLine };
}

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
  #come;
  #id = null;
  #knots = null;

  /**
   * @param realtime, row the realtime data and the row of the trip in it (Snapshot in snapshot.js); -1 without any
   * @param come how far it has come from the stop it left to the one ahead, from 0 to 1
   */
  constructor(timetable, t, date, realtime, row, from, last, now, lat, lon, come = 0) {
    this.#timetable = timetable;
    this.#come = come;
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
    // (where it is going from the stop ahead, which may be another place than where it set out for)
    this.to = timetable.headsignAt(t, next);
    // Delay at the next stop in seconds; null when there is no realtime data.
    this.delay = row < 0 ? null : realtime.arrDelay(row, next);
    // current position, for filtering by map section (not sent to the browser)
    this.lat = lat;
    this.lon = lon;
    // for the vehicles of one line: which it is, the stop ahead and how many are left
    this.lineIndex = timetable.tripLine[t];
    this.next = timetable.stops.name[timetable.patternStops[timetable.patternStart[timetable.tripPattern[t]] + next]];
    this.stopsLeft = last - next;
  }

  /** Where it is in its trip, for the stops of its line (#256): the stop it left and the one ahead, as positions in its trip, and how far it has come between them. */
  get stretch() {
    return { t: this.#trip, from: this.#from, next: Math.min(this.#from + 1, this.#last), come: this.#come };
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
      const { arr, dep } = this.times;
      this.#knots = this.#timetable.knots(this.#trip, arr, dep, this.#from, this.#last, this.#now);
    }
    return this.#knots;
  }

  /** When its trip arrives at each of its stops and leaves it, with the delays known (Timetable.times). */
  get times() {
    return this.#timetable.times(this.#trip, this.#date, this.#realtime, this.#row);
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
    this.signStart = data.signLists.start;
    this.signs = data.signLists.signs;

    const { trips, patterns, profiles } = data;
    const { tripCount } = this;
    this.routeModes = this.routes.type.map((type, r) => routeMode(type, this.routes.short[r]));
    // The kinds of transport the timetable has, in the order of MODES: those
    // of which a trip runs. The page shows a chip for each of them, and for no other.
    const run = new Uint8Array(this.routeModes.length);
    for (const route of this.tripRoute) run[route] = 1;
    this.kinds = MODES.filter((mode) => this.routeModes.some((kind, r) => run[r] && kind === mode));
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

    // A line is what its passengers take for one: the trips of the feed with
    // the same name, mode and operator that share stations, also through
    // others. The name alone does not say which line it is – several
    // operators number their lines from 1, and a replacement bus runs under
    // the name of its train – and with the operator not always either: DB
    // Regio runs an S1 in Nuremberg and one in Munich (#152).
    // (trips, where they go, and where in the area they stop: filled in below)
    const { lines, tripLine } = findLines(this);
    this.lines = lines;
    this.tripLine = tripLine;
    // the lines of a name, mode and operator, by those: their numbers
    this.lineIndex = new Map();
    lines.forEach((line, i) => this.lineIndex.set(lineKey(line), [...(this.lineIndex.get(lineKey(line)) ?? []), i]));

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
    // where each mode stops at a station: [latitude, longitude, weight] summed up by station * 16 + mode, for placesOf
    const modeSums = new Map();
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
        for (let bits = patternModes[pattern], mode = 0; bits; bits >>= 1, mode++) {
          if (!(bits & 1)) continue;
          const weight = patternTrips[pattern];
          const sum = modeSums.get(station * 16 + mode);
          if (sum) {
            sum[0] += this.stops.lat[stop] * weight;
            sum[1] += this.stops.lon[stop] * weight;
            sum[2] += weight;
          } else modeSums.set(station * 16 + mode, [this.stops.lat[stop] * weight, this.stops.lon[stop] * weight, weight]);
        }
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
      const line = this.lines[this.tripLine[t]];
      const headsign = this.headsign(t);
      line.trips++;
      line.headsigns.set(headsign, (line.headsigns.get(headsign) ?? 0) + 1);
      line.lat += latSum[trips.pattern[t]];
      line.lon += lonSum[trips.pattern[t]];
      line.stops += inArea[trips.pattern[t]];
    }
    // (of the lines of a name the busiest first: the one meant where nothing says which)
    for (const numbers of this.lineIndex.values()) numbers.sort((a, b) => this.lines[b].trips - this.lines[a].trips || a - b);

    this.stations = order.map((s) => {
      const station = {
        id: this.stops.id.get(s),
        name: this.stops.name[s],
        lat: round5(this.stops.lat[s]),
        lon: round5(this.stops.lon[s]),
        modes: MODES.filter((_, bit) => stationModes[s] & (1 << bit)),
      };
      const middles = [];
      for (let mode = 0; mode < MODES.length; mode++) {
        const sum = modeSums.get(s * 16 + mode);
        if (sum) middles.push({ mode: MODES[mode], lat: sum[0] / sum[2], lon: sum[1] / sum[2], weight: sum[2] });
      }
      // (only where its modes stop apart: most stations are one place)
      const places = middles.length > 1 ? placesOf(middles) : null;
      if (places) station.places = places;
      return station;
    });
    // How often a trip stops at each station, over the whole timetable: it
    // says how much is going on there compared with the others.
    this.stationService = order.map((s) => stationService[s]);
    // The town each station is in, as its number among the towns, or -1
    // where none is known (towns.js); towns of one name are towns apart.
    this.stationTown = order.map((s) => this.stops.town[s]);
    this.towns = data.towns.map((name, i) => ({ name, district: data.districts[i] || null }));

    // Route geometry per hop (see shapes.js); absent until OSM data was loaded.
    // A hop is found by its key among the keys in their order. The points of
    // all hops are one column, in 1e-5 degrees: the first point of a hop as it
    // is, each of the others as its step from the one before, so a hop is
    // gone through from its first point on (Walk). For every point there is
    // also the share of the hop's time gone by, from the speeds of its roads
    // or tracks (#264).
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
    return this.segmentOf(hopKey(net, this.patternStops[stops], this.patternStops[stops + 1], this.stops.id.length));
  }

  /** Index of the route geometry of a hop by its key (hopKey), or -1. */
  segmentOf(wanted) {
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

  /**
   * Where trip t is going as it leaves its stop at position p: what the
   * operator gives for that stop (stop_headsign, else trip_headsign), else
   * its last stop. Operators change it on the way: for a "via" that is
   * behind it, round a ring line, for the last part of the way (#225). At
   * the last stop, where nothing leaves, it is that of the stop before: what
   * is given there ("Fahrt endet hier") says nothing of where it goes.
   */
  headsignAt(t, p) {
    let h = this.tripHeadsign[t];
    if (h < -1) h = this.signs[this.signStart[-2 - h] + Math.min(p, this.stopCount(t) - 2)];
    if (h >= 0) return this.headsigns[h];
    const pattern = this.tripPattern[t];
    return this.stops.name[this.patternStops[this.patternStart[pattern + 1] - 1]];
  }

  /** Where trip t is going as it sets out: the title of its page and the destinations of its line go by this one. */
  headsign(t) {
    return this.headsignAt(t, 0);
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
        // (how far it has come to the stop ahead: all the way where it stands there)
        const come = arrived ? 1 : t1 > t0 ? Math.min(1, Math.max(0, (now - t0) / (t1 - t0))) : 0;
        const vehicle = new Vehicle(this, t, date, realtime, row, i, last, now, this.at[0], this.at[1], come);
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
    const { list, at } = searchList(stations, lines, MODES, this.towns);
    return { list, stationAt: (lat, lon) => this.stations[at(lat, lon)]?.id };
  }

  /**
   * The number of a line as vehicles carry it (lineIndex), or undefined if
   * there is no such line. Of the lines of a name, mode and operator in
   * places apart (findLines) the one whose place is nearest `at`, [lat, lon];
   * without one the busiest.
   */
  lineNumber(line, at = null) {
    const numbers = this.lineIndex.get(lineKey(line));
    if (!numbers || !at) return numbers?.[0];
    const away = (i) => {
      const [lat, lon] = this.lines[i].place;
      return Math.hypot((lon - at[1]) * Math.cos((lat * Math.PI) / 180), lat - at[0]);
    };
    return numbers.reduce((best, i) => (away(i) < away(best) ? i : best));
  }

  /**
   * The vehicles of line number `index` among those under way, by where they
   * go and how far they have got; with the place of the line, which asks for
   * it again among those of its name.
   * @param vehicles from vehicles()
   */
  lineVehicles(index, vehicles) {
    const { name, mode, agency, place } = this.lines[index];
    const own = vehicles.filter((v) => v.lineIndex === index);
    const list = own
      .sort((a, b) => a.to.localeCompare(b.to) || a.stopsLeft - b.stopsLeft)
      .map((v) => ({ id: v.id, to: v.to, next: v.next, delay: v.delay, lat: round5(v.lat), lon: round5(v.lon), warnings: v.warnings }));
    return { name, mode, agency, at: place, vehicles: list, ways: this.lineStops(index, own) };
  }

  /**
   * The stops of a line in each direction, with its vehicles along them
   * (#256), as its card lists them: of each way (lineWays) its stations,
   * where some of its trips start or end, its branches, and each vehicle
   * under way between the two stations it is between.
   * @returns [{ to, stops: [{ id, name, town, path, start, end }], branches:
   *   [{ after, before, stops }], vehicles: [{ id, to, delay, warnings,
   *   branch, from, until, come }] }]: `after` and `before` are the
   *   positions in `stops` of the station a branch leaves the line at or
   *   joins it at (null where it does neither); a vehicle is between the
   *   stops at the positions `from` and `until` of the list, or of branch
   *   number `branch`, where -1 and the length of the branch are the
   *   stations it leaves the line at and joins it at; `track` where it will
   *   be when, on from there: [time, position, …], positions as `from`,
   *   for the page to move it between two answers
   */
  lineStops(index, vehicles) {
    const stop = (s) => ({ id: this.stops.id.get(s), name: this.stops.name[s], town: this.towns[this.stops.town[s]]?.name ?? null, path: stopPath(this.stops.name[s], this.stops.lat[s], this.stops.lon[s]) });
    const ways = this.lineWays(index);
    const placed = ways.map(() => []);
    for (const v of vehicles) {
      const { t, from, next, come } = v.stretch;
      const start = this.patternStart[this.tripPattern[t]];
      const left = this.stationOf[this.patternStops[start + from]];
      // (which of its calls at that station it left: a run may call at one twice, as around a loop)
      let calls = 0;
      for (let k = 0; k <= from; k++) if (this.stationOf[this.patternStops[start + k]] === left && (k === 0 || this.stationOf[this.patternStops[start + k - 1]] !== left)) calls++;
      const at = this.placeOn(ways, left, this.stationOf[this.patternStops[start + next]], calls - 1);
      if (!at) continue;
      const track = this.trackOn(ways[at.way], at, t, from, v.times);
      placed[at.way].push({ id: v.id, to: v.to, delay: v.delay, warnings: v.warnings, branch: at.branch, from: at.from, until: at.until, come: at.from === at.until ? 0 : Math.round(come * 100) / 100, track });
    }
    return ways.map((way, w) => ({
      to: way.to,
      // (where at least a twentieth of its trips start or end, on the way: its first and last stations are where they all do)
      stops: way.list.map((s, i) => ({
        ...stop(s),
        start: i > 0 && (way.starts.get(s) ?? 0) >= TURNING * way.trips,
        end: i < way.list.length - 1 && (way.ends.get(s) ?? 0) >= TURNING * way.trips,
      })),
      branches: way.branches.map(({ after, before, stations }) => ({ after, before, stops: stations.map(stop) })),
      vehicles: placed[w].sort((a, b) => (a.branch ?? -1) - (b.branch ?? -1) || a.from + a.come - (b.from + b.come)),
    }));
  }

  /**
   * Where a vehicle placed on a way (placeOn) will be when, on from the stop
   * it left: at each station of its trip that follows in the list, or in its
   * branch, from when it arrives to when it leaves, as far as they follow and
   * for TRACK_S.
   * @param at where it is placed (placeOn)
   * @param from the position in trip t of the stop it left
   * @param times when the trip arrives and leaves at each of its stops (Timetable.times)
   * @returns [time, position, …], times in seconds
   */
  trackOn(way, at, t, from, { arr, dep }) {
    // the stations it is on, from the one it left, platforms of one station together
    const start = this.patternStart[this.tripPattern[t]];
    const ahead = [];
    for (let k = from; k < this.patternStart[this.tripPattern[t] + 1] - start; k++) {
      const station = this.stationOf[this.patternStops[start + k]];
      if (ahead.at(-1)?.station === station) ahead.at(-1).dep = dep[k];
      else ahead.push({ station, arr: arr[k], dep: dep[k] });
    }
    // the stations of where it is placed, by their positions: the list, or the branch with where it leaves and joins it
    const branch = at.branch === null ? null : way.branches[at.branch];
    const run = branch ? [branch.after === null ? -1 : way.list[branch.after], ...branch.stations, branch.before === null ? -1 : way.list[branch.before]] : way.list;
    const shift = branch ? -1 : 0;
    // (from the station it left, or from the one ahead where it is placed at that)
    let p = at.from - shift;
    let i = ahead.findIndex((call) => call.station === run[p]);
    if (i < 0) return [];
    const track = i === 0 ? [ahead[0].dep, at.from] : [ahead[i].arr, at.from, ahead[i].dep, at.from];
    // (a quarter of an hour ahead: the page asks again long before)
    for (i++; i < ahead.length && ahead[i - 1].dep < track[0] + TRACK_S; i++) {
      const q = run.indexOf(ahead[i].station, p + 1);
      if (q < 0) break;
      p = q;
      track.push(ahead[i].arr, p + shift, ahead[i].dep, p + shift);
    }
    return track;
  }

  /**
   * Where on the ways of a line (lineWays) a vehicle is that has left the
   * station `a` for the station `b`: between the two in the list of a way
   * where they are nearest, or in one of its branches, or else at `b`
   * where only that is in it. Null where neither is.
   * @param call which of the calls of its trip at `a` it left (0 the first):
   *   where a list has the station as often, that one of them
   */
  placeOn(ways, a, b, call = 0) {
    let best = null;
    ways.forEach((way, w) => {
      const { list } = way;
      // (that call first, where the list has as many, then the others)
      const calls = list.flatMap((s, i) => (s === a ? [i] : []));
      const order = calls.length > call ? [calls[call], ...calls.filter((_, k) => k !== call)] : calls;
      for (const i of order) {
        const j = a === b ? i : list.indexOf(b, i + 1);
        if (j < i) continue;
        if (!best || j - i < best.gap) best = { way: w, branch: null, from: i, until: j, gap: j - i };
        break;
      }
    });
    if (best) return best;
    for (const [w, way] of ways.entries()) {
      for (const [k, { after, before, stations }] of way.branches.entries()) {
        // (the stations of the branch, with where it leaves and joins the line around them)
        const run = [after === null ? -1 : way.list[after], ...stations, before === null ? -1 : way.list[before]];
        const i = run.indexOf(a);
        const j = run.indexOf(b, i + 1);
        if (i >= 0 && j > i) return { way: w, branch: k, from: i - 1, until: j - 1 };
      }
    }
    for (const [w, way] of ways.entries()) {
      const j = way.list.indexOf(b);
      if (j >= 0) return { way: w, branch: null, from: j, until: j };
    }
    return null;
  }

  /**
   * The ways line number `index` goes, worked out once: the runs of its
   * trips as their stations follow each other, on any day of the timetable,
   * in two directions (the busiest run, and those that go along it the
   * other way), or one for a line that goes one way only, as around a ring.
   * The stations of a direction are a list: its busiest run, with the
   * stations of runs that go further added at its ends and those that some
   * runs have between two of its stations put in their place, the busier
   * runs first. What is left of a run branches off: the stations it has
   * after it left the list, or before it joins it. A direction is named by
   * the destination its trips show over most of the way they go.
   * @returns [{ to, list, branches: [{ after, before, stations }], trips,
   *   starts, ends, patterns }]: stations by their numbers; `starts` and
   *   `ends` how many trips start and end at each; `patterns` those of the
   *   trips that go this way
   */
  lineWays(index) {
    this.waysOfLines ??= new Map();
    if (this.waysOfLines.has(index)) return this.waysOfLines.get(index);
    // (the patterns of each line, found once for all of them)
    if (!this.patternsOfLines) {
      this.patternsOfLines = new Map();
      for (let t = 0; t < this.tripLine.length; t++) {
        const set = this.patternsOfLines.get(this.tripLine[t]) ?? this.patternsOfLines.set(this.tripLine[t], new Set()).get(this.tripLine[t]);
        set.add(this.tripPattern[t]);
      }
    }
    // its runs: the trips of a sequence of stations, whatever platforms they call at
    const runs = new Map();
    for (const pattern of this.patternsOfLines.get(index) ?? []) {
      const seq = [];
      for (let k = this.patternStart[pattern]; k < this.patternStart[pattern + 1]; k++) {
        const s = this.stationOf[this.patternStops[k]];
        if (seq.at(-1) !== s) seq.push(s);
      }
      if (seq.length < 2) continue;
      const key = seq.join(',');
      const run = runs.get(key) ?? runs.set(key, { seq, trips: 0, to: new Map(), patterns: [] }).get(key);
      run.patterns.push(pattern);
      for (let k = this.patternFirst[pattern]; k < this.patternFirst[pattern + 1]; k++) {
        const t = this.tripsOfPattern[k];
        if (this.tripLine[t] !== index) continue;
        run.trips++;
        const to = this.headsignAt(t, 0);
        run.to.set(to, (run.to.get(to) ?? 0) + 1);
      }
    }
    // (the busiest first, and of as busy ones the longer)
    const sorted = [...runs.values()].filter((run) => run.trips > 0).sort((a, b) => b.trips - a.trips || b.seq.length - a.seq.length);
    const ways = [];
    if (sorted.length) {
      // Which way a run goes along the busiest: by more of its steps between
      // their common stations. One that has fewer than two of them in common
      // goes the way where it adds the fewest stations on branches, as a
      // shuttle from the end of the line to a village goes on from that end.
      const along = new Map(sorted[0].seq.map((s, i) => [s, i]));
      const directions = [[], []];
      const unsure = [];
      for (const run of sorted) {
        let up = 0;
        let down = 0;
        let prev = null;
        for (const s of run.seq) {
          if (!along.has(s)) continue;
          if (prev !== null) {
            if (along.get(s) > prev) up++;
            else if (along.get(s) < prev) down++;
          }
          prev = along.get(s);
        }
        // (the busiest is the first way, also where it calls at a station twice and its steps go both ways)
        if (run === sorted[0]) directions[0].push(run);
        else if (up === down) unsure.push(run);
        else directions[down > up ? 1 : 0].push(run);
      }
      if (unsure.length && directions[1].length) {
        const lists = directions.map((group) => wayOf(group).list);
        for (const run of unsure) directions[branchedOff(lists[1], run.seq) < branchedOff(lists[0], run.seq) ? 1 : 0].push(run);
        for (const group of directions) group.sort((a, b) => b.trips - a.trips || b.seq.length - a.seq.length);
      } else directions[0].push(...unsure);
      for (const group of directions) if (group.length) ways.push(wayOf(group));
    }
    this.waysOfLines.set(index, ways);
    return ways;
  }

  /** Which of the ways of line number `index` (lineWays) trip t goes: -1 for none. */
  wayOfTrip(index, t) {
    return this.lineWays(index).findIndex((way) => way.patterns.has(this.tripPattern[t]));
  }

  /**
   * Where line number `index` runs on the day of `now`, as its view draws it
   * (#148): the routes of its trips of that day and of those of the day
   * before that have not arrived yet, each stretch between two stops once,
   * as lines [lat, lon, …]; the places of the stations they call at, [lat,
   * lon, …]; and the rectangle around those of them in the area, [south,
   * west, north, east], or around all where none is.
   */
  lineRoute(index, now) {
    // the ways its trips take: a pattern on the network of its route
    const ways = new Map();
    const add = (t) => {
      const route = this.tripRoute[t];
      if (this.tripLine[t] === index) ways.set(`${this.tripPattern[t]} ${this.routeNets[route]}`, [this.tripPattern[t], this.routeNets[route]]);
    };
    const today = localDate(now);
    for (const t of this.activeTrips(today)) add(t);
    // Yesterday's service day is still running after midnight (times > 24:00),
    // as for vehicles(): its trips that have not arrived yet, which are at the
    // end of those in the order of their last arrivals (see underWay).
    const yesterday = addDays(today, -1);
    const rel = now - serviceDayStart(yesterday);
    const { byEnd } = this.activeTrips(yesterday);
    for (let k = byEnd.length - 1; k >= 0; k--) {
      const t = byEnd[k];
      if (this.tripStart[t] + this.profileRun[this.tripProfile[t]] + TRAIL_S < rel) break;
      add(t);
    }
    const { lat, lon, region } = this.stops;
    const stopCount = this.stops.id.length;
    const widen = (box, y, x) => (box ? [Math.min(box[0], y), Math.min(box[1], x), Math.max(box[2], y), Math.max(box[3], x)] : [y, x, y, x]);
    const drawn = new Set(); // the stretches, by their keys (hopKey)
    const stations = new Set();
    const paths = [];
    let inArea = null;
    let all = null;
    for (const [pattern, net] of ways.values()) {
      // (one line goes on as long as the stretches are new)
      let path = null;
      const end = this.patternStart[pattern + 1];
      for (let k = this.patternStart[pattern]; k < end; k++) {
        const stop = this.patternStops[k];
        const station = this.stationOf[stop];
        stations.add(station);
        all = widen(all, lat[station], lon[station]);
        if (region[stop]) inArea = widen(inArea, lat[station], lon[station]);
        if (k + 1 === end) break;
        const next = this.patternStops[k + 1];
        const key = hopKey(net, stop, next, stopCount);
        if (drawn.has(key)) {
          path = null;
          continue;
        }
        drawn.add(key);
        if (!path) paths.push((path = []));
        const s = this.segmentOf(key);
        if (s < 0) {
          path.push(round5(lat[stop]), round5(lon[stop]), round5(lat[next]), round5(lon[next]));
          continue;
        }
        const walk = this.walk.along(s);
        path.push(walk.lat / 1e5, walk.lon / 1e5);
        while (walk.more()) {
          walk.next();
          path.push(walk.lat / 1e5, walk.lon / 1e5);
        }
      }
    }
    return {
      paths,
      stations: [...stations].flatMap((s) => [round5(lat[s]), round5(lon[s])]),
      bounds: (inArea ?? all)?.map(round5) ?? null,
    };
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
      // (the place of its line, which asks for that among those of its name, #152)
      lineAt: this.lines[this.tripLine[t]].place,
      realtime: row >= 0,
      // Who provides the realtime data of this trip, if the feed says so.
      source: realtime?.sourceOf(t) ?? null,
      cancelled: row >= 0 && realtime.cancelled[row] === 1,
      notes: realtime?.notesOfTrip(t) ?? [],
      path,
      stops: Array.from(stops, (s, p) => ({
        station: this.stops.id.get(this.stationOf[s]),
        name: this.stops.name[s],
        // (the town of its station, which the page shows where the name does not say it, #246)
        town: this.towns[this.stops.town[this.stationOf[s]]]?.name ?? null,
        platform: this.stops.platform[s],
        lat: this.stops.lat[s],
        lon: this.stops.lon[s],
        arr: base + this.schedArr(t, p),
        dep: base + this.schedDep(t, p),
        arrDelay: row < 0 ? null : realtime.arrDelay(row, p),
        depDelay: row < 0 ? null : realtime.depDelay(row, p),
        skipped: row >= 0 && realtime.skipped(row, p),
        to: this.headsignAt(t, p),
      })),
    };
  }

  /**
   * Departures from a station (all its platforms): those of the next
   * `windowS` seconds, `limit` at most, and where they are fewer than
   * `least`, the next ones after them up to `least`, from the next
   * `furthestS` seconds (#165). So a quiet stop, at night above all, shows
   * when its next train leaves, however far ahead that is.
   * @param lines the lines and directions to show (public/choice.js), every
   *   one where none: chosen before the limit, so that a busy station has as
   *   many of them as a quiet one (#164)
   */
  departures(stationId, now, realtime, { windowS = 7200, limit = 40, least = 10, furthestS = 86_400, lines = [] } = {}) {
    const station = this.stopIndex.get(stationId);
    if (station === undefined || this.visitStart[station] === this.visitStart[station + 1]) return null;

    // (whether a line with its next station is chosen, once for each: the names are written as keys to be compared)
    const chosen = new Map();
    const keep = lines.length ? (t, next) => {
      const route = this.tripRoute[t];
      const id = `${route} ${next}`;
      if (!chosen.has(id)) chosen.set(id, inChoice(lines, { mode: this.routeModes[route], line: this.lineName(route), next: next < 0 ? null : this.stops.name[this.stationOf[next]] }));
      return chosen.get(id);
    } : null;
    let found = this.leaving(station, now, realtime, windowS, keep).slice(0, limit);
    // (the longer search only where it is needed: a busy station has enough within the window)
    if (found.length < least) found = this.leaving(station, now, realtime, furthestS, keep).slice(0, least);
    return {
      id: stationId,
      name: this.stops.name[station],
      // (the town it is in, where one is known: its details show it where the name does not say it, #254)
      town: this.towns[this.stops.town[station]]?.name ?? null,
      lat: this.stops.lat[station],
      lon: this.stops.lon[station],
      notes: realtime?.notesOfStation(station) ?? [],
      departures: found.map((leaves) => this.departureOf(leaves, realtime)),
    };
  }

  /** A departure as the board lists it, from what leaving() found. */
  departureOf({ t, p, date, planned, delay, cancelled }, realtime) {
    const route = this.tripRoute[t];
    return {
      trip: `${this.tripId(t)}_${date}`,
      line: this.lineName(route),
      mode: this.routeModes[route],
      to: this.headsignAt(t, p),
      platform: this.stops.platform[this.patternStops[this.patternStart[this.tripPattern[t]] + p]],
      planned,
      delay,
      cancelled,
      // What is wrong with the trip right now, for a list that marks such a departure.
      warnings: realtime?.warningsOfTrip(t) ?? [],
    };
  }

  /**
   * Every line that leaves a station, with each way it goes from there and
   * when it next leaves that way (#255). The ways are those of directions():
   * by the next station of its trips, named by the destination most of them
   * have here; those of a line with the same name are one, as a train that
   * leaves for one place by several next stops goes there all the same. Of
   * each, the next departure of the next `windowS` seconds that runs, or none.
   * @returns [{ index, name, mode, agency, at, ways: [{ to, departure }] }]:
   *   `index` is the number of the line (its address, Addresses.linePath), `at`
   *   its place; by kind, then by line as names of lines are sorted, the
   *   busier way first; null for an unknown station
   */
  linesAt(stationId, now, realtime, { windowS = 86_400 } = {}) {
    const station = this.stopIndex.get(stationId);
    if (station === undefined) return null;
    // (each line and its ways by their next station, with how many trips go which way)
    const found = new Map(); // line number → Map(next station → { trips, to })
    for (let visit = this.visitStart[station]; visit < this.visitStart[station + 1]; visit++) {
      const pattern = this.visitPattern[visit];
      const p = this.visitPosition[visit];
      const next = this.nextStation(pattern, p);
      if (next < 0) continue; // (its end: nothing leaves)
      for (let k = this.patternFirst[pattern]; k < this.patternFirst[pattern + 1]; k++) {
        const t = this.tripsOfPattern[k];
        const ways = found.get(this.tripLine[t]) ?? found.set(this.tripLine[t], new Map()).get(this.tripLine[t]);
        const way = ways.get(this.stationOf[next]) ?? ways.set(this.stationOf[next], { trips: 0, to: new Map() }).get(this.stationOf[next]);
        way.trips++;
        const to = this.headsignAt(t, p);
        way.to.set(to, (way.to.get(to) ?? 0) + 1);
      }
    }
    const lines = [];
    const wayOf = new Map(); // `${line number} ${next station}` → the way it is listed in
    for (const [index, byNext] of found) {
      const ways = [];
      for (const [next, { trips, to }] of [...byNext].sort((a, b) => b[1].trips - a[1].trips)) {
        const name = [...to].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
        const way = ways.find((other) => other.to === name) ?? ways[ways.push({ to: name, trips, departure: null }) - 1];
        wayOf.set(`${index} ${next}`, way);
      }
      const { name, mode, agency, place } = this.lines[index];
      lines.push({ index, name, mode, agency, at: place, ways });
    }
    // the next departure each way, of those that run
    let open = lines.reduce((sum, line) => sum + line.ways.length, 0);
    for (const leaves of this.leaving(station, now, realtime, windowS)) {
      if (leaves.cancelled) continue;
      const next = this.nextStation(this.tripPattern[leaves.t], leaves.p);
      const way = wayOf.get(`${this.tripLine[leaves.t]} ${this.stationOf[next]}`);
      if (!way || way.departure) continue;
      way.departure = this.departureOf(leaves, realtime);
      if (--open === 0) break;
    }
    return lines
      .sort((a, b) => MODES.indexOf(a.mode) - MODES.indexOf(b.mode) || a.name.localeCompare(b.name, undefined, { numeric: true }) || (a.agency ?? '').localeCompare(b.agency ?? ''))
      .map(({ ways, ...line }) => ({ ...line, ways: ways.map(({ to, departure }) => ({ to, departure })) }));
  }

  /**
   * The lines that leave a station and where each goes next (#164), for
   * choosing among them: every one the timetable has there, on any of its
   * days. A direction is a line with the next station of its trips; it is
   * named by the destination most of them have here, and leaves the stop
   * the way the bearing to that station says.
   * @returns [{ line, mode, next, to, heading, key }], by kind, then by line
   *   as names of lines are sorted, then the busier direction first; null for
   *   an unknown station
   */
  directions(stationId) {
    const station = this.stopIndex.get(stationId);
    if (station === undefined) return null;
    const found = new Map();
    for (let visit = this.visitStart[station]; visit < this.visitStart[station + 1]; visit++) {
      const pattern = this.visitPattern[visit];
      const p = this.visitPosition[visit];
      const next = this.nextStation(pattern, p);
      if (next < 0) continue; // (its end: nothing leaves)
      const stop = this.patternStops[this.patternStart[pattern] + p];
      for (let k = this.patternFirst[pattern]; k < this.patternFirst[pattern + 1]; k++) {
        const t = this.tripsOfPattern[k];
        const route = this.tripRoute[t];
        const direction = { mode: this.routeModes[route], line: this.lineName(route), next: this.stops.name[this.stationOf[next]] };
        const key = choiceKey(direction);
        if (!found.has(key)) found.set(key, { ...direction, trips: 0, to: new Map(), heading: bearing(this.stops.lat[stop], this.stops.lon[stop], this.stops.lat[next], this.stops.lon[next]) });
        const entry = found.get(key);
        entry.trips++;
        const to = this.headsignAt(t, p);
        entry.to.set(to, (entry.to.get(to) ?? 0) + 1);
      }
    }
    const lineOrder = (a, b) => MODES.indexOf(a.mode) - MODES.indexOf(b.mode) || a.line.localeCompare(b.line, undefined, { numeric: true });
    return [...found.entries()]
      .map(([key, { to, trips, ...direction }]) => ({ ...direction, to: [...to].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], key, trips }))
      .sort((a, b) => lineOrder(a, b) || b.trips - a.trips || a.next.localeCompare(b.next))
      .map(({ mode, line, next, to, heading, key }) => ({ mode, line, next, to, heading, key }));
  }

  /**
   * The stop a trip of the pattern comes to after position p at the next
   * other station: a trip may call at two platforms of one station in a row.
   * -1 where none comes.
   */
  nextStation(pattern, p) {
    const start = this.patternStart[pattern];
    const here = this.stationOf[this.patternStops[start + p]];
    for (let k = start + p + 1; k < this.patternStart[pattern + 1]; k++) if (this.stationOf[this.patternStops[k]] !== here) return this.patternStops[k];
    return -1;
  }

  /**
   * What leaves a station (by its number) within `windowS` seconds of `now`,
   * by when it leaves. A day ahead at most: the service days looked at are
   * yesterday, today and tomorrow.
   * @param keep where only some lines are wanted: whether trip t, coming to
   *   the stop `next` (nextStation) from here, is one of them
   */
  leaving(station, now, realtime, windowS, keep = null) {
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
        const next = keep ? this.nextStation(pattern, p) : -1;
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
          if (keep && !keep(t, next)) continue;
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
    return found;
  }
}

/**
 * How many stations of a run would be on branches off a list of stations
 * (wayOf): those of its parts the list does not have that are neither
 * between two of its stations nor beyond one of its ends. Going from one of
 * its stations back to one before it counts as all of them.
 */
function branchedOff(list, seq) {
  const at = new Map(list.map((s, i) => [s, i]));
  let off = 0;
  let last = -1;
  for (let k = 0; k < seq.length;) {
    if (at.has(seq[k])) {
      if (at.get(seq[k]) < last) off += list.length;
      last = at.get(seq[k]);
      k++;
      continue;
    }
    let e = k;
    while (e < seq.length && !at.has(seq[e])) e++;
    const a = k > 0 ? at.get(seq[k - 1]) : -1;
    const b = e < seq.length ? at.get(seq[e]) : -1;
    if (!((a >= 0 && b > a) || (a === list.length - 1 && b < 0) || (a < 0 && b === 0))) off += e - k;
    k = e;
  }
  return off;
}

/**
 * The way of a line in one direction (Timetable.lineWays), from the runs that
 * go that way, the busiest first: { seq, trips, to, patterns } each, `to` how
 * many of its trips show which destination at their start.
 */
function wayOf(runs) {
  const list = [...runs[0].seq];
  const branches = [];
  for (const run of runs.slice(1)) {
    let at = new Map(list.map((s, i) => [s, i]));
    for (let k = 0; k < run.seq.length;) {
      if (at.has(run.seq[k])) {
        k++;
        continue;
      }
      // (a part of the run that the list does not have, and the stations of the list before and after it)
      let e = k;
      while (e < run.seq.length && !at.has(run.seq[e])) e++;
      const part = run.seq.slice(k, e);
      const a = k > 0 ? at.get(run.seq[k - 1]) : -1;
      const b = e < run.seq.length ? at.get(run.seq[e]) : -1;
      if (a >= 0 && b > a) list.splice(b, 0, ...part);
      else if (a >= 0 && b < 0 && a === list.length - 1) list.push(...part);
      else if (a < 0 && b === 0) list.unshift(...part);
      else branches.push({ after: a >= 0 ? list[a] : null, before: b >= 0 ? list[b] : null, stations: part });
      at = new Map(list.map((s, i) => [s, i]));
      k = e;
    }
  }
  // (a station of a branch that a later run put in the list is no longer on it, nor one of an earlier branch)
  const listed = new Set(list);
  const branched = new Set();
  const kept = [];
  for (const { after, before, stations } of branches) {
    const own = stations.filter((s) => !listed.has(s) && !branched.has(s));
    for (const s of own) branched.add(s);
    if (own.length) kept.push({ after: after === null ? null : list.indexOf(after), before: before === null ? null : list.indexOf(before), stations: own });
  }
  const count = (pick) => {
    const counts = new Map();
    for (const run of runs) counts.set(pick(run), (counts.get(pick(run)) ?? 0) + run.trips);
    return counts;
  };
  // (the destination shown over most of the way, trips by the stations they go: not that of short runs, however many)
  const to = new Map();
  for (const run of runs) for (const [name, n] of run.to) to.set(name, (to.get(name) ?? 0) + n * run.seq.length);
  return {
    to: [...to].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0],
    list,
    branches: kept,
    trips: runs.reduce((n, run) => n + run.trips, 0),
    starts: count((run) => run.seq[0]),
    ends: count((run) => run.seq.at(-1)),
    patterns: new Set(runs.flatMap((run) => run.patterns)),
  };
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
