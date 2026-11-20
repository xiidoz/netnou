// Worker thread of the page: finds stops, lines and towns (search.js). The
// list they are found in is megabytes for a whole country. Here neither
// loading it and getting it ready nor reading through it holds up the page,
// and what is typed still goes nowhere but into this browser.
//
// The page asks with { turn, query, near, view, limits, modeNames, favourites }
// and is answered with one of
//   { turn, towns, lines, stops, nearby }   what was found
//   { turn, failed: true }   the list could not be loaded
// Only the question asked last is answered: one that was overtaken while the
// thread was busy has nobody waiting for it. A question with nothing typed
// is answered with the favourites, the stops and lines the visitor marked
// (favourites.js), which come first among those found otherwise, and with
// stations near the map to suggest below them (nearby.js, #257).
// { forget: true } tells the thread that its list is no longer the server's:
// the next question loads it again. The question says whether the page knows
// its connection to be lost (`lost`).
//
// The list is kept in the browser (#367), for a search without a connection,
// also after a restart: in its Cache Storage, under the address it came from,
// so each instance its own, with its tag (ETag). It is asked for with that tag,
// and the server answers an unchanged list with a short "not modified", the
// kept one then being its own; a new timetable brings a new one, kept in its
// place. Where the network fails, the server has no timetable yet, or the
// network has not brought its list within KEPT_WAIT_MS, the kept list is
// searched, at once where the page knows its connection to be lost; the
// network's takes its place once it is in, however late. Once the connection
// is back, a list made of the kept one is asked for again beside the search,
// which goes on in the kept one meanwhile. A kept one that cannot be read is
// let go of. For all of Germany the list is 12.5 MB, read and made ready in
// about a second on a phone.

import { nearby, nearbyBeside, placesOf } from './nearby.js';
import { buildIndex, favouritesIn, search, searchLines, searchTowns, stopOf, wordsOf } from './search.js';

const KEPT_CACHE = 'netnou-search';
const LIST = new URL('api/search', location.href).href;
// How long the network may take for the list where one is kept, to answer and to send all of it, in ms, before the kept
// one is searched (as a start waits for its page, #363): the network's takes its place once it is in, however late. And
// how long after a try that found the network away the list is asked for again, with a connection.
const KEPT_WAIT_MS = 3000;
const AGAIN_MS = 30_000;

let index = null; // what search.js looks through, once it is there
let indexTag = null; // the tag of the list it was made of
let fromKept = false; // whether that is the list kept, the network's not had: asked for again once the connection is back
let triedAt = 0; // when the network was last tried for it
let arriving = null; // the network's list while it is on its way: a promise
let refreshing = false; // whether the network is being asked again for a list made of the kept one
let reading = null; // the kept list while it is read: a promise of whether it was there, one for all who wait for it
let fetched = 0; // how many lists have come from the network: one read from the kept one meanwhile does not take its place
let places = null; // the places of its stations (nearby.js), once a question with nothing typed has needed them
let favourites = { of: null, in: null }; // the favourites as the page sent them last, and where they are in the list
let asked = null; // the question to answer next
let busy = false;

/** The Cache Storage of the browser, where it has one (not in a page that is not served securely). */
const storage = () => (typeof caches === 'undefined' ? null : caches);

/** The list as kept, or null. */
async function keptList() {
  try {
    return (await storage()?.match(LIST, { cacheName: KEPT_CACHE })) ?? null;
  } catch {
    return null;
  }
}

/** Searches a list from now on (made ready with the names of the modes as the visitor reads them: "bus 33" is a line of the buses). */
function use(built, tag, kept) {
  index = built;
  indexTag = tag;
  fromKept = kept;
  places = null;
  favourites = { of: null, in: null };
}

/**
 * The kept list made ready to search, once however many wait for it. False
 * where there is none, or where it cannot be read, as one broken or kept by a
 * later version otherwise: that one is let go of, for the network's whole list
 * to take its place. Where the network has brought its list meanwhile, that
 * one stays, being newer.
 */
function takeKept(modeNames) {
  reading ??= (async () => {
    const list = await keptList();
    if (!list) return false;
    const before = fetched;
    try {
      const built = buildIndex(await list.json(), modeNames);
      if (fetched === before) use(built, list.headers.get('ETag'), true);
      return true;
    } catch (err) {
      console.warn('stops and lines kept not read:', err);
      await storage()?.open(KEPT_CACHE).then((cache) => cache.delete(LIST)).catch(() => {});
      return false;
    }
  })().finally(() => { reading = null; });
  return reading;
}

/**
 * The network's list, asked for with the tag of the one kept: taken once it is
 * in, and kept in place of the one before; an unchanged one ("not modified")
 * is the one kept. Fails where none comes: no connection, or a server without
 * a timetable yet.
 */
async function fromNetwork(modeNames, tag) {
  const asking = new AbortController();
  // (an answer that takes longer than the page's other questions to begin does not come; the list itself, megabytes on a
  // slow link, is given longer once it is on its way)
  let limit = setTimeout(() => asking.abort(), 20_000);
  try {
    const res = await fetch('api/search', { signal: asking.signal, cache: 'no-store', headers: tag ? { 'If-None-Match': tag } : {} });
    clearTimeout(limit);
    if (res.status === 304 && tag) {
      // (the kept one is the server's; where it is unreadable, and let go of, the whole list)
      if (index && indexTag === tag) fromKept = false;
      else if (await takeKept(modeNames)) fromKept = false;
      else await fromNetwork(modeNames, null);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    limit = setTimeout(() => asking.abort(), 120_000);
    const copy = res.clone();
    const built = buildIndex(await res.json(), modeNames);
    fetched += 1;
    use(built, res.headers.get('ETag'), false);
    // (kept in place of the one before; where it cannot be, as in a private window, searched all the same)
    if (res.headers.get('ETag')) await storage()?.open(KEPT_CACHE).then((cache) => cache.put(LIST, copy)).catch(() => {});
  } finally {
    clearTimeout(limit);
  }
}

/**
 * Loads the list (see above): the network's; where one is kept and the
 * network has not brought its own within KEPT_WAIT_MS, the kept one, at once
 * where the connection is known to be lost, the network's taking its place
 * once it is in.
 */
async function load(modeNames, lost) {
  const kept = await keptList();
  if (kept && lost) {
    if (!index) await takeKept(modeNames);
    return;
  }
  triedAt = Date.now();
  const settled = fromNetwork(modeNames, kept?.headers.get('ETag') ?? null).then(() => true, (err) => {
    // (also while the server has no timetable yet; asked for again with the next question)
    console.warn('stops and lines not loaded:', err);
    return false;
  });
  arriving = settled;
  settled.finally(() => {
    if (arriving === settled) arriving = null;
  });
  if (!kept) {
    await settled;
    return;
  }
  const inTime = await Promise.race([settled, new Promise((resolve) => { setTimeout(resolve, KEPT_WAIT_MS, null); })]);
  if (inTime !== true && !index) await takeKept(modeNames);
}

/** The network asked again for a list made of the kept one, once the connection is back, beside the search. */
function refresh(modeNames) {
  refreshing = true;
  load(modeNames, false).finally(() => { refreshing = false; });
}

async function answer() {
  busy = true;
  while (asked) {
    // The questions that came in while the last one was answered are taken first: the last of them counts.
    await new Promise((resolve) => { setTimeout(resolve); });
    const { turn, query, near, view = null, limits, modeNames, favourites: kept, lost = false } = asked;
    asked = null;
    if (!index) {
      try {
        await load(modeNames, lost);
      } catch (err) {
        console.warn('stops and lines not loaded:', err);
      }
    } else if (fromKept && !lost && !refreshing && !arriving && !(Date.now() - triedAt < AGAIN_MS)) refresh(modeNames);
    if (asked) continue;
    if (!index) {
      postMessage({ turn, failed: true });
      continue;
    }
    // (looked up once for each list and each change of them, not for every letter typed)
    const key = JSON.stringify(kept ?? null);
    if (favourites.of !== key || !favourites.in) favourites = { of: key, in: favouritesIn(index, kept ?? undefined) };
    const { stops, lines } = favourites.in;
    const found = { towns: searchTowns(index, query, { near, limit: limits.towns }), lines: searchLines(index, query, { near, limit: limits.lines, favourites: lines }), stops: search(index, query, { near, view, limit: limits.stops, favourites: stops }) };
    // (with nothing typed, as many below the favourites as the list has room for, and none that is one of them)
    let suggested = [];
    if (!wordsOf(query).length && limits.stops > 0) {
      places ??= placesOf(index);
      suggested = nearby(places, near, { limit: nearbyBeside(found.lines.length + found.stops.length), except: stops }).map((i) => stopOf(index, i));
    }
    postMessage({ turn, ...found, nearby: suggested });
  }
}

addEventListener('message', ({ data }) => {
  if (data.forget) {
    index = null;
    favourites = { of: null, in: null };
    return;
  }
  asked = data;
  if (busy) return;
  // (whatever goes wrong with one question, the next one is answered)
  answer().finally(() => { busy = false; });
});
