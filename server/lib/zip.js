// Minimal streaming zip reader (stored + deflate, with zip64), so the 2+ GB
// stop_times.txt can be read straight out of the archive without extracting it.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const CHUNK = 1 << 20;

export async function openZip(path) {
  const fh = await fs.promises.open(path, 'r');
  try {
    const { size: fileSize } = await fh.stat();

    const read = async (pos, len) => {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, pos);
      if (bytesRead !== len) throw new Error('zip: unexpected end of file');
      return buf;
    };

    // The end-of-central-directory record sits at the very end, followed only
    // by an optional comment of up to 64 KiB.
    const tailLen = Math.min(fileSize, 65557);
    const tail = await read(fileSize - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('zip: end of central directory not found');

    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc < 0 || tail.readUInt32LE(loc) !== SIG_EOCD64_LOCATOR) throw new Error('zip: zip64 locator not found');
      const rec = await read(Number(tail.readBigUInt64LE(loc + 8)), 56);
      if (rec.readUInt32LE(0) !== SIG_EOCD64) throw new Error('zip: zip64 record not found');
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }

    const cd = await read(cdOffset, cdSize);
    const entries = new Map();
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (cd.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('zip: bad central directory entry');
      const method = cd.readUInt16LE(p + 10);
      let compSize = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let offset = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);

      // zip64 extra field: holds exactly those values that overflowed above.
      let x = p + 46 + nameLen;
      const extraEnd = x + extraLen;
      while (x + 4 <= extraEnd) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (size === 0xffffffff) { size = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
        }
        x += 4 + len;
      }

      entries.set(name, { method, compSize, size, offset });
      p = extraEnd + commentLen;
    }

    return {
      entries,
      /** Decompressed read stream for one archive member. */
      async stream(name) {
        const entry = entries.get(name);
        if (!entry) throw new Error(`zip: ${name} not found in archive`);
        if (entry.method !== 0 && entry.method !== 8) throw new Error(`zip: unsupported compression method ${entry.method}`);
        const local = await read(entry.offset, 30);
        if (local.readUInt32LE(0) !== SIG_LOCAL) throw new Error('zip: bad local file header');
        const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        if (entry.compSize === 0) return Readable.from([]);
        const raw = fs.createReadStream(path, { start, end: start + entry.compSize - 1, highWaterMark: CHUNK });
        if (entry.method === 0) return raw;
        const inflate = zlib.createInflateRaw({ chunkSize: CHUNK });
        raw.on('error', (err) => inflate.destroy(err));
        return raw.pipe(inflate);
      },
      close: () => fh.close(),
    };
  } catch (err) {
    await fh.close();
    throw err;
  }
}
