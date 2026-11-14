// What the timetable says of a line or a stop beyond the minute (#289):
// server/lib/facts.js, the descriptions of lib/addresses.js, and how
// public/panel.js draws it. Every figure holds for every departure in the
// hours it names, on every day it names.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { t as translate } from '../public/i18n.js';
import de from '../public/locales/de.js';
import en from '../public/locales/en.js';
import { daysText, hoursText, hourText, lineLists, lineTimetable, oftenText, stopToday, todayText as todayTextOf, toHtml } from '../public/panel.js';
import { Addresses } from '../server/lib/addresses.js';
import { Area } from '../server/lib/area.js';
import { readDataset, writeDataset } from '../server/lib/dataset.js';
import { facts, hourly, inDay, oneWord, spanOf, stretchOf, townsOfWay, wordedAlike } from '../server/lib/facts.js';
import { buildDataset } from '../server/lib/importer.js';
import { addDays, serviceDayStart, setTimeZone } from '../server/lib/time.js';
import { Timetable } from '../server/lib/timetable.js';
import { makeZip } from './helpers.js';

// departures in minutes of a day: every `gap` from `from` to before `to` (hh:mm)
const every = (gap, from, to) => {
  const out = [];
  const [a, b] = [from, to].map((hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3));
  for (let m = a; m < b; m += gap) out.push(m);
  return out;
};
// by turns: gaps of a, b, a, b …
const byTurns = (gaps, from, to) => {
  const out = [];
  const [a, b] = [from, to].map((hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3));
  for (let m = a, k = 0; m < b; m += gaps[k++ % gaps.length]) out.push(m);
  return out;
};
const said = ({ runs }) => runs.map(({ from, to, often }) => [from, to, often]);

test('every gap the same is "every n"; differing gaps of a line that comes often its longest wait; of a rarer one how many leave an hour', () => {
  assert.deepEqual(said(hourly([[...every(10, '06:00', '20:00'), ...every(20, '20:00', '23:41')]])), [[6, 20, { every: 10 }], [20, 23, { every: 20 }]]);
  // 3, 4, 3, 3, 4 minutes apart is never every 3 minutes: at least every 4
  assert.deepEqual(said(hourly([byTurns([3, 4, 3], '06:00', '12:01')])), [[6, 12, { atMost: 4 }]]);
  // 20 and 40 minutes by turns: twice an hour, not every 30 minutes
  assert.deepEqual(said(hourly([byTurns([20, 40], '06:00', '12:01')])), [[6, 12, { perHour: [2, 2] }]]);
  // a trip more in one hour (a school run): that hour is at least every 10, and the hours of every 10 around it join it
  assert.deepEqual(said(hourly([[...every(10, '06:00', '11:01'), 485].sort((a, b) => a - b)])), [[6, 11, { atMost: 10 }]]);
  // every two hours: the hours between, with no departure of their own, are in it
  assert.deepEqual(said(hourly([every(120, '06:00', '20:01')])), [[6, 20, { every: 120 }]]);
  // one departure in an hour is no "every 50 minutes", but one an hour after the one before is "hourly"
  assert.deepEqual(said(hourly([[360, 410, 470, 520, 580]])), [[6, 8, { perHour: [1, 2] }], [8, 9, { every: 60 }]]);
  // an hour that keeps the beat of the hours before it is theirs, also where the next comes sooner: 9:48, 10:48, 11:48, 12:18
  assert.deepEqual(said(hourly([[468, 528, 588, 648, 708, 738, 762, 768, 805, 809, 818, 831, 888, 948]])), [[8, 12, { every: 60 }], [12, 14, { perHour: [3, 4] }], [14, 15, { every: 60 }]]);
  // a bus every 40 minutes leaves twice in one hour and once in the next: every 40 minutes in both, an hour of one
  // departure before the stretch too, where it keeps the beat up to it (bus 33 in Fürth: 8:57, 9:37, 10:17, … 13:37)
  assert.deepEqual(said(hourly([[...every(20, '08:17', '08:58'), ...every(40, '09:37', '13:38'), ...every(20, '13:57', '15:00')]])), [[9, 13, { every: 40 }], [13, 14, { every: 20 }]]);
  // but one departure 40 minutes from those on either side, with no hour of that beat beside it, is once an hour
  assert.deepEqual(said(hourly([[...every(20, '08:17', '08:58'), 577, ...every(20, '10:17', '11:00')]])), [[9, 10, { perHour: [1, 1] }]]);
  // and where the next comes later than that: the hour of the last on the beat is in it, as a printed timetable has
  // it, and the hours after say how long the wait is
  assert.deepEqual(said(hourly([[468, 528, 588, 648, 708, 830, 890]])), [[8, 12, { every: 60 }], [12, 13, { none: true }], [13, 14, { every: 60 }]]);
  // so the hour of 8:17, 8:37, 8:57 is every 20 minutes with those before it, where every 40 minutes follow from 9:37
  assert.deepEqual(said(hourly([[...every(20, '06:17', '08:58'), ...every(40, '09:37', '12:38')]])), [[7, 9, { every: 20 }], [9, 12, { every: 40 }]]);
  // nor where the hour after is on the same beat by itself: the wait between them, 8:57 to 9:20, is in no "alle 20"
  assert.deepEqual(said(hourly([[377, 397, 417, 437, 457, 477, 497, 517, 537, 560, 580, 600, 620, 640]])), [[7, 8, { every: 20 }], [8, 9, { perHour: [3, 3] }], [9, 10, { every: 20 }]]);
  // but not where the beat stops before the hour is over: 9:17 after every 20 minutes, and none until 10:30
  assert.deepEqual(said(hourly([[...every(20, '06:17', '09:18'), 630, 660]])), [[7, 9, { every: 20 }], [9, 11, { perHour: [1, 1] }]]);
  // a bus at :20 one hour and at :34 the next, once an hour: said so throughout, never "stündlich" beside "einmal pro
  // Stunde", which a rider reads alike (bus 113 on Sundays); a list without the uneven hours keeps "stündlich"
  const sunday = [500, 560, 620, 694, 754, 814, 860, 934, 994, 1040, 1100, 1174, 1234];
  assert.deepEqual(said(hourly([sunday])), [[9, 20, { perHour: [1, 1] }]]);
  assert.deepEqual(said(hourly([every(60, '08:48', '23:49')])), [[9, 23, { every: 60 }]]);
  // but several an hour on a beat keep their minutes beside hours of as many off it: "alle 30 Min.", "zweimal pro Stunde"
  assert.deepEqual(said(hourly([[600, 630, 660, 690, 735, 760, 780, 810, 840, 870, 900]])), [[10, 12, { every: 30 }], [12, 13, { perHour: [2, 2] }], [13, 15, { every: 30 }]]);
  // hours of as many an hour join where they stay within one of each other: 1 to 2, not 1 to 3
  assert.deepEqual(said(hourly([[360, 375, 400, 445, 490, 530, 600]])), [[6, 7, { perHour: [3, 3] }], [7, 9, { perHour: [1, 2] }], [9, 10, { none: true }]]);
  // a few an hour are counted also where the wait after them is short: one bus at 23:54, the next at 0:04
  assert.deepEqual(said(hourly([[1300, 1434, 1444, 1454]])), [[22, 23, { none: true }], [23, 24, { perHour: [1, 1] }]]);
  // an hour without a departure says so; one without on some of the days how many at most; neither is left out
  assert.deepEqual(said(hourly([[360, 420, 545, 605, 665]])), [[6, 8, { every: 60 }], [8, 9, { none: true }], [9, 11, { every: 60 }]]);
  assert.deepEqual(said(hourly([[360, 420, 480, 540], [360, 400, 540]])), [[6, 7, { perHour: [1, 2] }], [7, 9, { perHour: [0, 1] }]]);
});

test('what holds for several lists of departures holds for each of them: days, or the ways of a line', () => {
  // both every 10: every 10; one every 10 and one every 12: at least every 12
  assert.deepEqual(said(hourly([every(10, '06:00', '10:01'), every(10, '06:05', '10:06')])), [[7, 10, { every: 10 }]]);
  assert.deepEqual(said(hourly([every(10, '06:00', '10:01'), every(12, '06:00', '10:01')])), [[6, 10, { atMost: 12 }]]);
  // as many an hour, from the fewest to the most of them
  assert.deepEqual(said(hourly([every(20, '06:00', '09:01'), every(30, '06:00', '09:01')])), [[6, 9, { perHour: [2, 3] }]]);
  // the hours all of them run through; a list with nothing in it says nothing of the others
  assert.deepEqual(said(hourly([every(10, '06:00', '10:01'), every(10, '08:00', '12:01'), []])), [[8, 10, { every: 10 }]]);
  // two at the same minute are one
  assert.deepEqual(said(hourly([[...every(10, '06:00', '08:01'), 400]])), [[6, 8, { every: 10 }]]);
});

test('what is read together says once an hour one way, the count, where one list has it and another "stündlich"; several an hour on a beat keep their minutes', () => {
  // a bus on the beat on Saturdays and not on Sundays: once an hour on both, not "stündlich" one line above "einmal pro Stunde"
  const saturday = [{ from: 9, to: 23, every: 60 }];
  const sunday = [{ from: 9, to: 21, perHour: [1, 1] }, { from: 21, to: 22, none: true }];
  assert.deepEqual(oneWord([saturday, sunday]), [[{ from: 9, to: 23, perHour: [1, 1] }], sunday]);
  // within one list, the same as one after
  assert.deepEqual(oneWord([[{ from: 6, to: 9, every: 60 }, { from: 9, to: 12, perHour: [1, 1] }, { from: 12, to: 14, every: 30 }]]),
    [[{ from: 6, to: 12, perHour: [1, 1] }, { from: 12, to: 14, every: 30 }]]);
  // the gap stays where no list counts once an hour, and every 20 or 30 minutes beside three or two an hour off the beat
  const kept = [[{ from: 6, to: 9, every: 30 }, { from: 9, to: 12, every: 10 }], [{ from: 9, to: 12, perHour: [2, 2] }, { from: 12, to: 14, every: 20 }], [{ from: 12, to: 14, perHour: [3, 3] }, { from: 14, to: 16, perHour: [0, 1] }, { from: 16, to: 18, every: 60 }]];
  assert.deepEqual(oneWord(kept), kept);
});

test('a kind of day whose longest stretch is said as a count after all names it as long as its hours that say the same', () => {
  // a train on the hour from 6 to 16, then a minute early or late until 23: "6–23 einmal pro Stunde", head and hours
  const day = { dates: ['20261121'], often: { from: 6, to: 16, every: 60 }, runs: [{ from: 6, to: 23, perHour: [1, 1] }, { from: 23, to: 24, none: true }] };
  const [way] = wordedAlike([{ today: null, week: [day] }]);
  assert.deepEqual(way.week[0].often, { from: 6, to: 23, perHour: [1, 1] });
  assert.deepEqual(way.week[0].runs, day.runs);
  // a stretch on its beat keeps its own hours
  const beat = { dates: ['20261121'], often: { from: 6, to: 16, every: 30 }, runs: [{ from: 6, to: 16, every: 30 }, { from: 16, to: 23, perHour: [1, 2] }] };
  assert.deepEqual(wordedAlike([{ today: null, week: [beat] }])[0].week[0].often, beat.often);
});

test('a description names the longest stretch that one set of words holds for, where that is half the hours there are', () => {
  const day = [...every(10, '06:00', '20:00'), ...every(20, '20:00', '23:41')];
  assert.deepEqual(stretchOf(hourly([day]).hours), { from: 6, to: 20, often: { every: 10 } });
  // gaps of 3 and 4 by turns most of the day, of 7 at noon: at least every 7, all day
  const u1 = [...byTurns([3, 4], '05:00', '09:00'), ...byTurns([7, 6], '09:00', '12:00'), ...byTurns([3, 4], '12:00', '20:00'), ...every(12, '20:00', '23:59')];
  assert.deepEqual(stretchOf(hourly([u1]).hours), { from: 5, to: 20, often: { atMost: 7 } });
  // nothing holds for three hours: none
  assert.equal(stretchOf(hourly([[360, 380, 420, 425, 480, 540, 545, 600]]).hours), null);
});

test('the towns along a way go from that of its first station to that of its last, each once', () => {
  // the town it ends in last, also where a station before is in it: "bis Nürnberg", not "bis Schwaig"
  assert.deepEqual(townsOfWay(['Simmelsdorf', 'Lauf', 'Nürnberg', 'Schwaig', 'Nürnberg']), ['Simmelsdorf', 'Lauf', 'Schwaig', 'Nürnberg']);
  assert.deepEqual(townsOfWay(['Hamburg', 'Bremen', 'Bremen', 'Köln']), ['Hamburg', 'Bremen', 'Köln']);
  // a way back into the town it starts in: the towns as they come
  assert.deepEqual(townsOfWay(['Nürnberg', 'Fürth', 'Zirndorf', 'Nürnberg']), ['Nürnberg', 'Fürth', 'Zirndorf']);
  // a last station whose town is not known: the towns that are, as they come
  assert.deepEqual(townsOfWay(['Nürnberg', 'Stein', 'Rohr', null]), ['Nürnberg', 'Stein', 'Rohr']);
  assert.deepEqual(townsOfWay([null, null]), []);
});

test('the first and last of a day go around the longest pause, so that a line past midnight ends after it, however the feed writes it', () => {
  const day = every(60, '04:00', '23:01').map((m) => m * 60);
  assert.deepEqual(spanOf([...day, 24 * 3600 + 41 * 60]), { first: 4 * 3600, last: 24 * 3600 + 41 * 60 });
  assert.deepEqual(spanOf([41 * 60, ...day]), { first: 4 * 3600, last: 24 * 3600 + 41 * 60 });
  assert.equal(spanOf([]), null);
});

test('the hours of a day read it as its first and last trip do: a trip written as 0:36 is after the last of the evening, not before the first', () => {
  const day = every(60, '04:41', '22:42').map((m) => m * 60);
  // however the feed writes it, 0:36 is 24 hours on, and so is a day of its kind read with it
  assert.deepEqual(inDay([36 * 60, ...day]), [24 * 3600 + 36 * 60, ...day]);
  assert.deepEqual(inDay([24 * 3600 + 36 * 60, ...day]), [24 * 3600 + 36 * 60, ...day]);
  assert.deepEqual(inDay([36 * 60], spanOf([36 * 60, ...day])), [24 * 3600 + 36 * 60]);
  assert.deepEqual(inDay([]), []);
  // a night tram written past midnight on the day before keeps its times, on the day they are of
  assert.deepEqual(inDay([25 * 3600 + 5 * 60, 26 * 3600 + 5 * 60]), [25 * 3600 + 5 * 60, 26 * 3600 + 5 * 60]);
  // a kind of day: its hours from 5 (its first trip at 4:41) to midnight, with none after 22:41, not "1–4 none" and
  // nothing after 22 o'clock
  const date = '20261102';
  const lists = [[36 * 60, ...day], [36 * 60, ...day]];
  const said = facts(timetable).daysSaid([date, addDays(date, 1)], spanOf(lists[0]), lists);
  const hour = (h) => serviceDayStart(date) + h * 3600;
  assert.deepEqual([said.first, said.last], [hour(4) + 41 * 60, hour(24) + 36 * 60]);
  assert.deepEqual(said.runs.map(({ from, to, ...often }) => [from, to, often]), [[hour(5), hour(23), { every: 60 }], [hour(23), hour(24), { none: true }]]);
});

// A tram that runs every 10 minutes from 6 to 20 o'clock on working days, then
// every 20, with a first trip at 5:30; every 20 at the weekend; both ways.
// Not on one Thursday. A bus twice a day, at 7:12.
//   A ——— B ——— C ——— D  (tram 5);  A — E (bus 77)
const AREA = Area.fromBbox([49.3, 10.8, 49.7, 11.3]);
const MONDAY = '20261102';
const DAYS = 28;
let dir;
let timetable;

function feed() {
  const trips = ['route_id,service_id,trip_id,trip_headsign'];
  const times = ['trip_id,arrival_time,departure_time,stop_id,stop_sequence'];
  const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`;
  const trip = (service, id, route, stops, start) => {
    trips.push(`${route},${service},${id},${stops.at(-1)}`);
    stops.forEach((stop, k) => times.push(`${id},${clock(start + 3 * k)},${clock(start + 3 * k)},${stop},${k}`));
  };
  const working = [330, ...every(10, '06:00', '20:00'), ...every(20, '20:00', '23:41')];
  const weekend = every(20, '07:00', '23:41');
  for (const [service, list] of [['WD', working], ['WE', weekend]]) {
    list.forEach((m, k) => {
      trip(service, `${service}-up-${k}`, 'R5', ['A', 'B', 'C', 'D'], m);
      trip(service, `${service}-down-${k}`, 'R5', ['D', 'C', 'B', 'A'], m + 2);
    });
  }
  trip('WD', 'bus-1', 'R77', ['A', 'E'], 432);
  trip('WD', 'bus-2', 'R77', ['E', 'A'], 450);
  return {
    'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\n1,Teststadtwerke,https://example.org,Europe/Berlin\n',
    'stops.txt': 'stop_id,stop_name,stop_lat,stop_lon\nA,Anger,49.40,11.00\nB,Bahnhof,49.42,11.00\nC,Campus,49.44,11.00\nD,Dorf,49.46,11.00\nE,Eiche,49.40,11.05\n',
    'routes.txt': 'route_id,agency_id,route_short_name,route_type\nR5,1,5,0\nR77,1,77,3\n',
    'trips.txt': `${trips.join('\n')}\n`,
    'calendar.txt': `service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWD,1,1,1,1,1,0,0,${MONDAY},${addDays(MONDAY, DAYS)}\nWE,0,0,0,0,0,1,1,${MONDAY},${addDays(MONDAY, DAYS)}\n`,
    // (no tram on the second Thursday, 12 November)
    'calendar_dates.txt': 'service_id,date,exception_type\nWD,20261112,2\n',
    'stop_times.txt': `${times.join('\n')}\n`,
  };
}

before(async () => {
  setTimeZone('Europe/Berlin');
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-facts-'));
  const zipPath = path.join(dir, 'feed.zip');
  fs.writeFileSync(zipPath, makeZip(feed()));
  const file = path.join(dir, 'feed.dataset');
  writeDataset(file, await buildDataset({ zipPath, area: AREA }));
  timetable = new Timetable(readDataset(file));
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const lineNumber = (name) => timetable.lines.findIndex((line) => line.name === name);
const at = (date, hhmm) => serviceDayStart(date) + +hhmm.slice(0, 2) * 3600 + +hhmm.slice(3) * 60;
const clockOf = (epoch) => new Intl.DateTimeFormat('de', { timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(epoch * 1000);

test('a line, each way it goes: how often it runs today hour by hour, the coming week by kind of day; from end to end', () => {
  const wednesday = '20261104';
  const line = facts(timetable).line(lineNumber('5'), at(wednesday, '13:37'));
  // its two ways, as its details switch between them: towards Dorf from 5:30, back from 5:32, each counted where it
  // begins, the stop they are of named
  assert.equal(line.ways.length, 2);
  const [up, down] = line.ways;
  assert.deepEqual([line.date, up.stop, down.stop], [wednesday, 'Anger', 'Dorf']);
  assert.equal(up.today.date, wednesday);
  assert.deepEqual([up.today, down.today].map((today) => [clockOf(today.first), clockOf(today.last)]), [['05:30', '23:40'], ['05:32', '23:42']]);
  assert.deepEqual(up.today.runs.map(({ from, to, ...often }) => [clockOf(from), clockOf(to), often]), [['06:00', '20:00', { every: 10 }], ['20:00', '23:00', { every: 20 }]]);
  // Wednesday to Tuesday by their kind: the working days, Saturday and Sunday, each with what holds on each of its days
  assert.deepEqual(up.week.map((group) => [group.dates, clockOf(group.often.from), clockOf(group.often.to), group.often.every, group.trips]), [
    [['20261104', '20261105', '20261106', '20261109', '20261110'], '06:00', '20:00', 10, [97, 97]],
    [['20261107'], '07:00', '23:00', 20, [51, 51]],
    [['20261108'], '07:00', '23:00', 20, [51, 51]],
  ]);
  // (the other way from 8 o'clock at the weekend: its first trip leaves at 7:02)
  assert.equal(clockOf(down.week[1].often.from), '08:00');
  assert.deepEqual([line.minutes, line.stops], [9, 4]);
  // after its last trip, and before the first of the next day: the day it belongs to
  assert.equal(facts(timetable).line(lineNumber('5'), at(wednesday, '23:50')).ways[0].today.date, wednesday);
});

test('a line\'s description says what holds on every working day of the coming four weeks, and on which it does not run', () => {
  const addresses = new Addresses(timetable);
  const now = at('20261104', '13:37');
  const tram = lineNumber('5');
  assert.equal(addresses.lineWords(tram, 'de', de, now).description, 'Tram 5: werktags außer 12. November, von 6 bis 20 Uhr alle 10 Minuten, Fahrten zwischen 5:30 und 23:42 Uhr. 4 Haltestellen, live auf der Karte.');
  assert.equal(addresses.lineWords(tram, 'en', en, now).description, 'Tram 5: on working days except 12 November, every 10 minutes from 6:00 to 20:00, trips between 5:30 and 23:42. 4 stops, live on the map.');
  // after that Thursday, every working day
  assert.match(addresses.lineWords(tram, 'de', de, at('20261113', '08:00')).description, /^Tram 5: werktags von 6 bis 20 Uhr alle 10 Minuten,/);
  // a bus that leaves once a day each way: how many, and when
  assert.equal(addresses.lineWords(lineNumber('77'), 'de', de, now).description, 'Bus 77: werktags außer 12. November, 1 Fahrt je Richtung zwischen 7:12 und 7:30 Uhr. 2 Haltestellen, live auf der Karte.');
  // several days apart: "4. bis 6. November und 18. November"; more than three stretches: on some working days
  assert.match(addresses.lineWords(tram, 'de', de, at('20261113', '08:00')).description, /^Tram 5: werktags von/);
});

test('a stop: what leaves it today, each line each way how often there, the towns its lines go to; the sitemap lists the stops something leaves in a week', () => {
  const known = facts(timetable);
  const anger = timetable.stopIndex.get('A');
  const stop = known.stop(anger, at('20261104', '13:37'));
  assert.deepEqual([clockOf(stop.first), clockOf(stop.last), stop.lines.size], ['05:30', '23:40', 2]);
  // each way by its destination, as "Alle Linien" names it: from its first stop the tram leaves one way only
  const tram = stop.lines.get(lineNumber('5'));
  assert.deepEqual([...tram.keys()], ['D']);
  assert.deepEqual(tram.get('D').runs.map(({ from, to, ...often }) => [clockOf(from), clockOf(to), often]), [['06:00', '20:00', { every: 10 }], ['20:00', '23:00', { every: 20 }]]);
  assert.deepEqual(stop.lines.get(lineNumber('77')).get('E').runs, []);
  // between its ends both ways, each its own: the first trip towards Dorf at 5:33, back at 5:38
  const bahnhof = known.stop(timetable.stopIndex.get('B'), at('20261104', '13:37')).lines.get(lineNumber('5'));
  assert.deepEqual([...bahnhof].map(([to, { first, last }]) => [to, clockOf(first), clockOf(last)]).sort(), [['A', '05:38', '23:48'], ['D', '05:33', '23:43']]);
  // nothing leaves on the stations at the weekend that the bus alone calls at
  const leaving = known.leavingWithin('20261107', 2);
  assert.deepEqual(timetable.stations.map((station, i) => [station.id, leaving[i]]).sort(), [['A', 1], ['B', 1], ['C', 1], ['D', 1], ['E', 0]]);
});

// ---------- as the details draw it ----------

const drawing = (language, texts, now) => {
  const time = new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone: 'Europe/Berlin' });
  const hour = new Intl.DateTimeFormat(language, { hour: 'numeric', timeZone: 'Europe/Berlin' });
  const weekday = new Intl.DateTimeFormat(language, { weekday: 'short', timeZone: 'Europe/Berlin' });
  const list = new Intl.ListFormat(language, { type: 'conjunction' });
  return { t: (key, params) => translate(key, params, texts), time: (e) => time.format(e * 1000), hour: (e) => hour.format(e * 1000), weekday: (e) => weekday.format(e * 1000), list: (w) => list.format(w), now };
};

test('how often, in the words of the details: the gap, the longest wait, how many an hour, hourly', () => {
  const words = (often, texts) => oftenText(often, drawing('de', texts, 0));
  assert.deepEqual([{ every: 10 }, { atMost: 4 }, { every: 60 }, { every: 120 }, { perHour: [1, 1] }, { perHour: [2, 2] }, { perHour: [5, 5] }, { perHour: [1, 3] }, { none: true }, { perHour: [0, 1] }, { perHour: [0, 3] }].map((often) => words(often, de)),
    ['alle 10 Min.', 'spätestens alle 4 Min.', 'stündlich', 'alle 2 Std.', 'einmal pro Stunde', 'zweimal pro Stunde', '5-mal pro Stunde', '1- bis 3-mal pro Stunde', 'keine Fahrt', 'höchstens einmal pro Stunde', 'höchstens 3-mal pro Stunde']);
  assert.deepEqual([{ every: 10 }, { atMost: 4 }, { perHour: [1, 1] }, { perHour: [2, 2] }, { perHour: [3, 3] }].map((often) => words(often, en)),
    ['every 10 min', 'at least every 4 min', 'once an hour', 'twice an hour', '3 times an hour']);
});

test('whole hours as a clock says them, a stretch of them, midnight at its end as 24 where the clock counts so', () => {
  const day = '20261104';
  const [de24, en12, gb] = [drawing('de', de, 0), drawing('en-US', en, 0), drawing('en-GB', en, 0)];
  assert.deepEqual([hourText(at(day, '19:00'), de24), hourText(at(day, '19:00'), en12), hourText(at(day, '19:00'), gb)], ['19 Uhr', '7 PM', '19:00']);
  assert.equal(hoursText(at(day, '05:00'), at(day, '07:00'), de24), '5–7 Uhr');
  assert.equal(hoursText(at(day, '20:00'), at(day, '24:00'), de24), '20–24 Uhr');
  assert.equal(hoursText(at(day, '05:00'), at(day, '07:00'), en12), '5–7 AM');
  assert.equal(hoursText(at(day, '11:00'), at(day, '13:00'), en12), '11 AM–1 PM');
  assert.equal(hoursText(at(day, '20:00'), at(day, '24:00'), en12), '8 PM–12 AM');
  // (not one AM for both ends of a stretch from the morning to midnight)
  assert.equal(hoursText(at(day, '05:00'), at(day, '24:00'), en12), '5 AM–12 AM');
  assert.equal(hoursText(at(day, '05:00'), at(day, '24:00'), de24), '5–24 Uhr');
  assert.equal(hoursText(at(day, '20:00'), at(day, '24:00'), gb), '20:00–24:00');
});

test('the line in the head says how often in the hour it is and until when, and the last trip; the first before it, none after', () => {
  // (its words as said: where the line breaks, a short part is kept whole and the dot between parts does not begin a line)
  const todayText = (...args) => todayTextOf(...args).replace(/\u00a0/g, ' ');
  const day = '20261104';
  const today = { first: at(day, '05:30'), last: at(day, '23:40'), runs: [{ from: at(day, '06:00'), to: at(day, '20:00'), every: 10 }, { from: at(day, '20:00'), to: at(day, '23:00'), atMost: 20 }] };
  assert.equal(todayText(today, drawing('de', de, at(day, '13:37'))), 'Bis 20 Uhr alle 10 Min. · letzte Fahrt 23:40');
  assert.equal(todayText(today, drawing('de', de, at(day, '21:00'))), 'Bis 23 Uhr spätestens alle 20 Min. · letzte Fahrt 23:40');
  assert.equal(todayText(today, drawing('en-US', en, at(day, '13:37'))), 'Every 10 min until 8 PM · last trip 11:40 PM');
  assert.equal(todayText(today, drawing('de', de, at(day, '04:00'))), 'Erste Fahrt 05:30 · letzte Fahrt 23:40');
  // an hour no words hold for: the last trip alone
  assert.equal(todayText(today, drawing('de', de, at(day, '23:20'))), 'Letzte Fahrt 23:40');
  assert.equal(todayText(today, drawing('de', de, at(day, '23:50'))), 'Heute keine Fahrt mehr');
  assert.equal(todayText(null, drawing('de', de, at(day, '13:37'))), 'Heute keine Fahrt');
  // an hour without a trip, as such
  assert.equal(todayText({ ...today, runs: [{ from: at(day, '13:00'), to: at(day, '15:00'), none: true }] }, drawing('de', de, at(day, '13:37'))), 'Bis 15 Uhr keine Fahrt · letzte Fahrt 23:40');
  // of a line, the stop its figures are of first: its last trip there is not that at the next
  assert.equal(todayText(today, drawing('de', de, at(day, '13:37')), 'Nürnberg Plärrer'), 'Ab Nürnberg Plärrer: bis 20 Uhr alle 10 Min. · letzte Fahrt 23:40');
  assert.equal(todayText(today, drawing('de', de, at(day, '23:50')), 'Nürnberg Plärrer'), 'Ab Nürnberg Plärrer: heute keine Fahrt mehr');
  assert.equal(todayText(today, drawing('en-US', en, at(day, '13:37')), 'Nürnberg Plärrer'), 'From Nürnberg Plärrer: every 10 min until 8 PM · last trip 11:40 PM');
  assert.equal(todayTextOf(today, drawing('de', de, at(day, '13:37'))), 'Bis 20 Uhr alle 10 Min.\u00a0· letzte\u00a0Fahrt\u00a023:40');
});

test('a stop says below its name how many lines leave it today, from when to when', () => {
  const day = '20261104';
  const context = drawing('de', de, at(day, '13:37'));
  assert.equal(toHtml(stopToday({ first: at(day, '04:36'), last: at(day, '25:04'), lines: 20, all: 20 }, context)), '<p class="facts">20 Linien fahren heute, von 04:36 bis 01:04</p>');
  // of how many, where some of its lines do not run today
  assert.equal(toHtml(stopToday({ first: at(day, '04:36'), last: at(day, '25:04'), lines: 15, all: 20 }, context)), '<p class="facts">15 von 20 Linien fahren heute, von 04:36 bis 01:04</p>');
  assert.equal(toHtml(stopToday({ first: at(day, '05:00'), last: at(day, '06:00'), lines: 1, all: 3 }, drawing('en-US', en, 0))), '<p class="facts">1 of 3 lines runs today, from 5:00 AM to 6:00 AM</p>');
  assert.equal(toHtml(stopToday({ first: null, last: null, lines: 0 }, context)), '<p class="facts">Heute keine Abfahrt</p>');
  assert.equal(stopToday(null, context), null);
});

test('the timetable after the stops of a line: two lines for each kind of day, Monday first, its hours folded below its own head; from end to end, its towns', () => {
  const run = (date, from, to, often) => ({ from: at(date, from), to: at(date, to), ...often });
  const week = [
    { dates: ['20261108'], first: at('20261108', '08:10'), last: at('20261108', '21:50'), often: null, trips: [14, 14], runs: [] },
    { dates: ['20261104', '20261105', '20261106', '20261109', '20261110'], first: at('20261104', '05:30'), last: at('20261104', '23:40'), often: run('20261104', '06:00', '20:00', { every: 10 }), trips: [94, 94], runs: [run('20261104', '06:00', '20:00', { every: 10 }), run('20261104', '20:00', '24:00', { every: 20 })] },
    { dates: ['20261107'], first: null, last: null, often: null, trips: null, runs: [] },
  ];
  const facts = { ways: [{ week }, { week: week.slice(0, 1) }], minutes: 37, stops: 27, towns: ['Nürnberg', 'Fürth'] };
  const context = drawing('de', de, at('20261104', '13:37'));
  const html = lineTimetable(facts, context).map(toHtml).join('');
  const chevron = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z"></path></svg>';
  // the heading before the timetable, a way down to it from the foot of the details (app.js)
  assert.equal(html, `<h2 class="timetable-head"><button type="button" class="to-timetable" data-focus="timetable-head"><span class="what"><span class="title">Fahrplan der nächsten 7 Tage</span></span>${chevron}</button></h2>`
    + '<section class="line-timetable"><ul class="timetable-days">'
    + '<li><details class="days" data-days="20261104,20261105,20261106,20261109,20261110"><summary class="days-head" data-focus="days 20261104,20261105,20261106,20261109,20261110">'
    + `<span class="when">Mo–Fr</span><span class="said"><span class="span">05:30–23:40</span><span class="often">6–20 Uhr alle 10 Min.</span></span>${chevron}</summary>`
    + '<ul class="runs"><li><span class="hours">6–20 Uhr</span> <span>alle 10 Min.</span></li><li><span class="hours">20–24 Uhr</span> <span>alle 20 Min.</span></li></ul></details></li>'
    + '<li><div class="days-head"><span class="when">Sa</span><span class="said"><span class="span">keine Fahrten</span></span></div></li>'
    + '<li><div class="days-head"><span class="when">So</span><span class="said"><span class="span">08:10–21:50</span><span class="often">14 Fahrten</span></span></div></li>'
    + '</ul><div class="along"><p>37 Min. von Ende zu Ende · 27 Haltestellen</p><p>Durch Nürnberg und Fürth</p></div></section>');
  // the stop its figures are of, in the heading; the kind of day today is, marked
  const named = lineTimetable({ ...facts, date: '20261104', ways: [{ week, stop: 'Nürnberg Plärrer' }] }, context).map(toHtml).join('');
  assert.ok(named.includes('<span class="title">Fahrplan der nächsten 7 Tage</span><span class="from">ab Nürnberg Plärrer</span>'), named);
  assert.ok(named.includes('<span class="when">Mo–Fr<span class="today">heute</span></span>'), named);
  assert.equal(named.match(/class="today"/g).length, 1);
  // a kind of day opened (by its dates) is drawn open; the other way has its own
  assert.ok(lineTimetable(facts, context, 0, new Set(['20261104,20261105,20261106,20261109,20261110'])).map(toHtml).join('').includes('<details class="days" open data-days='));
  assert.ok(lineTimetable(facts, context, 1).map(toHtml).join('').includes('<span class="when">So</span>') && !lineTimetable(facts, context, 1).map(toHtml).join('').includes('Mo–Fr'));
  // a kind of day whose hours say no more than its second line has nothing to open
  const one = { ways: [{ week: [{ ...week[1], runs: [week[1].often] }] }] };
  assert.ok(!lineTimetable(one, context).map(toHtml).join('').includes('<details'));
  // days apart, and a stretch of three or more: "Mo, Mi–Fr"
  assert.equal(daysText(['20261106', '20261104', '20261105', '20261109'], drawing('de', de, 0)), 'Mo, Mi–Fr');
  // many towns: how many, from the first to the last
  assert.match(lineTimetable({ ...facts, minutes: 112, stops: 37, towns: ['Bamberg', 'Forchheim', 'Erlangen', 'Fürth', 'Nürnberg', 'Pommelsbrunn'] }, drawing('en-US', en, 0)).map(toHtml).join(''), /<p>Through 6 towns from Bamberg to Pommelsbrunn<\/p>/);
  assert.equal(lineTimetable({ ways: [{ week: [] }] }, drawing('de', de, 0)), null);
});

test('all lines of a stop say below each way how often it leaves there now, and at the end the towns they go to', () => {
  const day = '20261104';
  const context = { ...drawing('de', de, at(day, '13:37')), times: 'both' };
  const line = { name: '36', mode: 'bus', agency: 'VAG', at: null, path: 'line/vag/bus/36', ways: [{ to: 'Doku-Zentrum', departure: null, facts: { first: at(day, '05:17'), last: at(day, '24:27'), runs: [{ from: at(day, '07:00'), to: at(day, '20:00'), atMost: 10 }] } }, { to: 'Plärrer', departure: null, facts: null }] };
  const html = lineLists({ lines: [line], towns: { towns: ['Nürnberg', 'Fürth', 'Stein'], more: 0 } }, context).map(toHtml).join('');
  // (below the way it is of; a way that nothing leaves by today has none)
  assert.ok(html.replace(/\u00a0/g, ' ').includes('<abbr class="later" title="Nicht in den nächsten 24 Stunden">nicht in 24 h</abbr></div><p class="line-facts">Bis 20 Uhr spätestens alle 10 Min. · letzte Fahrt 00:27</p></li>'), html);
  assert.equal(html.match(/class="line-facts"/g).length, 1);
  assert.ok(html.endsWith('<p class="lines-towns">Die Linien fahren nach Nürnberg, Fürth und Stein.</p>'), html);
  const many = lineLists({ lines: [line], towns: { towns: ['Nürnberg', 'Fürth'], more: 3 } }, context).map(toHtml).join('');
  assert.ok(many.endsWith('<p class="lines-towns">Die Linien fahren nach Nürnberg, Fürth und in 3 weitere Orte.</p>'), many);
  const one = lineLists({ lines: [line], towns: { towns: ['Nürnberg'], more: 0 } }, context).map(toHtml).join('');
  assert.ok(one.endsWith('<p class="lines-towns">Die Linien fahren innerhalb von Nürnberg.</p>'), one);
});
