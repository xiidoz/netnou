// Route geometry. The GTFS feed has no shapes.txt, so the path between two
// consecutive stops is found by routing over OpenStreetMap: buses on roads,
// trams, U-Bahn and trains on their tracks. The result is one polyline per
// distinct "stop A -> stop B on network N" hop, shared by all trips using it.
// All of them together are columns of the dataset (see buildSegments).

import fs from 'node:fs';
import path from 'node:path';
import { Area, NEAR } from './area.js';
import { download, publicUrl, readGz, reason, writeGz } from './files.js';
import { NETS, Network, NetworkBuilder, simplify } from './network.js';
import { readPbfWays } from './osmpbf.js';
import { NET_OF_MODE, hopKey, routeMode } from './timetable.js';

// Bump when classifyWay, the cost factors or the output of NetworkBuilder
// (all in network.js) change: the cached networks are then built again from a
// fresh OSM download instead of being used for up to NETNOU_OSM_MAX_AGE_DAYS more.
const NETWORKS_VERSION = 2;

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
  const cachePath = path.join(dataDir, 'osm-networks.json.gz');
  const extent = area.polygons.length ? null : area;

  let cached = null;
  let covered = true;
  try {
    const data = readGz(cachePath);
    if (data.version === NETWORKS_VERSION && data.area === scope && data.sources.join() === urls.join()) {
      cached = data;
      covered = !extent || (Boolean(data.extent) && extent.within(Area.fromJSON(data.extent), NEAR.exit));
    }
  } catch {
    // no usable cache
  }
  if (cached && covered && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) return cached;
  if (cached && !covered) onProgress('the timetable reaches beyond the OSM data that was kept: reading it again');

  try {
    const builder = new NetworkBuilder();
    const keepNode = (lat, lon) => area.distance(lat, lon) <= NEAR.osm;
    for (const [i, url] of urls.entries()) {
      const file = path.join(dataDir, `osm-${i}.pbf`);
      onProgress(`downloading OSM extract ${publicUrl(url)}`);
      try {
        const { size } = await download(url, file, timeoutMs);
        onProgress(`reading OSM extract (${Math.round(size / 1e6)} MB)`);
        readPbfWays(file, keepNode, ['highway', 'railway'], (way) => builder.addWay(way));
      } finally {
        fs.rmSync(file, { force: true });
      }
    }
    const fresh = { version: NETWORKS_VERSION, fetchedAt: new Date().toISOString(), area: scope, sources: urls, nets: builder.result(), ...(extent ? { extent: extent.toJSON() } : {}) };
    if (!NETS.some((net) => fresh.nets[net].a.length)) throw new Error('no roads or tracks found in the area; do the extracts in NETNOU_OSM_PBF_URLS cover it?');
    writeGz(cachePath, fresh);
    return fresh;
  } catch (err) {
    onProgress(`OSM data could not be updated (${reason(err)}), ${cached ? `using the copy of ${cached.fetchedAt}` : 'keeping straight lines'}`);
    return cached;
  }
}

/**
 * Routes every hop of every trip in `data` (an importer dataset).
 * @returns {{nets, net, key, start, points, share}} the segments as columns,
 *   in the order of their keys (hopKey), by which a hop finds its segment:
 *   segment i is on network nets[net[i]] and has the points start[i] to
 *   start[i + 1] - 1; `points` holds latitude and longitude of each in 1e-5
 *   degrees, `share` for each the share of the segment's length up to it.
 */
export function buildSegments(data, graphs, area, onProgress = () => {}) {
  const { stops, trips, routes, patterns } = data;
  const stopCount = stops.id.length;
  const originLat = (area.bbox[0] + area.bbox[2]) / 2;
  const networks = NETS.map((net) => new Network(graphs[net], { originLat, ...SETTINGS[net] }));

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
  onProgress(`routing ${hops.size} hops`);

  const candidateCache = new Map();
  const candidates = (n, stop) => {
    const key = n * stopCount + stop;
    let list = candidateCache.get(key);
    if (!list) candidateCache.set(key, (list = networks[n].candidates(stops.lat[stop], stops.lon[stop])));
    return list;
  };

  const routed = []; // { key, net, pts: [lat, lon, …] in 1e-5 degrees }
  const stats = NETS.map(() => ({ hops: 0, routed: 0 }));
  let done = 0;

  for (const key of hops) {
    // hopKey taken apart again
    const to = key % stopCount;
    const from = Math.floor(key / stopCount) % stopCount;
    const n = Math.floor(key / stopCount / stopCount);
    const network = networks[n];
    stats[n].hops++;
    if (++done % 10000 === 0) onProgress(`${done} of ${hops.size} hops done`);

    const a = candidates(n, from);
    const b = candidates(n, to);
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
    if (!route) continue;

    route = simplify(route, SIMPLIFY_M);
    const pts = [];
    for (let i = 0; i < route.length; i += 2) {
      const [lat, lon] = network.toLatLon(route[i], route[i + 1]);
      const iLat = Math.round(lat * 1e5);
      const iLon = Math.round(lon * 1e5);
      if (i && iLat === pts.at(-2) && iLon === pts.at(-1)) continue;
      pts.push(iLat, iLon);
    }
    if (pts.length < 4) continue;
    routed.push({ key, net: n, pts });
    stats[n].routed++;
  }
  onProgress(`hops routed: ${NETS.map((net, n) => `${net} ${stats[n].routed}/${stats[n].hops}`).join(', ')}`);

  routed.sort((a, b) => a.key - b.key);
  const start = new Int32Array(routed.length + 1);
  routed.forEach(({ pts }, i) => { start[i + 1] = start[i] + pts.length / 2; });
  const points = new Int32Array(2 * start[routed.length]);
  const share = new Float64Array(start[routed.length]);
  // (one latitude for the lengths of the whole area: a degree of longitude is shorter than one of latitude)
  const kx = Math.cos(originLat * (Math.PI / 180));
  routed.forEach(({ pts }, i) => {
    points.set(pts, 2 * start[i]);
    let length = 0;
    for (let k = 2; k < pts.length; k += 2) {
      length += Math.hypot(pts[k] - pts[k - 2], (pts[k + 1] - pts[k - 1]) * kx);
      share[start[i] + k / 2] = length;
    }
    for (let k = start[i]; k < start[i + 1]; k++) share[k] = length ? share[k] / length : 1;
  });
  return { nets: NETS, net: Uint8Array.from(routed, (segment) => segment.net), key: Float64Array.from(routed, (segment) => segment.key), start, points, share };
}
