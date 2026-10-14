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
import { NETS, Network, ROADS_AT_ONCE, TILE, buildNetworks, classifyWay, simplify, tilesOf, windowOf } from './network.js';
import { readPbfBoundaries, readPbfWays } from './osmpbf.js';
import { NET_OF_MODE, hopKey, routeMode } from './timetable.js';
import { BORDER_LEVELS, readTowns, townsAmong, writeTowns } from './towns.js';

// Bump when classifyWay, the cost factors or the output of buildNetworks
// (all in network.js) change: the cached networks are then built again from a
// fresh OSM download instead of being used for up to NETNOU_OSM_MAX_AGE_DAYS more.
const NETWORKS_VERSION = 3;

// snapRadius: how far a stop may be from its road/track (rail stops are often
// the station centre). snapPenalty: cost per metre of that offset.
// detour: a route longer than straight × factor + slack metres is discarded.
const SETTINGS = {
  road: { snapRadius: 70, snapPenalty: 4, detour: [2.5, 400] },
  tram: { snapRadius: 60, snapPenalty: 3, detour: [2, 300] },
  subway: { snapRadius: 250, snapPenalty: 2, detour: [2, 500] },
  rail: { snapRadius: 400, snapPenalty: 1.5, detour: [2, 1000] },
};
const SIMPLIFY_M = 1.5;

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
        readings.push(readPbfWays(file, { keys: ['highway', 'railway'], classify: classifyWay, keepNode }));
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

/**
 * Routes every hop of every trip in `data` (an importer dataset) on the
 * network of its mode: on roads of more than roadsAtOnce nodes in the tiles of
 * `tile` degrees around it (routeInTiles). A hop whose route is kept from an
 * import before (kept-routes.js) is not routed again, and what is routed is
 * added to those kept.
 * @returns {{nets, net, key, start, points, share}} the segments as columns,
 *   in the order of their keys (hopKey), by which a hop finds its segment:
 *   segment i is on network nets[net[i]] and has the points start[i] to
 *   start[i + 1] - 1; `points` holds latitude and longitude of each in 1e-5
 *   degrees, `share` for each the share of the segment's length up to it.
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
  /** A route of a hop: its points as latitude, longitude, … in 1e-5 degrees. */
  const addRoute = (key, n, points) => {
    routed.key.push(key);
    routed.net.push(n);
    routed.start.push(routed.points.length / 2);
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

  /** Routes hops on one network, or on the part of it that is around them. */
  const routeHops = (network, keys) => {
    const candidates = new Map(); // by stop
    const candidatesOf = (stop) => {
      let list = candidates.get(stop);
      if (!list) candidates.set(stop, (list = network.candidates(stops.lat[stop], stops.lon[stop])));
      return list;
    };
    for (const key of keys) {
      const { from, to, n } = apart(key);
      if (++done % 10000 === 0) onProgress(`${done} of ${fresh.length} hops done`);

      const a = candidatesOf(from);
      const b = candidatesOf(to);
      const [ax, ay] = network.toXY(stops.lat[from], stops.lon[from]);
      const [bx, by] = network.toXY(stops.lat[to], stops.lon[to]);
      let route = null;
      const far = (stop) => area.distance(stops.lat[stop], stops.lon[stop]) > NEAR.exit;
      const [factor, slack] = SETTINGS[NETS[n]].detour;
      const maxLength = Math.hypot(bx - ax, by - ay) * factor + slack;
      if (a.length && b.length) route = network.route(a, b, maxLength);
      // One end is not on the network, or it lies beyond the area on a part of
      // the network that is not connected to the rest (the OSM data ends a few
      // km outside): follow the network towards it until the route has left the
      // area, or as far as the network goes that way.
      const inside = (x, y) => area.distance(...network.toLatLon(x, y)) <= NEAR.exit;
      if (!route && a.length && (!b.length || far(to))) route = network.routeBeyond(a, bx, by, inside, false, maxLength);
      if (!route && b.length && (!a.length || far(from))) route = network.routeBeyond(b, ax, ay, inside, true, maxLength);
      if (!route) {
        kept?.add(n, placeOf(from), placeOf(to), null);
        continue;
      }

      route = simplify(route, SIMPLIFY_M);
      const pts = [];
      for (let i = 0; i < route.length; i += 2) {
        const [lat, lon] = network.toLatLon(route[i], route[i + 1]);
        const iLat = Math.round(lat * 1e5);
        const iLon = Math.round(lon * 1e5);
        if (i && iLat === pts.at(-2) && iLon === pts.at(-1)) continue;
        pts.push(iLat, iLon);
      }
      kept?.add(n, placeOf(from), placeOf(to), pts.length < 4 ? null : pts);
      if (pts.length >= 4) addRoute(key, n, pts);
    }
    // (what is routed is kept, also should the import be stopped before it is done)
    kept?.flush();
  };

  /**
   * Routes the hops on the roads of a country, tile by tile: a hop on the
   * roads of the tile its middle is in and of the tiles around it, if both of
   * its stops are within half a tile of that tile. A longer one has no route.
   */
  const routeInTiles = (graph, keys) => {
    const unit = tile * 1e7;
    const byTile = new Map();
    let long = 0;
    for (const key of keys) {
      const { from, to, n } = apart(key);
      // (the row and the column of the tile that the middle of the hop is in, as tilesOf counts them)
      const [r, c] = [Math.floor(((stops.lat[from] + stops.lat[to]) / 2) * 1e7 / unit), Math.floor(((stops.lon[from] + stops.lon[to]) / 2) * 1e7 / unit)];
      // (where a stop is, from the south-west corner of the tile, in tiles)
      const within = (stop) => [(stops.lat[stop] * 1e7) / unit - r, (stops.lon[stop] * 1e7) / unit - c].every((at) => at >= -0.5 && at < 1.5);
      if (!within(from) || !within(to)) {
        long++;
        kept?.add(n, placeOf(from), placeOf(to), null);
        continue;
      }
      const block = `${r} ${c}`;
      if (!byTile.has(block)) byTile.set(block, { r, c, keys: [] });
      byTile.get(block).keys.push(key);
    }
    if (long) onProgress(`${long} hops on roads are too long for the tiles`);
    done += long;
    kept?.flush();
    if (!byTile.size) return;
    const tiles = tilesOf(graph, tile);
    const scratch = new Int32Array(graph.lat.length).fill(-1);
    for (const { r, c, keys: inTile } of [...byTile.values()].sort((p, q) => p.r - q.r || p.c - q.c)) {
      const around = [];
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) around.push(tiles.key(r + dr, c + dc));
      const part = windowOf(graph, tiles, around, scratch);
      // (the latitude of the middle of the tile, for lengths in metres)
      routeHops(new Network(part, { originLat: (r + 0.5) * tiles.size, ...SETTINGS.road }), inTile);
    }
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
  routed.start.push(routed.points.length / 2);
  const order = Int32Array.from(routed.key.keys()).sort((p, q) => routed.key[p] - routed.key[q]);
  const start = new Int32Array(order.length + 1);
  order.forEach((h, i) => { start[i + 1] = start[i] + routed.start[h + 1] - routed.start[h]; });
  const points = new Int32Array(2 * start[order.length]);
  const share = new Float64Array(start[order.length]);
  order.forEach((h, i) => {
    const pts = all.subarray(2 * routed.start[h], 2 * routed.start[h + 1]);
    points.set(pts, 2 * start[i]);
    // (a degree of longitude is shorter than one of latitude, the more so the further north: the latitude of the hop)
    const kx = Math.cos((pts[0] / 1e5) * (Math.PI / 180));
    let length = 0;
    for (let k = 2; k < pts.length; k += 2) {
      length += Math.hypot(pts[k] - pts[k - 2], (pts[k + 1] - pts[k - 1]) * kx);
      share[start[i] + k / 2] = length;
    }
    for (let k = start[i]; k < start[i + 1]; k++) share[k] = length ? share[k] / length : 1;
  });
  return { nets: NETS, net: Uint8Array.from(order, (h) => routed.net[h]), key: Float64Array.from(order, (h) => routed.key[h]), start, points, share };
}
