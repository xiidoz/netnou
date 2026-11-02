// The addresses of stops, lines (#37) and trips (#178), written and read by
// public/address.js, as the timetable has them now. What an address names
// is found again in a later timetable by what stays the same in it, which
// the ids of the feed do not: a stop by its name and its town, and by its
// place where stops are named alike, a line by its operator, its kind and
// its name, and by its place where lines of that name are in places apart,
// a trip by its line and where and when it starts.

import { linePath, slug, stopPath, stopPathAt, tripPath } from '../../public/address.js';
import { t } from '../../public/i18n.js';
import { townToShow } from '../../public/stops.js';
import { addDays, localClock, localDate, serviceDayStart, timeZone } from './time.js';
import { MODES } from './timetable.js';

// A stop of the name of an address with a place is taken up to this far
// from it. Of the stations of January, October had one of the same name at
// the very same place in 47.6 % of the cases, within 10 m in 80 %, within
// 1 km in 94.1 % (measured for #105). The place in an address is one to two
// decimals since #288, about 1 km, and to four before.
const SAME_NAME_M = 1000;
// Else a stop of any name this near the place: renamed, 1.6 % of them.
const RENAMED_M = 10;
// The lines of a stop that its description names, the busiest first.
const NAMED_LINES = 6;
// (stations are kept in cells of this many degrees, to find those near a place)
const CELL = 0.001;

const M_PER_DEG = 111_320;
const metres = (lat1, lon1, lat2, lon2) => Math.hypot((lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180), lat2 - lat1) * M_PER_DEG;
// (a cell as one number: its column is less than 2 ** 19 either way)
const cellAt = (row, column) => row * 2 ** 20 + column;
const cellOf = (lat, lon) => cellAt(Math.floor(lat / CELL), Math.floor(lon / CELL));
// (line names as people count them: 5, 7, 8, 11 and U1, U2)
const byName = new Intl.Collator('de', { numeric: true }).compare;

/** The first place in `order` whose value, as `value` has it, is not below `wanted`: found by halving. */
function firstAt(order, value, wanted) {
  let low = 0;
  let high = order.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (value(order[middle]) < wanted) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Those in `order` whose value, as `value` has it, is `wanted`: [numbers], in that order. */
function allAt(order, value, wanted) {
  const found = [];
  for (let k = firstAt(order, value, wanted); k < order.length && value(order[k]) === wanted; k++) found.push(order[k]);
  return found;
}

/** Numbers 0 to values.length - 1 in the order of their values, and of the numbers where those are the same. */
const orderOf = (values) => Int32Array.from(values.keys()).sort((a, b) => (values[a] < values[b] ? -1 : values[a] > values[b] ? 1 : a - b));

/** A place in an address: latitude and longitude to that many decimals. */
const placeOf = ({ lat, lon }, digits) => `${lat.toFixed(digits)},${lon.toFixed(digits)}`;

export class Addresses {
  /** @param timetable a Timetable: its stations, lines and trips */
  constructor(timetable) {
    this.timetable = timetable;
    // The lines of each address without a place, the busiest first (as in the
    // list of the search: a line without a stop in the area is not there).
    // Those of a name in places apart (#152), or of names an address writes
    // alike, have the middle of their stations in theirs, to two decimals
    // (about 1 km), or to four where two would be the same.
    this.lines = new Map();
    timetable.lines.forEach((line, i) => {
      if (line.stops > 0) this.lines.set(linePath(line), [...(this.lines.get(linePath(line)) ?? []), i]);
    });
    this.places = new Map(); // line number → the place in its address
    for (const numbers of this.lines.values()) {
      numbers.sort((a, b) => timetable.lines[b].trips - timetable.lines[a].trips || a - b);
      if (numbers.length < 2) continue;
      const written = (digits) => numbers.map((i) => timetable.lines[i].place.map((value) => value.toFixed(digits)).join(','));
      const places = new Set(written(2)).size === numbers.length ? written(2) : written(4);
      numbers.forEach((i, k) => this.places.set(i, places[k]));
    }
  }

  /** Station number i as its address names it: { name, town }, town null where none is known. */
  stationNamed(i) {
    const { stations, towns, stationTown } = this.timetable;
    return { name: stations[i].name, town: towns?.[stationTown?.[i]]?.name ?? null };
  }

  /** The name in the address of station number i: its own, with its town where it does not say it. */
  keyOf(i) {
    return stopPath(this.stationNamed(i)).slice('stop/'.length);
  }

  /**
   * Of stations named alike the one whose address is the name alone: the
   * busiest, of as busy ones the southernmost (#288). The others are told
   * apart by their places.
   */
  firstOf(numbers) {
    const { stations, stationService } = this.timetable;
    const service = (i) => stationService?.[i] ?? 0;
    const before = (a, b) => service(a) > service(b) || (service(a) === service(b) && (stations[a].lat < stations[b].lat || (stations[a].lat === stations[b].lat && stations[a].lon < stations[b].lon)));
    return numbers.reduce((first, i) => (before(i, first) ? i : first));
  }

  /**
   * The stations in the order of the names in their addresses (keyed), and
   * of the names that stations share, which of them has it alone (alike), and
   * for each of the others to how many decimals its place is written (digits,
   * else 0): 0.5 % of the stations of all of Germany are such others. Lists
   * of numbers, 1.5 MB for the quarter of a million of all of Germany, where
   * a map of the names would take more than 100. Made when a stop is first
   * looked for or written, in a second for all of Germany: the lines need
   * none of it.
   */
  indexStations() {
    if (this.keyed) return;
    const { stations } = this.timetable;
    const keys = stations.map((_, i) => this.keyOf(i));
    this.keyed = orderOf(keys);
    this.alike = new Map(); // a name in addresses → the station that has it alone
    this.digits = new Uint8Array(stations.length);
    for (let k = 0; k < this.keyed.length; ) {
      let end = k + 1;
      while (end < this.keyed.length && keys[this.keyed[end]] === keys[this.keyed[k]]) end++;
      if (end - k > 1) {
        const numbers = [...this.keyed.subarray(k, end)];
        const plain = this.firstOf(numbers);
        const others = numbers.filter((i) => i !== plain);
        let digits = 2;
        while (digits < 5 && new Set(others.map((i) => placeOf(stations[i], digits))).size < others.length) digits++;
        for (const i of others) this.digits[i] = digits;
        this.alike.set(keys[this.keyed[k]], plain);
      }
      k = end;
    }
  }

  /**
   * The stations in the order of their own names (named, as addresses had
   * them before #288), and in that of their cells (placed, with the cells of
   * them in that order): lists of numbers, 4 MB for all of Germany. Made when
   * an address is first looked for that is no stop's own address now, in
   * half a second.
   */
  indexNames() {
    if (this.named) return;
    const { stations } = this.timetable;
    this.named = orderOf(stations.map((station) => slug(station.name)));
    const cells = stations.map((station) => cellOf(station.lat, station.lon));
    this.placed = Int32Array.from(cells.keys()).sort((a, b) => cells[a] - cells[b] || a - b);
    this.cells = Float64Array.from(this.placed, (i) => cells[i]);
  }

  /**
   * The station that an address names, as its number in timetable.stations,
   * or -1: the one whose address it is, or was before #288 (its name and its
   * place to four decimals, stopPathAt). Else of those whose addresses have
   * its name, where it has a place, the nearest up to SAME_NAME_M away, and
   * where it has none, the one whose address is the name alone; else the same
   * of those of that name, as addresses had it before. Else the nearest of
   * any name up to RENAMED_M away from its place. (Of two of a name either
   * side of where the places of their addresses round apart, the place in
   * the one's may be nearer the other.)
   * @param asked a stop as parseAddress (public/address.js) has it
   * @param path the address as asked for, to know it where it is a stop's own
   */
  station({ name, lat, lon }, path = null) {
    this.indexStations();
    const { stations } = this.timetable;
    const placed = lat !== undefined;
    const nearestOf = (numbers, within) => numbers.reduce(([found, best], i) => {
      const away = metres(lat, lon, stations[i].lat, stations[i].lon);
      return away <= best ? [i, away] : [found, best];
    }, [-1, within])[0];
    const keyed = allAt(this.keyed, (i) => this.keyOf(i), name);
    const own = keyed.find((i) => this.stationPath(i) === path);
    if (own !== undefined) return own;
    this.indexNames();
    const named = allAt(this.named, (i) => slug(stations[i].name), name);
    const was = named.find((i) => stopPathAt(stations[i].name, stations[i].lat, stations[i].lon) === path);
    if (was !== undefined) return was;
    if (keyed.length) {
      const found = placed ? nearestOf(keyed, SAME_NAME_M) : (this.alike.get(name) ?? keyed[0]);
      if (found >= 0) return found;
    }
    if (named.length) {
      const found = placed ? nearestOf(named, SAME_NAME_M) : this.firstOf(named);
      if (found >= 0) return found;
    }
    if (!placed) return -1;
    let found = -1;
    let nearest = RENAMED_M;
    const [row, column] = [Math.floor(lat / CELL), Math.floor(lon / CELL)];
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const cell = cellAt(row + dLat, column + dLon);
        for (let k = firstAt(this.cells, (key) => key, cell); this.cells[k] === cell; k++) {
          const i = this.placed[k];
          const away = metres(lat, lon, stations[i].lat, stations[i].lon);
          if (away <= nearest) [found, nearest] = [i, away];
        }
      }
    }
    return found;
  }

  /**
   * The line that an address names, as its number in timetable.lines, or -1:
   * of those of its name in places apart, the one whose address it is, else
   * the one nearest its place; without a place in it, the busiest.
   * @param asked a line as parseAddress (public/address.js) has it
   */
  line({ agency, mode, name, lat, lon }) {
    const numbers = this.lines.get(`line/${agency}/${mode}/${name}`);
    if (!numbers) return -1;
    if (lat === undefined || numbers.length === 1) return numbers[0];
    const own = numbers.find((i) => {
      const place = this.places.get(i);
      const digits = place.split(',')[0].split('.')[1].length;
      return place === `${lat.toFixed(digits)},${lon.toFixed(digits)}`;
    });
    const away = (i) => metres(lat, lon, ...this.timetable.lines[i].place);
    return own ?? numbers.reduce((best, i) => (away(i) < away(best) ? i : best));
  }

  /**
   * The trips of each line, by its number (lineTrips from lineTripStart[i]
   * to lineTripStart[i + 1]). Made when a trip is first looked for: 7 MB in
   * all of Germany.
   */
  indexTrips() {
    if (this.lineTrips) return;
    const { tripLine, tripCount, lines } = this.timetable;
    const start = new Int32Array(lines.length + 1);
    for (let k = 0; k < tripCount; k++) start[tripLine[k] + 1]++;
    for (let i = 0; i < lines.length; i++) start[i + 1] += start[i];
    const next = start.slice();
    const trips = new Int32Array(tripCount);
    for (let k = 0; k < tripCount; k++) trips[next[tripLine[k]]++] = k;
    [this.lineTripStart, this.lineTrips] = [start, trips];
  }

  /**
   * The run of a trip that an address names, { trip, date } with its service
   * day (yyyymmdd), or null: of the trips of its line that leave their first
   * stop at its day and time, the one from the stop of its name; else, where
   * only one leaves then, that one (its first stop has another name now).
   * @param asked a trip as parseAddress (public/address.js) has it
   */
  trip({ agency, mode, name, day, time, from }) {
    const numbers = this.lines.get(`line/${agency}/${mode}/${name}`);
    if (!numbers) return null;
    this.indexTrips();
    const tt = this.timetable;
    const calendar = day.replaceAll('-', '');
    // (about when it leaves, to look at the clock of those only: an hour either way, for the change of the clocks)
    const about = serviceDayStart(calendar) + Number(time.slice(0, 2)) * 3600 + Number(time.slice(2)) * 60;
    const found = [];
    // (a trip after midnight may be one of the service day before)
    for (const date of [calendar, addDays(calendar, -1)]) {
      const base = serviceDayStart(date);
      for (const line of numbers) {
        for (let k = this.lineTripStart[line]; k < this.lineTripStart[line + 1]; k++) {
          const trip = this.lineTrips[k];
          const leaves = base + tt.schedDep(trip, 0);
          if (Math.abs(leaves - about) > 3600 || localDate(leaves) !== calendar || localClock(leaves) !== time || !tt.runsOn(trip, date)) continue;
          found.push({ trip, date, from: slug(tt.stops.name[tt.stopsOf(trip)[0]]) });
        }
      }
    }
    const run = found.find((one) => one.from === from) ?? (found.length === 1 ? found[0] : null);
    return run && { trip: run.trip, date: run.date };
  }

  /** The address of trip number `trip` on its service day `date` (yyyymmdd). */
  tripPath(trip, date) {
    const tt = this.timetable;
    const route = tt.tripRoute[trip];
    const leaves = serviceDayStart(date) + tt.schedDep(trip, 0);
    const day = localDate(leaves);
    const line = { agency: tt.routes.agency[route], mode: tt.routeModes[route], name: tt.lineName(route) };
    return tripPath(line, `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`, localClock(leaves), tt.stops.name[tt.stopsOf(trip)[0]]);
  }

  /** The address of station number i: with its place where it is not the first of stations named alike. */
  stationPath(i) {
    this.indexStations();
    const digits = this.digits[i];
    return stopPath(this.stationNamed(i), digits ? placeOf(this.timetable.stations[i], digits) : null);
  }

  /** The address of the station that is stop number s of the timetable (Timetable.stops), as answers name stops. */
  stopAddress(s) {
    if (!this.stationOfStop) {
      const { stations, stopIndex, stops } = this.timetable;
      this.stationOfStop = new Int32Array(stops.name.length).fill(-1);
      stations.forEach((station, i) => {
        this.stationOfStop[stopIndex.get(station.id)] = i;
      });
    }
    const i = this.stationOfStop[s];
    if (i >= 0) return this.stationPath(i);
    // (one beyond the area, as a line that leaves it has: by its name, as the page of a stop would be named)
    const { stops, towns } = this.timetable;
    return stopPath({ name: stops.name[s], town: towns?.[stops.town[s]]?.name ?? null });
  }

  /** The address of line number i. */
  linePath(i) {
    return linePath(this.timetable.lines[i], this.places.get(i));
  }

  /** The addresses of all stations that trips call at and of all lines, for the sitemap. */
  paths() {
    const { stations, stationService } = this.timetable;
    return [...stations.flatMap((_, i) => (stationService[i] > 0 ? [this.stationPath(i)] : [])), ...[...this.lines.values()].flat().map((i) => this.linePath(i))];
  }

  /** The lines that call at station number i, the busiest first: [{ name, mode, agency, trips }]. */
  linesAt(i) {
    const tt = this.timetable;
    const station = tt.stopIndex.get(tt.stations[i].id);
    const trips = new Map(); // by the number of the line
    for (let visit = tt.visitStart[station]; visit < tt.visitStart[station + 1]; visit++) {
      const pattern = tt.visitPattern[visit];
      for (let k = tt.patternFirst[pattern]; k < tt.patternFirst[pattern + 1]; k++) {
        const line = tt.tripLine[tt.tripsOfPattern[k]];
        trips.set(line, (trips.get(line) ?? 0) + 1);
      }
    }
    return [...trips].sort((a, b) => b[1] - a[1]).map(([line, count]) => ({ ...tt.lines[line], trips: count }));
  }

  /**
   * What the page of station number i says of it: its title and its
   * description, in a language.
   * @param texts the texts of that language (a module of public/locales)
   */
  stationWords(i, language, texts) {
    const stop = this.timetable.stations[i].name;
    // (its town, where its name does not say it, #254: "in Erlangen" in the description)
    const town = townToShow(stop, this.timetable.towns[this.timetable.stationTown[i]]?.name ?? null);
    const said = town ? t('address.stopInTown', { stop, town }, texts) : stop;
    const lines = this.linesAt(i);
    const named = lines.slice(0, NAMED_LINES);
    // the lines in groups of their kind, the kinds in the order in which their busiest line comes
    const groups = new Map();
    for (const { name, mode } of named) groups.set(mode, [...(groups.get(mode) ?? []), name]);
    const parts = [...groups].map(([mode, names]) => labelled(names.sort(byName).join(', '), names[0], mode, texts));
    // then the other kinds that call there, as the chips have them in order
    const others = MODES.filter((mode) => mode !== 'other' && !groups.has(mode) && lines.some((line) => line.mode === mode));
    const words = others.length ? t('address.more', { lines: parts.join(', '), kinds: listed(others.map((mode) => t(`address.kind.${mode}`, {}, texts)), language) }, texts) : parts.join(', ');
    return {
      title: stopTitle(stop, texts, town),
      description: lines.length ? t('address.stopDescription', { stop: said, lines: words }, texts) : t('address.stopDescriptionNone', { stop: said }, texts),
      heading: stop,
      sub: t('departures.title', {}, texts),
    };
  }

  /** What the page of line number i says of it, in a language (see stationWords). */
  lineWords(i, language, texts) {
    const { name, mode, agency, headsigns } = this.timetable.lines[i];
    const line = labelled(name, name, mode, texts);
    // (where it goes most of the time, both ways)
    const route = [...headsigns].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([headsign]) => headsign).join(' – ');
    return {
      title: firstUp(t('address.lineTitle', { line, route }, texts).replace(/\s+/g, ' ')),
      description: firstUp(t('address.lineDescription', { line, agency }, texts)),
      heading: line,
      sub: agency,
    };
  }

  /**
   * What the page of a trip says of it, in a language (see stationWords).
   * It lives for its day: not for search engines (unlisted).
   */
  tripWords(trip, date, language, texts) {
    const tt = this.timetable;
    const route = tt.tripRoute[trip];
    const name = tt.lineName(route);
    const line = labelled(name, name, tt.routeModes[route], texts);
    const to = tt.headsign(trip);
    const leaves = (serviceDayStart(date) + tt.schedDep(trip, 0)) * 1000;
    const time = new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone: timeZone() }).format(leaves);
    const day = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', timeZone: timeZone() }).format(leaves);
    const from = tt.stops.name[tt.stopsOf(trip)[0]];
    return {
      title: firstUp(t('address.tripTitle', { line, to }, texts)),
      description: firstUp(t('address.tripDescription', { line, to, from, time, day }, texts)),
      heading: line,
      sub: t('line.to', { destination: to }, texts),
      unlisted: true,
    };
  }
}

/** A name, or a list of names of one kind: with the kind before it where it is a number, as "Tram 5" and "U1". */
const labelled = (words, first, mode, texts) => (/^\d/.test(first) ? `${t(`address.kind.${mode}`, {}, texts)} ${words}` : words);

/** Words in a list as the language writes one: "a, b und c". */
const listed = (words, language) => new Intl.ListFormat(language, { type: 'conjunction' }).format(words);

const firstUp = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The title of a stop of that name, as its page has it (stationWords), in the
 * language of the texts: with its town where the name does not say it (#254).
 * @param town that town (townToShow in public/stops.js), else null
 */
export const stopTitle = (stop, texts, town = null) => t('address.stopTitle', { stop: town ? t('address.stopWithTown', { stop, town }, texts) : stop }, texts);
