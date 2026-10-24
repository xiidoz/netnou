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

// The server: what it answers a request for the list with, and when.
const server = { requests: [], status: 200, waiting: [] };
globalThis.fetch = (address) => new Promise((resolve) => {
  server.requests.push(address);
  const answer = () => resolve({ ok: server.status === 200, status: server.status, json: async () => structuredClone(list) });
  if (server.hold) server.waiting.push(answer);
  else answer();
});
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
