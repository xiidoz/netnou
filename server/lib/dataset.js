// The dataset: the timetable of an instance as the import leaves it and the
// server loads it. What repeats in a timetable is in it once: a sequence of
// stops, a set of running times. Numbers are columns (typed arrays), not an
// array for every trip, and the file is those columns as they are, so that
// loading it parses nothing. The layout is described above buildDataset in
// importer.js.

import fs from 'node:fs';

// Bump when the layout or the meaning of anything in the dataset changes,
// including the route geometry (shapes.js) and what the importer puts into a
// field: a stored dataset of another version is discarded and imported again
// on start.
export const DATASET_VERSION = 12;

const MAGIC = 'netnou dataset\n';
// Columns begin at a multiple of this, so that a typed array can be laid over
// them where they are.
const ALIGN = 8;
// One read or write call takes at most this many bytes.
const CHUNK = 1 << 30;
// A list of texts as long as this is stored as a column of its own, not in
// the head of the file.
const LINES_FROM = 64;

const TYPES = { Int32Array, Int16Array, Uint8Array, Uint16Array, Float64Array };

/**
 * Many short texts as one block of UTF-8 with the place each begins at: what
 * two million trip ids cost as that many strings is saved, and a text is
 * found by its bytes where the block is in their order (indexOf).
 */
export class Texts {
  /**
   * @param {Uint8Array} bytes all texts, one after the other
   * @param {Int32Array} start where each begins, and at its end where the last one ends
   */
  constructor(bytes, start) {
    this.bytes = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.start = start;
    this.length = start.length - 1;
  }

  /** @param {string[]} texts */
  static from(texts) {
    const start = new Int32Array(texts.length + 1);
    let size = 0;
    for (let i = 0; i < texts.length; i++) {
      start[i] = size;
      size += Buffer.byteLength(texts[i]);
    }
    start[texts.length] = size;
    const bytes = Buffer.allocUnsafe(size);
    for (let i = 0; i < texts.length; i++) bytes.write(texts[i], start[i]);
    return new Texts(bytes, start);
  }

  get(i) {
    return this.bytes.toString('utf8', this.start[i], this.start[i + 1]);
  }

  /** Whether text i is `text`. Where both are plain ASCII, as ids nearly always are, no string is made for it. */
  is(i, text) {
    const from = this.start[i];
    const length = this.start[i + 1] - from;
    // (as many characters as bytes: each takes one byte, or it is not this text)
    if (text.length !== length) return text.length < length && this.get(i) === text;
    // (a character beyond ASCII takes more than one byte: the text is then longer than this one)
    for (let k = 0; k < length; k++) if (text.charCodeAt(k) !== this.bytes[from + k] || this.bytes[from + k] > 127) return false;
    return true;
  }

  /** The position of `text`, or -1. Only for texts that are in the order of their bytes (byteOrder). */
  indexOf(text) {
    const wanted = Buffer.from(text);
    let low = 0;
    let high = this.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const order = this.bytes.compare(wanted, 0, wanted.length, this.start[middle], this.start[middle + 1]);
      if (order === 0) return middle;
      if (order < 0) low = middle + 1;
      else high = middle - 1;
    }
    return -1;
  }

  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.get(i);
  }
}

/**
 * Compares two texts as their UTF-8 bytes compare. For nearly every text that
 * is the order of plain `<`; the two differ only where a character beyond the
 * basic plane meets one near its end.
 */
export function byteOrder(a, b) {
  if (a === b) return 0;
  if (!/[\uD800-\uFFFF]/.test(a) && !/[\uD800-\uFFFF]/.test(b)) return a < b ? -1 : 1;
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

const pad = (size) => (ALIGN - (size % ALIGN)) % ALIGN;

/**
 * Writes a dataset: a head of JSON with everything small in it, then every
 * typed array, block of texts and long list of texts as a column of bytes.
 * Written under another name first and renamed, so that a crash never leaves
 * half a file behind.
 */
export function writeDataset(file, data) {
  const columns = [];
  const parts = [];
  let size = 0;
  const column = (type, bytes, count) => {
    columns.push({ type, offset: size, bytes: bytes.byteLength, count });
    parts.push(bytes);
    size += bytes.byteLength + pad(bytes.byteLength);
    return columns.length - 1;
  };
  // (a Buffer is a Uint8Array by another name)
  const typed = (array) => column(array instanceof Uint8Array ? 'Uint8Array' : array.constructor.name, new Uint8Array(array.buffer, array.byteOffset, array.byteLength), array.length);

  const head = JSON.stringify(data, (key, value) => {
    if (ArrayBuffer.isView(value)) {
      if (!(value instanceof Uint8Array) && !TYPES[value.constructor.name]) throw new Error(`dataset: no column of type ${value.constructor.name}`);
      return { $column: typed(value) };
    }
    if (value instanceof Texts) return { $texts: [typed(value.bytes.subarray()), typed(value.start)] };
    if (Array.isArray(value) && value.length >= LINES_FROM && value.every((text) => typeof text === 'string' && !text.includes('\n'))) {
      return { $lines: column('lines', Buffer.from(value.join('\n')), value.length) };
    }
    return value;
  });

  const top = Buffer.from(`${MAGIC}${JSON.stringify({ columns })}\n${head}\n`);
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    const write = (bytes) => {
      for (let done = 0; done < bytes.byteLength;) done += fs.writeSync(fd, bytes, done, Math.min(CHUNK, bytes.byteLength - done));
    };
    // (how long the top is, as text of a fixed width, so that the columns can begin at a multiple of ALIGN)
    const length = Buffer.from(String(top.length).padStart(15, ' ') + '\n');
    write(length);
    write(top);
    write(Buffer.alloc(pad(length.length + top.length)));
    for (const bytes of parts) {
      write(bytes);
      write(Buffer.alloc(pad(bytes.byteLength)));
    }
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** The bytes of a file, in memory that threads can share if asked for. */
function bytesOf(file, shared) {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    // (a buffer of its own, which begins at a multiple of ALIGN as the file does)
    const bytes = Buffer.from(shared ? new SharedArrayBuffer(size) : new ArrayBuffer(size));
    for (let done = 0; done < size;) {
      const read = fs.readSync(fd, bytes, done, Math.min(CHUNK, size - done), done);
      if (!read) throw new Error('dataset: unexpected end of file');
      done += read;
    }
    return bytes.buffer;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Reads the bytes of a dataset written by writeDataset into memory that
 * threads can share: each of them lays its own dataset over it (datasetFrom),
 * and none has a copy of the columns.
 * @returns {SharedArrayBuffer}
 */
export function loadDataset(file) {
  return bytesOf(file, true);
}

/**
 * A dataset from the bytes of its file. The typed arrays lie over the bytes
 * as they are: nothing is copied and nothing parsed but the head.
 * @param buffer an ArrayBuffer or a SharedArrayBuffer
 * @param options.lists the names of the long lists of texts that are read,
 *   where not all of them are wanted; the others are null. Such a list is
 *   strings of the thread that reads it, and a thread that needs few of them
 *   does without the rest
 */
export function datasetFrom(buffer, { lists = null } = {}) {
  const bytes = Buffer.from(buffer);
  const topLength = Number(bytes.toString('latin1', 0, 16));
  if (!(topLength > MAGIC.length) || bytes.toString('latin1', 16, 16 + MAGIC.length) !== MAGIC) throw new Error('not a dataset');
  const top = bytes.toString('utf8', 16 + MAGIC.length, 16 + topLength);
  const cut = top.indexOf('\n');
  const { columns } = JSON.parse(top.slice(0, cut));
  const base = 16 + topLength + pad(16 + topLength);

  const made = columns.map(({ type, offset, bytes: length, count }) => {
    if (base + offset + length > bytes.byteLength) throw new Error('dataset: the file is cut short');
    // (a list of texts is made when it turns out to be wanted, by its name)
    if (type === 'lines') return () => (count ? bytes.toString('utf8', base + offset, base + offset + length).split('\n') : []);
    return new TYPES[type](buffer, base + offset, count);
  });
  return JSON.parse(top.slice(cut + 1), (key, value) => {
    if (value && typeof value === 'object') {
      if (value.$column !== undefined) return made[value.$column];
      if (value.$lines !== undefined) return !lists || lists.includes(key) ? made[value.$lines]() : null;
      if (value.$texts !== undefined) return new Texts(made[value.$texts[0]], made[value.$texts[1]]);
    }
    return value;
  });
}

/**
 * What a dataset written by writeDataset has besides its columns, which are
 * null in it: what is small is read without the rest of the file.
 */
export function readDatasetHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const length = Buffer.alloc(16);
    fs.readSync(fd, length, 0, 16, 0);
    const topLength = Number(length.toString('latin1'));
    if (!(topLength > MAGIC.length)) throw new Error('not a dataset');
    const top = Buffer.alloc(topLength);
    if (fs.readSync(fd, top, 0, topLength, 16) !== topLength || top.toString('latin1', 0, MAGIC.length) !== MAGIC) throw new Error('not a dataset');
    const text = top.toString('utf8', MAGIC.length);
    return JSON.parse(text.slice(text.indexOf('\n') + 1), (key, value) => (value && typeof value === 'object' && ('$column' in value || '$lines' in value || '$texts' in value) ? null : value));
  } finally {
    fs.closeSync(fd);
  }
}

/** Reads a dataset written by writeDataset, into memory of this thread alone. */
export function readDataset(file) {
  return datasetFrom(bytesOf(file, false));
}

/** A list of whole numbers that grows as it is filled. */
export class Numbers {
  constructor(size = 1 << 16) {
    this.array = new Int32Array(size);
    this.length = 0;
  }

  push(value) {
    if (this.length === this.array.length) {
      const grown = new Int32Array(this.array.length * 2);
      grown.set(this.array);
      this.array = grown;
    }
    this.array[this.length++] = value;
  }

  /** A copy of what was filled in, of exactly that length. */
  done() {
    return this.array.slice(0, this.length);
  }
}

// What a hash of numbers begins with, and what each number is mixed in with
// (FNV-1a, with two beginnings for the two halves of a key).
const mix = (hash, value) => Math.imul(hash ^ value, 16777619);

/**
 * Lists of numbers of which every different one is stored once: the stop
 * sequences of the trips, their running times, their stop sequence numbers.
 * A list is found again by a hash of its numbers; on a hit the numbers are
 * compared, as two lists may have the same hash.
 */
export class SharedLists {
  /** @param hash for tests: another way from a list (numbers, length) to a key */
  constructor({ hash } = {}) {
    this.values = new Numbers();
    this.start = new Numbers();
    // key -> the list of that key, or several of them
    this.byKey = new Map();
    this.count = 0;
    this.hash = hash ?? ((numbers, length) => {
      let a = 2166136261 | 0;
      let b = 374761393 | 0;
      for (let i = 0; i < length; i++) {
        a = mix(a, numbers[i]);
        b = mix(b, numbers[i] + 0x9e3779b1);
      }
      // (53 bits: a number that is still a whole one, and a key a Map is quick with)
      return (mix(a, length) >>> 0) * 2097152 + ((b >>> 0) & 0x1fffff);
    });
  }

  same(list, numbers, length) {
    const from = this.start.array[list];
    if (this.end(list) - from !== length) return false;
    const { array } = this.values;
    for (let i = 0; i < length; i++) if (array[from + i] !== numbers[i]) return false;
    return true;
  }

  end(list) {
    return list + 1 < this.count ? this.start.array[list + 1] : this.values.length;
  }

  /** The number of the list with the first `length` of `numbers`; it is stored if it is new. */
  add(numbers, length) {
    const key = this.hash(numbers, length);
    const known = this.byKey.get(key);
    if (known !== undefined) {
      if (typeof known === 'number') {
        if (this.same(known, numbers, length)) return known;
      } else {
        for (const list of known) if (this.same(list, numbers, length)) return list;
      }
    }
    const list = this.count++;
    this.start.push(this.values.length);
    for (let i = 0; i < length; i++) this.values.push(numbers[i]);
    if (known === undefined) this.byKey.set(key, list);
    else if (typeof known === 'number') this.byKey.set(key, [known, list]);
    else known.push(list);
    return list;
  }

  /** As columns: where each list begins (and where the last one ends), and the numbers of them all. */
  done() {
    this.start.push(this.values.length);
    const start = this.start.done();
    this.start.length--;
    return { start, values: this.values.done() };
  }
}
