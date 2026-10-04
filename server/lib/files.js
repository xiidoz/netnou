// File and download helpers shared by the feed updater, the import worker and
// the route geometry.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Text of an error for the log and /api/status. fetch() reports every network
 * problem as "fetch failed" and keeps what happened (DNS, refused connection,
 * certificate, …) in err.cause, so that is added – unless the message quotes
 * its cause already.
 */
export function reason(err) {
  const message = err?.message ?? String(err);
  const cause = err?.cause?.message || err?.cause?.code;
  return cause && !message.includes(cause) ? `${message} (${cause})` : message;
}

/**
 * A URL as it may appear in the log and in API answers: without credentials
 * and query string, which is where a feed's access key would be. Progress and
 * error texts are public (503 answers, /api/status).
 */
export function publicUrl(url) {
  const { origin, pathname } = new URL(url);
  return origin + pathname;
}

/**
 * Downloads `url` into `file`.
 * @returns {Promise<{size: number, headers: Headers}>} bytes written and the response headers
 */
export async function download(url, file, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`GET ${publicUrl(url)}: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
  const size = fs.statSync(file).size;
  // A connection that ends early is not always reported as an error. (With a
  // Content-Encoding the length counts the packed bytes, fetch delivers the
  // unpacked ones.)
  const expected = res.headers.get('content-encoding') ? 0 : Number(res.headers.get('content-length'));
  if (expected && size !== expected) throw new Error(`GET ${publicUrl(url)}: download incomplete (${size} of ${expected} bytes)`);
  return { size, headers: res.headers };
}

/** Reads a gzipped JSON file. */
export function readGz(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
}

/** Writes `value` as gzipped JSON. */
export function writeGz(file, value) {
  // Write-then-rename so a crash never leaves a truncated file behind.
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(JSON.stringify(value)));
  fs.renameSync(tmp, file);
}
