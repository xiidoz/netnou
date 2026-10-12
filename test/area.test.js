import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { Area, NEAR, agencyKey, scopeId } from '../server/lib/area.js';

test('a rectangular area knows what is inside and how far outside things are', () => {
  const area = Area.fromBbox([49.3, 10.8, 49.7, 11.3]);
  assert.deepEqual(area.bbox, [49.3, 10.8, 49.7, 11.3]);
  assert.equal(area.distance(49.5, 11.0), 0);
  assert.equal(area.distance(49.305, 10.81), 0);
  // cells are ~1.1 km: 0.01° of latitude, 0.015° of longitude
  assert.equal(area.distance(49.705, 11.0), 1);
  assert.equal(area.distance(49.5, 11.3 + 0.02), 2);
  assert.equal(area.distance(49.745, 11.0), 5);
  assert.equal(area.distance(49.3 - 0.045, 10.8 - 0.065), 5); // diagonal steps count once
  assert.equal(area.distance(49.9, 11.0), 255);
  assert.equal(area.distance(52.5, 13.4), 255);
  assert.ok(NEAR.region < NEAR.exit && NEAR.exit < NEAR.osm);
});

test('polygons from GeoJSON: several parts, holes, and a stable id', () => {
  const square = (s, w, n, e) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  const geojson = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [square(49, 10, 50, 11), square(49.4, 10.4, 49.6, 10.6)] } },
      { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [[square(49, 12, 49.5, 12.5)]] } },
    ],
  };
  const area = Area.fromGeoJson(geojson);
  assert.deepEqual(area.bbox, [49, 10, 50, 12.5]);
  assert.equal(area.distance(49.2, 10.2), 0);
  assert.equal(area.distance(49.5, 10.5), 7); // middle of the hole: 0.1° ≈ 7 cells from its west and east edge
  assert.equal(area.distance(49.405, 10.5), 1); // just inside the hole
  assert.equal(area.distance(49.2, 12.2), 0); // second part
  assert.equal(area.distance(49.2, 11.5), 255); // between the parts
  assert.equal(area.distance(49.8, 12.2), 255); // inside the bounding box, outside every polygon

  assert.equal(Area.fromGeoJson(geojson).id, area.id);
  assert.notEqual(Area.fromBbox([49, 10, 50, 11]).id, area.id);
  // the polygons are all a worker thread gets to rebuild the area
  assert.equal(new Area(structuredClone(area.polygons)).id, area.id);
  assert.throws(() => Area.fromGeoJson({ type: 'FeatureCollection', features: [] }), /no polygons/);
});

test('the bundled VGN outline covers the network and not its neighbours', () => {
  const geojson = JSON.parse(fs.readFileSync(new URL('../server/areas/vgn.geojson', import.meta.url), 'utf8'));
  const vgn = Area.fromGeoJson(geojson);
  // the outer boundary drawn on the map encloses the same region as the member polygons
  const outer = Area.fromGeoJson({ type: 'Polygon', coordinates: geojson.outline });
  for (const corner of [0, 1, 2, 3]) assert.ok(Math.abs(outer.bbox[corner] - vgn.bbox[corner]) < 0.002, `bbox ${corner}`);
  const inner = (cells) => cells.reduce((n, c) => n + (c === 0 ? 1 : 0), 0);
  assert.ok(Math.abs(inner(outer.cells) - inner(vgn.cells)) / inner(vgn.cells) < 0.002, 'same area');
  const inside = { 'Nürnberg Hbf': [49.4456, 11.083], Bamberg: [49.9, 10.9], Hof: [50.31, 11.92], Tirschenreuth: [49.88, 12.33], Nördlingen: [48.85, 10.49], Kitzingen: [49.73, 10.16], Coburg: [50.26, 10.96] };
  const outside = { Schweinfurt: [50.05, 10.23], Regensburg: [49.01, 12.1], Würzburg: [49.79, 9.93], Ingolstadt: [48.76, 11.42], Crailsheim: [49.13, 10.07] };
  for (const [name, [lat, lon]] of Object.entries(inside)) assert.equal(vgn.distance(lat, lon), 0, name);
  for (const [name, [lat, lon]] of Object.entries(outside)) assert.ok(vgn.distance(lat, lon) > NEAR.exit, name);
});

test('the extent of an instance without an area is where its stops are, and the lines between them', () => {
  // two stops next to each other and one 33 km to the east
  const lat = [49.4, 49.41, 49.4];
  const lon = [11.0, 11.0, 11.45];
  const stops = Area.covering(lat, lon);
  assert.deepEqual(stops.bbox, [49.4, 11.0, 49.41, 11.45]);
  assert.deepEqual([stops.polygons, stops.id], [[], null]);
  for (let i = 0; i < 3; i++) assert.equal(stops.distance(lat[i], lon[i]), 0);
  assert.equal(stops.distance(49.4, 11.03), 2);
  assert.equal(stops.distance(49.4, 11.22), 255); // halfway to the third, far from all of them
  // with a trip from the first to the third, what lies between them is inside as well
  const line = Area.covering(lat, lon, (hop) => hop(0, 2));
  assert.equal(line.distance(49.4, 11.22), 0);
  assert.equal(line.distance(49.42, 11.22), 2);
  assert.equal(line.distance(49.4 + 7 * 0.01, 11.22), 7);
  assert.equal(line.distance(49.6, 11.22), 255);

  // kept beside what was made for it, and read again
  const again = Area.fromJSON(JSON.parse(JSON.stringify(line)));
  assert.deepEqual([again.bbox, again.rows, again.cols], [line.bbox, line.rows, line.cols]);
  assert.deepEqual(again.cells, line.cells);
  assert.throws(() => Area.fromJSON({ ...line.toJSON(), bbox: [49, 11, 50, 12] }), /does not fit/);

  // One extent lies within another if nothing of it is far from that: what
  // was read of OpenStreetMap for the one is then good for the other.
  assert.ok(stops.within(line, 0));
  assert.ok(!line.within(stops, NEAR.exit));
  const grown = Area.covering([...lat, 49.43], [...lon, 11.02]); // one stop more, 2 km off
  assert.ok(grown.within(stops, NEAR.exit));
  assert.ok(!grown.within(stops, 1));
  const elsewhere = Area.covering([...lat, 49.8], [...lon, 11.0]);
  assert.ok(!elsewhere.within(stops, NEAR.exit));

  // a single stop is an extent too; none is not
  assert.equal(Area.covering([49.4], [11.0]).distance(49.4, 11.0), 0);
  assert.throws(() => Area.covering([], []), /no stops/);
});

test('what an instance covers has an id of its own unless it is an area and nothing else', () => {
  const area = Area.fromBbox([49.3, 10.8, 49.7, 11.3]);
  assert.equal(scopeId(area, null), area.id);
  const ids = [scopeId(area, null), scopeId(null, null), scopeId(null, ['a']), scopeId(area, ['a']), scopeId(area, ['a', 'b']), scopeId(Area.fromBbox([49, 10, 50, 11]), ['a'])];
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(scopeId(area, ['b', 'a']), scopeId(area, ['a', 'b']));
  assert.equal(agencyKey('  VerkehrsAG Nürnberg '), 'verkehrsag nürnberg');
});
