import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Area } from '../server/lib/area.js';
import { FeedUpdater } from '../server/lib/feed.js';
import { readDataset, writeDataset } from '../server/lib/dataset.js';
import { download, publicUrl, reason } from '../server/lib/files.js';
import { makePbf, makeZip, startUpstream } from './helpers.js';

// One line from A to B inside the area.
const FEED = {
  'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Alpha,49.40,11.00\nB,Beta,49.50,11.00\n',
  'routes.txt': 'route_id,route_short_name,route_type\nR1,U1,1\n',
  'trips.txt': 'route_id,service_id,trip_id\nR1,DAILY,T1\n',
  'calendar_dates.txt': 'service_id,date,exception_type\nDAILY,20261003,1\n',
  'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\nT1,10:00:00,10:00:00,A,0\nT1,10:10:00,10:10:00,B,1\n',
};
// The same line somewhere else: nothing of it lies in the area.
const ELSEWHERE = { ...FEED, 'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Alpha,52.40,13.00\nB,Beta,52.50,13.00\n' };
const AREA = Area.fromBbox([49.3, 10.8, 49.7, 11.3]);

/** An upstream serving `files` and a data directory, both gone when the test ends. */
async function setup(t, files) {
  const feed = { zip: makeZip(files), etag: '"v1"' };
  const upstream = await startUpstream(feed);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-feed-'));
  t.after(async () => {
    await upstream.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  /** A FeedUpdater with what it logged and the timetables it handed over. */
  const make = ({ area = AREA, agencies = null, dataDir = dir, osmUrls = [] } = {}) => {
    const made = { log: [], timetables: [] };
    made.updater = new FeedUpdater({
      url: `${upstream.url}/feed.zip`,
      dataDir,
      area,
      agencies,
      checkMs: 3600_000,
      downloadTimeoutMs: 10_000,
      osm: { urls: osmUrls, maxAgeMs: 86_400_000 },
      onTimetable: (timetable) => made.timetables.push(timetable),
      log: (line) => made.log.push(line),
    });
    return made;
  };
  return { feed, url: upstream.url, requests: upstream.requests, dir, make };
}

test('the feed is only downloaded when its ETag has changed', async (t) => {
  const { feed, requests, dir, make } = await setup(t, FEED);
  const { updater, timetables, log } = make();
  assert.deepEqual(updater.status, { state: 'starting', step: null, message: 'starting', checkedAt: null, error: null });

  await updater.check();
  assert.equal(updater.status.error, null); // first, so that a failure says what went wrong
  assert.deepEqual([requests.head, requests.get], [1, 1]);
  assert.equal(updater.status.state, 'ready');
  assert.equal(updater.status.step, null);
  assert.equal(updater.status.message, '1 trips, 2 stations, 0 routed hops');
  // without OSM extracts the dataset is written and loaded once, not twice
  assert.equal(timetables.length, 1);
  assert.deepEqual(log.filter((line) => /^Timetable: (downloading|reading)/.test(line)).map((line) => line.replace(/http:\S+/, 'URL')), ['Timetable: downloading URL', 'Timetable: reading the feed (0 MB)']);
  // the download is gone, the dataset is there
  assert.deepEqual(fs.readdirSync(dir), ['dataset.bin']);
  assert.equal(readDataset(path.join(dir, 'dataset.bin')).source.etag, '"v1"');

  await updater.check();
  assert.deepEqual([requests.head, requests.get], [2, 1]);
  assert.equal(timetables.length, 1);

  feed.etag = '"v2"';
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [3, 2]);
  assert.equal(timetables.length, 2);
  assert.equal(timetables[1].source.etag, '"v2"');

  // a server that names the download differently from what HEAD reports is not asked for it at every check
  feed.etag = '"v3"';
  feed.downloadEtag = 'W/"v3-gzip"';
  await updater.check();
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [5, 3]);
  assert.equal(timetables.length, 3);
  assert.equal(timetables[2].source.etag, '"v3"');
});

test('a feed version that cannot be imported is left alone for a while', async (t) => {
  const { feed, requests, dir, make } = await setup(t, ELSEWHERE);
  const { updater, timetables } = make();

  await updater.check();
  assert.deepEqual([requests.head, requests.get], [1, 1]);
  assert.equal(updater.status.state, 'error');
  assert.equal(updater.status.step, null);
  assert.equal(updater.status.message, 'the timetable could not be loaded');
  assert.match(updater.status.error, /^the feed has no stops in the area; .+; this feed version will be tried again in 60 min$/);
  assert.deepEqual(fs.readdirSync(dir), []); // feed.zip is removed after a failure, too

  // the next checks ask for the version but do not fetch it again
  await updater.check();
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [3, 1]);
  assert.equal(updater.status.state, 'error');
  assert.match(updater.status.error, /no stops in the area/);

  // when the hour is over it is tried once more, and the wait doubles
  updater.failed.until = Date.now();
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [4, 2]);
  assert.match(updater.status.error, /tried again in 120 min$/);
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [5, 2]);

  // a new version is not kept waiting; should it fail too, its wait starts at an hour again
  feed.etag = '"v2"';
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [6, 3]);
  assert.match(updater.status.error, /tried again in 60 min$/);

  feed.zip = makeZip(FEED);
  feed.etag = '"v3"';
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [7, 4]);
  assert.equal(updater.status.state, 'ready');
  assert.equal(updater.status.error, null);
  assert.equal(updater.failed, null);
  assert.equal(timetables.length, 1);
});

test('a download that is refused is asked for again at the next check, one that breaks off is not', async (t) => {
  const { feed, requests, dir, make } = await setup(t, FEED);
  const { updater, timetables } = make();

  // HTTP 503 instead of the file: nothing was transferred, so there is nothing to wait for
  feed.fail = 'refuse';
  await updater.check();
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [2, 2]);
  assert.equal(updater.status.state, 'error');
  assert.match(updater.status.error, /^GET http:\S+\/feed\.zip: HTTP 503$/);
  assert.equal(updater.failed, null);

  // the connection ends halfway: the next attempt would start from the beginning
  feed.fail = 'cut';
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [3, 3]);
  assert.match(updater.status.error, /; this feed version will be tried again in 60 min$/);
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [4, 3]);
  assert.deepEqual(fs.readdirSync(dir), []); // the half file is not kept

  feed.fail = null;
  updater.failed.until = Date.now();
  await updater.check();
  assert.deepEqual([requests.head, requests.get], [5, 4]);
  assert.equal(updater.status.state, 'ready');
  assert.equal(updater.status.error, null);
  assert.equal(timetables.length, 1);
});

test('a stored dataset is used again unless it is damaged or made for something else', async (t) => {
  const { requests, dir, make } = await setup(t, FEED);
  const datasetPath = path.join(dir, 'dataset.bin');

  // damaged: imported again
  fs.writeFileSync(datasetPath, 'not gzip');
  fs.writeFileSync(path.join(dir, 'feed.zip'), 'left over from an import that was cut short');
  const first = make();
  await first.updater.start();
  assert.match(first.log.join('\n'), /Timetable: stored dataset unusable \(.+\), importing again/);
  assert.equal(first.updater.status.state, 'ready');
  assert.deepEqual([requests.head, requests.get], [1, 1]);
  assert.deepEqual(fs.readdirSync(dir), ['dataset.bin']);

  // intact and current: loaded from disk, nothing downloaded
  const second = make();
  await second.updater.start();
  assert.equal(second.updater.status.state, 'ready');
  assert.equal(second.timetables.length, 1);
  assert.deepEqual([requests.head, requests.get], [2, 1]);

  // made for another area
  const area = Area.fromBbox([49.35, 10.8, 49.7, 11.3]);
  const third = make({ area });
  await third.updater.start();
  assert.match(third.log.join('\n'), /stored dataset unusable \(made for another area or other operators\)/);
  assert.deepEqual([requests.head, requests.get], [3, 2]);
  // … or for an area where there is to be none
  const none = make({ area: null });
  await none.updater.start();
  assert.match(none.log.join('\n'), /stored dataset unusable \(made for another area or other operators\)/);
  assert.deepEqual(none.timetables.at(-1).bbox, [49.4, 11, 49.5, 11]);
  assert.deepEqual([requests.head, requests.get], [4, 3]);
  await make({ area }).updater.start();
  assert.deepEqual([requests.head, requests.get], [5, 4]);

  // written by another version of the software
  writeDataset(datasetPath, { ...readDataset(datasetPath), version: 1 });
  const fourth = make({ area });
  await fourth.updater.start();
  assert.match(fourth.log.join('\n'), /stored dataset unusable \(written by another version\)/);
  assert.equal(fourth.updater.status.state, 'ready');
  assert.deepEqual([requests.head, requests.get], [6, 5]);
});

test('a data directory that cannot be written stops the start', async (t) => {
  const { requests, dir, make } = await setup(t, FEED);
  const blocked = path.join(dir, 'file');
  fs.writeFileSync(blocked, '');
  // below a file: cannot be created
  const { updater } = make({ dataDir: path.join(blocked, 'data') });
  await assert.rejects(updater.start(), /^Error: the data directory .+ cannot be created or written \(.+\)$/);
  assert.equal(requests.head, 0);
});

test('route geometry: straight lines first, OSM data retried with growing waits, then cached', async (t) => {
  const { feed, url, requests, dir, make } = await setup(t, FEED);
  const { updater, timetables, log } = make({ osmUrls: [`${url}/area.osm.pbf`] });
  const routesLog = () => log.filter((line) => line.startsWith('Routes: ')).map((line) => line.replace(/http:\S+/, 'URL'));

  // The extract cannot be had: the timetable is served all the same.
  await updater.check();
  assert.equal(updater.status.state, 'ready');
  assert.equal(updater.status.error, null);
  // loaded twice: at once with straight lines, and again when the OSM step is over
  assert.deepEqual(timetables.map((timetable) => timetable.segmentCount), [0, 0]);
  assert.deepEqual([requests.get, requests.osm], [1, 1]);
  assert.deepEqual(routesLog(), [
    'Routes: downloading OSM extract URL',
    'Routes: OSM data could not be updated (GET URL HTTP 404), keeping straight lines',
    'Routes: no route geometry, next attempt in 60 min',
  ]);
  assert.deepEqual(fs.readdirSync(dir), ['dataset.bin']);

  // A feed version that cannot be imported is no attempt at the OSM data.
  feed.zip = makeZip(ELSEWHERE);
  feed.etag = '"v2"';
  await updater.check();
  assert.match(updater.status.error, /no stops in the area/);
  assert.deepEqual([requests.head, requests.get, requests.osm], [2, 2, 1]);
  assert.equal(routesLog().length, 3);
  feed.zip = makeZip(FEED);
  feed.etag = '"v1"';

  // The OSM data is not asked for at every check …
  await updater.check();
  assert.equal(updater.status.error, null);
  assert.deepEqual([requests.head, requests.get, requests.osm], [3, 2, 1]);
  // … but when the hour is over, and then the wait doubles
  updater.routesRetryAt = Date.now();
  await updater.check();
  assert.deepEqual([requests.head, requests.get, requests.osm], [4, 2, 2]);
  assert.equal(routesLog().at(-1), 'Routes: no route geometry, next attempt in 120 min');
  assert.equal(updater.status.step, null);
  // the timetable in use was left alone
  assert.equal(timetables.length, 2);

  // An extract with nothing in the area is no better.
  feed.osm = makePbf([[1, 52.4, 13.0], [2, 52.5, 13.0]], [[10, [1, 2], { railway: 'subway' }]]);
  updater.routesRetryAt = Date.now();
  await updater.check();
  assert.equal(requests.osm, 3);
  assert.match(routesLog().at(-2), /^Routes: OSM data could not be updated \(no roads or tracks found in the area; .+\), keeping straight lines$/);
  assert.equal(routesLog().at(-1), 'Routes: no route geometry, next attempt in 240 min');

  // The extract appears, with a track from A to B: the timetable in use gets its geometry.
  feed.osm = makePbf([[1, 49.4, 11.0001], [2, 49.45, 11.002], [3, 49.5, 11.0001]], [[10, [1, 2, 3], { railway: 'subway' }]]);
  updater.routesRetryAt = Date.now();
  await updater.check();
  assert.deepEqual([requests.head, requests.get, requests.osm], [6, 2, 4]);
  assert.equal(updater.status.message, '1 trips, 2 stations, 1 routed hops');
  assert.deepEqual(routesLog().slice(-5), ['Routes: downloading OSM extract URL', 'Routes: reading OSM extract (0 MB)', 'Routes: 0 towns in the OSM extracts', 'Routes: routing 1 hops', 'Routes: hops routed: road 0/0, rail 0/0, subway 1/1, tram 0/0']);
  const routed = timetables.at(-1);
  assert.equal(routed.segmentCount, 1);
  // the trip runs over the bend at node 2 instead of straight from A to B
  assert.deepEqual(routed.trip('T1', '20261003', null).path.slice(2, 4), [49.45, 11.002]);
  assert.ok(!Number.isNaN(Date.parse(routed.source.osm)));
  assert.equal(updater.routesMissing, false);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['dataset.bin', 'osm-networks.json.gz', 'osm-towns.json.gz']);

  // nothing more to do at the next check
  await updater.check();
  assert.deepEqual([requests.head, requests.get, requests.osm], [7, 2, 4]);

  // The next feed version is routed on the cached networks, without a download.
  feed.etag = '"v3"';
  await updater.check();
  assert.deepEqual([requests.head, requests.get, requests.osm], [8, 3, 4]);
  assert.equal(timetables.at(-1).source.etag, '"v3"');
  assert.equal(timetables.at(-1).segmentCount, 1);
});

test('the stations get their towns from the borders in the OSM extract, with the route geometry', async (t) => {
  const { feed, url, requests, dir, make } = await setup(t, FEED);
  // A track from A to B, and the border of a town around A: two ways that meet at their ends.
  feed.osm = makePbf(
    [[1, 49.4, 11.0001], [2, 49.45, 11.002], [3, 49.5, 11.0001], [4, 49.35, 10.95], [5, 49.35, 11.05], [6, 49.45, 11.05], [7, 49.45, 10.95]],
    [[10, [1, 2, 3], { railway: 'subway' }], [11, [4, 5, 6], {}], [12, [4, 7, 6], {}]],
    [[20, { type: 'boundary', boundary: 'administrative', admin_level: '8', name: 'Alphastadt' }, [['way', 11, 'outer'], ['way', 12, 'outer']]]],
  );
  const { updater, timetables, log } = make({ osmUrls: [`${url}/area.osm.pbf`] });
  const towns = (timetable) => {
    const { names, town, towns: named } = timetable.searchList().list.stations;
    return names.split('\n').map((name, i) => `${name}: ${named[town[i]] ?? '-'}`).sort();
  };

  await updater.check();
  assert.equal(updater.status.error, null);
  // at once without towns, as without routes, and with both when the OSM step is over
  assert.deepEqual(timetables.map(towns), [['Alpha: -', 'Beta: -'], ['Alpha: Alphastadt', 'Beta: -']]);
  assert.ok(log.includes('Routes: 1 towns in the OSM extracts'));
  assert.equal(timetables.at(-1).segmentCount, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['dataset.bin', 'osm-networks.json.gz', 'osm-towns.json.gz']);
  assert.deepEqual([requests.get, requests.osm], [1, 1]);

  // The next timetable, with one more station in the town: placed by the borders that were kept.
  feed.zip = makeZip({ ...FEED, 'stops.txt': FEED['stops.txt'] + 'C,Gamma,49.44,11.04\n', 'stop_times.txt': FEED['stop_times.txt'] + 'T1,10:15:00,10:15:00,C,2\n' });
  feed.etag = '"v2"';
  await updater.check();
  assert.equal(updater.status.error, null);
  assert.deepEqual(towns(timetables.at(-1)), ['Alpha: Alphastadt', 'Beta: -', 'Gamma: Alphastadt']);
  assert.deepEqual([requests.get, requests.osm], [2, 1]);

  // Networks without the towns of their reading are as good as none: the extract is read again.
  fs.rmSync(path.join(dir, 'osm-towns.json.gz'));
  feed.etag = '"v3"';
  await updater.check();
  assert.equal(updater.status.error, null);
  assert.deepEqual(towns(timetables.at(-1)), ['Alpha: Alphastadt', 'Beta: -', 'Gamma: Alphastadt']);
  assert.deepEqual([requests.get, requests.osm], [3, 2]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['dataset.bin', 'osm-networks.json.gz', 'osm-towns.json.gz']);
});

test('without an area the OSM data is kept where the trips run, and read again when they reach beyond it', async (t) => {
  const { feed, url, requests, make } = await setup(t, FEED);
  // a track from A to B, and another one far away
  feed.osm = makePbf(
    [[1, 49.4, 11.0001], [2, 49.45, 11.002], [3, 49.5, 11.0001], [4, 52.4, 13.0001], [5, 52.45, 13.002], [6, 52.5, 13.0001]],
    [[10, [1, 2, 3], { railway: 'subway' }], [11, [4, 5, 6], { railway: 'subway' }]],
  );
  const { updater, timetables, log } = make({ area: null, osmUrls: [`${url}/area.osm.pbf`] });
  await updater.check();
  assert.equal(updater.status.error, null);
  assert.equal(timetables.at(-1).segmentCount, 1);
  assert.deepEqual(timetables.at(-1).trip('T1', '20261003', null).path.slice(2, 4), [49.45, 11.002]);
  assert.deepEqual([requests.get, requests.osm], [1, 1]);

  // A new timetable with one more stop, two kilometres on: what was kept is good for it.
  const longer = {
    ...FEED,
    'stops.txt': FEED['stops.txt'] + 'C,Gamma,49.52,11.00\n',
    'stop_times.txt': FEED['stop_times.txt'] + 'T1,10:15:00,10:15:00,C,2\n',
  };
  feed.zip = makeZip(longer);
  feed.etag = '"v2"';
  await updater.check();
  assert.equal(updater.status.error, null);
  assert.equal(timetables.at(-1).stopCount(0), 3);
  assert.deepEqual([requests.get, requests.osm], [2, 1]);

  // One with a second line far away: the extract is read again, and the track there is kept now.
  feed.zip = makeZip({
    ...longer,
    'stops.txt': longer['stops.txt'] + 'X,Chi,52.40,13.00\nY,Ypsilon,52.50,13.00\n',
    'trips.txt': longer['trips.txt'] + 'R1,DAILY,T2\n',
    'stop_times.txt': longer['stop_times.txt'] + 'T2,11:00:00,11:00:00,X,0\nT2,11:10:00,11:10:00,Y,1\n',
  });
  feed.etag = '"v3"';
  await updater.check();
  assert.equal(updater.status.error, null);
  assert.deepEqual([requests.get, requests.osm], [3, 2]);
  assert.ok(log.includes('Routes: the timetable reaches beyond the OSM data that was kept: reading it again'));
  // (on what was kept before, the new line would have run straight)
  assert.deepEqual(timetables.at(-1).trip('T2', '20261003', null).path.slice(2, 4), [52.45, 13.002]);
  assert.deepEqual(timetables.at(-1).trip('T1', '20261003', null).path.slice(2, 4), [49.45, 11.002]);

  // and the next one that stays within is routed on what is kept
  feed.etag = '"v4"';
  await updater.check();
  assert.deepEqual([requests.get, requests.osm], [4, 2]);
});

test('download reports HTTP errors, reason adds what fetch hides', async (t) => {
  const { url, requests, dir } = await setup(t, FEED);

  const { size, headers } = await download(`${url}/feed.zip`, path.join(dir, 'ok.zip'), 10_000);
  assert.equal(size, fs.statSync(path.join(dir, 'ok.zip')).size);
  assert.equal(headers.get('etag'), '"v1"');
  assert.equal(requests.get, 1);
  await assert.rejects(download(`${url}/missing.zip`, path.join(dir, 'missing.zip'), 10_000), /^Error: GET http:\S+\/missing\.zip: HTTP 404$/);
  // an access key in the URL stays out of the error text
  await assert.rejects(download(`${url}/missing.zip?key=secret`, path.join(dir, 'missing.zip'), 10_000), /^Error: GET http:\S+\/missing\.zip: HTTP 404$/);
  assert.equal(publicUrl('https://user:secret@feed.example/v1/latest.zip?key=secret#x'), 'https://feed.example/v1/latest.zip');

  assert.equal(reason(new Error('plain')), 'plain');
  assert.equal(reason('text'), 'text');
  assert.equal(reason(new TypeError('fetch failed', { cause: Object.assign(new Error('getaddrinfo ENOTFOUND feed.example'), { code: 'ENOTFOUND' }) })), 'fetch failed (getaddrinfo ENOTFOUND feed.example)');
  // a refused connection comes as an AggregateError without a message of its own
  assert.equal(reason(new TypeError('fetch failed', { cause: Object.assign(new AggregateError([]), { code: 'ECONNREFUSED' }) })), 'fetch failed (ECONNREFUSED)');
  // nothing is said twice
  assert.equal(reason(new Error('cannot start (disk full)', { cause: new Error('disk full') })), 'cannot start (disk full)');
});
