// Favourites (#245): the stops and lines a visitor marks with the heart, so
// that the search has them first. They are kept in the browser, as the
// settings are, and go nowhere else. A favourite is kept by what its address
// says (address.js), its name and its place, not by its id, which changes
// with every timetable: a stop is the one of that name nearest its place, a
// line the one of that name, mode and operator nearest its place, as
// api/address finds them. A stop keeps the kinds that call there as well, for
// its heart on the map where the map has no stations of its own. Without the
// page around it, so that it can be tested as it is (test/favourites.test.js);
// app.js and search.js use it.

// How far a stop may have moved with a new timetable and still be the one
// marked: as far as api/address looks for a stop of the name.
export const STOP_REACH_M = 1000;
// The same for a line, whose place is the middle of its stations: lines of a
// name in places apart (#152) are towns apart.
export const LINE_REACH_M = 10_000;

export const metres = (lat1, lon1, lat2, lon2) => Math.hypot(lat2 - lat1, (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180)) * 111_320;

// (to 1e-5 degrees, as the server keeps the places of its stops)
const round5 = (degrees) => Math.round(degrees * 1e5) / 1e5;

const isPlace = (item) => item !== null && typeof item === 'object' && typeof item.name === 'string' && Number.isFinite(item.lat) && Number.isFinite(item.lon);
const isModes = (modes) => Array.isArray(modes) && modes.every((mode) => typeof mode === 'string');
const isLine = (item) => isPlace(item) && typeof item.mode === 'string' && typeof item.agency === 'string';

/**
 * The favourites from what was stored, which may be anything: written by
 * another version of the page or by hand. What is not of their shape is left out.
 * @returns {{ stops: {name, lat, lon, modes}[], lines: {name, mode, agency, lat, lon}[] }},
 *   `modes` only where it was kept
 */
export function favouritesFrom(stored) {
  const list = (key, shape) => (Array.isArray(stored?.[key]) ? stored[key].filter(shape) : []);
  return {
    stops: list('stops', isPlace).map(({ name, lat, lon, modes }) => ({ name, lat, lon, ...(isModes(modes) ? { modes } : {}) })),
    lines: list('lines', isLine).map(({ name, mode, agency, lat, lon }) => ({ name, mode, agency, lat, lon })),
  };
}

/** A stop as it is kept, from what api/departures says of it, with the kinds that call there. */
export const stopFavourite = ({ name, lat, lon }, modes) => ({ name, lat: round5(lat), lon: round5(lon), modes: [...modes] });

/** A line as it is kept, from what api/line says of it: its place is `at`. */
export const lineFavourite = ({ name, mode, agency, at: [lat, lon] }) => ({ name, mode, agency, lat: round5(lat), lon: round5(lon) });

/** Whether two stops are the same one, kept in different timetables. */
export const sameStop = (a, b) => a.name === b.name && metres(a.lat, a.lon, b.lat, b.lon) <= STOP_REACH_M;

/** Whether two lines are the same one. */
export const sameLine = (a, b) => a.name === b.name && a.mode === b.mode && a.agency === b.agency && metres(a.lat, a.lon, b.lat, b.lon) <= LINE_REACH_M;

const same = (kind) => (kind === 'stops' ? sameStop : sameLine);

/** Whether a stop (kind 'stops') or a line ('lines') is among the favourites. */
export const isFavourite = (favourites, kind, item) => favourites[kind].some((kept) => same(kind)(kept, item));

/**
 * The favourites with a stop or a line marked or no longer marked. One that
 * is marked goes to the end, as it is now; one that is no longer marked goes
 * with every one kept for it.
 */
export function withFavourite(favourites, kind, item, yes) {
  const others = favourites[kind].filter((kept) => !same(kind)(kept, item));
  return { ...favourites, [kind]: yes ? [...others, item] : others };
}
