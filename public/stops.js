// Stops on the map (#222): how large the mark of a stop is, which stops carry
// their name at a zoom, where the names go so that none lies on another, and
// the map style without stops of its own. Without the page around it, so that
// it can be tested as it is (test/stops.test.js); app.js draws.

// The kinds of rail. Their stations show from zoom 12 (STATION_ZOOM in app.js),
// and carry their names earlier than other stops.
export const RAIL_MODES = ['subway', 'suburban', 'regional', 'longdistance'];
// From these zooms stops carry their names: stations of rail from the first,
// all from the second.
export const RAIL_NAME_ZOOM = 14;
export const NAME_ZOOM = 15;
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

/** Whether a stop of these kinds carries its name at this zoom. */
export function namedAt(modes, zoom) {
  return zoom >= NAME_ZOOM || (zoom >= RAIL_NAME_ZOOM && modes.some((mode) => RAIL_MODES.includes(mode)));
}

/**
 * The order in which names get their place: an open stop first, then the
 * stations of rail, then those where more kinds call.
 */
export function namePrecedence(a, b) {
  const weight = (mark) => (mark.open ? 1000 : 0) + (mark.modes.some((mode) => RAIL_MODES.includes(mode)) ? 100 : 0) + mark.modes.length;
  return weight(b) - weight(a);
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
