import test from 'node:test';
import assert from 'node:assert/strict';
import { HEART_MIDDLE, NAME_ZOOM, PLACES_ZOOM, RAIL_NAME_ZOOM, heartMark, isExpressionFilter, joiningLines, mergePlaces, namePrecedence, namedAt, placeNames, stopMark, townToShow, townsAlong, withoutStyleStops } from '../public/stops.js';

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

const ORDER = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'ferry', 'cable', 'other'];

test('the marks of a station at its places: those that would touch on the screen are one (#234)', () => {
  assert.equal(PLACES_ZOOM, 15);
  // Nürnberg Hbf at zoom 16: trains, U-Bahn, tram and bus far enough apart
  const apart = [{ x: 300, y: 500, modes: ['suburban', 'regional', 'longdistance'] }, { x: 200, y: 290, modes: ['subway'] }, { x: 280, y: 180, modes: ['tram'] }, { x: 190, y: 190, modes: ['bus'] }];
  assert.deepEqual(mergePlaces(apart, true, ORDER), apart);
  // closer: the U-Bahn (13 px wide) and the tram 18 px apart across, within 13 / 2 + 13 / 2 + 6: one, in the middle, the modes in their order
  const close = [{ x: 100, y: 100, modes: ['tram'] }, { x: 118, y: 104, modes: ['subway'] }, { x: 100, y: 200, modes: ['bus'] }];
  assert.deepEqual(mergePlaces(close, true, ORDER), [{ x: 109, y: 102, modes: ['subway', 'tram'] }, { x: 100, y: 200, modes: ['bus'] }]);
  // what was merged may touch another one: all three are one
  const chain = [{ x: 100, y: 100, modes: ['tram'] }, { x: 118, y: 100, modes: ['subway'] }, { x: 130, y: 100, modes: ['bus'] }];
  assert.deepEqual(mergePlaces(chain, true, ORDER).map((mark) => mark.modes), [['subway', 'tram', 'bus']]);
  // (the places as they came are left as they are)
  assert.deepEqual(close[0], { x: 100, y: 100, modes: ['tram'] });
});

test('the lines that join the marks of a station go the shortest way through all of them (#234)', () => {
  assert.deepEqual(joiningLines([{ x: 0, y: 0 }]), []);
  assert.deepEqual(joiningLines([{ x: 0, y: 0 }, { x: 10, y: 0 }]), [[0, 1]]);
  // trains far south, the U-Bahn between, tram and bus side by side in the north: a chain, no line from the trains to the north
  const hbf = [{ x: 300, y: 500 }, { x: 200, y: 290 }, { x: 280, y: 180 }, { x: 190, y: 190 }];
  assert.deepEqual(joiningLines(hbf), [[0, 1], [1, 3], [3, 2]]);
});

test('a name says its town where one of its words is the first long word of the town', () => {
  const shown = (name, town) => townToShow(name, town);
  assert.equal(shown('Marienplatz', 'München'), 'München');
  assert.equal(shown('Nürnberg Plärrer', 'Nürnberg'), null);
  assert.equal(shown('München-Pasing', 'München'), null);
  assert.equal(shown('Halle(Saale)Hbf', 'Halle (Saale)'), null);
  assert.equal(shown('Frankfurt (Main) Hauptwache', 'Frankfurt am Main'), null);
  // "Bad" is not the long word of the town, and a word that only begins like the town does not say it
  assert.equal(shown('Bad Kissingen Bahnhof', 'Bad Kissingen'), null);
  assert.equal(shown('Bad Bahnhof', 'Bad Kissingen'), 'Bad Kissingen');
  assert.equal(shown('Nürnberger Straße', 'Fürth'), 'Fürth');
  assert.equal(shown('Nürnberger Straße', 'Nürnberg'), 'Nürnberg');
  // nor does a town in short, which says it only to whoever knows it already
  assert.equal(shown('D-Froschenteich', 'Düsseldorf'), 'Düsseldorf');
  assert.equal(shown('Hauptbahnhof', null), null);
});

test('the stops of a trip through more than one town have the town where their name does not say it, those of a trip within one none (#246)', () => {
  const stops = (...named) => named.map(([name, town = null]) => ({ name, town }));
  const ice = stops(['Berlin Hbf', 'Berlin'], ['Halle(Saale)Hbf', 'Halle (Saale)'], ['Hauptbahnhof', 'Erfurt'], ['Bamberg', 'Bamberg'], ['Basel SBB']);
  assert.deepEqual(townsAlong(ice), [null, null, 'Erfurt', null, null]);
  // a tram that stays in Leipzig, beyond which no town is known
  const tram = stops(['Krakauer Str.', 'Leipzig'], ['Ratzelbogen', 'Leipzig'], ['Am Rande']);
  assert.deepEqual(townsAlong(tram), [null, null, null]);
});

// The outline of the heart (mdiHeart) as a line of points in its box of 24, to measure the dots of a favourite against
const cubic = (p0, p1, p2, p3, steps = 60) => Array.from({ length: steps }, (_, k) => {
  const t = (k + 1) / steps;
  const m = 1 - t;
  return [0, 1].map((i) => m * m * m * p0[i] + 3 * m * m * t * p1[i] + 3 * m * t * t * p2[i] + t * t * t * p3[i]);
});
const HEART_OUTLINE = [[12, 21.35], [10.55, 20.03], ...cubic([10.55, 20.03], [5.4, 15.36], [2, 12.27], [2, 8.5]), ...cubic([2, 8.5], [2, 5.41], [4.42, 3], [7.5, 3]),
  ...cubic([7.5, 3], [9.24, 3], [10.91, 3.81], [12, 5.08]), ...cubic([12, 5.08], [13.09, 3.81], [14.76, 3], [16.5, 3]), ...cubic([16.5, 3], [19.58, 3], [22, 5.41], [22, 8.5]),
  ...cubic([22, 8.5], [22, 12.27], [18.6, 15.36], [13.45, 20.03]), [12, 21.35]];
const toOutline = ([px, py]) => Math.min(...HEART_OUTLINE.slice(1).map(([bx, by], i) => {
  const [ax, ay] = HEART_OUTLINE[i];
  const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
  return Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay));
}));
const inHeart = ([px, py]) => HEART_OUTLINE.reduce((within, [xi, yi], i) => {
  const [xj, yj] = HEART_OUTLINE[(i || HEART_OUTLINE.length) - 1];
  return (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi ? !within : within;
}, false);

test('the heart of a favourite has a dot for each kind, inside it and clear of its edge and of each other (#245)', () => {
  for (const big of [false, true]) {
    let size = 0;
    for (let kinds = 1; kinds <= 6; kinds++) {
      const mark = heartMark(kinds, big);
      assert.equal(mark.dots.length, kinds);
      assert.equal(mark.dot, big ? 3 : 2.5);
      // (larger with more kinds, and from zoom 15)
      assert.ok(mark.size > size, `${kinds} kinds`);
      if (big) assert.ok(Math.abs(mark.size - (heartMark(kinds, false).size * 8) / 7) < 1e-9);
      size = mark.size;
      const unit = mark.size / 24;
      for (const [x, y] of mark.dots) {
        const at = [x / unit + HEART_MIDDLE[0], y / unit + HEART_MIDDLE[1]];
        assert.ok(inHeart(at), `${kinds} kinds: a dot outside the heart`);
        // (2 px from the line of the edge: 1.25 px clear of its stroke of 1.5)
        assert.ok(toOutline(at) * unit - mark.dot >= 2, `${kinds} kinds: a dot ${(toOutline(at) * unit - mark.dot).toFixed(2)} px from the edge`);
      }
      for (let i = 0; i < kinds; i++) for (let j = i + 1; j < kinds; j++) assert.ok(Math.hypot(mark.dots[i][0] - mark.dots[j][0], mark.dots[i][1] - mark.dots[j][1]) - 2 * mark.dot >= 1.9);
    }
  }
  // (one dot in the middle across; three as a triangle with sides of one length)
  assert.equal(heartMark(1, false).dots[0][0], 0);
  const [a, b, c] = heartMark(3, false).dots;
  const side = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  assert.ok(Math.abs(side(a, b) - side(b, c)) < 0.05 && Math.abs(side(a, c) - side(b, c)) < 0.05);
  // (more than six kinds as six, none as one)
  assert.equal(heartMark(8, false).dots.length, 6);
  assert.equal(heartMark(0, false).size, heartMark(1, false).size);
});

test('a favourite gets its name before the stations of rail, after an open stop (#245)', () => {
  const rail = { modes: ['subway', 'bus'] };
  const favourite = { modes: ['bus'], favourite: true };
  const open = { modes: ['bus'], open: true };
  assert.deepEqual([rail, open, favourite].sort(namePrecedence), [open, favourite, rail]);
});
