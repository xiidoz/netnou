// get() of lib/http.js against local servers that behave like a feed server
// on a good and on a bad day.

import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import { after, test } from 'node:test';
import zlib from 'node:zlib';
import { get } from '../server/lib/http.js';

const servers = [];
after(() => {
  for (const server of servers) {
    server.close();
    server.closeAllConnections();
  }
});

/** A server on a free port of this machine; `handler` answers its requests. */
async function serve(handler, port = 0) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` };
}

/** A port of this machine nothing listens on. */
async function freePort() {
  const { server, port } = await serve(() => {});
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('the answer comes as a whole, with status and headers, and the request carries what was given', async () => {
  const seen = [];
  const { url } = await serve((req, res) => {
    seen.push(req.headers);
    if (req.headers['if-none-match'] === '"v1"') {
      res.writeHead(304, { ETag: '"v1"' });
      return res.end();
    }
    res.writeHead(200, { ETag: '"v1"', 'Content-Type': 'application/octet-stream' });
    res.write('first, ');
    return setTimeout(() => res.end('second'), 20);
  });

  const full = await get(`${url}/feed.pb`, { headers: { 'User-Agent': 'Netnou/test' }, timeoutMs: 5000 });
  assert.equal(full.status, 200);
  assert.equal(full.headers.etag, '"v1"');
  assert.ok(Buffer.isBuffer(full.body));
  assert.equal(full.body.toString(), 'first, second');
  assert.equal(seen[0]['user-agent'], 'Netnou/test');
  assert.equal(seen[0]['accept-encoding'], 'gzip, br');

  const unchanged = await get(`${url}/feed.pb`, { headers: { 'If-None-Match': full.headers.etag }, timeoutMs: 5000 });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body.length, 0);

  // an error status is an answer like any other: what to make of it is the caller's business
  const { url: broken } = await serve((req, res) => {
    res.writeHead(503);
    res.end('busy');
  });
  const refused = await get(broken, { timeoutMs: 5000 });
  assert.deepEqual([refused.status, refused.body.toString()], [503, 'busy']);
});

test('a packed answer is unpacked', async () => {
  const text = 'delays '.repeat(500);
  const { url } = await serve((req, res) => {
    const packed = req.url === '/gzip' ? zlib.gzipSync(text) : req.url === '/br' ? zlib.brotliCompressSync(text) : Buffer.from('not gzip at all');
    res.writeHead(200, { 'Content-Encoding': req.url === '/br' ? 'br' : 'gzip', 'Content-Length': packed.length });
    res.end(packed);
  });
  assert.equal((await get(`${url}/gzip`, { timeoutMs: 5000 })).body.toString(), text);
  assert.equal((await get(`${url}/br`, { timeoutMs: 5000 })).body.toString(), text);
  await assert.rejects(get(`${url}/broken`, { timeoutMs: 5000 }), /^Error: GET http:\/\/127\.0\.0\.1:\d+\/broken: answer cannot be unpacked \(/);
});

test('redirects are followed, but not for ever and not out of http', async () => {
  const { url } = await serve((req, res) => {
    if (req.url === '/moved') res.writeHead(302, { Location: '/here?x=1' });
    else if (req.url === '/loop') res.writeHead(307, { Location: '/loop' });
    else if (req.url === '/file') res.writeHead(301, { Location: 'file:///etc/passwd' });
    else res.writeHead(200);
    res.end(req.url);
  });
  const moved = await get(`${url}/moved`, { timeoutMs: 5000 });
  assert.deepEqual([moved.status, moved.body.toString()], [200, '/here?x=1']);
  await assert.rejects(get(`${url}/loop`, { timeoutMs: 5000 }), /\/loop: too many redirects$/);
  await assert.rejects(get(`${url}/file`, { timeoutMs: 5000 }), /\/file: redirected to file: which is not http\(s\)$/);
});

test('a server that is not there is asked again, and the error says for how long and how often', async () => {
  const port = await freePort();
  const pending = get(`http://127.0.0.1:${port}/feed.pb`, { timeoutMs: 20_000, retryMs: 50 });
  // (on Windows a refused connection takes two seconds to be reported)
  await new Promise((resolve) => setTimeout(resolve, 300));
  await serve((req, res) => res.end('there now'), port);
  assert.equal((await pending).body.toString(), 'there now');

  // The message has no query string, where an access key would be.
  const gone = await freePort();
  await assert.rejects(
    get(`http://127.0.0.1:${gone}/feed.pb?key=secret`, { timeoutMs: 400, retryMs: 50 }),
    (err) => /^GET http:\/\/127\.0\.0\.1:\d+\/feed\.pb: no answer after \d+ s and \d+ attempts? \(.*(ECONNREFUSED|connect timeout)/.test(err.message),
  );
});

test('a server that does not pick up is asked again', async (t) => {
  const { port } = await serve((req, res) => res.end('picked up'));
  // The first two times the address of the host is looked up, nothing comes
  // back: for the request that is a server that does not pick up.
  const lookup = dns.lookup;
  let lookups = 0;
  t.mock.method(dns, 'lookup', (hostname, options, callback) => {
    if (hostname !== 'feed.test') return lookup(hostname, options, callback);
    if (++lookups <= 2) return undefined;
    return options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4);
  });
  const answer = await get(`http://feed.test:${port}/feed.pb`, { timeoutMs: 20_000, connectMs: 100, retryMs: 20 });
  assert.equal(answer.body.toString(), 'picked up');
  assert.equal(lookups, 3);
});

test('a server that has picked up is waited for, and not asked a second time', async () => {
  let connections = 0;
  let requests = 0;
  const { server, url } = await serve((req, res) => {
    requests++;
    if (req.url === '/slow') setTimeout(() => res.end('at last'), 400);
    // (anything else is never answered)
  });
  server.on('connection', () => { connections++; });

  // longer than a connection may take, but it is no longer the connection that takes long
  assert.equal((await get(`${url}/slow`, { timeoutMs: 5000, connectMs: 100, retryMs: 20 })).body.toString(), 'at last');
  assert.deepEqual([connections, requests], [1, 1]);

  await assert.rejects(get(`${url}/silent`, { timeoutMs: 500, connectMs: 100, retryMs: 20 }), /\/silent: connected, but no answer after \d+ s$/);
  assert.deepEqual([connections, requests], [2, 2]);
});

test('an answer that breaks off or does not come to an end fails with what had arrived', async () => {
  let requests = 0;
  const body = Buffer.alloc(3_000_000, 'x');
  const { url } = await serve((req, res) => {
    requests++;
    res.writeHead(200, { 'Content-Length': body.length });
    res.write(body.subarray(0, 1_500_000), () => {
      if (req.url === '/cut') res.destroy();
    });
  });
  await assert.rejects(get(`${url}/cut`, { timeoutMs: 5000, retryMs: 20 }), /\/cut: connection lost after \d\.\d MB/);
  await assert.rejects(get(`${url}/stalled`, { timeoutMs: 500, retryMs: 20 }), /\/stalled: incomplete after \d+ s \(\d\.\d of 3\.0 MB\)$/);
  // the first half is not asked for a second time
  assert.equal(requests, 2);
});
