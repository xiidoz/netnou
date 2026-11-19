// The service worker (public/sw.js, #362, #363), run as a browser runs it:
// with its cache storage, the network, the pages and workers it serves, and
// its clock played in memory. A start waits for the network's page about as
// long as the network usually takes (startLimit): here until the test lets
// that time pass (advance).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { serviceWorker } from '../server/lib/page.js';

const SCOPE = 'https://karte.example.org/';
// The map's server, and the style of the map (NETNOU_MAP_STYLE_URL) as the server writes it into the service worker.
const MAP = 'https://tiles.example.org';
const STYLE = `${MAP}/styles/bright`;
const START = 3000;
const LATE = 60_000;
const source = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
/**
 * What a promise has come to within `ms` of real time: `settled` where it
 * has, `late` otherwise (the timer goes as soon as it is not needed, so that
 * none keeps the tests running once they are done).
 */
const within = (promise, ms, settled = true, late = false) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(late), ms);
  Promise.resolve(promise).then(() => settled, () => settled).then((value) => {
    clearTimeout(timer);
    resolve(value);
  });
});
/** Whether a promise settles within `ms` of real time, without the worker's clock moving. */
const settles = (promise, ms = 100) => within(promise, ms);

/** The page as the server sends it, of a version. */
const pageOf = (version) => `<!DOCTYPE html>\n<html lang="de">\n<head>\n  <meta charset="utf-8">\n  <meta name="netnou-page-version" content="${version}">\n  <title>Netnou</title>\n</head>\n<body></body>\n</html>\n`;
const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', Vary: 'Accept-Language', 'Content-Security-Policy': "default-src 'self'" };

/** The cache storage of the browser, kept across runs of the worker. */
function cacheStorage() {
  const named = new Map();
  const keyOf = (request, ignoreSearch = false) => {
    const url = new URL(typeof request === 'string' ? request : request.url);
    if (ignoreSearch) url.search = '';
    return url.href;
  };
  const storage = {
    named,
    fetch: null,
    async open(name) {
      if (!named.has(name)) named.set(name, cacheOf());
      return named.get(name);
    },
    async keys() {
      return [...named.keys()];
    },
    async delete(name) {
      return named.delete(name);
    },
    async has(name) {
      return named.has(name);
    },
    async match(request, { cacheName, ...options } = {}) {
      for (const [name, cache] of named) {
        if (cacheName !== undefined && name !== cacheName) continue;
        const found = await cache.match(request, options);
        if (found) return found;
      }
      return undefined;
    },
    /** What a cache holds for an address, as text, or null. */
    async text(name, address) {
      const found = await named.get(name)?.match(new URL(address, SCOPE).href);
      return found ? found.text() : null;
    },
  };
  function cacheOf() {
    const entries = new Map();
    const cache = {
      entries,
      async match(request, { ignoreSearch = false } = {}) {
        const key = keyOf(request, ignoreSearch);
        for (const [url, kept] of entries) if (keyOf(url, ignoreSearch) === key) return new Response(kept.body, { status: kept.status, headers: kept.headers });
        return undefined;
      },
      async put(request, response) {
        entries.set(keyOf(request), { status: response.status, headers: [...response.headers], body: new Uint8Array(await response.arrayBuffer()) });
      },
      async addAll(requests) {
        const answers = await Promise.all(requests.map((request) => storage.fetch({ url: new URL(request, SCOPE).href, method: 'GET', mode: 'cors', destination: '' })));
        if (answers.some((answer) => !answer.ok)) throw new TypeError('addAll: not ok');
        await Promise.all(requests.map((request, i) => cache.put(new URL(request, SCOPE).href, answers[i])));
      },
      async keys() {
        return [...entries.keys()].map((url) => ({ url }));
      },
      async delete(request) {
        return entries.delete(keyOf(request));
      },
    };
    return cache;
  }
  return storage;
}

/**
 * The network, as a server of a version answers: `mode` 'answer' at once,
 * 'delay' after `delay` ms of the worker's clock,
 * 'late' once the test releases it, 'hang' never, 'refuse' with an error,
 * 'error' with a 502 of a proxy whose server is down, 'stall' with the
 * headers of a page whose text never comes.
 */
function network() {
  const net = { mode: 'answer', version: 'v2', delay: 0, asked: [], besides: '', held: [], later: null };
  net.release = () => { for (const answer of net.held.splice(0)) answer(); };
  net.fetch = (request) => {
    const url = new URL(request.url);
    const path = url.pathname.slice(1) || './';
    net.asked.push(path);
    const [version, besides] = [net.version, net.besides];
    const answer = () => (path === './' || /^(stop|line|trip)\//.test(path)
      ? new Response(pageOf(version) + besides, { headers: PAGE_HEADERS })
      : new Response(`// ${path} of ${version}\n`, { headers: { 'Content-Type': 'text/javascript' } }));
    switch (net.mode) {
      case 'refuse': return Promise.reject(new TypeError('Failed to fetch'));
      case 'hang': return new Promise(() => {});
      case 'late': return new Promise((resolve) => net.held.push(() => resolve(answer())));
      case 'delay': return new Promise((resolve) => net.later(() => resolve(answer()), net.delay));
      case 'error': return Promise.resolve(new Response('<h1>502 Bad Gateway</h1>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
      case 'stall': return Promise.resolve(new Response(new ReadableStream({ start() {} }), { headers: PAGE_HEADERS }));
      default: return Promise.resolve(answer());
    }
  };
  return net;
}

/** A run of the service worker of a version: as the browser starts it, and starts it again after stopping it. */
function run(version, storage, net, open = new Set(), mapStyle = STYLE) {
  const handlers = {};
  const self = {
    registration: { scope: SCOPE, updates: 0, async update() { this.updates += 1; } },
    clients: { async matchAll() { return [...open].map((id) => ({ id })); }, async claim() {} },
    async skipWaiting() {},
    addEventListener: (type, handler) => { handlers[type] = handler; },
  };
  // (its clock, which moves when the test lets time pass: its timers run then, in their order)
  const clock = { now: 1_800_000_000_000, timers: [] };
  const timers = {
    setTimeout: (fn, ms = 0, ...args) => {
      const timer = { at: clock.now + ms, run: () => fn(...args) };
      clock.timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      if (clock.timers.includes(timer)) clock.timers.splice(clock.timers.indexOf(timer), 1);
    },
  };
  storage.fetch = net.fetch;
  net.later = timers.setTimeout;
  vm.runInNewContext(serviceWorker(source, version, mapStyle), { self, caches: storage, fetch: (request, options) => net.fetch(request, options), ...timers, Date: { now: () => clock.now }, TextDecoder, ReadableStream, Response, Headers, URL, console });
  /** Dispatches an event: what it answers (respondWith) and all it does besides (waitUntil). */
  const dispatch = (type, fields = {}) => {
    const waits = [];
    let answer = null;
    handlers[type]({ ...fields, respondWith: (promise) => { answer = promise; }, waitUntil: (promise) => { waits.push(promise); } });
    // (all it does besides: what waits for its clock, once the test has let the time pass; a few seconds at most, so that a test that has not does not stand still)
    return { answer, waits, done: () => within(Promise.all(waits.map((one) => Promise.resolve(one).catch(() => {}))), 5000) };
  };
  return {
    self,
    open,
    /** Lets `ms` pass on its clock: the timers due by then run, in their order, each once what came before it has. */
    async advance(ms) {
      const until = clock.now + ms;
      for (;;) {
        // (what is under way meanwhile, as reading the cache, gets as far as it gets without the clock)
        for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
        const due = clock.timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock.timers.splice(clock.timers.indexOf(due), 1);
        clock.now = due.at;
        due.run();
      }
      clock.now = until;
    },
    /** An event of its life, as the browser dispatches it: 'install' or 'activate'. */
    event: (type) => dispatch(type),
    /** Installs it, and where that succeeds, activates it, as the browser does: whether it did. */
    async install() {
      const installing = dispatch('install');
      if (!(await Promise.all(installing.waits).then(() => true, () => false))) return false;
      await dispatch('activate').done();
      return true;
    },
    /** A start at `path` (the page, or the address of details), for a page that gets the id `id`. */
    start(path, id) {
      return dispatch('fetch', { request: { url: new URL(path, SCOPE).href, method: 'GET', mode: 'navigate', destination: 'document' }, clientId: '', resultingClientId: id });
    },
    /** A file asked for by the page or worker `id`; a worker it starts gets the id `starts`. */
    file(path, id, { starts = '', destination = 'script' } = {}) {
      return dispatch('fetch', { request: { url: new URL(path, SCOPE).href, method: 'GET', mode: 'cors', destination }, clientId: id, resultingClientId: starts });
    },
    message(id, data) {
      return dispatch('message', { data, source: { id } });
    },
    other(url) {
      return dispatch('fetch', { request: { url, method: 'GET', mode: 'cors', destination: '' }, clientId: 'a', resultingClientId: '' });
    },
  };
}

/** A browser with version `version` of the service worker installed, its files kept. */
async function installed(version = 'v2', mapStyle = STYLE) {
  const storage = cacheStorage();
  const net = network();
  net.version = version;
  const worker = run(version, storage, net, new Set(), mapStyle);
  await worker.install();
  net.asked = [];
  return { storage, net, worker };
}

const text = async (event) => (await event.answer).text();
const KEPT = 'netnou-shell / v2';

test('the files of a version are kept together, in a cache of that version and instance; older ones go, other instances and apps keep theirs', async () => {
  const storage = cacheStorage();
  const net = network();
  net.version = 'v1';
  await run('v1', storage, net).install();
  await (await storage.open('other-app')).put(`${SCOPE}other/app.js`, new Response('other'));
  await (await storage.open('netnou-shell /muenchen/ v1')).put(`${SCOPE}muenchen/app.js`, new Response('another instance'));
  // (the one cache of all versions before #363)
  await (await storage.open('netnou-shell-v6')).put(`${SCOPE}app.js`, new Response('before'));
  net.version = 'v2';
  await run('v2', storage, net).install();
  assert.deepEqual([...storage.named.keys()].sort(), ['netnou-shell / v2', 'netnou-shell /muenchen/ v1', 'netnou-sources /', 'other-app']);
  assert.equal(await storage.text(KEPT, 'app.js'), '// app.js of v2\n');
  assert.match(await storage.text(KEPT, './'), /content="v2"/);
  assert.ok(storage.named.get(KEPT).entries.size > 20);
});

test('a service worker whose files came from a newer version is not installed: the next check of the browser gets that one', async () => {
  const storage = cacheStorage();
  const net = network();
  net.version = 'v3';
  assert.equal(await run('v2', storage, net).install(), false);
  assert.deepEqual([...storage.named.keys()], []);
});

test('a service worker whose files were let go of while it was installed is not installed either', async () => {
  const storage = cacheStorage();
  const net = network();
  const fetching = net.fetch;
  // (the worker in charge, which did not know of this one yet, lets go of its cache while its files come)
  net.fetch = (request) => {
    if (request.url.endsWith('icons.js')) storage.named.delete('netnou-shell / v2');
    return fetching(request);
  };
  assert.equal(await run('v2', storage, net).install(), false);
});

test('a start that the network answers in time is the network page; of the kept version, its files are the kept ones', async () => {
  const { net, worker, storage } = await installed();
  net.besides = '<!-- written now -->';
  const started = worker.start('./', 'page');
  assert.doesNotMatch(await text(started), /netnou-kept/);
  assert.equal(await text(worker.file('app.js', 'page')), '// app.js of v2\n');
  await started.done();
  assert.deepEqual(net.asked, ['./']);
  // (the page at the map, kept anew)
  assert.match(await storage.text(KEPT, './'), /<!-- written now -->$/);
});

test('a start that the network answers in time with a newer version takes its files from the network alone, and has the browser look for the newer worker', async () => {
  const { net, worker, storage } = await installed();
  net.version = 'v3';
  const started = worker.start('./', 'page');
  assert.match(await text(started), /content="v3"/);
  assert.equal(await text(worker.file('app.js', 'page')), '// app.js of v3\n');
  await started.done();
  assert.equal(worker.self.registration.updates, 1);
  assert.match(await storage.text(KEPT, './'), /content="v2"/);
  // (never another version's file: without the network, none)
  net.mode = 'refuse';
  await assert.rejects(worker.file('search.js', 'page').answer);
});

test('a start that the network does not answer within the limit is the kept page, marked; its files and its workers\' are the kept ones', async () => {
  const { net, worker } = await installed();
  net.mode = 'hang';
  const started = worker.start('stop/nuernberg-plaerrer', 'page');
  assert.equal(await settles(started.answer), false);
  await worker.advance(START);
  const page = await text(started);
  assert.match(page, /<meta charset="utf-8">\n {2}<base href="\.\.\/">\n {2}<meta name="netnou-kept" content="">\n {2}<meta name="netnou-page-version" content="v2">/);
  assert.equal((await started.answer).headers.get('Content-Security-Policy'), "default-src 'self'");
  // (without asking the network, so without waiting for it)
  assert.equal(await text(worker.file('app.js', 'page')), '// app.js of v2\n');
  assert.equal(await text(worker.file('search-worker.js', 'page', { starts: 'worker', destination: 'worker' })), '// search-worker.js of v2\n');
  assert.equal(await text(worker.file('search.js', 'worker')), '// search.js of v2\n');
  assert.deepEqual(net.asked, ['stop/nuernberg-plaerrer']);
});

test('a start that the network refuses, or that a server behind it fails with a 5xx, is the kept page at once', async () => {
  const { net, worker, storage } = await installed();
  const before = await storage.text(KEPT, './');
  for (const mode of ['refuse', 'error']) {
    net.mode = mode;
    const started = worker.start('./?lang=en', `page-${mode}`);
    assert.ok(await settles(started.answer, 2000), mode);
    assert.match(await text(started), /<meta charset="utf-8">\n {2}<meta name="netnou-kept" content="">\n/, mode);
    await started.done();
  }
  assert.equal(await storage.text(KEPT, './'), before);
  assert.equal(worker.self.registration.updates, 0);
});

test('the page the network sends too late is kept for the next start, where it is of the kept version and at the map', async () => {
  const { net, worker, storage } = await installed();
  net.mode = 'late';
  net.besides = '<!-- written later -->';
  const late = worker.start('./', 'page');
  await worker.advance(START);
  assert.doesNotMatch(await text(late), /written later/);
  net.release();
  await late.done();
  assert.match(await storage.text(KEPT, './'), /<!-- written later -->$/);
  // (not the page at an address of details, nor one whose address asks for more)
  for (const [path, besides] of [['stop/nuernberg-plaerrer', '<!-- at a stop -->'], ['./?board=a', '<!-- a board -->']]) {
    net.besides = besides;
    const started = worker.start(path, path);
    await worker.advance(START);
    await text(started);
    net.release();
    await started.done();
  }
  assert.match(await storage.text(KEPT, './'), /<!-- written later -->$/);
  assert.equal(worker.self.registration.updates, 0);
  // (a newer version, late: not kept, the browser looks for its worker)
  net.version = 'v3';
  const newer = worker.start('./', 'page3');
  await worker.advance(START);
  assert.match(await text(newer), /content="v2"/);
  net.release();
  await newer.done();
  assert.equal(worker.self.registration.updates, 1);
  assert.match(await storage.text(KEPT, './'), /content="v2"/);
});

test('where the browser has stopped the service worker meanwhile, a page started from the kept one still takes its files from there', async () => {
  const { storage, net, worker } = await installed();
  net.mode = 'hang';
  worker.open.add('page');
  const started = worker.start('./', 'page');
  await worker.advance(START);
  await text(started);
  await worker.advance(LATE);
  await started.done();
  // (a while later the search is opened: by a worker started anew, which knows nothing of the page but what it stored)
  const again = run('v2', storage, net, worker.open);
  assert.equal(await text(again.file('search.js', 'page')), '// search.js of v2\n');
  assert.deepEqual(net.asked, ['./']);
});

test('a page of an older version than a newer worker installed meanwhile takes its files from its own version, kept while it is open', async () => {
  const { storage, net, worker } = await installed('v1');
  net.mode = 'hang';
  worker.open.add('page');
  const started = worker.start('./', 'page');
  await worker.advance(START);
  assert.match(await text(started), /content="v1"/);
  await worker.advance(LATE);
  await started.done();
  // (a newer version is deployed, and its worker installed: it serves the page from now on)
  net.mode = 'answer';
  net.version = 'v2';
  const newer = run('v2', storage, net, worker.open);
  await newer.install();
  assert.ok(storage.named.has('netnou-shell / v1'));
  // (the page opens its search: the worker and what it imports are of the page's version, with the network and without)
  worker.open.add('worker');
  assert.equal(await text(newer.file('search-worker.js', 'page', { starts: 'worker', destination: 'worker' })), '// search-worker.js of v1\n');
  assert.equal(await text(newer.file('search.js', 'worker')), '// search.js of v1\n');
  net.mode = 'refuse';
  assert.equal(await text(newer.file('nearby.js', 'worker')), '// nearby.js of v1\n');
  // (once it is closed, the next version to take over lets go of its files, and of those of the version before it)
  worker.open.clear();
  net.mode = 'answer';
  net.version = 'v3';
  await run('v3', storage, net, worker.open).install();
  assert.deepEqual([...storage.named.keys()].filter((name) => name.startsWith('netnou-shell')), ['netnou-shell / v3']);
});

test('a worker lets go of no other version\'s files while a newer one waits to take over, nor as it takes over while a newer one is on its way', async () => {
  const { storage, net, worker } = await installed('v1');
  // (the newer one is installed, and waits until the older one has done what it is doing, which goes on)
  net.version = 'v2';
  const newer = run('v2', storage, net, worker.open);
  await newer.event('install').done();
  worker.self.registration.waiting = {};
  net.mode = 'hang';
  worker.open.add('page');
  const started = worker.start('./', 'page');
  await worker.advance(START);
  await text(started);
  await worker.file('search-worker.js', 'page', { starts: 'worker', destination: 'worker' }).done();
  assert.ok(storage.named.has('netnou-shell / v2'));
  // (it takes over while a still newer one is being installed: that one lets go of what is to go)
  worker.open.clear();
  newer.self.registration.installing = {};
  await newer.event('activate').done();
  assert.deepEqual([...storage.named.keys()].filter((name) => name.startsWith('netnou-shell')).sort(), ['netnou-shell / v1', 'netnou-shell / v2']);
});

test('a page that the service worker did not start says which version it is, and takes its files from that one', async () => {
  const { net, worker } = await installed();
  await worker.message('first', { pageVersion: 'v2' }).done();
  net.version = 'v3';
  assert.equal(await text(worker.file('search.js', 'first')), '// search.js of v2\n');
  assert.deepEqual(net.asked, []);
});

test('a file for a page that the service worker does not know comes from the network, and from the kept ones where the network does not answer in time', async () => {
  const { net, worker } = await installed();
  net.version = 'v3';
  assert.equal(await text(worker.file('search.js', 'stranger')), '// search.js of v3\n');
  net.mode = 'hang';
  const asked = worker.file('nearby.js', 'stranger');
  assert.equal(await settles(asked.answer), false);
  await worker.advance(START);
  assert.equal(await text(asked), '// nearby.js of v2\n');
});

test('a page whose text stalls before it names its version holds nothing up: it counts as not known, and what comes after is stored', async () => {
  const { storage, net, worker } = await installed();
  net.mode = 'stall';
  const stalled = worker.start('./', 'stalled');
  assert.equal((await stalled.answer).status, 200);
  net.mode = 'hang';
  worker.open.add('later');
  const later = worker.start('./', 'later');
  await settles(later.answer);
  await worker.advance(START);
  await text(later);
  await worker.advance(LATE);
  await later.done();
  const again = run('v2', storage, net, worker.open);
  assert.equal(await text(again.file('search.js', 'later')), '// search.js of v2\n');
  assert.ok(!net.asked.includes('search.js'));
  // (the stalled one, once START_MS has passed: as one not known)
  net.mode = 'answer';
  net.version = 'v3';
  assert.equal(await text(worker.file('app.js', 'stalled')), '// app.js of v3\n');
});

test('live data, the map and what is not the page\'s are not the service worker\'s', async () => {
  const { worker } = await installed();
  assert.equal(worker.other(`${SCOPE}api/vehicles`).answer, null);
  assert.equal(worker.other('https://tiles.example.org/styles/liberty').answer, null);
  assert.equal(worker.other(`${SCOPE}robots.txt`).answer, null);
});

test('a start waits for the network twice as long as its page took at the slowest of the last five starts: at least ¾ s, at most 3 s, 3 s while that is not known', async () => {
  const { storage, net, worker } = await installed();
  /** A start on a network that hangs: whether its kept page has come one ms before `ms` have passed, and once they have. */
  const waits = async (ms) => {
    net.mode = 'hang';
    const started = worker.start('./', `hang-${ms}`);
    await settles(started.answer, 20);
    await worker.advance(ms - 1);
    const before = await settles(started.answer, 20);
    await worker.advance(1);
    const after = await settles(started.answer, 20);
    await worker.advance(LATE);
    await started.done();
    return [before, after];
  };
  /** Starts whose page comes after `ms`, in time or too late for them. */
  const starts = async (ms, count) => {
    net.mode = 'delay';
    net.delay = ms;
    for (let i = 0; i < count; i++) {
      const started = worker.start('./', `at-${ms}-${i}`);
      await settles(started.answer, 20);
      await worker.advance(ms);
      await text(started);
      await started.done();
    }
  };
  assert.deepEqual(await waits(START), [false, true]);
  await starts(500, 3);
  assert.deepEqual(await waits(1000), [false, true]);
  // (the slowest of the last five: while one of 500 ms is among them, still 1 s)
  await starts(100, 4);
  assert.deepEqual(await waits(1000), [false, true]);
  await starts(100, 1);
  assert.deepEqual(await waits(750), [false, true]);
  // (a link that has become slow: its pages come too late for their starts, and count for the next ones' wait, up to 3 s)
  await starts(2000, 3);
  assert.deepEqual(await waits(START), [false, true]);
  // (a server that fails says nothing of the link)
  net.mode = 'error';
  await worker.start('./', 'down').done();
  // (and what is known stays when the browser stops the worker)
  const again = run('v2', storage, net, worker.open);
  net.mode = 'hang';
  const started = again.start('./', 'again');
  await settles(started.answer, 20);
  await again.advance(START - 1);
  assert.equal(await settles(started.answer, 20), false);
  await again.advance(1);
  assert.match(await text(started), /netnou-kept/);
});

test('a start waits three seconds at most for the network, and its page a minute more to be kept', () => {
  assert.match(source, /const START_MS = 3000;/);
  assert.match(source, /const START_MIN_MS = 750;/);
  assert.match(source, /const LATE_MS = 60_000;/);
});

// ---------- the map (#366) ----------

/** A style of the map as OpenFreeMap's: a list of tiles (TileJSON), tiles of its own besides, icons and fonts. */
const styleOf = (icons = 'sprites/v1/ofm') => ({ version: 8, sources: { omt: { type: 'vector', url: `${MAP}/planet` }, shade: { type: 'raster', tiles: [`${MAP}/shade/{z}/{x}/{y}.png`] } }, sprite: `${MAP}/${icons}`, glyphs: `${MAP}/fonts/{fontstack}/{range}.pbf`, layers: [] });
const MAP_FILES = [`${MAP}/planet`, `${MAP}/sprites/v1/ofm@2x.json`, `${MAP}/sprites/v1/ofm@2x.png`, `${MAP}/fonts/Noto%20Sans%20Regular/0-255.pbf`];
const TILE = `${MAP}/planet/20261115/14/8712/5600.pbf`;

/**
 * The map's server beside the network of the page: `mode` as the network's
 * ('answer', 'refuse', 'hang', 'error'), each answer with the tag `tag`; what
 * was asked, with the browser's cache it was asked from where not the usual.
 */
function withMap(net) {
  const page = net.fetch;
  const map = { mode: 'answer', style: styleOf(), tag: 'one', asked: [] };
  net.fetch = (request, options = {}) => {
    const url = typeof request === 'string' ? request : request.url;
    if (!url.startsWith(MAP)) return page(request, options);
    map.asked.push(url.slice(MAP.length) + (options.cache ? ` (${options.cache})` : ''));
    const body = url === STYLE ? JSON.stringify(map.style) : url.endsWith('/planet') ? '{"tiles":[]}' : `${url.slice(MAP.length)} ${map.tag}`;
    switch (map.mode) {
      case 'refuse': return Promise.reject(new TypeError('Failed to fetch'));
      case 'hang': return new Promise(() => {});
      case 'error': return Promise.resolve(new Response('', { status: 502 }));
      default: return Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json', ETag: `"${map.tag}"` } }));
    }
  };
  return map;
}

const MAP_KEPT = 'netnou-map /';
const mapText = async (storage, url) => (await (await storage.open(MAP_KEPT)).match(url))?.text() ?? null;

/** The map's start as a page asks for it: the style, then what it names, each answered and done. */
async function mapStart(worker) {
  for (const url of [STYLE, ...MAP_FILES]) {
    const asked = worker.other(url);
    assert.ok(asked.answer, url);
    await asked.answer;
    await asked.done();
  }
}

test('what the map needs to start is kept as it asks for it: the style and what that names, not the tiles', async () => {
  const { storage, net, worker } = await installed();
  const map = withMap(net);
  // (none yet: none made)
  assert.equal(storage.named.has(MAP_KEPT), false);
  await mapStart(worker);
  assert.equal(JSON.parse(await mapText(storage, STYLE)).sprite, `${MAP}/sprites/v1/ofm`);
  for (const url of MAP_FILES) assert.ok(await mapText(storage, url), url);
  // (the tiles are the browser's cache's, as before: not asked through the service worker)
  assert.equal(worker.other(TILE).answer, null);
  assert.equal(worker.other(`${MAP}/shade/3/4/2.png`).answer, null);
  assert.equal(storage.named.get(MAP_KEPT).entries.size, 5);
  assert.deepEqual(map.asked, ['/styles/bright', '/planet', '/sprites/v1/ofm@2x.json', '/sprites/v1/ofm@2x.png', '/fonts/Noto%20Sans%20Regular/0-255.pbf']);
});

test('where the map\'s server fails, or a server behind it, the files kept come at once; where it hangs, after the time a start waits', async () => {
  const { storage, net, worker } = await installed();
  const map = withMap(net);
  await mapStart(worker);
  map.tag = 'two';
  map.mode = 'refuse';
  assert.match(await text(worker.other(MAP_FILES[3])), / one$/);
  map.mode = 'error';
  assert.match(await text(worker.other(MAP_FILES[1])), / one$/);
  // (a worker started again: what it keeps it reads first, also what the style names)
  const again = run('v2', storage, net);
  map.mode = 'hang';
  const style = again.other(STYLE);
  assert.ok(style.answer);
  assert.equal(await settles(style.answer), false);
  await again.advance(START);
  assert.equal(JSON.parse(await text(style)).sprite, `${MAP}/sprites/v1/ofm`);
  // (the network found away: the next file at once, without waiting again)
  const list = again.other(MAP_FILES[0]);
  assert.equal(await settles(list.answer), true);
  // (a file that none has kept: as the browser would have it)
  map.mode = 'refuse';
  await assert.rejects(again.other(`${MAP}/fonts/Noto%20Sans%20Bold/0-255.pbf`).answer);
});

test('a start without the network has the map\'s files come from those kept at once; one with it, from the network first', async () => {
  const { storage, net, worker } = await installed();
  const map = withMap(net);
  await mapStart(worker);
  net.mode = 'refuse';
  map.mode = 'hang';
  assert.match(await text(worker.start('./', 'p1')), /netnou-kept/);
  const style = worker.other(STYLE);
  assert.equal(await settles(style.answer), true);
  // (the network back: a start that has its page in time, and the map's server answering, gives the network's files again)
  net.mode = 'answer';
  map.mode = 'answer';
  map.tag = 'two';
  await worker.start('./', 'p2').answer;
  assert.match(await text(worker.other(MAP_FILES[3])), / two$/);
  // (and keeps them in place of the old ones; a file the same as kept, by its tag, is not written again)
  await worker.other(MAP_FILES[3]).done();
  assert.match(await mapText(storage, MAP_FILES[3]), / two$/);
});

test('the map\'s answer that comes too late for its file is kept for the next time', async () => {
  const { storage, net, worker } = await installed();
  const map = withMap(net);
  await mapStart(worker);
  map.tag = 'two';
  const held = [];
  const page = net.fetch;
  net.fetch = (request, options) => (typeof request !== 'string' && request.url === MAP_FILES[3] ? new Promise((resolve) => held.push(() => resolve(page(request, options)))) : page(request, options));
  const font = worker.other(MAP_FILES[3]);
  await worker.advance(START);
  assert.match(await text(font), / one$/);
  for (const answer of held) answer();
  await font.done();
  assert.match(await mapText(storage, MAP_FILES[3]), / two$/);
});

test('a new style keeps what it names and lets go of what it no longer does, as the icons of its older version', async () => {
  const { storage, net, worker } = await installed();
  const map = withMap(net);
  await mapStart(worker);
  map.style = styleOf('sprites/v2/ofm');
  map.tag = 'two';
  const style = worker.other(STYLE);
  await style.answer;
  await style.done();
  assert.equal(await mapText(storage, `${MAP}/sprites/v1/ofm@2x.png`), null);
  assert.ok(await mapText(storage, `${MAP}/planet`));
  // (the new icons are its own now)
  assert.ok(worker.other(`${MAP}/sprites/v2/ofm@2x.png`).answer);
  assert.equal(worker.other(`${MAP}/sprites/v1/ofm@2x.png`).answer, null);
});

test('the files of the map a page fetched before the worker served it are kept, from the browser\'s cache; of the style\'s only', async () => {
  const { storage, net, worker } = await installed();
  const map = withMap(net);
  const told = worker.message('first', { mapFiles: [`${SCOPE}api/area`, STYLE, ...MAP_FILES, TILE, 'https://elsewhere.example.org/x.js'] });
  await told.done();
  assert.equal(storage.named.get(MAP_KEPT).entries.size, 5);
  assert.ok(map.asked.every((asked) => asked.endsWith(' (force-cache)')));
  assert.equal(map.asked.some((asked) => asked.includes('5600.pbf')), false);
  // (what is kept is not asked again)
  map.asked = [];
  await worker.message('first', { mapFiles: [STYLE, ...MAP_FILES] }).done();
  assert.deepEqual(map.asked, []);
  // (and a list without the style is none: what else to keep, the style says)
  const other = await installed();
  withMap(other.net);
  await other.worker.message('x', { mapFiles: MAP_FILES }).done();
  assert.equal(other.storage.named.has(MAP_KEPT), false);
});

test('with raster tiles, which the page draws without a style, nothing of the map is the service worker\'s', async () => {
  const { storage, net, worker } = await installed('v2', null);
  withMap(net);
  assert.equal(worker.other(STYLE).answer, null);
  await worker.message('first', { mapFiles: [STYLE, ...MAP_FILES] }).done();
  assert.equal(storage.named.has(MAP_KEPT), false);
});

test('the files of the map stay as a new version of the page takes over', async () => {
  const { storage, net, worker } = await installed();
  withMap(net);
  await mapStart(worker);
  net.version = 'v3';
  assert.equal(await run('v3', storage, net).install(), true);
  assert.ok(storage.named.has(MAP_KEPT));
  assert.equal(storage.named.get(MAP_KEPT).entries.size, 5);
});

test('the map\'s files come from those kept for a minute after the network was found away', () => {
  assert.match(source, /const QUIET_MS = 60_000;/);
});
