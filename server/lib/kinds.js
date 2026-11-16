// The kind of a route, from the tracks at its stops (#358).
//
// A timetable may give a bus the route type of a tram or a U-Bahn: the feed
// of Germany did so for most buses of Nürnberg and Bochum-Gelsenkirchen in
// November 2026, from one version to the next and back. Such a bus would be
// drawn as a tram, routed on tracks that are not there, and its line would
// be another than the bus line of the same name. Where the OpenStreetMap
// data says where tracks are, the stops of a route tell: a tram or a U-Bahn
// stops at tracks, a bus mostly does not. So a route the timetable gives as
// a tram or a U-Bahn is a bus when fewer than AT_RAILS of its stops (of those
// the map data reaches) are within RAILS_M of a railway track of any kind:
// rail and light rail, U-Bahn, tram, narrow gauge, monorail, funicular. Of
// any kind, so that tram-trains along railways (Saarbahn, the lines between
// Mannheim and Heidelberg) and a monorail given as a tram (the H-Bahn of
// Dortmund) stay as they are; within 30 m, as a bus stop in a street with
// tram tracks is further from them than a tram stop.
//
// It is decided once per route, before any route is looked for, from where
// its stops are; the route is then looked for as that of a bus. The route
// type as the timetable gives it is kept beside it (routes.listed), what the
// page says of such a route, and what a later look at newer map data decides
// anew from. Like the rules for names (#223) and operators (#305), it is one
// rule for every operator, and never worse than as given: it acts only where
// the stops of a route are not at rails.

import { Network } from './network.js';
import { routeMode } from './timetable.js';

/** How far (m) from a track a stop may be and still be at it. */
export const RAILS_M = 30;
/** The share of its stops at tracks below which a route is a bus. */
export const AT_RAILS = 0.6;
/** The route type of a bus. */
const BUS = 3;
// A stop counts only where the map data reaches it: where it has a road
// within a cell of this many degrees around the stop's own (about 200 m by
// 150 m in Germany). Beyond the end of an extract there are no tracks, and a
// tram there is not a bus for that.
const CELL = 0.002;
// The networks that have every kind of railway between them: rail (with
// light rail and, shared, trams and narrow gauge), U-Bahn (with trams) and
// cable (narrow gauge, monorails, funiculars), see classifyWay in network.js.
const RAILS = ['rail', 'subway', 'cable'];

/**
 * Decides the kind of the routes of a dataset that the timetable gives as a
 * tram or a U-Bahn, from the tracks of the map data at their stops, and makes
 * those that are buses buses: their route type becomes that of a bus, and
 * routes.listed keeps the one the timetable gives, for every route. A dataset
 * decided before is decided anew from that.
 * @param data a dataset as importer.js puts it together (routes, trips, patterns, stops)
 * @param graphs the networks of the map data (loadNetworks in shapes.js): road and those of RAILS
 * @param originLat the latitude the networks are measured at
 * @returns the ids of the routes that are buses now, the timetable having given them otherwise
 */
export function kindsFromTracks(data, graphs, originLat) {
  const { routes, trips, patterns, stops } = data;
  routes.listed ??= routes.type.slice();
  routes.type = routes.listed.slice();
  const railed = routes.type.map((type, r) => ['tram', 'subway'].includes(routeMode(type, routes.short[r])));
  if (!railed.includes(true) || !graphs?.road?.lat.length) return [];

  // The stops of each such route, each once.
  const stopsOf = new Map();
  const seen = new Set();
  for (let t = 0; t < trips.route.length; t++) {
    const route = trips.route[t];
    const pattern = trips.pattern[t];
    if (!railed[route] || seen.has(route * patterns.start.length + pattern)) continue;
    seen.add(route * patterns.start.length + pattern);
    const set = stopsOf.get(route) ?? stopsOf.set(route, new Set()).get(route);
    for (let k = patterns.start[pattern]; k < patterns.start[pattern + 1]; k++) set.add(patterns.stops[k]);
  }
  const asked = new Set();
  for (const set of stopsOf.values()) for (const stop of set) asked.add(stop);

  const reached = reachedBy(graphs.road, CELL);
  const at = [...asked].map((stop) => [stops.lat[stop], stops.lon[stop]]);
  const nets = RAILS.filter((net) => graphs[net]?.a.length).map((net) => new Network(graphs[net], { originLat, snapRadius: RAILS_M, snapPenalty: 1, snapAt: at }));
  // (map data without any railway says nothing about where tracks are: no route changes then)
  if (!nets.length) return [];
  const atRails = new Map();
  for (const stop of asked) {
    const [lat, lon] = [stops.lat[stop], stops.lon[stop]];
    atRails.set(stop, !reached(lat, lon) ? null : nets.some((net) => net.candidates(lat, lon).length > 0));
  }

  const turned = [];
  for (const [route, set] of stopsOf) {
    let counted = 0;
    let railedStops = 0;
    for (const stop of set) {
      const at = atRails.get(stop);
      if (at === null) continue;
      counted++;
      if (at) railedStops++;
    }
    if (counted > 0 && railedStops / counted < AT_RAILS) {
      routes.type[route] = BUS;
      turned.push(routes.id[route]);
    }
  }
  return turned;
}

/**
 * Whether the map data reaches a place: whether its roads have a node in the
 * cell of `size` degrees the place is in, or in one of the eight around it.
 * @param road a network as buildNetworks makes it (lat and lon in 1e-7 degrees)
 * @returns (lat, lon) => boolean
 */
export function reachedBy(road, size) {
  const unit = size * 1e7;
  let [south, west, north, east] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < road.lat.length; i++) {
    const [row, col] = [Math.floor(road.lat[i] / unit), Math.floor(road.lon[i] / unit)];
    if (row < south) south = row;
    if (row > north) north = row;
    if (col < west) west = col;
    if (col > east) east = col;
  }
  const width = east - west + 1;
  const cells = new Uint8Array(Math.ceil(((north - south + 1) * width) / 8));
  for (let i = 0; i < road.lat.length; i++) {
    const cell = (Math.floor(road.lat[i] / unit) - south) * width + Math.floor(road.lon[i] / unit) - west;
    cells[cell >> 3] |= 1 << (cell & 7);
  }
  const has = (row, col) => {
    if (row < south || row > north || col < west || col > east) return false;
    const cell = (row - south) * width + col - west;
    return (cells[cell >> 3] & (1 << (cell & 7))) !== 0;
  };
  return (lat, lon) => {
    const [row, col] = [Math.floor((lat * 1e7) / unit), Math.floor((lon * 1e7) / unit)];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (has(row + dr, col + dc)) return true;
    return false;
  };
}
