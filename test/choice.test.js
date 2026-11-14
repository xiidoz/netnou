// The lines and directions of a stop a visitor chooses (public/choice.js, #164):
// their keys, the value of `lines` in an address, and what a tap does.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearing, choiceKey, choiceValue, chosenWays, inChoice, readChoice, toggled } from '../public/choice.js';

const U1_EAST = { mode: 'subway', line: 'U1', next: 'Nürnberg Weißer Turm' };

test('a direction is its kind, its line and its next station, by names as an address writes them', () => {
  assert.equal(choiceKey(U1_EAST), 'subway/u1~nuernberg-weisser-turm');
  assert.equal(choiceKey({ mode: 'longdistance', line: 'ICE 41', next: 'München Hbf' }), 'longdistance/ice-41~muenchen-hbf');
  // (a whole line)
  assert.equal(choiceKey({ mode: 'tram', line: '4' }), 'tram/4');
  assert.equal(choiceKey({ mode: 'tram', line: '4', next: null }), 'tram/4');
});

test('what an address names is taken as far as it is of that shape, each key once', () => {
  assert.deepEqual(readChoice('subway/u1~nuernberg-weisser-turm,tram/4'), ['subway/u1~nuernberg-weisser-turm', 'tram/4']);
  assert.deepEqual(readChoice(' Subway/U1 , tram/4,tram/4,,boat/1,tram,/4,tram/4~,tram/ä'), ['subway/u1', 'tram/4']);
  for (const value of [null, undefined, '', ',', 3]) assert.deepEqual(readChoice(value), []);
  // (no more than any stop has)
  assert.equal(readChoice(Array.from({ length: 100 }, (_, i) => `bus/${i}`).join(',')).length, 64);
  assert.equal(choiceValue(['subway/u1~nuernberg-weisser-turm', 'tram/4']), 'subway/u1~nuernberg-weisser-turm,tram/4');
  assert.deepEqual(readChoice(choiceValue(['subway/u1~nuernberg-weisser-turm', 'tram/4'])), ['subway/u1~nuernberg-weisser-turm', 'tram/4']);
});

test('a departure is shown where nothing is chosen, or its direction or its whole line is', () => {
  assert.ok(inChoice([], U1_EAST));
  assert.ok(inChoice(['subway/u1~nuernberg-weisser-turm'], U1_EAST));
  assert.ok(inChoice(['subway/u1'], U1_EAST));
  assert.ok(!inChoice(['subway/u1~nuernberg-gostenhof'], U1_EAST));
  assert.ok(!inChoice(['bus/u1'], U1_EAST));
  // (one that goes nowhere on from here: by its whole line alone)
  assert.ok(inChoice(['subway/u1'], { ...U1_EAST, next: null }));
  assert.ok(!inChoice(['subway/u1~nuernberg-weisser-turm'], { ...U1_EAST, next: null }));
});

test('the first tap with every line shown chooses that one alone, the next ones add and take out, and none left is every line', () => {
  const east = 'subway/u1~nuernberg-weisser-turm';
  const tram = 'tram/4~nuernberg-kohlenhof';
  let keys = toggled([], east);
  assert.deepEqual(keys, [east]);
  keys = toggled(keys, tram);
  assert.deepEqual(keys, [east, tram]);
  keys = toggled(keys, east);
  assert.deepEqual(keys, [tram]);
  assert.deepEqual(toggled(keys, tram), []);
});

// The directions of Nürnberg Plärrer's U1 and of a tram 4 there, as api/departures lists them
const EAST = { mode: 'subway', line: 'U1', next: 'Nürnberg Weißer Turm', to: 'Langwasser Süd', key: 'subway/u1~nuernberg-weisser-turm' };
const WEST = { mode: 'subway', line: 'U1', next: 'Nürnberg Gostenhof', to: 'Fürth Hardhöhe', key: 'subway/u1~nuernberg-gostenhof' };
const TRAM = { mode: 'tram', line: '4', next: 'Nürnberg Kohlenhof', to: 'Gibitzenhof', key: 'tram/4~nuernberg-kohlenhof' };
const LIST = [EAST, WEST, TRAM];
const ALL = LIST.map(({ key }) => key);

test('a line chosen whole stands for each of its directions at the stop, as the chip names them and the sheet ticks them (#342)', () => {
  assert.deepEqual(chosenWays([], LIST), []);
  assert.deepEqual(chosenWays([WEST.key], LIST), [WEST]);
  assert.deepEqual(chosenWays(['subway/u1'], LIST), [EAST, WEST]);
  // (in the order chosen, each once, as after a tap on a whole line before #342)
  assert.deepEqual(chosenWays([TRAM.key, 'subway/u1', WEST.key], LIST), [TRAM, EAST, WEST]);
  // (one direction of its line here: that one; none here, or a key the stop does not have: nothing)
  assert.deepEqual(chosenWays(['tram/4'], LIST), [TRAM]);
  assert.deepEqual(chosenWays(['bus/36', 'subway/u2~nuernberg-hbf'], LIST), []);
  // (not a line that only begins as another does)
  assert.deepEqual(chosenWays(['subway/u'], LIST), []);
});

test('a tap on a direction of a line chosen whole takes it out and leaves the others of the line, by their own keys (#342)', () => {
  assert.deepEqual(toggled(['subway/u1'], WEST.key, ALL), [EAST.key]);
  assert.deepEqual(toggled(['subway/u1'], EAST.key, ALL), [WEST.key]);
  // (in the line's place, among the others chosen)
  assert.deepEqual(toggled([TRAM.key, 'subway/u1'], WEST.key, ALL), [TRAM.key, EAST.key]);
  // (the line's only direction here: nothing left, every line)
  assert.deepEqual(toggled(['tram/4'], TRAM.key, ALL), []);
  assert.deepEqual(toggled(['subway/u1', 'tram/4'], TRAM.key, ALL), ['subway/u1']);
  // (a line and one of its directions both chosen, as a tap made it before #342: that one out, and the line as the others)
  assert.deepEqual(toggled(['subway/u1', WEST.key], WEST.key, ALL), [EAST.key]);
  assert.deepEqual(toggled(['subway/u1', EAST.key], WEST.key, ALL), [EAST.key]);
  // (a direction of another line is added as before, the line kept whole)
  assert.deepEqual(toggled(['subway/u1'], TRAM.key, ALL), ['subway/u1', TRAM.key]);
  // (and the choice in and out again ends where it began, with every line)
  assert.deepEqual(toggled(toggled(['subway/u1'], WEST.key, ALL), EAST.key, ALL), []);
});

test('where a direction leaves its stop is the bearing to its next station, clockwise from north', () => {
  // Nürnberg Plärrer to Weißer Turm (north-east) and to Gostenhof (west-north-west)
  assert.equal(bearing(49.44809, 11.0648, 49.4495, 11.0731), 75);
  assert.equal(bearing(49.4481, 11.0648, 49.5481, 11.0648), 0);
  assert.equal(bearing(49.4481, 11.0648, 49.3481, 11.0648), 180);
  assert.equal(bearing(49.4481, 11.0648, 49.4481, 10.9), 270);
});
