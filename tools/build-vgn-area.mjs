// Builds server/areas/vgn.geojson: the outlines of the cities and districts
// that make up the VGN (Verkehrsverbund Großraum Nürnberg), fetched from
// OpenStreetMap via Nominatim. Run by hand when the network area changes:
//
//   node tools/build-vgn-area.mjs
//
// Member list: https://de.wikipedia.org/wiki/Verkehrsverbund_Großraum_Nürnberg
// (as of 2024). The districts of Eichstätt, Kelheim and Regensburg are only
// partly in the network and are left out; lines running into them are still
// shown because they also serve stops inside the area.
//
// The file holds two things:
//   features  one polygon per member – what the server uses to decide what is
//             inside the area
//   outline   the outer boundary of all members together, as rings of
//             [lon, lat] – what the map draws to set the area off

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simplify } from '../server/lib/network.js';

const CITIES = ['Amberg', 'Ansbach', 'Bamberg', 'Bayreuth', 'Coburg', 'Erlangen', 'Fürth', 'Hof', 'Nürnberg', 'Schwabach', 'Weiden in der Oberpfalz'];
const DISTRICTS = [
  'Amberg-Sulzbach', 'Ansbach', 'Bamberg', 'Bayreuth', 'Coburg', 'Erlangen-Höchstadt', 'Donau-Ries', 'Forchheim', 'Fürth',
  'Haßberge', 'Hof', 'Kitzingen', 'Kronach', 'Kulmbach', 'Lichtenfels', 'Neumarkt in der Oberpfalz',
  'Neustadt an der Aisch-Bad Windsheim', 'Neustadt an der Waldnaab', 'Nürnberger Land', 'Roth', 'Tirschenreuth',
  'Weißenburg-Gunzenhausen', 'Wunsiedel im Fichtelgebirge',
];
// Accuracy in degrees (~100 m): the area is only used at ~1 km resolution, and
// the outline is drawn as a soft edge.
const TOLERANCE = 0.001;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function nominatim(endpoint, params) {
  const url = new URL(`https://nominatim.openstreetmap.org/${endpoint}`);
  url.search = new URLSearchParams({ format: 'jsonv2', polygon_geojson: 1, ...params });
  const res = await fetch(url, { headers: { 'User-Agent': 'netnou area builder (+https://github.com/xiidoz/netnou)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await sleep(1100); // Nominatim usage policy: at most one request per second
  return res.json();
}

// place_rank 12 = admin_level 6: districts and cities that are their own district.
// (Without it "Amberg" also matches a village of that name in Swabia.)
const isBoundary = (r) => r.category === 'boundary' && r.type === 'administrative' && r.osm_type === 'relation' && r.place_rank === 12 && /Polygon$/.test(r.geojson?.type);

function ringArea(ring) {
  // km², equirectangular – good enough for a plausibility check
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return (Math.abs(sum) / 2) * 111.32 * 111.32 * Math.cos((49.7 * Math.PI) / 180);
}
const polygonsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);
const area = (geometry) => polygonsOf(geometry).reduce((a, poly) => a + ringArea(poly[0]) - poly.slice(1).reduce((h, ring) => h + ringArea(ring), 0), 0);
const round4 = (v) => Math.round(v * 1e4) / 1e4;
const round = (geometry) => ({ type: geometry.type, coordinates: JSON.parse(JSON.stringify(geometry.coordinates, (_, v) => (typeof v === 'number' ? round4(v) : v))) });

/**
 * Outer boundary of adjacent polygons. Neighbouring districts are mapped with
 * the very same border points in OpenStreetMap, so every edge that belongs to
 * two of them is an inner border and is dropped; the rest is joined to rings.
 */
function unionOutline(geometries) {
  const seen = new Map(); // undirected edge -> how often
  const edge = (p, q) => (p < q ? `${p}|${q}` : `${q}|${p}`);
  for (const geometry of geometries) {
    for (const polygon of polygonsOf(geometry)) {
      for (const ring of polygon) {
        for (let i = 1; i < ring.length; i++) {
          const p = ring[i - 1].join(',');
          const q = ring[i].join(',');
          if (p !== q) seen.set(edge(p, q), (seen.get(edge(p, q)) ?? 0) + 1);
        }
      }
    }
  }
  const next = new Map(); // point -> neighbouring points along the outer boundary
  for (const [key, times] of seen) {
    if (times % 2 === 0) continue;
    const [p, q] = key.split('|');
    for (const [a, b] of [[p, q], [q, p]]) {
      if (!next.has(a)) next.set(a, []);
      next.get(a).push(b);
    }
  }

  const used = new Set();
  const rings = [];
  for (const [start, neighbours] of next) {
    for (const first of neighbours) {
      if (used.has(edge(start, first))) continue;
      used.add(edge(start, first));
      const ring = [start];
      let current = first;
      while (current !== start) {
        ring.push(current);
        const onward = next.get(current).find((n) => !used.has(edge(current, n)));
        if (onward === undefined) throw new Error(`outline: the boundary does not close at ${current}`);
        used.add(edge(current, onward));
        current = onward;
      }
      ring.push(start);
      rings.push(ring.map((p) => p.split(',').map(Number)));
    }
  }
  return rings;
}

const features = [];
const relations = [];
for (const [kind, names] of [['city', CITIES], ['district', DISTRICTS]]) {
  for (const name of names) {
    const query = `${kind === 'district' ? `Landkreis ${name}` : name}, Bayern`;
    const results = (await nominatim('search', { q: query, polygon_threshold: TOLERANCE, countrycodes: 'de', limit: 10 })).filter(isBoundary);
    const match = kind === 'district'
      ? results.find((r) => r.name === `Landkreis ${name}`)
      : results.find((r) => r.name === name);
    if (!match) throw new Error(`no boundary found for ${kind} ${name}: ${results.map((r) => `${r.name} (${r.addresstype})`).join(', ')}`);
    const geometry = round(match.geojson);
    console.log(`${kind.padEnd(8)} ${name.padEnd(38)} relation ${String(match.osm_id).padEnd(9)} ${Math.round(area(geometry))} km²`);
    features.push({ type: 'Feature', properties: { name: kind === 'district' ? `Landkreis ${name}` : name, osm_relation: match.osm_id }, geometry });
    relations.push(match.osm_id);
  }
}
const total = features.reduce((a, f) => a + area(f.geometry), 0);
console.log(`total ${Math.round(total)} km² in ${features.length} parts`);

// The outline needs the borders point for point, i.e. without simplification.
const exact = [];
for (let i = 0; i < relations.length; i += 5) {
  const chunk = relations.slice(i, i + 5);
  const results = await nominatim('lookup', { osm_ids: chunk.map((id) => `R${id}`).join(',') });
  if (results.length !== chunk.length) throw new Error(`lookup returned ${results.length} of ${chunk.length} relations`);
  exact.push(...results.map((r) => r.geojson));
}
const outline = unionOutline(exact)
  .map((ring) => {
    const flat = simplify(ring.flat(), TOLERANCE);
    const points = [];
    for (let i = 0; i < flat.length; i += 2) points.push([round4(flat[i]), round4(flat[i + 1])]);
    return points;
  })
  // Slivers where two borders do not match point for point are not part of the outline.
  .filter((ring) => ring.length >= 4 && ringArea(ring) >= 1)
  .sort((a, b) => ringArea(b) - ringArea(a));
console.log(`outline: ${outline.map((ring) => `${Math.round(ringArea(ring))} km² (${ring.length} points)`).join(', ')}`);

// The boundaries are OpenStreetMap data and stay under its licence, whatever
// the licence of the code around them.
const source = '© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/), via Nominatim';
const out = new URL('../server/areas/vgn.geojson', import.meta.url);
fs.mkdirSync(new URL('.', out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ type: 'FeatureCollection', name: 'VGN', source, outline, features })}\n`);
console.log(`written ${fileURLToPath(out)} (${Math.round(fs.statSync(out).size / 1024)} kB)`);
