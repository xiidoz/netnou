// A GET for data that has to arrive again and again, made with node:http(s)
// rather than fetch(). fetch() gives up on a connection after ten seconds, a
// limit that cannot be changed without a dependency, and then has nothing to
// show for it. A server that is busy needs longer than that at times, and what
// it needs least is a client that keeps starting over.

import http from 'node:http';
import https from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import zlib from 'node:zlib';
import { publicUrl } from './files.js';

// How long the server may take to pick up. After that the packets asking for
// the connection count as lost and it is asked for again. Once it has picked
// up, a new attempt would only lose the place in its queue: from then on the
// one limit is that of the whole request.
const CONNECT_MS = 10_000;
// Pause before the second attempt to connect; it doubles with every further
// one, up to the longest.
const RETRY_MS = 1000;
const RETRY_MAX_MS = 8000;
const MAX_REDIRECTS = 5;

const megabytes = (bytes) => (bytes / 1e6).toFixed(1);

function unpacked(body, encoding) {
  if (!body.length) return body;
  switch ((encoding ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return zlib.gunzipSync(body);
    case 'br':
      return zlib.brotliDecompressSync(body);
    default:
      return body;
  }
}

/**
 * One request on a connection of its own. An error that says `retry` came
 * before anything of the answer: nothing is lost by asking again.
 * @param {URL} url
 * @param {number} deadline epoch milliseconds
 * @param {number} connectMs
 * @returns {Promise<{status: number, headers: http.IncomingHttpHeaders, body: Buffer}>}
 */
function request(url, headers, deadline, connectMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let stage = 'connecting'; // then 'waiting' for the answer, then 'receiving' it
    let received = 0;
    let expected = 0;
    let connectTimer;

    // (agent: false – no connection is kept for the next request: servers
    // close idle ones after seconds, and one that is just being closed fails)
    const req = (url.protocol === 'https:' ? https : http).get(url, { agent: false, headers });
    const settle = (done, value) => {
      clearTimeout(connectTimer);
      clearTimeout(deadlineTimer);
      done(value);
    };
    const fail = (message, retry, cause) => {
      settle(reject, Object.assign(new Error(message, { cause }), { retry }));
      req.destroy();
    };

    const deadlineTimer = setTimeout(() => {
      const seconds = Math.round((Date.now() - started) / 1000);
      if (stage === 'connecting') fail('connect timeout', true);
      else if (stage === 'waiting') fail(`connected, but no answer after ${seconds} s`, false);
      else fail(`incomplete after ${seconds} s (${megabytes(received)} of ${expected ? megabytes(expected) : '?'} MB)`, false);
    }, Math.max(deadline - started, 0));

    req.on('socket', (socket) => {
      connectTimer = setTimeout(() => fail('connect timeout', true), connectMs);
      // (also for a TLS connection this is the moment the server has picked up, before the handshake)
      socket.once('connect', () => {
        clearTimeout(connectTimer);
        stage = 'waiting';
      });
    });
    req.on('error', (err) => fail(err.message, stage !== 'receiving', err));
    req.on('response', (res) => {
      stage = 'receiving';
      expected = Number(res.headers['content-length']) || 0;
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
      });
      res.on('error', (err) => fail(`connection lost after ${megabytes(received)} MB (${err.message})`, false, err));
      res.on('end', () => {
        // A connection that ends early is not always reported as an error.
        if (!res.complete) return fail(`connection lost after ${megabytes(received)} MB`, false);
        try {
          return settle(resolve, { status: res.statusCode, headers: res.headers, body: unpacked(Buffer.concat(chunks), res.headers['content-encoding']) });
        } catch (err) {
          return fail(`answer cannot be unpacked (${err.message})`, false, err);
        }
      });
    });
  });
}

/**
 * GET of `url`, with the answer as a whole and whatever its status. Redirects
 * are followed. As long as the server has not begun to answer, the connection
 * is tried again; what has begun is waited for. All of that within `timeoutMs`.
 * @param {string} url http or https
 * @param {{headers?: Record<string, string>, timeoutMs: number, connectMs?: number, retryMs?: number}} options
 *   connectMs: how long the server may take to pick up before the connection is tried again;
 *   retryMs: the pause before the second attempt
 * @returns {Promise<{status: number, headers: http.IncomingHttpHeaders, body: Buffer}>} the body unpacked
 */
export async function get(url, { headers = {}, timeoutMs, connectMs = CONNECT_MS, retryMs = RETRY_MS }) {
  const started = Date.now();
  const deadline = started + timeoutMs;
  const failed = (message, cause) => new Error(`GET ${publicUrl(url)}: ${message}`, { cause });
  let target = new URL(url);
  let redirects = 0;
  let attempts = 0;
  let pause = retryMs;

  for (;;) {
    let answer;
    attempts++;
    try {
      answer = await request(target, { 'Accept-Encoding': 'gzip, br', ...headers }, deadline, connectMs);
    } catch (err) {
      if (!err.retry) throw failed(err.message, err);
      if (Date.now() + pause >= deadline) {
        const seconds = Math.round((Date.now() - started) / 1000);
        throw failed(`no answer after ${seconds} s and ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} (${err.message})`, err);
      }
      await sleep(pause);
      pause = Math.min(pause * 2, RETRY_MAX_MS);
      continue;
    }

    const { location } = answer.headers;
    if (![301, 302, 303, 307, 308].includes(answer.status) || !location) return answer;
    if (++redirects > MAX_REDIRECTS) throw failed('too many redirects');
    target = new URL(location, target);
    if (!/^https?:$/.test(target.protocol)) throw failed(`redirected to ${target.protocol} which is not http(s)`);
  }
}
