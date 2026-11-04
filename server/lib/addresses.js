// The addresses of stops, lines (#37) and trips (#178), written and read by
// public/address.js, as the timetable has them now. What an address names
// is found again in a later timetable by what stays the same in it, which
// the ids of the feed do not: a stop by its name and its town, and by a
// number where stops of the name are more than one in a town, a line by its
// operator, its kind and its name, and by its place where lines of that
// name are in places apart, a trip by its line and where and when it starts.

import fs from 'node:fs';
import { linePath, slug, stopName, stopPath, stopPathAt, tripPath } from '../../public/address.js';
import { t } from '../../public/i18n.js';
import { townToShow } from '../../public/stops.js';
import { addDays, localClock, localDate, serviceDayStart, timeZone } from './time.js';
import { MODES } from './timetable.js';

// A stop of the name of an address with a place, as addresses were written
// before #288, is taken up to this far from it. Of the stations of January,
// October had one of the same name at the very same place in 47.6 % of the
// cases, within 10 m in 80 %, within 1 km in 94.1 % (measured for #105).
const SAME_NAME_M = 1000;
// Stops of one name in one town are told apart by numbers in their
// addresses, /2 and on (#288): those further apart than the platforms of one
// stop (#299). A stop keeps its number from one timetable to the next where
// one of the name stands within this far of where it stood.
const KEPT_NUMBER_M = 300;
// (what is kept of the numbers, stop-numbers.json: raised when that changes)
const NUMBERS_VERSION = 1;
// Else a stop of any name this near the place: renamed, 1.6 % of them.
const RENAMED_M = 10;
// The kinds of transport that run on rails, among which a line's kind may
// change from one feed to the next (#302).
const RAILS = ['subway', 'tram', 'suburban', 'regional', 'longdistance', 'cable'];
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

const round5 = (value) => Math.round(value * 1e5) / 1e5;

/**
 * The numbers of the stops of a name in a town (#288), kept from one
 * timetable to the next in the data directory, as stop-numbers.json:
 * { version, names: { <name in the address>: [[latitude, longitude,
 * number], …] } }. Without the file (a new instance, or one whose data was
 * deleted) they are given anew, in the order of their places, as they were
 * where no stop of the name has come or gone. Without a path they are kept
 * in memory alone.
 */
export class KeptNumbers {
  constructor(file = null) {
    this.file = file;
    this.names = null;
  }

  /** What is kept: { <name>: [[latitude, longitude, number], …] }. */
  read() {
    if (this.names) return this.names;
    this.names = {};
    if (!this.file) return this.names;
    try {
      const kept = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (kept?.version !== NUMBERS_VERSION || typeof kept.names !== 'object' || kept.names === null) return this.names;
      for (const [name, entries] of Object.entries(kept.names)) {
        const valid = Array.isArray(entries) ? entries.filter((entry) => Array.isArray(entry) && entry.length === 3 && entry.every(Number.isFinite) && Number.isInteger(entry[2]) && entry[2] > 0) : [];
        if (valid.length) this.names[name] = valid;
      }
    } catch {
      // (none yet, or not to be read: given anew)
    }
    return this.names;
  }

  /** Keeps these instead; a file that cannot be written leaves them in memory. */
  write(names) {
    this.names = names;
    if (!this.file) return;
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: NUMBERS_VERSION, names }));
      fs.renameSync(tmp, this.file);
    } catch {
      // (the next timetable tries again)
    }
  }
}

export class Addresses {
  /**
   * @param timetable a Timetable: its stations, lines and trips
   * @param kept the numbers of stops kept from the timetable before (KeptNumbers)
   * @param before the Addresses of the timetable before, where the server has
   *   it still: of a name that more stops have now, the one that had it alone
   *   keeps it. Let go of once the stations are indexed.
   */
  constructor(timetable, kept = new KeptNumbers(), before = null) {
    this.timetable = timetable;
    this.kept = kept;
    this.before = before;
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

  /** The name of station number i in addresses: its own, with its town where it does not say it (stopName). */
  keyOf(i) {
    return stopName(this.stationNamed(i));
  }

  /** Of stations named alike the busiest, of as busy ones the southernmost. */
  firstOf(numbers) {
    const { stations, stationService } = this.timetable;
    const service = (i) => stationService?.[i] ?? 0;
    const before = (a, b) => service(a) > service(b) || (service(a) === service(b) && (stations[a].lat < stations[b].lat || (stations[a].lat === stations[b].lat && stations[a].lon < stations[b].lon)));
    return numbers.reduce((first, i) => (before(i, first) ? i : first));
  }

  /**
   * The stations in the order of the names in their addresses (keyed), and
   * where stations have one name: those of a town other than that of the
   * busiest of them with that town after the name (renamed, and the other
   * way round byName), with its district where towns of that name are
   * among them; and the stations of one name in a town numbered (numbers,
   * 0 for none), as they were in the timetable before (KeptNumbers), else
   * along the line on which they lie apart. In all of Germany a few hundred
   * stations have their town after their name or a number. Lists of numbers,
   * 1.5 MB for the quarter of a million of all of Germany, where a map of
   * the names would take more than 100. Made when a stop is first looked for
   * or written, in a second for all of Germany: the lines need none of it.
   */
  indexStations() {
    if (this.keyed) return;
    const { stations, towns, stationTown } = this.timetable;
    const keys = stations.map((_, i) => this.keyOf(i));
    this.keyed = orderOf(keys);
    const groups = []; // the stations of each name that more than one have
    for (let k = 0; k < this.keyed.length; ) {
      let end = k + 1;
      while (end < this.keyed.length && keys[this.keyed[end]] === keys[this.keyed[k]]) end++;
      if (end - k > 1) groups.push([...this.keyed.subarray(k, end)]);
      k = end;
    }
    // In several towns: the name with the town after it, or its district where towns of one name are among them.
    const townOf = (i) => stationTown?.[i] ?? -1;
    this.renamed = new Map();
    this.byName = new Map();
    for (const numbers of groups) {
      const home = townOf(this.firstOf(numbers));
      const others = [...new Set(numbers.map(townOf))].filter((town) => town >= 0 && town !== home);
      if (!others.length) continue;
      const shared = (town) => [home, ...others].some((other) => other >= 0 && other !== town && towns[other].name === towns[town].name);
      for (const i of numbers) {
        const town = townOf(i);
        if (town < 0 || town === home) continue;
        const name = `${keys[i]}-${slug(shared(town) && towns[town].district ? towns[town].district : towns[town].name)}`;
        this.renamed.set(i, name);
        this.byName.set(name, [...(this.byName.get(name) ?? []), i]);
      }
    }
    // Of one name in a town: numbered, also where a name had several stops before.
    const nameOf = (i) => this.renamed.get(i) ?? keys[i];
    const plain = (name) => allAt(this.keyed, (i) => keys[i], name).filter((i) => !this.renamed.has(i));
    const members = new Map();
    for (const numbers of groups) for (const i of numbers) members.set(nameOf(i), [...(members.get(nameOf(i)) ?? []), i]);
    const kept = this.kept.read();
    for (const name of [...this.byName.keys(), ...Object.keys(kept)]) {
      const all = [...new Set([...(members.get(name) ?? []), ...plain(name), ...(this.byName.get(name) ?? [])])];
      if (all.length) members.set(name, all);
    }
    this.numbers = new Uint16Array(stations.length);
    const next = {};
    for (const [name, list] of members) {
      const numbered = this.numbered(list, kept[name] ?? [], name);
      if (!numbered) continue;
      for (const [i, number] of numbered.numbers) this.numbers[i] = number;
      next[name] = numbered.entries;
    }
    for (const [name, entries] of Object.entries(kept)) if (!(name in next)) next[name] = entries;
    if (JSON.stringify(next) !== JSON.stringify(kept)) this.kept.write(next);
    this.before = null;
  }

  /** The stations whose addresses have that name: of its own, and with a town after it (renamed). */
  withName(name) {
    this.indexStations();
    return [...allAt(this.keyed, (i) => this.keyOf(i), name).filter((i) => !this.renamed.has(i)), ...(this.byName.get(name) ?? [])];
  }

  /**
   * Of these stations, the one that stands within KEPT_NUMBER_M of the stop
   * that had that name alone in the timetable before (before), the nearest;
   * undefined where none does, or the timetable before is not known.
   */
  hadAlone(list, name) {
    if (!this.before) return undefined;
    const { stations } = this.timetable;
    const old = this.before.timetable.stations;
    const alone = this.before.withName(name).filter((j) => !this.before.numbers[j]);
    let found;
    let nearest = KEPT_NUMBER_M;
    for (const i of list) {
      for (const j of alone) {
        const away = metres(stations[i].lat, stations[i].lon, old[j].lat, old[j].lon);
        if (away <= nearest) [found, nearest] = [i, away];
      }
    }
    return found;
  }

  /**
   * The numbers of the stations of one name in a town: each that stands
   * within KEPT_NUMBER_M of where one stood in the timetable before has its
   * number, nearest first; the others have numbers that none of the name had,
   * along the line on which they lie apart (from the south or from the west):
   * so none takes the number of another, and a stop that is gone gets its
   * own again when it comes back. Where none was kept, the busiest has the
   * name alone: it is as a rule the stop that had it, alone of its name,
   * before. Null for a stop alone of its name, which has none.
   * @param list the station numbers
   * @param before [[latitude, longitude, number], …] as KeptNumbers has them
   * @param name the name in their addresses
   * @returns { numbers: Map station → number, entries: what is kept now }
   */
  numbered(list, before, name) {
    if (list.length < 2 && !before.length) return null;
    const { stations } = this.timetable;
    const pairs = [];
    for (const i of list) {
      before.forEach(([lat, lon], e) => {
        const away = metres(stations[i].lat, stations[i].lon, lat, lon);
        if (away <= KEPT_NUMBER_M) pairs.push([away, i, e]);
      });
    }
    pairs.sort((a, b) => a[0] - b[0]);
    const numbers = new Map();
    const used = new Set();
    for (const [, i, e] of pairs) {
      if (numbers.has(i) || used.has(e)) continue;
      numbers.set(i, before[e][2]);
      used.add(e);
    }
    let top = Math.max(0, ...before.map((entry) => entry[2]));
    // (numbered for the first time, the one that had the name alone before keeps it, where that is known, else the
    // busiest: as a rule that one)
    const fresh = list.filter((i) => !numbers.has(i));
    const first = before.length ? [] : [this.hadAlone(fresh, name) ?? this.firstOf(fresh)];
    for (const i of [...first, ...this.alongPlaces(fresh.filter((i) => !first.includes(i)))]) numbers.set(i, ++top);
    const entries = [...before.filter((_, e) => !used.has(e)), ...[...numbers].map(([i, number]) => [round5(stations[i].lat), round5(stations[i].lon), number])];
    return { numbers, entries: entries.sort((a, b) => a[2] - b[2]) };
  }

  /** Stations in the order of their places along the line on which they lie apart: from the south, or from the west. */
  alongPlaces(list) {
    const { stations } = this.timetable;
    if (list.length < 2) return list;
    const spread = (values) => Math.max(...values) - Math.min(...values);
    const northSouth = spread(list.map((i) => stations[i].lat));
    const eastWest = spread(list.map((i) => stations[i].lon)) * Math.cos((stations[list[0]].lat * Math.PI) / 180);
    const [first, second] = northSouth >= eastWest ? ['lat', 'lon'] : ['lon', 'lat'];
    return [...list].sort((a, b) => stations[a][first] - stations[b][first] || stations[a][second] - stations[b][second] || a - b);
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
   * its name, without a place in it the one of the lowest number (the name
   * alone where it has one), with a place the nearest up to SAME_NAME_M away;
   * else the same of those of that name, as addresses had it before, the
   * busiest where it has no place. Else the nearest of any name up to
   * RENAMED_M away from its place. (Of two of a name either side of where
   * the places of their addresses round apart, the place in the one's may be
   * nearer the other.)
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
    const keyed = this.withName(name);
    const own = keyed.find((i) => this.stationPath(i) === path);
    if (own !== undefined) return own;
    if (keyed.length && !placed) return keyed.reduce((lowest, i) => ((this.numbers[i] || 1) < (this.numbers[lowest] || 1) ? i : lowest));
    this.indexNames();
    const named = allAt(this.named, (i) => slug(stations[i].name), name);
    const was = named.find((i) => stopPathAt(stations[i].name, stations[i].lat, stations[i].lon) === path);
    if (was !== undefined) return was;
    if (keyed.length) {
      const found = nearestOf(keyed, SAME_NAME_M);
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
    let numbers = this.lines.get(`line/${agency}/${mode}/${name}`);
    // (a line whose kind has changed, as a feed gives some lines another
    // route type from one version to the next, #302: the line of that
    // operator and name of another kind on rails, where the address is of
    // one on rails and there is one alone, whose address the page is then
    // sent on to)
    if (!numbers) {
      const family = (kind) => (RAILS.includes(kind) ? 'rails' : kind);
      const others = MODES.filter((kind) => kind !== mode && family(kind) === family(mode) && this.lines.has(`line/${agency}/${kind}/${name}`));
      if (others.length !== 1) return -1;
      numbers = this.lines.get(`line/${agency}/${others[0]}/${name}`);
    }
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

  /** The address of station number i: its name, with its town or its number where it needs them. */
  stationPath(i) {
    this.indexStations();
    return stopPath(this.renamed.get(i) ?? this.keyOf(i), this.numbers[i] || 1);
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
    return stopPath(stopName({ name: stops.name[s], town: towns?.[stops.town[s]]?.name ?? null }));
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
