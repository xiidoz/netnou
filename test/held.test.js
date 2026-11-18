// What the page keeps in the browser of the details it showed, for a start
// without a connection (public/held.js, #362): the last HELD addresses, for at
// most KEEP_S, with the area and which address was open last. How the page
// opens them: test/frontend.test.js.

import assert from 'node:assert/strict';
import { test } from 'node:test';

// (the browser's Cache Storage, as far as held.js uses it, in memory; and the page's origin, which its keys are under)
const stored = new Map();
globalThis.document = { baseURI: 'https://karte.example.org/' };
globalThis.caches = {
  open: async () => ({
    match: async (key) => (stored.has(key) ? new Response(stored.get(key)) : undefined),
    put: async (key, response) => { stored.set(key, await response.text()); },
    delete: async (key) => stored.delete(typeof key === 'string' ? key : key.url),
    keys: async () => [...stored.keys()].map((url) => ({ url })),
  }),
};
const { HELD, KEEP_S, fresh, heldArea, heldDetails, heldLast, heldPaths, holdArea, holdDetails, holdLast } = await import('../public/held.js');

/** Runs with the browser's clock at `at` (ms). */
async function at(ms, task) {
  const real = Date.now;
  Date.now = () => ms;
  try {
    return await task();
  } finally {
    Date.now = real;
  }
}

const T0 = Date.parse('2026-11-18T12:37:00Z');
const entry = (name) => ({ selection: { type: 'station', id: name, data: { name } }, view: 'departures', lines: [], board: null });

test('the newest HELD addresses are kept, each once, and what fell out of them is dropped', async () => {
  stored.clear();
  assert.equal(HELD, 25);
  for (let i = 0; i < HELD + 2; i++) await at(T0 + i * 1000, () => holdDetails(`stop/s${i}`, entry(`s${i}`)));
  const paths = await at(T0 + 60_000, heldPaths);
  assert.equal(paths.length, HELD);
  assert.deepEqual([paths[0].path, paths.at(-1).path], ['stop/s2', `stop/s${HELD + 1}`]);
  assert.equal(await at(T0 + 60_000, () => heldDetails('stop/s0')), null);
  assert.equal([...stored.keys()].filter((key) => key.includes('details')).length, HELD);
  // (an address stored again is the newest, with what it holds now)
  await at(T0 + 70_000, () => holdDetails('stop/s2', entry('s2 again')));
  const again = await at(T0 + 80_000, heldPaths);
  assert.deepEqual([again.length, again.at(-1).path, again[0].path], [HELD, 'stop/s2', 'stop/s3']);
  assert.equal((await at(T0 + 80_000, () => heldDetails('stop/s2'))).selection.data.name, 's2 again');
});

test('what is older than KEEP_S is not taken, and goes with the next one stored', async () => {
  stored.clear();
  await at(T0, () => holdDetails('trip/old', entry('old')));
  assert.equal(KEEP_S, 24 * 3600);
  assert.ok(fresh(T0, T0 + KEEP_S * 1000));
  assert.ok(!fresh(T0, T0 + KEEP_S * 1000 + 1));
  const later = T0 + KEEP_S * 1000 + 1000;
  assert.equal(await at(later, () => heldDetails('trip/old')), null);
  assert.deepEqual(await at(later, heldPaths), []);
  await at(later, () => holdDetails('trip/new', entry('new')));
  assert.deepEqual((await at(later, heldPaths)).map((one) => one.path), ['trip/new']);
  assert.ok(![...stored.keys()].some((key) => key.includes('trip%2Fold')));
});

test('stored details that the list does not name go with the next write, as after two tabs wrote at once', async () => {
  stored.clear();
  await at(T0, () => holdDetails('stop/alpha', entry('alpha')));
  stored.set('https://karte.example.org/netnou-held/details%3Astop%2Fstray', JSON.stringify({ format: 1, at: T0, entry: entry('stray') }));
  await at(T0 + 1000, () => holdDetails('stop/beta', entry('beta')));
  assert.deepEqual([...stored.keys()].filter((key) => key.includes('details')).sort(), ['https://karte.example.org/netnou-held/details%3Astop%2Falpha', 'https://karte.example.org/netnou-held/details%3Astop%2Fbeta']);
});

test('an entry in another form than the page stores is not taken', async () => {
  stored.clear();
  await at(T0, () => holdDetails('stop/alpha', entry('alpha')));
  const key = [...stored.keys()].find((one) => one.includes('details'));
  stored.set(key, JSON.stringify({ format: 0, at: T0, entry: entry('alpha') }));
  assert.equal(await at(T0, () => heldDetails('stop/alpha')), null);
  stored.set(key, 'not json');
  assert.equal(await at(T0, () => heldDetails('stop/alpha')), null);
});

test('the area is kept with the clock of the server, and which address was open last for a day', async () => {
  stored.clear();
  assert.equal(await heldArea(), null);
  await at(T0, () => holdArea({ name: 'Nürnberg', timeZone: 'Europe/Berlin' }, -1.5));
  // (a region keeps its time zone: not by age)
  assert.deepEqual(await at(T0 + 10 * KEEP_S * 1000, heldArea), { area: { name: 'Nürnberg', timeZone: 'Europe/Berlin' }, clockOffset: -1.5 });
  assert.equal(await heldLast(), null);
  await at(T0, () => holdLast('trip/verkehrsag-nuernberg/subway/u2/2026-11-18/1322-nuernberg-flughafen'));
  assert.equal(await at(T0 + 1000, heldLast), 'trip/verkehrsag-nuernberg/subway/u2/2026-11-18/1322-nuernberg-flughafen');
  await at(T0 + 2000, () => holdLast(''));
  assert.equal(await at(T0 + 3000, heldLast), '');
  assert.equal(await at(T0 + 2000 + KEEP_S * 1000 + 1, heldLast), null);
});

test('without a storage nothing is kept and nothing breaks', async () => {
  const real = globalThis.caches;
  delete globalThis.caches;
  try {
    await holdDetails('stop/alpha', entry('alpha'));
    assert.equal(await heldDetails('stop/alpha'), null);
    assert.deepEqual(await heldPaths(), []);
    assert.equal(await heldLast(), null);
  } finally {
    globalThis.caches = real;
  }
});
