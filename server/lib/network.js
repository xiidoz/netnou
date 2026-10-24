// Routable networks built from OpenStreetMap ways – one for buses (roads), one
// each for trams, the U-Bahn and heavy rail (trams and the U-Bahn also on each
// other's tracks and on those of the light rail), one for ferries and one for
// cable cars and monorails – and the shortest-path search that turns "stop A,
// then stop B" into the geometry in between.

export const NETS = ['road', 'rail', 'subway', 'tram', 'ferry', 'cable'];

// Bump when classifyWay, the cost factors or the output of buildNetworks
// change: the cached networks are then built again from a fresh OSM download
// instead of being used for up to NETNOU_OSM_MAX_AGE_DAYS more, and routes
// found on older ones are found anew (shapes.js, feed.js).
export const NETWORKS_VERSION = 8;

const M_PER_DEG = 111_320;

// How fast a vehicle goes on a way, in km/h, where it does not say
// (maxspeed): by the kind of road or track (#264). Only how these compare
// within one hop counts, as the timetable says how long the hop takes; a
// bus or a coach goes no faster than BUS_MOST, on a motorway or a trunk road
// BUS_MOST_FAST. In town a bus is much slower than its limit, for the lights,
// the junctions and the traffic, and on the open road close to it: it goes
// at the share of TOWN_SHARE of a limit up to that many km/h, else at it.
const ROAD_SPEED = {
  motorway: 100, trunk: 80, primary: 50, secondary: 50, tertiary: 50,
  unclassified: 40, residential: 30, living_street: 10, service: 20,
  busway: 50, bus_guideway: 60, pedestrian: 10,
};
const BUS_MOST = 80;
const BUS_MOST_FAST = 100;
const TOWN_SHARE = [[50, 0.6], [70, 0.8]];
const RAIL_SPEED = { rail: 100, light_rail: 70, subway: 60, tram: 40, narrow_gauge: 40, monorail: 40, funicular: 15 };
const OTHER_SPEED = 20;
// What a maxspeed of the German traffic rules stands for.
const IMPLIED_SPEED = { 'DE:urban': 50, 'DE:rural': 100, 'DE:motorway': 130, 'DE:living_street': 7, 'DE:zone30': 30, 'DE:zone:30': 30, walk: 7, none: 130 };

/** The maxspeed of a way in km/h, or null where it has none that can be read. */
export function maxspeedOf(tags) {
  const raw = tags.maxspeed ?? tags['maxspeed:forward'] ?? tags['maxspeed:backward'];
  if (raw === undefined) return null;
  if (raw in IMPLIED_SPEED) return IMPLIED_SPEED[raw];
  const number = /^(\d+(?:\.\d+)?)\s*(mph)?/.exec(raw);
  return number ? Number(number[1]) * (number[2] ? 1.609 : 1) : null;
}

// Cost per metre relative to a main road. Buses prefer main roads; the factors
// must stay >= 1 so that straight-line distance remains a valid A* heuristic.
const ROAD_FACTOR = {
  motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1,
  unclassified: 1.15, residential: 1.3, living_street: 2, service: 1.6,
  busway: 1, bus_guideway: 1, pedestrian: 2.5,
};
const NO_ACCESS = ['no', 'private', 'agricultural', 'forestry', 'emergency', 'military'];
const NOT_A_ROAD = ['parking_aisle', 'driveway', 'drive-through', 'emergency_access'];
// The lifts that carry people as a line of a timetable does.
const AERIALWAYS = ['cable_car', 'gondola', 'mixed_lift', 'chair_lift'];
// Sidings and yards are legal but unlikely routes for passenger trains.
const SERVICE_FACTOR = { yard: 3, spur: 3, siding: 1.5, crossover: 1.2 };
// The Stadtbahn of several cities is an underground in the feed and runs on
// tracks that OpenStreetMap has as light rail and as tram, and trams of other
// cities run on the tracks of a Stadtbahn and through its tunnels (#128). So
// the networks of the U-Bahn and of trams have each other's tracks and those
// of the light rail as well, at this many times the cost: a line keeps to
// tracks of its own kind where it can.
const SHARED_FACTOR = 1.5;
const isYes = (value) => value === 'yes' || value === 'designated';

const FORWARD = 1;
const BACKWARD = 2;
const BOTH = 3;
// (with the directions of an edge: a track of another kind than the network's own, see SHARED_FACTOR)
const SHARED = 4;
// (and a main road, see MAIN_ROADS)
export const MAIN = 8;
// The roads that a long hop on the roads of a country is routed on between
// the roads near its stops (shapes.js), with their links.
const MAIN_ROADS = ['motorway', 'trunk', 'primary'];

function onewayDirection(tags, implied) {
  const oneway = tags.oneway;
  if (oneway === 'yes' || oneway === 'true' || oneway === '1') return FORWARD;
  if (oneway === '-1' || oneway === 'reverse') return BACKWARD;
  return oneway === undefined && implied ? FORWARD : BOTH;
}

/**
 * Decides which network an OSM way belongs to, and which others it is shared
 * with (SHARED_FACTOR).
 * @returns {{net: string, factor: number, dir: number, shared?: string[]} | null}
 */
export function classifyWay(tags) {
  if (tags.area === 'yes') return null;

  // Ferries go where their routes are drawn across the water, both ways.
  if (tags.route === 'ferry') return { net: 'ferry', factor: 1, dir: BOTH, speed: speedOf(OTHER_SPEED) };

  const railway = tags.railway;
  // Cable cars and monorails, funiculars and rack railways: in the feed of
  // Germany all of them have the route type of a funicular. Narrow gauge is
  // theirs whole, as the parts of a rack railway without a rack (rack=no)
  // are; a rack on the track of a tram or a train makes that track theirs.
  // Narrow gauge without a rack is a train's as well, of the route type of
  // rail, as the Harzer Schmalspurbahnen are in the feed (#248).
  const rack = tags.rack !== undefined && tags.rack !== 'no';
  if (railway === 'monorail' || railway === 'funicular' || railway === 'narrow_gauge' || AERIALWAYS.includes(tags.aerialway)
    || (rack && (railway === 'rail' || railway === 'light_rail' || railway === 'tram'))) {
    const kind = { net: 'cable', factor: SERVICE_FACTOR[tags.service] ?? 1, dir: BOTH, speed: speedOf(maxspeedOf(tags) ?? RAIL_SPEED[railway] ?? OTHER_SPEED) };
    return railway === 'narrow_gauge' && !rack ? { ...kind, shared: ['rail'] } : kind;
  }

  if (railway === 'rail' || railway === 'light_rail' || railway === 'subway' || railway === 'tram') {
    const factor = SERVICE_FACTOR[tags.service] ?? 1;
    const speed = speedOf(maxspeedOf(tags) ?? RAIL_SPEED[railway]);
    if (railway === 'subway') return { net: 'subway', factor, dir: onewayDirection(tags, false), shared: ['tram'], speed };
    // (the tracks of trams carry tram-trains too, whose lines are of the route type of rail: Karlsruhe, Kassel, #248)
    if (railway === 'tram') return { net: 'tram', factor, dir: onewayDirection(tags, false), shared: ['subway', 'rail'], speed };
    // Mainline tracks are signalled for a usual direction but can be used both ways.
    if (railway === 'light_rail') return { net: 'rail', factor, dir: BOTH, shared: ['subway', 'tram'], speed };
    return { net: 'rail', factor, dir: BOTH, speed };
  }

  const highway = tags.highway?.replace(/_link$/, '');
  let factor = ROAD_FACTOR[highway];
  if (factor === undefined) return null;
  const forBuses = isYes(tags.bus) || isYes(tags.psv) || highway === 'busway' || highway === 'bus_guideway';
  if (!forBuses) {
    if (highway === 'pedestrian') return null;
    if (NO_ACCESS.includes(tags.bus ?? tags.psv ?? tags.motor_vehicle ?? tags.vehicle ?? tags.access)) return null;
    if (highway === 'service' && NOT_A_ROAD.includes(tags.service)) return null;
  } else {
    factor = 1;
  }

  let dir = onewayDirection(tags, tags.highway === 'motorway' || tags.junction === 'roundabout' || tags.junction === 'circular');
  const contraflow =
    tags['oneway:bus'] === 'no' || tags['oneway:psv'] === 'no' ||
    isYes(tags['bus:backward']) || isYes(tags['psv:backward']) ||
    [tags.busway, tags['busway:left'], tags['busway:right']].includes('opposite_lane');
  if (dir !== BOTH && contraflow) dir = BOTH;
  // (how fast a bus goes there: as the way says, else by its kind, and no faster than a bus may)
  const fast = highway === 'motorway' || highway === 'trunk';
  const limit = Math.min(maxspeedOf(tags) ?? ROAD_SPEED[highway], fast ? BUS_MOST_FAST : BUS_MOST);
  const speed = speedOf(limit * (TOWN_SHARE.find(([most]) => limit <= most)?.[1] ?? 1));
  return MAIN_ROADS.includes(highway) ? { net: 'road', factor, dir, main: true, speed } : { net: 'road', factor, dir, speed };
}

/** A speed as it is kept, in a byte: half its km/h, from 3 to 255 (5 to 510 km/h). Only how speeds compare counts. */
const speedOf = (kmh) => Math.min(255, Math.max(3, Math.round(kmh / 2)));

/** Where a number is among numbers in order, or -1 if it is not. */
function indexIn(numbers, number) {
  let low = 0;
  for (let high = numbers.length; low < high;) {
    const middle = (low + high) >> 1;
    if (numbers[middle] < number) low = middle + 1;
    else high = middle;
  }
  return numbers[low] === number ? low : -1;
}

/**
 * The places of several extracts as one, in the order of the ids of the
 * nodes, each once; and for each extract the number in it of each of its own.
 */
function mergePlaces(list) {
  if (list.length === 1) return { places: list[0], numbers: [null] };
  const total = list.reduce((sum, places) => sum + places.id.length, 0);
  const all = new Float64Array(total);
  let n = 0;
  for (const places of list) {
    all.set(places.id, n);
    n += places.id.length;
  }
  all.sort();
  let count = 0;
  for (let i = 0; i < all.length; i++) if (!i || all[i] !== all[i - 1]) all[count++] = all[i];
  const merged = { id: all.slice(0, count), lat: new Int32Array(count), lon: new Int32Array(count) };
  const numbers = list.map((places) => Int32Array.from(places.id, (id) => indexIn(merged.id, id)));
  // (a node of two extracts is the same node; should they have it in two places, as of two days, the first counts, as for a way)
  for (let r = list.length - 1; r >= 0; r--) {
    numbers[r].forEach((at, i) => {
      merged.lat[at] = list[r].lat[i];
      merged.lon[at] = list[r].lon[i];
    });
  }
  return { places: merged, numbers };
}

/**
 * The networks in what readPbfWays read of the extracts (classify:
 * classifyWay), in the form that Network reads: for each of NETS the places
 * of its nodes in 1e-7 degrees (lat, lon) and its edges from node a to node b,
 * with the factor of their cost in percent (f) and the directions they may be
 * used in (d), with SHARED for a track of another kind than the network's
 * own. A way that two extracts have counts once, for the first. A way is cut
 * where a node was not kept, and nodes are numbered as they first come up, in
 * the order of the ways.
 */
export function buildNetworks(readings) {
  const { places, numbers } = mergePlaces(readings.map((reading) => reading.places));
  // (of a way that two extracts have, the one of the first counts)
  const counts = readings.map(() => null);
  if (readings.length > 1) {
    const seen = new Set();
    readings.forEach(({ ways }, r) => {
      counts[r] = new Uint8Array(ways.id.length);
      ways.id.forEach((id, w) => {
        if (seen.has(id)) return;
        seen.add(id);
        counts[r][w] = 1;
      });
    });
  }
  const numberOf = new Int32Array(places.id.length);
  return Object.fromEntries(NETS.map((net) => {
    // What each kind of way is on this network: its own, shared with it, or nothing.
    const asOf = readings.map(({ kinds }) => kinds.map((kind) => {
      if (kind.net === net) return { factor: kind.factor, dir: kind.main ? kind.dir | MAIN : kind.dir, speed: kind.speed };
      return kind.shared?.includes(net) ? { factor: kind.factor * SHARED_FACTOR, dir: kind.dir | SHARED, speed: kind.speed } : null;
    }));
    // (as long as it can be at most: as many nodes and edges as the ways of the network have nodes)
    let most = 0;
    readings.forEach(({ ways }, r) => {
      for (let w = 0; w < ways.id.length; w++) if (asOf[r][ways.kind[w]] && (!counts[r] || counts[r][w])) most += ways.start[w + 1] - ways.start[w];
    });
    const lat = new Int32Array(most);
    const lon = new Int32Array(most);
    const [a, b, f, d, sp] = [new Int32Array(most), new Int32Array(most), new Uint16Array(most), new Uint8Array(most), new Uint8Array(most)];
    let [nodeCount, edgeCount] = [0, 0];
    numberOf.fill(-1);
    const run = [];
    /** A run of nodes that were kept, as places: its edges, and its nodes as they first come up. */
    const flush = (factor, dir, speed) => {
      if (run.length >= 2) {
        let previous = -1;
        for (const place of run) {
          let node = numberOf[place];
          if (node < 0) {
            node = numberOf[place] = nodeCount++;
            lat[node] = places.lat[place];
            lon[node] = places.lon[place];
          }
          if (previous >= 0 && previous !== node) {
            a[edgeCount] = previous;
            b[edgeCount] = node;
            f[edgeCount] = Math.round(factor * 100);
            d[edgeCount] = dir;
            sp[edgeCount] = speed;
            edgeCount++;
          }
          previous = node;
        }
      }
      run.length = 0;
    };
    readings.forEach(({ ways, nodes }, r) => {
      for (let w = 0; w < ways.id.length; w++) {
        const as = asOf[r][ways.kind[w]];
        if (!as || (counts[r] && !counts[r][w])) continue;
        const { factor, dir, speed } = as;
        for (let k = ways.start[w]; k < ways.start[w + 1]; k++) {
          const place = nodes[k] < 0 || !numbers[r] ? nodes[k] : numbers[r][nodes[k]];
          if (place >= 0) run.push(place);
          else flush(factor, dir, speed);
        }
        flush(factor, dir, speed);
      }
    });
    // (the part that was filled, without a copy)
    return [net, { lat: lat.subarray(0, nodeCount), lon: lon.subarray(0, nodeCount), a: a.subarray(0, edgeCount), b: b.subarray(0, edgeCount), f: f.subarray(0, edgeCount), d: d.subarray(0, edgeCount), s: sp.subarray(0, edgeCount) }];
  }));
}

// The roads of an instance are one network as long as they have no more
// nodes than this, as those of a region have (the default area 2 million).
// The roads of a country are routed in tiles instead (tilesOf).
export const ROADS_AT_ONCE = 4_000_000;
// A tile is a square of this many degrees, about 28 km from north to south
// and 18 km from west to east in Germany. A hop is routed on the roads of the
// tile its middle is in and of the eight tiles around it: four in ten
// thousand of the hops on roads of all of Germany are too long for that.
export const TILE = 0.25;

/**
 * The roads in tiles: the nodes of every tile that has any, and the edges
 * that begin in it, each in the order of their numbers.
 * @param graph a network as buildNetworks gives it
 * @returns { size, row, col, keys, nodeStart, nodes, edgeStart, edges }: the
 *   tile of a place in 1e-7 degrees is key(row(lat), col(lon)); tile t of
 *   the ones that have nodes is keys[t], its nodes are nodes[nodeStart[t]]
 *   to nodes[nodeStart[t + 1] - 1] and its edges the same of `edges`.
 */
export function tilesOf(graph, size = TILE) {
  const unit = size * 1e7;
  const row = (lat) => Math.floor(lat / unit);
  const col = (lon) => Math.floor(lon / unit);
  const nodeCount = graph.lat.length;
  let [south, west, north, east] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nodeCount; i++) {
    south = Math.min(south, row(graph.lat[i]));
    north = Math.max(north, row(graph.lat[i]));
    west = Math.min(west, col(graph.lon[i]));
    east = Math.max(east, col(graph.lon[i]));
  }
  // (a tile as one whole number, the rows and columns of the network and one more on each side; -1 for one beyond them)
  const width = east - west + 3;
  const key = (r, c) => (r >= south - 1 && r <= north + 1 && c >= west - 1 && c <= east + 1 ? (r - south + 1) * width + (c - west + 1) : -1);
  const tileOfNode = new Int32Array(nodeCount);
  for (let i = 0; i < nodeCount; i++) tileOfNode[i] = key(row(graph.lat[i]), col(graph.lon[i]));
  // (by counting: there are some thousand tiles and millions of nodes)
  const keys = Int32Array.from(new Set(tileOfNode)).sort();
  const numberOf = new Map(Array.from(keys, (k, t) => [k, t]));
  const sorted = (count, tileOf) => {
    const start = new Int32Array(keys.length + 1);
    for (let i = 0; i < count; i++) start[numberOf.get(tileOf(i)) + 1]++;
    for (let t = 0; t < keys.length; t++) start[t + 1] += start[t];
    const fill = start.slice(0, keys.length);
    const list = new Int32Array(count);
    for (let i = 0; i < count; i++) list[fill[numberOf.get(tileOf(i))]++] = i;
    return { start, list };
  };
  const byNode = sorted(nodeCount, (i) => tileOfNode[i]);
  const byEdge = sorted(graph.a.length, (e) => tileOfNode[graph.a[e]]);
  return { size, row, col, key, keys, nodeStart: byNode.start, nodes: byNode.list, edgeStart: byEdge.start, edges: byEdge.list };
}

/**
 * The part of a network that is in some of its tiles, in the form Network
 * reads: the nodes of those tiles and the edges between them, in the order of
 * their numbers in the whole network.
 * @param keys the tiles, as keys of tilesOf
 * @param scratch an Int32Array of -1 for every node of the network, which it
 *   is again afterwards
 * @returns the part, and `global`: the number of each of its nodes in the
 *   whole network
 */
export function windowOf(graph, tiles, keys, scratch) {
  const found = keys.map((key) => indexIn(tiles.keys, key)).filter((t) => t >= 0);
  /** The numbers of the nodes or edges of those tiles, in order. */
  const gather = (start, list) => {
    const out = new Int32Array(found.reduce((sum, t) => sum + start[t + 1] - start[t], 0));
    let n = 0;
    for (const t of found) {
      out.set(list.subarray(start[t], start[t + 1]), n);
      n += start[t + 1] - start[t];
    }
    return out.sort();
  };
  const global = gather(tiles.nodeStart, tiles.nodes);
  for (let i = 0; i < global.length; i++) scratch[global[i]] = i;
  const candidates = gather(tiles.edgeStart, tiles.edges);
  let count = 0;
  for (let k = 0; k < candidates.length; k++) if (scratch[graph.b[candidates[k]]] >= 0) candidates[count++] = candidates[k];
  const edges = candidates.subarray(0, count);
  const part = {
    lat: new Int32Array(global.length),
    lon: new Int32Array(global.length),
    a: new Int32Array(count),
    b: new Int32Array(count),
    f: new Uint16Array(count),
    d: new Uint8Array(count),
    s: graph.s ? new Uint8Array(count) : undefined,
    global,
  };
  for (let i = 0; i < global.length; i++) {
    part.lat[i] = graph.lat[global[i]];
    part.lon[i] = graph.lon[global[i]];
  }
  for (let k = 0; k < count; k++) {
    const e = edges[k];
    part.a[k] = scratch[graph.a[e]];
    part.b[k] = scratch[graph.b[e]];
    part.f[k] = graph.f[e];
    part.d[k] = graph.d[e];
    if (graph.s) part.s[k] = graph.s[e];
  }
  for (let i = 0; i < global.length; i++) scratch[global[i]] = -1;
  return part;
}

/**
 * The part of a network made of some of its edges, in the form Network
 * reads: those edges and their nodes, in the order of their numbers in the
 * whole network.
 * @param keep (e) => whether edge e of the network is in the part
 * @param scratch an Int32Array of -1 for every node of the network, which it
 *   is again afterwards
 * @returns the part, and `global`: the number of each of its nodes in the
 *   whole network
 */
export function partOf(graph, keep, scratch) {
  const kept = new Uint8Array(graph.a.length);
  let count = 0;
  for (let e = 0; e < graph.a.length; e++) {
    if (!keep(e)) continue;
    kept[e] = 1;
    count++;
    scratch[graph.a[e]] = scratch[graph.b[e]] = 0;
  }
  let nodeCount = 0;
  for (let i = 0; i < scratch.length; i++) if (scratch[i] === 0) nodeCount++;
  const part = {
    lat: new Int32Array(nodeCount),
    lon: new Int32Array(nodeCount),
    a: new Int32Array(count),
    b: new Int32Array(count),
    f: new Uint16Array(count),
    d: new Uint8Array(count),
    s: graph.s ? new Uint8Array(count) : undefined,
    global: new Int32Array(nodeCount),
  };
  for (let i = 0, n = 0; i < scratch.length; i++) {
    if (scratch[i] < 0) continue;
    part.lat[n] = graph.lat[i];
    part.lon[n] = graph.lon[i];
    part.global[n] = i;
    scratch[i] = n++;
  }
  for (let e = 0, k = 0; e < graph.a.length; e++) {
    if (!kept[e]) continue;
    part.a[k] = scratch[graph.a[e]];
    part.b[k] = scratch[graph.b[e]];
    part.f[k] = graph.f[e];
    part.d[k] = graph.d[e];
    if (graph.s) part.s[k] = graph.s[e];
    k++;
  }
  for (const i of part.global) scratch[i] = -1;
  return part;
}

class MinHeap {
  constructor() {
    this.keys = new Float64Array(1 << 12);
    this.values = new Int32Array(1 << 12);
    this.size = 0;
  }

  push(key, value) {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2);
      const values = new Int32Array(this.size * 2);
      keys.set(this.keys);
      values.set(this.values);
      this.keys = keys;
      this.values = values;
    }
    const { keys, values } = this;
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }

  /** Removes the smallest entry; its key and value are left in topKey/topValue. */
  pop() {
    const { keys, values } = this;
    this.topKey = keys[0];
    this.topValue = values[0];
    const n = --this.size;
    const key = keys[n];
    const value = values[n];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= n) break;
      if (child + 1 < n && keys[child + 1] < keys[child]) child++;
      if (keys[child] >= key) break;
      keys[i] = keys[child];
      values[i] = values[child];
      i = child;
    }
    keys[i] = key;
    values[i] = value;
  }
}

const CELL_M = 120;
// How many candidates a stop has on shared tracks where its own are spread (snapSpread).
const SHARED_CANDIDATES = 6;
// An edge whose rectangle has more cells than this is put into those along it.
const LONG_EDGE_CELLS = 64;
// routeBeyond stops searching once it is this close to the stop it heads for.
const CLOSE_ENOUGH_M = 300;
// It leaves the network where the way so far plus this many times the straight
// line that is left is shortest: a metre of way has to bring it half a metre
// closer to the stop, so it follows the network towards the stop and not past it.
const AHEAD = 2;

export class Network {
  /**
   * @param graph one entry of NetworkBuilder.result()
   * @param options.originLat  latitude used for the local metre projection
   * @param options.snapRadius how far (m) a stop may be from the way it is on
   * @param options.snapPenalty cost per metre of that distance, to prefer the nearest way
   * @param options.snapAt where stops will be snapped, if only at some places
   *   ([[lat, lon], …]): the grid for snapping then has only the edges there
   * @param options.snapSpread for tracks (#243): a stop may be on any edge of
   *   the network's own kind up to this many metres further away than the
   *   nearest, up to maxCandidates of them, and on the nearest shared ones:
   *   in a large station the track a train takes need not be among the
   *   nearest few edges. Null: the nearest maxCandidates
   * @param options.sharedLast for trains (#248): a route keeps to tracks of
   *   the network's own kind where it can (route with `own`); tracks it shares
   *   (those of trams, narrow gauge) are for where it cannot, as the street
   *   tracks of tram-trains are, and are no short cut for every other train
   * @param options.maxTurn for tracks (#243): how many degrees a route may
   *   turn at a node between two stops. A train goes through a switch only in
   *   the direction it faces; going into it on one branch and out on the other
   *   would be turning back, which it does at a stop. The search then goes from
   *   edge to edge and knows which way it came. Null: any way that meets a
   *   node may come next, as on roads
   */
  constructor(graph, { originLat, snapRadius, snapPenalty, maxCandidates = 6, snapSpread = null, snapAt = null, maxTurn = null, sharedLast = false }) {
    this.snapRadius = snapRadius;
    this.snapPenalty = snapPenalty;
    this.maxCandidates = maxCandidates;
    this.snapSpread = snapSpread;
    this.kx = M_PER_DEG * Math.cos((originLat * Math.PI) / 180);
    this.ky = M_PER_DEG;
    // The places are on a plane that is right at originLat. A metre from west
    // to east is longer than that further south and shorter further north, by
    // a tenth from the middle of Germany to its edges: lengths and distances
    // are measured at their own latitude.
    this.eastAt = (lat) => Math.cos((lat * Math.PI) / 180) / Math.cos((originLat * Math.PI) / 180);

    const n = graph.lat.length;
    const m = graph.a.length;
    this.nodeCount = n;
    // (with loops: Float64Array.from with a function takes forty times as long)
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = (graph.lon[i] / 1e7) * this.kx;
      this.y[i] = (graph.lat[i] / 1e7) * this.ky;
    }
    this.a = new Int32Array(graph.a);
    this.b = new Int32Array(graph.b);
    this.dir = new Uint8Array(graph.d);
    this.len = new Float64Array(m);
    this.cost = new Float64Array(m);
    for (let e = 0; e < m; e++) {
      const east = this.eastAt((graph.lat[this.a[e]] + graph.lat[this.b[e]]) / 2e7);
      this.len[e] = Math.hypot((this.x[this.a[e]] - this.x[this.b[e]]) * east, this.y[this.a[e]] - this.y[this.b[e]]);
      this.cost[e] = (this.len[e] * graph.f[e]) / 100;
    }

    // Adjacency in both orientations: `out` to search forwards from a stop,
    // `in` to search backwards from the stop a vehicle arrives at.
    this.turnCos = maxTurn === null ? null : Math.cos((maxTurn * Math.PI) / 180);
    this.sharedLast = sharedLast;
    // (how fast a vehicle goes on each edge, as speedOf keeps it, where the network says: #264)
    this.speed = graph.s ? new Uint8Array(graph.s) : null;
    this.out = this.adjacency(FORWARD, BACKWARD);
    this.in = this.adjacency(BACKWARD, FORWARD);

    // Spatial grid of edges for snapping stops: an edge is in each cell of
    // the rectangle around it. A long one, such as an edge of a ferry across
    // the sea, is in the cells along it instead: its rectangle would be
    // hundreds of thousands of them.
    this.grid = new Map();
    // (only the cells around the places of snapAt: of the 4.8 million edges of
    // the network of the long hops of a country, some thousand are near their
    // stops)
    let wanted = null;
    if (snapAt) {
      wanted = new Set();
      for (const [lat, lon] of snapAt) {
        const [px, py] = this.toXY(lat, lon);
        const east = this.eastAt(lat);
        for (let cx = Math.floor((px - snapRadius / east) / CELL_M); cx <= Math.floor((px + snapRadius / east) / CELL_M); cx++) {
          for (let cy = Math.floor((py - snapRadius) / CELL_M); cy <= Math.floor((py + snapRadius) / CELL_M); cy++) wanted.add(cx * 1e6 + cy);
        }
      }
    }
    const put = (key, e) => {
      if (wanted && !wanted.has(key)) return;
      const cell = this.grid.get(key);
      if (cell) cell.push(e);
      else this.grid.set(key, [e]);
    };
    for (let e = 0; e < m; e++) {
      const [ax, ay, bx, by] = [this.x[this.a[e]], this.y[this.a[e]], this.x[this.b[e]], this.y[this.b[e]]];
      const x0 = Math.floor(Math.min(ax, bx) / CELL_M);
      const x1 = Math.floor(Math.max(ax, bx) / CELL_M);
      const y0 = Math.floor(Math.min(ay, by) / CELL_M);
      const y1 = Math.floor(Math.max(ay, by) / CELL_M);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= LONG_EDGE_CELLS) {
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) put(cx * 1e6 + cy, e);
        continue;
      }
      const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL_M / 4));
      let last = null;
      for (let i = 0; i <= steps; i++) {
        const key = Math.floor((ax + ((bx - ax) * i) / steps) / CELL_M) * 1e6 + Math.floor((ay + ((by - ay) * i) / steps) / CELL_M);
        if (key !== last) put(key, e);
        last = key;
      }
    }

    this.dist = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.query = 0;
    this.heap = new MinHeap();
    if (this.turnCos !== null) {
      // (the same for every arc of the search from edge to edge: there are as many in `in` as in `out`)
      const arcs = this.out.to.length;
      this.arcDist = new Float64Array(arcs);
      this.arcPrev = new Int32Array(arcs);
      this.arcStamp = new Int32Array(arcs);
    }
  }

  // Compressed adjacency lists: arcs leaving a→b edges at `a` if the edge
  // allows `viaA`, and at `b` if it allows `viaB`. Where turns are limited,
  // also the node each arc leaves (`from`) and the arc of each edge from a to
  // b and from b to a (`ab`, `ba`; -1 where it may not be used that way).
  // Where shared tracks come last, whether each arc is on one (`shared`).
  adjacency(viaA, viaB) {
    const { a, b, dir, cost, nodeCount } = this;
    const arcs = this.turnCos !== null;
    const start = new Int32Array(nodeCount + 1);
    for (let e = 0; e < a.length; e++) {
      if (dir[e] & viaA) start[a[e] + 1]++;
      if (dir[e] & viaB) start[b[e] + 1]++;
    }
    for (let i = 0; i < nodeCount; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nodeCount);
    const to = new Int32Array(start[nodeCount]);
    const arcCost = new Float64Array(start[nodeCount]);
    const from = arcs ? new Int32Array(start[nodeCount]) : null;
    const shared = this.sharedLast ? new Uint8Array(start[nodeCount]) : null;
    const speed = this.speed ? new Uint8Array(start[nodeCount]) : null;
    const ab = arcs ? new Int32Array(a.length).fill(-1) : null;
    const ba = arcs ? new Int32Array(a.length).fill(-1) : null;
    for (let e = 0; e < a.length; e++) {
      if (dir[e] & viaA) {
        if (arcs) { from[fill[a[e]]] = a[e]; ab[e] = fill[a[e]]; }
        if (shared && dir[e] & SHARED) shared[fill[a[e]]] = 1;
        if (speed) speed[fill[a[e]]] = this.speed[e];
        to[fill[a[e]]] = b[e];
        arcCost[fill[a[e]]++] = cost[e];
      }
      if (dir[e] & viaB) {
        if (arcs) { from[fill[b[e]]] = b[e]; ba[e] = fill[b[e]]; }
        if (shared && dir[e] & SHARED) shared[fill[b[e]]] = 1;
        if (speed) speed[fill[b[e]]] = this.speed[e];
        to[fill[b[e]]] = a[e];
        arcCost[fill[b[e]]++] = cost[e];
      }
    }
    return { start, to, cost: arcCost, from, ab, ba, shared, speed };
  }

  toXY(lat, lon) {
    return [lon * this.kx, lat * this.ky];
  }

  toLatLon(x, y) {
    return [y / this.ky, x / this.kx];
  }

  /**
   * Points on nearby edges a stop at (lat, lon) may be on, nearest first: up
   * to maxCandidates on tracks of the network's own kind and as many on tracks
   * it shares (`shared`), so that where shared ones are nearer, as a tunnel
   * under a stop of trams is, they do not crowd out those of its own kind.
   */
  candidates(lat, lon) {
    const [px, py] = this.toXY(lat, lon);
    const r = this.snapRadius;
    const east = this.eastAt(lat);
    const found = [];
    const seen = new Set();
    for (let cx = Math.floor((px - r / east) / CELL_M); cx <= Math.floor((px + r / east) / CELL_M); cx++) {
      for (let cy = Math.floor((py - r) / CELL_M); cy <= Math.floor((py + r) / CELL_M); cy++) {
        for (const e of this.grid.get(cx * 1e6 + cy) ?? []) {
          if (seen.has(e)) continue;
          seen.add(e);
          const ax = this.x[this.a[e]];
          const ay = this.y[this.a[e]];
          const dx = this.x[this.b[e]] - ax;
          const dy = this.y[this.b[e]] - ay;
          const t = Math.min(1, Math.max(0, ((px - ax) * dx * east * east + (py - ay) * dy) / (dx * dx * east * east + dy * dy || 1)));
          const x = ax + dx * t;
          const y = ay + dy * t;
          const distance = Math.hypot((px - x) * east, py - y);
          if (distance <= r) found.push({ edge: e, t, x, y, penalty: distance * this.snapPenalty, shared: (this.dir[e] & SHARED) > 0 });
        }
      }
    }
    found.sort((p, q) => p.penalty - q.penalty);
    const own = found.filter((c) => !c.shared);
    // (on tracks of its own kind, those within snapSpread of the nearest; on shared ones, as without it)
    const spread = this.snapSpread === null || !own.length ? null : own[0].penalty + this.snapSpread * this.snapPenalty;
    const ofOwn = spread === null ? own.slice(0, this.maxCandidates) : own.filter((c) => c.penalty <= spread).slice(0, this.maxCandidates);
    const shared = found.filter((c) => c.shared);
    if (!shared.length) return ofOwn;
    return [...ofOwn, ...shared.slice(0, this.snapSpread === null ? this.maxCandidates : SHARED_CANDIDATES)].sort((p, q) => p.penalty - q.penalty);
  }

  // Seeds for a search leaving (forwards) or reaching (backwards) a candidate:
  // the edge end the vehicle gets to first and what that costs; the search
  // goes along the edge from a to b to get there (`ab`), or from b to a.
  seeds(candidates, backwards) {
    const seeds = [];
    candidates.forEach((c, i) => {
      const { edge: e, t } = c;
      const toB = backwards ? BACKWARD : FORWARD;
      const toA = backwards ? FORWARD : BACKWARD;
      if (this.dir[e] & toB) seeds.push({ node: this.b[e], cost: c.penalty + (1 - t) * this.cost[e], candidate: i, edge: e, ab: true });
      if (this.dir[e] & toA) seeds.push({ node: this.a[e], cost: c.penalty + t * this.cost[e], candidate: i, edge: e, ab: false });
    });
    return seeds;
  }

  /**
   * Whether a stop, by its candidates, is one on tracks of the network's own
   * kind: the nearest of those no more than snapSpread further away than the
   * nearest it shares (sharedLast). A station of trains is, with the tracks of
   * trams before it or not; a stop of tram-trains in a street is not, even with
   * a railway some hundred metres away.
   */
  onOwn(candidates) {
    const own = candidates.find((c) => !c.shared);
    const shared = candidates.find((c) => c.shared);
    return Boolean(own) && (!shared || own.penalty <= shared.penalty + (this.snapSpread ?? 0) * this.snapPenalty);
  }

  /** Whether a route may go on from arc k1 of `adj` to arc k2, which leaves the node k1 reaches (maxTurn). */
  turns(adj, k1, k2) {
    const { x, y, turnCos: cos } = this;
    const [u, v, w] = [adj.from[k1], adj.to[k1], adj.to[k2]];
    const [dx1, dy1, dx2, dy2] = [x[v] - x[u], y[v] - y[u], x[w] - x[v], y[w] - y[v]];
    const dot = dx1 * dx2 + dy1 * dy2;
    // (the cosine of the turn against that of maxTurn, squared: most turns are slight and need no more than the sign)
    if ((dot >= 0) !== (cos >= 0)) return dot >= 0;
    return (dot * dot >= cos * cos * (dx1 * dx1 + dy1 * dy1) * (dx2 * dx2 + dy2 * dy2)) === (cos >= 0);
  }

  /**
   * As search, from arc to arc of `adj` for a network whose turns are
   * limited (maxTurn): a route that reaches a node on one arc goes on only on
   * those that it may turn into. `visit(node, g, arc)` is called with the arc
   * the node is reached on; afterwards `traceArcs` follows that arc back.
   */
  searchArcs(adj, seeds, heuristic, maxCost, visit, own = false) {
    const { arcDist: dist, arcPrev: prev, arcStamp: stamp, heap } = this;
    const q = ++this.query;
    heap.size = 0;
    for (const seed of seeds) {
      const k = seed.ab ? adj.ab[seed.edge] : adj.ba[seed.edge];
      if (k < 0 || (stamp[k] === q && dist[k] <= seed.cost)) continue;
      stamp[k] = q;
      dist[k] = seed.cost;
      prev[k] = -1 - seed.candidate;
      heap.push(seed.cost + (heuristic ? heuristic(seed.node) : 0), k);
    }
    while (heap.size) {
      heap.pop();
      const k = heap.topValue;
      const u = adj.to[k];
      const g = dist[k];
      if (heap.topKey > g + (heuristic ? heuristic(u) : 0) + 1e-6) continue;
      if (g > maxCost || visit(u, g, k)) return;
      for (let k2 = adj.start[u]; k2 < adj.start[u + 1]; k2++) {
        if ((own && adj.shared[k2]) || !this.turns(adj, k, k2)) continue;
        const ng = g + adj.cost[k2];
        if (stamp[k2] !== q || ng < dist[k2]) {
          stamp[k2] = q;
          dist[k2] = ng;
          prev[k2] = k;
          heap.push(ng + (heuristic ? heuristic(adj.to[k2]) : 0), k2);
        }
      }
    }
  }

  /** As trace, for a search from arc to arc: the nodes up to where `arc` of `adj` leads. */
  traceArcs(adj, arc) {
    const nodes = [];
    let k = arc;
    while (k >= 0) {
      nodes.push(adj.to[k]);
      k = this.arcPrev[k];
    }
    return { nodes: nodes.reverse(), candidate: -1 - k };
  }

  /**
   * Dijkstra / A* from the seeds. `visit(node, g)` is called for every settled
   * node and ends the search by returning true. Afterwards `trace` follows the
   * found path back to its seed.
   */
  search(adj, seeds, heuristic, maxCost, visit, own = false) {
    const { dist, prev, stamp, heap } = this;
    const q = ++this.query;
    heap.size = 0;
    for (const seed of seeds) {
      if (stamp[seed.node] === q && dist[seed.node] <= seed.cost) continue;
      stamp[seed.node] = q;
      dist[seed.node] = seed.cost;
      prev[seed.node] = -1 - seed.candidate;
      heap.push(seed.cost + (heuristic ? heuristic(seed.node) : 0), seed.node);
    }
    while (heap.size) {
      heap.pop();
      const u = heap.topValue;
      const g = dist[u];
      // Outdated heap entry: the node was reached more cheaply in the meantime.
      if (heap.topKey > g + (heuristic ? heuristic(u) : 0) + 1e-6) continue;
      if (g > maxCost || visit(u, g)) return;
      for (let k = adj.start[u]; k < adj.start[u + 1]; k++) {
        if (own && adj.shared[k]) continue;
        const v = adj.to[k];
        const ng = g + adj.cost[k];
        if (stamp[v] !== q || ng < dist[v]) {
          stamp[v] = q;
          dist[v] = ng;
          prev[v] = u;
          heap.push(ng + (heuristic ? heuristic(v) : 0), v);
        }
      }
    }
  }

  /** Nodes from the seed to `node` (search order) and the candidate the seed belongs to. */
  trace(node) {
    const nodes = [];
    let u = node;
    while (u >= 0) {
      nodes.push(u);
      u = this.prev[u];
    }
    return { nodes: nodes.reverse(), candidate: -1 - u };
  }

  /**
   * The connected part of the network a node is in, as a number that all of
   * its nodes share. (Found once, as if every edge could be used both ways.)
   */
  component(u) {
    if (!this.components) {
      const root = new Int32Array(this.nodeCount);
      for (let i = 0; i < root.length; i++) root[i] = i;
      const find = (i) => {
        while (root[i] !== i) {
          root[i] = root[root[i]];
          i = root[i];
        }
        return i;
      };
      for (let e = 0; e < this.a.length; e++) {
        const [p, q] = [find(this.a[e]), find(this.b[e])];
        if (p !== q) root[p] = q;
      }
      for (let i = 0; i < root.length; i++) root[i] = find(i);
      this.components = root;
    }
    return this.components[u];
  }

  /**
   * What a way from a node to one of the candidates `to` of a stop at [x, y]
   * costs at the least: the straight line to the stop, measured at the
   * latitude of the more northern of the two, less how far the furthest of
   * the candidates is from the stop.
   */
  leastTo([x, y], to) {
    const lat = y / this.ky;
    const off = Math.max(0, ...to.map((c) => Math.hypot((c.x - x) * this.eastAt(lat), c.y - y)));
    return (u) => Math.max(0, Math.hypot((this.x[u] - x) * this.eastAt(Math.max(this.y[u] / this.ky, lat)), this.y[u] - y) - off);
  }

  /**
   * Cheapest way from one of the candidates of stop A to one of stop B.
   * @param towards for a long hop: where stop B is, [x, y] in metres. The
   *   search then heads for it (A*), and is not begun where B is on a part of
   *   the network that A is not connected to.
   * @param turning false: any way that meets a node may come next, also where
   *   the network limits its turns (maxTurn)
   * @param own on tracks of the network's own kind alone, where shared ones
   *   come last (sharedLast)
   * @returns flat [x0, y0, x1, y1, …] in metres, or null if there is no route
   *   shorter than maxLength.
   */
  route(from, to, maxLength, towards = null, turning = true, own = false) {
    own &&= this.sharedLast;
    if (own) {
      from = from.filter((c) => !c.shared);
      to = to.filter((c) => !c.shared);
    }
    let best = Infinity;
    let bestPath = null;

    // Both stops on the same edge: no search needed.
    for (const ca of from) {
      for (const cb of to) {
        if (ca.edge !== cb.edge || !(this.dir[ca.edge] & (cb.t >= ca.t ? FORWARD : BACKWARD))) continue;
        const total = ca.penalty + cb.penalty + Math.abs(cb.t - ca.t) * this.cost[ca.edge];
        if (total < best) {
          best = total;
          bestPath = this.timed([ca.x, ca.y, cb.x, cb.y], ca.edge);
        }
      }
    }

    if (towards && !bestPath && !from.some((ca) => to.some((cb) => this.component(this.a[ca.edge]) === this.component(this.a[cb.edge])))) return null;

    // node -> ways to finish at a candidate of B from there; where turns are
    // limited, with the arc that leaves the node towards the candidate (the
    // search that found the way came along the edge the other way)
    turning &&= this.turnCos !== null;
    const finish = new Map();
    for (const { node, cost, candidate, edge, ab } of this.seeds(to, true)) {
      if (!finish.has(node)) finish.set(node, []);
      finish.get(node).push({ cost, candidate, arc: turning ? (ab ? this.out.ba[edge] : this.out.ab[edge]) : -1 });
    }
    let bestNode = -1;
    let bestArc = -1;
    let bestTarget = -1;
    const least = towards ? this.leastTo(towards, to) : null;
    const visit = (u, g, k) => {
      // (heading for B, nodes come in the order of what a route through them costs at the least)
      const through = least ? g + least(u) : g;
      if (through >= best || through > maxLength * 2) return true;
      for (const end of finish.get(u) ?? []) {
        if (g + end.cost < best && (!turning || this.turns(this.out, k, end.arc))) {
          best = g + end.cost;
          bestNode = u;
          bestArc = k;
          bestTarget = end.candidate;
        }
      }
      return false;
    };
    if (turning) this.searchArcs(this.out, this.seeds(from, false), least, maxLength * 2, visit, own);
    else this.search(this.out, this.seeds(from, false), least, maxLength * 2, visit, own);

    if (bestNode >= 0) {
      const { nodes, candidate } = turning ? this.traceArcs(this.out, bestArc) : this.trace(bestNode);
      bestPath = [from[candidate].x, from[candidate].y];
      for (const u of nodes) bestPath.push(this.x[u], this.y[u]);
      bestPath.push(to[bestTarget].x, to[bestTarget].y);
      if (this.speed) bestPath = this.timed(bestPath, from[candidate].edge, this.between(nodes), to[bestTarget].edge);
    }
    return bestPath && pathLength(bestPath) <= maxLength ? bestPath : null;
  }

  /**
   * How fast a vehicle goes between the nodes of a path one after the other,
   * as speedOf keeps it: on the cheapest arc from the one to the other (either way), as
   * the search took it; 0 where none is found.
   */
  between(nodes) {
    const { start, to, cost, speed } = this.out;
    const on = (u, v) => {
      let best = -1;
      for (let k = start[u]; k < start[u + 1]; k++) if (to[k] === v && (best < 0 || cost[k] < cost[best])) best = k;
      return best;
    };
    const speeds = [];
    for (let i = 1; i < nodes.length; i++) {
      const k = on(nodes[i - 1], nodes[i]);
      const back = k < 0 ? on(nodes[i], nodes[i - 1]) : -1;
      speeds.push(k >= 0 ? speed[k] : back >= 0 ? speed[back] : 0);
    }
    return speeds;
  }

  /**
   * A path with how fast a vehicle goes on each of its pieces, as the
   * network keeps a speed (speedOf, #264): `path.speeds`, one for each piece from one point to the next; 0
   * where it is not known. A path of a network without speeds has none.
   * @param first the edge the first piece is on, `last` that of the last one
   *   (-1 for none), and between them the pieces between nodes (between)
   */
  timed(path, first, middle = [], last = first) {
    if (!this.speed) return path;
    const of = (e) => (e >= 0 ? this.speed[e] : 0);
    path.speeds = path.length === 4 ? [of(first)] : [of(first), ...middle, of(last)];
    return path;
  }

  /**
   * Route between a stop on the network and one that is not on it – typically
   * far outside the area: follows the network towards the other stop until
   * `inside(x, y)` turns false and bridges the rest with a straight line.
   *
   * The network may end earlier (at the edge of the OSM data), or the other
   * stop may simply be off it. A search that finds the way ahead cut off goes
   * on elsewhere, and would leave the area at some other place and head for
   * the stop from there. So the route leaves the network at the node that is
   * best for it (see AHEAD), out of those on a way that, with the straight
   * line after it, is no longer than maxLength.
   * @param arriving true if the vehicle comes from the far stop
   * @param turning, own as for route
   */
  routeBeyond(candidates, farX, farY, inside, arriving, maxLength, turning = true, own = false) {
    own &&= this.sharedLast;
    if (own) candidates = candidates.filter((c) => !c.shared);
    if (!candidates.length) return null;
    const { x, y } = this;
    const toFar = (u) => Math.hypot(x[u] - farX, y[u] - farY);
    let exit = -1;
    let best = Infinity;
    let budget = 300_000;
    const adj = arriving ? this.in : this.out;
    turning &&= this.turnCos !== null;
    // (where turns are limited, the exit is the arc the node is reached on)
    const visit = (u, g, k) => {
      const distance = toFar(u);
      // (the nodes come in the order of this sum: every later one is too far as well)
      if (g + distance > maxLength) return true;
      if (g + AHEAD * distance < best) {
        best = g + AHEAD * distance;
        exit = turning ? k : u;
        // (out of the area on the best way there is: no need to follow it any further)
        if (!inside(x[u], y[u]) || distance < CLOSE_ENOUGH_M) return true;
      }
      return --budget === 0;
    };
    if (turning) this.searchArcs(adj, this.seeds(candidates, arriving), toFar, Infinity, visit, own);
    else this.search(adj, this.seeds(candidates, arriving), toFar, Infinity, visit, own);
    if (exit < 0) return null;

    const { nodes, candidate } = turning ? this.traceArcs(adj, exit) : this.trace(exit);
    const path = [candidates[candidate].x, candidates[candidate].y];
    for (const u of nodes) path.push(x[u], y[u]);
    path.push(farX, farY);
    // (beyond the network, mostly abroad on a long hop, as fast as on the fastest part of the route)
    if (this.speed) {
      const speeds = [this.speed[candidates[candidate].edge], ...this.between(nodes)];
      path.speeds = [...speeds, Math.max(...speeds)];
    }
    if (!arriving) return path;
    // Searched backwards from the stop, so the points are in reverse travel order.
    const reversed = [];
    for (let i = path.length - 2; i >= 0; i -= 2) reversed.push(path[i], path[i + 1]);
    if (path.speeds) reversed.speeds = path.speeds.reverse();
    return reversed;
  }
}

export function pathLength(path) {
  let length = 0;
  for (let i = 2; i < path.length; i += 2) length += Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]);
  return length;
}

/**
 * Douglas-Peucker: drops points that deviate less than `tolerance` metres.
 * Of a path with speeds (Network.timed) it keeps every point where the speed
 * changes, and the speeds of the pieces between those it keeps, so that a
 * vehicle still changes its speed where it did (#264).
 */
export function simplify(path, tolerance) {
  const n = path.length / 2;
  if (n <= 2) return path;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const { speeds } = path;
  if (speeds) for (let i = 1; i < n - 1; i++) if (speeds[i] !== speeds[i - 1]) keep[i] = 1;
  const stack = [0, n - 1];
  while (stack.length) {
    const last = stack.pop();
    const first = stack.pop();
    const ax = path[2 * first];
    const ay = path[2 * first + 1];
    const dx = path[2 * last] - ax;
    const dy = path[2 * last + 1] - ay;
    const lengthSq = dx * dx + dy * dy;
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const px = path[2 * i] - ax;
      const py = path[2 * i + 1] - ay;
      const t = lengthSq ? Math.min(1, Math.max(0, (px * dx + py * dy) / lengthSq)) : 0;
      const distance = Math.hypot(px - dx * t, py - dy * t);
      if (distance > worstDistance) {
        worst = i;
        worstDistance = distance;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push(first, worst, worst, last);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(path[2 * i], path[2 * i + 1]);
  // (between two points that are kept the speed does not change: that of the piece from the first)
  if (speeds) out.speeds = speeds.filter((_, i) => keep[i] && i < n - 1);
  return out;
}
