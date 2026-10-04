import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { loadConfig, parseBox } from '../server/config.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-config-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (name, content) => {
  const full = path.join(dir, name);
  fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  return full;
};
// A small rectangle keeps the tests that are not about the area quick.
const BBOX = '49.3,10.8,49.7,11.3';
const SQUARE = { type: 'Polygon', coordinates: [[[10.8, 49.3], [11.3, 49.3], [11.3, 49.7], [10.8, 49.7], [10.8, 49.3]]] };

test('defaults: the VGN, its OSM extracts, the gtfs.de feeds and OpenStreetMap tiles', () => {
  const config = loadConfig({});
  assert.equal(config.port, 8080);
  assert.equal(config.host, undefined);
  assert.equal(path.basename(config.dataDir), 'data');
  assert.ok(fs.existsSync(path.join(config.publicDir, 'index.html')));

  assert.equal(config.areaName, 'Großraum Nürnberg (VGN)');
  assert.deepEqual(config.view, [49.376, 10.916, 49.604, 11.204]);
  assert.equal(config.area.distance(49.4456, 11.083), 0); // Nürnberg Hbf
  // the file brings its own outline: fewer rings than it has member polygons
  assert.ok(config.areaOutline.length < config.area.polygons.length);
  assert.equal(config.osmUrls.length, 5);
  assert.ok(config.osmUrls.every((url) => /^https:\/\/download\.geofabrik\.de\/.+\.osm\.pbf$/.test(url)));
  assert.equal(config.osmMaxAgeMs, 30 * 86_400_000);

  assert.equal(config.feedUrl, 'https://download.gtfs.de/germany/free/latest.zip');
  assert.equal(config.realtimeUrl, 'https://realtime.gtfs.de/realtime-free.pb');
  assert.equal(config.feedCheckMs, 15 * 60_000);
  assert.equal(config.downloadTimeoutMs, 30 * 60_000);
  assert.equal(config.realtimeIntervalMs, 30_000);
  assert.equal(config.realtimeIdleMs, 120_000);

  assert.equal(config.timeZone, 'Europe/Berlin');
  assert.equal(config.tileUrl, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.equal(config.tileOrigin, 'https://tile.openstreetmap.org');
  assert.equal(config.tileAttribution, '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
  assert.equal(config.dataAttribution, '<a href="https://gtfs.de">GTFS.DE</a> / <a href="https://www.delfi.de">DELFI e.V.</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)');
});

test('a custom area has no name, no OSM extracts and is shown as a whole', () => {
  const box = loadConfig({ BBOX });
  assert.deepEqual(box.area.bbox, [49.3, 10.8, 49.7, 11.3]);
  assert.equal(box.areaName, '');
  assert.deepEqual(box.view, [49.3, 10.8, 49.7, 11.3]);
  assert.deepEqual(box.osmUrls, []);
  assert.deepEqual(box.areaOutline, [[[10.8, 49.3], [11.3, 49.3], [11.3, 49.7], [10.8, 49.7], [10.8, 49.3]]]);

  const fromFile = loadConfig({ AREA_FILE: file('square.geojson', { type: 'Feature', geometry: SQUARE }) });
  assert.equal(fromFile.area.id, box.area.id);
  assert.equal(fromFile.areaName, '');
  assert.deepEqual(fromFile.view, [49.3, 10.8, 49.7, 11.3]);
  assert.deepEqual(fromFile.osmUrls, []);
  assert.deepEqual(fromFile.areaOutline, box.areaOutline);

  // a file may bring the outline to draw
  const outline = [[[10.9, 49.4], [11.2, 49.4], [11.2, 49.6], [10.9, 49.4]]];
  assert.deepEqual(loadConfig({ AREA_FILE: file('outline.geojson', { ...SQUARE, outline }) }).areaOutline, outline);
});

test('every setting can be given', () => {
  const config = loadConfig({
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_DIR: dir,
    BBOX: ' 49.3, 10.8, 49.7, 11.3 ',
    AREA_NAME: ' Testland ',
    VIEW: '49.4,10.9,49.6,11.2',
    TIMEZONE: 'europe/vienna',
    TILE_URL: 'https://{s}.tiles.example.org/{z}/{x}/{y}{r}.png?key=1',
    TILE_ATTRIBUTION: '<b>tiles</b>',
    DATA_ATTRIBUTION: '<b>data</b>',
    FEED_URL: 'http://127.0.0.1:8000/feed.zip',
    REALTIME_URL: 'http://127.0.0.1:8000/realtime.pb',
    OSM_PBF_URLS: 'https://example.org/a.osm.pbf, https://example.org/b.osm.pbf,',
    OSM_MAX_AGE_DAYS: '7',
    FEED_CHECK_MINUTES: '60',
    DOWNLOAD_TIMEOUT_MINUTES: '2.5',
    REALTIME_INTERVAL_SECONDS: '10',
    REALTIME_IDLE_SECONDS: '30',
  });
  assert.equal(config.port, 0);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.dataDir, dir);
  assert.equal(config.areaName, 'Testland');
  assert.deepEqual(config.view, [49.4, 10.9, 49.6, 11.2]);
  assert.equal(config.timeZone, 'Europe/Vienna');
  assert.equal(config.tileUrl, 'https://{s}.tiles.example.org/{z}/{x}/{y}{r}.png?key=1');
  assert.equal(config.tileOrigin, 'https://*.tiles.example.org');
  assert.equal(config.tileAttribution, '<b>tiles</b>');
  assert.equal(config.dataAttribution, '<b>data</b>');
  assert.equal(config.feedUrl, 'http://127.0.0.1:8000/feed.zip');
  assert.equal(config.realtimeUrl, 'http://127.0.0.1:8000/realtime.pb');
  assert.deepEqual(config.osmUrls, ['https://example.org/a.osm.pbf', 'https://example.org/b.osm.pbf']);
  assert.equal(config.osmMaxAgeMs, 7 * 86_400_000);
  assert.equal(config.feedCheckMs, 3600_000);
  assert.equal(config.downloadTimeoutMs, 150_000);
  assert.equal(config.realtimeIntervalMs, 10_000);
  assert.equal(config.realtimeIdleMs, 30_000);
});

test('empty values count as not set, except for AREA_NAME and OSM_PBF_URLS', () => {
  const config = loadConfig({ PORT: '', HOST: ' ', BBOX: '', AREA_FILE: '', VIEW: '', TIMEZONE: '', TILE_URL: '', TILE_ATTRIBUTION: '', FEED_URL: ' ', FEED_CHECK_MINUTES: '', AREA_NAME: '', OSM_PBF_URLS: '' });
  assert.equal(config.port, 8080);
  assert.equal(config.host, undefined);
  assert.deepEqual(config.view, [49.376, 10.916, 49.604, 11.204]);
  assert.equal(config.timeZone, 'Europe/Berlin');
  assert.equal(config.tileOrigin, 'https://tile.openstreetmap.org');
  assert.match(config.tileAttribution, /OpenStreetMap/);
  assert.equal(config.feedUrl, 'https://download.gtfs.de/germany/free/latest.zip');
  assert.equal(config.feedCheckMs, 15 * 60_000);
  // the VGN without a name and without route geometry
  assert.equal(config.areaName, '');
  assert.deepEqual(config.osmUrls, []);
});

test('the tile origin for the Content-Security-Policy', () => {
  const origin = (TILE_URL) => loadConfig({ BBOX, TILE_URL }).tileOrigin;
  assert.equal(origin('https://tile.example.org/{z}/{x}/{y}.png'), 'https://tile.example.org');
  assert.equal(origin('http://localhost:8081/tiles/{z}/{x}/{y}.png'), 'http://localhost:8081');
  assert.equal(origin('https://{s}.tile.example.org/{z}/{x}/{y}.png'), 'https://*.tile.example.org');
  assert.equal(origin('https://tiles-{s}.example.org:8443/{z}/{x}/{y}.png'), 'https://*.example.org:8443');
  assert.equal(origin('https://example.org/{s}/{z}/{x}/{y}.png'), 'https://example.org');
});

test('wrong settings are refused with a message that names the variable', () => {
  const box = /^BBOX must be "south,west,north,east" in degrees with south < north and west < east, e\.g\. /;
  const cases = [
    [{ PORT: '-1' }, /^PORT must be a whole number from 0 to 65535 \(got "-1"\)$/],
    [{ PORT: '65536' }, /^PORT must be /],
    [{ PORT: '80.5' }, /^PORT must be /],
    [{ PORT: '0x50' }, /^PORT must be /],
    [{ PORT: 'http' }, /^PORT must be /],
    [{ FEED_CHECK_MINUTES: '0' }, /^FEED_CHECK_MINUTES must be a number from 1 to 1440 \(got "0"\)$/],
    [{ FEED_CHECK_MINUTES: '99999' }, /^FEED_CHECK_MINUTES must be /],
    [{ REALTIME_INTERVAL_SECONDS: '9' }, /^REALTIME_INTERVAL_SECONDS must be a number from 10 to 3600 /],
    [{ REALTIME_INTERVAL_SECONDS: '3601' }, /^REALTIME_INTERVAL_SECONDS must be /],
    [{ REALTIME_IDLE_SECONDS: '-1' }, /^REALTIME_IDLE_SECONDS must be a number from 30 to 86400 /],
    [{ REALTIME_IDLE_SECONDS: '86401' }, /^REALTIME_IDLE_SECONDS must be /],
    [{ OSM_MAX_AGE_DAYS: '0' }, /^OSM_MAX_AGE_DAYS must be a number from 1 to 3650 /],
    [{ OSM_MAX_AGE_DAYS: 'never' }, /^OSM_MAX_AGE_DAYS must be /],
    [{ DOWNLOAD_TIMEOUT_MINUTES: '0' }, /^DOWNLOAD_TIMEOUT_MINUTES must be a number from 1 to 1440 /],
    [{ DOWNLOAD_TIMEOUT_MINUTES: 'Infinity' }, /^DOWNLOAD_TIMEOUT_MINUTES must be /],

    [{ BBOX: '49.3,,49.7,11.3' }, box], // an empty part is not 0
    [{ BBOX: '49.3,10.8,49.7' }, box],
    [{ BBOX: '49.3,10.8,49.7,11.3,0' }, box],
    [{ BBOX: '49.3;10.8;49.7;11.3' }, box],
    [{ BBOX: 'a,b,c,d' }, box],
    [{ BBOX: '49.7,10.8,49.3,11.3' }, box], // south above north
    [{ BBOX: '49.3,11.3,49.7,10.8' }, box], // west right of east
    [{ BBOX: '-91,10.8,49.7,11.3' }, box],
    [{ BBOX: '49.3,10.8,90.1,11.3' }, box],
    [{ BBOX: '49.3,-181,49.7,11.3' }, box],
    [{ BBOX: '49.3,10.8,49.7,181' }, box],
    [{ VIEW: '49.4,10.9' }, /^VIEW must be "south,west,north,east" .+ \(got "49\.4,10\.9"\)$/],
    [{ BBOX, AREA_FILE: file('both.geojson', SQUARE) }, /^AREA_FILE and BBOX are both set/],

    [{ BBOX: '', AREA_FILE: path.join(dir, 'missing.geojson') }, /^AREA_FILE: .*missing\.geojson cannot be read \(ENOENT\)$/],
    [{ BBOX: '', AREA_FILE: file('broken.geojson', '{"type":') }, /^AREA_FILE: .*broken\.geojson is not valid JSON \(/],
    [{ BBOX: '', AREA_FILE: file('empty.geojson', { type: 'FeatureCollection', features: [] }) }, /^AREA_FILE: .*empty\.geojson: area: the GeoJSON contains no polygons$/],
    [{ BBOX: '', AREA_FILE: file('nofeatures.geojson', { type: 'FeatureCollection' }) }, /^AREA_FILE: .*nofeatures\.geojson: area: the GeoJSON contains no polygons$/],
    [{ BBOX: '', AREA_FILE: file('point.geojson', { type: 'Polygon', coordinates: [[[11, 49.5], [11, 49.5], [11, 49.5]]] }) }, /^AREA_FILE: .*point\.geojson: area: no usable polygon$/],
    [{ BBOX: '', AREA_FILE: file('badoutline.geojson', { ...SQUARE, outline: [[11, 49.5]] }) }, /^AREA_FILE: .*badoutline\.geojson: "outline" must be an array of rings/],

    [{ FEED_URL: 'notaurl' }, /^FEED_URL must be an http\(s\) URL \(got "notaurl"\)$/],
    [{ FEED_URL: 'ftp://example.org/feed.zip' }, /^FEED_URL must be /],
    [{ REALTIME_URL: 'realtime.pb' }, /^REALTIME_URL must be an http\(s\) URL /],
    [{ OSM_PBF_URLS: 'https://example.org/a.osm.pbf,b.osm.pbf' }, /^OSM_PBF_URLS must be an http\(s\) URL \(got "b\.osm\.pbf"\)$/],
    [{ TILE_URL: 'https://tile.example.org/{z}/{x}.png' }, /^TILE_URL must be an http\(s\) URL template with \{z\}, \{x\} and \{y\}/],
    [{ TILE_URL: '/tiles/{z}/{x}/{y}.png' }, /^TILE_URL must be /],
    [{ TILE_URL: 'file:///tiles/{z}/{x}/{y}.png' }, /^TILE_URL must be /],
    [{ TILE_URL: 'https://tile.{s}.example.org/{z}/{x}/{y}.png' }, /^TILE_URL must be /], // only the first label can be a wildcard
    [{ TIMEZONE: 'Europe/Nuernberg' }, /^TIMEZONE must be an IANA time zone name such as Europe\/Berlin \(got "Europe\/Nuernberg"\)$/],
  ];
  for (const [env, message] of cases) {
    assert.throws(() => loadConfig({ BBOX, ...env }), (err) => err instanceof Error && message.test(err.message), `${JSON.stringify(env)} -> ${message}`);
  }
});

test('parseBox accepts four numbers and nothing else', () => {
  assert.deepEqual(parseBox('49.3,10.8,49.7,11.3'), [49.3, 10.8, 49.7, 11.3]);
  assert.deepEqual(parseBox(' -1 , +2.5 , .5 , 3. '), [-1, 2.5, 0.5, 3]);
  for (const text of [null, undefined, '', ',,,', '1,2,3', '1,2,3,4,5', '1,2,3,x', '1,2,3,', '1,2,3,1e2', '1,2,3,Infinity']) assert.equal(parseBox(text), null, String(text));
});
