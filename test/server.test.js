// End to end: starts the real server as a child process against a local
// stand-in for the feed provider and talks to it over HTTP.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
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
    { tripId: 'T1', text: 'Signalstörung' },
    { stopId: 'A', text: 'Aufzug außer Betrieb' },
  ],
});

// Every setting the server reads; none may leak in from the shell running the tests.
const SETTINGS = ['PORT', 'HOST', 'DATA_DIR', 'AREA_FILE', 'BBOX', 'AREA_NAME', 'VIEW', 'TIMEZONE', 'MAP_STYLE_URL', 'MAP_ORIGINS', 'TILE_URL', 'TILE_ATTRIBUTION', 'DATA_ATTRIBUTION',
  'OSM_PBF_URLS', 'OSM_MAX_AGE_DAYS', 'FEED_URL', 'FEED_CHECK_MINUTES', 'DOWNLOAD_TIMEOUT_MINUTES', 'REALTIME_URL', 'REALTIME_INTERVAL_SECONDS', 'REALTIME_IDLE_SECONDS', 'UPDATE_CHECK',
  'LANGUAGE', 'PUBLIC_URL'];
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
  const proc = spawn(process.execPath, [path.join('server', 'index.js')], { cwd: root, env: { ...env, UPDATE_CHECK: 'off', ...settings }, stdio: ['ignore', 'pipe', 'pipe'] });
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
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: path.join(dir, 'data'),
    BBOX: BBOX.join(','),
    AREA_NAME: 'Testland',
    TIMEZONE: 'UTC',
    MAP_STYLE_URL: 'https://maps.example.org/styles/day.json',
    MAP_ORIGINS: 'https://tiles.example.org',
    OSM_PBF_URLS: '',
    FEED_URL: `${upstream.url}/feed.zip`,
    REALTIME_URL: `${upstream.url}/realtime.pb`,
    REALTIME_INTERVAL_SECONDS: '10',
    // (given without the slash at its end)
    PUBLIC_URL: 'https://karte.example.org/live',
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
  // the page itself as well
  assert.equal((await request('/')).status, 200);
});

test('once the feed is imported the API answers', async () => {
  release();
  await until(async () => (await request('/api/stations')).status === 200, 'the import to finish');
  await until(() => /Timetable loaded: 2 trips, 2 stations, 0 routed hops/.test(output), 'the log line');
  // one look, one download; no OSM extract is configured and nobody has asked for vehicles yet
  assert.deepEqual(upstream.requests, { head: 1, get: 1, realtime: 0, osm: 0 });
  // the download is removed, the dataset stays
  await until(() => fs.readdirSync(path.join(dir, 'data')).join() === 'region.json.gz', 'the data directory to be tidy');
});

test('/api/area', async () => {
  const { status, headers, json } = await get('/api/area');
  assert.equal(status, 200);
  assert.deepEqual(json, {
    name: 'Testland',
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
  assert.deepEqual(json.area, { name: 'Testland', bbox: BBOX });
  assert.deepEqual(json.view, BBOX);
});

test('/api/vehicles: all of them reduced, a map section in full', async () => {
  // Asking for vehicles starts the realtime polling; wait for the first answer.
  const { status, json: all } = await until(async () => {
    const res = await get('/api/vehicles');
    return res.json.realtime !== null && res;
  }, 'realtime data');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(all).sort(), ['counts', 'now', 'realtime', 'vehicles']);
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
    // T1 stops 51 times at each of the two, T2 once more at B
    stations: { id: ['A', 'B'], name: ['Alpha', 'Beta'], lat: [49.4, 49.5], lon: [11, 11], modes: [['subway'], ['subway', 'longdistance']], service: [51, 52] },
    // each with its one trip and where that goes; the place is the middle of the stops inside the area
    lines: { name: ['U1', 'ICE 5'], mode: ['subway', 'longdistance'], agency: ['Testbetrieb', 'Testbetrieb'], to: [['Rundkurs'], ['Beta']], lat: [49.45, 49.5], lon: [11, 11], service: [1, 1] },
  });
  // in the order of /api/stations
  assert.deepEqual(json.stations.id, (await get('/api/stations')).json.map((station) => station.id));
  assert.equal(headers['cache-control'], 'no-cache');
  const again = await request('/api/search', { headers: { 'If-None-Match': headers.etag } });
  assert.equal(again.status, 304);
  assert.equal(again.body.length, 0);
  assert.equal((await request('/api/search', { headers: { 'If-None-Match': '"something-else"' } })).status, 200);
  // (the search happens in the browser: a query is not looked at)
  assert.deepEqual((await get('/api/search?q=alp')).json, json);
});

test('/api/line: the vehicles of one line that are under way', async () => {
  const { status, json } = await get('/api/line?name=U1&mode=subway&agency=Testbetrieb');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json).sort(), ['agency', 'mode', 'name', 'now', 'vehicles']);
  assert.deepEqual([json.name, json.mode, json.agency], ['U1', 'subway', 'Testbetrieb']);
  assert.ok(Math.abs(json.now - Date.now() / 1000) < 5);
  // yesterday's run and today's, both somewhere between A and B
  assert.deepEqual(json.vehicles.map((v) => v.id).sort(), [`T1_${addDays(today, -1)}`, `T1_${today}`]);
  for (const v of json.vehicles) {
    assert.deepEqual(Object.keys(v).sort(), ['delay', 'id', 'lat', 'lon', 'next', 'to']);
    assert.equal(v.to, 'Rundkurs');
    assert.ok(['Alpha', 'Beta'].includes(v.next), v.next);
    assert.ok(v.lat >= 49.4 && v.lat <= 49.5 && v.lon === 11);
  }
  assert.equal(json.vehicles.find((v) => v.id === `T1_${today}`).delay, 120);

  // the ICE is under way too, far outside the area
  const { json: ice } = await get('/api/line?name=ICE%205&mode=longdistance&agency=Testbetrieb');
  assert.deepEqual(ice.vehicles.map((v) => [v.to, v.next]), [['Beta', 'Fern Mitte'], ['Beta', 'Fern Mitte']]);
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
    realtime: true,
    source: 'Testbetrieb', // from the gtfs.de note, which is not one of the notes
    cancelled: false,
    notes: ['Signalstörung'],
  });
  assert.ok(Math.abs(now - Date.now() / 1000) < 5);
  assert.equal(stops.length, 102);
  assert.equal(line.length, 101 * 4); // no route geometry: a straight line per hop
  const dayStart = Date.parse(`${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6)}T00:00:00Z`) / 1000;
  assert.deepEqual(stops[1], { station: 'B', name: 'Beta', platform: '', lat: 49.5, lon: 11, arr: dayStart + 1800, dep: dayStart + 1800, arrDelay: 120, depDelay: 120, skipped: false });

  // yesterday's run has no delays; notes and source belong to the trip, whatever the day
  const { json: yesterday } = await get(`/api/trip?id=T1_${addDays(today, -1)}`);
  assert.deepEqual([yesterday.realtime, yesterday.stops[0].depDelay, yesterday.source, yesterday.notes], [false, null, 'Testbetrieb', ['Signalstörung']]);
  const { json: other } = await get(`/api/trip?id=T2_${today}`);
  assert.deepEqual([other.mode, other.agency, other.realtime, other.source, other.notes], ['longdistance', 'Testbetrieb', false, null, []]);

  for (const id of ['T1_19990101', `T9_${today}`, 'T1', '']) {
    const missing = await get(`/api/trip?id=${id}`);
    assert.equal(missing.status, 404, id);
    assert.deepEqual(missing.json, { error: 'trip not found' });
  }
});

test('/api/departures', async () => {
  const { status, json } = await get('/api/departures?station=A');
  assert.equal(status, 200);
  const { now, departures, ...board } = json;
  assert.deepEqual(board, { id: 'A', name: 'Alpha', lat: 49.4, lon: 11, notes: ['Aufzug außer Betrieb'] });
  // one an hour from each of the runs under way, for the next two hours
  assert.ok(departures.length >= 4 && departures.length <= 9, `${departures.length} departures`);
  for (const d of departures) {
    assert.deepEqual(Object.keys(d).sort(), ['cancelled', 'delay', 'line', 'mode', 'planned', 'platform', 'to', 'trip']);
    assert.deepEqual([d.line, d.mode, d.to, d.platform, d.cancelled], ['U1', 'subway', 'Rundkurs', '', false]);
    assert.equal(d.planned % 3600, 0);
    assert.equal(d.delay, d.trip === `T1_${today}` ? 120 : null);
    assert.ok(d.planned + (d.delay ?? 0) >= now - 30 && d.planned <= now + 7200);
  }
  const times = departures.map((d) => d.planned + (d.delay ?? 0));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));

  for (const station of ['Z', '']) {
    const missing = await get(`/api/departures?station=${station}`);
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.json, { error: 'station not found' });
  }
  assert.deepEqual((await get('/api/nothing')).json, { error: 'not found' });
});

test('static files: types, revalidation, HEAD and gzip', async () => {
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(page.headers['cache-control'], 'no-cache');
  assert.equal(page.headers.vary, 'Accept-Encoding');
  assert.equal(page.headers['content-encoding'], undefined);
  assert.equal(Number(page.headers['content-length']), page.body.length);
  // index.html with what the instance is written into it, see the next test
  assert.ok(page.body.length > fs.statSync(path.join(root, 'public', 'index.html')).size);
  assert.ok(page.body.includes('<script type="module" src="app.js"></script>'));
  assert.ok((await request('/index.html')).body.equals(page.body));
  // the map is the only thing allowed from elsewhere
  const map = 'https://maps.example.org https://tiles.example.org';
  assert.equal(page.headers['content-security-policy'], `default-src 'self'; img-src 'self' data: blob: ${map}; style-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' ${map}; frame-ancestors 'none'`);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');

  const { etag } = page.headers;
  for (const tags of [etag, `W/${etag}`, `"something-else", W/${etag}`, '*']) {
    const unchanged = await request('/', { headers: { 'If-None-Match': tags } });
    assert.equal(unchanged.status, 304, tags);
    assert.equal(unchanged.body.length, 0);
    assert.equal(unchanged.headers.etag, etag);
    assert.equal(unchanged.headers.vary, 'Accept-Encoding');
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
  // in the main language, German unless LANGUAGE says otherwise
  const page = await text('/');
  assert.match(page, /<html lang="de">/);
  assert.match(page, /<title>ÖPNV-Live-Karte: Testland – Netnou<\/title>/);
  assert.match(page, /<meta name="description" content="Testland: Busse, /);
  assert.match(page, /<p id="area-name">Testland<\/p>/);
  assert.ok(page.includes(`<link rel="canonical" href="${address}">`));
  assert.ok(page.includes(`<link rel="alternate" hreflang="en" href="${address}?lang=en">`));
  assert.ok(page.includes(`<meta property="og:image" content="${address}icons/icon-512.png">`));
  assert.equal((await request('/icons/icon-512.png')).status, 200);

  // in the language the address asks for
  const english = await request('/?lang=en');
  assert.match(english.body.toString(), /<html lang="en">/);
  assert.match(english.body.toString(), /<title>Live map of public transport: Testland – Netnou<\/title>/);
  assert.ok(english.body.toString().includes(`<link rel="canonical" href="${address}?lang=en">`));
  assert.equal((await request('/?lang=en', { headers: { 'If-None-Match': english.headers.etag } })).status, 304);
  // each version has its own tag: one is not taken for the other
  assert.equal((await request('/', { headers: { 'If-None-Match': english.headers.etag } })).status, 200);
  // a language the page does not have is none
  assert.equal(await text('/?lang=xx'), page);
  assert.equal(await text('/?lang='), page);

  const robots = await request('/robots.txt');
  assert.deepEqual([robots.status, robots.headers['content-type']], [200, 'text/plain; charset=utf-8']);
  assert.equal(robots.body.toString(), `User-agent: *\nAllow: /\n\nSitemap: ${address}sitemap.xml\n`);
  const sitemap = await request('/sitemap.xml');
  assert.deepEqual([sitemap.status, sitemap.headers['content-type']], [200, 'application/xml; charset=utf-8']);
  assert.deepEqual([...sitemap.body.toString().matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => loc), [address, `${address}?lang=de`, `${address}?lang=en`]);

  // data may be read by a search engine that runs the page, but is not for its results
  for (const pathname of ['/api/area', '/api/status', '/api/vehicles', '/api/search', '/api/stations', '/api/nothing']) {
    assert.equal((await request(pathname)).headers['x-robots-tag'], 'noindex', pathname);
  }
  for (const pathname of ['/', '/app.js', '/robots.txt']) assert.equal((await request(pathname)).headers['x-robots-tag'], undefined, pathname);
});

test('what is not there, not allowed or not a URL', async () => {
  // nothing outside public/ is served, however the path is spelled
  for (const pathname of ['/missing.html', '/icons', '/../package.json', '/..%2fpackage.json', '/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/..%5c..%5cpackage.json', '/icons/..%2f..%2fserver/index.js', '//package.json/..%2f..%2fpackage.json']) {
    const res = await request(pathname);
    assert.equal(res.status, 404, pathname);
    assert.deepEqual(JSON.parse(res.body), { error: 'not found' });
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

test('a wrong setting or an unusable data directory ends the start with exit code 1', async () => {
  const run = async (settings) => {
    const proc = start({ PORT: '0', HOST: '127.0.0.1', BBOX: BBOX.join(','), FEED_URL: `${upstream.url}/feed.zip`, REALTIME_URL: `${upstream.url}/realtime.pb`, ...settings });
    let text = '';
    proc.stdout.on('data', (chunk) => { text += chunk; });
    proc.stderr.on('data', (chunk) => { text += chunk; });
    const [code] = await once(proc, 'close');
    return { code, text };
  };
  const config = await run({ DATA_DIR: path.join(dir, 'unused'), REALTIME_INTERVAL_SECONDS: '0' });
  assert.equal(config.code, 1);
  // one line, no stack trace
  assert.equal(config.text.trim(), 'Configuration error: REALTIME_INTERVAL_SECONDS must be a number from 10 to 3600 (got "0")');
  assert.ok(!fs.existsSync(path.join(dir, 'unused')));

  // a data directory below a file cannot be created
  fs.writeFileSync(path.join(dir, 'file'), '');
  const data = await run({ DATA_DIR: path.join(dir, 'file', 'data') });
  assert.equal(data.code, 1);
  assert.match(data.text, /Timetable: cannot start: the data directory .+ cannot be created or written \(/);
  assert.doesNotMatch(data.text, /\n\s+at /);
});
