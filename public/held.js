// What the page holds of details it showed, kept in this browser beyond the
// visit (#362). A phone unloads a page in the background and an installed app
// is closed; on a train they start again where there is no connection, and
// would have nothing to show. So each answer the open details get is stored
// under their address, of the last HELD addresses and for at most KEEP_S;
// with them the answer of api/area, the server's clock beside the phone's,
// and which address was open last (app.js: "a start without a connection").
//
// Stored in the browser's Cache Storage, which is written without holding up
// what the page draws and has room for it (an address takes 10 to 60 KB, a
// busy stop with its departures for while the connection is lost, #364, up to
// about 200 KB). One write at a time, also from several tabs of the page (a
// lock of the browser's), so that the list of addresses is never written over
// by an older one; what the list does not name goes with the next write.
// Nothing of it leaves the browser; it goes with the site's data.

const CACHE = 'netnou-held';
// What is stored, in its form: an entry of another FORMAT is not taken. Bump it when what an entry means changes.
const FORMAT = 1;
/** How many addresses are kept, here and in the page's own memory of the visit (app.js, visited). */
export const HELD = 25;
/** How long, in s: held details of yesterday say nothing of today. */
export const KEEP_S = 24 * 3600;

/** Whether what was stored at `at` (ms) is young enough to be taken. */
export const fresh = (at, now = Date.now()) => Number.isFinite(at) && now - at <= KEEP_S * 1000;

// (keys are addresses of their own, under the instance's root, which nothing serves: the browser's cache wants URLs;
// and two instances at paths of one origin keep theirs apart)
const keyOf = (name) => new URL(`netnou-held/${encodeURIComponent(name)}`, document.baseURI).href;
const opened = () => (typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE).catch(() => null));

async function read(name) {
  const cache = await opened();
  const res = cache && (await cache.match(keyOf(name)).catch(() => null));
  const value = res && (await res.json().catch(() => null));
  return value?.format === FORMAT ? value : null;
}

async function write(name, value) {
  const cache = await opened();
  const body = JSON.stringify({ format: FORMAT, ...value });
  await cache?.put(keyOf(name), new Response(body, { headers: { 'Content-Type': 'application/json' } }));
}

/** Of what is stored, the details of addresses the list does not name: they go (after two tabs wrote at once, or a new FORMAT). */
async function sweep(paths) {
  const cache = await opened();
  const named = new Set(paths.map((one) => keyOf(`details:${one.path}`)));
  for (const request of (await cache?.keys()) ?? []) {
    if (request.url.startsWith(keyOf('details:')) && !named.has(request.url)) await cache.delete(request);
  }
}

/** Runs a task while no other tab of the page writes, where the browser has locks. */
const locked = (task) => (globalThis.navigator?.locks ? navigator.locks.request(keyOf('lock'), task) : task());

let turn = Promise.resolve();
/** Runs a write after those before it, whatever became of them: a full or a private storage only means less is kept. */
function inTurn(task) {
  turn = turn.then(task).catch((err) => console.warn('not kept for later:', err));
  return turn;
}

/** Stores what details at an address hold now, as the newest of HELD addresses; those beyond, or too old, go. */
export function holdDetails(path, entry) {
  return inTurn(() => locked(async () => {
    const at = Date.now();
    const kept = ((await read('index'))?.paths ?? []).filter((one) => one.path !== path && fresh(one.at, at));
    kept.push({ path, at });
    kept.splice(0, Math.max(0, kept.length - HELD));
    await write(`details:${path}`, { at, entry });
    await write('index', { paths: kept });
    await sweep(kept);
  }));
}

/** The addresses stored, oldest first: { path, at }. */
export async function heldPaths() {
  return ((await read('index'))?.paths ?? []).filter((one) => fresh(one.at));
}

/** What is stored for an address, as holdDetails had it, or null. */
export async function heldDetails(path) {
  const value = await read(`details:${path}`);
  return value && fresh(value.at) ? value.entry : null;
}

/** Stores the answer of api/area, with the server's clock beside the phone's (s), for a start without a connection. */
export function holdArea(area, clockOffset) {
  return inTurn(() => write('area', { at: Date.now(), area, clockOffset }));
}

/** The answer of api/area stored, with clockOffset, or null. (Not by age: a region keeps its time zone.) */
export async function heldArea() {
  const value = await read('area');
  return value?.area ? { area: value.area, clockOffset: value.clockOffset ?? 0 } : null;
}

/** Stores which address was open last: that of details, or '' where the map was alone. */
export function holdLast(path) {
  return inTurn(() => write('last', { at: Date.now(), path }));
}

/** The address open last, where that was within KEEP_S, else null. */
export async function heldLast() {
  const value = await read('last');
  return value && fresh(value.at) && typeof value.path === 'string' ? value.path : null;
}
