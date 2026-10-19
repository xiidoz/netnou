import test from 'node:test';
import assert from 'node:assert/strict';
import { NAME_ZOOM, RAIL_NAME_ZOOM, isExpressionFilter, namePrecedence, namedAt, placeNames, stopMark, withoutStyleStops } from '../public/stops.js';

test('a stop is a pill with a dot for each kind, in rows of three', () => {
  // a bus stop: one dot, as round as it is high
  const bus = stopMark(1, true);
  assert.deepEqual([bus.w, bus.h, bus.corner, bus.dot], [13, 13, 6.5, 3]);
  assert.deepEqual(bus.dots, [[0, 0]]);
  // U-Bahn, tram and bus: one row of three
  const three = stopMark(3, true);
  assert.deepEqual([three.w, three.h], [29, 13]);
  assert.deepEqual(three.dots.map(([x, y]) => [x, y]), [[-8, 0], [0, 0], [8, 0]]);
  // a main station with six kinds: two rows
  const six = stopMark(6, true);
  assert.deepEqual([six.w, six.h, six.corner], [29, 21, 6.5]);
  assert.deepEqual(six.dots[3], [-8, 4]);
  // smaller below zoom 15
  const small = stopMark(2, false);
  assert.deepEqual([small.w, small.h, small.dot], [18, 11, 2.5]);
  // (a stop of no kind the page knows is a dot without colour)
  assert.deepEqual([stopMark(0, true).w, stopMark(0, true).dots.length], [13, 0]);
});

test('stations of rail carry their names from zoom 14, all stops from 15', () => {
  assert.equal(RAIL_NAME_ZOOM, 14);
  assert.equal(NAME_ZOOM, 15);
  for (const modes of [['subway'], ['tram', 'suburban'], ['regional'], ['bus', 'longdistance']]) {
    assert.ok(!namedAt(modes, 13.9), modes.join());
    assert.ok(namedAt(modes, 14), modes.join());
  }
  for (const modes of [['bus'], ['tram', 'bus'], ['ferry']]) {
    assert.ok(!namedAt(modes, 14.9), modes.join());
    assert.ok(namedAt(modes, 15), modes.join());
  }
});

test('an open stop is named first, then the stations of rail, then those of more kinds', () => {
  const marks = [
    { name: 'bus', modes: ['bus'] },
    { name: 'tram and bus', modes: ['tram', 'bus'] },
    { name: 'U-Bahn', modes: ['subway'] },
    { name: 'open bus stop', modes: ['bus'], open: true },
    { name: 'main station', modes: ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance'] },
  ];
  assert.deepEqual(marks.sort(namePrecedence).map((mark) => mark.name), ['open bus stop', 'main station', 'U-Bahn', 'tram and bus', 'bus']);
});

test('a name goes right of its stop, else left, else nowhere; none lies on another or on a stop', () => {
  // free: on the right, 5 px from the mark
  assert.deepEqual(placeNames([{ x: 100, y: 100, w: 20, width: 60 }]), [115]);
  // the second would lie on the first: it goes to the left of its stop
  assert.deepEqual(placeNames([{ x: 100, y: 100, w: 20, width: 60 }, { x: 120, y: 104, w: 20, width: 60 }]), [115, 45]);
  // a stop to the right and one to the left: no room
  const obstacles = [[150, 95, 20, 13], [30, 95, 20, 13]];
  assert.deepEqual(placeNames([{ x: 100, y: 100, w: 20, width: 60 }], obstacles), [null]);
  // the open stop gets its name all the same, further off for its ring
  assert.deepEqual(placeNames([{ x: 100, y: 100, w: 20, width: 60, open: true, space: 12 }], obstacles), [122]);
  // and a later one does not lie on it
  assert.deepEqual(placeNames([{ x: 100, y: 100, w: 20, width: 60, open: true }, { x: 100, y: 110, w: 20, width: 60 }]), [115, 25]);
  // far enough below, both on the right
  assert.deepEqual(placeNames([{ x: 100, y: 100, w: 20, width: 60 }, { x: 100, y: 117, w: 20, width: 60 }]), [115, 115]);
});

test('filters of a style are told apart as MapLibre does: expressions, and the older form', () => {
  for (const filter of [true, ['==', ['get', 'class'], 'bus'], ['match', ['get', 'class'], ['bus'], true, false], ['all', ['>=', ['get', 'rank'], 1], ['<', ['get', 'rank'], 7]], ['has', 'name'], ['in', ['get', 'class'], ['literal', ['bus']]]]) {
    assert.ok(isExpressionFilter(filter), JSON.stringify(filter));
  }
  for (const filter of [['==', 'class', 'bus'], ['in', 'class', 'bus', 'railway'], ['!in', 'class', 'bus'], ['!has', 'name'], ['all', ['==', '$type', 'Point'], ['<=', 'rank', 6]], ['has', '$type'], undefined]) {
    assert.ok(!isExpressionFilter(filter), JSON.stringify(filter));
  }
});

test('the style keeps its places but its stops, where it follows the OpenMapTiles scheme', () => {
  const NOT_STOPS = ['!', ['match', ['get', 'class'], ['bus', 'railway'], true, false]];
  const expression = ['match', ['get', 'class'], ['airport', 'bus', 'rail'], true, false];
  const legacy = ['all', ['==', '$type', 'Point'], ['<=', 'rank', 6]];
  const style = {
    version: 8,
    sources: { openmaptiles: { type: 'vector' } },
    layers: [
      { id: 'background', type: 'background' },
      { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['==', 'class', 'primary'] },
      { id: 'poi_transit', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', filter: expression },
      { id: 'poi_old', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', filter: legacy },
      { id: 'poi_all', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi' },
    ],
  };
  const changed = withoutStyleStops(style);
  assert.deepEqual(changed.layers.slice(0, 2), style.layers.slice(0, 2));
  assert.deepEqual(changed.layers[2].filter, ['all', expression, NOT_STOPS]);
  assert.deepEqual(changed.layers[3].filter, ['all', legacy, ['!in', 'class', 'bus', 'railway']]);
  assert.deepEqual(changed.layers[4].filter, NOT_STOPS);
  // (the style as it came is left as it is)
  assert.deepEqual(style.layers[2].filter, expression);
  // a raster map has nothing of the kind
  const raster = { version: 8, sources: { tiles: { type: 'raster' } }, layers: [{ id: 'tiles', type: 'raster', source: 'tiles' }] };
  assert.deepEqual(withoutStyleStops(raster), raster);
});
