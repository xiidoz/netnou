// What the details of a stop and of a line list (public/panel.js), as the page
// shows them and the server writes them into the page of an address (#254):
// run as it is, and read as the HTML the server sends.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { t as translate } from '../public/i18n.js';
import en from '../public/locales/en.js';
import { badge, choiceChip, delayClass, delayText, departureLists, directionSign, h, lineHead, panelHead, toHtml, vehicleLists } from '../public/panel.js';

const NOW = Date.parse('2026-10-23T10:00:00Z') / 1000;
// (times of day and dates in UTC, so that the test reads the same anywhere)
const drawing = (times = 'time', now = NOW) => ({
  t: (key, params) => translate(key, params, en),
  time: (epoch) => new Date(epoch * 1000).toISOString().slice(11, 16),
  day: (epoch) => new Date(epoch * 1000).toISOString().slice(0, 10),
  now,
  times,
});
const html = (nodes) => [nodes].flat().map(toHtml).join('');
const departure = (minutes, more = {}) => ({ trip: `T${minutes}_20261023`, line: 'U1', mode: 'subway', to: 'Langwasser Süd', planned: NOW + minutes * 60, delay: null, platform: '', cancelled: false, warnings: [], ...more });

test('a tree is written as HTML with what it says escaped, and without the attributes it leaves out', () => {
  const node = h('p', { class: 'a"b', title: '<x> & y', hidden: true, 'data-gone': null, 'data-off': false }, 'Tom & Jerry <3', h('span', {}, 4), null, false, ['a', ['b']]);
  assert.equal(toHtml(node), '<p class="a&#34;b" title="&#60;x&#62; &#38; y" hidden>Tom &#38; Jerry &#60;3<span>4</span>ab</p>');
  // the name of a line on the colour of its kind, any other kind as "other"
  assert.equal(toHtml(badge('U1', 'subway')), '<span class="badge" data-mode="subway">U1</span>');
  assert.equal(toHtml(badge('X', 'airship')), '<span class="badge" data-mode="other">X</span>');
});

test('a delay is shown in whole minutes, and its colour is that of what it shows', () => {
  assert.deepEqual([null, -90, -29, 0, 29, 89, 119, 150, 299, 330, 599, 630].map((delay) => [delayText(delay), delayClass(delay)]), [
    ['', 'none'], ['−1', 'early'], ['±0', 'ok'], ['±0', 'ok'], ['±0', 'ok'], ['+1', 'ok'], ['+2', 'minor'], ['+3', 'minor'], ['+5', 'major'], ['+6', 'major'], ['+10', 'severe'], ['+11', 'severe'],
  ]);
});

test('the departures of a stop: a row each that opens its trip, with its time, delay, line, destination and platform', () => {
  const board = { name: 'Plärrer', departures: [departure(4, { delay: 120, platform: '2' }), departure(70, { line: '4', mode: 'tram', to: 'Gibitzenhof' })] };
  assert.equal(html(departureLists(board, drawing('time'))), '<ul class="rows">'
    + '<li><button type="button" class="row departure times-time" data-trip="T4_20261023"><span class="time">10:04</span><span class="delay" data-delay="minor">+2</span><span class="badge" data-mode="subway">U1</span><span class="name" title="Langwasser Süd">Langwasser Süd</span><span class="platform">Plat. 2</span></button></li>'
    + '<li><button type="button" class="row departure times-time" data-trip="T70_20261023"><span class="time">11:10</span><span class="delay" data-delay="none"></span><span class="badge" data-mode="tram">4</span><span class="name" title="Gibitzenhof">Gibitzenhof</span><span class="platform"></span></button></li>'
    + '</ul>');
  // in minutes, which the page counts down by themselves: with its delay, and beyond the hour its time of day
  const minutes = html(departureLists(board, drawing('minutes')));
  assert.ok(minutes.includes(`<span class="minutes" data-leaves="${NOW + 6 * 60}" data-planned="${NOW + 4 * 60}" data-far="time">6 min</span>`));
  assert.ok(minutes.includes(`<span class="minutes" data-leaves="${NOW + 70 * 60}" data-planned="${NOW + 70 * 60}" data-far="time">11:10</span>`));
  // both: the time of day first, the minutes at the end, and nothing there beyond the hour
  const both = html(departureLists(board, drawing('both')));
  assert.ok(both.includes('<span class="platform">Plat. 2</span><span class="minutes" data-leaves'));
  assert.ok(both.includes(`data-far="none"></span></button>`));
  // none
  assert.equal(html(departureLists({ name: 'Plärrer', departures: [] }, drawing())), `<p class="panel-empty">${en['departures.none']}</p>`);
});

test('a departure that is cancelled says so, and one with something wrong with it has the sign of a warning that says what', () => {
  const warned = departure(5, { warnings: [{ title: null, text: 'Signal failure', severity: 'warning' }] });
  const board = { name: 'Plärrer', departures: [warned, departure(8, { cancelled: true, platform: '1' })] };
  const out = html(departureLists(board, drawing('time')));
  // every row of a list with a warning keeps the place of its sign
  assert.ok(out.startsWith('<ul class="rows signed">'));
  assert.ok(out.includes('<span class="late"><span class="delay" data-delay="none"></span><svg class="icon sign" viewBox="0 0 24 24" role="img" aria-label="Warning: Signal failure" data-said="Signal failure"><path d="'));
  assert.ok(out.includes(`<button type="button" class="row departure times-time cancelled" data-trip="T8_20261023"><span class="time">10:08</span><span class="late"><span class="delay"></span></span>`));
  assert.ok(out.includes(`<span class="platform">${en['departures.cancelled']}</span>`));
});

test('where the next day begins among the departures, a line says so between two lists', () => {
  // ten to midnight: one today, then two of tomorrow
  const late = Date.parse('2026-10-23T23:50:00Z') / 1000;
  const board = { name: 'Plärrer', departures: [5, 15, 25].map((minutes) => ({ ...departure(minutes), planned: late + minutes * 60 })) };
  const parts = departureLists(board, drawing('time', late));
  assert.deepEqual(parts.map((node) => node.tag), ['ul', 'h3', 'ul']);
  assert.equal(toHtml(parts[1]), `<h3 class="rows-head day-head">${en['departures.tomorrow']}</h3>`);
  assert.deepEqual(parts.map((node) => node.children.length), [1, 1, 2]);
});

test('the head of the details has the name as the main heading, and the chip of the lines to show', () => {
  const context = drawing();
  assert.equal(toHtml(panelHead('Plärrer', h('p', { class: 'sub' }, 'Departures'))), '<div class="panel-head"><h1>Plärrer</h1><p class="sub">Departures</p></div>');
  // every line
  assert.match(toHtml(choiceChip([], context)), /^<span class="choice"><button type="button" class="choice-open" aria-label="All lines" aria-haspopup="dialog" title="Which departures\?"><svg class="icon" [^>]*><path d="[^"]+"><\/path><\/svg><span>All lines<\/span><\/button><\/span>$/);
  // one direction: its sign and its name, and the cross that shows all again
  const one = toHtml(choiceChip([{ line: 'U1', mode: 'subway', heading: 61, name: 'Langwasser Süd' }], context));
  assert.match(one, /^<span class="choice chosen"><button [^>]*aria-label="Only U1 Langwasser Süd"/);
  assert.ok(one.includes('<svg class="direction-sign" viewBox="-17 -17 34 34" aria-hidden="true" data-mode="subway"><path d="M0,-16L5.65,-8.25L-5.65,-8.25Z" transform="rotate(61)"></path><circle r="10"></circle><text y="3.2" text-anchor="middle">U1</text></svg><span>Langwasser Süd</span></button><button type="button" class="choice-clear" aria-label="Show all lines"'));
  // five: four signs and how many more
  const five = toHtml(choiceChip(['1', '2', '3', '4', '5'].map((line) => ({ line, mode: 'bus', heading: null, name: 'X' })), context));
  assert.equal(five.match(/class="direction-sign"/g).length, 4);
  assert.ok(five.includes('<span>+1</span>'));
  // a long name of a line narrower, as on the map
  assert.ok(toHtml(directionSign({ line: 'N10A', mode: 'bus' })).includes('<text y="3.2" text-anchor="middle" textLength="17" lengthAdjust="spacingAndGlyphs">N10A</text>'));
});

test('the vehicles of a line under way, under where they go, each opening its trip', () => {
  const vehicle = (id, to, next, delay = null) => ({ id, to, next, delay, warnings: [] });
  const line = { name: 'U1', mode: 'subway', agency: 'VAG', vehicles: [vehicle('a', 'Fürth Hardhöhe', 'Gostenhof', 60), vehicle('b', 'Fürth Hardhöhe', 'Plärrer'), vehicle('c', 'Langwasser Süd', 'Aufseßplatz', 360)] };
  assert.equal(toHtml(lineHead(line, drawing())), `<div class="panel-head"><h1><span class="badge" data-mode="subway">U1</span><span>${en['mode.subway']}</span></h1><p class="sub">VAG · 3 vehicles under way</p></div>`);
  assert.equal(html(vehicleLists(line, drawing())), '<h3 class="rows-head">to Fürth Hardhöhe</h3><ul class="rows">'
    + '<li><button type="button" class="row vehicle" data-trip="a"><span class="name" title="Gostenhof">next: Gostenhof</span><span class="delay" data-delay="ok">+1</span></button></li>'
    + '<li><button type="button" class="row vehicle" data-trip="b"><span class="name" title="Plärrer">next: Plärrer</span><span class="delay" data-delay="none"></span></button></li>'
    + '</ul><h3 class="rows-head">to Langwasser Süd</h3><ul class="rows">'
    + '<li><button type="button" class="row vehicle" data-trip="c"><span class="name" title="Aufseßplatz">next: Aufseßplatz</span><span class="delay" data-delay="major">+6</span></button></li></ul>');
  // none under way
  const none = { ...line, vehicles: [] };
  assert.equal(toHtml(lineHead(none, drawing())), `<div class="panel-head"><h1><span class="badge" data-mode="subway">U1</span><span>${en['mode.subway']}</span></h1><p class="sub">VAG</p></div>`);
  assert.equal(html(vehicleLists(none, drawing())), `<p class="panel-empty">${en['line.none']}</p>`);
});
