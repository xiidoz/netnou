// Routable networks built from OpenStreetMap ways – one for buses (roads) and
// one each for trams, the U-Bahn and heavy rail – and the shortest-path search
// that turns "stop A, then stop B" into the geometry in between.

export const NETS = ['road', 'rail', 'subway', 'tram'];

const M_PER_DEG = 111_320;

// Cost per metre relative to a main road. Buses prefer main roads; the factors
// must stay >= 1 so that straight-line distance remains a valid A* heuristic.
const ROAD_FACTOR = {
  motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1,
  unclassified: 1.15, residential: 1.3, living_street: 2, service: 1.6,
  busway: 1, bus_guideway: 1, pedestrian: 2.5,
};
const NO_ACCESS = ['no', 'private', 'agricultural', 'forestry', 'emergency', 'military'];
const NOT_A_ROAD = ['parking_aisle', 'driveway', 'drive-through', 'emergency_access'];
const isYes = (value) => value === 'yes' || value === 'designated';

const FORWARD = 1;
const BACKWARD = 2;
const BOTH = 3;

function onewayDirection(tags, implied) {
  const oneway = tags.oneway;
  if (oneway === 'yes' || oneway === 'true' || oneway === '1') return FORWARD;
  if (oneway === '-1' || oneway === 'reverse') return BACKWARD;
  return oneway === undefined && implied ? FORWARD : BOTH;
}

/**
 * Decides which network an OSM way belongs to.
 * @returns {{net: string, factor: number, dir: number} | null}
 */
export function classifyWay(tags) {
  if (tags.area === 'yes') return null;

  const railway = tags.railway;
  if (railway === 'rail' || railway === 'light_rail' || railway === 'subway' || railway === 'tram') {
    // Sidings and yards are legal but unlikely routes for passenger trains.
    const factor = { yard: 3, spur: 3, siding: 1.5, crossover: 1.2 }[tags.service] ?? 1;
    if (railway === 'subway' || railway === 'tram') return { net: railway, factor, dir: onewayDirection(tags, false) };
    // Mainline tracks are signalled for a usual direction but can be used both ways.
    return { net: 'rail', factor, dir: BOTH };
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
  return { net: 'road', factor, dir };
}

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
 * used in (d). A way that two extracts have counts once, for the first. A
 * way is cut where a node was not kept, and nodes are numbered as they first
 * come up, in the order of the ways.
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
    // (as long as it can be at most: as many nodes and edges as the ways of the network have nodes)
    let most = 0;
    readings.forEach(({ kinds, ways }, r) => {
      for (let w = 0; w < ways.id.length; w++) if (kinds[ways.kind[w]].net === net && (!counts[r] || counts[r][w])) most += ways.start[w + 1] - ways.start[w];
    });
    const lat = new Int32Array(most);
    const lon = new Int32Array(most);
    const [a, b, f, d] = [new Int32Array(most), new Int32Array(most), new Uint16Array(most), new Uint8Array(most)];
    let [nodeCount, edgeCount] = [0, 0];
    numberOf.fill(-1);
    const run = [];
    /** A run of nodes that were kept, as places: its edges, and its nodes as they first come up. */
    const flush = (factor, dir) => {
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
            edgeCount++;
          }
          previous = node;
        }
      }
      run.length = 0;
    };
    readings.forEach(({ kinds, ways, nodes }, r) => {
      const ofNet = kinds.map((kind) => kind.net === net);
      for (let w = 0; w < ways.id.length; w++) {
        if (!ofNet[ways.kind[w]] || (counts[r] && !counts[r][w])) continue;
        const { factor, dir } = kinds[ways.kind[w]];
        for (let k = ways.start[w]; k < ways.start[w + 1]; k++) {
          const place = nodes[k] < 0 || !numbers[r] ? nodes[k] : numbers[r][nodes[k]];
          if (place >= 0) run.push(place);
          else flush(factor, dir);
        }
        flush(factor, dir);
      }
    });
    // (the part that was filled, without a copy)
    return [net, { lat: lat.subarray(0, nodeCount), lon: lon.subarray(0, nodeCount), a: a.subarray(0, edgeCount), b: b.subarray(0, edgeCount), f: f.subarray(0, edgeCount), d: d.subarray(0, edgeCount) }];
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
  }
  for (let i = 0; i < global.length; i++) scratch[global[i]] = -1;
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
   */
  constructor(graph, { originLat, snapRadius, snapPenalty, maxCandidates = 6 }) {
    this.snapRadius = snapRadius;
    this.snapPenalty = snapPenalty;
    this.maxCandidates = maxCandidates;
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
    this.out = this.adjacency(FORWARD, BACKWARD);
    this.in = this.adjacency(BACKWARD, FORWARD);

    // Spatial grid of edges for snapping stops.
    this.grid = new Map();
    for (let e = 0; e < m; e++) {
      const x0 = Math.floor(Math.min(this.x[this.a[e]], this.x[this.b[e]]) / CELL_M);
      const x1 = Math.floor(Math.max(this.x[this.a[e]], this.x[this.b[e]]) / CELL_M);
      const y0 = Math.floor(Math.min(this.y[this.a[e]], this.y[this.b[e]]) / CELL_M);
      const y1 = Math.floor(Math.max(this.y[this.a[e]], this.y[this.b[e]]) / CELL_M);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const key = cx * 1e6 + cy;
          const cell = this.grid.get(key);
          if (cell) cell.push(e);
          else this.grid.set(key, [e]);
        }
      }
    }

    this.dist = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.query = 0;
    this.heap = new MinHeap();
  }

  // Compressed adjacency lists: arcs leaving a→b edges at `a` if the edge
  // allows `viaA`, and at `b` if it allows `viaB`.
  adjacency(viaA, viaB) {
    const { a, b, dir, cost, nodeCount } = this;
    const start = new Int32Array(nodeCount + 1);
    for (let e = 0; e < a.length; e++) {
      if (dir[e] & viaA) start[a[e] + 1]++;
      if (dir[e] & viaB) start[b[e] + 1]++;
    }
    for (let i = 0; i < nodeCount; i++) start[i + 1] += start[i];
    const fill = start.slice(0, nodeCount);
    const to = new Int32Array(start[nodeCount]);
    const arcCost = new Float64Array(start[nodeCount]);
    for (let e = 0; e < a.length; e++) {
      if (dir[e] & viaA) { to[fill[a[e]]] = b[e]; arcCost[fill[a[e]]++] = cost[e]; }
      if (dir[e] & viaB) { to[fill[b[e]]] = a[e]; arcCost[fill[b[e]]++] = cost[e]; }
    }
    return { start, to, cost: arcCost };
  }

  toXY(lat, lon) {
    return [lon * this.kx, lat * this.ky];
  }

  toLatLon(x, y) {
    return [y / this.ky, x / this.kx];
  }

  /** Points on nearby edges a stop at (lat, lon) may be on, nearest first. */
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
          if (distance <= r) found.push({ edge: e, t, x, y, penalty: distance * this.snapPenalty });
        }
      }
    }
    return found.sort((p, q) => p.penalty - q.penalty).slice(0, this.maxCandidates);
  }

  // Seeds for a search leaving (forwards) or reaching (backwards) a candidate:
  // the edge end the vehicle gets to first and what that costs.
  seeds(candidates, backwards) {
    const seeds = [];
    candidates.forEach((c, i) => {
      const { edge: e, t } = c;
      const toB = backwards ? BACKWARD : FORWARD;
      const toA = backwards ? FORWARD : BACKWARD;
      if (this.dir[e] & toB) seeds.push({ node: this.b[e], cost: c.penalty + (1 - t) * this.cost[e], candidate: i });
      if (this.dir[e] & toA) seeds.push({ node: this.a[e], cost: c.penalty + t * this.cost[e], candidate: i });
    });
    return seeds;
  }

  /**
   * Dijkstra / A* from the seeds. `visit(node, g)` is called for every settled
   * node and ends the search by returning true. Afterwards `trace` follows the
   * found path back to its seed.
   */
  search(adj, seeds, heuristic, maxCost, visit) {
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
   * Cheapest way from one of the candidates of stop A to one of stop B.
   * @returns flat [x0, y0, x1, y1, …] in metres, or null if there is no route
   *   shorter than maxLength.
   */
  route(from, to, maxLength) {
    let best = Infinity;
    let bestPath = null;

    // Both stops on the same edge: no search needed.
    for (const ca of from) {
      for (const cb of to) {
        if (ca.edge !== cb.edge || !(this.dir[ca.edge] & (cb.t >= ca.t ? FORWARD : BACKWARD))) continue;
        const total = ca.penalty + cb.penalty + Math.abs(cb.t - ca.t) * this.cost[ca.edge];
        if (total < best) {
          best = total;
          bestPath = [ca.x, ca.y, cb.x, cb.y];
        }
      }
    }

    // node -> ways to finish at a candidate of B from there
    const finish = new Map();
    for (const { node, cost, candidate } of this.seeds(to, true)) {
      if (!finish.has(node)) finish.set(node, []);
      finish.get(node).push({ cost, candidate });
    }
    let bestNode = -1;
    let bestTarget = -1;
    this.search(this.out, this.seeds(from, false), null, maxLength * 2, (u, g) => {
      if (g >= best) return true;
      for (const end of finish.get(u) ?? []) {
        if (g + end.cost < best) {
          best = g + end.cost;
          bestNode = u;
          bestTarget = end.candidate;
        }
      }
      return false;
    });

    if (bestNode >= 0) {
      const { nodes, candidate } = this.trace(bestNode);
      bestPath = [from[candidate].x, from[candidate].y];
      for (const u of nodes) bestPath.push(this.x[u], this.y[u]);
      bestPath.push(to[bestTarget].x, to[bestTarget].y);
    }
    return bestPath && pathLength(bestPath) <= maxLength ? bestPath : null;
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
   */
  routeBeyond(candidates, farX, farY, inside, arriving, maxLength) {
    const { x, y } = this;
    const toFar = (u) => Math.hypot(x[u] - farX, y[u] - farY);
    let exit = -1;
    let best = Infinity;
    let budget = 300_000;
    this.search(arriving ? this.in : this.out, this.seeds(candidates, arriving), toFar, Infinity, (u, g) => {
      const distance = toFar(u);
      // (the nodes come in the order of this sum: every later one is too far as well)
      if (g + distance > maxLength) return true;
      if (g + AHEAD * distance < best) {
        best = g + AHEAD * distance;
        exit = u;
        // (out of the area on the best way there is: no need to follow it any further)
        if (!inside(x[u], y[u]) || distance < CLOSE_ENOUGH_M) return true;
      }
      return --budget === 0;
    });
    if (exit < 0) return null;

    const { nodes, candidate } = this.trace(exit);
    const path = [candidates[candidate].x, candidates[candidate].y];
    for (const u of nodes) path.push(x[u], y[u]);
    path.push(farX, farY);
    if (!arriving) return path;
    // Searched backwards from the stop, so the points are in reverse travel order.
    const reversed = [];
    for (let i = path.length - 2; i >= 0; i -= 2) reversed.push(path[i], path[i + 1]);
    return reversed;
  }
}

export function pathLength(path) {
  let length = 0;
  for (let i = 2; i < path.length; i += 2) length += Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]);
  return length;
}

/** Douglas-Peucker: drops points that deviate less than `tolerance` metres. */
export function simplify(path, tolerance) {
  const n = path.length / 2;
  if (n <= 2) return path;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
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
  return out;
}
