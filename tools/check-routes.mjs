// Checks the route geometry of an imported timetable, for judging a change to
// routing and catching what it breaks. For each network it counts the hops,
// those without a route (a straight line on the map; apart those with a stop
// outside the area), the routes that turn back somewhere between their stops,
// and those far longer than the straight line, and lists the worst of each.
// Given a second dataset, imported from the same feed and OpenStreetMap data
// (that of main and that of a branch), it puts the counts side by side and
// lists the hops that turn back, lose their route or gain one in the second.
//
//   node tools/check-routes.mjs [dataset.bin] [other dataset.bin] [--list <n>] [--net <rail,tram,…>]
//
// A dataset is the dataset.bin of the data directory of a server that has
// routed its hops (NETNOU_OSM_PBF_URLS); without one, that of the server's
// own data directory, which is of the default area unless the settings say
// otherwise.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDataset } from '../server/lib/dataset.js';
import { NETS } from '../server/lib/network.js';
import { NET_OF_MODE, routeMode } from '../server/lib/timetable.js';

// A route turns back where it changes direction by more than this, between two
// of its points (#243): a train going into a switch on one branch and out on the other.
const TURN_BACK = 150;
// A route this many times as long as the straight line between its stops is
// roundabout, if that line is longer than ROUNDABOUT_FROM metres.
const ROUNDABOUT = 2;
const ROUNDABOUT_FROM = 500;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? fallback : args.splice(i, 2)[1];
};
const list = Number(option('list', 10));
const nets = option('net', NETS.join(',')).split(',');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = args.length ? args : [path.join(process.env.NETNOU_DATA_DIR || path.join(root, 'data'), 'dataset.bin')];

/** Metres between two places in degrees, on a plane that is right where they are. */
const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lon2 - lon1) * 111_320 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180), (lat2 - lat1) * 111_320);

/** The hops of a dataset by network and the ids of their stops, with what is known of each. */
function check(file) {
  const data = readDataset(file);
  const { stops, trips, routes, patterns, segments } = data;
  if (!segments) throw new Error(`${file}: no route geometry; the server that imported it had no OpenStreetMap data`);
  const stopCount = stops.id.length;
  const netOfRoute = routes.type.map((type, r) => NETS.indexOf(NET_OF_MODE[routeMode(type, routes.short[r])]));
  // (as buildSegments finds them: those of every stop sequence, on the network of every route that runs it)
  const hops = new Map();
  for (let t = 0; t < trips.pattern.length; t++) {
    const n = netOfRoute[trips.route[t]];
    if (n < 0) continue;
    const p = trips.pattern[t];
    for (let k = patterns.start[p] + 1; k < patterns.start[p + 1]; k++) {
      const [from, to] = [patterns.stops[k - 1], patterns.stops[k]];
      const name = `${NETS[n]} ${stops.id.get(from)} ${stops.id.get(to)}`;
      if (from !== to && !hops.has(name)) hops.set(name, { n, from, to, line: routes.short[trips.route[t]] });
    }
  }
  const byKey = new Map();
  for (let i = 0; i < segments.key.length; i++) byKey.set(segments.key[i], i);
  const result = new Map();
  for (const [name, { n, from, to, line }] of hops) {
    const hop = { net: NETS[n], line, from: stops.name[from], to: stops.name[to], straight: metres(stops.lat[from], stops.lon[from], stops.lat[to], stops.lon[to]), outside: !stops.region[from] || !stops.region[to] };
    const s = byKey.get((n * stopCount + from) * stopCount + to);
    if (s !== undefined) {
      // (the points: the first as it is, each other one as its step from the one before, in 1e-5 degrees)
      const lat = [segments.origin[2 * s] / 1e5];
      const lon = [segments.origin[2 * s + 1] / 1e5];
      for (let k = segments.start[s] + 1; k < segments.start[s + 1]; k++) {
        lat.push(lat.at(-1) + segments.step[2 * k] / 1e5);
        lon.push(lon.at(-1) + segments.step[2 * k + 1] / 1e5);
      }
      hop.length = 0;
      hop.turns = 0;
      for (let i = 1; i < lat.length; i++) hop.length += metres(lat[i - 1], lon[i - 1], lat[i], lon[i]);
      for (let i = 1; i + 1 < lat.length; i++) {
        const east = Math.cos((lat[i] * Math.PI) / 180);
        const [x1, y1, x2, y2] = [(lon[i] - lon[i - 1]) * east, lat[i] - lat[i - 1], (lon[i + 1] - lon[i]) * east, lat[i + 1] - lat[i]];
        const l = Math.hypot(x1, y1) * Math.hypot(x2, y2);
        if (l > 0 && (x1 * x2 + y1 * y2) / l < Math.cos((TURN_BACK * Math.PI) / 180)) hop.turns++;
      }
    }
    result.set(name, hop);
  }
  return result;
}

const km = (m) => `${(m / 1000).toFixed(1)} km`;
const named = (hop) => `${hop.line}: ${hop.from} → ${hop.to}`;
const counts = (hops, net) => {
  const of = [...hops.values()].filter((hop) => hop.net === net);
  const routed = of.filter((hop) => hop.length !== undefined);
  return {
    hops: of.length,
    routed: routed.length,
    straight: of.length - routed.length,
    'straight, a stop outside': of.filter((hop) => hop.length === undefined && hop.outside).length,
    'turning back': routed.filter((hop) => hop.turns).length,
    roundabout: routed.filter((hop) => hop.straight > ROUNDABOUT_FROM && hop.length > ROUNDABOUT * hop.straight).length,
  };
};

const runs = files.map((file) => ({ file, hops: check(file) }));
for (const net of nets) {
  const all = runs.map(({ hops }) => counts(hops, net));
  if (!all.some((c) => c.hops)) continue;
  console.log(`\n${net}${runs.length > 1 ? `${''.padEnd(26 - net.length + 2)}${runs.map((_, i) => String.fromCharCode(65 + i).padStart(10)).join('')}` : ''}`);
  for (const key of Object.keys(all[0])) console.log(`  ${key.padEnd(26)}${all.map((c) => String(c[key]).padStart(10)).join('')}`);
  const last = runs.at(-1).hops;
  const of = [...last.values()].filter((hop) => hop.net === net);
  const show = (title, hops, line) => {
    if (!hops.length) return;
    console.log(`  ${title}:`);
    for (const hop of hops.slice(0, list)) console.log(`    ${line(hop)}`);
    if (hops.length > list) console.log(`    … and ${hops.length - list} more`);
  };
  if (runs.length === 1) {
    show('turning back, the most often first', of.filter((hop) => hop.turns).sort((p, q) => q.turns - p.turns || q.length - p.length), (hop) => `${named(hop)}, ${hop.turns} times, ${km(hop.length)} for ${km(hop.straight)}`);
    show('straight, both stops inside, the longest first', of.filter((hop) => hop.length === undefined && !hop.outside).sort((p, q) => q.straight - p.straight), (hop) => `${named(hop)}, ${km(hop.straight)}`);
    show('roundabout, the most first', of.filter((hop) => hop.straight > ROUNDABOUT_FROM && hop.length > ROUNDABOUT * hop.straight).sort((p, q) => q.length / q.straight - p.length / p.straight), (hop) => `${named(hop)}, ${km(hop.length)} for ${km(hop.straight)}`);
    continue;
  }
  // (what the second dataset does worse or better than the first)
  const first = runs[0].hops;
  // (a hop is named the same in both: by its network and the ids of its stops)
  const pairs = [...last].filter(([, hop]) => hop.net === net).map(([name, hop]) => [first.get(name), hop]);
  show('turning back now', pairs.filter(([was, is]) => is.turns && !was?.turns).map(([, is]) => is), (hop) => `${named(hop)}, ${km(hop.length)}`);
  show('without a route now', pairs.filter(([was, is]) => was?.length !== undefined && is.length === undefined).map(([, is]) => is), (hop) => `${named(hop)}, ${km(hop.straight)}`);
  show('with a route now', pairs.filter(([was, is]) => was && was.length === undefined && is.length !== undefined).map(([, is]) => is), (hop) => `${named(hop)}, ${km(hop.length)}`);
  show('no longer turning back', pairs.filter(([was, is]) => was?.turns && !is.turns).map(([, is]) => is), (hop) => `${named(hop)}, ${km(hop.length)}`);
}
console.log(`\n${runs.map(({ file }, i) => `${String.fromCharCode(65 + i)}: ${file}`).join('\n')}`);
