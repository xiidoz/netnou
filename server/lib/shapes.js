// Route geometry. The GTFS feed has no shapes.txt, so the path between two
// consecutive stops is found by routing over OpenStreetMap: buses on roads,
// trams, U-Bahn and trains on their tracks. The result is one polyline per
// distinct "stop A -> stop B on network N" hop, shared by all trips using it.
// All of them together are columns of the dataset (see buildSegments).

import fs from 'node:fs';
import path from 'node:path';
import { Area, NEAR } from './area.js';
import { Numbers, readDataset, readDatasetHead, writeDataset } from './dataset.js';
import { download, publicUrl, reason } from './files.js';
import { MAIN, NETS, NETWORKS_VERSION, Network, ROADS_AT_ONCE, TILE, buildNetworks, classifyWay, partOf, simplify, tilesOf, windowOf } from './network.js';
import { readPbfBoundaries, readPbfWays } from './osmpbf.js';
import { NET_OF_MODE, hopKey, routeMode } from './timetable.js';
import { BORDER_LEVELS, readTowns, townsAmong, writeTowns } from './towns.js';

// snapRadius: how far a stop may be from its road/track (rail stops are often
// the station centre). snapPenalty: cost per metre of that offset.
// detour: a route longer than straight × factor + slack metres is discarded.
// maxTurn: on tracks a route does not turn back between two stops (#243): at a
// node it turns at most this many degrees, as no track that only goes on does
// (99.99 % of them less than 71° on rail, 107° on the U-Bahn and trams); going
// into a switch on one branch and out on the other is a turn of some 170°.
// snapSpread, maxCandidates: a stop of a train may be on any track up to 100 m
// further away than the nearest: in a large station the one a train takes,
// with no turn back to reach it, need not be among the nearest few edges.
// The slack of trains lets them leave a terminus the way they face and come
// round (München Hbf to München Ost: 9.5 km for 4 km as the crow flies).
const SETTINGS = {
  road: { snapRadius: 70, snapPenalty: 4, detour: [2.5, 400] },
  tram: { snapRadius: 60, snapPenalty: 3, detour: [2, 300], maxTurn: 120 },
  subway: { snapRadius: 250, snapPenalty: 2, detour: [2, 500], maxTurn: 120 },
  rail: { snapRadius: 400, snapPenalty: 1.5, detour: [2, 3000], maxTurn: 120, snapSpread: 100, maxCandidates: 64, sharedLast: true },
  // (a pier can be far from where the line of its ferry ends, and a fairway
  // winds; snapping costs three times a metre of the way, or a short crossing
  // would have both its stops on the far bank and no route)
  ferry: { snapRadius: 600, snapPenalty: 3, detour: [3, 2000] },
  cable: { snapRadius: 300, snapPenalty: 2, detour: [2, 500] },
};
const SIMPLIFY_M = 1.5;
// The roads near a stop of a hop that is too long for the tiles (routeLong):
// those within LONG_REACH km of it, or as far as the nearest main road and
// LONG_REACH km beyond, at most LONG_REACH_MAX km; found by cells of
// LONG_CELL degrees. (Within 1 km of it, the central bus station of Munich
// has no way to the main roads.)
const LONG_REACH = 2;
const LONG_REACH_MAX = 15;
const LONG_CELL = 0.01;

/**
 * Returns the routable networks for the area, from the cache in dataDir or –
 * if that is missing or older than maxAgeMs – from freshly downloaded OSM
 * extracts. Returns null if there is neither (the map then falls back to
 * straight lines between stops).
 *
 * With the networks come the towns in the extracts (towns.js), as `towns`:
 * they are read from the same download, kept beside the networks and used
 * for as long as those are.
 *
 * An area of polygons stays what it is. The extent of an instance without an
 * area follows the timetable: the networks read for an earlier one are used
 * for as long as the present one lies within what was kept of OpenStreetMap
 * then, so that a new timetable alone does not fetch the extracts again.
 * @param area the area, or the extent of an instance without one (Area.covering)
 * @param scope what the instance covers, which the networks are tied to (scopeId)
 * @param timeoutMs limit for the download of one extract
 */
export async function loadNetworks({ dataDir, urls, area, scope = area.id, maxAgeMs, timeoutMs, onProgress }) {
  if (!urls.length) return null;
  const cachePath = path.join(dataDir, 'osm-networks.bin');
  const townsPath = path.join(dataDir, 'osm-towns.json.gz');
  const extent = area.polygons.length ? null : area;

  let cached = null;
  let covered = true;
  try {
    const data = readDatasetHead(cachePath);
    if (data.version === NETWORKS_VERSION && data.area === scope && data.sources.join() === urls.join()) {
      // (networks without the towns of their reading are as good as none: both are read again)
      const towns = readTowns(townsPath, { scope, sources: urls, fetchedAt: data.fetchedAt });
      if (towns) cached = { ...data, towns, nets: whenAskedFor(cachePath) };
      covered = !extent || (Boolean(data.extent) && extent.within(Area.fromJSON(data.extent), NEAR.exit));
    }
  } catch {
    // no usable cache
  }
  if (cached && covered && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) return cached;
  if (cached && !covered) onProgress('the timetable reaches beyond the OSM data that was kept: reading it again');

  try {
    const keepNode = (lat, lon) => area.distance(lat, lon) <= NEAR.osm;
    const readings = []; // what each extract has of roads and tracks
    const borders = []; // and of borders
    for (const [i, url] of urls.entries()) {
      const file = path.join(dataDir, `osm-${i}.pbf`);
      onProgress(`downloading OSM extract ${publicUrl(url)}`);
      try {
        const { size } = await download(url, file, timeoutMs);
        onProgress(`reading OSM extract (${Math.round(size / 1e6)} MB)`);
        // (the borders first: what is read of the roads is the larger part, and it is kept until the networks are built)
        borders.push(readPbfBoundaries(file, BORDER_LEVELS));
        readings.push(readPbfWays(file, { keys: ['highway', 'railway', 'route', 'aerialway'], classify: classifyWay, keepNode }));
      } finally {
        fs.rmSync(file, { force: true });
      }
    }
    const fresh = { version: NETWORKS_VERSION, fetchedAt: new Date().toISOString(), area: scope, sources: urls, nets: buildNetworks(readings), ...(extent ? { extent: extent.toJSON() } : {}) };
    readings.length = 0;
    if (!NETS.some((net) => fresh.nets[net].a.length)) throw new Error('no roads or tracks found in the area; do the extracts in NETNOU_OSM_PBF_URLS cover it?');
    const towns = townsAmong(borders);
    onProgress(`${towns.length} towns in the OSM extracts`);
    // (the towns first: networks that are kept have their towns beside them)
    writeTowns(townsPath, { fetchedAt: fresh.fetchedAt, scope, sources: urls, towns });
    writeDataset(cachePath, fresh);
    // (where the networks were kept before, as JSON)
    fs.rmSync(path.join(dataDir, 'osm-networks.json.gz'), { force: true });
    return { ...fresh, towns: readTowns(townsPath, { scope, sources: urls, fetchedAt: fresh.fetchedAt }) };
  } catch (err) {
    onProgress(`OSM data could not be updated (${reason(err)}), ${cached ? `using the copy of ${cached.fetchedAt}` : 'keeping straight lines'}`);
    return cached;
  }
}

/**
 * The networks kept in a file, read from it when one of them is first asked
 * for: an import whose routes are all kept does not need them, and they are
 * 637 MB for all of Germany.
 */
function whenAskedFor(file) {
  let read = null;
  const nets = {};
  for (const net of NETS) Object.defineProperty(nets, net, { enumerable: true, get: () => (read ??= readDataset(file).nets)[net] });
  return nets;
}

// A point is kept as its step from the one before, in 16 bits each way: up to
// a third of a degree. A longer step is cut into shorter ones, with points
// on the straight line between. The share of a hop's time up to a point is
// kept in 16 bits as well: a 65,535th, a tenth of a second of a hop of nearly
// two hours.
const STEP = 32_000;
const SHARE = 65_535;

/**
 * The points of a route as they are kept: latitude and longitude in 1e-5
 * degrees and the share of the hop's time up to the point, in 65,535ths, for
 * each (#264). A vehicle takes as long for a piece of its route as the piece
 * is long for how fast it goes there (the speeds of a path, Network.timed);
 * how long the whole hop takes is the timetable's. Without speeds, and where
 * none is known for a piece, that of the piece before it counts, else that of
 * the one after: on a route with none the share of the time is that of the
 * length.
 * @param path a path of the network on its plane, simplified
 */
export function timedPoints(network, path) {
  const points = [];
  const speeds = [];
  for (let i = 0; i < path.length; i += 2) {
    const [lat, lon] = network.toLatLon(path[i], path[i + 1]);
    const [iLat, iLon] = [Math.round(lat * 1e5), Math.round(lon * 1e5)];
    if (i && iLat === points.at(-3) && iLon === points.at(-2)) continue;
    points.push(iLat, iLon, 0);
    // (of a point the speed of the piece that comes to it)
    if (i) speeds.push(path.speeds?.[i / 2 - 1] ?? 0);
  }
  const count = points.length / 3;
  let known = speeds.find((speed) => speed > 0) ?? 1;
  const kx = Math.cos((points[0] / 1e5) * (Math.PI / 180));
  const times = [0];
  for (let k = 1; k < count; k++) {
    if (speeds[k - 1] > 0) known = speeds[k - 1];
    const length = Math.hypot(points[3 * k] - points[3 * k - 3], (points[3 * k + 1] - points[3 * k - 2]) * kx);
    times.push(times[k - 1] + length / known);
  }
  const total = times[count - 1];
  for (let k = 0; k < count; k++) points[3 * k + 2] = total ? Math.round((times[k] / total) * SHARE) : SHARE;
  return points;
}

/**
 * Routes every hop of every trip in `data` (an importer dataset) on the
 * network of its mode: on roads of more than roadsAtOnce nodes in the tiles of
 * `tile` degrees around it (routeInTiles). A hop whose route is kept from an
 * import before (kept-routes.js) is not routed again, and what is routed is
 * added to those kept.
 * @returns {{nets, net, key, start, origin, step, share}} the segments as
 *   columns, in the order of their keys (hopKey), by which a hop finds its
 *   segment: segment i is on network nets[net[i]] and has the points start[i]
 *   to start[i + 1] - 1. Its first point is origin[2i], origin[2i + 1]:
 *   latitude and longitude in 1e-5 degrees. Each of the others is the one
 *   before it and its `step`, a latitude and a longitude in 1e-5 degrees too;
 *   `share` is for each point the share of the hop's time up to it, in
 *   65,535ths (timedPoints).
 */
export function buildSegments(data, graphs, area, onProgress = () => {}, { roadsAtOnce = ROADS_AT_ONCE, tile = TILE, kept = null } = {}) {
  const { stops, trips, routes, patterns } = data;
  const stopCount = stops.id.length;
  const originLat = (area.bbox[0] + area.bbox[2]) / 2;

  // Distinct hops, keyed by (network, from stop, to stop): those of every
  // stop sequence, on the network of every route that runs it.
  const netOfRoute = routes.type.map((type, r) => NETS.indexOf(NET_OF_MODE[routeMode(type, routes.short[r])]));
  const looked = new Set(); // a stop sequence and a network together
  const hops = new Set();
  for (let t = 0; t < trips.pattern.length; t++) {
    const n = netOfRoute[trips.route[t]];
    if (n < 0) continue;
    const pattern = trips.pattern[t];
    if (looked.has(pattern * NETS.length + n)) continue;
    looked.add(pattern * NETS.length + n);
    for (let k = patterns.start[pattern] + 1; k < patterns.start[pattern + 1]; k++) {
      if (patterns.stops[k - 1] !== patterns.stops[k]) hops.add(hopKey(n, patterns.stops[k - 1], patterns.stops[k], stopCount));
    }
  }

  // The routes as they are found: of each its key, its network and where its points begin among all of them.
  // (Not an array of points for each: there are three quarters of a million for all of Germany.)
  const routed = { key: [], net: [], start: [], points: new Numbers() };
  const stats = NETS.map(() => ({ hops: 0, routed: 0 }));
  const apart = (key) => ({ to: key % stopCount, from: Math.floor(key / stopCount) % stopCount, n: Math.floor(key / stopCount / stopCount) });
  const placeOf = (stop) => [stops.lat[stop], stops.lon[stop]];
  /** A route of a hop: its points as timedPoints gives them. */
  const addRoute = (key, n, points) => {
    routed.key.push(key);
    routed.net.push(n);
    routed.start.push(routed.points.length / 3);
    for (const value of points) routed.points.push(value);
    stats[n].routed++;
  };

  // The hops whose route is kept from an import before are done; the others are routed.
  const fresh = [];
  for (const key of hops) {
    const { from, to, n } = apart(key);
    stats[n].hops++;
    const route = kept ? kept.find(n, placeOf(from), placeOf(to)) : undefined;
    if (route === undefined) fresh.push(key);
    else if (route) addRoute(key, n, route);
  }
  onProgress(`routing ${fresh.length} hops${fresh.length < hops.size ? `, ${hops.size - fresh.length} kept from before` : ''}`);
  let done = 0;

  /**
   * Routes hops on one network, or on the part of it that is around them;
   * long ones heading for their last stop (Network.route).
   */
  const routeHops = (network, keys, long = false) => {
    const candidates = new Map(); // by stop
    const candidatesOf = (stop) => {
      let list = candidates.get(stop);
      if (!list) candidates.set(stop, (list = network.candidates(stops.lat[stop], stops.lon[stop])));
      return list;
    };
    for (const key of keys) {
      const { from, to, n } = apart(key);
      if (++done % 10000 === 0) onProgress(`${done} of ${fresh.length} hops done`);

      const [ax, ay] = network.toXY(stops.lat[from], stops.lon[from]);
      const [bx, by] = network.toXY(stops.lat[to], stops.lon[to]);
      // (where candidates are spread, a stop is on a track nearer to it than to
      // the other stop: two stops close together would meet on one otherwise)
      const east = network.eastAt((stops.lat[from] + stops.lat[to]) / 2);
      const nearer = (list, [x, y], [ox, oy]) => (network.snapSpread === null ? list : list.filter((c) => Math.hypot((c.x - x) * east, c.y - y) <= Math.hypot((c.x - ox) * east, c.y - oy)));
      const a = nearer(candidatesOf(from), [ax, ay], [bx, by]);
      const b = nearer(candidatesOf(to), [bx, by], [ax, ay]);
      const far = (stop) => area.distance(stops.lat[stop], stops.lon[stop]) > NEAR.exit;
      const [factor, slack] = SETTINGS[NETS[n]].detour;
      const maxLength = Math.hypot(bx - ax, by - ay) * factor + slack;
      // One end is not on the network, or only on tracks of another kind that
      // need not lead there (a tunnel under a stop of trams), or it lies beyond
      // the area on a part of the network that is not connected to the rest
      // (the OSM data ends a few km outside): follow the network towards it
      // until the route has left the area, or as far as the network goes that
      // way.
      const inside = (x, y) => area.distance(...network.toLatLon(x, y)) <= NEAR.exit;
      const off = (candidates) => candidates.every((c) => c.shared);
      // (on its own tracks alone, a train heads that way for a stop with no track near it at all; one on the
      // tracks of trams alone is reached on those, with the shared tracks)
      const away = (candidates, own) => (own ? !candidates.length : off(candidates));
      const find = (turning, own) => {
        let found = a.length && b.length ? network.route(a, b, maxLength, long ? [bx, by] : null, turning, own) : null;
        if (!found && a.length && (away(b, own) || far(to))) found = network.routeBeyond(a, bx, by, inside, false, maxLength, turning, own);
        if (!found && b.length && (away(a, own) || far(from))) found = network.routeBeyond(b, ax, ay, inside, true, maxLength, turning, own);
        return found;
      };
      // (where no route keeps the turns of a track, the train does turn back between two stops, at a station it
      // passes without a stop or where the tracks are mapped with a corner sharper than they are: the route as ever;
      // and of trains, a route on their own tracks first where a stop of the hop is on them, on those of trams and
      // narrow gauge where there is none: tram-trains between two stops in the street, the narrow gauge, #248)
      const ownFirst = network.sharedLast && (network.onOwn(a) || network.onOwn(b));
      const tries = network.turnCos === null ? [[true, false]] : ownFirst ? [[true, true], [true, false], [false, true], [false, false]] : [[true, false], [false, false]];
      let route = null;
      for (const [turning, own] of tries) if ((route = find(turning, own))) break;
      if (!route) {
        kept?.add(n, placeOf(from), placeOf(to), null);
        continue;
      }

      const pts = timedPoints(network, simplify(route, SIMPLIFY_M));
      kept?.add(n, placeOf(from), placeOf(to), pts.length < 6 ? null : pts);
      if (pts.length >= 6) addRoute(key, n, pts);
    }
    // (what is routed is kept, also should the import be stopped before it is done)
    kept?.flush();
  };

  /**
   * Routes the hops on the roads of a country, tile by tile: a hop on the
   * roads of the tile its middle is in and of the tiles around it, if both of
   * its stops are within half a tile of that tile. The longer ones, nearly all
   * of long-distance coaches, on the main roads (routeLong).
   */
  const routeInTiles = (graph, keys) => {
    const unit = tile * 1e7;
    const byTile = new Map();
    const long = [];
    for (const key of keys) {
      const { from, to } = apart(key);
      // (the row and the column of the tile that the middle of the hop is in, as tilesOf counts them)
      const [r, c] = [Math.floor(((stops.lat[from] + stops.lat[to]) / 2) * 1e7 / unit), Math.floor(((stops.lon[from] + stops.lon[to]) / 2) * 1e7 / unit)];
      // (where a stop is, from the south-west corner of the tile, in tiles)
      const within = (stop) => [(stops.lat[stop] * 1e7) / unit - r, (stops.lon[stop] * 1e7) / unit - c].every((at) => at >= -0.5 && at < 1.5);
      if (!within(from) || !within(to)) {
        long.push(key);
        continue;
      }
      const block = `${r} ${c}`;
      if (!byTile.has(block)) byTile.set(block, { r, c, keys: [] });
      byTile.get(block).keys.push(key);
    }
    const scratch = new Int32Array(graph.lat.length).fill(-1);
    if (byTile.size) {
      const tiles = tilesOf(graph, tile);
      for (const { r, c, keys: inTile } of [...byTile.values()].sort((p, q) => p.r - q.r || p.c - q.c)) {
        const around = [];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) around.push(tiles.key(r + dr, c + dc));
        const part = windowOf(graph, tiles, around, scratch);
        // (the latitude of the middle of the tile, for lengths in metres)
        routeHops(new Network(part, { originLat: (r + 0.5) * tiles.size, ...SETTINGS.road }), inTile);
      }
    }
    if (long.length) routeLong(graph, long, scratch);
  };

  /**
   * Routes the hops on the roads of a country that are too long for the
   * tiles on one network (#131): the main roads of the whole instance, and
   * all roads near the stops of these hops, as far as LONG_REACH km from
   * each, or as far as the nearest main road and LONG_REACH km beyond it
   * (at most LONG_REACH_MAX km). A route leaves its stop on the roads near
   * it, takes the main roads where that is shorter, and arrives the same way.
   */
  const routeLong = (graph, keys, scratch) => {
    onProgress(`${keys.length} hops on roads are too long for the tiles: routing them on the main roads`);
    const unit = LONG_CELL * 1e7;
    const cellOf = (lat, lon) => Math.floor(lat / unit) * 1e5 + Math.floor(lon / unit);
    const withMain = new Set();
    for (let e = 0; e < graph.a.length; e++) if (graph.d[e] & MAIN) withMain.add(cellOf(graph.lat[graph.a[e]], graph.lon[graph.a[e]]));
    const near = new Set();
    // (a cell is LONG_CELL × 111 km from north to south, and less from west to east)
    const cellKm = LONG_CELL * 111.32;
    const ends = [...new Set(keys.flatMap((key) => [apart(key).from, apart(key).to]))];
    for (const stop of ends) {
      const [r, c] = [Math.floor((stops.lat[stop] * 1e7) / unit), Math.floor((stops.lon[stop] * 1e7) / unit)];
      const rings = Math.ceil(LONG_REACH_MAX / (cellKm * Math.cos((stops.lat[stop] * Math.PI) / 180)));
      // (the first ring of cells around the stop with a main road in it; a stop
      // with none within LONG_REACH_MAX, as one beyond the extract, gets LONG_REACH)
      let ring = 0;
      const hasMain = (k) => {
        for (let i = -k; i <= k; i++) for (const [dr, dc] of [[i, -k], [i, k], [-k, i], [k, i]]) if (withMain.has((r + dr) * 1e5 + c + dc)) return true;
        return false;
      };
      while (ring <= rings && !hasMain(ring)) ring++;
      const reach = ring > rings ? LONG_REACH : Math.min(LONG_REACH_MAX, ring * cellKm + LONG_REACH);
      const [rows, cols] = [Math.ceil(reach / cellKm), Math.ceil(reach / (cellKm * Math.cos((stops.lat[stop] * Math.PI) / 180)))];
      for (let dr = -rows; dr <= rows; dr++) for (let dc = -cols; dc <= cols; dc++) near.add((r + dr) * 1e5 + c + dc);
    }
    const keep = (e) => (graph.d[e] & MAIN) > 0 || near.has(cellOf(graph.lat[graph.a[e]], graph.lon[graph.a[e]])) || near.has(cellOf(graph.lat[graph.b[e]], graph.lon[graph.b[e]]));
    routeHops(new Network(partOf(graph, keep, scratch), { originLat, ...SETTINGS.road, snapAt: ends.map((stop) => [stops.lat[stop], stops.lon[stop]]) }), keys, true);
  };

  const byNet = NETS.map(() => []);
  for (const key of fresh) byNet[apart(key).n].push(key);
  NETS.forEach((net, n) => {
    if (!byNet[n].length) return;
    if (net === 'road' && graphs.road.lat.length > roadsAtOnce) routeInTiles(graphs.road, byNet[n]);
    else routeHops(new Network(graphs[net], { originLat, ...SETTINGS[net] }), byNet[n]);
  });
  onProgress(`hops routed: ${NETS.map((net, n) => `${net} ${stats[n].routed}/${stats[n].hops}`).join(', ')}`);

  // In the order of their keys.
  const all = routed.points.array;
  routed.start.push(routed.points.length / 3);
  const order = Int32Array.from(routed.key.keys()).sort((p, q) => routed.key[p] - routed.key[q]);
  /** Into how many steps the step to point k of pts (timedPoints) is cut. */
  const piecesTo = (pts, k) => Math.ceil(Math.max(Math.abs(pts[3 * k] - pts[3 * k - 3]), Math.abs(pts[3 * k + 1] - pts[3 * k - 2]), 1) / STEP);
  const pointsOf = (h) => all.subarray(3 * routed.start[h], 3 * routed.start[h + 1]);
  const start = new Int32Array(order.length + 1);
  order.forEach((h, i) => {
    const pts = pointsOf(h);
    let count = 1;
    for (let k = 1; k < pts.length / 3; k++) count += piecesTo(pts, k);
    start[i + 1] = start[i] + count;
  });
  const origin = new Int32Array(2 * order.length);
  const step = new Int16Array(2 * start[order.length]);
  const share = new Uint16Array(start[order.length]);
  order.forEach((h, i) => {
    const pts = pointsOf(h);
    origin[2 * i] = pts[0];
    origin[2 * i + 1] = pts[1];
    share[start[i]] = pts[2];
    let at = 0;
    for (let k = 1; k < pts.length / 3; k++) {
      const pieces = piecesTo(pts, k);
      const [dLat, dLon] = [pts[3 * k] - pts[3 * k - 3], pts[3 * k + 1] - pts[3 * k - 2]];
      // (along a piece the speed does not change: its share of the time as its share of the piece)
      const [from, to] = [pts[3 * k - 1], pts[3 * k + 2]];
      for (let j = 1; j <= pieces; j++) {
        at++;
        step[2 * (start[i] + at)] = Math.round((dLat * j) / pieces) - Math.round((dLat * (j - 1)) / pieces);
        step[2 * (start[i] + at) + 1] = Math.round((dLon * j) / pieces) - Math.round((dLon * (j - 1)) / pieces);
        share[start[i] + at] = Math.round(from + ((to - from) * j) / pieces);
      }
    }
  });
  return { nets: NETS, net: Uint8Array.from(order, (h) => routed.net[h]), key: Float64Array.from(order, (h) => routed.key[h]), start, origin, step, share };
}
