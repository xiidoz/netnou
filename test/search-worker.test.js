// The thread the page searches in (public/search-worker.js), run here without
// a browser: this file is what the thread has for a page and for a server.
// What a search finds is covered by search.test.js.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchList } from '../server/lib/search-list.js';
import { MODES } from '../server/lib/timetable.js';

const { list } = searchList([
  { name: 'Nürnberg Hbf', lat: 49.44561, lon: 11.08299, service: 13695, modes: ['subway', 'tram', 'bus', 'regional'], town: 0 },
  { name: 'Nürnberg Plärrer', lat: 49.44809, lon: 11.0648, service: 9098, modes: ['subway', 'tram', 'bus'], town: 0 },
  { name: 'Fürth Rathaus', lat: 49.47765, lon: 10.98859, service: 4714, modes: ['subway', 'bus'], town: 1 },
], [
  { name: 'U1', mode: 'subway', agency: 'VerkehrsAG Nürnberg', to: ['Fürth Hardhöhe', 'Langwasser Süd'], lat: 49.44428, lon: 11.05986, service: 1911 },
  { name: '33', mode: 'bus', agency: 'Stadtverkehr Fürth', to: ['Fürth Hauptbahnhof'], lat: 49.48582, lon: 11.03156, service: 296 },
], MODES, [{ name: 'Nürnberg', district: null }, { name: 'Fürth', district: null }]);

// The server: what it answers a request for the list with, and when. Its
// list has a tag (ETag): asked with that one, it answers "not modified". It
// may refuse, as the network does without a connection.
const server = { requests: [], tags: [], status: 200, waiting: [], list, tag: '"list-1"', refuse: false, notModified: 0 };
globalThis.fetch = (address, { headers = {}, signal } = {}) => new Promise((resolve, reject) => {
  server.requests.push(address);
  server.tags.push(headers['If-None-Match'] ?? null);
  signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
  const answer = () => {
    if (server.refuse) return reject(new TypeError('Failed to fetch'));
    if (server.status !== 200) return resolve(new Response('', { status: server.status }));
    if (headers['If-None-Match'] === server.tag) {
      server.notModified += 1;
      return resolve(new Response(null, { status: 304, headers: { ETag: server.tag } }));
    }
    const text = JSON.stringify(server.list);
    // (a list whose first part comes, and the rest only once the test lets it: as on a link that stalls)
    if (server.stall) {
      const body = new ReadableStream({ start(stream) {
        stream.enqueue(new TextEncoder().encode(text.slice(0, 100)));
        server.rest = () => { stream.enqueue(new TextEncoder().encode(text.slice(100))); stream.close(); };
      } });
      return resolve(new Response(body, { headers: { 'Content-Type': 'application/json', ETag: server.tag } }));
    }
    return resolve(new Response(text, { headers: { 'Content-Type': 'application/json', ETag: server.tag } }));
  };
  if (server.hold) server.waiting.push(answer);
  else answer();
});
// The browser: where the thread is (the address it keeps the list under), and its Cache Storage.
globalThis.location = { href: 'https://karte.example.org/search-worker.js' };
const KEPT = 'https://karte.example.org/api/search';
const stored = new Map();
globalThis.caches = {
  async match(address, { cacheName } = {}) {
    assert.equal(cacheName, 'netnou-search');
    const kept = stored.get(String(address));
    return kept ? new Response(kept.body, { headers: kept.headers }) : undefined;
  },
  async open(name) {
    assert.equal(name, 'netnou-search');
    return {
      put: async (address, response) => { stored.set(String(address), { body: await response.text(), headers: [...response.headers] }); },
      delete: async (address) => stored.delete(String(address)),
    };
  },
};
// The page: what the thread tells it.
const answers = [];
const listeners = [];
globalThis.postMessage = (data) => answers.push(data);
globalThis.addEventListener = (type, listener) => {
  assert.equal(type, 'message');
  listeners.push(listener);
};
const warnings = [];
console.warn = (...words) => warnings.push(words.join(' '));

await import('../public/search-worker.js');
const tell = (data) => listeners.forEach((listener) => listener({ data }));
const ask = (turn, query, more = {}) => tell({ turn, query, near: null, limits: { towns: 3, lines: 3, stops: 8 }, modeNames: { subway: 'U-Bahn', bus: 'Bus' }, ...more });
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
async function until(condition, what) {
  for (let waited = 0; !condition(); waited += 2) {
    assert.ok(waited < 5000, `timed out waiting for ${what}`);
    await sleep(2);
  }
}
/** What the thread says next. */
async function answered() {
  const before = answers.length;
  await until(() => answers.length > before, 'an answer');
  assert.equal(answers.length, before + 1);
  return answers.at(-1);
}

test('the first question fetches the list, and every question is answered from it', async () => {
  ask(1, 'nürnberg');
  assert.deepEqual(await answered(), {
    turn: 1,
    // (the town too, with the rectangle around its stations)
    towns: [{ name: 'Nürnberg', box: [49.44561, 11.0648, 49.44809, 11.08299] }],
    lines: [],
    stops: [
      { name: 'Nürnberg Hbf', lat: 49.44561, lon: 11.08299, modes: ['subway', 'tram', 'bus', 'regional'] },
      { name: 'Nürnberg Plärrer', lat: 49.44809, lon: 11.0648, modes: ['subway', 'tram', 'bus'] },
    ],
    // (something typed: nothing suggested)
    nearby: [],
  });
  assert.deepEqual(server.requests, ['api/search']);

  // a line by the name the visitor reads its mode called; as many as are asked for
  ask(2, 'u-bahn 1');
  assert.deepEqual(await answered(), { turn: 2, towns: [], lines: [{ name: 'U1', mode: 'subway', agency: 'VerkehrsAG Nürnberg', to: ['Fürth Hardhöhe', 'Langwasser Süd'], at: [49.44428, 11.05986] }], stops: [], nearby: [] });
  ask(3, 'nürnberg', { limits: { towns: 3, lines: 3, stops: 1 } });
  assert.deepEqual((await answered()).stops.map((stop) => stop.name), ['Nürnberg Hbf']);
  // the nearer one first, for whoever has their position shown
  ask(4, 'nürnberg', { near: { lat: 49.4481, lon: 11.0648 } });
  assert.deepEqual((await answered()).stops.map((stop) => stop.name), ['Nürnberg Plärrer', 'Nürnberg Hbf']);
  // nothing typed: no favourites, and the stations near the map suggested, as many as the list has room for (#257)
  ask(5, '');
  assert.deepEqual(await answered(), {
    turn: 5,
    towns: [],
    lines: [],
    stops: [],
    nearby: [
      { name: 'Nürnberg Hbf', lat: 49.44561, lon: 11.08299, modes: ['subway', 'tram', 'bus', 'regional'] },
      { name: 'Nürnberg Plärrer', lat: 49.44809, lon: 11.0648, modes: ['subway', 'tram', 'bus'] },
      { name: 'Fürth Rathaus', lat: 49.47765, lon: 10.98859, modes: ['subway', 'bus'] },
    ],
  });
  assert.deepEqual(server.requests, ['api/search']);
});

test('of the questions that come in while it is busy, the last one is answered', async () => {
  tell({ forget: true });
  server.hold = true;
  ask(6, 'n');
  await until(() => server.waiting.length, 'the request for the list');
  ask(7, 'nü');
  ask(8, 'fürth');
  server.hold = false;
  server.waiting.splice(0).forEach((answer) => answer());
  const last = await answered();
  assert.equal(last.turn, 8);
  assert.deepEqual(last.stops.map((stop) => stop.name), ['Fürth Rathaus']);
  // (and nothing comes after it for the two that were overtaken)
  await sleep(30);
  assert.equal(answers.at(-1), last);
  assert.equal(server.requests.length, 2);

  // without a wait as well: three at once
  ask(9, 'p');
  ask(10, 'pl');
  ask(11, 'plä');
  assert.deepEqual(await answered(), { turn: 11, towns: [], lines: [], stops: [{ name: 'Nürnberg Plärrer', lat: 49.44809, lon: 11.0648, modes: ['subway', 'tram', 'bus'] }], nearby: [] });
  await sleep(30);
  assert.equal(answers.at(-1).turn, 11);
});

test('a list that cannot be loaded is said to have failed, and the next question tries again', async () => {
  tell({ forget: true });
  // (none kept: see below for a list kept)
  stored.clear();
  server.status = 503;
  const before = server.requests.length;
  ask(12, 'fürth');
  assert.deepEqual(await answered(), { turn: 12, failed: true });
  assert.equal(server.requests.length, before + 1);
  assert.match(warnings.at(-1), /^stops and lines not loaded: Error: HTTP 503$/);

  server.status = 200;
  ask(13, 'fürth');
  assert.deepEqual((await answered()).stops.map((stop) => stop.name), ['Fürth Rathaus']);
  assert.equal(server.requests.length, before + 2);
  // (and from then on the list is there)
  ask(14, 'rathaus');
  assert.equal((await answered()).turn, 14);
  assert.equal(server.requests.length, before + 2);
});

test('told that its list is not the one of the server any more, it fetches the list again', async () => {
  const before = server.requests.length;
  ask(15, 'hbf');
  assert.equal((await answered()).turn, 15);
  assert.equal(server.requests.length, before);
  tell({ forget: true });
  await sleep(10);
  // (being told is no question: nothing is answered)
  assert.equal(answers.at(-1).turn, 15);
  ask(16, 'hbf');
  assert.deepEqual((await answered()).stops.map((stop) => stop.name), ['Nürnberg Hbf']);
  assert.equal(server.requests.length, before + 1);
});

test('with nothing typed, the favourites come first, those on the map before the others, and the stations suggested below them are none of them (#257)', async () => {
  const kept = { stops: [{ name: 'Fürth Rathaus', lat: 49.47765, lon: 10.98859 }, { name: 'Nürnberg Hbf', lat: 49.44561, lon: 11.08299 }], lines: [] };
  // (the map over Nürnberg: the Hbf is on it, Fürth is not)
  ask(17, '', { favourites: kept, view: [49.43, 11.05, 49.46, 11.1] });
  const answer = await answered();
  assert.deepEqual(answer.stops.map((stop) => [stop.name, stop.favourite]), [['Nürnberg Hbf', true], ['Fürth Rathaus', true]]);
  assert.deepEqual(answer.nearby.map((stop) => stop.name), ['Nürnberg Plärrer']);
  // without a view, in the order they were marked
  ask(18, '', { favourites: kept });
  assert.deepEqual((await answered()).stops.map((stop) => stop.name), ['Fürth Rathaus', 'Nürnberg Hbf']);
  // where no stops are wanted, none are suggested either
  ask(19, '', { limits: { towns: 0, lines: 3, stops: 0 } });
  assert.deepEqual((await answered()).nearby, []);
});

// ---------- the list kept (#367) ----------

const names = (answer) => answer.stops.map((stop) => stop.name);

test('the list is kept with its tag; where the network fails, or the server has no timetable yet, the kept one is searched', async () => {
  tell({ forget: true });
  stored.clear();
  ask(30, 'fürth');
  assert.deepEqual(names(await answered()), ['Fürth Rathaus']);
  assert.equal(new Headers(stored.get(KEPT).headers).get('ETag'), '"list-1"');
  // (no connection)
  tell({ forget: true });
  server.refuse = true;
  ask(31, 'plärrer');
  assert.deepEqual(names(await answered()), ['Nürnberg Plärrer']);
  assert.match(warnings.at(-1), /^stops and lines not loaded: TypeError: Failed to fetch$/);
  server.refuse = false;
  // (a server that has no timetable yet, as after a restart)
  tell({ forget: true });
  server.status = 503;
  ask(32, 'hbf');
  assert.deepEqual(names(await answered()), ['Nürnberg Hbf']);
  server.status = 200;
});

test('where the page knows its connection to be lost, the kept list is searched at once, without asking the network', async () => {
  tell({ forget: true });
  const before = server.requests.length;
  ask(33, 'fürth', { lost: true });
  assert.deepEqual(names(await answered()), ['Fürth Rathaus']);
  assert.equal(server.requests.length, before);
});

test('an unchanged list is a short answer: asked for with its tag, the server says that it is not modified', async () => {
  tell({ forget: true });
  const [before, short] = [server.requests.length, server.notModified];
  ask(34, 'u-bahn 1');
  assert.equal((await answered()).lines[0].name, 'U1');
  assert.equal(server.requests.length, before + 1);
  assert.equal(server.tags.at(-1), '"list-1"');
  assert.equal(server.notModified, short + 1);
});

test('a new list, as with a new timetable, takes the place of the kept one', async () => {
  const { list: newer } = searchList([{ name: 'Nürnberg Nordostbahnhof', lat: 49.4689, lon: 11.0945, service: 2000, modes: ['subway'], town: 0 }], [], MODES, [{ name: 'Nürnberg', district: null }]);
  server.list = newer;
  server.tag = '"list-2"';
  tell({ forget: true });
  ask(35, 'nordost');
  assert.deepEqual(names(await answered()), ['Nürnberg Nordostbahnhof']);
  assert.equal(new Headers(stored.get(KEPT).headers).get('ETag'), '"list-2"');
  assert.match(stored.get(KEPT).body, /Nordostbahnhof/);
  server.list = list;
  server.tag = '"list-1"';
});

test('where the network does not begin its answer in time while a list is kept, the kept one is searched', async () => {
  tell({ forget: true });
  server.hold = true;
  ask(36, 'nordost');
  // (after about three seconds)
  const answer = await answered();
  assert.deepEqual(names(answer), ['Nürnberg Nordostbahnhof']);
  server.hold = false;
  server.waiting.splice(0);
});

test('once the connection is back, a list made of the kept one is asked for again, beside the search', async () => {
  // (made of the kept one: no connection)
  tell({ forget: true });
  server.refuse = true;
  ask(37, 'nordost');
  assert.deepEqual(names(await answered()), ['Nürnberg Nordostbahnhof']);
  server.refuse = false;
  const before = server.requests.length;
  // (not at once after the network was found away)
  ask(38, 'nordost');
  await answered();
  assert.equal(server.requests.length, before);
  // (half a minute later: asked again beside the search, which answers from the kept one meanwhile)
  const now = Date.now;
  Date.now = () => now() + 31_000;
  try {
    ask(39, 'plärrer');
    assert.deepEqual(names(await answered()), []);
    await until(() => server.requests.length === before + 1, 'the list asked for again');
    // (the server's, the list of today, searched from then on)
    await sleep(20);
    ask(40, 'plärrer');
    assert.deepEqual(names(await answered()), ['Nürnberg Plärrer']);
  } finally {
    Date.now = now;
  }
});

test('a new list that stalls holds up no search: the kept one is searched after a few seconds, the new one once it is in', async () => {
  const { list: newer } = searchList([{ name: 'Nürnberg Wöhrder Wiese', lat: 49.4508, lon: 11.0874, service: 3000, modes: ['subway'], town: 0 }], [], MODES, [{ name: 'Nürnberg', district: null }]);
  server.list = newer;
  server.tag = '"list-3"';
  server.stall = true;
  tell({ forget: true });
  ask(41, 'plärrer');
  // (the kept one, of today's server: list-1, after about three seconds)
  assert.deepEqual(names(await answered()), ['Nürnberg Plärrer']);
  server.stall = false;
  server.rest();
  await until(() => new Headers(stored.get(KEPT).headers).get('ETag') === '"list-3"', 'the new list kept');
  ask(42, 'wöhrder');
  assert.deepEqual(names(await answered()), ['Nürnberg Wöhrder Wiese']);
  server.list = list;
  server.tag = '"list-1"';
});

test('a kept list that cannot be read is let go of: the whole list in its place, and without a connection the search says it failed', async () => {
  stored.set(KEPT, { body: '{"broken', headers: [['etag', '"list-1"']] });
  tell({ forget: true });
  // (the server's tag the same: "not modified", but the kept one unreadable, so asked for whole)
  ask(43, 'fürth');
  assert.deepEqual(names(await answered()), ['Fürth Rathaus']);
  assert.match(warnings.find((warning) => /kept not read/.test(warning)) ?? '', /^stops and lines kept not read: SyntaxError/);
  assert.equal(new Headers(stored.get(KEPT).headers).get('ETag'), '"list-1"');
  assert.match(stored.get(KEPT).body, /Rathaus/);
  // (without a connection, nothing to search: said, not left waiting)
  stored.set(KEPT, { body: '{"broken', headers: [['etag', '"list-1"']] });
  tell({ forget: true });
  server.refuse = true;
  ask(44, 'fürth', { lost: true });
  assert.deepEqual(await answered(), { turn: 44, failed: true });
  assert.equal(stored.has(KEPT), false);
  server.refuse = false;
});

test('an answer that begins late is not thrown away: the kept list searched meanwhile, the new one taken once it is in', async () => {
  ask(45, 'fürth');
  await answered();
  const { list: newer } = searchList([{ name: 'Nürnberg Maxfeld', lat: 49.4611, lon: 11.0823, service: 3000, modes: ['subway'], town: 0 }], [], MODES, [{ name: 'Nürnberg', district: null }]);
  server.list = newer;
  server.tag = '"list-4"';
  server.hold = true;
  tell({ forget: true });
  ask(46, 'fürth');
  assert.deepEqual(names(await answered()), ['Fürth Rathaus']);
  // (the answer begins only after the kept list was searched)
  server.hold = false;
  server.waiting.splice(0).forEach((answer) => answer());
  await until(() => new Headers(stored.get(KEPT).headers).get('ETag') === '"list-4"', 'the late list kept');
  ask(47, 'maxfeld');
  assert.deepEqual(names(await answered()), ['Nürnberg Maxfeld']);
  server.list = list;
  server.tag = '"list-1"';
});
