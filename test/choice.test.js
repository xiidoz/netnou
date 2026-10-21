// The lines and directions of a stop a visitor chooses (public/choice.js, #164):
// their keys, the value of `lines` in an address, and what a tap does.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bearing, choiceKey, choiceValue, inChoice, readChoice, toggled } from '../public/choice.js';

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

test('where a direction leaves its stop is the bearing to its next station, clockwise from north', () => {
  // Nürnberg Plärrer to Weißer Turm (north-east) and to Gostenhof (west-north-west)
  assert.equal(bearing(49.44809, 11.0648, 49.4495, 11.0731), 75);
  assert.equal(bearing(49.4481, 11.0648, 49.5481, 11.0648), 0);
  assert.equal(bearing(49.4481, 11.0648, 49.3481, 11.0648), 180);
  assert.equal(bearing(49.4481, 11.0648, 49.4481, 10.9), 270);
});
