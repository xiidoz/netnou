// The addresses of stops and lines (#37), which the page shows and passes on
// and the server answers. The ids of the feed change with every timetable,
// so a stop is named by its name and its place, and a line by its operator,
// its kind and its name. The words of an address are English, the names in
// it as the timetable has them, written as one types them.

/** The kinds of transport of a line's address, as the API names them (MODES in server/lib/timetable.js). */
const KINDS = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'ferry', 'cable', 'other'];

// (letters that do not come apart into a plain letter and a mark)
const LETTERS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', þ: 'th' };

/**
 * A name as an address has it: in small letters, ä as ae and other letters
 * without their marks, the words joined by hyphens. "-" for a name of none.
 */
export function slug(name) {
  const words = name.toLowerCase().replace(/[äöüßæœøłđþ]/g, (letter) => LETTERS[letter]).normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return words || '-';
}

/** The address of a stop: stop/<name>@<latitude>,<longitude>, the place to four decimals (about 10 m). */
export const stopPath = (name, lat, lon) => `stop/${slug(name)}@${lat.toFixed(4)},${lon.toFixed(4)}`;

/**
 * The address of a line: line/<operator>/<kind>/<name>, and @<place> where
 * lines of that name are in places apart (#152): the middle of its stations,
 * as server/lib/addresses.js writes it.
 */
export const linePath = ({ agency, mode, name }, place = null) => `line/${slug(agency)}/${KINDS.includes(mode) ? mode : 'other'}/${slug(name)}${place ? `@${place}` : ''}`;

// (a place in an address: latitude and longitude, each to up to seven decimals)
const PLACE = String.raw`@(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)`;
const STOP = new RegExp(String.raw`^stop\/([a-z0-9-]+)${PLACE}$`);
const LINE = new RegExp(String.raw`^line\/([a-z0-9-]+)\/([a-z]+)\/([a-z0-9-]+)(?:${PLACE})?$`);

/**
 * What an address names, given from where the instance is (`stop/…`,
 * `line/…`): { type: 'stop', name, lat, lon } or { type: 'line', agency,
 * mode, name }, with lat and lon where it has a place, the names as the
 * address writes them; null for any other.
 */
export function parseAddress(path) {
  const placed = (lat, lon, named) => (lat === undefined ? named : Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { ...named, lat: Number(lat), lon: Number(lon) } : null);
  const stop = STOP.exec(path);
  if (stop) return placed(stop[2], stop[3], { type: 'stop', name: stop[1] });
  const line = LINE.exec(path);
  return line && KINDS.includes(line[2]) ? placed(line[4], line[5], { type: 'line', agency: line[1], mode: line[2], name: line[3] }) : null;
}

/** The words of a name of an address, to search for: nuernberg-plaerrer → nuernberg plaerrer. */
export const wordsOf = (name) => name.replace(/-/g, ' ').trim();
