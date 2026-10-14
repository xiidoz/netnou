// Reads an OpenStreetMap .osm.pbf extract (the format Geofabrik publishes): a
// sequence of zlib-compressed protobuf blocks, nodes first, then ways, then
// relations. Only what is asked for is decoded:
// - for the route geometry the positions of the nodes the caller wants to
//   keep and the ways carrying one of the wanted tag keys (readPbfWays);
// - for the towns of the stops the administrative borders, each put together
//   from the ways it is made of (readPbfBoundaries).

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

function readAt(fd, length, pos) {
  const buf = Buffer.alloc(length);
  if (fs.readSync(fd, buf, 0, length, pos) !== length) throw new Error('osm.pbf: unexpected end of file');
  return buf;
}

/**
 * Where the blocks of data are in a file, each as [position, length], found
 * by going from one to the next without unpacking any; and whether the file
 * says that it has its nodes first, then its ways, then its relations.
 */
function blocksOf(fd) {
  const size = fs.fstatSync(fd).size;
  const blocks = [];
  let sorted = false;
  for (let pos = 0; pos < size;) {
    const headerLen = readAt(fd, 4, pos).readUInt32BE(0);
    const header = new Reader(readAt(fd, headerLen, pos + 4));
    let type = '';
    let dataSize = 0;
    for (let f; (f = header.next());) {
      if (f === 1) type = header.string();
      else if (f === 3) dataSize = header.varint();
      else header.skip(header.wire);
    }
    const dataPos = pos + 4 + headerLen;
    pos = dataPos + dataSize;
    if (type === 'OSMData') blocks.push([dataPos, dataSize]);
    else if (type === 'OSMHeader') {
      // (among what the file says of itself: optional_features)
      const head = new Reader(inflateBlob(readAt(fd, dataSize, dataPos)));
      for (let f; (f = head.next());) {
        if (f === 5) sorted ||= head.string() === 'Sort.Type_then_ID';
        else head.skip(head.wire);
      }
    }
  }
  return { blocks, sorted };
}

const unpacked = (fd, [pos, length]) => inflateBlob(readAt(fd, length, pos));

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

/**
 * A block as it lies in the file: its groups of nodes, ways or relations,
 * its table of texts (where each begins and ends in `buf`, and `str(i)` for
 * one of them) and what its coordinates are counted in.
 */
function openBlock(buf) {
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
  return { groups, strStart, strEnd, str, granularity, latOffset, lonOffset };
}

function readBlock(buf, keepNode, wantedKeys, nodes, onWay) {
  const { groups, strStart, strEnd, str, granularity, latOffset, lonOffset } = openBlock(buf);
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
    const nodes = new NodeStore();
    for (const block of blocksOf(fd).blocks) readBlock(unpacked(fd, block), keepNode, wantedKeys, nodes, onWay);
  } finally {
    fs.closeSync(fd);
  }
}

// What a block holds, as bits: a file that is in order has all its blocks
// of nodes before those of ways, and those before the ones of relations.
const NODES = 1;
const WAYS = 2;
const RELATIONS = 4;

/** Which of nodes, ways and relations a block has, by the first thing in each of its groups. */
function kindsIn(buf) {
  let kinds = 0;
  const r = new Reader(buf);
  for (let f; (f = r.next());) {
    if (f !== 2) {
      r.skip(r.wire);
      continue;
    }
    const first = r.sub().next();
    kinds |= first === 4 ? RELATIONS : first === 3 ? WAYS : first === 1 || first === 2 ? NODES : 0;
  }
  return kinds;
}

/**
 * The administrative borders in an extract that have a name and one of the
 * wanted levels (admin_level, as texts: '8' is a municipality in Germany),
 * and the ways they are made of. A border is a relation of ways, and two
 * neighbours share the ways between them, so every way is given once. Where
 * an extract ends, a border has ways that the extract does not have, which
 * another extract may.
 *
 * Relations name ways and ways name nodes, and the file has them the other
 * way round, so it is gone through three times: for the relations, for
 * their ways, for the nodes of those. In a file that is in order each block
 * is unpacked for one of the three only.
 * @returns { borders: [{ id, level, name, ways }], ways }: for a border the
 *   ids of its ways, whatever their role: around it, or around what lies in
 *   it and is not of it. `ways` is a Map from the id of such a way to its
 *   points, as latitude, longitude, latitude, … in 1e-7 degrees, for every
 *   one that the extract has whole.
 */
export function readPbfBoundaries(path, levels) {
  const fd = fs.openSync(path, 'r');
  try {
    const { blocks, sorted } = blocksOf(fd);
    const kinds = new Uint8Array(blocks.length); // what each block was found to hold
    /** Hands every block that has `kind` to `read`, from the end of the file on, as far as blocks of that kind can be. */
    const through = (kind, read) => {
      for (let b = blocks.length - 1; b >= 0; b--) {
        if (kinds[b] && !(kinds[b] & kind)) continue;
        const buf = unpacked(fd, blocks[b]);
        // (a block of nothing that is known is looked at every time)
        kinds[b] ||= kindsIn(buf) || (NODES | WAYS | RELATIONS);
        if (kinds[b] & kind) read(openBlock(buf));
        // (in order: before a block that has only what comes earlier, there is none of this kind)
        else if (sorted && kinds[b] < kind) break;
      }
    };

    const borders = [];
    const nodesOfWay = new Map(); // by the id of a way that a border has: its nodes, once read
    through(RELATIONS, ({ groups, strStart, strEnd, str }) => {
      const find = (text) => strStart.findIndex((start, i) => strEnd[i] - start === Buffer.byteLength(text) && str(i) === text);
      const [boundary, administrative, adminLevel, nameKey] = ['boundary', 'administrative', 'admin_level', 'name'].map(find);
      if (boundary < 0 || administrative < 0 || adminLevel < 0 || nameKey < 0) return;
      for (const group of groups) {
        for (let f; (f = group.next());) {
          if (f !== 4) {
            group.skip(group.wire);
            continue;
          }
          const relation = group.sub();
          let id = 0;
          let keys = null;
          let vals = null;
          let members = null;
          let types = null;
          for (let g; (g = relation.next());) {
            if (g === 1) id = relation.varint();
            else if (g === 2) keys = relation.sub();
            else if (g === 3) vals = relation.sub();
            else if (g === 9) members = relation.sub();
            else if (g === 10) types = relation.sub();
            else relation.skip(relation.wire);
          }
          if (!keys || !vals || !members || !types) continue;
          let is = false;
          let level = null;
          let name = null;
          while (keys.pos < keys.end) {
            const [key, value] = [keys.varint(), vals.varint()];
            if (key === boundary) is = value === administrative;
            else if (key === adminLevel) level = str(value);
            else if (key === nameKey) name = str(value);
          }
          if (!is || !name || !levels.includes(level)) continue;
          // (of its members the ways: 1, where 0 is a node and 2 a relation; each once, should it be named twice)
          const ways = new Set();
          let member = 0;
          while (members.pos < members.end) {
            member += members.sint();
            if (types.varint() === 1) ways.add(member);
          }
          for (const way of ways) nodesOfWay.set(way, null);
          borders.push({ id, level, name, ways: [...ways] });
        }
      }
    });
    if (!borders.length) return { borders, ways: new Map() };

    let count = 0; // of the nodes of all those ways
    through(WAYS, ({ groups }) => {
      for (const group of groups) {
        for (let f; (f = group.next());) {
          if (f !== 3) {
            group.skip(group.wire);
            continue;
          }
          const way = group.sub();
          let id = 0;
          let refs = null;
          for (let g; (g = way.next());) {
            if (g === 1) id = way.varint();
            else if (g === 8) refs = way.sub();
            else way.skip(way.wire);
          }
          if (!refs || nodesOfWay.get(id) !== null) continue;
          const nodes = [];
          for (let ref = 0; refs.pos < refs.end;) nodes.push((ref += refs.sint()));
          if (nodes.length < 2) continue;
          nodesOfWay.set(id, nodes);
          count += nodes.length;
        }
      }
    });

    if (!count) return { borders, ways: new Map() };

    // The nodes of those ways in the order of their ids, each once, and for each its place when it has been read.
    let ids = new Float64Array(count);
    count = 0;
    for (const nodes of nodesOfWay.values()) {
      if (!nodes) continue;
      ids.set(nodes, count);
      count += nodes.length;
    }
    ids.sort();
    count = 0;
    for (let i = 0; i < ids.length; i++) if (!i || ids[i] !== ids[i - 1]) ids[count++] = ids[i];
    ids = ids.subarray(0, count);
    const lat = new Int32Array(count);
    const lon = new Int32Array(count);
    const found = new Uint8Array(count);
    /** Where a node is among them, or would be. */
    const place = (id) => {
      let low = 0;
      for (let high = count; low < high;) {
        const middle = (low + high) >> 1;
        if (ids[middle] < id) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    through(NODES, ({ groups, granularity, latOffset, lonOffset }) => {
      for (const group of groups) {
        for (let f; (f = group.next());) {
          if (f !== 2) {
            if (f === 1) throw new Error('osm.pbf: files without dense nodes are not supported');
            group.skip(group.wire);
            continue;
          }
          const dense = group.sub();
          let idDeltas;
          let latDeltas;
          let lonDeltas;
          for (let g; (g = dense.next());) {
            if (g === 1) idDeltas = dense.sub();
            else if (g === 8) latDeltas = dense.sub();
            else if (g === 9) lonDeltas = dense.sub();
            else dense.skip(dense.wire);
          }
          if (!idDeltas || !latDeltas || !lonDeltas) continue;
          // (the ids of a block go up, as a rule, and with them the place among the wanted ones: it is looked for anew only where they do not)
          let [id, y, x, at] = [0, 0, 0, -1];
          while (idDeltas.pos < idDeltas.end) {
            const step = idDeltas.sint();
            id += step;
            y += latDeltas.sint();
            x += lonDeltas.sint();
            if (at < 0 || step < 0) at = place(id);
            while (at < count && ids[at] < id) at++;
            if (at === count || ids[at] !== id) continue;
            // (to 1e-7 degrees from what the block counts in, a billionth of a degree times its granularity)
            lat[at] = Math.round((latOffset + granularity * y) / 100);
            lon[at] = Math.round((lonOffset + granularity * x) / 100);
            found[at] = 1;
          }
        }
      }
    });

    const ways = new Map();
    for (const [id, nodes] of nodesOfWay) {
      if (!nodes) continue;
      const points = new Int32Array(2 * nodes.length);
      let whole = true;
      for (let i = 0; i < nodes.length && whole; i++) {
        const at = place(nodes[i]);
        whole = found[at] === 1;
        points[2 * i] = lat[at];
        points[2 * i + 1] = lon[at];
      }
      if (whole) ways.set(id, points);
    }
    return { borders, ways };
  } finally {
    fs.closeSync(fd);
  }
}
