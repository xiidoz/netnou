// Reads an OpenStreetMap .osm.pbf extract (the format Geofabrik publishes): a
// sequence of zlib-compressed protobuf blocks, nodes first, then ways, then
// relations. Only what is asked for is decoded:
// - for the route geometry the roads and tracks (readPbfWays);
// - for the towns of the stops the administrative borders, each put together
//   from the ways it is made of (readPbfBoundaries).
//
// A way names its nodes, and the file has the nodes first. So the ways are
// read first, and then the places of the nodes they have and of no others:
// memory grows with what is asked for, not with all that is mapped. Of the
// 441 million nodes of the extract of Germany its roads and tracks have 32
// million.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Reader } from './pb.js';

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

/** An extract, open for reading: its blocks, gone through by what they hold. */
class Extract {
  constructor(path) {
    this.fd = fs.openSync(path, 'r');
    try {
      ({ blocks: this.blocks, sorted: this.sorted } = blocksOf(this.fd));
    } catch (err) {
      fs.closeSync(this.fd);
      throw err;
    }
    this.kinds = new Uint8Array(this.blocks.length); // what each block was found to hold
  }

  /**
   * Hands every block that has `kind` to `read`, with its number, from the
   * end of the file on and as far as blocks of that kind can be.
   */
  through(kind, read) {
    const { blocks, kinds, sorted } = this;
    for (let b = blocks.length - 1; b >= 0; b--) {
      if (kinds[b] && !(kinds[b] & kind)) continue;
      const buf = unpacked(this.fd, blocks[b]);
      // (a block of nothing that is known is looked at every time)
      kinds[b] ||= kindsIn(buf) || (NODES | WAYS | RELATIONS);
      if (kinds[b] & kind) read(openBlock(buf), b);
      // (in order: before a block that has only what comes earlier, there is none of this kind)
      else if (sorted && kinds[b] < kind) break;
    }
  }

  close() {
    fs.closeSync(this.fd);
  }
}

/** Sorts numbers and returns the part of them that has each once. */
function sortedUnique(numbers) {
  numbers.sort();
  let count = 0;
  for (let i = 0; i < numbers.length; i++) if (!i || numbers[i] !== numbers[i - 1]) numbers[count++] = numbers[i];
  return numbers.subarray(0, count);
}

/** Where a number is among numbers in order, or would be. */
function placeAmong(numbers, number) {
  let low = 0;
  for (let high = numbers.length; low < high;) {
    const middle = (low + high) >> 1;
    if (numbers[middle] < number) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Where the nodes with these ids are.
 * @param ids in order, each once
 * @param keep (lat, lon) in degrees: whether a node there is wanted
 * @returns { lat, lon, found }: in 1e-7 degrees, and 1 for a node that the
 *   extract has and that is wanted
 */
function placesOf(extract, ids, keep = () => true) {
  const count = ids.length;
  const lat = new Int32Array(count);
  const lon = new Int32Array(count);
  const found = new Uint8Array(count);
  if (!count) return { lat, lon, found };
  extract.through(NODES, ({ groups, granularity, latOffset, lonOffset }) => {
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
          if (at < 0 || step < 0) at = placeAmong(ids, id);
          while (at < count && ids[at] < id) at++;
          if (at === count || ids[at] !== id) continue;
          // (what the block counts in is a billionth of a degree times its granularity)
          const [north, east] = [latOffset + granularity * y, lonOffset + granularity * x];
          if (!keep(1e-9 * north, 1e-9 * east)) continue;
          lat[at] = Math.round(north / 100);
          lon[at] = Math.round(east / 100);
          found[at] = 1;
        }
      }
    }
  });
  return { lat, lon, found };
}

/**
 * The ways of an extract that `classify` takes, and the places of their
 * nodes: of the ways that have one of the tag `keys` those for which
 * classify(tags) is not null, and of their nodes those for which
 * keepNode(lat, lon), in degrees, is true.
 * @returns { kinds, ways: { id, kind, start }, nodes, places }:
 *   - `kinds` what classify gave, each once: a way has the number of its own;
 *   - `places` the nodes that are kept, { id, lat, lon } in the order of their
 *     ids, in 1e-7 degrees;
 *   - the ways in the order of the file, the nodes of way w from
 *     nodes[start[w]] to nodes[start[w + 1] - 1], each as its number in
 *     `places`: -1 for one that was not kept, or that the extract does not
 *     have.
 */
export function readPbfWays(path, { keys, classify, keepNode = () => true }) {
  const extract = new Extract(path);
  try {
    const kinds = [];
    const kindOf = new Map(); // a kind as JSON: its number
    const chunks = []; // by block: its ways
    let wayCount = 0;
    let nodeCount = 0;
    extract.through(WAYS, ({ groups, strStart, strEnd, str }, b) => {
      // (most ways have none of the keys: they are told apart by a few numbers of the block's table of texts)
      const wanted = [];
      for (let i = 0; i < strStart.length; i++) if (strEnd[i] - strStart[i] <= 16 && keys.includes(str(i))) wanted.push(i);
      if (!wanted.length) return;
      const chunk = { ids: [], kinds: [], lengths: [], nodes: [] };
      for (const group of groups) {
        for (let f; (f = group.next());) {
          if (f !== 3) {
            group.skip(group.wire);
            continue;
          }
          const way = group.sub();
          let id = 0;
          let tagKeys = null;
          let values = null;
          let refs = null;
          for (let g; (g = way.next());) {
            if (g === 1) id = way.varint();
            else if (g === 2) tagKeys = way.sub();
            else if (g === 3) values = way.sub();
            else if (g === 8) refs = way.sub();
            else way.skip(way.wire);
          }
          if (!tagKeys || !values || !refs) continue;
          const keysStart = tagKeys.pos;
          let any = false;
          while (tagKeys.pos < tagKeys.end && !any) any = wanted.includes(tagKeys.varint());
          if (!any) continue;
          tagKeys.pos = keysStart;
          const tags = {};
          while (tagKeys.pos < tagKeys.end) tags[str(tagKeys.varint())] = str(values.varint());
          const kind = classify(tags);
          if (kind === null) continue;
          const text = JSON.stringify(kind);
          if (!kindOf.has(text)) kindOf.set(text, kinds.push(kind) - 1);
          let length = 0;
          for (let ref = 0; refs.pos < refs.end; length++) chunk.nodes.push((ref += refs.sint()));
          chunk.ids.push(id);
          chunk.kinds.push(kindOf.get(text));
          chunk.lengths.push(length);
        }
      }
      wayCount += chunk.ids.length;
      nodeCount += chunk.nodes.length;
      chunks[b] = chunk;
    });

    // (the blocks were read from the end: their ways are put in the order of the file)
    const ways = { id: new Float64Array(wayCount), kind: new Uint16Array(wayCount), start: new Int32Array(wayCount + 1) };
    let nodes = new Float64Array(nodeCount);
    let w = 0;
    for (const chunk of chunks) {
      if (!chunk) continue;
      nodes.set(chunk.nodes, ways.start[w]);
      for (let k = 0; k < chunk.ids.length; k++, w++) {
        ways.id[w] = chunk.ids[k];
        ways.kind[w] = chunk.kinds[k];
        ways.start[w + 1] = ways.start[w] + chunk.lengths[k];
      }
    }
    chunks.length = 0;

    // The nodes of the ways in the order of their ids, each once, and each node of a way as its number in them.
    // (Then the ids of the ways' nodes are no longer needed: memory is at its fullest here.)
    const ids = sortedUnique(Float64Array.from(nodes));
    const numbers = new Int32Array(nodeCount);
    for (let k = 0; k < nodeCount; k++) numbers[k] = placeAmong(ids, nodes[k]);
    nodes = null;
    const { lat, lon, found } = placesOf(extract, ids, keepNode);
    // Of those the ones that are kept, and the nodes of the ways as numbers among those.
    const keptAs = new Int32Array(ids.length);
    let kept = 0;
    for (let i = 0; i < ids.length; i++) {
      keptAs[i] = found[i] ? kept : -1;
      if (!found[i]) continue;
      ids[kept] = ids[i];
      lat[kept] = lat[i];
      lon[kept] = lon[i];
      kept++;
    }
    for (let k = 0; k < nodeCount; k++) numbers[k] = keptAs[numbers[k]];
    const places = { id: ids.subarray(0, kept), lat: lat.subarray(0, kept), lon: lon.subarray(0, kept) };
    return { kinds, ways, nodes: numbers, places };
  } finally {
    extract.close();
  }
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
  const extract = new Extract(path);
  try {
    const through = (kind, read) => extract.through(kind, read);
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

    // The nodes of those ways in the order of their ids, each once, and where each is.
    const all = new Float64Array(count);
    count = 0;
    for (const nodes of nodesOfWay.values()) {
      if (!nodes) continue;
      all.set(nodes, count);
      count += nodes.length;
    }
    const ids = sortedUnique(all);
    const { lat, lon, found } = placesOf(extract, ids);

    const ways = new Map();
    for (const [id, nodes] of nodesOfWay) {
      if (!nodes) continue;
      const points = new Int32Array(2 * nodes.length);
      let whole = true;
      for (let i = 0; i < nodes.length && whole; i++) {
        const at = placeAmong(ids, nodes[i]);
        whole = found[at] === 1;
        points[2 * i] = lat[at];
        points[2 * i + 1] = lon[at];
      }
      if (whole) ways.set(id, points);
    }
    return { borders, ways };
  } finally {
    extract.close();
  }
}
