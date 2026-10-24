// Routes kept from one import to the next. A new timetable has nearly all the
// hops of the one before, and routing all of them again takes minutes for a
// country: a route is found again by its network and the places of its two
// stops, and only what is new is routed. Routes belong to one reading of
// OpenStreetMap, of the networks they were found on: with new data all of
// them are routed anew.
//
// They are kept in osm-routes.bin in the data directory: a line of JSON that
// says which networks they are of, then a record for each hop, with its route
// or without one where none was found, so that a hop without a route is not
// tried again either. Routes are added as they are found, so that a restart
// in the middle of routing goes on from there. When routing is done the
// routes of the hops of the timetable are written anew, and those of hops it
// no longer has are gone.

import fs from 'node:fs';
import path from 'node:path';
import { Numbers } from './dataset.js';

// Bump when the rules of routing change (network.js, shapes.js): the kept
// routes are then found anew.
// (3: each point with the share of the hop's time up to it, #264)
const KEPT_VERSION = 3;

const FILE = 'osm-routes.bin';
// A record: the network (1 byte), the places of the two stops (4 × 4 bytes),
// the number of points of the route (4 bytes, 0 for none), then the points:
// each its latitude, its longitude and the share of the hop's time up to it
// (4 bytes each, VALUES).
const RECORD = 21;
const VALUES = 3;
// New routes are added to the file in batches of this many.
const BATCH = 2000;

/** A place in degrees as a whole number of 1e-7 degrees. */
const unit = (degrees) => Math.round(degrees * 1e7);

export class KeptRoutes {
  /**
   * The routes kept in the data directory for networks, ready to be found
   * and added to. Routes of other networks, or kept by another version, are
   * not used.
   * @param about { fetchedAt, scope } of the networks: the reading of
   *   OpenStreetMap they are of, and what the instance covers
   */
  constructor(dataDir, about) {
    this.file = path.join(dataDir, FILE);
    this.head = `${JSON.stringify({ version: KEPT_VERSION, fetchedAt: about.fetchedAt, area: about.scope })}\n`;
    this.index = new Map(); // a hop by its key: its number among the routes
    this.start = new Numbers(); // where the points of a route begin; -1 for a hop without one
    this.count = new Numbers();
    this.points = new Numbers(); // latitude and longitude of each point in 1e-5 degrees
    this.used = new Set(); // the hops of the present timetable
    this.pending = [];
    // (a file that is of other networks is begun anew with the first route that is added)
    this.appending = this.read();
  }

  /** Reads what the file has of these networks. @returns whether it has any */
  read() {
    let bytes;
    try {
      bytes = fs.readFileSync(this.file);
    } catch {
      return false;
    }
    const end = bytes.indexOf(10);
    if (end < 0 || bytes.toString('utf8', 0, end + 1) !== this.head) return false;
    let at = end + 1;
    while (at + RECORD <= bytes.length) {
      const count = bytes.readUInt32LE(at + 17);
      if (at + RECORD + 4 * VALUES * count > bytes.length) break;
      const net = bytes[at];
      const places = [1, 5, 9, 13].map((offset) => bytes.readInt32LE(at + offset));
      const points = new Int32Array(VALUES * count);
      for (let k = 0; k < VALUES * count; k++) points[k] = bytes.readInt32LE(at + RECORD + 4 * k);
      this.remember(`${net} ${places.join(' ')}`, count ? points : null);
      at += RECORD + 4 * VALUES * count;
    }
    // (a record cut short where routing was stopped is no route: the file ends before it, and goes on from there)
    if (at < bytes.length) fs.truncateSync(this.file, at);
    return true;
  }

  /** Keeps a route in memory; of a hop that comes up twice, as after a restart, the later route counts. */
  remember(key, points) {
    this.index.set(key, this.start.length);
    this.start.push(points ? this.points.length / VALUES : -1);
    this.count.push(points ? points.length / VALUES : 0);
    if (points) for (const value of points) this.points.push(value);
  }

  /**
   * The route of a hop, if it is kept: its points as latitude, longitude and
   * share of the time, … (latitude and longitude in 1e-5 degrees, the share
   * in 65,535ths; to be used at once: they lie in a list that grows), or
   * null for a hop that has none; undefined if it is not kept.
   * @param net the number of its network in NETS
   * @param from, to the places of its stops, [lat, lon] in degrees
   */
  find(net, from, to) {
    const key = `${net} ${unit(from[0])} ${unit(from[1])} ${unit(to[0])} ${unit(to[1])}`;
    const route = this.index.get(key);
    if (route === undefined) return undefined;
    this.used.add(key);
    const start = this.start.array[route];
    return start < 0 ? null : this.points.array.subarray(VALUES * start, VALUES * (start + this.count.array[route]));
  }

  /** Keeps the route of a hop that was routed: its points as find gives them, or null for none. */
  add(net, from, to, points) {
    const places = [unit(from[0]), unit(from[1]), unit(to[0]), unit(to[1])];
    const key = `${net} ${places.join(' ')}`;
    this.remember(key, points);
    this.used.add(key);
    this.pending.push(record(net, places, points));
    if (this.pending.length >= BATCH) this.flush();
  }

  /** Adds the routes found since the last time to the file. */
  flush() {
    if (!this.pending.length) return;
    const bytes = Buffer.concat(this.appending ? this.pending : [Buffer.from(this.head), ...this.pending]);
    fs.writeFileSync(this.file, bytes, { flag: this.appending ? 'a' : 'w' });
    this.appending = true;
    this.pending = [];
  }

  /** Writes the routes of the hops of the present timetable, and no others, as what is kept. */
  save() {
    this.pending = [];
    const parts = [Buffer.from(this.head)];
    for (const key of this.used) {
      const route = this.index.get(key);
      const start = this.start.array[route];
      const points = start < 0 ? null : this.points.array.subarray(VALUES * start, VALUES * (start + this.count.array[route]));
      const [net, ...places] = key.split(' ').map(Number);
      parts.push(record(net, places, points));
    }
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.concat(parts));
    fs.renameSync(tmp, this.file);
    this.appending = true;
  }
}

/** A hop and its route as a record of the file. */
function record(net, places, points) {
  const count = points ? points.length / VALUES : 0;
  const bytes = Buffer.alloc(RECORD + 4 * VALUES * count);
  bytes[0] = net;
  places.forEach((value, i) => bytes.writeInt32LE(value, 1 + 4 * i));
  bytes.writeUInt32LE(count, 17);
  for (let k = 0; k < VALUES * count; k++) bytes.writeInt32LE(points[k], RECORD + 4 * k);
  return bytes;
}
