// What the details of a stop and of a line list (public/panel.js), as the page
// shows them and the server writes them into the page of an address (#254):
// run as it is, and read as the HTML the server sends.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { t as translate } from '../public/i18n.js';
import en from '../public/locales/en.js';
import { badge, choiceChip, delayClass, delayFlag, delayText, departureLists, departuresSub, directionSign, h, lineHead, lineLists, lineStops, panelHead, stopHeading, toHtml, trackAt, vehicleLabel } from '../public/panel.js';

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

test('a stop whose name does not say its town has the town below its name, in the main heading (#254)', () => {
  assert.equal(toHtml(panelHead(stopHeading('Bruck/ER Rotes Kreuz', 'Erlangen'))), '<div class="panel-head"><h1><span class="stop">Bruck/ER Rotes Kreuz</span><span class="town">Erlangen</span></h1></div>');
  // a name that says its town, and one whose town is not known: the name alone
  assert.equal(toHtml(panelHead(stopHeading('Erlangen Neuer Markt / Rathaus', 'Erlangen'))), '<div class="panel-head"><h1>Erlangen Neuer Markt / Rathaus</h1></div>');
  assert.equal(toHtml(panelHead(stopHeading('Basel SBB', null))), '<div class="panel-head"><h1>Basel SBB</h1></div>');
});

test('the head of the details has the name as the main heading, the switch between the departures and the lines, and the chip of the lines to show', () => {
  const context = drawing();
  assert.equal(toHtml(panelHead('Plärrer', h('p', { class: 'sub' }, 'Departures'))), '<div class="panel-head"><h1>Plärrer</h1><p class="sub">Departures</p></div>');
  // every line: "Filter", as "All lines" is the list beside it (#255)
  const all = choiceChip([], context);
  assert.match(toHtml(all), /^<span class="choice"><button type="button" class="choice-open" aria-label="Filter" aria-haspopup="dialog" title="Which departures\?"><svg class="icon" [^>]*><path d="[^"]+"><\/path><\/svg><span>Filter<\/span><\/button><\/span>$/);
  // the switch, with the chip beside the departures and none beside all lines
  const views = (view) => `<span class="view-switch" role="group" aria-label="View"><button type="button" aria-pressed="${view === 'departures'}" data-view="departures">Next departures</button><button type="button" aria-pressed="${view === 'lines'}" data-view="lines">All lines</button></span>`;
  assert.equal(toHtml(departuresSub('departures', all, context)), `<p class="sub with-choice">${views('departures')}${toHtml(all)}</p>`);
  assert.equal(toHtml(departuresSub('lines', all, context)), `<p class="sub with-choice">${views('lines')}</p>`);
  // a board has no switch, and a screen on a wall not even the chip
  assert.equal(toHtml(departuresSub(null, all, context)), `<p class="sub with-choice"><span>Departures</span>${toHtml(all)}</p>`);
  assert.equal(toHtml(departuresSub(null, null, context)), '<p class="sub">Departures</p>');
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

test('all lines of a stop: the badge of each leading to it, beside its ways with their next departures, under their kinds (#255)', () => {
  const u1 = { name: 'U1', mode: 'subway', agency: 'VAG', at: [49.45, 11.07], path: 'line/vag/subway/u1', ways: [
    { to: 'Langwasser Süd', departure: departure(4, { delay: 120, to: 'Messe' }) },
    { to: 'Fürth Hardhöhe', departure: null },
  ] };
  const tram = { name: '4', mode: 'tram', agency: 'VAG', at: [49.44, 11.06], path: 'line/vag/tram/4', ways: [{ to: 'Gibitzenhof', departure: departure(20 * 60, { line: 'x', mode: 'bus', to: 'Gibitzenhof', platform: '3' }) }] };
  const out = html(lineLists({ lines: [u1, tram] }, drawing('both')));
  // the badge is a link to the line's page, which the page opens itself by what data-line says
  assert.ok(out.startsWith(`<h3 class="rows-head">${en['mode.subway']}</h3><ul class="line-rows"><li><a class="to-line" href="line/vag/subway/u1" aria-label="To line U1" title="To line U1" data-line="{&#34;name&#34;:&#34;U1&#34;,&#34;mode&#34;:&#34;subway&#34;,&#34;agency&#34;:&#34;VAG&#34;,&#34;at&#34;:[49.45,11.07]}"><span class="badge" data-mode="subway">U1<svg class="icon"`));
  // a way: its next departure as a row without the badge, which opens its trip, going where that trip goes
  assert.ok(out.includes(`<ul><li><button type="button" class="row departure times-both by-line" data-trip="T4_20261023"><span class="time">10:04</span><span class="delay" data-delay="minor">+2</span><span class="name" title="Messe">Messe</span><span class="platform"></span><span class="minutes" data-leaves="${NOW + 6 * 60}"`));
  // one with no departure in the next 24 hours: in short where the time stands, in full under a mouse; it opens nothing
  assert.ok(out.includes(`<li><div class="row departure times-both by-line resting"><abbr class="later" title="${en['lines.laterLong']}">${en['lines.later']}</abbr><span class="name" title="Fürth Hardhöhe">Fürth Hardhöhe</span></div></li></ul></li></ul>`));
  // of another day: it says so where the minutes stand; and the kind and name are the line's
  assert.ok(out.includes(`<h3 class="rows-head">${en['mode.tram']}</h3><ul class="line-rows"><li><a class="to-line" href="line/vag/tram/4"`));
  assert.ok(out.includes(`<span class="time">06:00</span><span class="delay" data-delay="none"></span><span class="name" title="Gibitzenhof">Gibitzenhof</span><span class="platform">Plat. 3</span><span class="day">${en['departures.tomorrow']}</span></button>`));
  // of one kind only, no heading; in minutes, the minutes where the time stands; none at all, as the departures say it
  const minutes = html(lineLists({ lines: [u1] }, drawing('minutes')));
  assert.ok(minutes.startsWith('<ul class="line-rows"><li>'));
  assert.ok(minutes.includes(`<button type="button" class="row departure times-minutes by-line" data-trip="T4_20261023"><span class="minutes" data-leaves="${NOW + 6 * 60}" data-planned="${NOW + 4 * 60}" data-far="time">6 min</span>`));
  assert.ok(minutes.includes('<div class="row departure times-minutes by-line resting">'));
  assert.equal(html(lineLists({ lines: [] }, drawing())), `<p class="panel-empty">${en['departures.none']}</p>`);
  // a list with a train that has something wrong with it keeps the place of the sign in every row
  const warned = { ...u1, ways: [{ to: 'Langwasser Süd', departure: departure(4, { warnings: [{ title: null, text: 'Signal failure', severity: 'warning' }] }) }] };
  assert.ok(html(lineLists({ lines: [warned, tram] }, drawing())).includes('<ul class="line-rows signed">'));
});

test('the head of a line: its name and kind, its operator and vehicles, and the switch between its two directions (#256)', () => {
  const line = { name: 'U1', mode: 'subway', agency: 'VAG', vehicles: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], ways: [{ to: 'Langwasser Süd' }, { to: 'Fürth Hardhöhe' }] };
  const head = `<div class="panel-head"><h1><span class="badge" data-mode="subway">U1</span><span>${en['mode.subway']}</span></h1><p class="sub">VAG · 3 vehicles under way</p>`;
  assert.equal(toHtml(lineHead(line, drawing(), 1)), `${head}<p class="sub with-choice line-ways"><span>${en['line.toward']}</span><span class="view-switch ways" role="group" aria-label="${en['line.ways']}">`
    + '<button type="button" aria-pressed="false" data-way="0" title="to Langwasser Süd">Langwasser Süd</button><button type="button" aria-pressed="true" data-way="1" title="to Fürth Hardhöhe">Fürth Hardhöhe</button></span></p></div>');
  // none to switch: without a way shown, or with one way only, as around a ring; none under way
  assert.equal(toHtml(lineHead(line, drawing())), `${head}</div>`);
  assert.equal(toHtml(lineHead({ ...line, ways: [{ to: 'Ring' }] }, drawing(), 0)), `${head}</div>`);
  assert.ok(toHtml(lineHead({ ...line, vehicles: [] }, drawing())).includes('<p class="sub">VAG</p>'));
});

test('the stops of a line in one direction, with its vehicles along them as the map draws them (#256)', () => {
  const stop = (name, more = {}) => ({ id: name.slice(0, 2), name, town: null, path: `stop/${name.toLowerCase()}`, start: false, end: false, ...more });
  const vehicle = (id, more) => ({ id, to: 'Langwasser Süd', delay: null, warnings: [], branch: null, ...more });
  const line = { name: 'U1', mode: 'subway', agency: 'VAG', vehicles: [], ways: [{
    to: 'Langwasser Süd',
    stops: [stop('Hardhöhe'), stop('Gostenhof', { start: true }), stop('Messe', { end: true, start: true }), stop('Langwasser Süd')],
    branches: [{ after: 1, before: null, stops: [stop('Depot')] }],
    vehicles: [
      vehicle('a', { delay: 180, from: 0, until: 1, come: 0.5, track: [NOW - 60, 0, NOW + 60, 1, NOW + 90, 1] }),
      vehicle('b', { to: 'Messe', from: 2, until: 2, come: 0 }),
      vehicle('c', { to: 'Depot', delay: 20, branch: 0, from: -1, until: 0, come: 1 }),
    ],
  }] };
  const out = html(lineStops(line, { ...drawing(), live: true }));
  // a station: a link to its page, which the page opens in the details by its id; the first and the last end the line
  assert.ok(out.startsWith('<div class="line-body"><ul class="line-stops" data-mode="subway"><li class="on-line station first"><a class="row on-line" href="stop/hardhöhe" data-station="Ha" title="Hardhöhe"><span class="rail"></span><span class="name">Hardhöhe</span></a></li>'));
  // where some trips start, end, or both: below the name, in a higher row
  assert.ok(out.includes(`<a class="row on-line in-town" href="stop/gostenhof" data-station="Go" title="Gostenhof"><span class="rail"></span><span class="name"><span class="stop">Gostenhof</span><span class="town">${en['line.starts']}</span></span></a>`));
  assert.ok(out.includes(`<span class="town">${en['line.turns']}</span>`));
  // a branch where it leaves the line, after its station
  assert.ok(out.includes('</a></li><li class="branch-part leaves"><ul class="branch"><li class="on-line station first last"><a class="row on-line" href="stop/depot"'));
  assert.ok(out.includes('<li class="on-line station last"><a class="row on-line" href="stop/langwasser süd"'));
  // The vehicles between the middles of the rows: from 6 px down, Hardhöhe at 22, Gostenhof at 60 (a higher row),
  // the depot of the branch at 98, Messe at 136, Langwasser Süd at 174; the list 196 px high.
  assert.ok(out.includes('<svg class="line-vehicles" height="196">'));
  const at = (id) => out.match(new RegExp(`<g class="line-vehicle" transform="translate\\(([\\d.]+) ([\\d.]+)\\)" data-trip="${id}"`)).slice(1).map(Number);
  assert.deepEqual([at('a'), at('b'), at('c')], [[36, 41], [36, 136], [54, 98]]);
  // (one without a track has none for the page: it stays where it is until the next answer)
  assert.ok(!out.includes('data-trip="b" role="button" tabindex="0" aria-label="U1 to Messe" data-mode="subway" data-track'));
  // as a button named by its line, where it goes and its delay, with where it will be when in px for the page to move
  // it by itself (its track: placed by it, at the middle of its way between its first two places); the disc of its kind
  // with the name of its line, its arrowhead down the list, and the flag of its delay in the colour of the map, a
  // question mark where none is known
  assert.ok(out.includes(`data-trip="a" role="button" tabindex="0" aria-label="U1 to Langwasser Süd +3" data-mode="subway" data-track="${NOW - 60},36,22,${NOW + 60},36,60,${NOW + 90},36,60"><rect class="hit" x="-18" y="-18" width="36" height="36" rx="18"></rect><path d="M0.00,17.00L-6.21,9.08L6.21,9.08Z"></path><circle r="11"></circle><text y="4.0" font-size="11">U1</text><g class="flag major" transform="translate(6.050000000000001 -16)"><rect width="16.8" height="12" rx="4"></rect><text x="8.4" y="9">+3</text></g><rect class="ring" x="-19" y="-21" width="44.9" height="42" rx="10"></rect></g>`));
  assert.ok(out.includes('aria-label="U1 to Messe"') && out.includes('<g class="flag none"') && out.includes('<text x="6.0" y="9">?</text>'));
  // on time to the minute: no flag; without delays coming in, no question mark
  assert.ok(out.includes('data-trip="c" role="button" tabindex="0" aria-label="U1 to Depot ±0" data-mode="subway"><rect class="hit" x="-18" y="-18" width="36" height="36" rx="18"></rect><path d="M0.00,17.00L-6.21,9.08L6.21,9.08Z"></path><circle r="11"></circle><text y="4.0" font-size="11">U1</text><rect class="ring" x="-19" y="-21" width="38.0" height="42" rx="10"></rect></g>'));
  assert.ok(!html(lineStops(line, drawing())).includes('<g class="flag none"'));
  // coloured by delay as the map can be, or with the flags switched off: no flags
  const byDelay = html(lineStops(line, { ...drawing(), live: true, colorBy: 'delay' }));
  assert.ok(byDelay.includes('data-mode="subway" data-delay="minor"') && !byDelay.includes('class="flag'));
  assert.ok(!html(lineStops(line, { ...drawing(), live: true, flags: false })).includes('class="flag'));
  // in the page, which moves them and draws them on a canvas as the map does: each a button that cannot be seen, with
  // where it is and its track, its kind, delay and label
  const moving = html(lineStops(line, { ...drawing(), live: true, moving: true }));
  assert.ok(moving.includes(`<div class="line-vehicles"><canvas class="line-canvas" aria-hidden="true"></canvas><button type="button" class="line-vehicle" data-trip="a" aria-label="U1 to Langwasser Süd +3" data-mode="subway" data-late="180" data-label="U1" data-at="36.0,41.0" data-track="${NOW - 60},36,22,${NOW + 60},36,60,${NOW + 90},36,60"></button>`));
  assert.ok(moving.includes('<button type="button" class="line-vehicle" data-trip="c" aria-label="U1 to Depot ±0" data-mode="subway" data-late="20" data-label="U1" data-at="54.0,98.0"></button>') && !moving.includes('<svg'));
  // without vehicles under way, no drawing of them; a direction that is not there, nothing
  assert.ok(!html(lineStops({ ...line, ways: [{ ...line.ways[0], vehicles: [] }] }, drawing())).includes('<svg'));
  assert.deepEqual(lineStops(line, drawing(), 1), []);
});

test('a vehicle of the stops of a line goes along its track as the time goes', () => {
  const track = [100, 36, 20, 160, 36, 80, 220, 36, 80, 280, 54, 110];
  assert.deepEqual([50, 100, 130, 160, 200, 250, 280, 400].map((now) => trackAt(track, now)), [[36, 20], [36, 20], [36, 50], [36, 80], [36, 80], [45, 95], [54, 110], [54, 110]]);
});

test('a vehicle carries the first word of its line on its disc, and its delay as a flag where it is not on time', () => {
  assert.deepEqual(['U1', 'ICE 25', 'Bus 123', 'ABCDEF', ' '].map(vehicleLabel), ['U1', 'ICE', 'Bus', 'ABCD', '?']);
  assert.deepEqual([[-90, false], [20, false], [150, false], [400, false], [null, false], [null, true]].map(([delay, live]) => delayFlag(delay, live)),
    [{ text: '−1', color: 'early' }, null, { text: '+3', color: 'major' }, { text: '+7', color: 'severe' }, null, { text: '?', color: 'none' }]);
});
