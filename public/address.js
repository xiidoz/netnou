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

/** The address of a line: line/<operator>/<kind>/<name>. */
export const linePath = ({ agency, mode, name }) => `line/${slug(agency)}/${KINDS.includes(mode) ? mode : 'other'}/${slug(name)}`;

/**
 * What an address names, given from where the instance is (`stop/…`,
 * `line/…`): { type: 'stop', name, lat, lon } or { type: 'line', agency,
 * mode, name }, the names as the address writes them; null for any other.
 */
export function parseAddress(path) {
  const stop = /^stop\/([a-z0-9-]+)@(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)$/.exec(path);
  if (stop) {
    const [lat, lon] = [Number(stop[2]), Number(stop[3])];
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { type: 'stop', name: stop[1], lat, lon } : null;
  }
  const line = /^line\/([a-z0-9-]+)\/([a-z]+)\/([a-z0-9-]+)$/.exec(path);
  return line && KINDS.includes(line[2]) ? { type: 'line', agency: line[1], mode: line[2], name: line[3] } : null;
}

/** The words of a name of an address, to search for: nuernberg-plaerrer → nuernberg plaerrer. */
export const wordsOf = (name) => name.replace(/-/g, ' ').trim();
