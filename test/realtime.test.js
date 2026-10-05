// The RealtimePoller against a local feed server that takes its time. What it
// makes of a feed is covered by pipeline.test.js and server.test.js.

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { RealtimePoller } from '../server/lib/realtime.js';
import { encodeFeed } from './helpers.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition, what) {
  for (let waited = 0; !condition(); waited += 5) {
    assert.ok(waited < 10_000, `timed out waiting for ${what}`);
    await sleep(5);
  }
}

const FEED = encodeFeed({ timestamp: 1791148698 });
// As little of a timetable as a feed without trips needs.
const timetable = { tripIndex: new Map(), stopIndex: new Map() };

const upstream = { requests: 0, answers: 0, agents: [], delay: 0, status: 200 };
const server = http.createServer((req, res) => {
  upstream.requests++;
  upstream.agents.push(req.headers['user-agent']);
  setTimeout(() => {
    res.writeHead(upstream.status);
    res.end(FEED, () => { upstream.answers++; });
  }, upstream.delay);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/realtime.pb`;
after(() => {
  server.close();
  server.closeAllConnections();
});

function poller(options) {
  Object.assign(upstream, { requests: 0, answers: 0, agents: [], delay: 0, status: 200 });
  const lines = [];
  const instance = new RealtimePoller({ url, getTimetable: () => timetable, log: (line) => lines.push(line), userAgent: 'Netnou/test', ...options });
  return { instance, lines, stop: () => clearInterval(instance.timer) };
}

test('a fetch that takes longer than the interval is waited for, and the turns in between are left out', async () => {
  const { instance, lines, stop } = poller({ intervalMs: 40, idleMs: 60_000 });
  upstream.delay = 400;
  instance.touch();
  await sleep(200);
  // several turns have come and gone, and the first fetch is still the only one
  assert.equal(upstream.requests, 1);
  assert.equal(instance.snapshot, null);
  await until(() => instance.snapshot, 'the slow answer');
  stop();
  assert.equal(instance.status.feedTimestamp, 1791148698);
  assert.equal(instance.status.error, null);
  assert.equal(instance.status.failures, 0);
  assert.equal(instance.status.fetches, upstream.requests);
  assert.equal(upstream.agents[0], 'Netnou/test');
  assert.deepEqual(lines, ['Realtime: polling started']);
});

test('a failed fetch is counted and named, and the next turn tries again', async () => {
  const { instance, lines, stop } = poller({ intervalMs: 200, idleMs: 60_000 });
  upstream.status = 503;
  instance.touch();
  await until(() => instance.status.failures, 'the failure');
  assert.match(instance.status.error, /^GET http:\/\/127\.0\.0\.1:\d+\/realtime\.pb: HTTP 503$/);
  assert.equal(lines.at(-1), `Realtime: update failed: ${instance.status.error}`);
  assert.equal(instance.snapshot, null);

  upstream.status = 200;
  await until(() => instance.snapshot, 'the next turn');
  stop();
  assert.equal(instance.status.error, null);
  assert.deepEqual([instance.status.fetches, instance.status.failures], [2, 1]);
});

test('what arrives after the polling was paused is not used', async () => {
  const { instance, lines } = poller({ intervalMs: 50, idleMs: 60 });
  upstream.delay = 300;
  instance.touch();
  await until(() => upstream.answers, 'the answer');
  await sleep(50);
  assert.equal(upstream.requests, 1);
  assert.equal(instance.status.polling, false);
  assert.equal(instance.timer, null);
  assert.equal(instance.snapshot, null);
  assert.equal(instance.status.fetchedAt, null);
  assert.deepEqual(lines, ['Realtime: polling started', 'Realtime: no requests any more, polling paused']);
});
