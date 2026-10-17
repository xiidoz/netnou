import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linePath, parseAddress, slug, stopPath, tripPath, wordsOf } from '../public/address.js';
import { Addresses } from '../server/lib/addresses.js';
import { sitemapFiles } from '../server/lib/page.js';

test('a name as an address writes it: small letters, ä as ae, the words joined by hyphens', () => {
  assert.equal(slug('Nürnberg Plärrer'), 'nuernberg-plaerrer');
  assert.equal(slug('Straße der Einheit'), 'strasse-der-einheit');
  assert.equal(slug('Bi-Schildesche, Heidegärten'), 'bi-schildesche-heidegaerten');
  assert.equal(slug('D-Heinrich-Heine-Allee U'), 'd-heinrich-heine-allee-u');
  // letters of other languages lose their marks, or are written as they sound
  assert.equal(slug('Kraków, Główny'), 'krakow-glowny');
  assert.equal(slug('Łódź Fabryczna'), 'lodz-fabryczna');
  assert.equal(slug('Saint-Étienne'), 'saint-etienne');
  assert.equal(slug('ICE 41'), 'ice-41');
  // a name of no letters still makes an address
  assert.equal(slug('?!'), '-');
});

test('the address of a stop has its place to four decimals, that of a line its operator, kind and name', () => {
  assert.equal(stopPath('Nürnberg Plärrer', 49.44812, 11.06483), 'stop/nuernberg-plaerrer@49.4481,11.0648');
  assert.equal(stopPath('Rio', -22.9, -43.21), 'stop/rio@-22.9000,-43.2100');
  assert.equal(linePath({ agency: 'VerkehrsAG Nürnberg', mode: 'subway', name: 'U1' }), 'line/verkehrsag-nuernberg/subway/u1');
  assert.equal(linePath({ agency: 'DB Fernverkehr AG', mode: 'longdistance', name: 'ICE 41' }), 'line/db-fernverkehr-ag/longdistance/ice-41');
  // (a kind the address does not know is "other")
  assert.equal(linePath({ agency: 'X', mode: 'airship', name: '1' }), 'line/x/other/1');
  // where lines of the name are in places apart, with the place of the line (#152)
  assert.equal(linePath({ agency: 'DB Regio AG Bayern', mode: 'suburban', name: 'S1' }, '49.56,11.14'), 'line/db-regio-ag-bayern/suburban/s1@49.56,11.14');
});

test('what an address names, and what is not an address', () => {
  assert.deepEqual(parseAddress('stop/nuernberg-plaerrer@49.4481,11.0648'), { type: 'stop', name: 'nuernberg-plaerrer', lat: 49.4481, lon: 11.0648 });
  assert.deepEqual(parseAddress('stop/rio@-22.9,-43.21'), { type: 'stop', name: 'rio', lat: -22.9, lon: -43.21 });
  assert.deepEqual(parseAddress('line/verkehrsag-nuernberg/subway/u1'), { type: 'line', agency: 'verkehrsag-nuernberg', mode: 'subway', name: 'u1' });
  assert.deepEqual(parseAddress('line/db-regio-ag-bayern/suburban/s1@49.56,11.14'), { type: 'line', agency: 'db-regio-ag-bayern', mode: 'suburban', name: 's1', lat: 49.56, lon: 11.14 });
  // read back as written
  for (const path of [stopPath('Fürth Hbf', 49.4697, 10.9897), linePath({ agency: 'OVF', mode: 'bus', name: '113' })]) {
    const named = parseAddress(path);
    assert.equal(named.type === 'stop' ? stopPath(named.name, named.lat, named.lon) : linePath(named), path);
  }
  for (const path of ['', 'stop/', 'stop/plaerrer', 'stop/plaerrer@49.4,', 'stop/plaerrer@91.0,11.0', 'stop/Plaerrer@49.4,11.0', 'stop/a@49.4,11.0/more', 'line/vag/u1', 'line/vag/airship/u1', 'line/vag/subway/', 'line/vag/subway/u1@49.4', 'line/vag/subway/u1@91,11', 'trip/1', 'api/area']) {
    assert.equal(parseAddress(path), null, path);
  }
  // its name, as the search takes it
  assert.equal(wordsOf('nuernberg-plaerrer'), 'nuernberg plaerrer');
});

test('the address of a trip is its line, its day, and when and where it starts (#178)', () => {
  const path = tripPath({ agency: 'VerkehrsAG Nürnberg', mode: 'bus', name: '34' }, '2026-10-17', '0512', 'Nürnberg Frd.-Ebert-Platz');
  assert.equal(path, 'trip/verkehrsag-nuernberg/bus/34/2026-10-17/0512-nuernberg-frd-ebert-platz');
  assert.deepEqual(parseAddress(path), { type: 'trip', agency: 'verkehrsag-nuernberg', mode: 'bus', name: '34', day: '2026-10-17', time: '0512', from: 'nuernberg-frd-ebert-platz' });
  // (a kind the address does not know is "other", as for a line)
  assert.equal(tripPath({ agency: 'X', mode: 'airship', name: '1' }, '2026-10-17', '2359', 'A'), 'trip/x/other/1/2026-10-17/2359-a');
  for (const path of ['trip/vag/bus/34/2026-10-17/0512', 'trip/vag/bus/34/2026-10-17/2412-a', 'trip/vag/bus/34/2026-10-17/0560-a', 'trip/vag/bus/34/17.10.2026/0512-a', 'trip/vag/airship/34/2026-10-17/0512-a', 'trip/vag/bus/2026-10-17/0512-a', 'trip/vag/bus/34/2026-10-17/0512-A']) {
    assert.equal(parseAddress(path), null, path);
  }
});

test('an address finds the stop of its name nearest its place, else one of any name right there', () => {
  const stations = [
    { name: 'Ried', lat: 48.1, lon: 11.5 },
    { name: 'Ried', lat: 48.2, lon: 11.6 },
    { name: 'Ried', lat: 48.105, lon: 11.5 },
    { name: 'Hausen', lat: -33.9, lon: 18.4 },
    { name: 'Aachen Bushof', lat: 50.777, lon: 6.087 },
    { name: 'Zwickau', lat: 50.7, lon: 12.5 },
    { name: 'Nullpunkt', lat: -0.00001, lon: -0.00001 },
  ];
  const addresses = new Addresses({ stations, lines: [], stationService: [1, 1, 1, 1, 1, 1, 0] });
  // of three of a name the nearest, up to 1 km away
  assert.equal(addresses.station({ name: 'ried', lat: 48.104, lon: 11.5 }), 2);
  assert.equal(addresses.station({ name: 'ried', lat: 48.2001, lon: 11.6 }), 1);
  assert.equal(addresses.station({ name: 'ried', lat: 48.15, lon: 11.55 }), -1);
  // two of a name either side of where the places of their addresses round apart: each address names its own,
  // though the other is the nearer to the place in it
  const pair = new Addresses({ stations: [{ name: 'Lehmkaul', lat: 48.300049, lon: 11.500049 }, { name: 'Lehmkaul', lat: 48.300051, lon: 11.5 }], lines: [] });
  assert.deepEqual([pair.stationPath(0), pair.stationPath(1)], ['stop/lehmkaul@48.3000,11.5000', 'stop/lehmkaul@48.3001,11.5000']);
  assert.deepEqual([0, 1].map((i) => pair.station(parseAddress(pair.stationPath(i)))), [0, 1]);
  // the first and the last name, in the order of addresses
  assert.equal(addresses.station({ name: 'aachen-bushof', lat: 50.78, lon: 6.09 }), 4);
  assert.equal(addresses.station({ name: 'zwickau', lat: 50.7, lon: 12.5 }), 5);
  // another name, up to 10 m away: south of the equator, and across it and the meridian of Greenwich
  assert.equal(addresses.station({ name: 'kapstadt', lat: -33.90005, lon: 18.40005 }), 3);
  assert.equal(addresses.station({ name: 'kapstadt', lat: -33.9002, lon: 18.4 }), -1);
  assert.equal(addresses.station({ name: 'irgendwo', lat: 0.00002, lon: 0.00002 }), 6);
  // all with their addresses, but for the stop no trip calls at
  assert.deepEqual(addresses.paths(), [
    'stop/ried@48.1000,11.5000', 'stop/ried@48.2000,11.6000', 'stop/ried@48.1050,11.5000', 'stop/hausen@-33.9000,18.4000',
    'stop/aachen-bushof@50.7770,6.0870', 'stop/zwickau@50.7000,12.5000',
  ]);
});

test('lines of a name in places apart have the middle of their stations in their addresses (#152)', () => {
  const lines = [
    { name: 'S1', mode: 'suburban', agency: 'DB Regio AG Bayern', stops: 37, trips: 264, place: [49.56472, 11.13972] },
    { name: 'S1', mode: 'suburban', agency: 'DB Regio AG Bayern', stops: 24, trips: 1051, place: [48.21483, 11.59682] },
    { name: 'U1', mode: 'subway', agency: 'VAG', stops: 27, trips: 900, place: [49.44, 11.06] },
    // (two whose places are alike to two decimals: to four)
    { name: 'SEV', mode: 'bus', agency: 'VAG', stops: 4, trips: 50, place: [49.45201, 11.07702] },
    { name: 'SEV', mode: 'bus', agency: 'VAG', stops: 3, trips: 40, place: [49.45449, 11.07998] },
    // (without a stop in the area: as in the search, not there)
    { name: 'S1', mode: 'suburban', agency: 'DB Regio AG Bayern', stops: 0, trips: 5, place: [50, 10] },
    { name: '7', mode: 'bus', agency: 'VAG', stops: 0, trips: 5, place: [49.4, 11] },
  ];
  const addresses = new Addresses({ stations: [], lines, stationService: [] });
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => addresses.linePath(i)), [
    'line/db-regio-ag-bayern/suburban/s1@49.56,11.14',
    'line/db-regio-ag-bayern/suburban/s1@48.21,11.60',
    'line/vag/subway/u1',
    'line/vag/bus/sev@49.4520,11.0770',
    'line/vag/bus/sev@49.4545,11.0800',
  ]);
  // each address names its own line
  for (const i of [0, 1, 2, 3, 4]) assert.equal(addresses.line(parseAddress(addresses.linePath(i))), i);
  // without a place the busiest of the name, Munich's S1, whose address it then is sent on to; with one the nearest
  assert.equal(addresses.line(parseAddress('line/db-regio-ag-bayern/suburban/s1')), 1);
  assert.equal(addresses.line(parseAddress('line/db-regio-ag-bayern/suburban/s1@49.45,11.08')), 0);
  // a place of a line alone of its name changes nothing; a line not in the area has no address
  assert.equal(addresses.line(parseAddress('line/vag/subway/u1@48.1,11.5')), 2);
  assert.equal(addresses.line(parseAddress('line/vag/bus/7')), -1);
  // the sitemap lists each, the busiest of a name first
  assert.deepEqual(addresses.paths(), [
    'line/db-regio-ag-bayern/suburban/s1@48.21,11.60', 'line/db-regio-ag-bayern/suburban/s1@49.56,11.14', 'line/vag/subway/u1',
    'line/vag/bus/sev@49.4520,11.0770', 'line/vag/bus/sev@49.4545,11.0800',
  ]);
});

test('a sitemap of more addresses than a file may hold is cut into parts, which sitemap.xml lists', () => {
  const at = 'https://karte.example.org/';
  const paths = Array.from({ length: 7 }, (_, i) => `stop/s${i}@49.0000,11.0000`);
  const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => loc);
  // the page in three versions and seven stops: one file of ten
  const [one, ...more] = sitemapFiles(at, paths, 10);
  assert.equal(locs(one).length, 10);
  assert.deepEqual(more, []);
  // in parts of four: the index and three parts, all ten addresses in them once
  const [index, ...parts] = sitemapFiles(at, paths, 4);
  assert.match(index, /^<\?xml[^>]*>\n<sitemapindex /);
  assert.deepEqual(locs(index), [`${at}sitemap-1.xml`, `${at}sitemap-2.xml`, `${at}sitemap-3.xml`]);
  assert.ok(parts.every((xml) => /^<\?xml[^>]*>\n<urlset /.test(xml)));
  assert.deepEqual(parts.flatMap(locs), [at, `${at}?lang=de`, `${at}?lang=en`, ...paths.map((path) => at + path)]);
});
