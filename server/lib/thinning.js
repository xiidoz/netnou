// Thinning out: what an answer for a zoomed-out map leaves out where a screen
// cannot take every vehicle. All of Germany has 35,000 under way on a weekday
// morning, and a phone that shows the whole country is to get about as many
// as it gets for one transit network today.
//
// Nothing is left out while it fits: an instance for one transit network is
// not thinned out at any zoom, and a large one from the zoom at which its
// busiest place fits on a screen. Where it does not fit,
//
// - the same share of every kind of transport is shown, picked by chance:
//   where there are twice as many buses as trams, the map has twice as many,
//   and a city with ten times the buses of the country around it has ten
//   times as many. The same vehicles are picked from one moment to the next
//   (Vehicle.rank), so none comes and goes while it is under way.
// - a kind of which there are only a few is shown whole, and of every other
//   one at least as many as that: three long-distance trains among a
//   thousand buses all stay.
// - the first one of a kind in every square of the map is shown whatever
//   its chance, so that a single bus far from all others is on the map.
//
// Only the kinds a map shows count: with the buses switched off, the room
// they took goes to the others.
//
// What a lower zoom shows, every higher one shows too: zooming in adds
// vehicles and takes none away.

import { MODES, mix } from './timetable.js';

// The zoom the map of the page begins at, and the one from which every
// vehicle is shown whatever their number: from there they carry their line
// and follow their route (MIN_ZOOM and LABEL_ZOOM in public/app.js).
export const ZOOM_MIN = 5;
export const ZOOM_ALL = 12;
// How many vehicles the busiest screen of a phone may hold, and that screen
// in CSS pixels. About what the default area has at its busiest, which a
// phone draws without trouble: that area is not thinned out.
export const BUDGET = 2500;
const SCREEN = [390, 760];
// The side, in pixels of the screen, of the squares of which each has its
// first vehicle of a kind on the map.
const SQUARE = 32;
// A kind with no more vehicles than this on a screen is shown whole, and of
// a larger one about this many at the least: a twentieth of what a screen
// may hold.
const FEW = BUDGET / 20;
// A rank is a whole number below this.
const RANKS = 2 ** 32;

/** Where the vehicles are on a map of the world that is one wide and one high (Web Mercator), their kind and their rank, as columns. */
function place(vehicles) {
  const count = vehicles.length;
  const at = { count, x: new Float64Array(count), y: new Float64Array(count), kind: new Int32Array(count), rank: new Float64Array(count) };
  for (let i = 0; i < count; i++) {
    const v = vehicles[i];
    at.x[i] = (v.lon + 180) / 360;
    at.y[i] = (1 - Math.log(Math.tan(Math.PI / 4 + (v.lat * Math.PI) / 360)) / Math.PI) / 2;
    at.kind[i] = MODES.indexOf(v.mode);
    at.rank[i] = v.rank;
  }
  return at;
}

/**
 * For each vehicle whether it is the first of its kind, the one with the
 * lowest rank, in its square of the map at a whole zoom. The squares of a
 * zoom are those of the zoom before cut in four: who is first in a square
 * is first in the smaller one it is in at the next zoom.
 */
function firsts({ count, x, y, kind, rank }, zoom) {
  const along = (512 * 2 ** zoom) / SQUARE;
  const first = new Map();
  for (let i = 0; i < count; i++) {
    const square = (kind[i] * 2 ** 22 + Math.floor(x[i] * along)) * 2 ** 22 + Math.floor(y[i] * along);
    const known = first.get(square);
    if (known === undefined || rank[i] < rank[known]) first.set(square, i);
  }
  const is = new Uint8Array(count);
  for (const i of first.values()) is[i] = 1;
  return is;
}

/**
 * The share of each kind that a whole zoom shows, so that the busiest screen
 * holds no more than the budget: the same share of every kind, and the
 * largest with which it fits. But of a kind at least FEW on its own busiest
 * screen, or all it has there.
 *
 * @param at from place()
 * @param counted for each of MODES whether the map shows it
 * @param above the shares of the next zoom, which this one is not to exceed
 * @returns a share from 0 to 1 for each of MODES
 */
function fit(at, zoom, counted, above) {
  const { count, x, y, kind, rank } = at;
  const kinds = MODES.length;
  // The world in cells of half a screen; a screen is four of them. Each cell
  // with a vehicle in it gets a number, and knows the three that make up a
  // screen with it. (-1: a vehicle of a kind that does not count.)
  const world = 512 * 2 ** zoom;
  const [across, down] = [world / (SCREEN[0] / 2), world / (SCREEN[1] / 2)];
  const numbers = new Map();
  const cell = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i++) {
    if (!counted[kind[i]]) continue;
    const key = Math.floor(x[i] * across) * 2 ** 26 + Math.floor(y[i] * down);
    let number = numbers.get(key);
    if (number === undefined) numbers.set(key, (number = numbers.size));
    cell[i] = number;
  }
  const cells = numbers.size;
  const beside = new Int32Array(3 * cells).fill(-1);
  for (const [key, number] of numbers) {
    [key + 1, key + 2 ** 26, key + 2 ** 26 + 1].forEach((other, n) => {
      if (numbers.has(other)) beside[3 * number + n] = numbers.get(other);
    });
  }
  /** The most that a screen holds, of what `inCell` counts for each cell (from `from` on, every `step`-th entry). */
  const busiest = (inCell, from = 0, step = 1) => {
    let most = 0;
    for (let c = 0; c < cells; c++) {
      let sum = inCell[from + step * c];
      for (let n = 0; n < 3; n++) if (beside[3 * c + n] >= 0) sum += inCell[from + step * beside[3 * c + n]];
      if (sum > most) most = sum;
    }
    return most;
  };

  const ofKind = new Int32Array(kinds * cells);
  const ofAll = new Int32Array(cells);
  for (let i = 0; i < count; i++) {
    if (cell[i] < 0) continue;
    ofKind[kinds * cell[i] + kind[i]]++;
    ofAll[cell[i]]++;
  }
  const shares = new Float64Array(kinds).fill(1);
  if (busiest(ofAll) > BUDGET) {
    const onScreen = Array.from({ length: kinds }, (_, k) => busiest(ofKind, k, kinds));
    const first = firsts(at, zoom);
    const shown = new Int32Array(cells);
    /** Whether it fits with this share of every kind. */
    const fits = (share) => {
      for (let k = 0; k < kinds; k++) shares[k] = onScreen[k] > FEW ? Math.max(share, FEW / onScreen[k]) : 1;
      shown.fill(0);
      for (let i = 0; i < count; i++) if (cell[i] >= 0 && (first[i] || rank[i] < shares[kind[i]] * RANKS)) shown[cell[i]]++;
      return busiest(shown) <= BUDGET;
    };
    // (with a share of 0 the few of each kind and the first of every square are left; if even that is too much, it stays at that)
    let [low, high] = [0, 1];
    for (let step = 0; step < 16; step++) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    fits(low);
  }
  if (above) for (let k = 0; k < kinds; k++) shares[k] = Math.min(shares[k], above[k]);
  return shares;
}

/**
 * How much of each kind the answers for a zoomed-out map hold, worked out
 * from the vehicles that are under way: for each whole zoom from ZOOM_MIN
 * to below ZOOM_ALL a share for each of MODES, 1 where nothing is left out.
 * The shares follow the hour: at night more is shown of fewer.
 *
 * @param vehicles all of them, from Timetable.vehicles
 * @param counted for each of MODES whether the map shows it: the others take no room
 * @returns shares[zoom - ZOOM_MIN][place in MODES]
 */
export function sharesFor(vehicles, counted = MODES.map(() => true)) {
  const shares = Array.from({ length: ZOOM_ALL - ZOOM_MIN }, () => new Float64Array(MODES.length).fill(1));
  // (fewer in all than a screen may hold: nothing to leave out at any zoom)
  if (vehicles.length <= BUDGET) return shares;
  const at = place(vehicles);
  for (let zoom = ZOOM_ALL - 1; zoom >= ZOOM_MIN; zoom--) shares[zoom - ZOOM_MIN] = fit(at, zoom, counted, shares[zoom + 1 - ZOOM_MIN]);
  return shares;
}

/**
 * Which vehicles an answer for a map at a zoom holds. Between two whole
 * zooms the shares lie between theirs, by quarters of a zoom, and a part of
 * the first ones of the next zoom's squares is there already, so that about
 * as many are on a screen at any zoom.
 *
 * @param vehicles all of them, as sharesFor() had them or of a later moment
 * @param zoom of the map, as MapLibre counts it
 * @param shares from sharesFor()
 * @returns null if nothing is left out, else { shown, shares }: for each of
 *   `vehicles` 1 if it is shown and 0 if not, and the share of each kind of
 *   which not all are shown, by its name
 */
export function thinOut(vehicles, zoom, shares) {
  if (!(zoom < ZOOM_ALL)) return null;
  const level = Math.max(ZOOM_MIN, Math.floor(zoom));
  const quarter = zoom > level ? Math.floor((zoom - level) * 4) / 4 : 0;
  const here = shares[level - ZOOM_MIN];
  const next = shares[level + 1 - ZOOM_MIN];
  // (a quarter of the way to the next zoom, as a ratio: a screen holds a quarter of the ground there)
  const share = here.map((low, k) => {
    const high = next ? next[k] : 1;
    return low > 0 ? low * (high / low) ** quarter : high * quarter;
  });
  if (share.every((part) => part >= 1)) return null;

  const at = place(vehicles);
  const first = firsts(at, level);
  const firstNext = quarter > 0 ? firsts(at, level + 1) : null;
  // (the next zoom has four squares for one: so much of the three it adds that a screen holds as many as before)
  const some = ((4 ** quarter - 1) / 3) * RANKS;
  const shown = new Uint8Array(at.count);
  for (let i = 0; i < at.count; i++) {
    const part = share[at.kind[i]];
    if (part >= 1 || at.rank[i] < part * RANKS || first[i] || (firstNext?.[i] && mix(at.rank[i] ^ 0x9e3779b9) < some)) shown[i] = 1;
  }
  return { shown, shares: Object.fromEntries(MODES.map((mode, k) => [mode, Math.round(share[k] * 1000) / 1000]).filter(([, part]) => part < 1)) };
}
