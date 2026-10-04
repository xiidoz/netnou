// Reads ways out of an OpenStreetMap .osm.pbf extract (the format Geofabrik
// publishes): a sequence of zlib-compressed protobuf blocks, nodes first, then
// ways. Only what the route geometry needs is decoded – the positions of the
// nodes the caller wants to keep and the ways carrying one of the wanted tag keys.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Reader } from './pb.js';

// Node ids and positions inside the area, in file order (ascending id).
class NodeStore {
  constructor() {
    this.size = 0;
    this.ids = new Float64Array(1 << 20);
    this.lat = new Int32Array(1 << 20); // 1e-7 degrees
    this.lon = new Int32Array(1 << 20);
    this.sorted = true;
  }

  push(id, lat, lon) {
    if (this.size === this.ids.length) {
      for (const key of ['ids', 'lat', 'lon']) {
        const grown = new this[key].constructor(this.size * 2);
        grown.set(this[key]);
        this[key] = grown;
      }
    }
    if (this.size && id < this.ids[this.size - 1]) this.sorted = false;
    this.ids[this.size] = id;
    this.lat[this.size] = Math.round(lat * 1e7);
    this.lon[this.size] = Math.round(lon * 1e7);
    this.size++;
  }

  // Extracts are sorted by id, which is what makes the binary search work.
  // Re-sort defensively should a file ever not be.
  sort() {
    const order = Array.from({ length: this.size }, (_, i) => i).sort((a, b) => this.ids[a] - this.ids[b]);
    for (const key of ['ids', 'lat', 'lon']) this[key] = this[key].constructor.from(order, (i) => this[key][i]);
    this.sorted = true;
  }

  find(id) {
    if (!this.sorted) this.sort();
    const ids = this.ids;
    let lo = 0;
    let hi = this.size - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] < id) lo = mid + 1;
      else if (ids[mid] > id) hi = mid - 1;
      else return mid;
    }
    return -1;
  }
}

function inflateBlob(blob) {
  const r = new Reader(blob);
  for (let f; (f = r.next());) {
    if (f === 1) return r.bytes(); // raw
    if (f === 3) return zlib.inflateSync(r.bytes());
    if (f === 4 || f === 6 || f === 7) throw new Error('osm.pbf: only zlib-compressed blocks are supported');
    r.skip(r.wire);
  }
  throw new Error('osm.pbf: empty blob');
}

function readBlock(buf, keepNode, wantedKeys, nodes, onWay) {
  const groups = [];
  const strStart = [];
  const strEnd = [];
  let granularity = 100;
  let latOffset = 0;
  let lonOffset = 0;

  const r = new Reader(buf);
  for (let f; (f = r.next());) {
    if (f === 1) {
      const table = r.sub();
      while (table.next()) {
        const len = table.varint();
        strStart.push(table.pos);
        strEnd.push((table.pos += len));
      }
    } else if (f === 2) groups.push(r.sub());
    else if (f === 17) granularity = r.varint();
    else if (f === 19) latOffset = r.int64();
    else if (f === 20) lonOffset = r.int64();
    else r.skip(r.wire);
  }

  const cache = new Array(strStart.length);
  const str = (i) => (cache[i] ??= buf.toString('utf8', strStart[i], strEnd[i]));
  // String-table indexes of the wanted keys, so that most ways (buildings,
  // land use, …) can be dismissed by comparing a few integers.
  let keyIndexes = null;
  const wantedIndexes = () => {
    const found = [];
    for (let i = 0; i < strStart.length; i++) {
      if (strEnd[i] - strStart[i] <= 16 && wantedKeys.includes(str(i))) found.push(i);
    }
    return found;
  };

  for (const group of groups) {
    for (let f; (f = group.next());) {
      if (f === 2) {
        const dense = group.sub();
        let ids;
        let lats;
        let lons;
        for (let g; (g = dense.next());) {
          if (g === 1) ids = dense.sub();
          else if (g === 8) lats = dense.sub();
          else if (g === 9) lons = dense.sub();
          else dense.skip(dense.wire);
        }
        if (!ids || !lats || !lons) continue;
        let id = 0;
        let lat = 0;
        let lon = 0;
        while (ids.pos < ids.end) {
          id += ids.sint();
          lat += lats.sint();
          lon += lons.sint();
          const la = 1e-9 * (latOffset + granularity * lat);
          const lo = 1e-9 * (lonOffset + granularity * lon);
          if (keepNode(la, lo)) nodes.push(id, la, lo);
        }
      } else if (f === 3) {
        const way = group.sub();
        let id = 0;
        let keys = null;
        let vals = null;
        let refs = null;
        for (let g; (g = way.next());) {
          if (g === 1) id = way.varint();
          else if (g === 2) keys = way.sub();
          else if (g === 3) vals = way.sub();
          else if (g === 8) refs = way.sub();
          else way.skip(way.wire);
        }
        if (!keys || !vals || !refs) continue;

        keyIndexes ??= wantedIndexes();
        if (!keyIndexes.length) continue;
        const keysStart = keys.pos;
        let wanted = false;
        while (keys.pos < keys.end && !wanted) wanted = keyIndexes.includes(keys.varint());
        if (!wanted) continue;

        keys.pos = keysStart;
        const tags = {};
        while (keys.pos < keys.end) tags[str(keys.varint())] = str(vals.varint());

        // A way with nodes that were not kept is cut into the runs of kept nodes.
        let ref = 0;
        let run = { id, tags, nodes: [], lat: [], lon: [] };
        const flush = () => {
          if (run.nodes.length >= 2) onWay(run);
          run = { id, tags, nodes: [], lat: [], lon: [] };
        };
        while (refs.pos < refs.end) {
          ref += refs.sint();
          const i = nodes.find(ref);
          if (i < 0) flush();
          else {
            run.nodes.push(ref);
            run.lat.push(nodes.lat[i] / 1e7);
            run.lon.push(nodes.lon[i] / 1e7);
          }
        }
        flush();
      } else if (f === 1) {
        throw new Error('osm.pbf: files without dense nodes are not supported');
      } else group.skip(group.wire);
    }
  }
}

/**
 * Calls onWay({ id, tags, nodes, lat, lon }) for every way that has one of
 * `wantedKeys`, reduced to the nodes for which keepNode(lat, lon) is true.
 */
export function readPbfWays(path, keepNode, wantedKeys, onWay) {
  const fd = fs.openSync(path, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const nodes = new NodeStore();
    const lengthBuf = Buffer.alloc(4);
    const readAt = (buf, pos) => {
      if (fs.readSync(fd, buf, 0, buf.length, pos) !== buf.length) throw new Error('osm.pbf: unexpected end of file');
      return buf;
    };

    for (let pos = 0; pos < size;) {
      const headerLen = readAt(lengthBuf, pos).readUInt32BE(0);
      const header = new Reader(readAt(Buffer.alloc(headerLen), pos + 4));
      let type = '';
      let dataSize = 0;
      for (let f; (f = header.next());) {
        if (f === 1) type = header.string();
        else if (f === 3) dataSize = header.varint();
        else header.skip(header.wire);
      }
      const dataPos = pos + 4 + headerLen;
      pos = dataPos + dataSize;
      if (type !== 'OSMData') continue;
      readBlock(inflateBlob(readAt(Buffer.alloc(dataSize), dataPos)), keepNode, wantedKeys, nodes, onWay);
    }
  } finally {
    fs.closeSync(fd);
  }
}
