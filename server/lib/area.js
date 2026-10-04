// The region the map covers: one or more polygons (e.g. the districts of a
// transit network) or a plain rectangle. Internally it is rastered into cells
// of roughly one kilometre, each knowing its distance from the region. That
// makes "is this inside, or within a few km of it?" a table lookup – it is
// asked for every stop of the national timetable and for tens of millions of
// OpenStreetMap nodes.

import crypto from 'node:crypto';

const CELL_LAT = 0.01; // ~1.1 km
const CELL_LON = 0.015; // ~1.1 km at 49–50° north
const MAX_DISTANCE = 8;

/**
 * Distances, in cells (~km) from the region, up to which things still count.
 * Each must be larger than the one before: OSM data has to reach beyond the
 * point up to which routes follow it.
 */
export const NEAR = {
  region: 1, // a stop this close belongs to the region
  exit: 4, // routes to far-away stops follow the network this far out, then go straight
  osm: 7, // OpenStreetMap data is kept
};

export class Area {
  /** @param polygons GeoJSON-style: polygons → rings → [lon, lat] positions */
  constructor(polygons) {
    this.polygons = polygons;
    this.id = crypto.createHash('sha1').update(JSON.stringify([CELL_LAT, CELL_LON, MAX_DISTANCE, polygons])).digest('hex').slice(0, 16);

    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;
    for (const polygon of polygons) {
      for (const [lon, lat] of polygon[0]) {
        south = Math.min(south, lat);
        north = Math.max(north, lat);
        west = Math.min(west, lon);
        east = Math.max(east, lon);
      }
    }
    if (!(south < north && west < east)) throw new Error('area: no usable polygon');
    /** [south, west, north, east] of the region itself */
    this.bbox = [south, west, north, east];

    // The grid extends MAX_DISTANCE cells beyond the bounding box.
    this.lat0 = south - (MAX_DISTANCE + 1) * CELL_LAT;
    this.lon0 = west - (MAX_DISTANCE + 1) * CELL_LON;
    const rows = (this.rows = Math.ceil((north - this.lat0) / CELL_LAT) + MAX_DISTANCE + 1);
    const cols = (this.cols = Math.ceil((east - this.lon0) / CELL_LON) + MAX_DISTANCE + 1);
    const cells = (this.cells = new Uint8Array(rows * cols).fill(255));

    // Scanline fill: a cell is inside if its centre is (even-odd rule, so
    // holes work).
    let frontier = [];
    for (const polygon of polygons) {
      for (let row = 0; row < rows; row++) {
        const lat = this.lat0 + (row + 0.5) * CELL_LAT;
        const crossings = [];
        for (const ring of polygon) {
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [x1, y1] = ring[i];
            const [x2, y2] = ring[j];
            if (y1 > lat !== y2 > lat) crossings.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
          }
        }
        crossings.sort((a, b) => a - b);
        for (let k = 0; k + 1 < crossings.length; k += 2) {
          const from = Math.max(0, Math.ceil((crossings[k] - this.lon0) / CELL_LON - 0.5));
          const to = Math.min(cols - 1, Math.floor((crossings[k + 1] - this.lon0) / CELL_LON - 0.5));
          for (let col = from; col <= to; col++) {
            if (cells[row * cols + col] !== 0) {
              cells[row * cols + col] = 0;
              frontier.push(row * cols + col);
            }
          }
        }
      }
    }

    // Breadth-first: distance (in cells, diagonals count as one) from the region.
    for (let distance = 1; distance <= MAX_DISTANCE; distance++) {
      const next = [];
      for (const cell of frontier) {
        const row = Math.floor(cell / cols);
        const col = cell % cols;
        for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
          for (let c = Math.max(0, col - 1); c <= Math.min(cols - 1, col + 1); c++) {
            if (cells[r * cols + c] === 255) {
              cells[r * cols + c] = distance;
              next.push(r * cols + c);
            }
          }
        }
      }
      frontier = next;
    }
  }

  static fromBbox([south, west, north, east]) {
    return new Area([[[[west, south], [east, south], [east, north], [west, north], [west, south]]]]);
  }

  /** Accepts a FeatureCollection, Feature or geometry with (Multi)Polygons. */
  static fromGeoJson(geojson) {
    const polygons = [];
    const collect = (node) => {
      if (node?.type === 'FeatureCollection') (node.features ?? []).forEach(collect);
      else if (node?.type === 'Feature') collect(node.geometry);
      else if (node?.type === 'GeometryCollection') (node.geometries ?? []).forEach(collect);
      else if (node?.type === 'Polygon') polygons.push(node.coordinates);
      else if (node?.type === 'MultiPolygon') polygons.push(...node.coordinates);
    };
    collect(geojson);
    if (!polygons.length) throw new Error('area: the GeoJSON contains no polygons');
    return new Area(polygons);
  }

  /** Distance from the region in cells (~km): 0 inside, 255 if more than 8 away. */
  distance(lat, lon) {
    const row = Math.floor((lat - this.lat0) / CELL_LAT);
    const col = Math.floor((lon - this.lon0) / CELL_LON);
    if (row < 0 || col < 0 || row >= this.rows || col >= this.cols) return 255;
    return this.cells[row * this.cols + col];
  }
}
