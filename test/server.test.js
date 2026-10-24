// End to end: starts the real server as a child process against a local
// stand-in for the feed provider and talks to it over HTTP.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { LANGUAGES } from '../public/i18n.js';
import { addDays } from '../server/lib/time.js';
import { encodeFeed, makeZip, startUpstream } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const BBOX = [49.3, 10.8, 49.7, 11.3];

// The server looks at the clock, so the fixture has to run whenever the test
// does. It is set to UTC, which has no clock changes to trip over.
//   T1  U1   shuttles A → B → A … (both inside the area), a stop every half
//            hour for more than two days: under way at any time, on yesterday's
//            and on today's service day
//   T2  ICE  X → Y → B, where X and Y lie far outside and Y is not reached
//            before the third day: under way too, but never inside the area
const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const shuttle = [];
for (let hour = 0; hour <= 50; hour++) shuttle.push(`T1,${hour}:00:00,${hour}:00:00,A,${2 * hour}`, `T1,${hour}:30:00,${hour}:30:00,B,${2 * hour + 1}`);
const FEED = {
  'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\n1,Testbetrieb,https://example.org,UTC\n',
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Alpha,49.40,11.00\nB,Beta,49.50,11.00\nX,Fern Nord,52.00,13.00\nY,Fern Mitte,51.90,13.00\n',
  'routes.txt': 'route_id,agency_id,route_short_name,route_type\nR1,1,U1,1\nR2,1,ICE 5,2\n',
  'trips.txt': 'route_id,service_id,trip_id,trip_headsign\nR1,DAILY,T1,Rundkurs\nR2,DAILY,T2,Beta\n',
  'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nDAILY,1,1,1,1,1,1,1,${addDays(today, -3)},${addDays(today, 3)}\n`,
  'stop_times.txt': ['trip_id,arrival_time,departure_time,stop_id,stop_sequence', ...shuttle, 'T2,0:00:00,0:00:00,X,0', 'T2,71:00:00,71:00:00,Y,1', 'T2,72:00:00,72:00:00,B,2'].join('\n'),
};
const REALTIME = encodeFeed({
  timestamp: Math.floor(Date.now() / 1000),
  tripUpdates: [{ tripId: 'T1', startDate: today, stops: [{ seq: 0, stopId: 'A', dep: { delay: 120 } }] }],
  alerts: [
    { tripId: 'T1', text: 'Echtzeitdaten aufbereitet von GTFS.de, bereitgestellt von Testbetrieb' },
    { tripId: 'T1', text: 'Signalstörung', severity: 3 },
    { stopId: 'A', title: 'Aufzug gestört', text: 'Aufzug außer Betrieb', severity: 2 },
  ],
});

// Every setting the server reads; none may leak in from the shell running the tests.
const SETTINGS = ['NETNOU_PORT', 'NETNOU_HOST', 'NETNOU_DATA_DIR', 'NETNOU_AREA', 'NETNOU_AREA_FILE', 'NETNOU_BBOX', 'NETNOU_AGENCIES', 'NETNOU_AREA_NAME', 'NETNOU_VIEW', 'NETNOU_TIMEZONE', 'NETNOU_MAP_STYLE_URL', 'NETNOU_MAP_ORIGINS', 'NETNOU_EMBED_ORIGINS', 'NETNOU_TILE_URL', 'NETNOU_TILE_ATTRIBUTION', 'NETNOU_DATA_ATTRIBUTION',
  'NETNOU_OSM_PBF_URLS', 'NETNOU_OSM_MAX_AGE_DAYS', 'NETNOU_FEED_URL', 'NETNOU_FEED_CHECK_MINUTES', 'NETNOU_DOWNLOAD_TIMEOUT_MINUTES', 'NETNOU_REALTIME_URL', 'NETNOU_REALTIME_INTERVAL_SECONDS', 'NETNOU_REALTIME_IDLE_SECONDS', 'NETNOU_UPDATE_CHECK',
  'NETNOU_LANGUAGE', 'NETNOU_PUBLIC_URL', 'NETNOU_SEARCH_ENGINES', 'NETNOU_SITE_NAME', 'NETNOU_SITE_TITLE', 'NETNOU_SITE_DESCRIPTION', 'NETNOU_LINKS', 'NETNOU_BRAND_DIR',
  'NETNOU_VISITS_URL', 'NETNOU_VISITS_BODY', 'NETNOU_VISITS_HEADERS',
  // (a title and a description may be set for one language alone)
  ...LANGUAGES.flatMap(([code]) => [`NETNOU_SITE_TITLE_${code.toUpperCase()}`, `NETNOU_SITE_DESCRIPTION_${code.toUpperCase()}`])];
// Words of the operator's own for the page, the same in each of its languages; null for none.
const inAll = (words) => Object.fromEntries(LANGUAGES.map(([code]) => [code, words]));
// What an image carries about its build, which a checkout does not have.
const BUILD = ['NETNOU_COMMIT', 'NETNOU_RELEASE'];

let dir;
let upstream;
let release; // lets the held download of the feed go through
let child;
let output = '';
let port;

function start(settings) {
  const env = { ...process.env };
  for (const name of [...SETTINGS, ...BUILD, 'NODE_TEST_CONTEXT']) delete env[name];
  // (no test asks GitHub for the latest release)
  const proc = spawn(process.execPath, [path.join('server', 'index.js')], { cwd: root, env: { ...env, NETNOU_UPDATE_CHECK: 'off', ...settings }, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  return proc;
}

/** Calls fn until it returns something truthy. */
async function until(fn, what, timeoutMs = 20_000) {
  for (const end = Date.now() + timeoutMs; Date.now() < end;) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${what}\n${output}`);
}

/** One request on a connection of its own, exactly as given: no redirects, no unpacking. */
function request(pathname, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function get(pathname) {
  const res = await request(pathname);
  return { status: res.status, headers: res.headers, json: JSON.parse(res.body) };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-server-'));
  const feed = { zip: makeZip(FEED), etag: '"v1"', realtime: REALTIME, hold: new Promise((resolve) => { release = resolve; }) };
  upstream = await startUpstream(feed);
  child = start({
    NETNOU_PORT: '0',
    NETNOU_HOST: '127.0.0.1',
    NETNOU_DATA_DIR: path.join(dir, 'data'),
    NETNOU_BBOX: BBOX.join(','),
    NETNOU_AREA_NAME: 'Testland',
    NETNOU_TIMEZONE: 'UTC',
    NETNOU_MAP_STYLE_URL: 'https://maps.example.org/styles/day.json',
    NETNOU_MAP_ORIGINS: 'https://tiles.example.org',
    NETNOU_OSM_PBF_URLS: '',
    NETNOU_FEED_URL: `${upstream.url}/feed.zip`,
    NETNOU_REALTIME_URL: `${upstream.url}/realtime.pb`,
    NETNOU_REALTIME_INTERVAL_SECONDS: '10',
    // (given without the slash at its end)
    NETNOU_PUBLIC_URL: 'https://karte.example.org/live',
  });
  child.stdout.on('data', (text) => { output += text; });
  child.stderr.on('data', (text) => { output += text; });
  port = Number((await until(() => /Netnou listening on http:\/\/127\.0\.0\.1:(\d+), area Testland \(49\.3,10\.8,49\.7,11\.3\)/.exec(output), 'the server to listen'))[1]);
});

after(async () => {
  release();
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await once(child, 'exit');
  }
  await upstream?.close();
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('while the timetable is loading the API says so', async () => {
  const loading = await until(async () => {
    const res = await get('/api/vehicles');
    return res.json.state === 'loading' && res;
  }, 'the download to begin');
  assert.equal(loading.status, 503);
  assert.deepEqual(Object.keys(loading.json).sort(), ['message', 'state', 'step']);
  assert.equal(loading.json.step, 'download');
  assert.match(loading.json.message, /^downloading http/);
  assert.equal(loading.headers['cache-control'], 'no-store');
  for (const pathname of ['/api/stations', '/api/search', '/api/line?name=U1&mode=subway&agency=Testbetrieb', '/api/trip?id=T1_20261003', '/api/departures?station=A', '/api/nothing']) {
    assert.equal((await get(pathname)).status, 503, pathname);
  }

  // status and area are always there
  const status = await get('/api/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.timetable.state, 'loading');
  assert.equal(status.json.timetable.step, 'download');
  assert.equal(status.json.timetable.trips, 0);
  assert.equal((await get('/api/area')).status, 200);
  // the page itself as well, and what names nothing whatever the timetable (#198)
  assert.equal((await request('/')).status, 200);
  assert.equal((await request('/stop/alpha@49.4000,11.0000/')).status, 301);
  assert.equal((await request('/foo', { headers: { Accept: 'text/html' } })).status, 404);
});

test('once the feed is imported the API answers', async () => {
  release();
  await until(async () => (await request('/api/stations')).status === 200, 'the import to finish');
  await until(() => /Timetable loaded: 2 trips, 2 stations, 0 routed hops/.test(output), 'the log line');
  // one look, one download; no OSM extract is configured and nobody has asked for vehicles yet
  assert.deepEqual(upstream.requests, { head: 1, get: 1, realtime: 0, osm: 0 });
  // (which the log says at start)
  assert.match(output, /Routes: no OSM extracts set \(NETNOU_OSM_PBF_URLS\), so straight lines between stops and no towns in the search\n/);
  // the download is removed, the dataset stays
  await until(() => fs.readdirSync(path.join(dir, 'data')).join() === 'dataset.bin', 'the data directory to be tidy');
});

test('/api/area', async () => {
  const { status, headers, json } = await get('/api/area');
  assert.equal(status, 200);
  assert.deepEqual(json, {
    siteName: 'Netnou',
    name: 'Testland',
    siteTitle: inAll(null),
    siteDescription: inAll(null),
    bbox: BBOX,
    view: BBOX,
    outline: [[[49.3, 10.8], [49.3, 11.3], [49.7, 11.3], [49.7, 10.8], [49.3, 10.8]]], // [lat, lon]
    timeZone: 'UTC',
    styleUrl: 'https://maps.example.org/styles/day.json',
    tileUrl: null,
    attribution: {
      map: '',
      data: '<a href="https://gtfs.de">GTFS.DE</a> / <a href="https://www.delfi.de">DELFI e.V.</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)',
    },
  });
  assert.equal(headers['cache-control'], 'no-cache');
  const again = await request('/api/area', { headers: { 'If-None-Match': headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
});

test('/api/status', async () => {
  const { status, json } = await get('/api/status');
  assert.equal(status, 200);
  // a checkout is a development build of the version in package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(json.version, `${pkg.version}+dev`);
  assert.equal(json.commit, null);
  assert.equal(json.homepage, pkg.homepage.replace(/#.*$/, ''));
  assert.equal(json.update, null);
  assert.ok(Math.abs(json.now - Date.now() / 1000) < 5);
  const { checkedAt, importedAt, ...timetable } = json.timetable;
  assert.deepEqual(timetable, {
    state: 'ready',
    step: null,
    message: '2 trips, 2 stations, 0 routed hops',
    error: null,
    feedLastModified: 'Sat, 03 Oct 2026 02:00:00 GMT',
    trips: 2,
    validFrom: addDays(today, -3),
    validUntil: addDays(today, 3),
  });
  assert.ok(Math.abs(checkedAt - json.now) < 60);
  assert.ok(!Number.isNaN(Date.parse(importedAt)));
  assert.deepEqual(json.routes, { segments: 0, osmFetchedAt: null });
  assert.deepEqual(Object.keys(json.realtime).sort(), ['error', 'failures', 'feedTimestamp', 'fetchedAt', 'fetches', 'matchedTrips', 'polling']);
  assert.deepEqual(json.area, { name: 'Testland', bbox: BBOX, agencies: null });
  assert.deepEqual(json.view, BBOX);
});

test('/api/vehicles: all of them reduced, a map section in full', async () => {
  // Asking for vehicles starts the realtime polling; wait for the first answer.
  const { status, json: all } = await until(async () => {
    const res = await get('/api/vehicles');
    return res.json.realtime !== null && res;
  }, 'realtime data');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(all).sort(), ['counts', 'kinds', 'now', 'realtime', 'thinned', 'vehicles']);
  // the kinds of transport the timetable has, and the page with a chip for each of them and for no other
  assert.deepEqual(all.kinds, ['subway', 'longdistance']);
  const page = (await request('/')).body.toString();
  assert.deepEqual([...page.matchAll(/<button type="button" class="chip" data-mode="([a-z]+)" aria-pressed="true">/g)].map(([, mode]) => mode), ['subway', 'longdistance']);
  // (so few that nothing is left out, whatever the zoom)
  assert.deepEqual(all.thinned, {});
  assert.ok(Math.abs(all.now - Date.now() / 1000) < 5);
  assert.deepEqual(all.counts, { subway: 2, longdistance: 2 });
  assert.equal(all.vehicles.length, 4);
  for (const v of all.vehicles) {
    assert.deepEqual(Object.keys(v).sort(), ['delay', 'id', 'knots', 'line', 'mode', 'to']);
    // without a map section: where it is now and where in a minute
    assert.equal(v.knots.length, 6, v.id);
    assert.deepEqual([v.knots[0], v.knots[3]], [all.now, all.now + 60]);
  }
  const live = all.vehicles.find((v) => v.id === `T1_${today}`);
  assert.deepEqual({ ...live, knots: null }, { id: `T1_${today}`, line: 'U1', mode: 'subway', to: 'Rundkurs', delay: 120, knots: null });
  // yesterday's run is still under way and has no realtime data
  assert.equal(all.vehicles.find((v) => v.id === `T1_${addDays(today, -1)}`).delay, null);
  assert.deepEqual(all.vehicles.filter((v) => v.id.startsWith('T2_')).map((v) => [v.line, v.mode, v.to]), [['ICE 5', 'longdistance', 'Beta'], ['ICE 5', 'longdistance', 'Beta']]);

  const { json: section } = await get(`/api/vehicles?bbox=${BBOX.join(',')}`);
  assert.deepEqual(section.vehicles.map((v) => v.id).sort(), [`T1_${addDays(today, -1)}`, `T1_${today}`]);
  assert.deepEqual(section.counts, all.counts); // the counts are for the whole area
  for (const v of section.vehicles) {
    // in full: from the last stop to the next, half an hour apart
    assert.ok(v.knots.length >= 6 && v.knots.length % 3 === 0);
    assert.equal(v.knots[3] - v.knots[0], 1800);
    assert.ok(v.knots[1] >= 49.4 && v.knots[1] <= 49.5 && v.knots[2] === 11);
  }
  const { json: lite } = await get(`/api/vehicles?bbox=${BBOX.join(',')}&detail=lite`);
  assert.deepEqual(lite.vehicles.map((v) => v.knots.length), [6, 6]);
  assert.ok(lite.vehicles.every((v) => v.knots[3] - v.knots[0] === 60));

  assert.deepEqual((await get('/api/vehicles?bbox=51,12,53,14')).json.vehicles.map((v) => v.id.slice(0, 3)), ['T2_', 'T2_']);
  // a section that is not one is no section
  for (const bbox of [',,,', '49.3,10.8,49.7', 'here']) {
    const { json } = await get(`/api/vehicles?bbox=${bbox}`);
    assert.equal(json.vehicles.length, 4, bbox);
    assert.ok(json.vehicles.every((v) => v.knots.length === 6), bbox);
  }
});

test('/api/stations', async () => {
  const { status, json } = await get('/api/stations');
  assert.equal(status, 200);
  assert.deepEqual(json, [
    { id: 'A', name: 'Alpha', lat: 49.4, lon: 11, modes: ['subway'] },
    { id: 'B', name: 'Beta', lat: 49.5, lon: 11, modes: ['subway', 'longdistance'] },
  ]);
  assert.deepEqual((await get('/api/stations?bbox=49.39,10.99,49.41,11.01')).json.map((s) => s.id), ['A']);
  assert.equal((await get('/api/stations?bbox=,,,')).json.length, 2);
});

test('/api/search: all stations and lines as columns, sent again only when they have changed', async () => {
  const { status, headers, json } = await get('/api/search');
  assert.equal(status, 200);
  assert.deepEqual(json, {
    modes: ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'ferry', 'cable', 'other'],
    // The places in 1e-5 degrees, each as the difference from the one before
    // (B comes first in the order of the list); a bit for each mode that stops
    // there. T1 stops 51 times at each of the two, T2 once more at B.
    stations: { names: 'Beta\nAlpha', lat: [4950000, -10000], lon: [1100000, 0], modes: [0b100001, 0b000001], service: [52, 51], town: [-1, -1], towns: [], districts: [] },
    // each with its one trip and where that goes; the place is the middle of the stops inside the area
    lines: { name: ['ICE 5', 'U1'], mode: [5, 0], agencies: ['Testbetrieb'], agency: [0, 0], to: [['Beta'], ['Rundkurs']], lat: [4950000, -5000], lon: [1100000, 0], service: [1, 1] },
  });
  assert.equal(headers['cache-control'], 'no-cache');
  const again = await request('/api/search', { headers: { 'If-None-Match': headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal((await request('/api/search', { headers: { 'If-None-Match': '"something-else"' } })).status, 200);
  // (the search happens in the browser: a query is not looked at)
  assert.deepEqual((await get('/api/search?q=alp')).json, json);
});

test('/api/line: the vehicles of one line that are under way, and its stops with them', async () => {
  const { status, json } = await get('/api/line?name=U1&mode=subway&agency=Testbetrieb');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json).sort(), ['agency', 'at', 'mode', 'name', 'now', 'path', 'vehicles', 'ways']);
  assert.deepEqual([json.name, json.mode, json.agency], ['U1', 'subway', 'Testbetrieb']);
  // its place, the middle of its stations, and its address: the only line of its name has none in it (#152)
  assert.deepEqual([json.at, json.path], [[49.45, 11], 'line/testbetrieb/subway/u1']);
  assert.ok(Math.abs(json.now - Date.now() / 1000) < 5);
  // yesterday's run and today's, both somewhere between A and B
  assert.deepEqual(json.vehicles.map((v) => v.id).sort(), [`T1_${addDays(today, -1)}`, `T1_${today}`]);
  for (const v of json.vehicles) {
    assert.deepEqual(Object.keys(v).sort(), ['delay', 'id', 'lat', 'lon', 'next', 'to', 'warnings']);
    // (what is wrong with T1, as the departures have it)
    assert.deepEqual(v.warnings, [{ title: null, text: 'Signalstörung', severity: 'warning' }]);
    assert.equal(v.to, 'Rundkurs');
    assert.ok(['Alpha', 'Beta'].includes(v.next), v.next);
    assert.ok(v.lat >= 49.4 && v.lat <= 49.5 && v.lon === 11);
  }
  assert.equal(json.vehicles.find((v) => v.id === `T1_${today}`).delay, 120);
  // its stops (#256): the shuttle is one way, A and B by turns, each vehicle between two of them, the one ahead its next
  assert.deepEqual(json.ways.map((way) => [way.to, way.stops.length, way.branches]), [['Rundkurs', 102, []]]);
  assert.deepEqual(json.ways[0].stops.slice(0, 3).map((stop) => [stop.id, stop.name, stop.path]), [['A', 'Alpha', 'stop/alpha@49.4000,11.0000'], ['B', 'Beta', 'stop/beta@49.5000,11.0000'], ['A', 'Alpha', 'stop/alpha@49.4000,11.0000']]);
  assert.deepEqual(json.ways[0].vehicles.map((v) => v.id).sort(), json.vehicles.map((v) => v.id).sort());
  for (const v of json.ways[0].vehicles) {
    assert.equal(v.until, v.from + 1);
    assert.equal(json.ways[0].stops[v.until].name, json.vehicles.find((one) => one.id === v.id).next);
    assert.ok(v.come >= 0 && v.come <= 1);
  }
  // opened from a trip, the way it goes
  assert.equal((await get(`/api/line?name=U1&mode=subway&agency=Testbetrieb&trip=T1_${today}`)).json.way, 0);
  assert.equal(json.way, undefined);

  // the ICE is under way too, far outside the area
  const { json: ice } = await get('/api/line?name=ICE%205&mode=longdistance&agency=Testbetrieb');
  assert.deepEqual(ice.vehicles.map((v) => [v.to, v.next, v.warnings]), [['Beta', 'Fern Mitte', []], ['Beta', 'Fern Mitte', []]]);

  // where a line runs, asked for when it is opened (#148): the routes of its trips of the day, each stretch once
  // (straight lines: the test has no route geometry), its stations, and what of it is in the area
  const { json: withRoute } = await get('/api/line?name=U1&mode=subway&agency=Testbetrieb&route=1');
  assert.deepEqual(withRoute.vehicles.map((v) => v.id), json.vehicles.map((v) => v.id));
  // the shuttle there and back again, a hundred times, is one line from A to B and back
  assert.deepEqual(withRoute.route, { paths: [[49.4, 11, 49.5, 11, 49.5, 11, 49.4, 11]], stations: [49.4, 11, 49.5, 11], bounds: [49.4, 11, 49.5, 11] });
  // the ICE all of the way, and to show of it the one station in the area
  const { json: iceRoute } = await get('/api/line?name=ICE%205&mode=longdistance&agency=Testbetrieb&route=1');
  assert.deepEqual(iceRoute.route, { paths: [[52, 13, 51.9, 13, 51.9, 13, 49.5, 11]], stations: [52, 13, 51.9, 13, 49.5, 11], bounds: [49.5, 11, 49.5, 11] });
  // name, mode and agency together are the line
  for (const query of ['name=U1&mode=bus&agency=Testbetrieb', 'name=U1&mode=subway&agency=Anderer', 'name=U2&mode=subway&agency=Testbetrieb', 'name=U1', '']) {
    const res = await get(`/api/line?${query}`);
    assert.equal(res.status, 404, query);
    assert.deepEqual(res.json, { error: 'line not found' });
  }
});

test('/api/trip', async () => {
  const { status, json } = await get(`/api/trip?id=T1_${today}`);
  assert.equal(status, 200);
  const { now, path: line, stops, ...trip } = json;
  assert.deepEqual(trip, {
    id: `T1_${today}`,
    line: 'U1',
    mode: 'subway',
    to: 'Rundkurs',
    agency: 'Testbetrieb',
    lineAt: [49.45, 11],
    realtime: true,
    source: 'Testbetrieb', // from the gtfs.de note, which is not one of the notes
    cancelled: false,
    notes: [{ title: null, text: 'Signalstörung', severity: 'warning' }],
    // its address (#178): its line, its day and where and when it starts, by the clock of the instance (UTC here)
    address: `trip/testbetrieb/subway/u1/${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}/0000-alpha`,
  });
  assert.ok(Math.abs(now - Date.now() / 1000) < 5);
  assert.equal(stops.length, 102);
  assert.equal(line.length, 101 * 4); // no route geometry: a straight line per hop
  const dayStart = Date.parse(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}T00:00:00Z`) / 1000;
  assert.deepEqual(stops[1], { station: 'B', name: 'Beta', town: null, platform: '', lat: 49.5, lon: 11, arr: dayStart + 1800, dep: dayStart + 1800, arrDelay: 120, depDelay: 120, skipped: false, to: 'Rundkurs' });

  // yesterday's run has no delays; notes and source belong to the trip, whatever the day
  const { json: yesterday } = await get(`/api/trip?id=T1_${addDays(today, -1)}`);
  assert.deepEqual([yesterday.realtime, yesterday.stops[0].depDelay, yesterday.source, yesterday.notes], [false, null, 'Testbetrieb', [{ title: null, text: 'Signalstörung', severity: 'warning' }]]);
  const { json: other } = await get(`/api/trip?id=T2_${today}`);
  assert.deepEqual([other.mode, other.agency, other.realtime, other.source, other.notes], ['longdistance', 'Testbetrieb', false, null, []]);

  for (const id of ['T1_19990101', `T9_${today}`, 'T1', '']) {
    const missing = await get(`/api/trip?id=${id}`);
    assert.equal(missing.status, 404, id);
    assert.deepEqual(missing.json, { error: 'trip not found' });
  }
});

test('/api/departures: a station by its place, as /api/search lists it', async () => {
  const byId = await get('/api/departures?station=B');
  const byPlace = await get('/api/departures?at=49.5,11');
  assert.equal(byPlace.status, 200);
  assert.deepEqual({ ...byPlace.json, now: 0 }, { ...byId.json, now: 0 });
  assert.equal(byPlace.json.id, 'B');
  assert.equal((await get('/api/departures?at=49.50000,11.00000')).json.name, 'Beta');
  // no station there, or what is no place
  for (const at of ['49.50001,11', '11,49.5', '49.5', '49.5,11,0', 'here', '']) {
    const missing = await get(`/api/departures?at=${at}`);
    assert.equal(missing.status, 404, at);
    assert.deepEqual(missing.json, { error: 'station not found' });
  }
  // (with a place, an id beside it is not looked at)
  assert.equal((await get('/api/departures?at=49.50001,11&station=B')).status, 404);
});

test('/api/departures', async () => {
  const { status, json } = await get('/api/departures?station=A');
  assert.equal(status, 200);
  const { now, departures, ...board } = json;
  assert.deepEqual(board, { id: 'A', name: 'Alpha', town: null, lat: 49.4, lon: 11, notes: [{ title: 'Aufzug gestört', text: 'Aufzug außer Betrieb', severity: 'info' }] });
  // one an hour from each of the runs under way: four to nine in the next two hours, and as that is fewer than ten, the next ones up to ten (#165)
  const soon = departures.filter((d) => d.planned <= now + 7200).length;
  assert.ok(soon >= 4 && soon <= 9, `${soon} departures in two hours`);
  assert.equal(departures.length, 10);
  for (const d of departures) {
    assert.deepEqual(Object.keys(d).sort(), ['cancelled', 'delay', 'line', 'mode', 'planned', 'platform', 'to', 'trip', 'warnings']);
    // what is wrong with T1 is said of each of its runs, as its notes are; the note about the lift is the station's
    assert.deepEqual(d.warnings, d.trip.startsWith('T1_') ? [{ title: null, text: 'Signalstörung', severity: 'warning' }] : []);
    assert.deepEqual([d.line, d.mode, d.to, d.platform, d.cancelled], ['U1', 'subway', 'Rundkurs', '', false]);
    assert.equal(d.planned % 3600, 0);
    assert.equal(d.delay, d.trip === `T1_${today}` ? 120 : null);
    assert.ok(d.planned + (d.delay ?? 0) >= now - 30 && d.planned <= now + 86_400);
  }
  const times = departures.map((d) => d.planned + (d.delay ?? 0));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(json.lines, undefined);

  // with list=lines, every line of the station with the next departure each way and the address of its page (#255), of all
  // the lines whatever is chosen: here the U1 alone, which goes one way from Alpha
  const listed = (await get('/api/departures?station=A&list=lines&lines=longdistance/ice-5')).json;
  assert.deepEqual(listed.departures, []);
  assert.deepEqual(listed.lines.map(({ name, mode, agency, path }) => ({ name, mode, agency, path })), [{ name: 'U1', mode: 'subway', agency: 'Testbetrieb', path: 'line/testbetrieb/subway/u1' }]);
  assert.deepEqual(listed.lines[0].ways.map((way) => [way.to, way.departure.trip, way.departure.planned]), [['Rundkurs', departures[0].trip, departures[0].planned]]);

  for (const station of ['Z', '']) {
    const missing = await get(`/api/departures?station=${station}`);
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.json, { error: 'station not found' });
  }
  assert.deepEqual((await get('/api/nothing')).json, { error: 'not found' });
});

test('static files: types, revalidation, HEAD, gzip and Brotli', async () => {
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(page.headers['cache-control'], 'no-cache');
  // (the page comes in the language asked for as well, see the next test; a file does not)
  assert.equal(page.headers.vary, 'Accept-Language, Accept-Encoding');
  assert.equal(page.headers['content-encoding'], undefined);
  assert.equal(Number(page.headers['content-length']), page.body.length);
  // index.html with what the instance is written into it, see the next test
  assert.ok(page.body.length > fs.statSync(path.join(root, 'public', 'index.html')).size);
  assert.ok(page.body.includes('<script type="module" src="app.js"></script>'));
  assert.ok((await request('/index.html')).body.equals(page.body));
  // the map is the only thing allowed from elsewhere, and no other site may show the page in a frame
  const map = 'https://maps.example.org https://tiles.example.org';
  const policy = `default-src 'self'; img-src 'self' data: blob: ${map}; style-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' ${map}; frame-ancestors 'none'`;
  assert.equal((await request('/app.js')).headers['content-security-policy'], policy);
  // The page carries its style sheets and its first script, which its own
  // answer allows by their hashes (see the test of the page), and nothing else inline.
  const inline = Object.fromEntries(['first.js', 'style.css', 'vendor/maplibre-gl/maplibre-gl.css'].map((file) => [file, fs.readFileSync(path.join(root, 'public', file), 'utf8')]));
  const hashOf = (text) => `'sha256-${crypto.createHash('sha256').update(text).digest('base64')}'`;
  assert.equal(page.headers['content-security-policy'], policy.replace("style-src 'self'", `style-src 'self' ${hashOf(inline['style.css'])} ${hashOf(inline['vendor/maplibre-gl/maplibre-gl.css'])}`).replace("script-src 'self'", `script-src 'self' ${hashOf(inline['first.js'])}`));
  const text = page.body.toString();
  assert.ok(text.includes(`<script>${inline['first.js']}</script>`));
  for (const file of ['style.css', 'vendor/maplibre-gl/maplibre-gl.css']) assert.ok(text.includes(`<style>${inline[file]}</style>`), file);
  assert.doesNotMatch(text, /<link rel="stylesheet"|<script src="first\.js">/);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');

  const { etag } = page.headers;
  for (const tags of [etag, `W/${etag}`, `"something-else", W/${etag}`, '*']) {
    const unchanged = await request('/', { headers: { 'If-None-Match': tags } });
    assert.equal(unchanged.status, 304, tags);
    assert.equal(unchanged.body.length, 0);
    assert.equal(unchanged.headers.etag, etag);
    assert.equal(unchanged.headers.vary, 'Accept-Language, Accept-Encoding');
  }
  assert.equal((await request('/', { headers: { 'If-None-Match': '"something-else"' } })).status, 200);

  const head = await request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-length'], page.headers['content-length']);
  assert.equal(head.body.length, 0);

  const script = fs.readFileSync(path.join(root, 'public', 'app.js'));
  const packed = await request('/app.js', { headers: { 'Accept-Encoding': 'br, gzip' } });
  assert.equal(packed.status, 200);
  assert.equal(packed.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(packed.headers['content-encoding'], 'gzip');
  assert.equal(packed.headers.vary, 'Accept-Encoding');
  assert.ok(packed.body.length < script.length);
  assert.ok(zlib.gunzipSync(packed.body).equals(script));
  // (packed once and kept)
  assert.ok((await request('/app.js', { headers: { 'Accept-Encoding': 'gzip' } })).body.equals(packed.body));
  // Brotli is made beside the requests: the first one that takes it got gzip, a later one gets the smaller form
  const withBrotli = (pathname, accepted) => until(async () => {
    const answer = await request(pathname, { headers: { 'Accept-Encoding': accepted } });
    return answer.headers['content-encoding'] === 'br' && answer;
  }, `${pathname} with Brotli`);
  const smallest = await withBrotli('/app.js', 'br, gzip');
  assert.equal(smallest.headers.vary, 'Accept-Encoding');
  assert.equal(smallest.headers.etag, packed.headers.etag);
  assert.equal(Number(smallest.headers['content-length']), smallest.body.length);
  assert.ok(smallest.body.length < packed.body.length);
  assert.ok(zlib.brotliDecompressSync(smallest.body).equals(script));
  // (and gzip stays what it was for whoever takes nothing else)
  assert.ok((await request('/app.js', { headers: { 'Accept-Encoding': 'gzip, deflate' } })).body.equals(packed.body));
  // the page itself likewise, asked for as a browser asks
  assert.ok(zlib.brotliDecompressSync((await withBrotli('/', 'gzip, deflate, br, zstd')).body).equals(page.body));
  // A coding with the weight 0 is not to be used, and "*" is any coding not named (RFC 9110, 12.5.3, #199)
  for (const [accepted, encoding] of [['gzip;q=0, identity', undefined], ['br;q=0, gzip;q=0', undefined], ['br;q=0, gzip', 'gzip'], ['BR; Q=0, *', 'gzip'], ['*', 'br'], ['*;q=0, deflate', undefined], ['gzip;q=0.000', undefined], ['gzip;q=0.001', 'gzip'], ['x-gzip', 'gzip']]) {
    assert.equal((await request('/app.js', { headers: { 'Accept-Encoding': accepted } })).headers['content-encoding'], encoding, accepted);
  }
  // (and an answer compressed for itself alone, such as the page of a stop)
  for (const [accepted, encoding] of [['gzip', 'gzip'], ['gzip;q=0', undefined]]) {
    assert.equal((await request('/stop/alpha@49.4000,11.0000', { headers: { 'Accept-Encoding': accepted } })).headers['content-encoding'], encoding, accepted);
  }
  // the map library is modules, which browsers only run with the type of a script
  assert.equal((await request('/vendor/maplibre-gl/maplibre-gl-worker.mjs')).headers['content-type'], 'text/javascript; charset=utf-8');
  const plain = await request('/app.js');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.ok(plain.body.equals(script));

  const icon = await request('/icons/icon-192.png', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.deepEqual([icon.status, icon.headers['content-type'], icon.headers['content-encoding'], icon.headers.vary], [200, 'image/png', undefined, undefined]);
});

test('the page says what and where the instance is before any script runs', async () => {
  const text = async (pathname) => (await request(pathname)).body.toString();
  const address = 'https://karte.example.org/live/';
  // in the main language, German unless NETNOU_LANGUAGE says otherwise
  const page = await text('/');
  assert.match(page, /<html lang="de"[ >]/);
  assert.match(page, /<title>ÖPNV-Live-Karte: Testland – Netnou<\/title>/);
  assert.match(page, /<meta name="description" content="Testland: Busse, /);
  assert.match(page, /<p id="area-name">Testland<\/p>/);
  // the stations its search suggests near the first view, each a link to its page (#257): Beta, at which more kinds stop, before Alpha
  assert.equal(/<ul class="search-results" id="search-results"[^>]*>(.*?)<\/ul>/s.exec(page)[1], '<li class="search-heading" role="presentation">In der Nähe</li>'
    + '<li role="option" aria-selected="false"><a href="stop/beta@49.5000,11.0000">Beta</a></li><li role="option" aria-selected="false"><a href="stop/alpha@49.4000,11.0000">Alpha</a></li>');
  // (and the header card, which a visitor sees before the scripts have run)
  assert.ok(page.includes('<span id="status-text" data-i18n="status.connecting">Verbinde …</span>'));
  assert.ok(page.includes(`<link rel="canonical" href="${address}">`));
  assert.ok(page.includes(`<link rel="alternate" hreflang="en" href="${address}?lang=en">`));
  // (the icons by addresses with the versions of their files, see versionsOfFiles)
  const version = (file) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'public', file))).digest('hex').slice(0, 10);
  assert.ok(page.includes(`<meta property="og:image" content="${address}icons/icon-512.png?v=${version('icons/icon-512.png')}">`));
  assert.ok(page.includes(`<link rel="icon" href="favicon.svg?v=${version('favicon.svg')}" type="image/svg+xml">`));
  assert.ok(page.includes(`<link rel="apple-touch-icon" href="icons/apple-touch-icon.png?v=${version('icons/apple-touch-icon.png')}">`));
  assert.equal((await request(`/icons/icon-512.png?v=${version('icons/icon-512.png')}`)).status, 200);
  assert.deepEqual((await get('/manifest.webmanifest')).json.icons.map((icon) => icon.src), ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'favicon.svg'].map((file) => `${file}?v=${version(file)}`));
  // (and where a page names none, or a search engine asks all the same: the icon of the app)
  const ico = await request('/favicon.ico');
  assert.deepEqual([ico.status, ico.headers['content-type']], [200, 'image/png']);
  assert.ok(ico.body.equals(fs.readFileSync(path.join(root, 'public/icons/icon-192.png'))));

  // in the language the address asks for
  const english = await request('/?lang=en');
  assert.match(english.body.toString(), /<html lang="en"[ >]/);
  assert.match(english.body.toString(), /<title>Live map of public transport: Testland – Netnou<\/title>/);
  assert.ok(english.body.toString().includes('<span id="status-text" data-i18n="status.connecting">Connecting …</span>'));
  assert.ok(english.body.toString().includes(`<link rel="canonical" href="${address}?lang=en">`));
  assert.equal((await request('/?lang=en', { headers: { 'If-None-Match': english.headers.etag } })).status, 304);
  // each version has its own tag: one is not taken for the other
  assert.equal((await request('/', { headers: { 'If-None-Match': english.headers.etag } })).status, 200);
  // a language the page does not have is none
  assert.equal(await text('/?lang=xx'), page);
  assert.equal(await text('/?lang='), page);

  // Without a language in the address: in the one the browser asks for, so
  // that the page comes as its visitor gets it. It is still the page of the
  // plain address, and says that it depends on who asks.
  const asking = (pathname, languages, headers = {}) => request(pathname, { headers: { 'Accept-Language': languages, ...headers } });
  const forEnglish = await asking('/', 'en-US,en;q=0.9');
  assert.match(forEnglish.body.toString(), /<html lang="en"[ >]/);
  assert.match(forEnglish.body.toString(), /<title>Live map of public transport: Testland – Netnou<\/title>/);
  assert.ok(forEnglish.body.toString().includes('<span id="status-text" data-i18n="status.connecting">Connecting …</span>'));
  assert.ok(forEnglish.body.toString().includes(`<link rel="canonical" href="${address}">`));
  assert.ok(forEnglish.body.toString().includes(`<meta property="og:url" content="${address}">`));
  assert.equal(forEnglish.headers.vary, 'Accept-Language, Accept-Encoding');
  assert.equal((await asking('/index.html', 'en')).body.toString(), forEnglish.body.toString());
  // a German browser gets what a visitor without a word on languages gets, a search engine for one
  const forGerman = await asking('/', 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7');
  assert.equal(forGerman.body.toString(), page);
  assert.equal(forGerman.headers.vary, 'Accept-Language, Accept-Encoding');
  assert.equal((await request('/')).headers.vary, 'Accept-Language, Accept-Encoding');
  assert.equal((await asking('/', '*')).body.toString(), page);
  // a browser of a language the page does not have gets English, as from the script
  assert.equal((await asking('/', 'xx-XX,xx;q=0.9')).body.toString(), forEnglish.body.toString());
  // each has its tag, and an answer that has not changed says what it depends on too
  assert.notEqual(forEnglish.headers.etag, forGerman.headers.etag);
  assert.notEqual(forEnglish.headers.etag, english.headers.etag);
  const unchanged = await asking('/', 'en', { 'If-None-Match': forEnglish.headers.etag });
  assert.deepEqual([unchanged.status, unchanged.headers.vary], [304, 'Accept-Language, Accept-Encoding']);
  assert.equal((await asking('/', 'de', { 'If-None-Match': forEnglish.headers.etag })).status, 200);
  // the address wins over the browser, and its page is the same for all
  const askedGerman = await asking('/?lang=de', 'en-US,en;q=0.9');
  assert.match(askedGerman.body.toString(), /<html lang="de"[ >]/);
  assert.equal(askedGerman.headers.vary, 'Accept-Encoding');
  assert.equal(english.headers.vary, 'Accept-Encoding');
  assert.equal((await request('/?lang=en', { headers: { 'If-None-Match': english.headers.etag } })).headers.vary, 'Accept-Encoding');

  // the installed app: named as the instance, in its language, sent again only when it has changed
  const manifest = await get('/manifest.webmanifest');
  assert.deepEqual([manifest.status, manifest.headers['content-type'], manifest.headers['cache-control']], [200, 'application/manifest+json', 'no-cache']);
  assert.deepEqual([manifest.json.name, manifest.json.short_name, manifest.json.lang], ['Netnou', 'Netnou', 'de']);
  assert.match(manifest.json.description, /^Testland: Busse, /);
  assert.equal(manifest.json.icons.length, JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8')).icons.length);
  assert.equal((await request('/manifest.webmanifest', { headers: { 'If-None-Match': manifest.headers.etag } })).status, 304);

  const robots = await request('/robots.txt');
  assert.deepEqual([robots.status, robots.headers['content-type']], [200, 'text/plain; charset=utf-8']);
  assert.equal(robots.body.toString(), `User-agent: *\nAllow: /\n\nSitemap: ${address}sitemap.xml\n`);
  const sitemap = await request('/sitemap.xml');
  assert.deepEqual([sitemap.status, sitemap.headers['content-type']], [200, 'application/xml; charset=utf-8']);
  assert.deepEqual([...sitemap.body.toString().matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => loc), [address, `${address}?lang=de`, `${address}?lang=en`, `${address}stop/alpha@49.4000,11.0000`, `${address}stop/beta@49.5000,11.0000`, `${address}line/testbetrieb/subway/u1`, `${address}line/testbetrieb/longdistance/ice-5`]);

  // data may be read by a search engine that runs the page, but is not for its results
  for (const pathname of ['/api/area', '/api/status', '/api/vehicles', '/api/search', '/api/stations', '/api/nothing']) {
    assert.equal((await request(pathname)).headers['x-robots-tag'], 'noindex', pathname);
  }
  for (const pathname of ['/', '/app.js', '/robots.txt']) assert.equal((await request(pathname)).headers['x-robots-tag'], undefined, pathname);
});

test('the address of a stop or a line is a page of its own, found again by its name and its place (#37)', async () => {
  const address = 'https://karte.example.org/live/';
  // the page of a stop: its title and description, its address as its own, its details open, the page's files one step up
  const alpha = await request('/stop/alpha@49.4000,11.0000');
  const page = alpha.body.toString();
  assert.deepEqual([alpha.status, alpha.headers['x-robots-tag']], [200, undefined]);
  assert.match(page, /<meta charset="utf-8">\n {2}<base href="\.\.\/">\n/);
  assert.match(page, /<title>Abfahrten Alpha live – Netnou<\/title>/);
  assert.match(page, /<meta name="description" content="Abfahrten an der Haltestelle Alpha in Echtzeit: U1, live auf der Karte\.">/);
  assert.ok(page.includes(`<link rel="canonical" href="${address}stop/alpha@49.4000,11.0000">`));
  assert.ok(page.includes(`<link rel="alternate" hreflang="en" href="${address}stop/alpha@49.4000,11.0000?lang=en">`));
  assert.match(page, /<aside class="card panel" id="panel" tabindex/);
  // its details as the page shows them, its departures at this moment (#254): its name the main heading of the page, not the instance's
  assert.ok(page.includes('<div id="panel-head"><div class="panel-head"><h1>Alpha</h1><p class="sub with-choice"><span class="view-switch" role="group" aria-label="Ansicht"><button type="button" aria-pressed="true" data-view="departures">Nächste Abfahrten</button><button type="button" aria-pressed="false" data-view="lines">Alle Linien</button></span><span class="choice"><button type="button" class="choice-open" aria-label="Filter"'));
  // and behind the switch all its lines, each a link to its page (#255)
  assert.ok(page.includes('<div class="view-lines" hidden><ul class="line-rows signed"><li><a class="to-line" href="line/testbetrieb/subway/u1" aria-label="Zur Linie U1" title="Zur Linie U1" data-line='));
  assert.match(page, /<div id="panel-body" data-sent><ul class="rows signed"><li><button type="button" class="row departure times-both" data-trip="T1_\d{8}"><span class="time">\d\d:\d\d<\/span>/);
  assert.ok(page.includes('<span class="badge" data-mode="subway">U1</span><span class="name" title="Rundkurs">Rundkurs</span>'));
  assert.ok(page.includes('<div class="site-name">Netnou</div>'));
  assert.deepEqual(page.match(/<h1\b/g), ['<h1']);
  // (the same page while the minute is the same: asked again with its ETag, not sent again)
  const again = async () => (await request('/stop/alpha@49.4000,11.0000', { headers: { 'If-None-Match': (await request('/stop/alpha@49.4000,11.0000')).headers.etag } })).status;
  assert.ok((await again()) === 304 || (await again()) === 304);
  // the stop with two kinds of transport, in English
  const beta = (await request('/stop/beta@49.5000,11.0000?lang=en')).body.toString();
  assert.match(beta, /<title>Beta departures live – Netnou<\/title>/);
  assert.match(beta, /content="Departures at Beta in real time: U1, ICE 5, live on the map\."/);

  // moved a little, in capitals, or under another name at its place: sent on to the address it has, with the settings of the page
  for (const asked of ['/stop/alpha@49.4010,11.0010', '/stop/ALPHA@49.4000,11.0000', '/STOP/alpha@49.4000,11.0000', '/stop/gamma@49.4000,11.0000?lang=en']) {
    const moved = await request(asked);
    assert.deepEqual([moved.status, moved.headers.location], [301, `../stop/alpha@49.4000,11.0000${asked.includes('?') ? '?lang=en' : ''}`], asked);
  }
  // with a slash at its end, or more: sent on to the address without, from where the browser is (the instance may be at a path of its own, #198)
  for (const [asked, to] of [['/stop/alpha@49.4000,11.0000/', '/stop/alpha@49.4000,11.0000'], ['/stop/alpha@49.4000,11.0000//?lang=en', '/stop/alpha@49.4000,11.0000?lang=en'], ['/line/testbetrieb/subway/u1/', '/line/testbetrieb/subway/u1'], ['/LINE/testbetrieb/subway/u1/', '/LINE/testbetrieb/subway/u1']]) {
    const moved = await request(asked);
    assert.equal(moved.status, 301, asked);
    assert.equal(new URL(moved.headers.location, `https://karte.example.org/live${asked}`).href, `https://karte.example.org/live${to}`, asked);
  }
  assert.equal((await request('/stop/alpha@49.4000,11.0000/')).headers.location, '../../stop/alpha@49.4000,11.0000');
  // nothing of that name nearby, and no stop at its place: the page says so, and is not to be listed
  for (const asked of ['/stop/alpha@49.4200,11.0000', '/stop/nirgends@48.0000,10.0000', '/stop/kaputt']) {
    const gone = await request(asked);
    assert.deepEqual([gone.status, gone.headers['x-robots-tag']], [404, 'noindex'], asked);
    assert.ok(gone.body.toString().includes('<div id="panel-body"><p class="panel-empty">Diese Haltestelle ist nicht im Fahrplan.</p></div>'), asked);
    assert.match(gone.body.toString(), /<meta name="robots" content="noindex">/);
  }

  // the page of a line: by its operator, its kind and its name, three steps deep
  const line = (await request('/line/testbetrieb/subway/u1')).body.toString();
  assert.match(line, /<base href="\.\.\/\.\.\/\.\.\/">/);
  assert.match(line, /<title>U1 Rundkurs live – Netnou<\/title>/);
  assert.match(line, /content="U1 \(Testbetrieb\) live auf der Karte, jede Fahrt mit ihrer Verspätung\."/);
  // its details as the page shows them (#254): its stops, each a link to its page, and its vehicles under way along them
  // at this moment (#256)
  assert.match(line, /<div class="panel-head"><h1><span class="badge" data-mode="subway">U1<\/span><span>U-Bahn<\/span><\/h1><p class="sub">Testbetrieb · \d Fahrzeuge unterwegs<\/p><\/div>/);
  assert.ok(line.includes('<div id="panel-body" data-sent><div class="line-body"><ul class="line-stops" data-mode="subway"><li class="on-line station first"><a class="row on-line" href="stop/alpha@49.4000,11.0000" data-station="A" title="Alpha">'));
  assert.equal(line.match(/<g class="line-vehicle" transform="translate\(36\.0 [\d.]+\)" data-trip="T1_\d{8}" role="button" tabindex="0" aria-label="U1 nach Rundkurs[^"]*" data-mode="subway" data-track="[\d.,]+">/g).length, 2);
  const otherKind = await request('/line/testbetrieb/bus/u1');
  assert.equal(otherKind.status, 404);
  assert.ok(otherKind.body.toString().includes('Diese Linie ist nicht im Fahrplan.'));

  // what an address names, for the page that is at it
  assert.deepEqual((await get('/api/address?path=stop/alpha@49.4010,11.0010')).json, { type: 'stop', name: 'Alpha', lat: 49.4, lon: 11, path: 'stop/alpha@49.4000,11.0000' });
  // (with the place of the line: the middle of the three stations of the ICE, for the page to ask for it by)
  assert.deepEqual((await get('/api/address?path=line/testbetrieb/longdistance/ice-5')).json, { type: 'line', name: 'ICE 5', mode: 'longdistance', agency: 'Testbetrieb', at: [51.13333, 12.33333], path: 'line/testbetrieb/longdistance/ice-5' });
  for (const path of ['stop/nirgends@48.0000,10.0000', 'line/anders/subway/u1', 'nothing']) assert.equal((await get(`/api/address?path=${encodeURIComponent(path)}`)).status, 404, path);

  // The address of a trip (#178): its run of the day, found by its line and where and when it starts.
  const day = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}`;
  const run = `trip/testbetrieb/subway/u1/${day}/0000-alpha`;
  assert.deepEqual((await get(`/api/address?path=${encodeURIComponent(run)}`)).json, { type: 'trip', id: `T1_${today}`, path: run });
  // (its first stop has another name now: the one run of the line that leaves then)
  assert.deepEqual((await get(`/api/address?path=${encodeURIComponent(run.replace(/alpha$/, 'anders'))}`)).json.path, run);
  // its page, for previews of a shared link; it lives for its day, so not for search engines
  const tripPage = await request(`/${run}`, { headers: { 'Accept-Language': 'de-DE' } });
  assert.equal(tripPage.status, 200);
  assert.equal(tripPage.headers['x-robots-tag'], 'noindex');
  const tripBody = tripPage.body.toString();
  assert.match(tripBody, /<base href="\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/">/);
  assert.match(tripBody, /<title>U1 nach Rundkurs live – Netnou<\/title>/);
  assert.match(tripBody, /content="U1 nach Rundkurs, ab Alpha um 00:00 am \d+\. \p{L}+: live auf der Karte, mit der Verspätung an jedem Halt\."/u);
  assert.match(tripBody, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(tripBody, /rel="canonical"/);
  // (its name and where it goes in its details, as their main heading; the rest comes with the script)
  assert.ok(tripBody.includes('<div id="panel-head"><div class="panel-head"><h1>U1</h1><p class="sub">nach Rundkurs</p></div></div>'));
  // another time, or a day the timetable does not have: no trip
  for (const path of [run.replace('/0000-', '/0100-'), `trip/testbetrieb/subway/u1/2031-01-01/0000-alpha`, run.replace('/subway/', '/bus/')]) {
    assert.equal((await get(`/api/address?path=${encodeURIComponent(path)}`)).status, 404, path);
  }
  const gone = await request('/trip/testbetrieb/subway/u1/2031-01-01/0000-alpha', { headers: { 'Accept-Language': 'de-DE' } });
  assert.equal(gone.status, 404);
  assert.ok(gone.body.toString().includes('Diese Fahrt ist nicht im Fahrplan.'));
  // (with a slash at its end too)
  assert.deepEqual(await request(`/${run}/`).then((res) => [res.status, res.headers.location]), [301, `../../../../../../${run}`]);
});

test('what is not there, not allowed or not a URL', async () => {
  // nothing outside public/ is served, however the path is spelled
  for (const pathname of ['/missing.html', '/icons', '/../package.json', '/..%2fpackage.json', '/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/..%5c..%5cpackage.json', '/icons/..%2f..%2fserver/index.js', '/package.json/..%2f..%2fpackage.json']) {
    const res = await request(pathname);
    assert.equal(res.status, 404, pathname);
    assert.deepEqual(JSON.parse(res.body), { error: 'not found' });
  }
  // A path that begins with "//", or has a slash twice in a row anywhere, is a path: sent on to its clean form (#198)
  for (const [asked, to] of [['//app.js', '/app.js'], ['//', '/'], ['//?lang=en', '/?lang=en'], ['/icons//icon-192.png', '/icons/icon-192.png'], ['//api/area', '/api/area'], ['//package.json/..%2f..%2fpackage.json', '/package.json/..%2f..%2fpackage.json']]) {
    const res = await request(asked);
    assert.equal(res.status, 301, asked);
    assert.equal(new URL(res.headers.location, `https://karte.example.org/live${asked}`).href, `https://karte.example.org/live${to}`, asked);
  }
  // A browser that asks for a page where there is none gets the page, saying that there is none, with its own files as
  // many steps up as the path is deep; the API and files answer a script with data
  const asPage = { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  for (const [pathname, base] of [['/foo', ''], ['/stop', ''], ['/stops/alpha', '../'], ['/missing/deeper/', '../../'], ['/..%2fpackage.json', '']]) {
    const res = await request(pathname, { headers: asPage });
    assert.deepEqual([res.status, res.headers['content-type'], res.headers['x-robots-tag'], res.headers.vary], [404, 'text/html; charset=utf-8', 'noindex', 'Accept, Accept-Language, Accept-Encoding'], pathname);
    const page = res.body.toString();
    assert.ok(page.includes(`<meta charset="utf-8">\n  <base href="${base}">\n`), pathname);
    assert.ok(page.includes('<div id="panel-body"><p class="panel-empty">Diese Seite gibt es nicht.</p></div>'), pathname);
    assert.match(page, /<meta name="robots" content="noindex">/);
  }
  const english = await request('/foo?lang=en', { headers: asPage });
  assert.deepEqual([english.status, english.headers.vary], [404, 'Accept, Accept-Encoding']);
  assert.ok(english.body.toString().includes('This page does not exist.'));
  for (const [pathname, headers] of [['/api/nothing', asPage], ['/foo', { Accept: '*/*' }], ['/missing.js', {}]]) {
    const res = await request(pathname, { headers });
    assert.deepEqual([res.status, res.headers['content-type']], [404, 'application/json; charset=utf-8'], pathname);
  }
  const malformed = await request('/%E0%A4%A');
  assert.deepEqual([malformed.status, malformed.body.length], [400, 0]);
  for (const pathname of ['/', '/api/vehicles']) {
    const post = await request(pathname, { method: 'POST' });
    assert.deepEqual([post.status, post.headers.allow], [405, 'GET, HEAD'], pathname);
  }
  // none of this is worth a line in the log
  assert.doesNotMatch(output, /Error handling/);
});

test('the server stops when asked to', async () => {
  // 'close' rather than 'exit': by then everything the process wrote has been read
  const closed = once(child, 'close');
  child.kill('SIGTERM');
  const [code, signal] = await closed;
  // Windows has no signals: there the process is simply ended.
  if (process.platform === 'win32') {
    assert.equal(signal, 'SIGTERM');
  } else {
    assert.equal(code, 0);
    assert.match(output, /SIGTERM received, shutting down/);
  }
});

// (the server of the tests above knows its address and is therefore one that may be listed)
test('an instance that is not to be listed says so with every answer', async () => {
  // (the second one also has a name, a title, a description, links and files of its own)
  const brand = path.join(dir, 'brand');
  fs.mkdirSync(brand);
  fs.writeFileSync(path.join(brand, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(brand, 'preview.png'), 'not really a picture');
  for (const [settings, address] of [[{}, null], [{ NETNOU_PUBLIC_URL: 'https://test.example.org/', NETNOU_SEARCH_ENGINES: 'off', NETNOU_SITE_NAME: 'Bus & Bahn live', NETNOU_SITE_TITLE: 'Wo ist mein Bus? Testland live', NETNOU_SITE_TITLE_EN: 'Where is my bus? Testland live', NETNOU_SITE_DESCRIPTION: 'Busse & Bahnen in Testland,\n live auf der Karte.', NETNOU_LINKS: 'Impressum=/impressum', NETNOU_BRAND_DIR: brand }, 'https://test.example.org/']]) {
    const proc = start({ NETNOU_PORT: '0', NETNOU_HOST: '127.0.0.1', NETNOU_DATA_DIR: path.join(dir, 'unlisted'), NETNOU_BBOX: BBOX.join(','), NETNOU_FEED_URL: `${upstream.url}/feed.zip`, NETNOU_REALTIME_URL: `${upstream.url}/realtime.pb`, ...settings });
    let text = '';
    proc.stdout.on('data', (chunk) => { text += chunk; });
    proc.stderr.on('data', (chunk) => { text += chunk; });
    try {
      port = Number((await until(() => /Netnou listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(text), 'the second server to listen'))[1]);
      for (const pathname of ['/', '/?lang=en', '/app.js', '/icons/icon-192.png', '/robots.txt', '/api/status', '/nothing-there']) {
        assert.equal((await request(pathname)).headers['x-robots-tag'], 'noindex', `${pathname} with ${JSON.stringify(settings)}`);
      }
      const page = (await request('/')).body.toString();
      assert.ok(page.includes('<meta name="robots" content="noindex">'));
      assert.ok(!page.includes('rel="canonical"') && !page.includes('hreflang'));
      // a link to it still shows what it is, with a picture if it knows its address
      assert.ok(page.includes(`<meta property="og:title" content="${settings.NETNOU_SITE_TITLE ?? 'ÖPNV-Live-Karte – Netnou'}">`));
      // a title and a description of its own: in the page, for the script and for the installed app, as they are
      const area = (await get('/api/area')).json;
      assert.deepEqual([area.siteTitle, area.siteDescription], settings.NETNOU_SITE_TITLE ? [{ ...inAll('Wo ist mein Bus? Testland live'), en: 'Where is my bus? Testland live' }, inAll('Busse & Bahnen in Testland, live auf der Karte.')] : [inAll(null), inAll(null)]);
      // (the title has one for English alone: at the English address, and for a browser that asks for English; the description is the one for all)
      for (const english of [(await request('/?lang=en')).body.toString(), (await request('/', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } })).body.toString()]) {
        assert.equal(english.includes('<title>Where is my bus? Testland live</title>'), Boolean(settings.NETNOU_SITE_TITLE_EN));
        assert.equal(english.includes('<meta property="og:title" content="Where is my bus? Testland live">'), Boolean(settings.NETNOU_SITE_TITLE_EN));
        assert.equal(english.includes('<meta name="description" content="Busse &#38; Bahnen in Testland, live auf der Karte.">'), Boolean(settings.NETNOU_SITE_DESCRIPTION));
      }
      assert.equal(page.includes('<title>Wo ist mein Bus? Testland live</title>'), Boolean(settings.NETNOU_SITE_TITLE));
      assert.equal(page.includes('<meta name="description" content="Busse &#38; Bahnen in Testland, live auf der Karte.">'), Boolean(settings.NETNOU_SITE_DESCRIPTION));
      assert.equal((await get('/manifest.webmanifest')).json.description, settings.NETNOU_SITE_DESCRIPTION ? 'Busse & Bahnen in Testland, live auf der Karte.' : 'Live-Karte des öffentlichen Nahverkehrs: Busse, Straßenbahnen, U-, S- und Regionalbahnen mit aktuellen Verspätungen.');
      // what it calls itself: in the heading, for the script and for the installed app
      assert.ok(page.includes(`<h1>${settings.NETNOU_SITE_NAME ? 'Bus &#38; Bahn live' : 'Netnou'}</h1>`));
      assert.equal((await get('/api/area')).json.siteName, settings.NETNOU_SITE_NAME ?? 'Netnou');
      assert.equal((await get('/manifest.webmanifest')).json.name, settings.NETNOU_SITE_NAME ?? 'Netnou');
      assert.equal(page.includes('<a href="/impressum">Impressum</a></nav>'), Boolean(settings.NETNOU_LINKS));
      assert.equal(/<nav class="links"[^>]* hidden>/.test(page), !settings.NETNOU_LINKS);
      assert.equal(page.includes('og:image'), address !== null);
      if (address) assert.ok(page.includes(`<meta property="og:image" content="${address}preview.png?v=${crypto.createHash('sha1').update('not really a picture').digest('hex').slice(0, 10)}">`));
      // files of its own take the place of the built-in ones of that name, and of those alone
      const builtIn = (name) => fs.readFileSync(path.join(root, 'public', name));
      const icon = await request('/favicon.svg');
      assert.equal(icon.headers['content-type'], 'image/svg+xml');
      assert.equal(icon.body.equals(builtIn('favicon.svg')), !settings.NETNOU_BRAND_DIR);
      if (settings.NETNOU_BRAND_DIR) assert.equal(icon.body.toString(), '<svg xmlns="http://www.w3.org/2000/svg"/>');
      // (named by the version of the file that is served: an icon of the operator's own has another address than the built-in one)
      const served = crypto.createHash('sha1').update(icon.body).digest('hex').slice(0, 10);
      assert.ok(page.includes(`<link rel="icon" href="favicon.svg?v=${served}" type="image/svg+xml">`));
      assert.ok((await get('/manifest.webmanifest')).json.icons.some((entry) => entry.src === `favicon.svg?v=${served}`));
      assert.ok((await request('/icons/icon-192.png')).body.equals(builtIn('icons/icon-192.png')));
      const preview = await request('/preview.png');
      assert.deepEqual([preview.status, preview.headers['content-type']], settings.NETNOU_BRAND_DIR ? [200, 'image/png'] : [404, 'application/json; charset=utf-8']);
      assert.equal(text.includes('Own files from '), Boolean(settings.NETNOU_BRAND_DIR));
      // it may be read, or nobody would see the request; but it is not handed out
      assert.equal((await request('/robots.txt')).body.toString(), 'User-agent: *\nAllow: /\n');
      assert.equal((await request('/sitemap.xml')).status, 404);
    } finally {
      proc.kill();
      await once(proc, 'exit');
    }
  }
});

test('an instance of all of Germany says what it covers once it has a timetable', async () => {
  let go;
  const feed = { zip: makeZip(FEED), etag: '"v1"', realtime: REALTIME, hold: new Promise((resolve) => { go = resolve; }) };
  const other = await startUpstream(feed);
  // (without the extract of Germany, which is not downloaded in a test)
  const proc = start({ NETNOU_PORT: '0', NETNOU_HOST: '127.0.0.1', NETNOU_DATA_DIR: path.join(dir, 'all'), NETNOU_AREA: 'Germany', NETNOU_AGENCIES: 'TESTBETRIEB', NETNOU_OSM_PBF_URLS: '', NETNOU_TIMEZONE: 'UTC', NETNOU_FEED_URL: `${other.url}/feed.zip`, NETNOU_REALTIME_URL: `${other.url}/realtime.pb` });
  const germany = [47.27, 5.87, 55.06, 15.04];
  let text = '';
  proc.stdout.on('data', (chunk) => { text += chunk; });
  proc.stderr.on('data', (chunk) => { text += chunk; });
  try {
    port = Number((await until(() => /Netnou listening on http:\/\/127\.0\.0\.1:(\d+), the whole feed \(Deutschland\), operators: TESTBETRIEB\n/.exec(text), 'the server of all of Germany to listen'))[1]);
    // While the timetable is on its way nobody knows where its stops are:
    // the area is asked for in vain, as everything is but the status.
    const loading = await until(async () => {
      const res = await get('/api/area');
      return res.json.state === 'loading' && res;
    }, 'the download to begin');
    assert.equal(loading.status, 503);
    assert.deepEqual(Object.keys(loading.json).sort(), ['message', 'state', 'step']);
    const before = (await get('/api/status')).json;
    assert.deepEqual([before.area, before.view], [{ name: 'Deutschland', bbox: null, agencies: ['TESTBETRIEB'] }, germany]);
    assert.equal((await request('/')).status, 200);

    go();
    const area = await until(async () => {
      const res = await get('/api/area');
      return res.status === 200 && res;
    }, 'the import to finish');
    // the rectangle around all its stops, also those far from the others; the border of the country to draw, as [lat, lon]
    const around = [49.4, 11, 52, 13];
    assert.deepEqual([area.json.bbox, area.json.view, area.json.name], [around, germany, 'Deutschland']);
    const border = JSON.parse(fs.readFileSync(new URL('../server/areas/germany.geojson', import.meta.url), 'utf8')).outline;
    assert.deepEqual(area.json.outline, border.map((ring) => ring.map(([lon, lat]) => [lat, lon])));
    const after = (await get('/api/status')).json;
    assert.deepEqual([after.area, after.view], [{ name: 'Deutschland', bbox: around, agencies: ['TESTBETRIEB'] }, germany]);
    assert.equal(after.timetable.trips, 2);
    // every station is one of its own
    assert.deepEqual((await get('/api/stations')).json.map((station) => station.id).sort(), ['A', 'B', 'X', 'Y']);
    assert.equal((await get('/api/departures?station=X')).status, 200);
    // and the answer is kept by the browser until another timetable says otherwise
    assert.equal((await request('/api/area', { headers: { 'If-None-Match': area.headers.etag } })).status, 304);
  } finally {
    go();
    proc.kill();
    await once(proc, 'exit');
    await other.close();
  }
});

test('a zoomed-out map of a large instance is thinned out', async () => {
  // 2,605 buses side by side over 150 km, five of them of line 2, a bus far
  // from all others and a regional train, each under way at any time and for
  // yesterday's service day once more: twice what a screen is to hold.
  const buses = 2605;
  const lines = {
    stops: ['stop_id,stop_name,stop_lat,stop_lon', 'X,Nord,49.45,9.5', 'Y,Süd,49.35,9.5', 'F,Fern,52.00,14.00', 'G,Ferner,52.01,14.00'],
    trips: ['route_id,service_id,trip_id', 'RE,DAILY,TRAIN', 'B3,DAILY,ALONE'],
    times: ['trip_id,arrival_time,departure_time,stop_id,stop_sequence', 'TRAIN,0:00:00,0:00:00,X,0', 'TRAIN,72:00:00,72:00:00,Y,1', 'ALONE,0:00:00,0:00:00,F,0', 'ALONE,72:00:00,72:00:00,G,1'],
  };
  for (let i = 0; i < buses; i++) {
    const lon = (9 + (2 * i) / buses).toFixed(5);
    lines.stops.push(`A${i},Anfang ${i},49.40,${lon}`, `B${i},Ende ${i},49.41,${lon}`);
    lines.trips.push(`${i < 5 ? 'B2' : 'B1'},DAILY,BUS${i}`);
    // (the buses of line 2 all end at the same stop: trips that share no stop are lines of their own, #152)
    lines.times.push(`BUS${i},0:00:00,0:00:00,A${i},0`, `BUS${i},72:00:00,72:00:00,B${i < 5 ? 0 : i},1`);
  }
  const feed = {
    zip: makeZip({
      'agency.txt': FEED['agency.txt'],
      'stops.txt': lines.stops.join('\n'),
      'routes.txt': 'route_id,agency_id,route_short_name,route_type\nB1,1,1,3\nB2,1,2,3\nB3,1,3,3\nRE,1,RE 1,2\n',
      'trips.txt': lines.trips.join('\n'),
      'calendar.txt': FEED['calendar.txt'],
      'stop_times.txt': lines.times.join('\n'),
    }),
    etag: '"v1"',
    realtime: encodeFeed({ timestamp: Math.floor(Date.now() / 1000), tripUpdates: [], alerts: [] }),
  };
  const other = await startUpstream(feed);
  const proc = start({ NETNOU_PORT: '0', NETNOU_HOST: '127.0.0.1', NETNOU_DATA_DIR: path.join(dir, 'large'), NETNOU_AREA: 'Germany', NETNOU_AREA_NAME: '', NETNOU_OSM_PBF_URLS: '', NETNOU_TIMEZONE: 'UTC', NETNOU_FEED_URL: `${other.url}/feed.zip`, NETNOU_REALTIME_URL: `${other.url}/realtime.pb` });
  let text = '';
  proc.stdout.on('data', (chunk) => { text += chunk; });
  proc.stderr.on('data', (chunk) => { text += chunk; });
  try {
    port = Number((await until(() => /Netnou listening on http:\/\/127\.0\.0\.1:(\d+), the whole feed\n/.exec(text), 'the large server to listen'))[1]);
    await until(async () => (await request('/api/area')).status === 200, 'the import to finish');
    const everywhere = 'bbox=45,5,55,15';
    const everything = 2 * (buses + 2);
    const ofLine = (vehicles, name) => vehicles.filter((v) => v.line === name).length;

    // Without a zoom nothing is left out: all of them reduced, as ever.
    const all = (await get('/api/vehicles')).json;
    assert.deepEqual([all.vehicles.length, all.thinned, all.counts], [everything, {}, { regional: 2, bus: 2 * (buses + 1) }]);

    // The whole of it on one screen: a share of the buses, and both trains,
    // of which there are so few. The answer says what share it holds, and has
    // as many vehicles as a screen takes.
    const out = (await get(`/api/vehicles?${everywhere}&detail=lite&zoom=5`)).json;
    assert.deepEqual(Object.keys(out.thinned), ['bus']);
    assert.ok(out.thinned.bus > 0.4 && out.thinned.bus < 0.5, `buses at ${out.thinned.bus}`);
    assert.ok(out.vehicles.length <= 2500 && out.vehicles.length > 2400, `${out.vehicles.length} vehicles`);
    assert.equal(ofLine(out.vehicles, 'RE 1'), 2);
    // the bus far from all others is there: the first of its square, whatever its chance
    assert.ok(ofLine(out.vehicles, '3') >= 1);
    // the numbers are those of everything
    assert.deepEqual(out.counts, all.counts);
    // the same vehicles a moment later
    const again = (await get(`/api/vehicles?${everywhere}&detail=lite&zoom=5`)).json;
    assert.deepEqual(again.vehicles.map((v) => v.id), out.vehicles.map((v) => v.id));

    // Zooming in adds: more between two zooms, and everything where a screen holds less of the ground.
    const ids = async (query) => new Set((await get(`/api/vehicles?${everywhere}&detail=lite&${query}`)).json.vehicles.map((v) => v.id));
    const [at5, at8, at85, at9] = [await ids('zoom=5'), await ids('zoom=8'), await ids('zoom=8.5'), await ids('zoom=9')];
    assert.ok(at8.size > at5.size && at85.size > at8.size && at9.size > at85.size, `${[at5.size, at8.size, at85.size, at9.size]}`);
    for (const id of at5) assert.ok(at8.has(id) && at85.has(id), id);
    for (const id of at8) assert.ok(at85.has(id), id);
    assert.equal(at9.size, everything);
    assert.deepEqual((await get(`/api/vehicles?${everywhere}&detail=lite&zoom=9`)).json.thinned, {});
    assert.equal((await ids('zoom=4')).size, at5.size);

    // A line that a visitor has picked is on the map whole, and so is a vehicle.
    const line = (await get(`/api/vehicles?${everywhere}&detail=lite&zoom=5&line=2&mode=bus&agency=Testbetrieb`)).json;
    assert.ok(ofLine(out.vehicles, '2') < 10);
    assert.equal(ofLine(line.vehicles, '2'), 10);
    const hidden = [...at9].find((id) => id.startsWith('BUS') && !at5.has(id));
    assert.ok((await ids(`zoom=5&vehicle=${hidden}`)).has(hidden));
    assert.equal((await ids('zoom=5&vehicle=nothing&line=nothing')).size, at5.size);

    // The kinds a map shows: no others are in the answer, and they take no
    // room. But a line that was picked is there whatever its kind.
    const trains = (await get(`/api/vehicles?${everywhere}&detail=lite&zoom=5&modes=regional,tram`)).json;
    assert.deepEqual([trains.vehicles.map((v) => v.line), trains.thinned, trains.counts], [['RE 1', 'RE 1'], {}, all.counts]);
    const both = (await get(`/api/vehicles?${everywhere}&detail=lite&zoom=5&modes=regional&line=2&mode=bus&agency=Testbetrieb`)).json;
    assert.deepEqual([ofLine(both.vehicles, 'RE 1'), ofLine(both.vehicles, '2'), both.vehicles.length], [2, 10, 12]);
    assert.equal((await get('/api/vehicles?modes=bus')).json.vehicles.length, everything - 2);
    assert.equal((await get('/api/vehicles?modes=')).json.vehicles.length, 0);

    // The smallest form: a column for each property, where each vehicle is
    // now in 1e-5 degrees and how far it gets in `ahead` seconds, and not
    // where it goes. The same vehicles as in the other reduced form.
    const least = (await get(`/api/vehicles?${everywhere}&detail=minimal&zoom=5`)).json;
    assert.deepEqual(Object.keys(least).sort(), ['ahead', 'counts', 'kinds', 'now', 'realtime', 'thinned', 'vehicles']);
    assert.deepEqual([least.thinned, least.counts, least.ahead], [out.thinned, out.counts, 60]);
    assert.deepEqual(Object.keys(least.vehicles), ['id', 'line', 'mode', 'delay', 'unit', 'at']);
    assert.deepEqual(least.vehicles.id, out.vehicles.map((v) => v.id));
    assert.deepEqual([least.vehicles.line, least.vehicles.mode], [out.vehicles.map((v) => v.line), out.vehicles.map((v) => v.mode)]);
    assert.ok(least.vehicles.delay.every((delay) => delay === null) && least.vehicles.unit.every((unit) => unit === null));
    assert.equal(least.vehicles.at.length, 4 * least.vehicles.id.length);
    assert.ok(least.vehicles.at.every(Number.isInteger));
    // (a train: what the two knots of the other form say, within the clock's step between the two requests)
    const train = least.vehicles.line.indexOf('RE 1');
    const [lat, lon, north, east] = least.vehicles.at.slice(4 * train, 4 * train + 4);
    const [, lat0, lon0, , lat1] = out.vehicles[train].knots;
    assert.ok(lat > 4935000 && lat < 4945000 && lon === 950000 && north < 0 && east === 0, `a train at ${[lat, lon, north, east]}`);
    assert.ok(Math.abs(lat / 1e5 - lat0) < 1e-4 && lon / 1e5 === lon0 && Math.abs(north / 1e5 - (lat1 - lat0)) < 2e-5, `${[lat, north]} beside ${[lat0, lat1]}`);
    assert.equal((await get('/api/vehicles?detail=minimal')).json.vehicles.id.length, everything);

    // A map section in full is thinned out as well if it names such a zoom, which the page never does.
    const full = (await get('/api/vehicles?bbox=49.39,9,49.42,9.1')).json;
    assert.ok(full.vehicles.length > 200 && full.vehicles.every((v) => v.mode === 'bus' && v.knots.length >= 6));
    assert.ok((await get('/api/vehicles?bbox=49.39,9,49.42,9.1&zoom=5')).json.vehicles.length < full.vehicles.length / 2);
    assert.equal((await get('/api/vehicles?bbox=49.39,9,49.42,9.1&zoom=12')).json.vehicles.length, full.vehicles.length);
  } finally {
    proc.kill();
    await once(proc, 'exit');
    await other.close();
  }
});

test('a visit of the page is reported to the analytics service the operator names, with what its request says (#114), and so is a stop or a line opened in it (#158)', async () => {
  // a stand-in for the service: what it is sent, and an answer it may be told to give
  const reports = [];
  let answer = 200;
  const service = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      reports.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(answer, { 'Content-Type': 'text/plain' });
      res.end(answer === 200 ? 'ok' : 'website not found');
    });
  });
  service.listen(0, '127.0.0.1');
  await once(service, 'listening');
  // (a feed of its own, which nothing holds back)
  const other = await startUpstream({ zip: makeZip(FEED), etag: '"v1"', realtime: REALTIME });
  const proc = start({
    NETNOU_PORT: '0',
    NETNOU_HOST: '127.0.0.1',
    NETNOU_DATA_DIR: path.join(dir, 'visits'),
    NETNOU_BBOX: BBOX.join(','),
    NETNOU_TIMEZONE: 'UTC',
    NETNOU_OSM_PBF_URLS: '',
    NETNOU_FEED_URL: `${other.url}/feed.zip`,
    NETNOU_REALTIME_URL: `${other.url}/realtime.pb`,
    NETNOU_PUBLIC_URL: 'https://karte.example.org/live/',
    NETNOU_VISITS_URL: `http://127.0.0.1:${service.address().port}/api/send?site=7&from={source}`,
    NETNOU_VISITS_BODY: '{"type":"event","payload":{"url":"{path}","hostname":"{host}","referrer":"{source}","language":"{language}","title":"{title}","ip":"{ip}","near":"{ip-short}","userAgent":"{browser}","page":"{address}"}}',
    NETNOU_VISITS_HEADERS: '{"Authorization":"Bearer geheim","X-Title":"{title}"}',
  });
  let text = '';
  proc.stdout.on('data', (chunk) => { text += chunk; });
  proc.stderr.on('data', (chunk) => { text += chunk; });
  const browser = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
  // what a browser sends when it opens the page, and when it opens it through the service worker
  const opened = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', Accept: 'text/html,application/xhtml+xml', 'User-Agent': browser, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8', 'X-Forwarded-For': '10.0.0.9, 203.0.113.47' };
  const throughWorker = { ...opened, 'Sec-Fetch-Dest': 'empty' };
  // (reported once the answer is out: the requests are waited for)
  const reported = async (count) => until(() => reports.length >= count, `${count} reports`).then(() => new Promise((resolve) => setTimeout(resolve, 150)));
  try {
    port = Number((await until(() => /Netnou listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(text), 'the server with visits to listen'))[1]);
    assert.match(text, new RegExp(`Visits: reported to 127\\.0\\.0\\.1:${service.address().port}\n`));
    // (the page changes with the timetable, its kinds of transport: it is there before the page is asked for)
    await until(() => /Timetable loaded/.test(text), 'the timetable of the server with visits');

    // a visit, with a map position in its address and from another site
    const page = await request('/?lang=en&view=49.45,11.08,12&utm_source=flyer', { headers: { ...opened, Referer: 'https://www.example.com/' } });
    assert.equal(page.status, 200);
    await reported(1);
    const [first] = reports;
    assert.equal(first.method, 'POST');
    assert.equal(first.url, `/api/send?site=7&from=${encodeURIComponent('https://www.example.com/')}`);
    assert.equal(first.headers['content-type'], 'application/json');
    assert.equal(first.headers.authorization, 'Bearer geheim');
    assert.match(first.headers['user-agent'], /^Netnou\//);
    const title = JSON.parse(first.body).payload.title;
    assert.match(title, /Netnou/);
    // (what a header cannot carry, such as a dash beyond Latin-1, leaves the header out)
    assert.equal(first.headers['x-title'], /^[\x20-\xff]*$/.test(title) ? title : undefined);
    assert.deepEqual(JSON.parse(first.body), {
      type: 'event',
      payload: {
        // (the map position is left out, the language and where the visitor came from are kept)
        url: '/live/?lang=en&utm_source=flyer',
        hostname: 'karte.example.org',
        referrer: 'https://www.example.com/',
        language: 'de-DE',
        title,
        ip: '203.0.113.47',
        near: '203.0.113.0',
        userAgent: browser,
        page: 'https://karte.example.org/live/?lang=en&utm_source=flyer',
      },
    });

    // opened again through the worker, answered with "not modified", and without a source: the source is left out
    const again = await request('/?lang=en', { headers: { ...throughWorker, 'If-None-Match': page.headers.etag, Referer: 'https://karte.example.org/live/' } });
    assert.equal(again.status, 304);
    await reported(2);
    assert.equal(reports[1].url, '/api/send?site=7');
    assert.deepEqual(Object.keys(JSON.parse(reports[1].body).payload).sort(), ['hostname', 'ip', 'language', 'near', 'page', 'title', 'url', 'userAgent']);
    // the page of a stop is a visit too, at its address
    await request('/stop/alpha@49.4000,11.0000', { headers: opened });
    await reported(3);
    assert.equal(JSON.parse(reports[2].body).payload.url, '/live/stop/alpha@49.4000,11.0000');

    // no visits: the worker filling its cache, a script fetching the page, a prefetch, HEAD, Do Not Track and GPC, a script's request for data
    for (const headers of [
      { 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', Accept: '*/*' },
      { 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'empty', Accept: '*/*', 'Sec-Purpose': 'prefetch' },
      { ...opened, 'Sec-Purpose': 'prefetch;prerender' },
      { ...opened, DNT: '1' },
      { ...opened, 'Sec-GPC': '1' },
      { Accept: '*/*' },
    ]) await request('/', { headers });
    await request('/', { method: 'HEAD', headers: opened });
    await request('/api/area', { headers: opened });
    // (without the Sec-Fetch headers, as from an older browser: by what it accepts)
    await request('/', { headers: { Accept: 'text/html' } });
    await reported(4);
    assert.equal(reports.length, 4);

    // a stop and a line opened in the page: its first request for each, which it marks, is a visit of the address (#158)
    const asked = { 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'same-origin', Accept: '*/*', 'User-Agent': browser, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8', 'X-Forwarded-For': '10.0.0.9, 203.0.113.47', Referer: 'https://karte.example.org/live/' };
    assert.equal((await request('/api/departures?station=A&open=1', { headers: asked })).status, 200);
    assert.equal((await request('/api/line?name=U1&mode=subway&agency=Testbetrieb&route=1&open=1', { headers: asked })).status, 200);
    // and a trip (#178)
    assert.equal((await request(`/api/trip?id=T1_${today}&open=1`, { headers: asked })).status, 200);
    // no visits: the requests that keep the details up to date, a stop that is not there, another site's page, Do Not Track
    await request('/api/departures?station=A', { headers: asked });
    await request('/api/line?name=U1&mode=subway&agency=Testbetrieb', { headers: asked });
    await request(`/api/trip?id=T1_${today}`, { headers: asked });
    assert.equal((await request('/api/departures?station=nowhere&open=1', { headers: asked })).status, 404);
    await request('/api/departures?at=49.4,11&open=1', { headers: { ...asked, 'Sec-Fetch-Site': 'cross-site' } });
    await request('/api/departures?station=A&open=1', { headers: { ...asked, DNT: '1' } });
    await reported(7);
    assert.equal(reports.length, 7);
    const of = (part) => reports.slice(4).map((report) => JSON.parse(report.body).payload).find((visit) => visit.page.includes(part));
    // (without a source: the visitor came from the page itself; with the title of the page at the address)
    assert.deepEqual(of('/stop/'), {
      url: '/live/stop/alpha@49.4000,11.0000',
      hostname: 'karte.example.org',
      language: 'de-DE',
      title: 'Abfahrten Alpha live – Netnou',
      ip: '203.0.113.47',
      near: '203.0.113.0',
      userAgent: browser,
      page: 'https://karte.example.org/live/stop/alpha@49.4000,11.0000',
    });
    assert.equal(reports.find((report) => report.body.includes('/stop/')).url, '/api/send?site=7');
    const lineTitle = /<title>([^<]*)<\/title>/.exec((await request('/line/testbetrieb/subway/u1', { headers: { 'Accept-Language': 'de-DE' } })).body.toString())[1];
    assert.deepEqual([of('/line/').url, of('/line/').title], ['/live/line/testbetrieb/subway/u1', lineTitle]);
    assert.deepEqual([of('/trip/').url, of('/trip/').title], [`/live/trip/testbetrieb/subway/u1/${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}/0000-alpha`, 'U1 nach Rundkurs live – Netnou']);

    // a service that refuses: one line when that begins, none for each visit, one when it is over
    answer = 404;
    for (let i = 0; i < 3; i++) await request('/', { headers: opened });
    await reported(9);
    answer = 200;
    await request('/', { headers: opened });
    await reported(10);
    assert.equal(text.match(/Visits: cannot report to [^\n]*: HTTP 404: website not found\n/g)?.length, 1);
    assert.equal(text.match(/Visits: reported to [^\n]* again\n/g)?.length, 1);
  } finally {
    proc.kill();
    await once(proc, 'exit');
    service.close();
    await other.close();
  }
});

test('a wrong setting or an unusable data directory ends the start with exit code 1', async () => {
  const run = async (settings) => {
    const proc = start({ NETNOU_PORT: '0', NETNOU_HOST: '127.0.0.1', NETNOU_BBOX: BBOX.join(','), NETNOU_FEED_URL: `${upstream.url}/feed.zip`, NETNOU_REALTIME_URL: `${upstream.url}/realtime.pb`, ...settings });
    let text = '';
    proc.stdout.on('data', (chunk) => { text += chunk; });
    proc.stderr.on('data', (chunk) => { text += chunk; });
    const [code] = await once(proc, 'close');
    return { code, text };
  };
  const config = await run({ NETNOU_DATA_DIR: path.join(dir, 'unused'), NETNOU_REALTIME_INTERVAL_SECONDS: '0' });
  assert.equal(config.code, 1);
  // one line, no stack trace
  assert.equal(config.text.trim(), 'Configuration error: NETNOU_REALTIME_INTERVAL_SECONDS must be a number from 10 to 3600 (got "0")');
  assert.ok(!fs.existsSync(path.join(dir, 'unused')));
  // (a pattern of the visits: with a placeholder that does not exist)
  const visits = await run({ NETNOU_DATA_DIR: path.join(dir, 'unused'), NETNOU_VISITS_URL: 'https://stats.example.org/count?page={page}' });
  assert.equal(visits.code, 1);
  assert.match(visits.text, /^Configuration error: NETNOU_VISITS_URL: \{page\} is no placeholder; there are \{address\}, /);

  // a data directory below a file cannot be created
  fs.writeFileSync(path.join(dir, 'file'), '');
  const data = await run({ NETNOU_DATA_DIR: path.join(dir, 'file', 'data') });
  assert.equal(data.code, 1);
  assert.match(data.text, /Timetable: cannot start: the data directory .+ cannot be created or written \(/);
  assert.doesNotMatch(data.text, /\n\s+at /);
});
