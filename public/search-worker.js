// Worker thread of the page: finds stops, lines and towns (search.js). The
// list they are found in is megabytes for a whole country. Here neither
// loading it and getting it ready nor reading through it holds up the page,
// and what is typed still goes nowhere but into this browser.
//
// The page asks with { turn, query, near, limits, modeNames, favourites } and
// is answered with one of
//   { turn, towns, lines, stops }   what was found
//   { turn, failed: true }   the list could not be loaded
// Only the question asked last is answered: one that was overtaken while the
// thread was busy has nobody waiting for it. A question with nothing typed
// is answered with the favourites, the stops and lines the visitor marked
// (favourites.js), which come first among those found otherwise.
// { forget: true } tells the thread that its list is no longer the server's:
// the next question loads it again.

import { buildIndex, favouritesIn, search, searchLines, searchTowns } from './search.js';

let index = null; // what search.js looks through, once it is there
let favourites = { of: null, in: null }; // the favourites as the page sent them last, and where they are in the list
let asked = null; // the question to answer next
let busy = false;

async function load(modeNames) {
  try {
    const res = await fetch('api/search');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // (with the names of the modes as the visitor reads them: "bus 33" is a line of the buses)
    index = buildIndex(await res.json(), modeNames);
  } catch (err) {
    // (also while the server has no timetable yet; asked for again with the next question)
    console.warn('stops and lines not loaded:', err);
  }
}

async function answer() {
  busy = true;
  while (asked) {
    // The questions that came in while the last one was answered are taken first: the last of them counts.
    await new Promise((resolve) => { setTimeout(resolve); });
    const { turn, query, near, limits, modeNames, favourites: kept } = asked;
    asked = null;
    if (!index) await load(modeNames);
    if (asked) continue;
    if (!index) {
      postMessage({ turn, failed: true });
      continue;
    }
    // (looked up once for each list and each change of them, not for every letter typed)
    const key = JSON.stringify(kept ?? null);
    if (favourites.of !== key || !favourites.in) favourites = { of: key, in: favouritesIn(index, kept ?? undefined) };
    const { stops, lines } = favourites.in;
    postMessage({ turn, towns: searchTowns(index, query, { near, limit: limits.towns }), lines: searchLines(index, query, { near, limit: limits.lines, favourites: lines }), stops: search(index, query, { near, limit: limits.stops, favourites: stops }) });
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
