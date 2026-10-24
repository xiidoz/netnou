// The stations the search suggests near the map before anything is typed
// (#257), below the favourites: those a rider is likely to look for. Worked
// out in the browser from the list the search has (search.js), as all of the
// search is, and on the server from the timetable, for the links of the page
// as it is sent. Nothing in here knows either of them.
//
// A station alone says little: a timetable splits most main stations into
// several, Hamburg Hbf into seven, and the one the trains call at may have
// the fewest trips of them. So the stations within PLACE_M of each other are
// one place to a rider. A place counts the trips of its stations, each times
// the number of kinds that stop there: an interchange outweighs a bus station
// with more trips. It is suggested by the station of it that a rider names it
// by, the one with the furthest-reaching kind.
//
// Zoomed out further than a town, the towns with the most trips near the map
// are suggested, each by its biggest place; zoomed in, the biggest places
// near the map, apart from each other.

import { kilometres, weigh } from './search.js';

// Stations this close to each other are one place.
const PLACE_M = 300;
// A view that reaches further than this from its middle shows towns: one
// place of each.
const TOWNS_KM = 15;
// Places suggested together are at least this far apart, or a tenth of how
// far the view reaches, where that is more: they are not one place twice.
const APART_KM = 0.6;
const APART_SHARE = 10;
// The kinds a place is named by, the furthest-reaching first: the Hbf of a
// city, not the bus stop in front of it.
const NAMED_BY = ['longdistance', 'regional', 'suburban', 'subway', 'tram', 'ferry', 'cable', 'bus', 'other'];

// How many are suggested: together with the favourites, as many rows as the
// list of the search shows on a phone without scrolling, and never fewer than
// two, nor more than five (see nearbyBeside).
const ROWS = 7;
const MOST = 5;
const FEWEST = 2;

/** How many stations are suggested below this many favourites (stops and lines listed): 5 with up to two, then one fewer for each more, 2 from five on. */
export const nearbyBeside = (favourites) => Math.max(FEWEST, Math.min(MOST, ROWS - favourites));

/**
 * The places of the stations of a list, worked out once for it.
 * @param stations { count, modes, lat, lon, kinds, service, townOf }: the
 *   names of the modes, and for each station its place in degrees, the
 *   modes that stop there as bits in the order of `modes`, how often a trip
 *   stops there, and the number of its town, -1 where none is known; an
 *   index of search.js has them, as `stations` of the timetable do
 */
export function placesOf({ count, modes, lat, lon, kinds, service, townOf }) {
  const bitOf = (mode) => (modes.includes(mode) ? 1 << modes.indexOf(mode) : 0);
  const rankOf = (i) => {
    const rank = NAMED_BY.findIndex((mode) => kinds[i] & bitOf(mode));
    return rank < 0 ? NAMED_BY.length : rank;
  };
  const kindsOf = (i) => {
    let many = 0;
    for (let bits = kinds[i]; bits; bits &= bits - 1) many++;
    return many;
  };
  // (the stations from south to north, to find those near one by its latitude)
  const byLat = Int32Array.from({ length: count }, (_, i) => i).sort((a, b) => lat[a] - lat[b]);
  const place = new Float64Array(count);
  const shown = Int32Array.from({ length: count }, (_, i) => i);
  const rank = Uint8Array.from({ length: count }, (_, i) => rankOf(i));
  const reach = PLACE_M / 111_200;
  let low = 0;
  for (let p = 0; p < count; p++) {
    const i = byLat[p];
    while (lat[byLat[low]] < lat[i] - reach) low++;
    if (!service[i]) continue;
    const across = reach / Math.cos((lat[i] * Math.PI) / 180);
    for (let q = low; q < count && lat[byLat[q]] <= lat[i] + reach; q++) {
      const j = byLat[q];
      if (Math.abs(lon[j] - lon[i]) > across || kilometres(lat[i], lon[i], lat[j], lon[j]) * 1000 > PLACE_M) continue;
      place[i] += service[j] * kindsOf(j);
      const s = shown[i];
      if (rank[j] < rank[s] || (rank[j] === rank[s] && service[j] > service[s])) shown[i] = j;
    }
  }
  // (each town's biggest place, and the trips of all its stations)
  let towns = 0;
  for (let i = 0; i < count; i++) towns = Math.max(towns, townOf[i] + 1);
  const biggest = new Int32Array(towns).fill(-1);
  const townService = new Float64Array(towns);
  for (let i = 0; i < count; i++) {
    const t = townOf[i];
    if (t < 0) continue;
    townService[t] += service[i];
    if (place[i] && (biggest[t] < 0 || place[i] > place[biggest[t]])) biggest[t] = i;
  }
  return { count, lat, lon, byLat, place, shown, biggest, townService };
}

/**
 * The stations to suggest near `near`, the likeliest first.
 * @param places from placesOf
 * @param near as search() takes it: { lat, lon } of the visitor, or of the
 *   middle of the map with `km`, how far it reaches; null for none
 * @param limit how many at most (nearbyBeside)
 * @param except the numbers of stations not to suggest: the favourites,
 *   which are listed already; the place of one is not suggested either
 * @returns the numbers of the stations
 */
export function nearby(places, near, { limit = MOST, except = [] } = {}) {
  const { count, lat, lon, place, shown, biggest, townService } = places;
  const picked = [];
  const take = (i) => {
    const station = shown[i];
    if (!except.includes(station) && !picked.includes(station)) picked.push(station);
    return picked.length >= limit;
  };
  if (limit < 1) return picked;
  if ((near?.km ?? 0) > TOWNS_KM && biggest.some((i) => i >= 0)) {
    const towns = [];
    for (let t = 0; t < biggest.length; t++) if (biggest[t] >= 0) towns.push([biggest[t], weigh(townService[t], lat[biggest[t]], lon[biggest[t]], near)]);
    towns.sort((a, b) => b[1] - a[1]);
    for (const [i] of towns) if (take(i)) break;
    return picked;
  }
  // The biggest place left, then none within `apart` of it: the stations
  // around it are of the same place, or too near it to be one of their own.
  const weight = new Float64Array(count);
  for (let i = 0; i < count; i++) if (place[i]) weight[i] = weigh(place[i], lat[i], lon[i], near);
  const apart = Math.max(APART_KM, (near?.km ?? 0) / APART_SHARE);
  for (;;) {
    let best = -1;
    for (let i = 0; i < count; i++) if (weight[i] > 0 && (best < 0 || weight[i] > weight[best])) best = i;
    if (best < 0 || take(best)) break;
    clearAround(places, best, apart, weight);
  }
  return picked;
}

/** Sets the weight of the stations within `km` of station i to nothing. */
function clearAround({ count, lat, lon, byLat }, i, km, weight) {
  const reach = km / 111.2;
  // (the first of them from the south, found by halves)
  let [low, high] = [0, count];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lat[byLat[middle]] < lat[i] - reach) low = middle + 1;
    else high = middle;
  }
  for (let p = low; p < count && lat[byLat[p]] <= lat[i] + reach; p++) {
    const j = byLat[p];
    if (kilometres(lat[i], lon[i], lat[j], lon[j]) <= km) weight[j] = 0;
  }
}
