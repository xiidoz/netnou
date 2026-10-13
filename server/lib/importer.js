// Cuts the nationwide GTFS feed down to what the instance covers – the trips
// that serve at least one stop inside the configured area, those of the
// operators named, or everything – and returns them as a dataset: columns of
// numbers in which every stop sequence and every set of running times is
// stored once (see buildDataset for the layout).

import { NEAR, agencyKey, scopeId } from './area.js';
import { eachLine, parseCsvLine } from './csv.js';
import { DATASET_VERSION, Numbers, SharedLists, Texts, byteOrder } from './dataset.js';
import { addDays, weekday } from './time.js';
import { findSharedWays } from './timetable.js';
import { openZip } from './zip.js';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Substrings of a chunk keep the whole chunk alive. Anything that outlives the
// current chunk has to be copied out of it.
const detach = (s) => Buffer.from(s, 'utf8').toString('utf8');

// Index of `value` in `list`; a new value is appended first. `index` maps the
// values of the list to their positions.
function intern(value, list, index) {
  let i = index.get(value);
  if (i === undefined) {
    i = list.length;
    const own = detach(value);
    list.push(own);
    index.set(own, i);
  }
  return i;
}

/** Column name -> position, from the first line of a table. */
function headerIndex(line, file, required) {
  const col = {};
  // Some exporters put a byte order mark in front of the first column name.
  parseCsvLine(line.replace(/^\uFEFF/, '')).forEach((name, i) => { col[name.trim()] = i; });
  for (const name of required) {
    if (col[name] === undefined) throw new Error(`${file}: missing column ${name}`);
  }
  return col;
}

async function readTable(zip, file, required, onRow) {
  let col = null;
  await eachLine(await zip.stream(file), (line) => {
    if (!line) return;
    if (!col) col = headerIndex(line, file, required);
    else onRow(parseCsvLine(line), col);
  });
}

function parseTime(s) {
  if (!s) return NaN;
  const a = s.indexOf(':');
  return +s.slice(0, a) * 3600 + +s.slice(a + 1, a + 3) * 60 + +s.slice(a + 4);
}

// GTFS allows empty times at non-timepoints; fill them from the other event of
// the same stop or, failing that, linearly between the neighbouring stops.
function fillTimes(arr, dep) {
  const n = arr.length;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(arr[i])) arr[i] = dep[i];
    if (Number.isNaN(dep[i])) dep[i] = arr[i];
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(arr[i])) continue;
    let j = i;
    while (j < n && Number.isNaN(arr[j])) j++;
    if (i === 0 || j === n) return false;
    const from = dep[i - 1];
    const step = (arr[j] - from) / (j - i + 1);
    for (let k = i; k < j; k++) arr[k] = dep[k] = Math.round(from + step * (k - i + 1));
    i = j;
  }
  return true;
}

/**
 * The ids of the trips of the operators named, for a feed of which only
 * theirs are wanted. A name the feed does not have is an error of the
 * operator of the instance: it is named, with what the feed has that is like it.
 * @param agencies [{ name: as set, key: as compared }]
 */
async function findAgencyTrips(zip, agencies) {
  const wanted = new Map(agencies.map(({ name, key }) => [key, name]));
  const found = new Set();
  const ids = new Set(); // agency_id of the operators named
  const names = [];
  if (zip.entries.has('agency.txt')) {
    await readTable(zip, 'agency.txt', ['agency_name'], (f, col) => {
      names.push(f[col.agency_name]);
      const key = agencyKey(f[col.agency_name]);
      if (!wanted.has(key)) return;
      found.add(key);
      ids.add(col.agency_id === undefined ? '' : f[col.agency_id]);
    });
  }
  const missing = [...wanted].filter(([key]) => !found.has(key)).map(([key, name]) => {
    // (what the feed has with these words in it, in case the name is only written differently)
    const like = names.filter((other) => key.split(/\s+/).some((word) => word.length > 3 && agencyKey(other).includes(word))).slice(0, 5);
    return `"${name}"${like.length ? ` (it has ${like.map((other) => `"${other}"`).join(', ')})` : ''}`;
  });
  if (missing.length) {
    throw new Error(`the feed has no operator ${missing.join(' and none called ')}; NETNOU_AGENCIES takes the names as agency.txt of the feed has them (agency_name), of which there are ${names.length}`);
  }

  const routes = new Set();
  await readTable(zip, 'routes.txt', ['route_id'], (f, col) => {
    if (ids.has(col.agency_id === undefined ? '' : f[col.agency_id])) routes.add(detach(f[col.route_id]));
  });
  const trips = new Set();
  await readTable(zip, 'trips.txt', ['trip_id', 'route_id'], (f, col) => {
    if (routes.has(f[col.route_id])) trips.add(detach(f[col.trip_id]));
  });
  return trips;
}

async function findRegionStops(zip, area) {
  const region = new Set();
  await readTable(zip, 'stops.txt', ['stop_id', 'stop_lat', 'stop_lon'], (f, col) => {
    if (area.distance(+f[col.stop_lat], +f[col.stop_lon]) <= NEAR.region) region.add(detach(f[col.stop_id]));
  });
  return region;
}

/**
 * Collects trips and stores what repeats among them once: the sequence of
 * stops of a trip, its running times and its stop sequence numbers are each
 * looked up among those of the trips before it. A trip itself is a row of
 * numbers.
 */
export class TripCollector {
  /** @param options.hash for tests, see SharedLists */
  constructor(options = {}) {
    this.patterns = new SharedLists(options);
    this.profiles = new SharedLists(options);
    this.seqLists = new SharedLists(options);
    this.ids = [];
    this.index = new Map(); // trip id -> its number
    this.pattern = new Numbers(); // -1 once a trip was taken out again
    this.profile = new Numbers();
    this.start = new Numbers();
    this.seq = new Numbers();
    this.headsign = new Numbers();
    // Where a trip stands among all of them: the order in which the feed first names them.
    this.rank = new Numbers();
    this.times = new Int32Array(1 << 10);
  }

  /**
   * @param rows of one trip in the order of its stops: { stops, arr, dep, seq },
   *   the times whole seconds since the start of the service day
   * @param headsign index of its headsign, or -1
   * @param rank where it stands among the trips; after those before it unless given
   * @returns the number of the trip
   */
  add(id, { stops, arr, dep, seq }, headsign = -1, rank = this.ids.length) {
    const n = stops.length;
    if (this.times.length < 2 * n) this.times = new Int32Array(4 * n);
    // Arrival and departure at each stop, counted from the first departure.
    for (let i = 0; i < n; i++) {
      this.times[2 * i] = arr[i] - dep[0];
      this.times[2 * i + 1] = dep[i] - dep[0];
    }
    const t = this.ids.length;
    this.ids.push(id);
    this.index.set(id, t);
    this.pattern.push(this.patterns.add(stops, n));
    this.profile.push(this.profiles.add(this.times, 2 * n));
    this.start.push(dep[0]);
    // stop_sequence is almost always 0..n-1; only store it when it is not.
    this.seq.push(seq.every((value, i) => value === i) ? -1 : this.seqLists.add(seq, n));
    this.headsign.push(headsign);
    this.rank.push(rank);
    return t;
  }

  /** The rows of a trip again, as add() got them. */
  rows(t) {
    const pattern = this.pattern.array[t];
    const from = this.patterns.start.array[pattern];
    const n = this.patterns.end(pattern) - from;
    const times = this.profiles.start.array[this.profile.array[t]];
    const numbers = this.seq.array[t] < 0 ? -1 : this.seqLists.start.array[this.seq.array[t]];
    const rows = { stops: [], arr: [], dep: [], seq: [] };
    for (let i = 0; i < n; i++) {
      rows.stops.push(this.patterns.values.array[from + i]);
      rows.arr.push(this.start.array[t] + this.profiles.values.array[times + 2 * i]);
      rows.dep.push(this.start.array[t] + this.profiles.values.array[times + 2 * i + 1]);
      rows.seq.push(numbers < 0 ? i : this.seqLists.values.array[numbers + i]);
    }
    return rows;
  }

  /** Takes a trip out again. What it shared with others stays. */
  drop(t) {
    this.pattern.array[t] = -1;
    this.index.delete(this.ids[t]);
  }
}

/**
 * @param regionStops the ids of the stops in the area, or null where there is no area: every stop counts
 * @param wantedTrips the ids of the trips of the operators named, or null for those of all
 */
async function readStopTimes(zip, regionStops, wantedTrips, onProgress) {
  const file = 'stop_times.txt';
  const stopIds = [];
  const stopIndex = new Map();
  const headsigns = [];
  const headsignIndex = new Map();
  const collector = new TripCollector();
  // Trips that cannot be stored yet: a stop without times, or a single row.
  // More rows of them may follow, and what is still missing at the end is
  // filled in or the trip is dropped. trip id -> { rows, headsign, rank }
  const waiting = new Map();
  let ranks = 0;

  let col = null;
  let iTrip = 0;
  let iStop = 0;
  let lastFast = 0;
  let lines = 0;
  let curId = null;
  let curLines = [];
  let curHit = false;
  let curWanted = true; // (of an operator that is kept)

  const whole = ({ stops, arr, dep }) => stops.length >= 2 && !arr.some(Number.isNaN) && !dep.some(Number.isNaN);
  const sorted = (rows) => {
    const { seq } = rows;
    if (seq.every((value, i) => !i || value > seq[i - 1])) return rows;
    const order = seq.map((_, i) => i).sort((a, b) => seq[a] - seq[b]);
    return Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, order.map((i) => values[i])]));
  };

  // Rows of one trip are contiguous in the gtfs.de feed, so a trip can be
  // accepted or dropped as soon as its id changes. Should a trip ever show up
  // in two runs, the rows of both are put together and sorted.
  const flush = () => {
    if (curHit) {
      let rows = { stops: [], arr: [], dep: [], seq: [] };
      let headsign = -1;
      let rank;
      const before = waiting.get(curId);
      const known = collector.index.get(curId);
      if (before) {
        ({ rows, headsign, rank } = before);
      } else if (known !== undefined) {
        rows = collector.rows(known);
        headsign = collector.headsign.array[known];
        rank = collector.rank.array[known];
        collector.drop(known);
      } else {
        rank = ranks++;
      }
      for (const line of curLines) {
        const f = parseCsvLine(line);
        rows.stops.push(intern(f[iStop], stopIds, stopIndex));
        rows.arr.push(parseTime(f[col.arrival_time]));
        rows.dep.push(parseTime(f[col.departure_time]));
        rows.seq.push(+f[col.stop_sequence]);
        if (headsign === -1 && col.stop_headsign !== undefined && f[col.stop_headsign]) {
          headsign = intern(f[col.stop_headsign], headsigns, headsignIndex);
        }
      }
      if (whole(rows)) {
        waiting.delete(curId);
        collector.add(detach(curId), sorted(rows), headsign, rank);
      } else {
        waiting.set(before ? curId : detach(curId), { rows, headsign, rank });
      }
    }
    curLines = [];
    curHit = false;
  };

  await eachLine(await zip.stream(file), (line) => {
    if (!line) return;
    if (!col) {
      col = headerIndex(line, file, ['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence']);
      iTrip = col.trip_id;
      iStop = col.stop_id;
      lastFast = Math.max(iTrip, iStop);
      return;
    }
    if (++lines % 5_000_000 === 0) onProgress(`${file}: ${lines / 1e6} million rows, ${collector.index.size} trips kept`);

    // Only trip_id and stop_id are needed to decide whether the trip matters,
    // so the full CSV parse is deferred to flush() for the few trips we keep.
    let tripId;
    let stopId;
    let pos = 0;
    for (let i = 0; i <= lastFast; i++) {
      let c = line.indexOf(',', pos);
      if (c === -1) c = line.length;
      if (i === iTrip) tripId = line.slice(pos, c);
      if (i === iStop) stopId = line.slice(pos, c);
      pos = c + 1;
    }
    const quote = line.indexOf('"');
    if (quote !== -1 && quote < pos) {
      const f = parseCsvLine(line);
      tripId = f[iTrip];
      stopId = f[iStop];
    }

    if (tripId !== curId) {
      flush();
      curId = tripId;
      curWanted = !wantedTrips || wantedTrips.has(tripId);
    }
    if (!curWanted) return;
    curLines.push(line);
    if (!curHit && (!regionStops || regionStops.has(stopId))) curHit = true;
  });
  flush();

  // GTFS allows empty times at non-timepoints: they are filled in, if that
  // can be done. A trip of a single stop goes nowhere.
  for (const [id, { rows, headsign, rank }] of waiting) {
    const filled = sorted(rows);
    if (filled.stops.length >= 2 && fillTimes(filled.arr, filled.dep)) collector.add(id, filled, headsign, rank);
  }

  return { collector, stopIds, headsigns, headsignIndex, lines };
}

async function readServices(zip, serviceIds) {
  const dates = new Map(); // service_id -> Set of yyyymmdd
  for (const id of serviceIds) dates.set(id, new Set());

  if (zip.entries.has('calendar.txt')) {
    await readTable(zip, 'calendar.txt', ['service_id', 'start_date', 'end_date', ...WEEKDAYS], (f, col) => {
      const set = dates.get(f[col.service_id]);
      if (!set) return;
      const end = f[col.end_date];
      for (let d = f[col.start_date]; d <= end; d = addDays(d, 1)) {
        if (f[col[WEEKDAYS[weekday(d)]]] === '1') set.add(d);
      }
    });
  }
  if (zip.entries.has('calendar_dates.txt')) {
    await readTable(zip, 'calendar_dates.txt', ['service_id', 'date', 'exception_type'], (f, col) => {
      const set = dates.get(f[col.service_id]);
      if (!set) return;
      if (f[col.exception_type] === '1') set.add(f[col.date]);
      else if (f[col.exception_type] === '2') set.delete(f[col.date]);
    });
  }
  return dates;
}

/**
 * Puts a dataset together from the trips collected and what belongs to them.
 * A trip without a route that the feed knows is left out. The trips stay in
 * the order in which the feed first names them; beside them is the list of
 * all trips in the order of their ids, in which a trip is found by its id.
 * @param route, service  for each trip of the collector the index of its route and service, or -1
 */
function assemble({ area, stops, routes, headsigns, dates, services, collector, route, service }) {
  const kept = [];
  for (let t = 0; t < collector.ids.length; t++) {
    if (collector.pattern.array[t] >= 0 && route[t] >= 0 && routes.type[route[t]] !== undefined) kept.push(t);
  }
  const rank = collector.rank.array;
  kept.sort((a, b) => rank[a] - rank[b]);
  const column = (values) => Int32Array.from(kept, (t) => values[t]);
  const ids = kept.map((t) => collector.ids[t]);
  /** The places of texts in the order of their bytes: where one is found by going through them (finder in timetable.js). */
  const ordered = (texts) => {
    // (plain "<" is the order of the bytes unless a character from the far end of Unicode is among them)
    const inOrder = texts.some((text) => /[\uD800-\uFFFF]/.test(text)) ? byteOrder : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    return Int32Array.from(texts, (_, i) => i).sort((a, b) => inOrder(texts[a], texts[b]));
  };
  const byId = ordered(ids);

  const patterns = collector.patterns.done();
  const profiles = collector.profiles.done();
  const seqLists = collector.seqLists.done();
  const data = {
    version: DATASET_VERSION,
    area,
    stops: {
      id: Texts.from(stops.id),
      byId: ordered(stops.id),
      name: stops.name,
      platform: stops.platform,
      lat: Float64Array.from(stops.lat),
      lon: Float64Array.from(stops.lon),
      parent: Int32Array.from(stops.parent),
      region: Uint8Array.from(stops.region),
    },
    routes,
    headsigns,
    dates,
    services,
    patterns: { start: patterns.start, stops: patterns.values },
    profiles: { start: profiles.start, times: profiles.values },
    seqLists: { start: seqLists.start, seq: seqLists.values },
    trips: {
      id: Texts.from(ids),
      byId,
      pattern: column(collector.pattern.array),
      profile: column(collector.profile.array),
      start: column(collector.start.array),
      seq: column(collector.seq.array),
      route: column(route),
      service: column(service),
      headsign: column(collector.headsign.array),
    },
    segments: null,
  };
  // (what was only needed to get here; the search that follows needs room of its own)
  collector.index.clear();
  collector.ids.length = 0;
  data.sharedWays = findSharedWays(data);
  return data;
}

/**
 * A dataset from trips given one by one, each with the arrays of its own:
 * what a test or a tool has at hand.
 * @param plain { area, stops: { id, name, lat, lon, parent, platform, region }, routes, headsigns, dates, services,
 *   trips: { id, route, service, headsign, stops: [[stop index]], arr, dep: [[seconds]], seq: [[number] or null] } }
 * @param options for the TripCollector
 */
export function packDataset({ area = null, stops, routes, headsigns, dates, services, trips }, options) {
  const collector = new TripCollector(options);
  trips.id.forEach((id, t) => {
    collector.add(id, { stops: trips.stops[t], arr: trips.arr[t], dep: trips.dep[t], seq: trips.seq[t] ?? trips.stops[t].map((_, i) => i) }, trips.headsign[t]);
  });
  return assemble({ area, stops, routes, headsigns, dates, services, collector, route: trips.route, service: trips.service });
}

// Dataset layout (stored as NETNOU_DATA_DIR/dataset.bin, see dataset.js for
// the file). Index i of every array in a group describes the same stop,
// route or trip. A typed array is a column of the file; "texts" is a Texts.
//   version    DATASET_VERSION
//   area       what the dataset was cut for: the area and the operators
//              (scopeId in area.js)
//   source     { etag, lastModified, importedAt, osm } – which feed and OSM
//              data it was made from; added by import-worker.js
//   stops      { id: texts, byId: the stops in the order of their ids,
//                name, platform, lat, lon, parent: stop index or -1,
//                region: 1 if in the area or within NEAR.region of it, else
//                0; without an area every stop is 1 }
//   routes     { id, short, long, type: GTFS route_type, color, text,
//                agency: name }   (color and text are not used yet)
//   headsigns  [text]
//   dates      [yyyymmdd], sorted
//   services   [[index into dates]] – the days each service runs
//   patterns   the stop sequences, each once: { start, stops } – pattern i
//              is stops[start[i]] to stops[start[i + 1] - 1], stop indexes
//   profiles   the sets of running times, each once: { start, times } – for
//              every stop of a trip its arrival and its departure, in
//              seconds counted from the first departure of the trip
//   seqLists   the stop_sequence numbers of trips that do not count 0, 1, 2,
//              …, each list once: { start, seq }
//   trips      { id: texts, byId: the trips in the order of their ids,
//                pattern, profile, start: the first departure in seconds
//                since the start of the service day (may exceed 86400),
//                seq: index into seqLists or -1, route, service,
//                headsign: index or -1 }
//   sharedWays the ways from one stop to the next on which trains run
//              coupled, see findSharedWays in timetable.js
//   segments   route geometry per hop, or null; added by import-worker.js,
//              see buildSegments in shapes.js

/**
 * @param options.area the area, or null for an instance without one: every stop of the feed counts
 * @param options.agencies the operators whose trips are kept, [{ name, key }] as loadConfig has them, or null for all
 * @param {{zipPath: string, area: import('./area.js').Area | null, agencies?: {name: string, key: string}[] | null, onProgress?: (msg: string) => void}} options
 */
export async function buildDataset({ zipPath, area, agencies = null, onProgress = () => {} }) {
  const zip = await openZip(zipPath);
  try {
    let wantedTrips = null;
    if (agencies) {
      onProgress(`looking for the trips of ${agencies.map(({ name }) => name).join(', ')}`);
      wantedTrips = await findAgencyTrips(zip, agencies);
      onProgress(`${wantedTrips.size} trips of ${agencies.length === 1 ? 'that operator' : 'these operators'}`);
    }
    let regionStops = null;
    if (area) {
      onProgress('stops.txt: looking for stops in the area');
      regionStops = await findRegionStops(zip, area);
      if (regionStops.size === 0) {
        throw new Error('the feed has no stops in the area; check NETNOU_BBOX or NETNOU_AREA_FILE (NETNOU_BBOX is "south,west,north,east", GeoJSON positions are [longitude, latitude])');
      }
      onProgress(`${regionStops.size} stops in the area`);
    }

    const { collector, stopIds, headsigns, headsignIndex, lines } = await readStopTimes(zip, regionStops, wantedTrips, onProgress);
    onProgress(`stop_times.txt: ${lines} rows read, ${collector.index.size} trips kept`);
    wantedTrips?.clear();
    if (agencies && !collector.index.size) {
      throw new Error(area
        ? 'no trip of the operators in NETNOU_AGENCIES serves a stop in the area; NETNOU_AREA=all takes their trips wherever they run'
        : 'the operators in NETNOU_AGENCIES have no trips in the feed');
    }

    // trips.txt: route and service of every kept trip, and its headsign for
    // feeds that have none in stop_times.txt.
    const tripCount = collector.ids.length;
    const route = new Int32Array(tripCount).fill(-1);
    const service = new Int32Array(tripCount).fill(-1);
    const routeIds = [];
    const routeIndex = new Map();
    const serviceIds = [];
    const serviceIndex = new Map();
    await readTable(zip, 'trips.txt', ['trip_id', 'route_id', 'service_id'], (f, col) => {
      const t = collector.index.get(f[col.trip_id]);
      if (t === undefined) return;
      let r = routeIndex.get(f[col.route_id]);
      if (r === undefined) { r = routeIds.length; routeIds.push(f[col.route_id]); routeIndex.set(f[col.route_id], r); }
      let s = serviceIndex.get(f[col.service_id]);
      if (s === undefined) { s = serviceIds.length; serviceIds.push(f[col.service_id]); serviceIndex.set(f[col.service_id], s); }
      route[t] = r;
      service[t] = s;
      if (collector.headsign.array[t] === -1 && col.trip_headsign !== undefined && f[col.trip_headsign]) {
        collector.headsign.array[t] = intern(f[col.trip_headsign], headsigns, headsignIndex);
      }
    });

    const agencyNames = new Map();
    if (zip.entries.has('agency.txt')) {
      await readTable(zip, 'agency.txt', ['agency_name'], (f, col) => {
        agencyNames.set(col.agency_id === undefined ? '' : f[col.agency_id], f[col.agency_name]);
      });
    }

    const routes = { id: routeIds, short: [], long: [], type: [], color: [], text: [], agency: [] };
    await readTable(zip, 'routes.txt', ['route_id', 'route_type'], (f, col) => {
      const r = routeIndex.get(f[col.route_id]);
      if (r === undefined) return;
      const get = (name) => (col[name] === undefined ? '' : f[col[name]]);
      routes.short[r] = get('route_short_name');
      routes.long[r] = get('route_long_name');
      routes.type[r] = +f[col.route_type];
      routes.color[r] = get('route_color');
      routes.text[r] = get('route_text_color');
      routes.agency[r] = agencyNames.get(get('agency_id')) ?? '';
    });

    const serviceDates = await readServices(zip, serviceIds);
    const dates = [...new Set(serviceIds.flatMap((id) => [...serviceDates.get(id)]))].sort();
    const dateIndex = new Map(dates.map((d, i) => [d, i]));
    const services = serviceIds.map((id) => [...serviceDates.get(id)].map((d) => dateIndex.get(d)).sort((a, b) => a - b));

    // stops.txt again, now for every stop the kept trips touch (also outside
    // the area) and, in a further pass, their parent stations.
    const stopIndex = new Map(stopIds.map((id, i) => [id, i]));
    const stops = { id: stopIds, name: [], lat: [], lon: [], parent: [], platform: [], region: [] };
    const parentIds = [];
    for (let from = 0; from < stopIds.length;) {
      const to = stopIds.length;
      await readTable(zip, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'], (f, col) => {
        const i = stopIndex.get(f[col.stop_id]);
        if (i === undefined || i < from) return;
        stops.name[i] = f[col.stop_name];
        stops.lat[i] = +f[col.stop_lat];
        stops.lon[i] = +f[col.stop_lon];
        stops.platform[i] = col.platform_code === undefined ? '' : f[col.platform_code];
        stops.region[i] = !regionStops || regionStops.has(f[col.stop_id]) ? 1 : 0;
        parentIds[i] = col.parent_station === undefined ? '' : f[col.parent_station];
      });
      for (let i = from; i < to; i++) {
        const parent = parentIds[i];
        if (parent && !stopIndex.has(parent)) {
          stopIndex.set(parent, stopIds.length);
          stopIds.push(parent);
        }
      }
      from = to;
    }
    for (let i = 0; i < stopIds.length; i++) {
      stops.parent[i] = parentIds[i] ? stopIndex.get(parentIds[i]) : -1;
      // A stop that stop_times references but stops.txt lacks cannot be drawn.
      if (stops.lat[i] === undefined) throw new Error(`stops.txt: stop ${stopIds[i]} is referenced but missing`);
    }

    regionStops?.clear();
    stopIndex.clear();
    onProgress(`${collector.patterns.count} stop sequences and ${collector.profiles.count} sets of running times`);
    return assemble({ area: scopeId(area, agencies?.map(({ key }) => key) ?? null), stops, routes, headsigns, dates, services, collector, route, service });
  } finally {
    await zip.close();
  }
}
