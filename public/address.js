// The addresses of stops, lines (#37) and trips (#178), which the page shows
// and passes on and the server answers. The ids of the feed change with every
// timetable, so a stop is named by its name and its town, a line by its
// operator, its kind and its name, and a trip by its line, its day and where
// and when it starts. The words of an address are English, the names in
// it as the timetable has them, written as one types them.

import { townToShow } from './stops.js';

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

/**
 * The name of a stop in its address (#288): its name as its title has it,
 * with its town after it where the name does not say it (townToShow, #254).
 * @param stop { name, town }, town null where none is known
 */
export const stopName = ({ name, town }) => slug(townToShow(name, town) ? `${name} ${town}` : name);

/**
 * The address of a stop (#288): stop/<name>, and /<number> after it from 2
 * on, where stops of that name are more than one in a town. So a stop keeps
 * its address when a new timetable moves it by some metres.
 * server/lib/addresses.js writes them: the name as stopName has it, and
 * where stops in several towns would have it, with the town after it.
 */
export const stopPath = (name, number = 1) => `stop/${name}${number > 1 ? `/${number}` : ''}`;

/**
 * An address of a stop by its name and its place to four decimals, as
 * addresses of stops were written until #288. The server finds the stop by
 * it still, and answers with the stop's address: the page writes one where
 * it has none from the server, as for a favourite or a stop of the search.
 */
export const stopPathAt = (name, lat, lon) => `stop/${slug(name)}@${lat.toFixed(4)},${lon.toFixed(4)}`;

/**
 * The name of an operator as Netnou has it (#305): as the feed gives it,
 * without a code written before it. A code is a first word of six letters
 * and digits with a digit in it, as gtfs.de writes since its timetable of
 * 31 October 2026: "800714 DB Regio AG Bayern", "kvv22E KVV", "NBRB54 NEB
 * Niederbarnimer Eisenbahn". A name that is only such a word stays as it is,
 * and so do "KomBus GmbH" and "Arendt Busbetrieb". The import names every
 * operator so; the page also its favourites saved before.
 */
export const operatorName = (name) => name.replace(/^(?=[A-Za-z]*\d)[A-Za-z\d]{6} +(?=\S)/, '');

/**
 * The address of a line: line/<operator>/<kind>/<name>, and @<place> where
 * lines of that name are in places apart (#152): the middle of its stations,
 * as server/lib/addresses.js writes it.
 */
export const linePath = ({ agency, mode, name }, place = null) => `line/${slug(agency)}/${KINDS.includes(mode) ? mode : 'other'}/${slug(name)}${place ? `@${place}` : ''}`;

/**
 * The address of a trip (#178): trip/<operator>/<kind>/<line>/<day>/<time>-<first stop>,
 * the day (YYYY-MM-DD) and the time (HHMM) those of the clock where the
 * instance is, of its planned departure from its first stop. It names the
 * run of that day.
 */
export const tripPath = ({ agency, mode, name }, day, time, from) => `trip/${slug(agency)}/${KINDS.includes(mode) ? mode : 'other'}/${slug(name)}/${day}/${time}-${slug(from)}`;

// (a place in an address: latitude and longitude, each to up to seven decimals)
const PLACE = String.raw`@(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)`;
const STOP = new RegExp(String.raw`^stop\/([a-z0-9-]+)(?:\/([1-9]\d{0,2})|${PLACE})?$`);
const LINE = new RegExp(String.raw`^line\/([a-z0-9-]+)\/([a-z]+)\/([a-z0-9-]+)(?:${PLACE})?$`);
const TRIP = /^trip\/([a-z0-9-]+)\/([a-z]+)\/([a-z0-9-]+)\/(\d{4}-\d{2}-\d{2})\/((?:[01]\d|2[0-3])[0-5]\d)-([a-z0-9-]+)$/;

/**
 * What an address names, given from where the instance is (`stop/…`,
 * `line/…`, `trip/…`): { type: 'stop', name }, with its number where it
 * has one, { type: 'line', agency, mode, name }, each with lat and lon where
 * it has a place, or { type:
 * 'trip', agency, mode, name, day, time, from }; the names as the address
 * writes them; null for any other.
 */
export function parseAddress(path) {
  const placed = (lat, lon, named) => (lat === undefined ? named : Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { ...named, lat: Number(lat), lon: Number(lon) } : null);
  const stop = STOP.exec(path);
  if (stop) return placed(stop[3], stop[4], { type: 'stop', name: stop[1], ...(stop[2] ? { number: Number(stop[2]) } : {}) });
  const trip = TRIP.exec(path);
  if (trip) return KINDS.includes(trip[2]) ? { type: 'trip', agency: trip[1], mode: trip[2], name: trip[3], day: trip[4], time: trip[5], from: trip[6] } : null;
  const line = LINE.exec(path);
  return line && KINDS.includes(line[2]) ? placed(line[4], line[5], { type: 'line', agency: line[1], mode: line[2], name: line[3] }) : null;
}

/** The words of a name of an address, to search for: nuernberg-plaerrer → nuernberg plaerrer. */
export const wordsOf = (name) => name.replace(/-/g, ' ').trim();
