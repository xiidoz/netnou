// The addresses of stops and lines (#37, written and read by
// public/address.js) as the timetable has them now. What an address names
// is found again in a later timetable by what stays the same in it, which
// the ids of the feed do not: a stop by its name and its place, a line by
// its operator, its kind and its name.

import { linePath, slug, stopPath } from '../../public/address.js';
import { t } from '../../public/i18n.js';
import { MODES } from './timetable.js';

// A stop of the name of an address is taken up to this far from its place.
// Of the stations of January, October had one of the same name at the very
// same place in 47.6 % of the cases, within 10 m in 80 %, within 1 km in
// 94.1 % (measured for #105).
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

export class Addresses {
  /** @param timetable a Timetable: its stations, lines and trips */
  constructor(timetable) {
    this.timetable = timetable;
    const { stations } = timetable;
    // The stations in the order of the names in their addresses (named), and
    // in that of their cells (placed, with the cells of them in that order):
    // lists of numbers, 4 MB for the quarter of a million of all of Germany,
    // where maps of their names and cells would take more than 100.
    const names = stations.map((station) => slug(station.name));
    this.named = Int32Array.from(names.keys()).sort((a, b) => (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : a - b));
    const cells = stations.map((station) => cellOf(station.lat, station.lon));
    this.placed = Int32Array.from(cells.keys()).sort((a, b) => cells[a] - cells[b] || a - b);
    this.cells = Float64Array.from(this.placed, (i) => cells[i]);
    // (as in the list of the search: a line without a stop in the area is not there; of two with the same address the first)
    this.lines = new Map();
    timetable.lines.forEach((line, i) => {
      const path = linePath(line);
      if (line.stops > 0 && !this.lines.has(path)) this.lines.set(path, i);
    });
  }

  /**
   * The station that an address names, as its number in timetable.stations,
   * or -1: the one whose address it is; else the one of its name nearest its
   * place, up to SAME_NAME_M away; else the nearest of any name up to
   * RENAMED_M away. (Of two of a name either side of where the places of
   * their addresses round apart, the place in the one's may be nearer the
   * other.)
   * @param asked a stop as parseAddress (public/address.js) has it
   */
  station({ name, lat, lon }) {
    const { stations } = this.timetable;
    const nameOf = (i) => slug(stations[i].name);
    const path = stopPath(name, lat, lon);
    let found = -1;
    let nearest = SAME_NAME_M;
    for (let k = firstAt(this.named, nameOf, name); k < this.named.length && nameOf(this.named[k]) === name; k++) {
      const i = this.named[k];
      const away = this.stationPath(i) === path ? 0 : metres(lat, lon, stations[i].lat, stations[i].lon);
      if (away <= nearest) [found, nearest] = [i, away];
    }
    if (found >= 0) return found;
    nearest = RENAMED_M;
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

  /** The line that an address names, as its number in timetable.lines, or -1. */
  line({ agency, mode, name }) {
    return this.lines.get(`line/${agency}/${mode}/${name}`) ?? -1;
  }

  /** The address of station number i. */
  stationPath(i) {
    const { name, lat, lon } = this.timetable.stations[i];
    return stopPath(name, lat, lon);
  }

  /** The address of line number i. */
  linePath(i) {
    return linePath(this.timetable.lines[i]);
  }

  /** The addresses of all stations that trips call at and of all lines, for the sitemap. */
  paths() {
    const { stations, stationService } = this.timetable;
    return [...stations.flatMap((_, i) => (stationService[i] > 0 ? [this.stationPath(i)] : [])), ...this.lines.keys()];
  }

  /** The lines that call at station number i, the busiest first: [{ name, mode, agency, trips }]. */
  linesAt(i) {
    const tt = this.timetable;
    const station = tt.stopIndex.get(tt.stations[i].id);
    const trips = new Map(); // by the number of the line
    for (let visit = tt.visitStart[station]; visit < tt.visitStart[station + 1]; visit++) {
      const pattern = tt.visitPattern[visit];
      for (let k = tt.patternFirst[pattern]; k < tt.patternFirst[pattern + 1]; k++) {
        const line = tt.lineOf[tt.tripRoute[tt.tripsOfPattern[k]]];
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
      title: t('address.stopTitle', { stop }, texts),
      description: lines.length ? t('address.stopDescription', { stop, lines: words }, texts) : t('address.stopDescriptionNone', { stop }, texts),
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
}

/** A name, or a list of names of one kind: with the kind before it where it is a number, as "Tram 5" and "U1". */
const labelled = (words, first, mode, texts) => (/^\d/.test(first) ? `${t(`address.kind.${mode}`, {}, texts)} ${words}` : words);

/** Words in a list as the language writes one: "a, b und c". */
const listed = (words, language) => new Intl.ListFormat(language, { type: 'conjunction' }).format(words);

const firstUp = (text) => text.charAt(0).toUpperCase() + text.slice(1);
