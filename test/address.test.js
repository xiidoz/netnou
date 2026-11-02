import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linePath, parseAddress, slug, stopPath, stopPathAt, tripPath, wordsOf } from '../public/address.js';
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

test('the address of a stop is its name as its title has it (#288), that of a line its operator, kind and name', () => {
  assert.equal(stopPath({ name: 'Nürnberg Plärrer', town: 'Nürnberg' }), 'stop/nuernberg-plaerrer');
  // with its town after a name that does not say it, as in its title (#254)
  assert.equal(stopPath({ name: 'Bruck/ER Rotes Kreuz', town: 'Erlangen' }), 'stop/bruck-er-rotes-kreuz-erlangen');
  assert.equal(stopPath({ name: 'Amsterdam Centraal', town: null }), 'stop/amsterdam-centraal');
  // and with a place where stops are named alike
  assert.equal(stopPath({ name: 'Rio', town: null }, '-22.90,-43.21'), 'stop/rio@-22.90,-43.21');
  // as addresses were written before: by the name and the place to four decimals
  assert.equal(stopPathAt('Nürnberg Plärrer', 49.44812, 11.06483), 'stop/nuernberg-plaerrer@49.4481,11.0648');
  assert.equal(stopPathAt('Rio', -22.9, -43.21), 'stop/rio@-22.9000,-43.2100');
  assert.equal(linePath({ agency: 'VerkehrsAG Nürnberg', mode: 'subway', name: 'U1' }), 'line/verkehrsag-nuernberg/subway/u1');
  assert.equal(linePath({ agency: 'DB Fernverkehr AG', mode: 'longdistance', name: 'ICE 41' }), 'line/db-fernverkehr-ag/longdistance/ice-41');
  // (a kind the address does not know is "other")
  assert.equal(linePath({ agency: 'X', mode: 'airship', name: '1' }), 'line/x/other/1');
  // where lines of the name are in places apart, with the place of the line (#152)
  assert.equal(linePath({ agency: 'DB Regio AG Bayern', mode: 'suburban', name: 'S1' }, '49.56,11.14'), 'line/db-regio-ag-bayern/suburban/s1@49.56,11.14');
});

test('what an address names, and what is not an address', () => {
  assert.deepEqual(parseAddress('stop/nuernberg-plaerrer'), { type: 'stop', name: 'nuernberg-plaerrer' });
  assert.deepEqual(parseAddress('stop/nuernberg-plaerrer@49.4481,11.0648'), { type: 'stop', name: 'nuernberg-plaerrer', lat: 49.4481, lon: 11.0648 });
  assert.deepEqual(parseAddress('stop/rio@-22.9,-43.21'), { type: 'stop', name: 'rio', lat: -22.9, lon: -43.21 });
  assert.deepEqual(parseAddress('line/verkehrsag-nuernberg/subway/u1'), { type: 'line', agency: 'verkehrsag-nuernberg', mode: 'subway', name: 'u1' });
  assert.deepEqual(parseAddress('line/db-regio-ag-bayern/suburban/s1@49.56,11.14'), { type: 'line', agency: 'db-regio-ag-bayern', mode: 'suburban', name: 's1', lat: 49.56, lon: 11.14 });
  // read back as written
  for (const path of [stopPath({ name: 'Fürth Hbf', town: 'Fürth' }), stopPath({ name: 'Kirche', town: 'Hausen' }, '48.30,11.70'), linePath({ agency: 'OVF', mode: 'bus', name: '113' })]) {
    const named = parseAddress(path);
    assert.equal(named.type === 'stop' ? `stop/${named.name}${named.lat === undefined ? '' : `@${named.lat.toFixed(2)},${named.lon.toFixed(2)}`}` : linePath(named), path);
  }
  const old = stopPathAt('Fürth Hbf', 49.4697, 10.9897);
  assert.equal(stopPathAt(parseAddress(old).name, parseAddress(old).lat, parseAddress(old).lon), old);
  for (const path of ['', 'stop/', 'stop/plaerrer@49.4,', 'stop/plaerrer@91.0,11.0', 'stop/Plaerrer@49.4,11.0', 'stop/a@49.4,11.0/more', 'line/vag/u1', 'line/vag/airship/u1', 'line/vag/subway/', 'line/vag/subway/u1@49.4', 'line/vag/subway/u1@91,11', 'trip/1', 'api/area']) {
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

test('the address of a stop is its name, with its town where the name does not say it, and its place where that is needed (#288)', () => {
  const stations = [
    { name: 'Ried', lat: 48.1, lon: 11.5 },
    { name: 'Kirche', lat: 48.2, lon: 11.6 },
    { name: 'Kirche', lat: 48.3, lon: 11.7 },
    // three of a name in one town: on each side of the street, and in a village of it
    { name: 'Rathaus', lat: 48.21, lon: 11.61 },
    { name: 'Rathaus', lat: 48.21005, lon: 11.61008 },
    { name: 'Rathaus', lat: 48.25, lon: 11.65 },
    { name: 'Hausen', lat: -33.9, lon: 18.4 },
    { name: 'Aachen Bushof', lat: 50.777, lon: 6.087 },
    { name: 'Zwickau', lat: 50.7, lon: 12.5 },
    { name: 'Nullpunkt', lat: -0.00001, lon: -0.00001 },
  ];
  const timetable = {
    stations,
    lines: [],
    towns: [{ name: 'Musterstadt' }, { name: 'Ried' }, { name: 'Hausen' }],
    stationTown: [1, 0, 2, 0, 0, 0, -1, -1, -1, -1],
    stationService: [5, 5, 5, 90, 80, 10, 5, 5, 5, 0],
  };
  const addresses = new Addresses(timetable);
  const paths = [
    'stop/ried', 'stop/kirche-musterstadt', 'stop/kirche-hausen',
    // the busiest has the name alone, the others have their places after it
    'stop/rathaus-musterstadt', 'stop/rathaus-musterstadt@48.21,11.61', 'stop/rathaus-musterstadt@48.25,11.65',
    'stop/hausen', 'stop/aachen-bushof', 'stop/zwickau', 'stop/nullpunkt',
  ];
  assert.deepEqual(stations.map((_, i) => addresses.stationPath(i)), paths);
  // each names its own, though the place of the busiest is the very one in the second's
  assert.deepEqual(paths.map((path) => addresses.station(parseAddress(path), path)), paths.map((_, i) => i));
  // all in the sitemap, but for the stop no trip calls at
  assert.deepEqual(addresses.paths(), paths.slice(0, -1));

  // A new timetable that moves stops by some metres gives them the addresses they had; and with another stop
  // of that name, less busy, the busiest keeps its address too.
  const moved = stations.map((station) => ({ ...station, lat: station.lat + 0.00007, lon: station.lon + 0.00007 }));
  const later = new Addresses({ ...timetable, stations: [...moved, { name: 'Rathaus', lat: 48.23, lon: 11.63 }], stationTown: [...timetable.stationTown, 0], stationService: [...timetable.stationService, 3] });
  assert.deepEqual(moved.map((_, i) => later.stationPath(i)), paths);

  // An address without its place, or with another: of the stops whose addresses have its name, the one whose
  // address is the name alone, or the nearest up to 1 km away.
  assert.equal(addresses.station(parseAddress('stop/rathaus-musterstadt@48.25,11.64')), 5);
  assert.equal(addresses.station(parseAddress('stop/ried@48.15,11.55')), -1);
  // An address as they were written before (#288), by the name and the place to four decimals: the stop of the name
  // whose address that was, else the nearest up to 1 km away; without a place the busiest of the name.
  assert.equal(addresses.station(parseAddress('stop/kirche@48.2000,11.6000'), 'stop/kirche@48.2000,11.6000'), 1);
  assert.equal(addresses.station(parseAddress('stop/rathaus@48.2501,11.6499')), 5);
  assert.equal(addresses.station(parseAddress('stop/kirche@48.15,11.55')), -1);
  assert.equal(addresses.station(parseAddress('stop/kirche')), 1);
  // of two of a name either side of where the places of such addresses round apart, each names its own, though
  // the other is the nearer to the place in it
  const pair = new Addresses({ stations: [{ name: 'Lehmkaul', lat: 48.300049, lon: 11.500049 }, { name: 'Lehmkaul', lat: 48.300051, lon: 11.5 }], lines: [] });
  assert.deepEqual([0, 1].map((i) => pair.stationPath(i)), ['stop/lehmkaul', 'stop/lehmkaul@48.30,11.50']);
  assert.deepEqual(['stop/lehmkaul@48.3000,11.5000', 'stop/lehmkaul@48.3001,11.5000'].map((path) => pair.station(parseAddress(path), path)), [0, 1]);
  // the first and the last name, in the order of addresses
  assert.equal(addresses.station(parseAddress('stop/aachen-bushof@50.78,6.09')), 7);
  assert.equal(addresses.station(parseAddress('stop/zwickau@50.7,12.5')), 8);
  // another name, up to 10 m from the place: south of the equator, and across it and the meridian of Greenwich
  assert.equal(addresses.station(parseAddress('stop/kapstadt@-33.90005,18.40005')), 6);
  assert.equal(addresses.station(parseAddress('stop/kapstadt@-33.9002,18.4')), -1);
  assert.equal(addresses.station(parseAddress('stop/irgendwo@0.00002,0.00002')), 9);
  assert.equal(addresses.station(parseAddress('stop/irgendwo')), -1);
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
