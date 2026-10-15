import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linePath, parseAddress, slug, stopPath, wordsOf } from '../public/address.js';
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
});

test('what an address names, and what is not an address', () => {
  assert.deepEqual(parseAddress('stop/nuernberg-plaerrer@49.4481,11.0648'), { type: 'stop', name: 'nuernberg-plaerrer', lat: 49.4481, lon: 11.0648 });
  assert.deepEqual(parseAddress('stop/rio@-22.9,-43.21'), { type: 'stop', name: 'rio', lat: -22.9, lon: -43.21 });
  assert.deepEqual(parseAddress('line/verkehrsag-nuernberg/subway/u1'), { type: 'line', agency: 'verkehrsag-nuernberg', mode: 'subway', name: 'u1' });
  // read back as written
  for (const path of [stopPath('Fürth Hbf', 49.4697, 10.9897), linePath({ agency: 'OVF', mode: 'bus', name: '113' })]) {
    const named = parseAddress(path);
    assert.equal(named.type === 'stop' ? stopPath(named.name, named.lat, named.lon) : linePath(named), path);
  }
  for (const path of ['', 'stop/', 'stop/plaerrer', 'stop/plaerrer@49.4,', 'stop/plaerrer@91.0,11.0', 'stop/Plaerrer@49.4,11.0', 'stop/a@49.4,11.0/more', 'line/vag/u1', 'line/vag/airship/u1', 'line/vag/subway/', 'trip/1', 'api/area']) {
    assert.equal(parseAddress(path), null, path);
  }
  // its name, as the search takes it
  assert.equal(wordsOf('nuernberg-plaerrer'), 'nuernberg plaerrer');
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
  const lines = [{ name: 'U1', mode: 'subway', agency: 'VAG', stops: 3 }, { name: 'U1', mode: 'subway', agency: 'VAG', stops: 2 }, { name: '7', mode: 'bus', agency: 'VAG', stops: 0 }];
  const addresses = new Addresses({ stations, lines, stationService: [1, 1, 1, 1, 1, 1, 0] });
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
  // a line by its address, the first of two with the same; one without a stop in the area has none
  assert.equal(addresses.line({ agency: 'vag', mode: 'subway', name: 'u1' }), 0);
  assert.equal(addresses.line({ agency: 'vag', mode: 'bus', name: '7' }), -1);
  // all with their addresses, but for the stop no trip calls at
  assert.deepEqual(addresses.paths(), [
    'stop/ried@48.1000,11.5000', 'stop/ried@48.2000,11.6000', 'stop/ried@48.1050,11.5000', 'stop/hausen@-33.9000,18.4000',
    'stop/aachen-bushof@50.7770,6.0870', 'stop/zwickau@50.7000,12.5000', 'line/vag/subway/u1',
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
