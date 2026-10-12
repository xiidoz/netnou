// The region the map covers: one or more polygons (e.g. the districts of a
// transit network) or a plain rectangle. Internally it is rastered into cells
// of roughly one kilometre, each knowing its distance from the region. That
// makes "is this inside, or within a few km of it?" a table lookup – it is
// asked for every stop of the national timetable and for tens of millions of
// OpenStreetMap nodes.
//
// An instance need not have an area: it may cover everything the feed has, or
// all trips of some operators. Its region is then made from the stops of the
// trips it keeps (Area.covering) and is called its extent.

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
    this.lay([south, west, north, east]);
    const { rows, cols, cells } = this;

    // Scanline fill: a cell is inside if its centre is (even-odd rule, so
    // holes work).
    const frontier = [];
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

    this.spread(frontier);
  }

  /** Lays out the grid for a region with this bounding box, no cell of it inside yet. */
  lay(bbox) {
    const [south, west, north, east] = bbox;
    /** [south, west, north, east] of the region itself */
    this.bbox = bbox;
    // The grid extends MAX_DISTANCE cells beyond the bounding box.
    this.lat0 = south - (MAX_DISTANCE + 1) * CELL_LAT;
    this.lon0 = west - (MAX_DISTANCE + 1) * CELL_LON;
    this.rows = Math.ceil((north - this.lat0) / CELL_LAT) + MAX_DISTANCE + 1;
    this.cols = Math.ceil((east - this.lon0) / CELL_LON) + MAX_DISTANCE + 1;
    this.cells = new Uint8Array(this.rows * this.cols).fill(255);
  }

  /** Gives every cell near the region its distance from it. @param frontier the cells that are inside */
  spread(frontier) {
    const { rows, cols, cells } = this;
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

  /**
   * The extent of an instance without an area: the cells that have a stop,
   * and those on the straight line from each stop to the next of a trip. What
   * lies between two stops far apart, as on a long-distance line, is then
   * inside as well, and its tracks are among the OpenStreetMap data kept.
   * @param lat, lon the positions of the stops
   * @param eachHop calls what it is given with every two stops that a trip
   *   calls at one after the other, as indexes into lat and lon
   */
  static covering(lat, lon, eachHop = () => {}) {
    if (!lat.length) throw new Error('area: no stops to make an extent from');
    const area = Object.create(Area.prototype);
    area.polygons = [];
    // (an extent follows the timetable; what is stored is tied to what the instance covers: scopeId)
    area.id = null;
    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;
    for (let i = 0; i < lat.length; i++) {
      south = Math.min(south, lat[i]);
      north = Math.max(north, lat[i]);
      west = Math.min(west, lon[i]);
      east = Math.max(east, lon[i]);
    }
    area.lay([south, west, north, east]);
    const { cols, cells } = area;
    const frontier = [];
    const mark = (atLat, atLon) => {
      const cell = Math.floor((atLat - area.lat0) / CELL_LAT) * cols + Math.floor((atLon - area.lon0) / CELL_LON);
      if (cells[cell] !== 0) {
        cells[cell] = 0;
        frontier.push(cell);
      }
    };
    for (let i = 0; i < lat.length; i++) mark(lat[i], lon[i]);
    eachHop((from, to) => {
      // (two points to a cell, so that none on the way is stepped over)
      const steps = Math.ceil(2 * Math.max(Math.abs(lat[to] - lat[from]) / CELL_LAT, Math.abs(lon[to] - lon[from]) / CELL_LON));
      for (let k = 1; k < steps; k++) mark(lat[from] + ((lat[to] - lat[from]) * k) / steps, lon[from] + ((lon[to] - lon[from]) * k) / steps);
    });
    area.spread(frontier);
    return area;
  }

  /** What toJSON() gave, as an Area again. It has no polygons. */
  static fromJSON({ bbox, cells }) {
    const area = Object.create(Area.prototype);
    area.polygons = [];
    area.id = null;
    area.lay(bbox);
    const stored = Buffer.from(cells, 'base64');
    if (stored.length !== area.cells.length) throw new Error('area: the stored grid does not fit its bounding box');
    area.cells.set(stored);
    return area;
  }

  /** The grid as it is, for keeping beside what was made for it. */
  toJSON() {
    return { bbox: this.bbox, cells: Buffer.from(this.cells).toString('base64') };
  }

  /** Whether every cell inside this region is at most `distance` cells from `other`. */
  within(other, distance) {
    for (let cell = 0; cell < this.cells.length; cell++) {
      if (this.cells[cell] !== 0) continue;
      const row = Math.floor(cell / this.cols);
      if (other.distance(this.lat0 + (row + 0.5) * CELL_LAT, this.lon0 + ((cell % this.cols) + 0.5) * CELL_LON) > distance) return false;
    }
    return true;
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

/** An operator's name as it is compared: without regard to capitals and to spaces at its ends. */
export const agencyKey = (name) => name.trim().toLowerCase();

/**
 * What an instance covers, as a short text that stored data is tied to: its
 * area, or none, and its operators, or all of them.
 * @param area an Area, or null for everything the feed has
 * @param agencies the names of the operators as agencyKey has them, or null for all
 */
export function scopeId(area, agencies) {
  if (area && !agencies) return area.id;
  return crypto.createHash('sha1').update(JSON.stringify([area?.id ?? 'all', agencies ? [...agencies].sort() : null])).digest('hex').slice(0, 16);
}
