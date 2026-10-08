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

/** Collects classified ways into the compact per-network form that Network reads. */
export class NetworkBuilder {
  constructor() {
    this.seenWays = new Set();
    this.nets = Object.fromEntries(NETS.map((net) => [net, { index: new Map(), lat: [], lon: [], a: [], b: [], f: [], d: [] }]));
  }

  /** `way` as delivered by readPbfWays; the same way may arrive from two extracts. */
  addWay(way) {
    const cls = classifyWay(way.tags);
    if (!cls) return;
    const key = `${way.id}:${way.nodes[0]}`;
    if (this.seenWays.has(key)) return;
    this.seenWays.add(key);

    const g = this.nets[cls.net];
    let prev = -1;
    for (let i = 0; i < way.nodes.length; i++) {
      let node = g.index.get(way.nodes[i]);
      if (node === undefined) {
        node = g.lat.length;
        g.index.set(way.nodes[i], node);
        g.lat.push(Math.round(way.lat[i] * 1e7));
        g.lon.push(Math.round(way.lon[i] * 1e7));
      }
      if (prev >= 0 && prev !== node) {
        g.a.push(prev);
        g.b.push(node);
        g.f.push(Math.round(cls.factor * 100));
        g.d.push(cls.dir);
      }
      prev = node;
    }
  }

  /** Plain arrays only, ready for JSON: lat/lon in 1e-7 degrees, factor in percent. */
  result() {
    return Object.fromEntries(NETS.map((net) => {
      const { lat, lon, a, b, f, d } = this.nets[net];
      return [net, { lat, lon, a, b, f, d }];
    }));
  }
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

    const n = graph.lat.length;
    const m = graph.a.length;
    this.nodeCount = n;
    this.x = Float64Array.from(graph.lon, (v) => (v / 1e7) * this.kx);
    this.y = Float64Array.from(graph.lat, (v) => (v / 1e7) * this.ky);
    this.a = Int32Array.from(graph.a);
    this.b = Int32Array.from(graph.b);
    this.dir = Uint8Array.from(graph.d);
    this.len = new Float64Array(m);
    this.cost = new Float64Array(m);
    for (let e = 0; e < m; e++) {
      this.len[e] = Math.hypot(this.x[this.a[e]] - this.x[this.b[e]], this.y[this.a[e]] - this.y[this.b[e]]);
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
    const found = [];
    const seen = new Set();
    for (let cx = Math.floor((px - r) / CELL_M); cx <= Math.floor((px + r) / CELL_M); cx++) {
      for (let cy = Math.floor((py - r) / CELL_M); cy <= Math.floor((py + r) / CELL_M); cy++) {
        for (const e of this.grid.get(cx * 1e6 + cy) ?? []) {
          if (seen.has(e)) continue;
          seen.add(e);
          const ax = this.x[this.a[e]];
          const ay = this.y[this.a[e]];
          const dx = this.x[this.b[e]] - ax;
          const dy = this.y[this.b[e]] - ay;
          const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
          const x = ax + dx * t;
          const y = ay + dy * t;
          const distance = Math.hypot(px - x, py - y);
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
