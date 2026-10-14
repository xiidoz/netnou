// Which town a stop is in. The feed has the names of the stops and their
// places and no towns, and many names do not say where they are: "Marienplatz"
// is in Munich, and in a dozen other towns. With the towns known, the search
// finds a stop by its town as well and can tell such stops apart.
//
// The towns are the municipalities of OpenStreetMap: the administrative
// borders in the extracts that are read for the route geometry (shapes.js).
// A stop is in the town whose border is around it; where the extracts end,
// and without any, no town is known.
//
// A border is kept as the lines it is made of, the ways of OpenStreetMap, and
// not as rings: whether a place is inside is a matter of how many of them a
// line from there to the east crosses, in whatever order they are. Two
// neighbours have the lines between them in common, so each is kept once.

import { readGz, writeGz } from './files.js';

// Bump when what is kept of the borders changes: the copy in the data
// directory is then made again from a fresh download of the extracts.
const TOWNS_VERSION = 1;

// The levels of administrative borders (admin_level) that are read, the
// lowest first. A municipality is at level 8 in Germany and in most of its
// neighbours. A city that is a district of its own is at level 6, as the
// districts around it are, and Berlin and Hamburg are at level 4, as the
// states are: what tells a town from a district or a state is that it has
// no municipalities in it (townsAmong).
export const BORDER_LEVELS = ['8', '6', '4'];

// The borders are looked up by cells of this many degrees, 3 to 5 km.
const CELL = 0.05;
const UNIT = 1e7; // a point of a line is latitude and longitude in 1e-7 degrees

/** Whether lines close to rings: at every point at which one of them ends, an even number do. */
function closed(lines) {
  const open = new Set();
  for (const line of lines) {
    for (const at of [0, line.length - 2]) {
      const end = `${line[at]},${line[at + 1]}`;
      if (!open.delete(end)) open.add(end);
    }
  }
  return !open.size;
}

/** Whether a point is inside the rings that lines close to: inside an outer one, and not in a hole in it. */
function inside(lines, lat, lon) {
  let is = false;
  for (const line of lines) {
    for (let i = 2; i < line.length; i += 2) {
      if ((line[i] > lat) !== (line[i - 2] > lat) && lon < ((line[i - 1] - line[i + 1]) * (lat - line[i])) / (line[i - 2] - line[i]) + line[i + 1]) is = !is;
    }
  }
  return is;
}

/** The rectangle around lines: [south, west, north, east]. */
function boxOf(lines) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of lines) {
    for (let i = 0; i < line.length; i += 2) {
      box[0] = Math.min(box[0], line[i]);
      box[1] = Math.min(box[1], line[i + 1]);
      box[2] = Math.max(box[2], line[i]);
      box[3] = Math.max(box[3], line[i + 1]);
    }
  }
  return box;
}

/**
 * A point inside the rings that lines close to, whatever their shape: on a
 * line from west to east that one of them crosses, the middle between the
 * first two crossings.
 */
function pointIn(lines) {
  // (a latitude that a line passes, and none of its points is at: half a unit off the whole numbers they have)
  let lat = null;
  for (const line of lines) {
    const [south, , north] = boxOf([line]);
    if (south < north) lat = Math.floor((south + north) / 2) + 0.5;
    if (lat !== null) break;
  }
  const crossings = [];
  for (const line of lines) {
    for (let i = 2; i < line.length; i += 2) {
      if ((line[i] > lat) !== (line[i - 2] > lat)) crossings.push(((line[i - 1] - line[i + 1]) * (lat - line[i])) / (line[i - 2] - line[i]) + line[i + 1]);
    }
  }
  crossings.sort((a, b) => a - b);
  return [lat, (crossings[0] + crossings[1]) / 2];
}

/**
 * Finds the areas a point is in.
 * @param areas [{ lines }]
 * @returns a function that says for a latitude and a longitude, in 1e-7
 *   degrees, the numbers of the areas around that point, the first first
 */
function finder(areas) {
  const boxes = areas.map(({ lines }) => boxOf(lines));
  const cells = new Map();
  const cell = (lat, lon) => Math.floor(lat / (CELL * UNIT)) * 1e5 + Math.floor(lon / (CELL * UNIT));
  boxes.forEach((box, i) => {
    for (let lat = box[0]; lat < box[2] + CELL * UNIT; lat += CELL * UNIT) {
      for (let lon = box[1]; lon < box[3] + CELL * UNIT; lon += CELL * UNIT) {
        const key = cell(lat, lon);
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
    }
  });
  return (lat, lon) => (cells.get(cell(lat, lon)) ?? []).filter((i) => {
    const box = boxes[i];
    return lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3] && inside(areas[i].lines, lat, lon);
  });
}

/**
 * The towns among the administrative borders of extracts: the
 * municipalities, and of the areas above them those that have none in them,
 * which are towns themselves.
 *
 * A border counts if it is whole: all its ways are there and close to
 * rings. A way is the same in every extract that has it, so a border that
 * lies across two extracts is whole with both, though with neither alone.
 * @param readings what readPbfBoundaries read of each extract
 * @returns [{ level, name, lines }], the municipalities first: the border of
 *   each as lines of latitude, longitude, latitude, … in 1e-7 degrees
 */
export function townsAmong(readings) {
  const ways = new Map();
  const borders = new Map();
  for (const reading of readings) {
    for (const [id, points] of reading.ways) ways.set(id, points);
    for (const border of reading.borders) borders.set(border.id, border);
  }
  const areas = [];
  for (const { level, name, ways: ids } of borders.values()) {
    const lines = ids.map((id) => ways.get(id));
    if (lines.length && lines.every(Boolean) && closed(lines)) areas.push({ level, name, lines });
  }

  const towns = [];
  let below = []; // the areas of the levels gone through
  for (const level of BORDER_LEVELS) {
    const here = areas.filter((area) => area.level === level);
    // (an area is in the one that a point inside it is in)
    const around = finder(here);
    const parts = new Uint8Array(here.length);
    for (const { lines } of below) for (const i of around(...pointIn(lines))) parts[i] = 1;
    towns.push(...here.filter((_, i) => !parts[i]));
    below = [...below, ...here];
  }
  return towns;
}

/** Writes the towns of the extracts into the data directory, for the imports until the extracts are read again. */
export function writeTowns(file, { fetchedAt, scope, sources, towns }) {
  const numbers = new Map(); // of the lines, each of which is one object for all towns that have it
  for (const { lines } of towns) for (const line of lines) if (!numbers.has(line)) numbers.set(line, numbers.size);
  writeGz(file, {
    version: TOWNS_VERSION,
    fetchedAt,
    area: scope,
    sources,
    names: towns.map((town) => town.name),
    // (a line as its first point and from there on the difference from the point before: small numbers)
    lines: Array.from(numbers.keys(), (line) => Array.from(line, (value, i) => (i < 2 ? value : value - line[i - 2]))),
    borders: towns.map((town) => town.lines.map((line) => numbers.get(line))),
  });
}

/**
 * The towns as writeTowns kept them, if they are of these extracts and of
 * the reading that the networks in use are of.
 * @returns { fetchedAt, names, at }: for a place in degrees `at` says the
 *   name of the town it is in, or null; null if there is no such copy
 */
export function readTowns(file, { scope, sources, fetchedAt }) {
  let kept;
  try {
    kept = readGz(file);
  } catch {
    return null;
  }
  if (kept.version !== TOWNS_VERSION || kept.area !== scope || kept.sources.join() !== sources.join() || kept.fetchedAt !== fetchedAt) return null;
  const lines = kept.lines.map((differences) => {
    const line = Int32Array.from(differences);
    for (let i = 2; i < line.length; i++) line[i] += line[i - 2];
    return line;
  });
  const around = finder(kept.borders.map((numbers) => ({ lines: numbers.map((number) => lines[number]) })));
  // (a place in two of them is in the first: a municipality before an area above)
  return { fetchedAt: kept.fetchedAt, names: kept.names, at: (lat, lon) => kept.names[around(Math.round(lat * UNIT), Math.round(lon * UNIT))[0]] ?? null };
}

/**
 * The town of every stop that is a station.
 * @param stops { lat, lon, parent } of a dataset
 * @param towns from readTowns
 * @returns { names, of }: the names of the towns that have a station, each
 *   once, and for every stop the number of its town in them: -1 for a
 *   platform, and for a station in no town that is known
 */
export function townsOf(stops, towns) {
  const of = new Int32Array(stops.lat.length).fill(-1);
  const names = [];
  const numbers = new Map();
  for (let i = 0; i < of.length; i++) {
    if (stops.parent[i] >= 0) continue;
    const name = towns.at(stops.lat[i], stops.lon[i]);
    if (name === null) continue;
    if (!numbers.has(name)) numbers.set(name, names.push(name) - 1);
    of[i] = numbers.get(name);
  }
  return { names, of };
}
