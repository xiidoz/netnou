// Stops on the map (#222): how large the mark of a stop is, and that of a
// favourite (#245), which stops carry their name at a zoom, where the names go
// so that none lies on another, the marks of a station at its places and the
// lines that join them (#234), and the map style without stops of its own;
// and which town a stop's name leaves unsaid, which the search and the stops
// of a trip show beside it (#246). Without the page around it, so that it can
// be tested as it is (test/stops.test.js); app.js draws, and search.js finds.

// The kinds of rail. Their stations show from zoom 12 (STATION_ZOOM in app.js),
// and carry their names earlier than other stops.
export const RAIL_MODES = ['subway', 'suburban', 'regional', 'longdistance'];
// From these zooms stops carry their names: stations of rail from the first,
// all from the second.
export const RAIL_NAME_ZOOM = 14;
export const NAME_ZOOM = 15;
// From this zoom a favourite stop carries its name, where the map has none of
// its own: it is drawn at every zoom (#245).
export const FAVOURITE_NAME_ZOOM = 11;
// From this zoom a station whose modes stop at places apart (`places` in
// api/stations) has a mark at each; below it, one at its own point.
export const PLACES_ZOOM = 15;
// How high a name is taken to be, and how far it is from its stop.
const NAME_HEIGHT = 16;
const NAME_SPACE = 5;

/**
 * The mark of a stop: a pill with a dot for each kind that calls there, in
 * rows of three, as the search shows a stop. Measured from its middle.
 * @param kinds how many kinds call there
 * @param big from zoom 15 the dots are larger
 * @returns { w, h, corner } the pill and the radius of its corners, and
 *   { dot, dots } the radius of the dots and where their centres are
 */
export function stopMark(kinds, big) {
  const d = big ? 6 : 5;
  const gap = 2;
  const pad = big ? 3.5 : 3;
  const across = Math.min(Math.max(kinds, 1), 3);
  const down = Math.max(Math.ceil(kinds / 3), 1);
  const w = 2 * pad + across * d + (across - 1) * gap;
  const h = 2 * pad + down * d + (down - 1) * gap;
  const dots = Array.from({ length: kinds }, (_, i) => [-w / 2 + pad + d / 2 + (i % 3) * (d + gap), -h / 2 + pad + d / 2 + Math.floor(i / 3) * (d + gap)]);
  return { w, h, corner: Math.min(h / 2, d / 2 + pad), dot: d / 2, dots };
}

// A favourite stop is a heart: the icon mdiHeart, drawn from its box of 24.
// Where the middle of the mark is in that box, and for each number of kinds
// how large the heart is in px and where its dots are, in units of the box:
// in rows that narrow as the heart does, clear of its edges (one in its
// middle; three as a triangle with sides of one length).
export const HEART_MIDDLE = [12, 11.6];
const HEART_LAYOUT = {
  1: { size: 19, dots: [[12, 12.3]] },
  2: { size: 22, dots: [[8.18, 9.8], [15.82, 9.8]] },
  3: { size: 26, dots: [[8.27, 8.6], [15.73, 8.6], [12, 15.06]] },
  4: { size: 28, dots: [[6, 9.2], [12, 9.2], [18, 9.2], [12, 15.2]] },
  5: { size: 31, dots: [[6.4, 8.3], [12, 9.3], [17.6, 8.3], [9.3, 14.1], [14.7, 14.1]] },
  6: { size: 37, dots: [[6.3, 8.2], [12, 9], [17.7, 8.2], [8.9, 13], [15.1, 13], [12, 16.9]] },
};

/**
 * The mark of a favourite stop (#245): a white heart with a dot for each kind
 * that calls there, measured from its middle. From zoom 15 it is larger, as
 * the pill is.
 * @param kinds how many kinds call there
 * @param big from zoom 15
 * @returns { w, h } the box it takes, { size } the side of the box of the
 *   icon, { dot, dots } the radius of the dots and where their centres are
 */
export function heartMark(kinds, big) {
  const { size, dots } = HEART_LAYOUT[Math.min(Math.max(kinds, 1), 6)];
  const side = big ? (size * 8) / 7 : size;
  const unit = side / 24;
  // (the icon fills its box from 2 to 22 across and from 3 to 21.35 down)
  return { w: (20 / 24) * side, h: (18.35 / 24) * side, size: side, dot: big ? 3 : 2.5, dots: dots.map(([x, y]) => [(x - HEART_MIDDLE[0]) * unit, (y - HEART_MIDDLE[1]) * unit]) };
}

/** Whether a stop of these kinds carries its name at this zoom. */
export function namedAt(modes, zoom) {
  return zoom >= NAME_ZOOM || (zoom >= RAIL_NAME_ZOOM && modes.some((mode) => RAIL_MODES.includes(mode)));
}

/**
 * The order in which names get their place: an open stop first, then the
 * favourites, then the stations of rail, then those where more kinds call.
 */
export function namePrecedence(a, b) {
  const weight = (mark) => (mark.open ? 1000 : 0) + (mark.favourite ? 500 : 0) + (mark.modes.some((mode) => RAIL_MODES.includes(mode)) ? 100 : 0) + mark.modes.length;
  return weight(b) - weight(a);
}

// How far apart the marks of a station's places have to be on the screen, not to be one.
const PLACE_GAP = 6;

/**
 * The marks of a station's places on the screen: those that would touch are
 * one, in the middle between them, with the modes of both.
 * @param places [{ x, y, modes }] on the screen, the busiest first
 * @param big as for stopMark
 * @param order the modes in the order their dots have (MODES in app.js)
 * @returns [{ x, y, modes }]
 */
export function mergePlaces(places, big, order) {
  const marks = places.map((place) => ({ ...place }));
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < marks.length && !merged; i++) {
      for (let j = i + 1; j < marks.length && !merged; j++) {
        const [a, b] = [marks[i], marks[j]];
        const [ma, mb] = [stopMark(a.modes.length, big), stopMark(b.modes.length, big)];
        if (Math.abs(a.x - b.x) >= (ma.w + mb.w) / 2 + PLACE_GAP || Math.abs(a.y - b.y) >= (ma.h + mb.h) / 2 + PLACE_GAP) continue;
        marks[i] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, modes: order.filter((mode) => a.modes.includes(mode) || b.modes.includes(mode)) };
        marks.splice(j, 1);
        merged = true;
      }
    }
  }
  return marks;
}

/**
 * The lines that join the marks of one station: the shortest way that links
 * them all (a minimum spanning tree), as pairs of their numbers.
 * @param points [{ x, y }]
 */
export function joiningLines(points) {
  const lines = [];
  if (points.length < 2) return lines;
  const joined = [0];
  const rest = points.map((_, i) => i).slice(1);
  while (rest.length) {
    let best = null;
    for (const a of joined) {
      for (const b of rest) {
        const length = Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
        if (!best || length < best.length) best = { a, b, length };
      }
    }
    lines.push([best.a, best.b]);
    joined.push(best.b);
    rest.splice(rest.indexOf(best.b), 1);
  }
  return lines;
}

const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/**
 * Where the names go: beside their stop, on the right or else on the left,
 * clear of the marks of the stops and of the names placed before. Those
 * first in the list are placed first; an open stop gets its name wherever
 * it falls.
 * @param names [{ x, y, w, width, open, space }]: the middle and the width of
 *   the mark, the width of the name, whether the stop is open, and how far
 *   the name is from the mark if not NAME_SPACE
 * @param obstacles the boxes of the marks: [left, top, width, height]
 * @returns for each name the left edge of its text, or null where there is no room
 */
export function placeNames(names, obstacles = []) {
  const placed = [...obstacles];
  return names.map(({ x, y, w, width, open = false, space = NAME_SPACE }) => {
    const sides = [x + w / 2 + space, x - w / 2 - space - width];
    for (const left of sides) {
      const box = [left - 2, y - NAME_HEIGHT / 2, width + 4, NAME_HEIGHT];
      if (!open && placed.some((other) => overlaps(box, other))) continue;
      placed.push(box);
      return left;
    }
    return null;
  });
}

// What a style asks for of its places to leave out stops: as an expression,
// and in the older form of filters.
const NOT_STOPS = ['!', ['match', ['get', 'class'], ['bus', 'railway'], true, false]];
const NOT_STOPS_LEGACY = ['!in', 'class', 'bus', 'railway'];

/**
 * Whether the filter of a layer is an expression rather than in the older
 * form, as MapLibre tells them apart: the two cannot be mixed in one filter.
 */
export function isExpressionFilter(filter) {
  if (filter === true || filter === false) return true;
  if (!Array.isArray(filter) || filter.length === 0) return false;
  switch (filter[0]) {
    case 'has':
      return filter.length >= 2 && filter[1] !== '$id' && filter[1] !== '$type';
    case 'in':
      return filter.length >= 3 && (typeof filter[1] !== 'string' || Array.isArray(filter[2]));
    case '!in':
    case '!has':
    case 'none':
      return false;
    case '==':
    case '!=':
    case '>':
    case '>=':
    case '<':
    case '<=':
      return filter.length !== 3 || Array.isArray(filter[1]) || Array.isArray(filter[2]);
    case 'any':
    case 'all':
      return filter.slice(1).every((part) => typeof part === 'boolean' || isExpressionFilter(part));
    default:
      return true;
  }
}

/**
 * A style without stops of its own where it is one for tiles in the
 * OpenMapTiles scheme, which most vector tiles follow: the places of classes
 * bus and railway of its layers of places (poi). The page draws every stop of
 * the timetable itself, and a tap on one of the style's would be a tap on the
 * empty map. A style of another kind stays as it is.
 */
export function withoutStyleStops(style) {
  if (!Array.isArray(style?.layers)) return style;
  const layers = style.layers.map((layer) => {
    if (layer['source-layer'] !== 'poi') return layer;
    if (layer.filter === undefined) return { ...layer, filter: NOT_STOPS };
    return { ...layer, filter: isExpressionFilter(layer.filter) ? ['all', layer.filter, NOT_STOPS] : ['all', layer.filter, NOT_STOPS_LEGACY] };
  });
  return { ...style, layers };
}

/** Lower case and without accents, "ß" as "ss": "Plärrer" becomes "plarrer". */
export const fold = (text) => text.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');

/** The words of a text, folded: "Halle(Saale)Hbf" has "halle", "saale" and "hbf". */
const foldedWords = (text) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The town of a stop to show beside its name, if the name does not say it:
 * "München" for "Marienplatz", nothing for "Nürnberg Plärrer" and for
 * "Frankfurt (Main) Hauptwache" in Frankfurt am Main. A name says its town if
 * one of its words is the first word of the town that has more than three
 * letters, which leaves out "Bad"; of a town without such a word, the first
 * one. A word that only begins like the town does not say it: there is a
 * "Nürnberger Straße" in many towns, and "D-Froschenteich" does not say
 * Düsseldorf to whoever does not know it already.
 * @param town the name of the town it is in, null where none is known
 */
export function townToShow(name, town) {
  if (!town) return null;
  const words = foldedWords(town);
  const main = words.find((word) => word.length > 3) ?? words[0];
  return main && foldedWords(name).includes(main) ? null : town;
}

/**
 * The towns to show beside the stops of a trip (#246): where it runs through
 * more than one town, the town of each stop whose name does not say it
 * (townToShow); within one town none, where every rider knows it.
 * @param stops [{ name, town }], `town` null where none is known
 * @returns for each stop its town to show, or null
 */
export function townsAlong(stops) {
  const towns = new Set(stops.map((stop) => stop.town).filter(Boolean));
  return stops.map((stop) => (towns.size > 1 ? townToShow(stop.name, stop.town) : null));
}
