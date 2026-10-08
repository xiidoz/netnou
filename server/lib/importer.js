// Cuts the nationwide GTFS feed down to the trips that serve at least one
// stop inside the configured area and returns them as one compact, columnar
// object (see buildDataset for the layout).

import { NEAR } from './area.js';
import { openZip } from './zip.js';
import { eachLine, parseCsvLine } from './csv.js';
import { addDays, weekday } from './time.js';

// Bump when the layout or the meaning of anything in the dataset changes,
// including `segments` (shapes.js) and what the importer puts into a field: a
// stored dataset of another version is discarded and imported again on start.
export const DATASET_VERSION = 5;

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

async function findRegionStops(zip, area) {
  const region = new Set();
  await readTable(zip, 'stops.txt', ['stop_id', 'stop_lat', 'stop_lon'], (f, col) => {
    if (area.distance(+f[col.stop_lat], +f[col.stop_lon]) <= NEAR.region) region.add(detach(f[col.stop_id]));
  });
  return region;
}

async function readStopTimes(zip, regionStops, onProgress) {
  const file = 'stop_times.txt';
  const stopIds = [];
  const stopIndex = new Map();
  const headsigns = [];
  const headsignIndex = new Map();
  const trips = new Map();

  let col = null;
  let iTrip = 0;
  let iStop = 0;
  let lastFast = 0;
  let lines = 0;
  let curId = null;
  let curLines = [];
  let curHit = false;

  // Rows of one trip are contiguous in the gtfs.de feed, so a trip can be
  // accepted or dropped as soon as its id changes. Should a trip ever show up
  // in two runs, the parts are merged and re-sorted below.
  const flush = () => {
    if (curHit) {
      let trip = trips.get(curId);
      if (!trip) {
        trip = { stops: [], arr: [], dep: [], seq: [], headsign: -1 };
        trips.set(detach(curId), trip);
      }
      for (const line of curLines) {
        const f = parseCsvLine(line);
        trip.stops.push(intern(f[iStop], stopIds, stopIndex));
        trip.arr.push(parseTime(f[col.arrival_time]));
        trip.dep.push(parseTime(f[col.departure_time]));
        trip.seq.push(+f[col.stop_sequence]);
        if (trip.headsign === -1 && col.stop_headsign !== undefined && f[col.stop_headsign]) {
          trip.headsign = intern(f[col.stop_headsign], headsigns, headsignIndex);
        }
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
    if (++lines % 5_000_000 === 0) onProgress(`${file}: ${lines / 1e6} million rows, ${trips.size} trips in the area`);

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
    }
    curLines.push(line);
    if (!curHit && regionStops.has(stopId)) curHit = true;
  });
  flush();

  for (const [id, trip] of trips) {
    const n = trip.seq.length;
    let sorted = true;
    for (let i = 1; i < n; i++) if (trip.seq[i] <= trip.seq[i - 1]) { sorted = false; break; }
    if (!sorted) {
      const order = trip.seq.map((_, i) => i).sort((a, b) => trip.seq[a] - trip.seq[b]);
      for (const key of ['stops', 'arr', 'dep', 'seq']) trip[key] = order.map((i) => trip[key][i]);
    }
    if (n < 2 || !fillTimes(trip.arr, trip.dep)) trips.delete(id);
  }

  return { trips, stopIds, headsigns, headsignIndex, lines };
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

// Dataset layout (stored gzipped as DATA_DIR/region.json.gz). Columnar: index i
// of every array in a group describes the same stop, route or trip.
//   version    DATASET_VERSION
//   area       Area.id of the area the dataset was cut for
//   source     { etag, lastModified, importedAt, osm } – which feed and OSM
//              data it was made from; added by import-worker.js
//   stops      { id, name, lat, lon, parent: stop index or -1, platform,
//                region: 1 if in the area or within NEAR.region of it, else 0 }
//   routes     { id, short, long, type: GTFS route_type, color, text,
//                agency: name }   (color and text are not used yet)
//   headsigns  [text]
//   dates      [yyyymmdd], sorted
//   services   [[index into dates]] – the days each service runs
//   trips      { id, route: index, service: index, headsign: index or -1,
//                stops: [[stop index]],
//                arr, dep: [[seconds since the start of the service day]], may
//                exceed 86400,
//                seq: [[stop_sequence]] or null where it is 0, 1, 2, … }
//   segments   route geometry per hop, or null; added by import-worker.js,
//              see buildSegments in shapes.js

/**
 * @param {{zipPath: string, area: import('./area.js').Area, onProgress?: (msg: string) => void}} options
 */
export async function buildDataset({ zipPath, area, onProgress = () => {} }) {
  const zip = await openZip(zipPath);
  try {
    onProgress('stops.txt: looking for stops in the area');
    const regionStops = await findRegionStops(zip, area);
    if (regionStops.size === 0) {
      throw new Error('the feed has no stops in the area; check BBOX or AREA_FILE (BBOX is "south,west,north,east", GeoJSON positions are [longitude, latitude])');
    }
    onProgress(`${regionStops.size} stops in the area`);

    const { trips, stopIds, headsigns, headsignIndex, lines } = await readStopTimes(zip, regionStops, onProgress);
    onProgress(`stop_times.txt: ${lines} rows read, ${trips.size} trips in the area`);

    // trips.txt: route and service of every kept trip, and its headsign for
    // feeds that have none in stop_times.txt.
    const routeIds = [];
    const routeIndex = new Map();
    const serviceIds = [];
    const serviceIndex = new Map();
    await readTable(zip, 'trips.txt', ['trip_id', 'route_id', 'service_id'], (f, col) => {
      const trip = trips.get(f[col.trip_id]);
      if (!trip) return;
      let r = routeIndex.get(f[col.route_id]);
      if (r === undefined) { r = routeIds.length; routeIds.push(f[col.route_id]); routeIndex.set(f[col.route_id], r); }
      let s = serviceIndex.get(f[col.service_id]);
      if (s === undefined) { s = serviceIds.length; serviceIds.push(f[col.service_id]); serviceIndex.set(f[col.service_id], s); }
      trip.route = r;
      trip.service = s;
      if (trip.headsign === -1 && col.trip_headsign !== undefined && f[col.trip_headsign]) {
        trip.headsign = intern(f[col.trip_headsign], headsigns, headsignIndex);
      }
    });

    const agencies = new Map();
    if (zip.entries.has('agency.txt')) {
      await readTable(zip, 'agency.txt', ['agency_name'], (f, col) => {
        agencies.set(col.agency_id === undefined ? '' : f[col.agency_id], f[col.agency_name]);
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
      routes.agency[r] = agencies.get(get('agency_id')) ?? '';
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
        stops.region[i] = regionStops.has(f[col.stop_id]) ? 1 : 0;
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

    const out = { id: [], route: [], service: [], headsign: [], stops: [], arr: [], dep: [], seq: [] };
    for (const [id, trip] of trips) {
      if (trip.route === undefined || routes.type[trip.route] === undefined) continue;
      out.id.push(id);
      out.route.push(trip.route);
      out.service.push(trip.service);
      out.headsign.push(trip.headsign);
      out.stops.push(trip.stops);
      out.arr.push(trip.arr);
      out.dep.push(trip.dep);
      // stop_sequence is almost always 0..n-1; only store it when it is not.
      out.seq.push(trip.seq.every((s, i) => s === i) ? null : trip.seq);
    }

    return { version: DATASET_VERSION, area: area.id, stops, routes, headsigns, dates, services, trips: out };
  } finally {
    await zip.close();
  }
}
