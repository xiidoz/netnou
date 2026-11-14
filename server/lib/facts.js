// What the timetable says of a line or a stop beyond the minute (#289): how
// often it runs at each hour of a day, its first and last trip, on which
// days, through which towns. Every figure holds for every departure in the
// hours it names, on every day it names: "every 10 minutes" where each one
// leaves 10 minutes after the one before, on each of those days and each way
// it goes. Where the gaps differ, a line that comes often is told by the
// longest wait, as a rider who takes it does not look up its times; a rarer
// one by how many leave in each hour, as its times are what a rider plans by.

import { addDays, localDate, serviceDayStart, weekday } from './time.js';

// Up to this many minutes a wait is told as "at least every N minutes"; a
// line whose gaps are longer and differ is told by how many leave an hour.
export const AT_MOST_MIN = 15;
// Up to this many departures an hour are told by how many leave, also where
// the waits after them are short: one bus at 23:54 and the next at 0:04 is
// "once an hour" from 23 to 24, no "at least every 10 minutes".
export const COUNTED_MAX = 3;
// The details tell of the coming week, each day as its timetable is.
export const WEEK_DAYS = 7;
// "On working days" in a description is every Monday to Friday of the
// coming four weeks: a sentence that a search engine shows for days on.
export const DESCRIBED_DAYS = 28;
// A description names how often a line runs where that holds for at least
// half the hours it runs, and for this many at least.
export const DESCRIBED_HOURS = 3;
// The towns the lines of a stop go to that its details name, the nearest first.
export const NAMED_TOWNS = 8;
// (how many days of facts are kept, for each line and each stop asked for)
const KEPT = 2000;

/**
 * How often departures leave, hour by hour of their service day, in words
 * that hold for each of several lists of them alike (a day each, or a way
 * each): an hour where every gap is the same says it (`every`), one where
 * they differ but none is longer than AT_MOST_MIN, and more than
 * COUNTED_MAX leave in it, the longest (`atMost`),
 * any other how many leave in it (`perHour`, the fewest and the most of
 * the lists); one where none leaves on any of them, that none does
 * (`none`). The gap that begins in an hour is the hour's, also where it
 * ends in a later one: so an hour with no departure of its own, between two
 * that are two hours apart, is in the same `every` as those around it.
 * @param series lists of departure times, in minutes of their service day
 * @returns { hours: [{ h, often, longest, exact }], runs: [{ from, to, often }] }:
 *   `hours` from the first hour all the lists run through to the last, with
 *   null `often` where nothing holds (one of them has no departure in it);
 *   `runs` the hours that say the same as one: `from` and `to` in hours of
 *   the service day; `often` { every: n } | { atMost: n } | { perHour: [few, many] } | { none: true }
 */
export function hourly(series) {
  // (two at the same minute are one for a rider: a train in two parts, a bus of two lines' numbers)
  const lists = series.map((list) => [...new Set(list)].sort((a, b) => a - b)).filter((list) => list.length > 1);
  if (!lists.length) return { hours: [], runs: [] };
  const lo = Math.max(...lists.map((list) => Math.ceil(list[0] / 60)));
  const hi = Math.min(...lists.map((list) => Math.floor(list.at(-1) / 60)));
  const hours = [];
  for (let h = lo; h < hi; h++) {
    const gaps = [];
    const counts = [];
    for (const list of lists) {
      let k = firstFrom(list, h * 60);
      const before = k;
      for (; list[k] < (h + 1) * 60; k++) gaps.push(list[k + 1] - list[k]);
      counts.push(k - before);
      // (none in the hour: the gap across it, from the one before to the one after)
      if (k === before) gaps.push(list[k] - list[k - 1]);
    }
    const longest = Math.max(...gaps);
    const same = gaps.every((gap) => gap === gaps[0]);
    // (one departure in an hour is "every n" only where n is whole hours: "hourly", "every 2 hours")
    const exact = same && (counts.every((count) => count > 1) || gaps[0] % 60 === 0) ? gaps[0] : null;
    // (an hour without a departure says so, one without on some of the days how many at most: never left out, as on a
    // rare line the hour without a bus is what a rider plans around)
    const empty = counts.filter((count) => count === 0).length;
    const often = exact !== null ? { every: exact }
      : empty === counts.length ? { none: true }
        : empty ? { perHour: [0, Math.max(...counts)] }
          : longest <= AT_MOST_MIN && Math.min(...counts) > COUNTED_MAX ? { atMost: longest } : { perHour: [Math.min(...counts), Math.max(...counts)] };
    hours.push({ h, often, longest, exact });
  }
  // An hour after a stretch of every n whose departures keep that beat, each
  // n after the one before, up to its end, is part of it, whenever the next
  // comes after its last: 9:48, 10:48, 11:48 and then 12:18 are "hourly from
  // 9 to 12", and so are 8:17, 8:37, 8:57 "every 20 minutes" with those
  // before them where the next leaves at 9:37, every 40 minutes from then
  // on. The hour of the last departure on a beat is no other than those
  // before it, as a printed timetable has it; how long the wait after it is,
  // the hour of the next says. Up to its end: no departure of the beat is
  // missing in the hour, its last less than n before the hour is over; one
  // at 9:17 after every 20 minutes, and none until 10:30, is no "every 20
  // minutes" from 9 to 10. And only where the hour after is not on the same
  // beat by itself: there the wait between them is in the stretch, and 8:57
  // and then 9:20, 9:40, 10:00 are no "every 20 minutes" from 8 to 10. So is
  // one before such a stretch whose
  // departures keep its beat up to it, each n after the one before and the
  // stretch's first n after its last. This is how an hour with one departure
  // of a beat that is no whole hours is in it: a bus every 40 minutes leaves
  // twice in one hour and once in the next, and is every 40 minutes in both.
  const keeps = (hour, n, next) => lists.every((list) => {
    let i = firstFrom(list, hour.h * 60);
    const before = i;
    for (; list[i] < (hour.h + 1) * 60; i++) if (list[i] - list[i - 1] !== n) return false;
    return i > before && next(list[i] - list[i - 1], list[i - 1]);
  });
  const onBeat = (hour, n) => Object.assign(hour, { exact: n, often: { every: n }, longest: n });
  hours.forEach((hour, k) => {
    const n = hours[k - 1]?.exact;
    const ends = (gap, last) => gap <= n || (last + n >= (hour.h + 1) * 60 && hours[k + 1]?.exact !== n);
    if (n && hour.exact === null && hour.often !== null && keeps(hour, n, ends)) onBeat(hour, n);
  });
  for (let k = hours.length - 2; k >= 0; k--) {
    const hour = hours[k];
    const n = hours[k + 1].exact;
    if (n && hour.exact === null && hour.often !== null && keeps(hour, n, (gap) => gap === n)) onBeat(hour, n);
  }
  const runs = [];
  for (const { h, often } of hours) {
    const last = runs.at(-1);
    const joined = last && often && last.to === h ? join(last.often, often) : null;
    if (joined) Object.assign(last, { to: h + 1, often: joined });
    else if (often) runs.push({ from: h, to: h + 1, often });
  }
  const [said] = oneWord([runs.map(({ from, to, often }) => ({ from, to, ...often }))]);
  return { hours, runs: said.map(({ from, to, ...often }) => ({ from, to, often })) };
}

/**
 * One way of saying once an hour in lists of runs that are read together, as
 * the details of a line or of a stop have them (runs as runsAt has them:
 * { from, to, every | atMost | perHour | none }): where it is said both as a
 * gap ("stündlich") and as a count ("einmal pro Stunde"), as a line whose
 * bus leaves at :20 one hour and at :34 the next, or on Saturdays on the beat
 * and on Sundays not, has it, the count, which holds for both; and runs of a
 * list that then say the same as one. A rider reads "stündlich" and
 * "einmal pro Stunde" alike, and asks what sets them apart. Several an hour
 * on a beat keep their minutes ("alle 20 Min.") beside hours of as many off
 * it ("dreimal pro Stunde"): the minutes say more, and that they differ.
 * @returns the lists, each said so
 */
export function oneWord(lists) {
  const counted = new Set(lists.flat().filter(({ perHour }) => perHour && perHour[0] === perHour[1] && perHour[0] > 0).map(({ perHour }) => perHour[0]));
  const said = (run) => (run.every === 60 && counted.has(1) ? { from: run.from, to: run.to, perHour: [1, 1] } : run);
  return lists.map((runs) => {
    const out = [];
    for (const run of runs.map(said)) {
      const last = out.at(-1);
      if (last && last.to === run.from && last.perHour && run.perHour && last.perHour[0] === run.perHour[0] && last.perHour[1] === run.perHour[1]) last.to = run.to;
      else out.push({ ...run });
    }
    return out;
  });
}

/**
 * What two hours say as one, or null: the same gap (at least every n where
 * one says that), or how many leave an hour where that stays within one of
 * each other ("1- bis 2-mal pro Stunde"), as a rarer line's hours otherwise
 * make a long list that says little more.
 */
function join(a, b) {
  const n = (often) => often.every ?? often.atMost;
  if (n(a) !== undefined && n(a) === n(b)) return a.atMost !== undefined || b.atMost !== undefined ? { atMost: n(a) } : a;
  if (a.none && b.none) return a;
  // (hours of at most n, with none on some days, join only each other: "höchstens einmal pro Stunde" is no "einmal pro Stunde")
  if (a.perHour && b.perHour && (a.perHour[0] === 0) === (b.perHour[0] === 0)) {
    const few = Math.min(a.perHour[0], b.perHour[0]);
    const many = Math.max(a.perHour[1], b.perHour[1]);
    if (many - few <= 1) return { perHour: [few, many] };
  }
  return null;
}

/** The first place in a sorted list whose value is not below `wanted`. */
function firstFrom(list, wanted) {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (list[middle] < wanted) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The longest stretch of hours that one set of words holds for, where it
 * covers half the hours there are and DESCRIBED_HOURS at least: the same
 * gap if one does, else the shortest longest wait that does. Null where
 * none does: the departures are then told by how many there are.
 * @param hours as hourly() has them
 * @returns { from, to, often } or null
 */
export function stretchOf(hours) {
  const need = Math.max(DESCRIBED_HOURS, hours.length / 2);
  const longestWhere = (holds) => {
    let best = null;
    let from = null;
    hours.forEach((hour, k) => {
      if (holds(hour)) {
        from ??= k;
        if (!best || k + 1 - from > best.to - best.from) best = { from, to: k + 1 };
      } else from = null;
    });
    return best && best.to - best.from >= need ? { from: hours[best.from].h, to: hours[best.to - 1].h + 1 } : null;
  };
  for (const n of [...new Set(hours.map((hour) => hour.exact).filter((n) => n !== null))].sort((a, b) => a - b)) {
    const found = longestWhere((hour) => hour.exact === n);
    if (found) return { ...found, often: { every: n } };
  }
  for (const n of [...new Set(hours.map((hour) => hour.longest))].filter((n) => n <= AT_MOST_MIN).sort((a, b) => a - b)) {
    const found = longestWhere((hour) => hour.longest <= n && !hour.often?.perHour);
    if (found) return { ...found, often: { atMost: n } };
  }
  return null;
}

/**
 * The first and the last of the times something leaves in a service day, in
 * seconds of it: around the longest pause of the 24 hours, so that a line
 * that runs on past midnight, written as 0:41 on its day by some feeds and
 * as 24:41 by others, has its last trip at 0:41 and not its first.
 * @returns { first, last } with last > first (24 hours added where it is past midnight), or null
 */
export function spanOf(times) {
  if (!times.length) return null;
  const day = [...new Set(times.map((time) => ((time % 86400) + 86400) % 86400))].sort((a, b) => a - b);
  let pause = day[0] + 86400 - day.at(-1);
  let first = day[0];
  let last = day.at(-1);
  for (let k = 1; k < day.length; k++) {
    if (day[k] - day[k - 1] > pause) [pause, first, last] = [day[k] - day[k - 1], day[k], day[k - 1]];
  }
  return { first, last: last < first ? last + 86400 : last };
}

/**
 * The times of a service day as spanOf reads them, in seconds: one written
 * before the first trip leaves after midnight, 24 hours later, as where the
 * feed writes 24:36 for 0:36. The hours of a day then go from its first trip
 * to its last, as the first and last trip say, and a 0:36 is no first trip of
 * the morning in them. A time written past midnight (25:05) stays as it is.
 * @param span the span of these times (spanOf), or of the days they are read with
 */
export function inDay(times, span = spanOf(times)) {
  if (!span) return [];
  return times.map((time) => (time < span.first ? time + 86400 : time));
}

/**
 * The towns along a way, from that of its first station to that of its last
 * (the towns of its stations in order, null where one is not known): each
 * once, where it first comes, but the town of the last station at the end,
 * also where a station before is in that town too. A way's stations are
 * those of its trips that go different routes, one list (lineWays); a train
 * that calls in the town it ends in before it calls in others would else go
 * "bis" the last of those others. Where it ends in the town it starts in, the
 * towns as they come.
 */
export function townsOfWay(towns) {
  const known = towns.filter(Boolean);
  const order = [...new Set(known)];
  const end = towns.at(-1);
  if (!end || end === known[0] || order.at(-1) === end) return order;
  return [...order.filter((town) => town !== end), end];
}

/** Of several days' spans, the range all of them lie in: the earliest first and the latest last. */
const rangeOf = (spans) => (spans.length ? { first: Math.min(...spans.map((s) => s.first)), last: Math.max(...spans.map((s) => s.last)) } : null);

/**
 * The ways of a line (Facts.line), each number of departures an hour said
 * one way in all that its details say of both (oneWord): of today, and of
 * each kind of day its longest stretch and its hours. A stretch that is said
 * as a count then is as long as the hours around it that say the same: an
 * hourly train from 6 to 16 that runs on once an hour, a minute early or late,
 * until 23 is "6–23 einmal pro Stunde" in its head as in its hours, not
 * "6–16".
 */
export function wordedAlike(ways) {
  const lists = ways.flatMap(({ today, week }) => [today?.runs ?? [], ...week.flatMap((days) => [days.often ? [days.often] : [], days.runs])]);
  const said = oneWord(lists).values();
  const next = () => said.next().value;
  const sameCount = (a, b) => a.perHour && b.perHour && a.perHour[0] === b.perHour[0] && a.perHour[1] === b.perHour[1];
  return ways.map((way) => {
    const runs = next();
    const today = way.today && { ...way.today, runs };
    const week = way.week.map((days) => {
      const often = next()[0] ?? null;
      const hours = next();
      const around = often && hours.find((run) => sameCount(run, often) && run.from <= often.from && run.to >= often.to);
      return { ...days, often: around ? { ...often, from: around.from, to: around.to } : often, runs: hours };
    });
    return { ...way, today, week };
  });
}

/** The runs of hours of a service day as moments: their hours as epoch seconds. */
const runsAt = (runs, base) => runs.map(({ from, to, often }) => ({ from: base + from * 3600, to: base + to * 3600, ...often }));

/**
 * The facts of the lines and stops of one timetable, as the details and the
 * descriptions tell them. Kept for each line and stop and day once asked
 * for: a timetable is the same all its life.
 */
export class Facts {
  constructor(timetable) {
    this.tt = timetable;
    this.kept = new Map();
  }

  /** What `make` gives for a key, made once (and again after KEPT others). */
  keep(key, make) {
    if (this.kept.has(key)) return this.kept.get(key);
    if (this.kept.size >= KEPT) this.kept.clear();
    const value = make();
    this.kept.set(key, value);
    return value;
  }

  /**
   * The days from `date` on, `count` of them at most, that the timetable
   * covers (from its first day to its last, also one on which nothing runs)
   * and `wanted` takes (yyyymmdd).
   */
  dates(date, count, wanted = () => true) {
    const { dates } = this.tt;
    const out = [];
    for (let k = 0; k < count; k++) {
      const day = addDays(date, k);
      if (day >= dates[0] && day <= dates.at(-1) && wanted(day)) out.push(day);
    }
    return out;
  }

  /**
   * The ways of line number `index` its facts are told of: the two its
   * details switch between (lineWays), each with its trips and the stations
   * each of them leaves, in order; and the trips of all its ways, for its
   * first and last of a day. (A pattern may have trips of other lines too.)
   */
  waysOf(index) {
    return this.keep(`ways ${index}`, () => {
      const tt = this.tt;
      const ways = tt.lineWays(index);
      const tripsOf = (way) => {
        const trips = [];
        for (const pattern of way.patterns) {
          for (let k = tt.patternFirst[pattern]; k < tt.patternFirst[pattern + 1]; k++) if (tt.tripLine[tt.tripsOfPattern[k]] === index) trips.push(tt.tripsOfPattern[k]);
        }
        return trips;
      };
      const counted = ways.slice(0, 2).map((way) => ({ trips: tripsOf(way), order: new Map(way.list.map((s, i) => [s, i])) }));
      return { counted, all: ways.flatMap(tripsOf) };
    });
  }

  /**
   * The departures of a counted way (waysOf) on a date, in minutes of its
   * service day as its first and last trip read it (inDay): at the station
   * most of its trips of that day leave from (of as busy ones the first along
   * the way), where it runs as it does along most of its way, also while a
   * part of it is closed.
   */
  wayMinutes(way, date) {
    const tt = this.tt;
    const trips = way.trips.filter((t) => tt.runsOn(t, date));
    const leaving = new Map(); // station → [seconds]
    for (const t of trips) {
      const stops = tt.stopsOf(t);
      const seen = new Set();
      for (let p = 0; p < stops.length - 1; p++) {
        const station = tt.stationOf[stops[p]];
        if (seen.has(station)) continue;
        seen.add(station);
        (leaving.get(station) ?? leaving.set(station, []).get(station)).push(tt.schedDep(t, p));
      }
    }
    const order = (station) => way.order.get(station) ?? Infinity;
    return inDay([...leaving].sort((a, b) => b[1].length - a[1].length || order(a[0]) - order(b[0]))[0]?.[1] ?? []).map((s) => Math.floor(s / 60));
  }

  /** What leaves of a counted way (waysOf) on a date: by station, the seconds of the service day each of its trips leaves it (the first time, not at its end). */
  wayLeaving(way, date) {
    const tt = this.tt;
    const leaving = new Map();
    for (const t of way.trips) {
      if (!tt.runsOn(t, date)) continue;
      const stops = tt.stopsOf(t);
      const seen = new Set();
      for (let p = 0; p < stops.length - 1; p++) {
        const station = tt.stationOf[stops[p]];
        if (seen.has(station)) continue;
        seen.add(station);
        (leaving.get(station) ?? leaving.set(station, []).get(station)).push(tt.schedDep(t, p));
      }
    }
    return leaving;
  }

  /** The first and last trip of line number `index` on a date, in seconds of its service day, or null. */
  lineSpan(index, date) {
    const tt = this.tt;
    return spanOf(this.waysOf(index).all.filter((t) => tt.runsOn(t, date)).map((t) => tt.schedDep(t, 0)));
  }

  /**
   * The service day a moment belongs to for what runs on it: yesterday's
   * while its last trip, after midnight, is still to leave, else today.
   * @param spanOn (date) => the span of a day (spanOf), or null
   */
  dayOf(now, spanOn) {
    const today = localDate(now);
    const yesterday = addDays(today, -1);
    const span = spanOn(yesterday);
    return span && serviceDayStart(yesterday) + span.last >= now ? yesterday : today;
  }

  /**
   * What the details of line number `index` tell of its timetable at a
   * moment, for each of the two ways its details switch between (waysOf), as
   * a rider takes it one way, at one stop of it: of its service day, how
   * often it runs hour by hour, with its first and last trip there; of the coming WEEK_DAYS
   * days, by their kind as a timetable has them (Monday to Friday, Saturday,
   * Sunday) and apart where their first or last trip differs, what holds on
   * each of those days (daysSaid). And how long the line takes from end to
   * end of its busiest way, its stations and the towns along that.
   * @returns { date, ways: [{ stop, today: { date, first, last, runs } |
   *   null, week: [daysSaid] }], minutes, stops, towns }: `date` the service
   *   day it is, `stop` the name of the stop a way's figures are of; times
   *   in epoch seconds
   */
  line(index, now) {
    const tt = this.tt;
    const date = this.dayOf(now, (day) => this.lineSpan(index, day));
    const ways = this.keep(`facts ${index} ${date}`, () => wordedAlike(this.waysOf(index).counted.map((way) => {
      // All of a way's figures are of one stop, which they name: the one most of its trips of the coming days leave
      // from (of as busy ones the first along the way), where it runs as along most of its way, also while a part of
      // it is closed. Its first and last trip are when they leave there, as a rider there has them.
      const days = this.dates(date, WEEK_DAYS);
      const leaving = new Map(days.map((day) => [day, this.wayLeaving(way, day)]));
      const counts = new Map();
      for (const byStation of leaving.values()) for (const [station, times] of byStation) counts.set(station, (counts.get(station) ?? 0) + times.length);
      const order = (station) => way.order.get(station) ?? Infinity;
      const station = [...counts].sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0]))[0]?.[0] ?? -1;
      const at = (day) => (leaving.get(day) ?? this.wayLeaving(way, day)).get(station) ?? [];
      const base = serviceDayStart(date);
      const times = tt.dateIndex.has(date) ? at(date) : [];
      const span = spanOf(times);
      const today = span ? { date, first: base + span.first, last: base + span.last, runs: runsAt(hourly([inDay(times, span).map((s) => Math.floor(s / 60))]).runs, base) } : null;
      const groups = new Map();
      for (const on of days) {
        const its = spanOf(at(on));
        // (0 for Monday to Friday, 1 for Saturday, 2 for Sunday)
        const key = `${Math.max(0, weekday(on) - 4)} ${its?.first} ${its?.last}`;
        (groups.get(key) ?? groups.set(key, { dates: [], span: its }).get(key)).dates.push(on);
      }
      const week = [...groups.values()].map((group) => this.daysSaid(group.dates, group.span, group.dates.map(at)));
      return { stop: station >= 0 ? tt.stops.name[station] : null, today, week };
    })));
    const { minutes, stops, towns } = this.alongOf(index);
    return { date, ways, minutes, stops, towns };
  }

  /**
   * What holds one way at its stop on each of some days that have the same
   * first and last trip there (`span`, spanOf, null where it does not run;
   * `lists` the seconds its trips leave there, a list for each day): the
   * longest stretch of hours one set of words holds for (stretchOf), else how
   * many trips it makes, the fewest and the most; and how often it runs hour
   * by hour (hourly).
   * @returns { dates, first, last, often: { from, to, …often } | null,
   *   trips: [few, many] | null, runs }: times in epoch seconds of the first
   *   of the days, which say their time of day; first and last null where it
   *   does not run
   */
  daysSaid(dates, span, lists) {
    if (!span) return { dates, first: null, last: null, often: null, trips: null, runs: [] };
    const series = lists.map((list) => inDay(list, span).map((s) => Math.floor(s / 60))).filter((list) => list.length);
    const { hours, runs } = hourly(series);
    const stretch = stretchOf(hours);
    const base = serviceDayStart(dates[0]);
    return {
      dates,
      first: base + span.first,
      last: base + span.last,
      often: stretch && runsAt([stretch], base)[0],
      trips: series.length ? [Math.min(...series.map((list) => list.length)), Math.max(...series.map((list) => list.length))] : null,
      runs: runsAt(runs, base),
    };
  }

  /** What along() says of line number `index`, made once. */
  alongOf(index) {
    return this.keep(`along ${index}`, () => this.along(index));
  }

  /** How long the busiest way of a line takes from its first station to its last (the middle of its trips that do), its stations, and the towns along it. */
  along(index) {
    const tt = this.tt;
    const way = tt.lineWays(index)[0];
    if (!way) return { minutes: null, stops: 0, towns: [] };
    const first = way.list[0];
    const last = way.list.at(-1);
    const takes = [];
    for (const t of this.waysOf(index).counted[0]?.trips ?? []) {
      const stops = tt.stopsOf(t);
      if (tt.stationOf[stops[0]] === first && tt.stationOf[stops.at(-1)] === last) takes.push(tt.schedArr(t, stops.length - 1) - tt.schedDep(t, 0));
    }
    takes.sort((a, b) => a - b);
    const towns = townsOfWay(way.list.map((s) => tt.towns[tt.stops.town[s]]?.name ?? null));
    return { minutes: takes.length ? Math.round(takes[takes.length >> 1] / 60) : null, stops: way.list.length, towns };
  }

  /**
   * What the description of line number `index` says of its working days:
   * of every Monday to Friday of the coming DESCRIBED_DAYS days, those it
   * does not run on; how often it runs in its longest stretch of hours that
   * one set of words holds for on all of them (stretchOf), or else how many
   * trips leave each way, the fewest and the most of a day; the earliest
   * first and the latest last trip of those days, in seconds of a day.
   * @returns { without: [dates], often: { from, to, often } | null, trips: [few, many], first, last } or null where it runs on none of them
   */
  described(index, now) {
    const today = localDate(now);
    return this.keep(`described ${index} ${today}`, () => {
      const working = this.dates(today, DESCRIBED_DAYS, (day) => weekday(day) < 5);
      const runs = working.filter((day) => this.lineSpan(index, day));
      if (!runs.length) return null;
      const ways = this.waysOf(index).counted;
      const series = runs.flatMap((day) => ways.map((way) => this.wayMinutes(way, day))).filter((list) => list.length);
      const span = rangeOf(runs.map((day) => this.lineSpan(index, day)));
      return {
        without: working.filter((day) => !runs.includes(day)),
        often: stretchOf(hourly(series).hours),
        trips: [Math.min(...series.map((list) => list.length)), Math.max(...series.map((list) => list.length))],
        first: span.first,
        last: span.last,
      };
    });
  }

  /**
   * What the details of a stop tell of a moment's service day: its first
   * and last departure, and of each line that leaves it, each way it goes
   * from there as "Alle Linien" names it (Timetable.linesAt: by its next
   * station, those with the same destination one), how often it leaves that
   * way hour by hour and its first and last; the towns its lines go to, the
   * nearest first.
   * @param station the number of the station
   * @returns { date, first, last, lines: Map(line number → Map(destination →
   *   { first, last, runs })), all, towns: [names], more }: `all` how many
   *   lines leave it on any day of the timetable; times in epoch seconds,
   *   first and last null where nothing leaves that day; a line or a way that
   *   nothing leaves by that day is not in `lines`
   */
  stop(station, now) {
    const date = this.dayOf(now, (day) => this.stopDay(station, day).span);
    const { span, lines } = this.stopDay(station, date);
    const base = serviceDayStart(date);
    const shown = new Map();
    for (const [line, ways] of lines) {
      const said = new Map();
      for (const [to, leaves] of ways) {
        const { first, last } = spanOf(leaves);
        said.set(to, { first: base + first, last: base + last, runs: runsAt(hourly([inDay(leaves).map((s) => Math.floor(s / 60))]).runs, base) });
      }
      shown.set(line, said);
    }
    // (one word for each number an hour in all the lines of the stop say, read one below the other: oneWord)
    const days = [...shown.values()].flatMap((said) => [...said.values()]);
    oneWord(days.map(({ runs }) => runs)).forEach((runs, k) => { days[k].runs = runs; });
    const { towns, more } = this.keep(`towns ${station}`, () => this.townsFrom(station));
    return { date, first: span ? base + span.first : null, last: span ? base + span.last : null, lines: shown, all: this.stopDay(station, date).all, towns, more };
  }

  /**
   * What leaves a station on a date: the span of all its departures, and of
   * each line its departures each way, named as linesAt names them: a next
   * station by the destination most of its trips have here, on any day.
   * @returns { span, lines: Map(line number → Map(destination → [seconds of the day])) }, those that leave that day
   */
  stopDay(station, date) {
    return this.keep(`stop ${station} ${date}`, () => {
      const tt = this.tt;
      const all = [];
      const found = new Map(); // line → Map(next station → { to: Map(destination → trips), leaves })
      for (let visit = tt.visitStart[station]; visit < tt.visitStart[station + 1]; visit++) {
        const pattern = tt.visitPattern[visit];
        const p = tt.visitPosition[visit];
        const next = tt.nextStation(pattern, p);
        if (next < 0) continue; // (its end: nothing leaves)
        for (let k = tt.patternFirst[pattern]; k < tt.patternFirst[pattern + 1]; k++) {
          const t = tt.tripsOfPattern[k];
          const ways = found.get(tt.tripLine[t]) ?? found.set(tt.tripLine[t], new Map()).get(tt.tripLine[t]);
          const way = ways.get(tt.stationOf[next]) ?? ways.set(tt.stationOf[next], { to: new Map(), leaves: [] }).get(tt.stationOf[next]);
          const to = tt.headsignAt(t, p);
          way.to.set(to, (way.to.get(to) ?? 0) + 1);
          if (!tt.runsOn(t, date)) continue;
          const leaves = tt.schedDep(t, p);
          all.push(leaves);
          way.leaves.push(leaves);
        }
      }
      const lines = new Map();
      for (const [line, ways] of found) {
        const named = new Map();
        for (const { to, leaves } of ways.values()) {
          if (!leaves.length) continue;
          // (as linesAt names a way: the destination most of its trips have, of as many the first by name)
          const name = [...to].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
          named.set(name, [...(named.get(name) ?? []), ...leaves]);
        }
        if (named.size) lines.set(line, named);
      }
      return { span: spanOf(all), lines, all: found.size };
    });
  }

  /** The towns the lines of a station go to, the nearest first (by their nearest stop the lines call at): NAMED_TOWNS of them, and how many more. */
  townsFrom(station) {
    const tt = this.tt;
    const near = new Map(); // town → metres
    const lat = tt.stops.lat[station];
    const lon = tt.stops.lon[station];
    const patterns = new Set();
    for (let visit = tt.visitStart[station]; visit < tt.visitStart[station + 1]; visit++) patterns.add(tt.visitPattern[visit]);
    for (const pattern of patterns) {
      for (let k = tt.patternStart[pattern]; k < tt.patternStart[pattern + 1]; k++) {
        const s = tt.stationOf[tt.patternStops[k]];
        const town = tt.towns[tt.stops.town[s]]?.name;
        if (!town) continue;
        const metres = Math.hypot((tt.stops.lon[s] - lon) * Math.cos((lat * Math.PI) / 180), tt.stops.lat[s] - lat);
        if (!(near.get(town) <= metres)) near.set(town, metres);
      }
    }
    const towns = [...near].sort((a, b) => a[1] - b[1]).map(([town]) => town);
    return { towns: towns.slice(0, NAMED_TOWNS), more: Math.max(0, towns.length - NAMED_TOWNS) };
  }

  /**
   * Whether anything leaves each station in the coming `days` days from
   * `date` on: for the sitemap, which lists a stop where it does.
   * @returns Uint8Array by station number (as tt.stations), 1 where something does
   */
  leavingWithin(date, days = WEEK_DAYS) {
    const tt = this.tt;
    const indexes = this.dates(date, days).map((day) => tt.dateIndex.get(day)).filter((d) => d !== undefined);
    // (the services that run on any of those days, then the patterns with a trip of one)
    const services = new Uint8Array(tt.serviceOnDate[0]?.length ?? 0);
    for (const d of indexes) tt.serviceOnDate[d].forEach((on, s) => { if (on) services[s] = 1; });
    const patterns = new Uint8Array(tt.patternFirst.length);
    for (let pattern = 0; pattern + 1 < tt.patternFirst.length; pattern++) {
      for (let k = tt.patternFirst[pattern]; k < tt.patternFirst[pattern + 1]; k++) if (services[tt.tripService[tt.tripsOfPattern[k]]]) { patterns[pattern] = 1; break; }
    }
    return Uint8Array.from(tt.stations, (station) => {
      const s = tt.stopIndex.get(station.id);
      for (let visit = tt.visitStart[s]; visit < tt.visitStart[s + 1]; visit++) {
        const pattern = tt.visitPattern[visit];
        if (patterns[pattern] && tt.nextStation(pattern, tt.visitPosition[visit]) >= 0) return 1;
      }
      return 0;
    });
  }
}

/** The facts of a timetable (Facts), one for each. */
const factsOf = new WeakMap();
export function facts(timetable) {
  if (!factsOf.has(timetable)) factsOf.set(timetable, new Facts(timetable));
  return factsOf.get(timetable);
}
