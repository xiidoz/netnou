// The search for stops (public/search.js) needs no browser and is run as it
// is. The stops are real ones of the default area, with their positions and
// with how much service they have in a timetable of October 2026.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIndex, fold, search, wordsOf } from '../public/search.js';

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
const index = buildIndex({
  id: STOPS.map((_, i) => `s${i}`),
  name: STOPS.map((stop) => stop[0]),
  lat: STOPS.map((stop) => stop[1]),
  lon: STOPS.map((stop) => stop[2]),
  service: STOPS.map((stop) => stop[3]),
  modes: STOPS.map((stop) => stop[4]),
});
const names = (query, options) => search(index, query, options).map((stop) => stop.name);

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
