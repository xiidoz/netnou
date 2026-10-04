// Test fixtures: an in-memory zip writer and a protobuf encoder, so the tests
// can feed the real reader/decoder code without any binary files in the repo,
// and a local web server standing in for the feed provider.

import http from 'node:http';
import zlib from 'node:zlib';

/**
 * Builds a zip archive from { name: text }.
 * @param {{store?: string[], zip64?: boolean}} [options] store: members to
 *   leave uncompressed; zip64: write sizes and offsets the way archives of
 *   more than 4 GB have them, whatever the actual size
 */
export function makeZip(files, { store = [], zip64 = false } = {}) {
  const locals = [];
  const central = [];
  const count = Object.keys(files).length;
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const stored = store.includes(name);
    const data = stored ? raw : zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    // zip64: the 32-bit fields say "see the extra field"
    const extra = Buffer.alloc(zip64 ? 28 : 0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(raw.length), 4);
      extra.writeBigUInt64LE(BigInt(data.length), 12);
      extra.writeBigUInt64LE(BigInt(offset), 20);
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(zlib.crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt32LE(zlib.crc32(raw), 16);
    entry.writeUInt32LE(zip64 ? 0xffffffff : data.length, 20);
    entry.writeUInt32LE(zip64 ? 0xffffffff : raw.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt16LE(extra.length, 30);
    entry.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);

    locals.push(local, nameBuf, data);
    central.push(entry, nameBuf, extra);
    offset += 30 + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip64 ? 0xffff : count, 8);
  end.writeUInt16LE(zip64 ? 0xffff : count, 10);
  end.writeUInt32LE(zip64 ? 0xffffffff : centralBuf.length, 12);
  end.writeUInt32LE(zip64 ? 0xffffffff : offset, 16);
  if (!zip64) return Buffer.concat([...locals, centralBuf, end]);

  // zip64 end of central directory record and its locator, in front of the usual end record
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(count), 24);
  record.writeBigUInt64LE(BigInt(count), 32);
  record.writeBigUInt64LE(BigInt(centralBuf.length), 40);
  record.writeBigUInt64LE(BigInt(offset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(offset + centralBuf.length), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([...locals, centralBuf, record, locator, end]);
}

function varint(value) {
  let v = BigInt.asUintN(64, BigInt(value)); // negatives become 10-byte two's complement
  const bytes = [];
  do {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    bytes.push(v ? b | 0x80 : b);
  } while (v);
  return Buffer.from(bytes);
}

export const pb = {
  int: (field, value) => Buffer.concat([varint(field << 3), varint(value)]),
  bytes: (field, ...parts) => {
    const body = Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'utf8') : p)));
    return Buffer.concat([varint((field << 3) | 2), varint(body.length), body]);
  },
};

const stopTimeEvent = (field, ev) => pb.bytes(field, ...(ev.delay === undefined ? [] : [pb.int(1, ev.delay)]), ...(ev.time === undefined ? [] : [pb.int(2, ev.time)]));

/** Encodes a FeedMessage from plain objects mirroring what decodeFeed returns. */
export function encodeFeed({ timestamp, tripUpdates = [], alerts = [] }) {
  const entities = [];
  for (const tu of tripUpdates) {
    const trip = pb.bytes(1, pb.bytes(1, tu.tripId), pb.bytes(3, tu.startDate), pb.int(4, tu.rel ?? 0));
    const updates = (tu.stops ?? []).map((s) =>
      pb.bytes(2, pb.int(1, s.seq), ...(s.arr ? [stopTimeEvent(2, s.arr)] : []), ...(s.dep ? [stopTimeEvent(3, s.dep)] : []), pb.bytes(4, s.stopId), pb.int(5, s.rel ?? 0)),
    );
    entities.push(pb.bytes(2, pb.bytes(1, `tu${entities.length}`), pb.bytes(3, trip, ...updates)));
  }
  for (const alert of alerts) {
    // periods: [{ start, end }] in epoch seconds, either may be left out
    const periods = (alert.periods ?? []).map((p) => pb.bytes(1, ...(p.start ? [pb.int(1, p.start)] : []), ...(p.end ? [pb.int(2, p.end)] : [])));
    const informed = alert.tripId ? pb.bytes(5, pb.bytes(4, pb.bytes(1, alert.tripId))) : pb.bytes(5, pb.bytes(5, alert.stopId));
    const text = pb.bytes(11, pb.bytes(1, pb.bytes(1, alert.text), pb.bytes(2, 'de')));
    entities.push(pb.bytes(2, pb.bytes(1, `al${entities.length}`), pb.bytes(5, ...periods, informed, text)));
  }
  return Buffer.concat([pb.bytes(1, pb.bytes(1, '2.0'), pb.int(3, timestamp)), ...entities]);
}

// ---------- a miniature .osm.pbf ----------

const zigzag = (v) => (v < 0 ? -2 * v - 1 : 2 * v);
const packed = (field, values, signed) => pb.bytes(field, ...values.map((v) => pb.int(0, signed ? zigzag(v) : v).subarray(1)));
const deltas = (values) => values.map((v, i) => v - (i ? values[i - 1] : 0));

function pbfBlob(type, block) {
  const blob = pb.bytes(3, zlib.deflateSync(block));
  const header = Buffer.concat([pb.bytes(1, type), pb.int(3, blob.length)]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([length, header, blob]);
}

/** nodes: [[id, lat, lon]], ways: [[id, [refs], {tags}]] */
export function makePbf(nodes, ways) {
  const strings = [''];
  const str = (s) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const dense = pb.bytes(2,
    packed(1, deltas(nodes.map((n) => n[0])), true),
    packed(8, deltas(nodes.map((n) => Math.round(n[1] * 1e7))), true),
    packed(9, deltas(nodes.map((n) => Math.round(n[2] * 1e7))), true));
  const wayMessages = ways.map(([id, refs, tags]) => pb.bytes(3,
    pb.int(1, id),
    packed(2, Object.keys(tags).map(str)),
    packed(3, Object.values(tags).map(str)),
    packed(8, deltas(refs), true)));
  const table = () => pb.bytes(1, ...strings.map((s) => pb.bytes(1, s)));
  return Buffer.concat([
    pbfBlob('OSMHeader', pb.bytes(4, 'OsmSchema-V0.6')),
    pbfBlob('OSMData', Buffer.concat([pb.bytes(1, pb.bytes(1, '')), pb.bytes(2, dense)])),
    pbfBlob('OSMData', Buffer.concat([table(), pb.bytes(2, ...wayMessages)])),
  ]);
}

// ---------- the feed provider ----------

/**
 * A web server on 127.0.0.1 that plays the feed provider and the OSM mirror:
 *   /feed.zip      `feed.zip` with the ETag `feed.etag`
 *   /realtime.pb   `feed.realtime`
 *   /area.osm.pbf  `feed.osm`, or 404 while there is none
 * `feed` is read on every request, so a test can publish a new version by
 * changing it. While `feed.hold` is a pending promise, downloads of the zip
 * wait for it; `feed.fail` makes them fail: 'refuse' with HTTP 503, 'cut' by
 * closing the connection halfway. `feed.downloadEtag` gives the download
 * another ETag than HEAD reports. `requests` counts what was asked for.
 * @returns {Promise<{url: string, requests: {head: number, get: number, realtime: number, osm: number}, close: () => Promise<void>}>}
 */
export async function startUpstream(feed) {
  const requests = { head: 0, get: 0, realtime: 0, osm: 0 };
  const server = http.createServer(async (req, res) => {
    if (req.url === '/area.osm.pbf') {
      requests.osm++;
      res.writeHead(feed.osm ? 200 : 404, { 'Content-Type': 'application/octet-stream' });
      return res.end(feed.osm);
    }
    if (req.url === '/feed.zip') {
      const headers = { ETag: feed.etag, 'Last-Modified': 'Sat, 03 Oct 2026 02:00:00 GMT', 'Content-Type': 'application/zip', 'Content-Length': feed.zip.length };
      if (req.method === 'HEAD') {
        requests.head++;
        res.writeHead(200, headers);
        return res.end();
      }
      requests.get++;
      await feed.hold;
      if (feed.fail === 'refuse') {
        res.writeHead(503);
        return res.end();
      }
      res.writeHead(200, { ...headers, ETag: feed.downloadEtag ?? feed.etag });
      if (feed.fail === 'cut') return res.write(feed.zip.subarray(0, feed.zip.length / 2), () => res.destroy());
      return res.end(feed.zip);
    }
    if (req.url === '/realtime.pb') {
      requests.realtime++;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(feed.realtime);
    }
    res.writeHead(404);
    return res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}
