// In-memory view of the regional dataset produced by importer.js, plus the
// queries the API needs: vehicles right now, one trip, departures of a station.
//
// Terms used throughout server/:
//   area     the region covered (BBOX or AREA_FILE), see area.js
//   stop     a row of stops.txt, often a single platform
//   station  the stop that groups platforms (parent_station) – what the map
//            shows and a departure board is for
//   hop      two consecutive stops of a trip
//   segment  the routed geometry of a hop on one net (road, rail, subway or
//            tram), see shapes.js
//   knots    [time, lat, lon, …] along a vehicle's way ahead; the page
//            interpolates between them

import { NETS } from './network.js';
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

/** Key of the hop from stop index `from` to stop index `to` on network index `net` (see NETS). */
export const hopKey = (net, from, to, stopCount) => (net * stopCount + from) * stopCount + to;

// A vehicle is shown at its first stop shortly before departure and stays
// visible briefly after reaching its last stop.
const LEAD_S = 30;
const TRAIL_S = 15;
// How far into the future the knots sent to the browser reach. Must comfortably
// exceed the browser's polling interval so animation survives a missed poll.
const HORIZON_S = 90;
// In the reduced form of a vehicle (see lite()) the browser gets its position
// now and this many seconds ahead.
const LITE_AHEAD_S = 60;

const round5 = (x) => Math.round(x * 1e5) / 1e5;

export class Timetable {
  /**
   * @param data dataset from importer.js (plus segments from shapes.js)
   * @param area the Area the dataset was built for
   */
  constructor(data, area) {
    this.source = data.source ?? {};
    this.stops = data.stops;
    this.routes = data.routes;
    this.headsigns = data.headsigns;
    this.dates = data.dates;
    this.trips = data.trips;

    const tripCount = this.trips.id.length;
    this.tripCount = tripCount;
    this.tripIndex = new Map(this.trips.id.map((id, i) => [id, i]));
    this.dateIndex = new Map(this.dates.map((d, i) => [d, i]));
    this.routeModes = this.routes.type.map((type, r) => routeMode(type, this.routes.short[r]));

    // serviceOnDate[dateIdx][serviceIdx] = 1 if the service runs that day.
    this.serviceOnDate = this.dates.map(() => new Uint8Array(data.services.length));
    data.services.forEach((dateIdxs, s) => {
      for (const d of dateIdxs) this.serviceOnDate[d][s] = 1;
    });
    this.tripsOnDate = new Map();

    // Stations group the platforms of one stop; they are what the map shows
    // and what a departure board is requested for.
    const stopCount = this.stops.id.length;
    this.stationOf = new Int32Array(stopCount);
    for (let i = 0; i < stopCount; i++) this.stationOf[i] = this.stops.parent[i] >= 0 ? this.stops.parent[i] : i;
    this.stopIndex = new Map(this.stops.id.map((id, i) => [id, i]));

    // visits[station] = flat [trip, position, trip, position, …]
    this.visits = new Map();
    const stationModes = new Map();
    for (let t = 0; t < tripCount; t++) {
      const stops = this.trips.stops[t];
      const modeBit = 1 << MODES.indexOf(this.routeModes[this.trips.route[t]]);
      for (let p = 0; p < stops.length; p++) {
        if (!this.stops.region[stops[p]]) continue;
        const station = this.stationOf[stops[p]];
        let list = this.visits.get(station);
        if (!list) this.visits.set(station, (list = []));
        list.push(t, p);
        stationModes.set(station, (stationModes.get(station) ?? 0) | modeBit);
      }
    }

    this.stations = [...this.visits.keys()].map((s) => ({
      id: this.stops.id[s],
      name: this.stops.name[s],
      lat: round5(this.stops.lat[s]),
      lon: round5(this.stops.lon[s]),
      modes: MODES.filter((_, bit) => stationModes.get(s) & (1 << bit)),
    }));

    // Route geometry per hop (see shapes.js); absent until OSM data was loaded.
    // segFrac holds, for every point, the share of the hop's length covered so
    // far – a vehicle is assumed to move along the hop at constant speed.
    this.routeNets = this.routeModes.map((mode) => NETS.indexOf(NET_OF_MODE[mode]));
    this.segIndex = new Map();
    this.segPts = [];
    this.segFrac = [];
    const segments = data.segments;
    const kx = Math.cos(((area.bbox[0] + area.bbox[2]) / 2) * (Math.PI / 180));
    for (let i = 0; i < (segments?.pts.length ?? 0); i++) {
      const deltas = segments.pts[i];
      const pts = new Array(deltas.length);
      const frac = new Array(deltas.length / 2);
      let lat = 0;
      let lon = 0;
      let length = 0;
      for (let k = 0; k < deltas.length; k += 2) {
        lat += deltas[k];
        lon += deltas[k + 1];
        pts[k] = lat / 1e5;
        pts[k + 1] = lon / 1e5;
        if (k) length += Math.hypot(deltas[k], deltas[k + 1] * kx);
        frac[k / 2] = length;
      }
      for (let k = 0; k < frac.length; k++) frac[k] = length ? frac[k] / length : 1;
      this.segIndex.set(hopKey(NETS.indexOf(segments.nets[segments.net[i]]), segments.from[i], segments.to[i], stopCount), i);
      this.segPts.push(pts);
      this.segFrac.push(frac);
    }
  }

  /** Index of the route geometry for the hop from stop position p to p + 1, or -1. */
  segment(t, p) {
    const stops = this.trips.stops[t];
    const net = this.routeNets[this.trips.route[t]];
    return this.segIndex.get(hopKey(net, stops[p], stops[p + 1], this.stops.id.length)) ?? -1;
  }

  /**
   * Knots [time, lat, lon, …] describing where trip t is from `now` on, given
   * that stop position i is the one it left last. Follows the route geometry
   * where there is one and a straight line between the stops otherwise.
   */
  knots(t, arr, dep, i, last, now) {
    const stops = this.trips.stops[t];
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
        const pts = this.segPts[s];
        const frac = this.segFrac[s];
        const n = frac.length;
        let k = 0;
        // Of the points already passed only the last one is needed.
        if (!knots.length) while (k + 1 < n && t0 + (t1 - t0) * frac[k + 1] <= now) k++;
        for (; k < n; k++) {
          const time = t0 + (t1 - t0) * frac[k];
          knots.push(Math.round(time * 10) / 10, pts[2 * k], pts[2 * k + 1]);
          if (time > horizon) return knots;
        }
        endLat = pts[2 * n - 2];
        endLon = pts[2 * n - 1];
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

  seq(t, p) {
    const seq = this.trips.seq[t];
    return seq ? seq[p] : p;
  }

  headsign(t) {
    const h = this.trips.headsign[t];
    if (h >= 0) return this.headsigns[h];
    return this.stops.name[this.trips.stops[t].at(-1)];
  }

  /** What a line is called: its short name ("U1") or, lacking one, the long name. */
  lineName(route) {
    return this.routes.short[route] || this.routes.long[route];
  }

  /** Trips whose service runs on the given date, as an array of trip indexes. */
  activeTrips(date) {
    let list = this.tripsOnDate.get(date);
    if (!list) {
      const d = this.dateIndex.get(date);
      list = [];
      if (d !== undefined) {
        const active = this.serviceOnDate[d];
        const service = this.trips.service;
        for (let t = 0; t < this.tripCount; t++) if (active[service[t]]) list.push(t);
      }
      if (this.tripsOnDate.size > 6) this.tripsOnDate.clear();
      this.tripsOnDate.set(date, list);
    }
    return list;
  }

  runsOn(t, date) {
    const d = this.dateIndex.get(date);
    return d !== undefined && this.serviceOnDate[d][this.trips.service[t]] === 1;
  }

  /**
   * Predicted arrival/departure epoch seconds at every stop of a trip:
   * schedule plus realtime delay, forced to be non-decreasing because the
   * browser interpolates along these times.
   */
  times(t, date, rt) {
    const base = serviceDayStart(date);
    const schedArr = this.trips.arr[t];
    const schedDep = this.trips.dep[t];
    const n = schedArr.length;
    const arr = new Array(n);
    const dep = new Array(n);
    let prev = -Infinity;
    for (let i = 0; i < n; i++) {
      let a = base + schedArr[i] + (rt?.arrDelay[i] ?? 0);
      let d = base + schedDep[i] + (rt?.depDelay[i] ?? 0);
      if (a < prev) a = prev;
      if (d < a) d = a;
      arr[i] = a;
      dep[i] = d;
      prev = d;
    }
    return { arr, dep };
  }

  /**
   * Vehicles under way at `now` (epoch seconds), wherever they are: a trip is
   * followed along its whole run, also far outside the area – there without
   * route geometry, i.e. in straight lines between stops. The feed has no vehicle
   * positions, so each vehicle is described by "knots" – (time, lat, lon)
   * triples along its upcoming route – between which the browser interpolates.
   * `realtime` is a snapshot from buildRealtime() or null (schedule only).
   */
  vehicles(now, realtime) {
    const today = localDate(now);
    const out = [];

    // Yesterday's service day is still running after midnight (times > 24:00).
    for (const date of [addDays(today, -1), today]) {
      const rel = now - serviceDayStart(date);
      const rtTrips = realtime?.byDate.get(date);

      for (const t of this.activeTrips(date)) {
        const schedArr = this.trips.arr[t];
        const schedDep = this.trips.dep[t];
        const rt = rtTrips?.get(t);
        let first = 0;
        let last = schedArr.length - 1;
        if (rt) {
          if (rt.cancelled) continue;
          first = rt.first;
          last = rt.last;
        }
        if (rel < schedDep[first] + (rt?.depDelay[first] ?? 0) - LEAD_S) continue;
        if (rel > schedArr[last] + (rt?.arrDelay[last] ?? 0) + TRAIL_S) continue;

        const { arr, dep } = this.times(t, date, rt);

        // i = the stop the vehicle left most recently (or its first stop).
        let i = first;
        while (i < last && dep[i + 1] <= now) i++;

        const knots = this.knots(t, arr, dep, i, last, now);
        const [lat, lon] = positionAt(knots, now);

        const route = this.trips.route[t];
        const next = Math.min(i + 1, last);
        out.push({
          id: `${this.trips.id[t]}_${date}`,
          line: this.lineName(route),
          mode: this.routeModes[route],
          to: this.headsign(t),
          // Delay at the next stop in seconds; null when there is no realtime data.
          delay: rt ? rt.arrDelay[next] : null,
          knots,
          // current position, for filtering by map section (not sent to the browser)
          lat,
          lon,
        });
      }
    }
    return out;
  }

  trip(tripId, date, realtime) {
    const t = this.tripIndex.get(tripId);
    if (t === undefined || !this.runsOn(t, date)) return null;
    const rt = realtime?.byDate.get(date)?.get(t);
    const base = serviceDayStart(date);
    const route = this.trips.route[t];
    const stops = this.trips.stops[t];

    // The whole route as one line [lat, lon, …].
    const path = [];
    for (let p = 0; p + 1 < stops.length; p++) {
      const s = this.segment(t, p);
      if (s >= 0) {
        for (const value of this.segPts[s]) path.push(value);
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
      realtime: !!rt,
      // Who provides the realtime data of this trip, if the feed says so.
      source: realtime?.tripSources.get(t) ?? null,
      cancelled: !!rt?.cancelled,
      notes: realtime?.tripNotes.get(t) ?? [],
      path,
      stops: stops.map((s, p) => ({
        station: this.stops.id[this.stationOf[s]],
        name: this.stops.name[s],
        platform: this.stops.platform[s],
        lat: this.stops.lat[s],
        lon: this.stops.lon[s],
        arr: base + this.trips.arr[t][p],
        dep: base + this.trips.dep[t][p],
        arrDelay: rt ? rt.arrDelay[p] : null,
        depDelay: rt ? rt.depDelay[p] : null,
        skipped: !!rt?.skipped?.[p],
      })),
    };
  }

  /** Departures from a station (all its platforms) in the next `windowS` seconds. */
  departures(stationId, now, realtime, { windowS = 7200, limit = 40 } = {}) {
    const station = this.stopIndex.get(stationId);
    const visits = station === undefined ? undefined : this.visits.get(station);
    if (!visits) return null;

    const today = localDate(now);
    const list = [];
    for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
      const d = this.dateIndex.get(date);
      if (d === undefined) continue;
      const active = this.serviceOnDate[d];
      const base = serviceDayStart(date);
      const rtTrips = realtime?.byDate.get(date);

      for (let k = 0; k < visits.length; k += 2) {
        const t = visits[k];
        const p = visits[k + 1];
        if (!active[this.trips.service[t]]) continue;
        if (p === this.trips.stops[t].length - 1) continue; // terminus: nothing departs
        const planned = base + this.trips.dep[t][p];
        // Cheap pre-filter; delays of more than three hours are not expected.
        if (planned > now + windowS || planned < now - 3 * 3600) continue;
        const rt = rtTrips?.get(t);
        const delay = rt ? rt.depDelay[p] : null;
        const expected = planned + (delay ?? 0);
        if (expected < now - 30 || expected > now + windowS) continue;

        const route = this.trips.route[t];
        const stop = this.trips.stops[t][p];
        list.push({
          trip: `${this.trips.id[t]}_${date}`,
          line: this.lineName(route),
          mode: this.routeModes[route],
          to: this.headsign(t),
          platform: this.stops.platform[stop],
          planned,
          delay,
          cancelled: !!rt && (rt.cancelled || !!rt.skipped?.[p]),
        });
      }
    }
    list.sort((a, b) => a.planned + (a.delay ?? 0) - (b.planned + (b.delay ?? 0)));
    return {
      id: stationId,
      name: this.stops.name[station],
      lat: this.stops.lat[station],
      lon: this.stops.lon[station],
      notes: realtime?.stationNotes.get(station) ?? [],
      departures: list.slice(0, limit),
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
