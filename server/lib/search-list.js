// What the page searches in (public/search.js): all stations and all lines of
// a timetable, as api/search sends them. The search happens in the browser, so
// the list is everything it knows, and every visitor who searches loads it:
// for all of Germany it is a quarter of a million stations, and it is made as
// small as it gets.
//
// - A station is its name, its place, its town, what stops there and how
//   much. It has no id: the ids of a feed need not outlast one version of it,
//   and they would be a quarter of the list. A station is asked for by its
//   place instead, so every station of the list has a place of its own: where
//   a feed has several at one, all but the first are moved on, a metre each.
// - The stations are in the order of a curve that goes through every place of
//   the map (Hilbert's), so each is near the one before it, and a place is
//   sent as the difference from the one before: small numbers that compress
//   well. The names are one text with a line for each.
// - The towns are named once, and a station has the number of its own: in
//   that order the stations of a town follow each other. Towns of one name
//   are towns apart, and each of them has the name of its district beside
//   it, which tells them apart (#24); a town whose name no other has, has
//   none. Two of one name in one district are taken for one: OpenStreetMap
//   has a few places twice, such as a municipality and the forest beside it
//   that belongs to none.
// - The lines are in the order of their operators, whose names are sent once.

// A place is two whole numbers of 1e-5 degrees, about a metre.
const UNIT = 1e5;
// The side of the square the curve goes through, in such units: more than
// the 360 degrees there are.
const SIDE = 2 ** 26;

/**
 * How far along Hilbert's curve through a square of SIDE by SIDE the point
 * (x, y) is: points near each other are near each other on the curve, and
 * no two are at the same place of it.
 */
function alongCurve(x, y) {
  let along = 0;
  for (let half = SIDE / 2; half >= 1; half /= 2) {
    const right = (x & half) > 0 ? 1 : 0;
    const up = (y & half) > 0 ? 1 : 0;
    along = along * 4 + ((3 * right) ^ up);
    if (!up) {
      if (right) [x, y] = [SIDE - 1 - x, SIDE - 1 - y];
      [x, y] = [y, x];
    }
  }
  return along;
}

const within = (number) => Math.min(SIDE - 1, Math.max(0, number));
/** Where a place is on the curve; the two numbers of a place that is none are taken for the nearest there is. */
const curveOf = (lat, lon) => alongCurve(within(lon + 180 * UNIT), within(lat + 90 * UNIT));

/** Each number as the difference from the one before it. */
const differences = (numbers) => Array.from(numbers, (number, i) => (i ? number - numbers[i - 1] : number));

const inOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * @param stations [{ name, lat, lon, modes, service, town }]: the place in
 *   degrees, the modes by their names, how often a trip stops there, and the
 *   number of the town it is in among `towns`, -1 if none is known
 * @param lines [{ name, mode, agency, to, lat, lon, service }]: where most of
 *   its trips go, the middle of its stops and the number of its trips
 * @param modes the names of all modes: a mode is sent as its number in them
 * @param towns [{ name, district }]: the towns, with the name of the district
 *   each is in, null where that is not known
 * @returns { list, at }: what api/search sends, and a function that says for
 *   a place of that list (in degrees) which of `stations` is there, by its
 *   number, or -1 if none is
 */
export function searchList(stations, lines, modes, towns = []) {
  const count = stations.length;
  const lat = new Int32Array(count);
  const lon = new Int32Array(count);
  const curve = new Float64Array(count);
  const taken = new Set();
  for (let i = 0; i < count; i++) {
    lat[i] = Math.round(stations[i].lat * UNIT);
    lon[i] = Math.round(stations[i].lon * UNIT);
    // (to the east: there is room for it beyond every longitude)
    while (taken.has(lat[i] * SIDE + lon[i])) lon[i]++;
    taken.add(lat[i] * SIDE + lon[i]);
    curve[i] = curveOf(lat[i], lon[i]);
  }
  const order = Int32Array.from(curve.keys()).sort((a, b) => curve[a] - curve[b] || a - b);
  const column = (of) => Array.from(order, of);
  const bits = (names) => names.reduce((sum, name) => sum | (1 << modes.indexOf(name)), 0);

  // (the towns in the order in which the list comes to them)
  const listed = [];
  const townNumber = new Map();
  const townOf = (i) => {
    const town = towns[stations[i].town];
    if (!town) return -1;
    const key = `${town.name}\n${town.district ?? ''}`;
    if (!townNumber.has(key)) townNumber.set(key, listed.push(town) - 1);
    return townNumber.get(key);
  };

  const byOperator = [...lines].sort((a, b) => inOrder(a.agency, b.agency) || inOrder(a.name, b.name) || inOrder(a.mode, b.mode));
  const agencies = [...new Set(byOperator.map((line) => line.agency))];
  const operator = new Map(agencies.map((agency, i) => [agency, i]));

  const town = column(townOf);
  // (how many towns of the list have each name)
  const named = new Map();
  for (const { name } of listed) named.set(name, (named.get(name) ?? 0) + 1);

  const list = {
    modes,
    stations: {
      // (a line break in a name would be the end of it)
      names: column((i) => stations[i].name.replace(/[\r\n]+/g, ' ')).join('\n'),
      lat: differences(column((i) => lat[i])),
      lon: differences(column((i) => lon[i])),
      modes: column((i) => bits(stations[i].modes)),
      service: column((i) => stations[i].service),
      town,
      towns: listed.map(({ name }) => name),
      // (the district where another town of the list has the name too, '' elsewhere)
      districts: listed.map(({ name, district }) => (named.get(name) > 1 ? district ?? '' : '')),
    },
    lines: {
      name: byOperator.map((line) => line.name),
      mode: byOperator.map((line) => modes.indexOf(line.mode)),
      agencies,
      agency: byOperator.map((line) => operator.get(line.agency)),
      to: byOperator.map((line) => line.to),
      lat: differences(byOperator.map((line) => Math.round(line.lat * UNIT))),
      lon: differences(byOperator.map((line) => Math.round(line.lon * UNIT))),
      service: byOperator.map((line) => line.service),
    },
  };

  const onCurve = Float64Array.from(order, (i) => curve[i]);
  const at = (degreesLat, degreesLon) => {
    const [y, x] = [Math.round(degreesLat * UNIT), Math.round(degreesLon * UNIT)];
    const wanted = curveOf(y, x);
    let low = 0;
    for (let high = count; low < high;) {
      const middle = (low + high) >> 1;
      if (onCurve[middle] < wanted) low = middle + 1;
      else high = middle;
    }
    // (more than one only for places that are none, which the curve has at its rim)
    for (; low < count && onCurve[low] === wanted; low++) if (lat[order[low]] === y && lon[order[low]] === x) return order[low];
    return -1;
  };
  return { list, at };
}
