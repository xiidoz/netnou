import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { LANGUAGES } from '../public/i18n.js';
import { loadConfig, parseBox } from '../server/config.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-config-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = (name, content) => {
  const full = path.join(dir, name);
  fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  return full;
};
// A small rectangle keeps the tests that are not about the area quick.
const NETNOU_BBOX = '49.3,10.8,49.7,11.3';
const SQUARE = { type: 'Polygon', coordinates: [[[10.8, 49.3], [11.3, 49.3], [11.3, 49.7], [10.8, 49.7], [10.8, 49.3]]] };

test('what the page says about itself: its main language and the address of the instance', () => {
  // German, as the default area and its feed are, and no address: nothing in the page then needs one
  assert.deepEqual([loadConfig({}).language, loadConfig({}).publicUrl], ['de', null]);
  assert.equal(loadConfig({ NETNOU_LANGUAGE: ' EN ' }).language, 'en');
  assert.throws(() => loadConfig({ NETNOU_LANGUAGE: 'fr' }), /^Error: NETNOU_LANGUAGE must be one of the languages of the page: de, en \(got "fr"\)$/);

  // always with a slash at its end, with a path if the instance is under one
  for (const [given, taken] of [['https://karte.example.org', 'https://karte.example.org/'], ['https://karte.example.org/', 'https://karte.example.org/'],
    ['http://example.org:8080/netnou', 'http://example.org:8080/netnou/'], [' https://example.org/a/b// ', 'https://example.org/a/b/']]) {
    assert.equal(loadConfig({ NETNOU_PUBLIC_URL: given }).publicUrl, taken, given);
  }
  assert.equal(loadConfig({ NETNOU_PUBLIC_URL: ' ' }).publicUrl, null);

  // an instance may call itself something else than the software; an empty name is none
  assert.equal(loadConfig({ NETNOU_SITE_NAME: ' Bus & Bahn live ' }).siteName, 'Bus & Bahn live');
  assert.equal(loadConfig({ NETNOU_SITE_NAME: ' ' }).siteName, 'Netnou');
  // a title and a description of the operator's own for the page, by its languages: none unless set, each on one line
  const inAll = (words) => Object.fromEntries(LANGUAGES.map(([code]) => [code, words]));
  assert.deepEqual([loadConfig({}).siteTitle, loadConfig({}).siteDescription], [inAll(null), inAll(null)]);
  assert.deepEqual(loadConfig({ NETNOU_SITE_TITLE: ' ', NETNOU_SITE_DESCRIPTION: '' }).siteTitle, inAll(null));
  assert.deepEqual(loadConfig({ NETNOU_SITE_TITLE: ' Bus & Bahn live:\n   der Großraum Nürnberg ' }).siteTitle, inAll('Bus & Bahn live: der Großraum Nürnberg'));
  assert.deepEqual(loadConfig({ NETNOU_SITE_DESCRIPTION: 'Wo ist\tmeine Bahn? ' }).siteDescription, inAll('Wo ist meine Bahn?'));
  // one for a language alone takes the place of the one for all there, and stands by itself where there is none for all
  assert.deepEqual(loadConfig({ NETNOU_SITE_TITLE: 'Bus & Bahn live', NETNOU_SITE_TITLE_EN: ' Buses and trains,\n live ' }).siteTitle, { ...inAll('Bus & Bahn live'), en: 'Buses and trains, live' });
  assert.deepEqual(loadConfig({ NETNOU_SITE_DESCRIPTION_DE: 'Wo ist meine Bahn?' }).siteDescription, { ...inAll(null), de: 'Wo ist meine Bahn?' });
  assert.deepEqual(loadConfig({ NETNOU_SITE_TITLE: 'Bus & Bahn live', NETNOU_SITE_TITLE_EN: ' ' }).siteTitle, inAll('Bus & Bahn live'));
  // texts by language in the one setting, as a JSON object: for the languages it names, the others keep the page's own
  assert.deepEqual(loadConfig({ NETNOU_SITE_TITLE: ' {"de": "Bus & Bahn\\n live", "en": "Buses and trains, live"} ' }).siteTitle, { ...inAll(null), de: 'Bus & Bahn live', en: 'Buses and trains, live' });
  assert.deepEqual(loadConfig({ NETNOU_SITE_DESCRIPTION: '{"de": "Wo ist meine Bahn?"}' }).siteDescription, { ...inAll(null), de: 'Wo ist meine Bahn?' });
  assert.deepEqual(loadConfig({ NETNOU_SITE_TITLE: '{}' }).siteTitle, inAll(null));
  // the setting for one language wins over the object
  assert.deepEqual(loadConfig({ NETNOU_SITE_TITLE: '{"de": "aus dem Objekt", "en": "from the object"}', NETNOU_SITE_TITLE_EN: 'of its own' }).siteTitle, { ...inAll(null), de: 'aus dem Objekt', en: 'of its own' });
  // what begins as an object and is none of texts is refused
  for (const wrong of ['{de: "Bus"}', '{"de": 5}', '{"de": ["Bus"]}', '{"de": null}', '{']) {
    assert.throws(() => loadConfig({ NETNOU_SITE_TITLE: wrong }), /^Error: NETNOU_SITE_TITLE must be a text, or texts by language as a JSON object such as \{"/, wrong);
  }
  // a language the page does not have is refused, by its name
  assert.throws(() => loadConfig({ NETNOU_SITE_TITLE: '{"de": "Bus", "xx": "Bus"}' }), /^Error: NETNOU_SITE_TITLE: the page has no language "xx"; it has /);
  assert.throws(() => loadConfig({ NETNOU_SITE_TITLE_XX: 'Bus & Bahn live' }), /^Error: NETNOU_SITE_TITLE_XX: the page has no such language; it has /);
  assert.throws(() => loadConfig({ NETNOU_SITE_DESCRIPTION_: 'Wo ist meine Bahn?' }), /^Error: NETNOU_SITE_DESCRIPTION_: the page has no such language/);

  // a folder with icons of the operator's own: none unless it is named
  assert.equal(loadConfig({}).brandDir, null);
  assert.equal(loadConfig({ NETNOU_BRAND_DIR: ' ' }).brandDir, null);
  assert.equal(loadConfig({ NETNOU_BRAND_DIR: 'brand' }).brandDir, path.resolve('brand'));

  // links of the operator's own: none by default, else a text and an address each
  assert.deepEqual(loadConfig({}).links, []);
  assert.deepEqual(loadConfig({ NETNOU_LINKS: ' , ' }).links, []);
  assert.deepEqual(loadConfig({ NETNOU_LINKS: 'Über=/ueber, Impressum = https://example.org/impressum?x=1 ,Datenschutz=/datenschutz/' }).links, [
    { text: 'Über', href: '/ueber' }, { text: 'Impressum', href: 'https://example.org/impressum?x=1' }, { text: 'Datenschutz', href: '/datenschutz/' },
  ]);
  for (const wrong of ['Impressum', '=/impressum', 'Impressum=', 'Impressum=impressum.html', 'Impressum=//example.org/', 'Impressum=javascript:alert(1)', 'Impressum=mailto:a@example.org', 'Über=/ueber, Impressum']) {
    assert.throws(() => loadConfig({ NETNOU_LINKS: wrong }), /^Error: NETNOU_LINKS must be links as "Text=address", separated by commas, .+ \(not understood: ".+"\)$/, wrong);
  }

  // Search engines may list an instance that knows its address, and no other, unless the operator says so.
  assert.equal(loadConfig({}).searchEngines, false);
  assert.equal(loadConfig({ NETNOU_PUBLIC_URL: 'https://karte.example.org/' }).searchEngines, true);
  assert.equal(loadConfig({ NETNOU_PUBLIC_URL: 'https://karte.example.org/', NETNOU_SEARCH_ENGINES: 'off' }).searchEngines, false);
  assert.equal(loadConfig({ NETNOU_SEARCH_ENGINES: 'ON' }).searchEngines, true);
  assert.equal(loadConfig({ NETNOU_SEARCH_ENGINES: 'off' }).searchEngines, false);
  assert.throws(() => loadConfig({ NETNOU_SEARCH_ENGINES: 'no' }), /^Error: NETNOU_SEARCH_ENGINES must be "on" or "off" \(got "no"\)$/);
  for (const wrong of ['karte.example.org', 'ftp://example.org/', 'https://example.org/?lang=de', 'https://example.org/#map', 'https://user:secret@example.org/']) {
    assert.throws(() => loadConfig({ NETNOU_PUBLIC_URL: wrong }), /^Error: NETNOU_PUBLIC_URL must be the http\(s\) address of the page, without a query, /, wrong);
  }
});

test('defaults: the VGN, its OSM extracts, the gtfs.de feeds and OpenStreetMap tiles', () => {
  const config = loadConfig({});
  assert.equal(config.port, 8080);
  assert.equal(config.host, undefined);
  assert.equal(path.basename(config.dataDir), 'data');
  assert.ok(fs.existsSync(path.join(config.publicDir, 'index.html')));

  assert.equal(config.siteName, 'Netnou');
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
  assert.equal(config.realtimeIntervalMs, 60_000);
  assert.equal(config.realtimeIdleMs, 120_000);
  assert.equal(config.updateCheck, true);

  assert.equal(config.timeZone, 'Europe/Berlin');
  assert.equal(config.styleUrl, 'https://tiles.openfreemap.org/styles/bright');
  assert.equal(config.tileUrl, null);
  assert.deepEqual(config.mapOrigins, ['https://tiles.openfreemap.org']);
  assert.equal(config.tileAttribution, '');
  assert.equal(config.dataAttribution, '<a href="https://gtfs.de">GTFS.DE</a> / <a href="https://www.delfi.de">DELFI e.V.</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)');
});

test('a custom area has no name, no OSM extracts and is shown as a whole', () => {
  const box = loadConfig({ NETNOU_BBOX });
  assert.deepEqual(box.area.bbox, [49.3, 10.8, 49.7, 11.3]);
  assert.equal(box.areaName, '');
  assert.deepEqual(box.view, [49.3, 10.8, 49.7, 11.3]);
  assert.deepEqual(box.osmUrls, []);
  assert.deepEqual(box.areaOutline, [[[10.8, 49.3], [11.3, 49.3], [11.3, 49.7], [10.8, 49.7], [10.8, 49.3]]]);

  const fromFile = loadConfig({ NETNOU_AREA_FILE: file('square.geojson', { type: 'Feature', geometry: SQUARE }) });
  assert.equal(fromFile.area.id, box.area.id);
  assert.equal(fromFile.areaName, '');
  assert.deepEqual(fromFile.view, [49.3, 10.8, 49.7, 11.3]);
  assert.deepEqual(fromFile.osmUrls, []);
  assert.deepEqual(fromFile.areaOutline, box.areaOutline);

  // a file may bring the outline to draw
  const outline = [[[10.9, 49.4], [11.2, 49.4], [11.2, 49.6], [10.9, 49.4]]];
  assert.deepEqual(loadConfig({ NETNOU_AREA_FILE: file('outline.geojson', { ...SQUARE, outline }) }).areaOutline, outline);
});

test('every setting can be given', () => {
  const config = loadConfig({
    NETNOU_PORT: '0',
    NETNOU_HOST: '127.0.0.1',
    NETNOU_DATA_DIR: dir,
    NETNOU_BBOX: ' 49.3, 10.8, 49.7, 11.3 ',
    NETNOU_AREA_NAME: ' Testland ',
    NETNOU_VIEW: '49.4,10.9,49.6,11.2',
    NETNOU_TIMEZONE: 'europe/vienna',
    NETNOU_TILE_URL: 'https://{s}.tiles.example.org/{z}/{x}/{y}{r}.png?key=1',
    NETNOU_TILE_ATTRIBUTION: '<b>tiles</b>',
    NETNOU_MAP_ORIGINS: 'https://fonts.example.org/noto/{fontstack}/{range}.pbf, http://localhost:8082,',
    NETNOU_DATA_ATTRIBUTION: '<b>data</b>',
    NETNOU_FEED_URL: 'http://127.0.0.1:8000/feed.zip',
    NETNOU_REALTIME_URL: 'http://127.0.0.1:8000/realtime.pb',
    NETNOU_OSM_PBF_URLS: 'https://example.org/a.osm.pbf, https://example.org/b.osm.pbf,',
    NETNOU_OSM_MAX_AGE_DAYS: '7',
    NETNOU_FEED_CHECK_MINUTES: '60',
    NETNOU_DOWNLOAD_TIMEOUT_MINUTES: '2.5',
    NETNOU_REALTIME_INTERVAL_SECONDS: '10',
    NETNOU_REALTIME_IDLE_SECONDS: '30',
    NETNOU_UPDATE_CHECK: ' Off ',
  });
  assert.equal(config.port, 0);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.dataDir, dir);
  assert.equal(config.areaName, 'Testland');
  assert.deepEqual(config.view, [49.4, 10.9, 49.6, 11.2]);
  assert.equal(config.timeZone, 'Europe/Vienna');
  assert.equal(config.styleUrl, null);
  assert.equal(config.tileUrl, 'https://{s}.tiles.example.org/{z}/{x}/{y}{r}.png?key=1');
  assert.deepEqual(config.mapOrigins, ['https://*.tiles.example.org', 'https://fonts.example.org', 'http://localhost:8082']);
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
  assert.equal(config.updateCheck, false);
});

test('all of Germany is everything the feed has, and an instance may keep the trips of some operators only', () => {
  const plain = loadConfig({});
  const germany = loadConfig({ NETNOU_AREA: 'Germany' });
  // no outline: what it covers is known once it has a timetable
  assert.equal(germany.area, null);
  assert.deepEqual(germany.areaOutline, []);
  // its name, the section to begin with and the extract of Germany
  assert.deepEqual([germany.areaName, germany.view, germany.osmUrls], ['Deutschland', [47.27, 5.87, 55.06, 15.04], ['https://download.geofabrik.de/europe/germany-latest.osm.pbf']]);
  assert.equal(germany.agencies, null);
  assert.equal(loadConfig({ NETNOU_AREA: ' GERMANY ' }).areaName, 'Deutschland');
  // each of them may be set otherwise, also to no extracts at all
  const named = loadConfig({ NETNOU_AREA: 'germany', NETNOU_VIEW: '52.45,13.25,52.57,13.52', NETNOU_AREA_NAME: 'Bundesweit', NETNOU_OSM_PBF_URLS: 'https://osm.example.org/a.osm.pbf, https://osm.example.org/b.osm.pbf' });
  assert.deepEqual([named.view, named.areaName, named.osmUrls], [[52.45, 13.25, 52.57, 13.52], 'Bundesweit', ['https://osm.example.org/a.osm.pbf', 'https://osm.example.org/b.osm.pbf']]);
  assert.deepEqual(loadConfig({ NETNOU_AREA: 'Germany', NETNOU_OSM_PBF_URLS: '' }).osmUrls, []);
  // the VGN, which is there without NETNOU_AREA, may be named as well
  const vgn = loadConfig({ NETNOU_AREA: 'VGN' });
  assert.deepEqual([vgn.scope, vgn.areaName, vgn.view, vgn.osmUrls], [plain.scope, plain.areaName, plain.view, plain.osmUrls]);

  // operators: as written, each once, compared without capitals and the spaces around them
  const some = loadConfig({ NETNOU_AGENCIES: ' VerkehrsAG Nürnberg , verkehrsag nürnberg,Infra Fürth, ' });
  assert.deepEqual(some.agencies, [{ name: 'VerkehrsAG Nürnberg', key: 'verkehrsag nürnberg' }, { name: 'Infra Fürth', key: 'infra fürth' }]);
  // (the area stays what it is without them: here the built-in one)
  assert.equal(some.areaName, 'Großraum Nürnberg (VGN)');
  assert.ok(some.area);
  // a name with a comma in it needs the list as JSON
  assert.deepEqual(loadConfig({ NETNOU_AGENCIES: '["Stadtwerke, Verkehr", "Bahn"]' }).agencies.map(({ name }) => name), ['Stadtwerke, Verkehr', 'Bahn']);

  // What stored data is tied to: the area alone as it always was, and
  // something else for every other choice of area and operators.
  assert.equal(plain.scope, plain.area.id);
  const scopes = [plain, germany, some, loadConfig({ NETNOU_AREA: 'Germany', NETNOU_AGENCIES: 'Infra Fürth' }), loadConfig({ NETNOU_BBOX, NETNOU_AGENCIES: 'Infra Fürth' })].map((config) => config.scope);
  assert.equal(new Set(scopes).size, scopes.length);
  // (neither the order of the names nor their capitals make another instance)
  assert.equal(loadConfig({ NETNOU_AGENCIES: 'INFRA FÜRTH,VerkehrsAG Nürnberg' }).scope, some.scope);
});

test('empty values count as not set, except for NETNOU_AREA_NAME and NETNOU_OSM_PBF_URLS', () => {
  const config = loadConfig({ NETNOU_PORT: '', NETNOU_HOST: ' ', NETNOU_BBOX: '', NETNOU_AREA_FILE: '', NETNOU_VIEW: '', NETNOU_TIMEZONE: '', NETNOU_MAP_STYLE_URL: ' ', NETNOU_MAP_ORIGINS: '', NETNOU_TILE_URL: '', NETNOU_TILE_ATTRIBUTION: '', NETNOU_FEED_URL: ' ', NETNOU_FEED_CHECK_MINUTES: '', NETNOU_AREA_NAME: '', NETNOU_OSM_PBF_URLS: '' });
  assert.equal(config.port, 8080);
  assert.equal(config.host, undefined);
  assert.deepEqual(config.view, [49.376, 10.916, 49.604, 11.204]);
  assert.equal(config.timeZone, 'Europe/Berlin');
  assert.equal(config.styleUrl, 'https://tiles.openfreemap.org/styles/bright');
  assert.deepEqual(config.mapOrigins, ['https://tiles.openfreemap.org']);
  assert.equal(config.tileAttribution, '');
  assert.equal(config.feedUrl, 'https://download.gtfs.de/germany/free/latest.zip');
  assert.equal(config.feedCheckMs, 15 * 60_000);
  // the VGN without a name and without route geometry
  assert.equal(config.areaName, '');
  assert.deepEqual(config.osmUrls, []);
});

test('the map is a style or raster tiles, and the Content-Security-Policy gets the origins of either', () => {
  const style = loadConfig({ NETNOU_BBOX, NETNOU_MAP_STYLE_URL: 'https://maps.example.org:8443/styles/day.json?key=1', NETNOU_MAP_ORIGINS: 'https://maps.example.org:8443/fonts, https://tiles.example.org' });
  assert.equal(style.styleUrl, 'https://maps.example.org:8443/styles/day.json?key=1');
  assert.equal(style.tileUrl, null);
  // each origin once
  assert.deepEqual(style.mapOrigins, ['https://maps.example.org:8443', 'https://tiles.example.org']);
  // a style names its sources itself, unless the operator adds to them
  assert.equal(style.tileAttribution, '');
  assert.equal(loadConfig({ NETNOU_BBOX, NETNOU_TILE_ATTRIBUTION: '<b>map</b>' }).tileAttribution, '<b>map</b>');

  const tiles = loadConfig({ NETNOU_BBOX, NETNOU_TILE_URL: 'https://tile.example.org/{z}/{x}/{y}.png' });
  assert.equal(tiles.styleUrl, null);
  assert.equal(tiles.tileUrl, 'https://tile.example.org/{z}/{x}/{y}.png');
  assert.equal(tiles.tileAttribution, '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');

  const origin = (NETNOU_TILE_URL) => loadConfig({ NETNOU_BBOX, NETNOU_TILE_URL }).mapOrigins.join();
  assert.equal(origin('https://tile.example.org/{z}/{x}/{y}.png'), 'https://tile.example.org');
  assert.equal(origin('http://localhost:8081/tiles/{z}/{x}/{y}.png'), 'http://localhost:8081');
  assert.equal(origin('https://{s}.tile.example.org/{z}/{x}/{y}.png'), 'https://*.tile.example.org');
  assert.equal(origin('https://tiles-{s}.example.org:8443/{z}/{x}/{y}.png'), 'https://*.example.org:8443');
  assert.equal(origin('https://example.org/{s}/{z}/{x}/{y}.png'), 'https://example.org');
});

test('wrong settings are refused with a message that names the variable', () => {
  const box = /^NETNOU_BBOX must be "south,west,north,east" in degrees with south < north and west < east, e\.g\. /;
  const cases = [
    [{ NETNOU_PORT: '-1' }, /^NETNOU_PORT must be a whole number from 0 to 65535 \(got "-1"\)$/],
    [{ NETNOU_PORT: '65536' }, /^NETNOU_PORT must be /],
    [{ NETNOU_PORT: '80.5' }, /^NETNOU_PORT must be /],
    [{ NETNOU_PORT: '0x50' }, /^NETNOU_PORT must be /],
    [{ NETNOU_PORT: 'http' }, /^NETNOU_PORT must be /],
    [{ NETNOU_FEED_CHECK_MINUTES: '0' }, /^NETNOU_FEED_CHECK_MINUTES must be a number from 1 to 1440 \(got "0"\)$/],
    [{ NETNOU_FEED_CHECK_MINUTES: '99999' }, /^NETNOU_FEED_CHECK_MINUTES must be /],
    [{ NETNOU_REALTIME_INTERVAL_SECONDS: '9' }, /^NETNOU_REALTIME_INTERVAL_SECONDS must be a number from 10 to 3600 /],
    [{ NETNOU_REALTIME_INTERVAL_SECONDS: '3601' }, /^NETNOU_REALTIME_INTERVAL_SECONDS must be /],
    [{ NETNOU_REALTIME_IDLE_SECONDS: '-1' }, /^NETNOU_REALTIME_IDLE_SECONDS must be a number from 30 to 86400 /],
    [{ NETNOU_REALTIME_IDLE_SECONDS: '86401' }, /^NETNOU_REALTIME_IDLE_SECONDS must be /],
    [{ NETNOU_OSM_MAX_AGE_DAYS: '0' }, /^NETNOU_OSM_MAX_AGE_DAYS must be a number from 1 to 3650 /],
    [{ NETNOU_OSM_MAX_AGE_DAYS: 'never' }, /^NETNOU_OSM_MAX_AGE_DAYS must be /],
    [{ NETNOU_DOWNLOAD_TIMEOUT_MINUTES: '0' }, /^NETNOU_DOWNLOAD_TIMEOUT_MINUTES must be a number from 1 to 1440 /],
    [{ NETNOU_DOWNLOAD_TIMEOUT_MINUTES: 'Infinity' }, /^NETNOU_DOWNLOAD_TIMEOUT_MINUTES must be /],

    [{ NETNOU_AREA: 'all' }, /^NETNOU_AREA must be "VGN" or "Germany"; an area of your own is given with NETNOU_AREA_FILE or NETNOU_BBOX \(got "all"\)$/],
    [{ NETNOU_AREA: 'constructor' }, /^NETNOU_AREA must be "VGN" or "Germany"/],
    [{ NETNOU_AREA: 'Germany', NETNOU_BBOX }, /^NETNOU_AREA and NETNOU_BBOX are both set; use only one of them$/],
    [{ NETNOU_AREA: 'VGN', NETNOU_BBOX, NETNOU_AREA_FILE: 'area.geojson' }, /^NETNOU_AREA, NETNOU_AREA_FILE and NETNOU_BBOX are all set; use only one of them$/],
    [{ NETNOU_AGENCIES: ' , ' }, /^NETNOU_AGENCIES must be names of operators separated by commas, or a JSON array of them such as \["Stadtwerke, Verkehr", "Bahn"\] \(got " , "\)$/],
    [{ NETNOU_AGENCIES: '["Bahn", 7]' }, /^NETNOU_AGENCIES must be names of operators/],
    [{ NETNOU_AGENCIES: '["Bahn"' }, /^NETNOU_AGENCIES must be names of operators/],
    [{ NETNOU_AGENCIES: '[]' }, /^NETNOU_AGENCIES must be names of operators/],
    [{ NETNOU_BBOX: '49.3,,49.7,11.3' }, box], // an empty part is not 0
    [{ NETNOU_BBOX: '49.3,10.8,49.7' }, box],
    [{ NETNOU_BBOX: '49.3,10.8,49.7,11.3,0' }, box],
    [{ NETNOU_BBOX: '49.3;10.8;49.7;11.3' }, box],
    [{ NETNOU_BBOX: 'a,b,c,d' }, box],
    [{ NETNOU_BBOX: '49.7,10.8,49.3,11.3' }, box], // south above north
    [{ NETNOU_BBOX: '49.3,11.3,49.7,10.8' }, box], // west right of east
    [{ NETNOU_BBOX: '-91,10.8,49.7,11.3' }, box],
    [{ NETNOU_BBOX: '49.3,10.8,90.1,11.3' }, box],
    [{ NETNOU_BBOX: '49.3,-181,49.7,11.3' }, box],
    [{ NETNOU_BBOX: '49.3,10.8,49.7,181' }, box],
    [{ NETNOU_VIEW: '49.4,10.9' }, /^NETNOU_VIEW must be "south,west,north,east" .+ \(got "49\.4,10\.9"\)$/],
    [{ NETNOU_BBOX, NETNOU_AREA_FILE: file('both.geojson', SQUARE) }, /^NETNOU_AREA_FILE and NETNOU_BBOX are both set/],

    [{ NETNOU_BBOX: '', NETNOU_AREA_FILE: path.join(dir, 'missing.geojson') }, /^NETNOU_AREA_FILE: .*missing\.geojson cannot be read \(ENOENT\)$/],
    [{ NETNOU_BBOX: '', NETNOU_AREA_FILE: file('broken.geojson', '{"type":') }, /^NETNOU_AREA_FILE: .*broken\.geojson is not valid JSON \(/],
    [{ NETNOU_BBOX: '', NETNOU_AREA_FILE: file('empty.geojson', { type: 'FeatureCollection', features: [] }) }, /^NETNOU_AREA_FILE: .*empty\.geojson: area: the GeoJSON contains no polygons$/],
    [{ NETNOU_BBOX: '', NETNOU_AREA_FILE: file('nofeatures.geojson', { type: 'FeatureCollection' }) }, /^NETNOU_AREA_FILE: .*nofeatures\.geojson: area: the GeoJSON contains no polygons$/],
    [{ NETNOU_BBOX: '', NETNOU_AREA_FILE: file('point.geojson', { type: 'Polygon', coordinates: [[[11, 49.5], [11, 49.5], [11, 49.5]]] }) }, /^NETNOU_AREA_FILE: .*point\.geojson: area: no usable polygon$/],
    [{ NETNOU_BBOX: '', NETNOU_AREA_FILE: file('badoutline.geojson', { ...SQUARE, outline: [[11, 49.5]] }) }, /^NETNOU_AREA_FILE: .*badoutline\.geojson: "outline" must be an array of rings/],

    [{ NETNOU_FEED_URL: 'notaurl' }, /^NETNOU_FEED_URL must be an http\(s\) URL \(got "notaurl"\)$/],
    [{ NETNOU_FEED_URL: 'ftp://example.org/feed.zip' }, /^NETNOU_FEED_URL must be /],
    [{ NETNOU_REALTIME_URL: 'realtime.pb' }, /^NETNOU_REALTIME_URL must be an http\(s\) URL /],
    [{ NETNOU_OSM_PBF_URLS: 'https://example.org/a.osm.pbf,b.osm.pbf' }, /^NETNOU_OSM_PBF_URLS must be an http\(s\) URL \(got "b\.osm\.pbf"\)$/],
    [{ NETNOU_MAP_STYLE_URL: 'styles/bright' }, /^NETNOU_MAP_STYLE_URL must be an http\(s\) URL \(got "styles\/bright"\)$/],
    [{ NETNOU_MAP_STYLE_URL: 'https://maps.example.org/style.json', NETNOU_TILE_URL: 'https://tile.example.org/{z}/{x}/{y}.png' }, /^NETNOU_MAP_STYLE_URL and NETNOU_TILE_URL are both set; use only one of them$/],
    [{ NETNOU_MAP_ORIGINS: 'https://tiles.example.org, fonts.example.org' }, /^NETNOU_MAP_ORIGINS must be an http\(s\) URL \(got "fonts\.example\.org"\)$/],
    [{ NETNOU_TILE_URL: 'https://tile.example.org/{z}/{x}.png' }, /^NETNOU_TILE_URL must be an http\(s\) URL template with \{z\}, \{x\} and \{y\}/],
    [{ NETNOU_TILE_URL: '/tiles/{z}/{x}/{y}.png' }, /^NETNOU_TILE_URL must be /],
    [{ NETNOU_TILE_URL: 'file:///tiles/{z}/{x}/{y}.png' }, /^NETNOU_TILE_URL must be /],
    [{ NETNOU_TILE_URL: 'https://tile.{s}.example.org/{z}/{x}/{y}.png' }, /^NETNOU_TILE_URL must be /], // only the first label can be a wildcard
    [{ NETNOU_UPDATE_CHECK: 'false' }, /^NETNOU_UPDATE_CHECK must be "on" or "off" \(got "false"\)$/],
    [{ NETNOU_TIMEZONE: 'Europe/Nuernberg' }, /^NETNOU_TIMEZONE must be an IANA time zone name such as Europe\/Berlin \(got "Europe\/Nuernberg"\)$/],
  ];
  for (const [env, message] of cases) {
    assert.throws(() => loadConfig({ NETNOU_BBOX, ...env }), (err) => err instanceof Error && message.test(err.message), `${JSON.stringify(env)} -> ${message}`);
  }
});

test('only names that begin with NETNOU_ are read', () => {
  const config = loadConfig({ SITE_NAME: 'Bus & Bahn', PORT: '9000', BBOX: '49.3,10.8,49.7,11.3', LINKS: 'Impressum=/impressum' });
  assert.equal(config.siteName, 'Netnou');
  assert.equal(config.port, 8080);
  assert.equal(config.areaName, 'Großraum Nürnberg (VGN)');
  assert.deepEqual(config.links, []);
});

test('parseBox accepts four numbers and nothing else', () => {
  assert.deepEqual(parseBox('49.3,10.8,49.7,11.3'), [49.3, 10.8, 49.7, 11.3]);
  assert.deepEqual(parseBox(' -1 , +2.5 , .5 , 3. '), [-1, 2.5, 0.5, 3]);
  for (const text of [null, undefined, '', ',,,', '1,2,3', '1,2,3,4,5', '1,2,3,x', '1,2,3,', '1,2,3,1e2', '1,2,3,Infinity']) assert.equal(parseBox(text), null, String(text));
});
