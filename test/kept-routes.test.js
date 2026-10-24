import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { KeptRoutes } from '../server/lib/kept-routes.js';

/** A directory for files that is gone when the test ends. */
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-kept-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const NETWORKS = { fetchedAt: '2026-10-01T00:00:00.000Z', scope: 'area-1' };
const [A, B, C] = [[49.4, 11.0], [49.45, 11.002], [49.5, 11.0001]];
// (each point its latitude, its longitude and the share of the hop's time up to it, #264)
const ROUTE = [4940000, 1100000, 0, 4942500, 1100150, 41000, 4945000, 1100200, 65535];
const found = (kept, ...hop) => {
  const route = kept.find(...hop);
  return route ? Array.from(route) : route;
};

test('routes are found again by their network and the places of their stops, those without a route as well', (t) => {
  const dir = tempDir(t);
  const first = new KeptRoutes(dir, NETWORKS);
  assert.equal(first.find(0, A, B), undefined);
  first.add(0, A, B, ROUTE);
  first.add(0, B, C, null);
  first.flush();

  const kept = new KeptRoutes(dir, NETWORKS);
  assert.deepEqual(found(kept, 0, A, B), ROUTE);
  assert.equal(kept.find(0, B, C), null); // tried, and no route
  // the other way round, on another network, or between other places: not kept
  assert.deepEqual([kept.find(0, B, A), kept.find(1, A, B), kept.find(0, A, [49.45, 11.0021])], [undefined, undefined, undefined]);
  // (places are taken to a ten-millionth of a degree, about a centimetre)
  assert.deepEqual(found(kept, 0, [49.400000004, 11.0], B), ROUTE);
});

test('the routes of other networks are not used, and the file is begun anew with the first new one', (t) => {
  const dir = tempDir(t);
  const first = new KeptRoutes(dir, NETWORKS);
  first.add(0, A, B, ROUTE);
  first.flush();
  for (const other of [{ ...NETWORKS, fetchedAt: '2026-11-01T00:00:00.000Z' }, { ...NETWORKS, scope: 'area-2' }]) {
    assert.equal(new KeptRoutes(dir, other).find(0, A, B), undefined, JSON.stringify(other));
  }
  const newer = { ...NETWORKS, fetchedAt: '2026-11-01T00:00:00.000Z' };
  const now = new KeptRoutes(dir, newer);
  now.add(0, B, C, ROUTE);
  now.flush();
  assert.equal(new KeptRoutes(dir, newer).find(0, A, B), undefined);
  assert.deepEqual(found(new KeptRoutes(dir, newer), 0, B, C), ROUTE);
  // a file that is not one of these
  fs.writeFileSync(path.join(dir, 'osm-routes.bin'), 'something else');
  assert.equal(new KeptRoutes(dir, newer).find(0, B, C), undefined);
});

test('what was routed before a stop is kept, but for a route cut short', (t) => {
  const dir = tempDir(t);
  const kept = new KeptRoutes(dir, NETWORKS);
  kept.add(0, A, B, ROUTE);
  kept.add(0, B, C, ROUTE);
  kept.flush();
  // stopped while the second was written
  const file = path.join(dir, 'osm-routes.bin');
  fs.truncateSync(file, fs.statSync(file).size - 5);
  const after = new KeptRoutes(dir, NETWORKS);
  assert.deepEqual([found(after, 0, A, B), after.find(0, B, C)], [ROUTE, undefined]);
  // and goes on from there
  after.add(0, B, C, ROUTE.slice(0, 6));
  after.flush();
  assert.deepEqual(found(new KeptRoutes(dir, NETWORKS), 0, B, C), ROUTE.slice(0, 6));
});

test('what is kept at the end are the routes of the hops of the timetable', (t) => {
  const dir = tempDir(t);
  const before = new KeptRoutes(dir, NETWORKS);
  before.add(0, A, B, ROUTE);
  before.add(0, B, C, ROUTE);
  before.flush();
  // the next timetable has the hop from A to B and a new one from C to A, without a route
  const next = new KeptRoutes(dir, NETWORKS);
  assert.deepEqual(found(next, 0, A, B), ROUTE);
  next.add(0, C, A, null);
  next.save();
  const after = new KeptRoutes(dir, NETWORKS);
  assert.deepEqual([found(after, 0, A, B), after.find(0, C, A), after.find(0, B, C)], [ROUTE, null, undefined]);
});
