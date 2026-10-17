// Builds server/areas/germany.geojson: the border of Germany, fetched from
// OpenStreetMap via Nominatim, which the map draws as the edge of the
// built-in area NETNOU_AREA=Germany and greys out beyond. Run by hand when
// the border should be fetched anew:
//
//   node tools/build-germany-outline.mjs
//
// Germany is no area in the sense of what is imported: every trip of the
// feed is kept, inside the border or not. So the file holds an outline only,
// as rings of [lon, lat], and no polygons for the server to decide by. The
// border is the country's as OpenStreetMap has it (relation 51477): out at
// sea it is the edge of the territorial waters, and the German exclaves on
// the far side of the Vennbahn and Büsingen are rings of their own, Jungholz
// a hole.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { simplify } from '../server/lib/network.js';

const RELATION = 51477;
// Accuracy in degrees (~220 m): a border seen from all of Germany down to a
// town. As many points as the outline of the VGN, which the default instance
// sends as well.
const TOLERANCE = 0.002;

function ringArea(ring) {
  // km², equirectangular – good enough for a plausibility check
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return (Math.abs(sum) / 2) * 111.32 * 111.32 * Math.cos((51 * Math.PI) / 180);
}
const round4 = (v) => Math.round(v * 1e4) / 1e4;

const url = new URL('https://nominatim.openstreetmap.org/lookup');
url.search = new URLSearchParams({ osm_ids: `R${RELATION}`, format: 'jsonv2', polygon_geojson: 1 });
const res = await fetch(url, { headers: { 'User-Agent': 'netnou area builder (+https://github.com/xiidoz/netnou)' } });
if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
const [found] = await res.json();
if (found?.osm_id !== RELATION || !/^(Multi)?Polygon$/.test(found.geojson?.type)) throw new Error(`relation ${RELATION} not found as a polygon`);
const polygons = found.geojson.type === 'Polygon' ? [found.geojson.coordinates] : found.geojson.coordinates;
console.log(`${found.name}: ${polygons.length} polygons, ${polygons.reduce((a, p) => a + p.reduce((b, r) => b + r.length, 0), 0)} points`);

// Every ring, outer or a hole: the map greys out by the even-odd rule.
const outline = polygons.flat()
  .map((ring) => {
    const flat = simplify(ring.flat(), TOLERANCE);
    const points = [];
    for (let i = 0; i < flat.length; i += 2) points.push([round4(flat[i]), round4(flat[i + 1])]);
    return points;
  })
  // (an exclave of a few houses is less than a square kilometre, and less than a pixel where the border shows)
  .filter((ring) => ring.length >= 4 && ringArea(ring) >= 1)
  .sort((a, b) => ringArea(b) - ringArea(a));
console.log(`outline: ${outline.map((ring) => `${Math.round(ringArea(ring))} km² (${ring.length} points)`).join(', ')}`);

// The border is OpenStreetMap data and stays under its licence, whatever the
// licence of the code around it.
const source = '© OpenStreetMap contributors, ODbL 1.0 (https://opendatacommons.org/licenses/odbl/1-0/), via Nominatim';
const out = new URL('../server/areas/germany.geojson', import.meta.url);
fs.writeFileSync(out, `${JSON.stringify({ type: 'FeatureCollection', name: 'Deutschland', source, osm_relation: RELATION, outline, features: [] })}\n`);
console.log(`written ${fileURLToPath(out)} (${Math.round(fs.statSync(out).size / 1024)} kB)`);
