// Route geometry. The GTFS feed has no shapes.txt, so the path between two
// consecutive stops is found by routing over OpenStreetMap: buses on roads,
// trams, U-Bahn and trains on their tracks. The result is one polyline per
// distinct "stop A -> stop B on network N" hop, shared by all trips using it.

import fs from 'node:fs';
import path from 'node:path';
import { NEAR } from './area.js';
import { download, publicUrl, readGz, reason, writeGz } from './files.js';
import { NETS, Network, NetworkBuilder, simplify } from './network.js';
import { readPbfWays } from './osmpbf.js';
import { NET_OF_MODE, hopKey, routeMode } from './timetable.js';

// Bump when classifyWay, the cost factors or the output of NetworkBuilder
// (all in network.js) change: the cached networks are then built again from a
// fresh OSM download instead of being used for up to OSM_MAX_AGE_DAYS more.
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
 * @param timeoutMs limit for the download of one extract
 */
export async function loadNetworks({ dataDir, urls, area, maxAgeMs, timeoutMs, onProgress }) {
  if (!urls.length) return null;
  const cachePath = path.join(dataDir, 'osm-networks.json.gz');

  let cached = null;
  try {
    const data = readGz(cachePath);
    if (data.version === NETWORKS_VERSION && data.area === area.id && data.sources.join() === urls.join()) cached = data;
  } catch {
    // no usable cache
  }
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) return cached;

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
    const fresh = { version: NETWORKS_VERSION, fetchedAt: new Date().toISOString(), area: area.id, sources: urls, nets: builder.result() };
    if (!NETS.some((net) => fresh.nets[net].a.length)) throw new Error('no roads or tracks found in the area; do the extracts in OSM_PBF_URLS cover it?');
    writeGz(cachePath, fresh);
    return fresh;
  } catch (err) {
    onProgress(`OSM data could not be updated (${reason(err)}), ${cached ? `using the copy of ${cached.fetchedAt}` : 'keeping straight lines'}`);
    return cached;
  }
}

/**
 * Routes every hop of every trip in `data` (an importer dataset).
 * @returns {{nets, net, from, to, pts}} columnar segments; pts are delta-coded
 *   [lat, lon, dLat, dLon, …] in 1e-5 degrees.
 */
export function buildSegments(data, graphs, area, onProgress = () => {}) {
  const { stops, trips, routes } = data;
  const stopCount = stops.id.length;
  const originLat = (area.bbox[0] + area.bbox[2]) / 2;
  const networks = NETS.map((net) => new Network(graphs[net], { originLat, ...SETTINGS[net] }));

  // Distinct hops, keyed by (network, from stop, to stop).
  const hops = new Set();
  for (let t = 0; t < trips.id.length; t++) {
    const route = trips.route[t];
    const n = NETS.indexOf(NET_OF_MODE[routeMode(routes.type[route], routes.short[route])]);
    if (n < 0) continue;
    const list = trips.stops[t];
    for (let p = 1; p < list.length; p++) {
      if (list[p - 1] !== list[p]) hops.add(hopKey(n, list[p - 1], list[p], stopCount));
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

  const segments = { nets: NETS, net: [], from: [], to: [], pts: [] };
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
    let prevLat = 0;
    let prevLon = 0;
    for (let i = 0; i < route.length; i += 2) {
      const [lat, lon] = network.toLatLon(route[i], route[i + 1]);
      const iLat = Math.round(lat * 1e5);
      const iLon = Math.round(lon * 1e5);
      if (i && iLat === prevLat && iLon === prevLon) continue;
      pts.push(iLat - prevLat, iLon - prevLon);
      prevLat = iLat;
      prevLon = iLon;
    }
    if (pts.length < 4) continue;
    segments.net.push(n);
    segments.from.push(from);
    segments.to.push(to);
    segments.pts.push(pts);
    stats[n].routed++;
  }

  onProgress(`hops routed: ${NETS.map((net, n) => `${net} ${stats[n].routed}/${stats[n].hops}`).join(', ')}`);
  return segments;
}
