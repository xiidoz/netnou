// The search for stops and lines (public/search.js) needs no browser and is
// run as it is. The stops and lines are real ones of the default area, with
// their positions and with how much service they have in a timetable of
// October 2026.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIndex, fold, search, searchLines, wordsOf } from '../public/search.js';

// [name, lat, lon, service, modes]
const STOPS = [
  ['Nürnberg Hbf', 49.44561, 11.08299, 13695, ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance']],
  ['Nürnberg Plärrer', 49.44809, 11.0648, 9098, ['subway', 'tram', 'bus']],
  ['Fürth (Bay) Hbf', 49.46971, 10.98999, 6844, ['subway', 'bus', 'suburban', 'regional']],
  ['Fürth Rathaus', 49.47765, 10.98859, 4714, ['subway', 'bus']],
  ['Erlangen', 49.59583, 11.00164, 3863, ['bus', 'suburban', 'regional', 'longdistance']],
  ['Erlangen Neuer Markt / Rathaus', 49.59113, 11.00676, 2469, ['bus']],
  ['Nürnberg Rathaus', 49.45581, 11.07919, 2078, ['bus']],
  ['Bamberg, Bahnhof/Ludwigstr.', 49.90098, 10.89778, 1303, ['bus']],
  ['Nürnberg, Eibach Bf/Hafenstr.', 49.40829, 11.04757, 871, ['bus']],
  ['Nürnberg Hauptmarkt', 49.45438, 11.07633, 822, ['bus']],
  ['Erlangen Hauptfeuerwache', 49.59206, 10.99917, 566, ['bus']],
  ['Fürth G.-Hauptmann-Str.', 49.45621, 10.99913, 349, ['bus']],
  ['Erlangen Berliner Pl.', 49.58621, 11.01755, 310, ['bus']],
  ['Weißenstadt, Poststraße', 50.1037, 11.88871, 125, ['bus']],
  ['Hersbruck Plärrer', 49.50526, 11.43553, 90, ['bus']],
  ['Buchdorf, Alte B2', 48.78667, 10.81775, 44, ['bus']],
];
// [name, mode, agency, to, lat, lon, service]
const LINES = [
  ['U1', 'subway', 'VerkehrsAG Nürnberg', ['Fürth Hardhöhe', 'Langwasser Süd'], 49.44428, 11.05986, 1911],
  ['U2', 'subway', 'VerkehrsAG Nürnberg', ['Röthenbach', 'Flughafen'], 49.45368, 11.07609, 1419],
  ['S1', 'suburban', 'DB Regio AG Bayern', ['Hartmannshof', 'Forchheim(Oberfr)'], 49.53086, 11.13879, 227],
  ['S1', 'bus', 'DB Regio AG Bayern', ['Bahnhof (links Pegnitz), Hersbruck', 'Hartmannshof Bahnhof, Pommelsbrunn'], 49.55944, 11.23733, 8],
  ['33', 'bus', 'Stadtverkehr Fürth', ['Fürth Hauptbahnhof', 'Flughafen N U E'], 49.48582, 11.03156, 296],
  ['330', 'bus', 'Ostalbmobil (Aalen+Gmünd+Ellwangen)', ['Ellwangen, ZOB'], 49.02671, 10.30825, 19],
  ['330', 'bus', 'Omnibusverkehr Franken', ['Bad Berneck', 'Bayreuth'], 49.98716, 11.63368, 24],
  ['331', 'bus', 'Kraus Reisen Gmbh', ['Röthenbach (Pegn) Bf 331', 'Altdorf Nahversorgungszentrum 331'], 49.44703, 11.31231, 91],
  ['490', 'bus', 'Verkehrsverbund Großraum Nürnberg', ['Amberg Bahnhof', 'Hirschau Marktplatz'], 49.49537, 11.87376, 116],
  ['490', 'bus', 'Gesellschaft zur Förderung des ÖPNV Landkreis', ['Charlottenthal', 'Schönsee, Rathaus'], 49.53301, 12.55953, 10],
  ['490', 'bus', 'Landkreis Neuburg-Schrobenhausen', ['Schrobenhausen Ehekirchen-Walda'], 48.62771, 11.04725, 1],
  ['5', 'tram', 'VerkehrsAG Nürnberg', ['Tiergarten', 'Christuskirche'], 49.44298, 11.10032, 1149],
  ['5', 'bus', 'DB RegioBus Bayern', ['Donauwörth Bahnhof', 'Bissingen Seniorenheim'], 48.70276, 10.72135, 37],
  ['ICE 12', 'longdistance', 'DB Fernverkehr AG', ['Berlin Hbf'], 49.90076, 10.89949, 1],
  ['RB16', 'regional', 'DB Regio AG Bayern', ['München Hbf', 'Nürnberg Hbf'], 49.10328, 10.99763, 153],
  ['RB16', 'bus', 'DB Regio AG Bayern', ['Bahnhof, Treuchtlingen', 'Bahnhof, Roth (Mittelfranken)'], 49.13429, 11.00186, 4],
];
const column = (rows, n) => rows.map((row) => row[n]);
const DATA = {
  stations: { id: STOPS.map((_, i) => `s${i}`), name: column(STOPS, 0), lat: column(STOPS, 1), lon: column(STOPS, 2), service: column(STOPS, 3), modes: column(STOPS, 4) },
  lines: { name: column(LINES, 0), mode: column(LINES, 1), agency: column(LINES, 2), to: column(LINES, 3), lat: column(LINES, 4), lon: column(LINES, 5), service: column(LINES, 6) },
};
// what the German page calls the modes
const index = buildIndex(DATA, { subway: 'U-Bahn', tram: 'Tram', bus: 'Bus', suburban: 'S-Bahn', regional: 'Regionalzug', longdistance: 'Fernverkehr' });
const names = (query, options) => search(index, query, options).map((stop) => stop.name);
// a line as "name mode"
const lines = (query, options) => searchLines(index, query, options).map((line) => `${line.name} ${line.mode}`);

test('what is typed is compared without case, accents and punctuation', () => {
  assert.equal(fold('Plärrer'), 'plarrer');
  assert.equal(fold('Weißenburg'), 'weissenburg');
  assert.deepEqual(wordsOf(' Nürnberg,  PLÄRRER (nürnberg) '), ['nurnberg', 'plarrer']);
  assert.deepEqual(wordsOf(' ,-/ '), []);
});

test('a stop is found by the beginnings of its words, in any order', () => {
  assert.deepEqual(names('plä nü'), ['Nürnberg Plärrer']);
  assert.deepEqual(names('nürnberg plärrer'), ['Nürnberg Plärrer']);
  assert.deepEqual(names('alte b2 buchdorf'), ['Buchdorf, Alte B2']);
  assert.deepEqual(names('fürth bay'), ['Fürth (Bay) Hbf']);
  // every word has to be found
  assert.deepEqual(names('plärrer fürth'), []);
  assert.deepEqual(names(''), []);
  assert.deepEqual(names(' , '), []);
});

test('a result is what the page needs to show the stop', () => {
  assert.deepEqual(search(index, 'hersbruck'), [{ id: 's14', name: 'Hersbruck Plärrer', lat: 49.50526, lon: 11.43553, modes: ['bus'] }]);
});

test('umlauts may be typed as they are, without their dots or as two letters', () => {
  for (const query of ['nürnberg rathaus', 'nurnberg rathaus', 'nuernberg rathaus', 'NÜRNBERG RATHAUS']) assert.deepEqual(names(query), ['Nürnberg Rathaus'], query);
  for (const query of ['weißenstadt', 'weissenstadt', 'Weissenst']) assert.deepEqual(names(query), ['Weißenstadt, Poststraße'], query);
});

test('abbreviations answer to what they stand for, and the other way round', () => {
  assert.deepEqual(names('hauptbahnhof'), ['Nürnberg Hbf', 'Fürth (Bay) Hbf']);
  assert.deepEqual(names('hbf fürth'), ['Fürth (Bay) Hbf']);
  assert.deepEqual(names('eibach bahnhof'), ['Nürnberg, Eibach Bf/Hafenstr.']);
  assert.deepEqual(names('ludwigstraße'), ['Bamberg, Bahnhof/Ludwigstr.']);
  assert.deepEqual(names('ludwigstr.'), ['Bamberg, Bahnhof/Ludwigstr.']);
  assert.deepEqual(names('hauptmann strasse'), ['Fürth G.-Hauptmann-Str.']);
  assert.deepEqual(names('poststr.'), ['Weißenstadt, Poststraße']);
  assert.deepEqual(names('berliner platz'), ['Erlangen Berliner Pl.']);
});

test('a stop that trains call at is a Bahnhof, whatever its name says', () => {
  assert.equal(names('erlangen bahnhof')[0], 'Erlangen');
  // the stations by their service, then the stops that are named after one
  assert.deepEqual(names('bahnhof'), ['Nürnberg Hbf', 'Fürth (Bay) Hbf', 'Erlangen', 'Bamberg, Bahnhof/Ludwigstr.', 'Nürnberg, Eibach Bf/Hafenstr.']);
});

test('words found at a beginning come before those found inside a word', () => {
  assert.deepEqual(names('markt'), ['Erlangen Neuer Markt / Rathaus', 'Nürnberg Hauptmarkt']);
  assert.deepEqual(names('feuer'), ['Erlangen Hauptfeuerwache']);
});

test('close spellings are found where nothing else is', () => {
  // ("feuer" is nearly the beginning of "Fürth", typed with two letters for the umlaut)
  assert.deepEqual(names('feuer'), ['Erlangen Hauptfeuerwache']);
  assert.deepEqual(names('plärer'), ['Nürnberg Plärrer', 'Hersbruck Plärrer']);
  assert.deepEqual(names('erlagen'), ['Erlangen', 'Erlangen Neuer Markt / Rathaus', 'Erlangen Hauptfeuerwache', 'Erlangen Berliner Pl.']);
  assert.deepEqual(names('nürnberg hauptmakt'), ['Nürnberg Hauptmarkt']);
  // two letters that changed places are one slip
  assert.deepEqual(names('rahtaus fürth'), ['Fürth Rathaus']);
  // two slips in a long word
  assert.deepEqual(names('hauptfeierwche'), ['Erlangen Hauptfeuerwache']);
  // too short to guess at, and the first letter has to be right
  assert.deepEqual(names('bax'), []);
  assert.deepEqual(names('blärrer'), []);
});

test('without a position the stop with more service comes first', () => {
  assert.deepEqual(names('rathaus'), ['Fürth Rathaus', 'Erlangen Neuer Markt / Rathaus', 'Nürnberg Rathaus']);
  assert.deepEqual(names('plärrer'), ['Nürnberg Plärrer', 'Hersbruck Plärrer']);
  assert.deepEqual(names('haupt'), ['Nürnberg Hbf', 'Fürth (Bay) Hbf', 'Nürnberg Hauptmarkt', 'Erlangen Hauptfeuerwache', 'Fürth G.-Hauptmann-Str.']);
  assert.deepEqual(names('nürnberg', { limit: 3 }), ['Nürnberg Hbf', 'Nürnberg Plärrer', 'Nürnberg Rathaus']);
});

test('with a position, service counts for less the further away a stop is', () => {
  const fuerth = { lat: 49.4771, lon: 10.9887 };
  const atHauptmarkt = { lat: 49.4539, lon: 11.0773 }; // 100 m from it
  const lorenzkirche = { lat: 49.4510, lon: 11.0780 }; // 400 m from the Hauptmarkt, 700 m from the Hbf
  const hersbruck = { lat: 49.5080, lon: 11.4320 };
  const erlangen = { lat: 49.5958, lon: 11.0019 };

  // the main station of the town one is in, then the larger one further off
  assert.deepEqual(names('haupt', { near: fuerth }).slice(0, 2), ['Fürth (Bay) Hbf', 'Nürnberg Hbf']);
  assert.ok(names('haupt', { near: fuerth }).indexOf('Nürnberg Hbf') < names('haupt', { near: fuerth }).indexOf('Nürnberg Hauptmarkt'));
  // a small stop comes first for whoever stands next to it …
  assert.deepEqual(names('haupt', { near: atHauptmarkt }).slice(0, 3), ['Nürnberg Hauptmarkt', 'Nürnberg Hbf', 'Fürth (Bay) Hbf']);
  // … and not from a few hundred metres away
  assert.deepEqual(names('haupt', { near: lorenzkirche }).slice(0, 3), ['Nürnberg Hbf', 'Nürnberg Hauptmarkt', 'Fürth (Bay) Hbf']);
  assert.deepEqual(names('plärrer', { near: hersbruck }), ['Hersbruck Plärrer', 'Nürnberg Plärrer']);
  assert.equal(names('rathaus', { near: fuerth })[0], 'Fürth Rathaus');
  assert.equal(names('rathaus', { near: atHauptmarkt })[0], 'Nürnberg Rathaus');
  assert.equal(names('rathaus', { near: erlangen })[0], 'Erlangen Neuer Markt / Rathaus');
  // how close a match is still comes first
  assert.deepEqual(names('markt', { near: atHauptmarkt }), ['Erlangen Neuer Markt / Rathaus', 'Nürnberg Hauptmarkt']);
});

test('a line is found by the beginning of its name, spaces left out', () => {
  assert.deepEqual(lines('u1'), ['U1 subway']);
  assert.deepEqual(lines('U 1'), ['U1 subway']);
  assert.deepEqual(lines('ice12'), ['ICE 12 longdistance']);
  assert.deepEqual(lines('ice 1'), ['ICE 12 longdistance']);
  assert.deepEqual(lines('u'), ['U1 subway', 'U2 subway']);
  // the train before the bus that replaces it at times
  assert.deepEqual(lines('s 1'), ['S1 suburban', 'S1 bus']);
  assert.deepEqual(lines('rb16'), ['RB16 regional', 'RB16 bus']);
  // a number is not looked for inside a name, and a line not by what a stop is called
  assert.deepEqual(lines('1'), []);
  assert.deepEqual(lines('plärrer'), []);
  assert.deepEqual(lines('bahn'), []);
  assert.deepEqual(lines(''), []);
  assert.deepEqual(lines(' - '), []);
});

test('a line of exactly the name typed comes before those that only begin with it', () => {
  // 33 first, then by their trips
  assert.deepEqual(searchLines(index, '33', { limit: 5 }).map((line) => `${line.name} ${line.agency}`), [
    '33 Stadtverkehr Fürth', '331 Kraus Reisen Gmbh', '330 Omnibusverkehr Franken', '330 Ostalbmobil (Aalen+Gmünd+Ellwangen)',
  ]);
  // three at most unless more are asked for
  assert.deepEqual(lines('3'), ['33 bus', '331 bus', '330 bus']);
  assert.deepEqual(lines('5'), ['5 tram', '5 bus']);
  // "33" is not the U1
  assert.ok(!lines('33', { limit: 99 }).includes('U1 subway'));
});

test('a line is what the page needs to show it and to ask for its vehicles', () => {
  assert.deepEqual(searchLines(index, 'u1'), [{ name: 'U1', mode: 'subway', agency: 'VerkehrsAG Nürnberg', to: ['Fürth Hardhöhe', 'Langwasser Süd'] }]);
});

test('the name of a mode in front narrows the lines down', () => {
  assert.deepEqual(lines('bus 33'), ['33 bus', '331 bus', '330 bus']);
  assert.deepEqual(lines('bus 331'), ['331 bus']);
  assert.deepEqual(lines('Bus 5'), ['5 bus']);
  assert.deepEqual(lines('tram 5'), ['5 tram']);
  assert.deepEqual(lines('bus s1'), ['S1 bus']);
  // the line called that before the one that has it for its number: the bus 16, if there were one, before the buses of the RB16
  assert.deepEqual(lines('bus 16'), ['RB16 bus']);
  assert.deepEqual(lines('bus 3'), ['33 bus', '331 bus', '330 bus']);
  // after the mode, the letter of the line may be left out
  assert.deepEqual(lines('u-bahn 1'), ['U1 subway']);
  assert.deepEqual(lines('U Bahn 2'), ['U2 subway']);
  assert.deepEqual(lines('s-bahn 1'), ['S1 suburban']);
  assert.deepEqual(lines('regionalzug 16'), ['RB16 regional']);
  // a mode alone is no line, and neither is a line the mode does not have
  assert.deepEqual(lines('bus'), []);
  assert.deepEqual(lines('tram 33'), []);
  // where no mode has a name, nothing in front is taken for one
  assert.deepEqual(searchLines(buildIndex(DATA), 'bus 33'), []);
  assert.deepEqual(searchLines(buildIndex(DATA), '33').map((line) => line.name), ['33', '331', '330']);
});

test('lines of one name are told apart, and the nearer one comes first', () => {
  const agencies = (options) => searchLines(index, '490', options).map((line) => line.agency);
  assert.deepEqual(agencies(), ['Verkehrsverbund Großraum Nürnberg', 'Gesellschaft zur Förderung des ÖPNV Landkreis', 'Landkreis Neuburg-Schrobenhausen']);
  // in Schönsee near the Czech border, and in Ehekirchen, where one bus a day is called that
  assert.equal(agencies({ near: { lat: 49.51, lon: 12.55 } })[0], 'Gesellschaft zur Förderung des ÖPNV Landkreis');
  assert.equal(agencies({ near: { lat: 48.63, lon: 11.05 } })[0], 'Landkreis Neuburg-Schrobenhausen');
  // in Donauwörth the bus 5 of that town, in Nürnberg the tram
  assert.deepEqual(lines('5', { near: { lat: 48.72, lon: 10.78 } }), ['5 bus', '5 tram']);
  assert.deepEqual(lines('5', { near: { lat: 49.4539, lon: 11.0773 } }), ['5 tram', '5 bus']);
  // the exact name still comes first: next to where the 331 runs, "33" is the 33
  assert.deepEqual(searchLines(index, '33', { near: { lat: 49.447, lon: 11.312 } }).map((line) => line.name), ['33', '331', '330']);
});
