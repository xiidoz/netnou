// Service worker of the installable app. Its only job is to let the app start
// where the connection fails or hangs (and then say so), within seconds,
// instead of showing a browser error or a blank screen.
//
// It keeps the files of the page per version. The server writes the version
// of the files into this one as it sends it (VERSION; pageVersion in
// server/lib/page.js), so a browser installs it anew whenever one of them has
// changed, with a cache of its own that it fills with all of them at once:
// what is kept is always one version, whole.
//
// A start (the page, or the address of a stop, a line or a trip) asks the
// network first, so that a new version shows as soon as it is deployed. Where
// no answer has come in about the time the network usually takes (startLimit),
// the network fails, or the server behind it does (a 5xx, as while it is
// restarted), it is the page as kept, marked as
// such (KEPT_MARK) for the page to know that it starts without its answer
// (app.js, "a start without a connection"). Each page, and each worker it
// starts, then takes all its files from one version, its own, so that two
// versions do not mix (sources): from the files kept of that version, also
// after a newer one has been installed, and from the network where it is a
// newer one than any kept. Live data (api/) is never cached: what the page
// holds of it for such a start it keeps itself (held.js). Of the map, what it
// needs to start is kept as well, its style and what that names (#366), but
// not its tiles: those the browser's own cache keeps.

// (written by the server as it sends this file: the version of the page's files, and the style of the map,
// NETNOU_MAP_STYLE_URL, or null where the map is of raster tiles, NETNOU_TILE_URL)
const VERSION = 'unversioned';
const MAP_STYLE = null;
const scope = new URL(self.registration.scope);
// (the caches of each instance of an origin are its own: one at /nuernberg/ and one at /muenchen/ do not touch each other's)
const CACHE_PREFIX = `netnou-shell ${scope.pathname} `;
const CACHE = `${CACHE_PREFIX}${VERSION}`;
// What the page served from the cache carries, after its charset (app.js, "a start without a connection").
const KEPT_MARK = '<meta name="netnou-kept" content="">';
// How long a start waits for the network's page before it takes the kept one, in ms (#363): twice as long as the
// page took to start coming at the slowest of the last STARTS starts, so that a start where the network answers as it
// usually does shows the network's page, a start after a pause as well (its connection made anew, it takes longer),
// and one where it does not shows the kept page soon; at least START_MIN_MS, at most START_MS, and START_MS while no
// time is known.
const START_MS = 3000;
const START_MIN_MS = 750;
const STARTS = 5;
// How long the network's page may come after that, in ms, to be kept for the next start.
const LATE_MS = 60_000;
// What the page needs to start. test/frontend.test.js checks that the files
// exist. The style sheets and the first script come within the page
// (PAGE_INLINE in server/lib/page.js) and are not files of their own here.
// Of the languages, English is here, which fills any gaps; the others are
// kept as a browser uses them (LANGUAGE_FILE).
const SHELL = [
  './',
  'address.js',
  'app.js',
  'choice.js',
  'display.js',
  'favourites.js',
  'held.js',
  'i18n.js',
  'languages.js',
  'nearby.js',
  'panel.js',
  'search.js',
  'search-worker.js',
  'stops.js',
  'locales/en.js',
  'favicon.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'vendor/maplibre-gl/maplibre-gl.mjs',
  'vendor/maplibre-gl/maplibre-gl-shared.mjs',
  'vendor/maplibre-gl/maplibre-gl-worker.mjs',
  'vendor/material-design-icons/icons.js',
];

// The texts of a language (public/locales/): of those, a version keeps the ones
// this browser has used, so that the page starts offline in its language
// without every language's texts coming with each new version. They are kept
// as the page asks for them, and as it says which one it is in; a new version
// takes those of the versions before it along.
const LANGUAGE_FILE = /^locales\/[a-z]{2,3}\.js$/;

// (the page as kept: one, whatever the address of the start asked for besides, and in whatever language it came)
const PAGE = new URL('./', scope).href;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// (the times of the last starts, ms, stored beside the sources: what a start has to wait does not change with the version)
const TIMES = new URL('netnou-starts', scope).href;
const keptOf = (version, request) => caches.match(request, { cacheName: `${CACHE_PREFIX}${version}`, ignoreSearch: true, ignoreVary: true });

/**
 * The version a page was sent with (renderPage), read from the start of its
 * answer without waiting for the rest; null where it names none, or has not
 * got that far within START_MS.
 */
async function versionOf(response) {
  const reader = response?.body?.getReader();
  if (!reader) return null;
  const stop = setTimeout(() => reader.cancel().catch(() => {}), START_MS);
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < 65536) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const named = /<meta name="netnou-page-version" content="([^"]*)">/.exec(text);
      if (named) return named[1];
      if (text.includes('</head>')) break;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(stop);
    reader.cancel().catch(() => {});
  }
}

/**
 * The page as kept, served for a start without the network's answer: marked
 * as kept (KEPT_MARK), with what goes after its charset besides, and with the
 * headers it came with, its security policy among them (not its length nor
 * its encoding: the text is new).
 */
async function keptPage(kept, more = '') {
  const headers = new Headers(kept.headers);
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  const text = (await kept.text()).replace('<meta charset="utf-8">', (charset) => `${charset}\n  ${more}${KEPT_MARK}`);
  return new Response(text, { headers });
}

// ---------- sources ----------

// The version of each page and worker of the app, by its id, which its files
// come from. Stored for every version of this worker in a cache of its own:
// the browser stops a service worker that has nothing to do and starts it
// again without what it knew, and a newer version, once installed, serves the
// pages that are open of an older one. The files of an older version stay
// while a page or worker of it is open as a newer one takes over.
const SOURCES_CACHE = `netnou-sources ${scope.pathname}`;
const SOURCES = new URL('netnou-sources', scope).href;
const sources = new Map(); // of this run of the worker: id → version, null, or the promise of one
let stored = null; // the promise of those stored, as a Map of id → version

const storedSources = () => (stored ??= caches.match(SOURCES, { cacheName: SOURCES_CACHE })
  .then((res) => (res ? res.json() : {}))
  .then((list) => new Map(Object.entries(list)), () => new Map()));

/** The version of a page or worker, or null where it is not known (as one that was open before this worker came). */
async function sourceOf(id) {
  if (!id) return null;
  if (sources.has(id)) return sources.get(id);
  return (await storedSources()).get(id) ?? null;
}

/** Notes the version of a page or worker, a promise of one as well, and stores it once known. */
function note(id, version) {
  if (!id) return Promise.resolve();
  sources.set(id, version);
  return Promise.resolve(version).then((known) => {
    if (sources.get(id) === version) sources.set(id, known);
    return store();
  });
}

const openClients = async () => new Set((await self.clients.matchAll({ includeUncontrolled: true, type: 'all' })).map((client) => client.id));

let storing = Promise.resolve();
/** Stores the versions of the pages and workers still open. */
function store() {
  storing = storing.then(async () => {
    const all = await storedSources();
    for (const [id, version] of sources) if (typeof version === 'string') all.set(id, version);
    const open = await openClients();
    // (one of this run that is not open yet may be about to)
    for (const id of [...all.keys()]) if (!open.has(id) && !sources.has(id)) all.delete(id);
    await (await caches.open(SOURCES_CACHE)).put(SOURCES, new Response(JSON.stringify(Object.fromEntries(all))));
  }).catch(() => {});
  return storing;
}

/**
 * As this worker takes over: lets go of the files of the versions that no
 * open page or worker is of, and of the one cache of the versions before
 * #363. Not where a newer worker is on its way already: its files are not
 * this one's to judge, and it does this itself.
 */
async function letGo() {
  const newer = () => Boolean(self.registration.installing || self.registration.waiting);
  if (newer()) return;
  await store();
  const [all, open] = [await storedSources(), await openClients()];
  const used = new Set([VERSION, ...[...all].filter(([id]) => open.has(id)).map(([, version]) => version)]);
  for (const name of await caches.keys()) {
    // (asked again before each: one may have come meanwhile)
    if (newer()) return;
    if (name.startsWith('netnou-shell-') || (name.startsWith(CACHE_PREFIX) && !used.has(name.slice(CACHE_PREFIX.length)))) await caches.delete(name);
  }
}

// ---------- the time of a start ----------

let times = null; // the promise of the times the network's page took at the last starts, in ms, oldest first

const startTimes = () => (times ??= caches.match(TIMES, { cacheName: SOURCES_CACHE })
  .then((res) => (res ? res.json() : []))
  .then((list) => (Array.isArray(list) ? list.filter(Number.isFinite).slice(-STARTS) : []), () => []));

/** How long a start waits for the network's page now, in ms. */
async function startLimit() {
  const list = await startTimes();
  return list.length ? Math.min(START_MS, Math.max(START_MIN_MS, 2 * Math.max(...list))) : START_MS;
}

let timing = Promise.resolve();
/** Stores how long the network's page took to start coming, in ms: in time or too late for its start. */
function noteTime(ms) {
  timing = timing.then(async () => {
    const list = await startTimes();
    list.push(Math.round(ms));
    list.splice(0, Math.max(0, list.length - STARTS));
    await (await caches.open(SOURCES_CACHE)).put(TIMES, new Response(JSON.stringify(list)));
  }).catch(() => {});
  return timing;
}

// ---------- the map ----------

// What the map needs to start, kept for a start without a connection (#366):
// its style, and the lists of tiles (TileJSON), the icons (sprite) and the
// fonts (glyphs) that the style names, as the map has asked for them; nothing
// fetched ahead. Not its tiles: the browser's cache keeps those, for as long
// as their server lets it. The browser keeps the style and the lists only for
// a day and an hour (OpenFreeMap's), and without them a start cannot set the
// map up, even where its tiles are there. The files are the map's, not of a
// version of the page: one cache for each instance, which a new version keeps.
const MAP_CACHE = `netnou-map ${scope.pathname}`;
// How long after a start or a file of the map has found the network away the
// map's files come from those kept at once, in ms, rather than after waiting
// for the network: in a tunnel, the map would wait for each in turn.
const QUIET_MS = 60_000;
let quietUntil = 0;
let mapKept = null; // the addresses kept, once read: a Set
let mapNamed = null; // whether the style kept names an address: a function, once read

/** Whether a style names an address for the map to start: one of its lists of tiles, its icons or its fonts. */
function namedBy(style) {
  const at = (url) => new URL(url, MAP_STYLE).href;
  const lists = new Set(Object.values(style?.sources ?? {}).map((source) => source?.url).filter((url) => typeof url === 'string' && /^https?:/.test(at(url))).map(at));
  const icons = new Set();
  const sprites = typeof style?.sprite === 'string' ? [style.sprite] : Array.isArray(style?.sprite) ? style.sprite.map((sprite) => sprite?.url) : [];
  for (const sprite of sprites.filter((url) => typeof url === 'string')) {
    for (const file of ['.json', '.png', '@2x.json', '@2x.png']) {
      const address = new URL(sprite, MAP_STYLE);
      address.pathname += file;
      icons.add(address.href);
    }
  }
  // (the address of the fonts with its {fontstack} and {range}, as a URL writes them: in its path as %7B…%7D)
  const glyphs = typeof style?.glyphs === 'string'
    ? new RegExp(`^${at(style.glyphs).replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`).replace(/%7Bfontstack%7D|\\\{fontstack\\\}/g, '[^/?#&]+').replace(/%7Brange%7D|\\\{range\\\}/g, '\\d+-\\d+')}$`)
    : null;
  return (url) => lists.has(url) || icons.has(url) || Boolean(glyphs?.test(url));
}

// (what is kept, read as the worker starts: the style comes first in a page's start, and the rest after its answer)
const mapReady = MAP_STYLE
  ? caches.has(MAP_CACHE).then(async (has) => {
    // (not made where there is none yet: opening one makes it)
    if (!has) {
      mapKept = new Set();
      return;
    }
    const cache = await caches.open(MAP_CACHE);
    mapKept = new Set((await cache.keys()).map((request) => request.url));
    const style = await cache.match(MAP_STYLE, { ignoreVary: true });
    if (style) mapNamed = namedBy(await style.json());
  }).catch(() => {})
  : Promise.resolve();

/** Whether a request is for a file the map needs to start, as far as this run of the worker knows yet. */
const isMapFile = (url) => MAP_STYLE !== null && (url === MAP_STYLE || Boolean(mapKept?.has(url)) || Boolean(mapNamed?.(url)));

/**
 * Keeps a file of the map from the network, in place of the one kept: not
 * where it is the same (by its tag or date). A new style decides what else is
 * kept: what it no longer names goes, as the icons of an older version.
 */
async function keepMap(url, answer) {
  const cancel = () => answer.body?.cancel().catch(() => {});
  if (!answer.ok) return cancel();
  // (after what was kept has been read: that is older)
  await mapReady;
  const cache = await caches.open(MAP_CACHE);
  const kept = await cache.match(url, { ignoreVary: true });
  if (kept && ['ETag', 'Last-Modified'].some((name) => answer.headers.get(name) && answer.headers.get(name) === kept.headers.get(name))) return cancel();
  if (url === MAP_STYLE) {
    const style = await answer.clone().json().catch(() => null);
    if (!style) return cancel();
    mapNamed = namedBy(style);
    for (const request of await cache.keys()) {
      if (request.url === MAP_STYLE || mapNamed(request.url)) continue;
      await cache.delete(request);
      mapKept?.delete(request.url);
    }
  }
  await cache.put(url, answer);
  mapKept?.add(url);
}

/**
 * A file the map needs to start: the network's, where it answers about as
 * soon as it does at a start (startLimit), kept for the next time; else the
 * one kept, at once where the network was just found away. The network's
 * answer is kept also where it comes too late.
 */
async function mapFile(event) {
  const { request } = event;
  const network = fetch(request);
  // (the network's answer kept, also where it comes too late for this one; a 5xx is none, as while its server restarts)
  const keeping = network.then((answer) => {
    if (answer.status >= 500) return undefined;
    quietUntil = 0;
    return keepMap(request.url, answer.clone());
  }, () => {});
  event.waitUntil(Promise.race([keeping.catch(() => {}), sleep(LATE_MS)]));
  await mapReady;
  const kept = await caches.match(request.url, { cacheName: MAP_CACHE, ignoreVary: true });
  // (none kept: as the browser would have it, however long it takes)
  if (!kept) return network;
  if (Date.now() < quietUntil) return kept;
  const first = await Promise.race([network.catch(() => null), sleep(await startLimit())]);
  if (first && first.status < 500) return first;
  quietUntil = Date.now() + QUIET_MS;
  return kept;
}

/**
 * The files of the map that a page fetched before this worker served it, as
 * at the first visit, which the page lists (app.js): kept as well, from the
 * browser's cache where it has them. The style first, which names the others.
 */
async function keepListed(urls) {
  await mapReady;
  const listed = new Set(urls.filter((url) => typeof url === 'string'));
  if (MAP_STYLE === null || !listed.has(MAP_STYLE)) return;
  const fetched = (url) => fetch(url, { mode: 'cors', credentials: 'same-origin', cache: 'force-cache' }).then((answer) => keepMap(url, answer), () => {});
  if (!mapKept?.has(MAP_STYLE)) await fetched(MAP_STYLE);
  for (const url of listed) if (url !== MAP_STYLE && !mapKept?.has(url) && mapNamed?.(url)) await fetched(url);
}

// ---------- the life of the worker ----------

/** The texts of the languages kept with the other versions of this instance: those this browser has used. */
async function languagesUsed() {
  const used = new Set();
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX) || name === CACHE) continue;
    for (const request of await (await caches.open(name)).keys()) {
      const path = new URL(request.url).pathname.slice(scope.pathname.length);
      if (LANGUAGE_FILE.test(path) && !SHELL.includes(path)) used.add(path);
    }
  }
  return [...used];
}

/**
 * Keeps the texts of a language with this version where they are not yet:
 * a language this version may not have any longer is no reason to fail.
 */
async function keepLanguage(path, cache) {
  if (await cache.match(new URL(path, scope).href)) return;
  const answer = await fetch(new URL(path, scope).href).catch(() => null);
  if (answer?.ok) await cache.put(new URL(path, scope).href, answer);
  else answer?.body?.cancel().catch(() => {});
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const used = await languagesUsed();
    await cache.addAll(SHELL);
    // (a version deployed between this file and the others: not kept as this one, the browser's next check gets that one)
    const version = await versionOf(await cache.match(PAGE));
    if (version !== null && version !== VERSION) {
      await caches.delete(CACHE);
      throw new Error(`the page is of version ${version}, this service worker of ${VERSION}`);
    }
    await Promise.all(used.map((path) => keepLanguage(path, cache)));
    // (let go of meanwhile by the worker in charge, which did not know of this one yet: the browser's next check tries again)
    if (!(await caches.has(CACHE))) throw new Error(`the files of version ${VERSION} are gone`);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(letGo().catch(() => {}).then(() => self.clients.claim()));
});

// A page that this worker did not start, as at the first visit or one that
// was open before it, says which version it is (app.js), and which language
// it is in: at the first visit it fetched that one's texts before this worker
// was there to keep them.
self.addEventListener('message', (event) => {
  const version = event.data?.pageVersion;
  if (typeof version === 'string' && event.source?.id) event.waitUntil(note(event.source.id, version));
  const language = `locales/${event.data?.language}.js`;
  if (version === VERSION && LANGUAGE_FILE.test(language)) event.waitUntil(caches.open(CACHE).then((cache) => keepLanguage(language, cache)).catch(() => {}));
  // (and which files of the map it fetched, #366)
  if (Array.isArray(event.data?.mapFiles)) event.waitUntil(keepListed(event.data.mapFiles).catch(() => {}));
});

// ---------- requests ----------

/**
 * A start: the network's page where it answers in time (startLimit), else the
 * page as kept, at the address of details with the base the server would have
 * given it there. Where the network answers too late for this start, its page
 * is for the next (keep), and how long it took counts for the next one's wait.
 */
async function start(event, path, url) {
  const began = Date.now();
  let answered = null;
  const network = fetch(event.request).then((answer) => {
    answered = Date.now();
    return answer;
  });
  const limit = await startLimit();
  const first = await Promise.race([network.catch(() => null), sleep(Math.max(0, began + limit - Date.now()))]);
  // (an answer in time; not one of a server that has failed, or is restarted behind its proxy)
  if (first && first.status < 500) {
    quietUntil = 0;
    event.waitUntil(noteTime(answered - began));
    const version = versionOf(first.clone());
    event.waitUntil(note(event.resultingClientId, version));
    event.waitUntil(keep(version, first, path, url));
    return first;
  }
  const kept = await caches.match(PAGE, { cacheName: CACHE, ignoreSearch: true, ignoreVary: true });
  // (nothing kept: the network's answer after all, however long it takes)
  if (!kept) return first ?? network;
  // (the network away: the map's files from those kept at once, see "the map")
  quietUntil = Date.now() + QUIET_MS;
  first?.body?.cancel().catch(() => {});
  event.waitUntil(note(event.resultingClientId, VERSION));
  if (first === undefined) {
    const late = network.then((answer) => {
      const keeping = keep(versionOf(answer.clone()), answer, path, url);
      answer.body?.cancel().catch(() => {});
      return Promise.all([keeping, answer.status < 500 ? noteTime(answered - began) : null]);
    }, () => {});
    event.waitUntil(Promise.race([late, sleep(LATE_MS)]));
  }
  return keptPage(kept, path === './' ? '' : `<base href="${'../'.repeat(path.split('/').length - 1)}">\n  `);
}

/**
 * What a page from the network is good for besides: of a newer version, it
 * has the browser look for the service worker that keeps that one, for the
 * next start; of this version, at the map, it is kept in place of the one
 * kept before, in the language it came in.
 */
async function keep(version, response, path, url) {
  const copy = response.ok && path === './' && !url.search ? response.clone() : null;
  const named = await version;
  if (copy && named === VERSION) return (await caches.open(CACHE)).put(PAGE, copy);
  copy?.body?.cancel().catch(() => {});
  // (not waited for: the browser lets the newer worker take over only once this one has done what it is doing)
  if (named !== null && named !== VERSION) self.registration.update().catch(() => {});
}

/**
 * A file of a version from the network: where it is the texts of a language
 * for this version, they are kept with it as well (LANGUAGE_FILE).
 */
function fetchLanguage(event, version) {
  const { request } = event;
  const network = fetch(request);
  const path = new URL(request.url).pathname.slice(scope.pathname.length);
  if (version !== VERSION || !LANGUAGE_FILE.test(path)) return network;
  // (copied as it comes, before the page reads it)
  event.waitUntil(network.then((answer) => (answer.ok ? answer.clone() : null)).then(async (copy) => {
    if (copy) await (await caches.open(CACHE)).put(request.url, copy);
  }).catch(() => {}));
  return network;
}

/** A file of the page: from the version of the page or worker that asks for it. */
async function file(event) {
  const { request } = event;
  const version = await sourceOf(event.clientId);
  // (a worker that a page starts is of the page's version)
  if (version && ['worker', 'sharedworker'].includes(request.destination)) event.waitUntil(note(event.resultingClientId, version));
  // (of a version kept here: its file, without asking the network; of a newer one: the network's alone, never another version's)
  if (version) return (await keptOf(version, request)) ?? fetchLanguage(event, version);
  // (of a page or worker that this worker does not know: the network, as long as a start waits for it, else the file kept)
  const network = fetch(request);
  const first = await Promise.race([network.catch(() => null), sleep(await startLimit())]);
  return first ?? (await keptOf(VERSION, request)) ?? network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  // The files the map needs to start, mostly of another server (#366); not its tiles.
  if (isMapFile(request.url)) {
    event.respondWith(mapFile(event));
    return;
  }
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const path = url.pathname.slice(scope.pathname.length) || './';
  // The page, and the address of a stop, a line or a trip (#37, #178), which
  // is the page with what the server writes into it.
  if (request.mode === 'navigate' && (path === './' || /^(stop|line|trip)\//.test(path))) {
    event.respondWith(start(event, path, url));
    return;
  }
  // Of this origin only the shell is kept, and the texts of the languages used. It may serve more than this app's
  // files: its live data (api/) and even the map's tiles (NETNOU_TILE_URL of
  // the server), of which there is no end.
  if (SHELL.includes(path) || LANGUAGE_FILE.test(path)) event.respondWith(file(event));
});
