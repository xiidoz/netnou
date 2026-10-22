import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOARD_MAX, BOARD_MIN, BOARD_SHARE, BOARD_STOPS, boardBlocks, boardQuery, boardShare, displayQuery, ledBy, readBoard, readDisplay, readStops } from '../public/display.js';

const MODES = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance'];

test('an address without "display" is not a display', () => {
  assert.equal(readDisplay('', MODES), null);
  assert.equal(readDisplay('?lang=de', MODES), null);
  assert.equal(readDisplay('?view=49.45,11.08,13&theme=dark', MODES), null);
});

test('a display without anything else shows the whole area as the device has it', () => {
  assert.deepEqual(readDisplay('?display', MODES), {
    fixed: false,
    language: null,
    board: null,
    settings: { view: null, theme: null, colorBy: null, flags: true, hiddenModes: [], times: null, clock: true },
  });
  // (as a browser writes it after a form, and with a value that means nothing)
  assert.equal(readDisplay('?display=', MODES).fixed, false);
  assert.equal(readDisplay('?display=wall', MODES).fixed, false);
  assert.equal(readDisplay('?display=fixed', MODES).fixed, true);
});

test('the address says what a display shows', () => {
  assert.deepEqual(readDisplay('?display=fixed&view=49.4478,11.0765,13.4&theme=dark&color=delay&flags=off&modes=tram,subway&times=minutes&clock=off&board=60&lang=de', MODES), {
    fixed: true,
    language: 'de',
    board: 60,
    settings: {
      view: { lat: 49.4478, lon: 11.0765, zoom: 13.4 },
      theme: 'dark',
      colorBy: 'delay',
      flags: false,
      hiddenModes: ['bus', 'suburban', 'regional', 'longdistance'],
      times: 'minutes',
      clock: false,
    },
  });
  // only "off" takes the clock away
  assert.equal(readDisplay('?display&clock=on', MODES).settings.clock, true);
  // only "off" takes the flags away, and a kind of transport nobody knows shows nothing more
  assert.equal(readDisplay('?display&flags=on', MODES).settings.flags, true);
  assert.deepEqual(readDisplay('?display&modes=tram,ferry', MODES).settings.hiddenModes, MODES.filter((mode) => mode !== 'tram'));
  assert.deepEqual(readDisplay('?display&modes=', MODES).settings.hiddenModes, MODES);
});

test('a section of the map that is none comes out as one that no map has', () => {
  // (the page takes a section only if all of it are numbers within its bounds)
  for (const view of ['abc', '49.45', '49.45,11.08', '49.45,x,13']) {
    const { lat, lon, zoom } = readDisplay(`?display&view=${view}`, MODES).settings.view;
    assert.ok(![lat, lon, zoom].every(Number.isFinite), view);
  }
});

test('the address written for a display reads as the same display again', () => {
  const displays = [
    { fixed: false, language: 'de', board: null, settings: { view: { lat: 49.4478, lon: 11.0765, zoom: 14.2 }, theme: null, colorBy: null, flags: true, hiddenModes: [], times: null, clock: true } },
    { fixed: true, language: 'en', board: 100, settings: { view: { lat: 50.3, lon: 11.9, zoom: 9 }, theme: 'dark', colorBy: 'delay', flags: false, hiddenModes: ['bus'], times: 'time', clock: false } },
    { fixed: false, language: 'de', board: 35, settings: { view: { lat: -33.9, lon: 18.4, zoom: 11.5 }, theme: 'light', colorBy: null, flags: true, hiddenModes: MODES, times: 'minutes', clock: true } },
  ];
  for (const display of displays) assert.deepEqual(readDisplay(displayQuery(display, MODES), MODES), display);

  assert.equal(displayQuery(displays[0], MODES), '?display&view=49.4478,11.0765,14.2&lang=de');
  assert.equal(displayQuery(displays[1], MODES), '?display=fixed&view=50.3000,11.9000,9.0&lang=en&theme=dark&color=delay&flags=off&modes=subway,tram,suburban,regional,longdistance&times=time&clock=off&board=100');
  // what the page keeps for "as the device has it", by the kind of transport, or both times, is not named
  assert.equal(displayQuery({ ...displays[0], settings: { ...displays[0].settings, theme: 'auto', colorBy: 'mode', times: 'both' } }, MODES), '?display&view=49.4478,11.0765,14.2&lang=de');
});

test('a board takes a share of the screen between its least and its most, or all of it', () => {
  assert.equal(boardShare(60), 60);
  assert.equal(boardShare(33.4), 33);
  assert.equal(boardShare(10), BOARD_MIN);
  assert.equal(boardShare(-5), BOARD_MIN);
  // (beyond its most it stays there, until it is nearly all of the screen: then it is all of it)
  assert.equal(boardShare(82), BOARD_MAX);
  assert.equal(boardShare(90), 100);
  assert.equal(boardShare(140), 100);
  assert.equal(boardShare(Number.NaN), BOARD_SHARE);
});

test('the address of a stop says whether its board is open, and how much of the screen it takes', () => {
  assert.equal(readBoard(''), null);
  assert.equal(readBoard('?lang=de'), null);
  assert.equal(readBoard('?board=60'), 60);
  assert.equal(readBoard('?lang=de&board=100'), 100);
  // (a board asked for without a share, or with one that is none, takes what a board takes by itself)
  assert.equal(readBoard('?board'), BOARD_SHARE);
  assert.equal(readBoard('?board='), BOARD_SHARE);
  assert.equal(readBoard('?board=half'), BOARD_SHARE);
  assert.equal(readBoard('?board=5'), BOARD_MIN);
});

test('the board goes into the address and out of it, and what else it asks for stays as it was', () => {
  assert.equal(boardQuery('', 60), '?board=60');
  assert.equal(boardQuery('?lang=de', 60), '?lang=de&board=60');
  assert.equal(boardQuery('?board=40&lang=de', 100), '?lang=de&board=100');
  assert.equal(boardQuery('?lang=de&board=40', null), '?lang=de');
  assert.equal(boardQuery('?board', null), '');
  // (as written, not as URLSearchParams would write it again)
  assert.equal(boardQuery('?display&view=49.4478,11.0765,14.2', 50), '?display&view=49.4478,11.0765,14.2&board=50');
  assert.equal(readBoard(boardQuery('?lang=en', 35)), 35);
});

// A board of several stops (#163): the first is the stop the address is of,
// the others follow its board= in the order of the board.
const PLAERRER = 'nuernberg-plaerrer@49.4483,11.0638';
const ROSENAU = 'nuernberg-rosenau@49.4466,11.0619';
const GOSTENHOF = 'nuernberg-gostenhof@49.4494,11.0573';
const WEISSER_TURM = 'nuernberg-weisser-turm@49.4513,11.0703';

test('the further stops of a board are read in the order of the address, merged or a block of their own', () => {
  assert.deepEqual(readStops(`?board=60&with=${ROSENAU}&block=${GOSTENHOF}`, PLAERRER), [{ path: ROSENAU, joined: true }, { path: GOSTENHOF, joined: false }]);
  // (whatever else the address asks for, before them or between)
  assert.deepEqual(readStops(`?lang=de&block=${GOSTENHOF}&times=minutes&board=60&with=${ROSENAU}`, PLAERRER), [{ path: GOSTENHOF, joined: false }, { path: ROSENAU, joined: true }]);
  // (@ and , as a link may carry them, and in capitals)
  assert.deepEqual(readStops(`?board=60&with=${ROSENAU.replace('@', '%40').replace(',', '%2C').toUpperCase()}`, PLAERRER), [{ path: ROSENAU, joined: true }]);
  // without a board they mean nothing
  assert.deepEqual(readStops(`?with=${ROSENAU}`, PLAERRER), []);
  // what is no address of a stop, the first stop again and a stop twice are left out
  assert.deepEqual(readStops(`?board=60&with=nuernberg+rosenau@49.4466,11.0619&block=line/vag/bus/36&with=${PLAERRER}&block=${ROSENAU}&with=${ROSENAU}&block=nowhere`, PLAERRER), [{ path: ROSENAU, joined: false }]);
  // at most four stops in all
  assert.equal(BOARD_STOPS, 4);
  assert.deepEqual(readStops(`?board=60&with=${ROSENAU}&with=${GOSTENHOF}&block=${WEISSER_TURM}&block=nuernberg-opernhaus@49.4468,11.0749`, PLAERRER).map((stop) => stop.path), [ROSENAU, GOSTENHOF, WEISSER_TURM]);
});

test('the further stops go into the address after the board, and read as the same board again', () => {
  const stops = [{ path: ROSENAU, joined: true }, { path: GOSTENHOF, joined: false }];
  const query = boardQuery('?lang=de', 60, stops);
  assert.equal(query, `?lang=de&board=60&with=${ROSENAU}&block=${GOSTENHOF}`);
  assert.deepEqual(readStops(query, PLAERRER), stops);
  // (written again, the old ones go, wherever they stood)
  assert.equal(boardQuery(`?with=${GOSTENHOF}&lang=de&board=60&block=${ROSENAU}`, 35, [{ path: ROSENAU, joined: false }]), `?lang=de&board=35&block=${ROSENAU}`);
  // without a board, without them
  assert.equal(boardQuery(`?lang=de&board=60&with=${ROSENAU}`, null, stops), '?lang=de');
  // a display names them after its board
  const display = { fixed: true, language: 'de', board: 60, stops, settings: { view: { lat: 49.448, lon: 11.061, zoom: 15 }, theme: null, colorBy: null, flags: true, hiddenModes: [], times: 'minutes', clock: true } };
  assert.equal(displayQuery(display, MODES), `?display=fixed&view=49.4480,11.0610,15.0&lang=de&times=minutes&board=60&with=${ROSENAU}&block=${GOSTENHOF}`);
  assert.deepEqual(readStops(displayQuery(display, MODES), PLAERRER), stops);
  assert.equal(displayQuery({ ...display, board: null }, MODES), '?display=fixed&view=49.4480,11.0610,15.0&lang=de&times=minutes');
});

test('the stops of a board stand in their blocks', () => {
  const first = { path: PLAERRER, joined: false };
  const rosenau = { path: ROSENAU, joined: true };
  const gostenhof = { path: GOSTENHOF, joined: false };
  const turm = { path: WEISSER_TURM, joined: true };
  assert.deepEqual(boardBlocks(first, []), [[first]]);
  assert.deepEqual(boardBlocks(first, [rosenau, gostenhof, turm]), [[first, rosenau], [gostenhof, turm]]);
  assert.deepEqual(boardBlocks(first, [{ ...rosenau, joined: false }, { ...gostenhof, joined: false }]), [[first], [{ ...rosenau, joined: false }], [{ ...gostenhof, joined: false }]]);
});

test('another stop leads a board with its block, and the lists stay as they were', () => {
  const missing = { path: PLAERRER, joined: false };
  const rosenau = { path: ROSENAU, joined: false };
  const gostenhof = { path: GOSTENHOF, joined: true };
  const turm = { path: WEISSER_TURM, joined: false };
  // ([missing] | [Rosenau + Gostenhof] | [Weißer Turm], led by Rosenau: its list first, the missing stop's block after it)
  assert.deepEqual(ledBy([missing, rosenau, gostenhof, turm], rosenau), [
    { path: ROSENAU, joined: false }, { path: GOSTENHOF, joined: true }, { path: PLAERRER, joined: false }, { path: WEISSER_TURM, joined: false },
  ]);
  // (all in one list: the missing stop stays in it, after the one that leads)
  assert.deepEqual(ledBy([missing, { ...rosenau, joined: true }, gostenhof], gostenhof), [
    { path: GOSTENHOF, joined: false }, { path: PLAERRER, joined: true }, { path: ROSENAU, joined: true },
  ]);
  assert.deepEqual(ledBy([missing, rosenau], missing), [{ path: PLAERRER, joined: false }, { path: ROSENAU, joined: false }]);
});

test('the address of a stop keeps the lines chosen of it, and loses them with another stop (#164)', () => {
  const lines = ['subway/u1~nuernberg-weisser-turm', 'tram/4'];
  assert.equal(boardQuery('?lang=de', null, [], lines), '?lang=de&lines=subway/u1~nuernberg-weisser-turm,tram/4');
  assert.equal(boardQuery('?lines=bus/36&board=60', 60, [], lines), '?board=60&lines=subway/u1~nuernberg-weisser-turm,tram/4');
  // (none chosen: none in the address, as for another stop or a line)
  assert.equal(boardQuery('?lang=de&lines=bus/36', null), '?lang=de');
  assert.equal(boardQuery('?lines=bus/36', null, [], []), '');
  const settings = { view: { lat: 49.4481, lon: 11.0648, zoom: 15 }, theme: 'auto', colorBy: 'mode', flags: true, hiddenModes: [], times: 'both', clock: true };
  assert.equal(displayQuery({ fixed: true, language: 'de', board: 100, lines: ['subway/u1~nuernberg-weisser-turm'], settings }, []), '?display=fixed&view=49.4481,11.0648,15.0&lang=de&board=100&lines=subway/u1~nuernberg-weisser-turm');
});
