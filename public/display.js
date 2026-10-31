// Display mode in the address of the page: what an address asks for, and the
// address for what is shown. Without the page around it, so that it can be
// tested as it is (test/display.test.js).
//
// Display mode is the page without its controls. It comes from the address
// alone; the page makes such an address at "As a wall screen" in its settings
// (display=fixed). Of the card the title row stays, with an eye that brings
// the controls back, and the map is moved and what is on it chosen as before.
// While it lasts, the address of the page says what is shown, in place of
// what the browser has stored:
//   display                   the mode itself. display=fixed is for a screen
//                             on a wall that nobody operates: the map stands
//                             still and the page looks after itself
//   view=<lat>,<lon>,<zoom>   the section of the map, else the whole area
//   theme=light|dark          else as the device has it (first.js reads it)
//   color=delay               coloured by delay, else by kind of transport
//   flags=off                 without the delay flags
//   modes=tram,subway         only these kinds of transport, else all
//   times=time|minutes        departure times as the time of day or as the
//                             minutes until they leave, else both
//   clock=off                 no clock on the board of a stop
//   lang=…                    the language, as on the page with its controls
// and the board of a stop where one is open (below), and the lines of the stop
// that it shows where only some are chosen (lines=, choice.js). So the address can be
// kept, or given to another browser, and shows the same there – also in one
// that has nothing stored, as on many a wall.

import { parseAddress } from './address.js';
import { choiceValue } from './choice.js';

/**
 * What an address asks for, or null if it does not ask for a display.
 * The settings have the names and the shapes the page keeps them by in the
 * browser (loadSetting in app.js), and are no more to be trusted than those:
 * whoever reads one checks it.
 * @param search the query of the address, as location.search has it
 * @param modes  the kinds of transport there are
 */
export function readDisplay(search, modes) {
  const address = new URLSearchParams(search);
  if (!address.has('display')) return null;
  const [lat, lon, zoom] = (address.get('view') ?? '').split(',').map(Number);
  const shown = address.get('modes')?.split(',');
  return {
    fixed: address.get('display') === 'fixed',
    language: address.get('lang'),
    board: readBoard(search),
    settings: {
      view: address.has('view') ? { lat, lon, zoom } : null,
      theme: address.get('theme'),
      colorBy: address.get('color'),
      flags: address.get('flags') !== 'off',
      hiddenModes: shown ? modes.filter((mode) => !shown.includes(mode)) : [],
      times: address.get('times'),
      clock: address.get('clock') !== 'off',
    },
  };
}

/**
 * The query of the address of a display that shows this: what readDisplay
 * makes the same of again. Only what differs from a display without any
 * settings is named, but for the section of the map and the language.
 * @param modes the kinds of transport there are
 */
export function displayQuery({ fixed, language, board = null, stops = [], lines = [], settings: { view, theme, colorBy, flags, hiddenModes, times, clock } }, modes) {
  const asked = [fixed ? 'display=fixed' : 'display', `view=${view.lat.toFixed(4)},${view.lon.toFixed(4)},${view.zoom.toFixed(1)}`, `lang=${language}`];
  if (theme === 'light' || theme === 'dark') asked.push(`theme=${theme}`);
  if (colorBy === 'delay') asked.push('color=delay');
  if (!flags) asked.push('flags=off');
  if (hiddenModes.length) asked.push(`modes=${modes.filter((mode) => !hiddenModes.includes(mode)).join(',')}`);
  if (times === 'time' || times === 'minutes') asked.push(`times=${times}`);
  if (clock === false) asked.push('clock=off');
  if (board !== null) asked.push(`board=${board}`, ...stopsQuery(stops));
  if (lines.length) asked.push(`lines=${choiceValue(lines)}`);
  return `?${asked.join('&')}`;
}

// The board of a stop (#81): its details enlarged, beside the map or below
// it. Where one is open, the address of the stop says so, also on the page
// with its controls, so that it opens the same again:
//   board=<share>   the share of the screen the board takes, in percent;
//                   100 is all of it, without the map
// A board takes from BOARD_MIN to BOARD_MAX of the screen, or all of it.

export const BOARD_MIN = 25;
export const BOARD_MAX = 75;
/** What a board takes where nothing else is asked for. */
export const BOARD_SHARE = 50;
// (from this share on, a board is taken to be asked for all of the screen)
const ALONE_FROM = 90;

/** The share a board takes, in percent, of one that is asked for: 100 for all of the screen. */
export function boardShare(asked) {
  if (!Number.isFinite(asked)) return BOARD_SHARE;
  if (asked >= ALONE_FROM) return 100;
  return Math.round(Math.min(BOARD_MAX, Math.max(BOARD_MIN, asked)));
}

/** The share of the screen the board of a stop takes as an address asks for it, or null where it asks for none. */
export function readBoard(search) {
  const address = new URLSearchParams(search);
  if (!address.has('board')) return null;
  const asked = address.get('board');
  return boardShare(asked === '' ? BOARD_SHARE : Number(asked));
}

/**
 * The query of an address with a board that takes this share of the screen,
 * or with none (null), the further stops on it, and the lines of its stop
 * chosen to be shown (#164); what else it asks for stays as it was written.
 * @param search the query of the address so far, as location.search has it
 * @param stops the further stops of the board (readStops): written with a board only
 * @param lines the choice of the stop that is open (choice.js), none for every line
 */
export function boardQuery(search, share, stops = [], lines = []) {
  const kept = search.replace(/^\?/, '').split('&').filter((part) => part && !/^(board|with|block|lines)(=|$)/.test(part));
  if (share !== null) kept.push(`board=${share}`, ...stopsQuery(stops));
  if (lines.length) kept.push(`lines=${choiceValue(lines)}`);
  return kept.length ? `?${kept.join('&')}` : '';
}

// A board shows up to BOARD_STOPS stops (#163): the one the address is of,
// and after board= the others, in the order of the board:
//   with=<stop>    one in the same list as the stop before it, its
//                  departures and theirs together, in the order they leave
//   block=<stop>   one that begins a block of its own
// each named as its own address names it, without "stop/" (address.js), so
// that it is found again in later timetables. Only the order of with= and
// block= among each other says anything.
export const BOARD_STOPS = 4;

/**
 * The further stops of the board an address asks for: [{ path, joined }],
 * path as in the address, joined where it is in the list before it. None
 * without a board; of the same stop twice, and of what is no address of a
 * stop, nothing; at most BOARD_STOPS - 1.
 * @param first the path of the stop the address is of, without "stop/"
 */
export function readStops(search, first = '') {
  const address = new URLSearchParams(search);
  if (!address.has('board')) return [];
  const stops = [];
  // (the entries in the order of the address: getAll() would lose how with and block take turns)
  for (const [key, value] of address) {
    if (key !== 'with' && key !== 'block') continue;
    const path = value.toLowerCase();
    // (a "+" in it reads as a space, which no address has)
    if (parseAddress(`stop/${path}`)?.type !== 'stop' || path === first || stops.some((stop) => stop.path === path)) continue;
    stops.push({ path, joined: key === 'with' });
    if (stops.length === BOARD_STOPS - 1) break;
  }
  return stops;
}

/** The parts of a query that name the further stops of a board. Joined as text: URLSearchParams would write @ and , as %40 and %2C. */
const stopsQuery = (stops) => stops.map(({ path, joined }) => `${joined ? 'with' : 'block'}=${path}`);

/**
 * The stops of a board in its blocks: the first stop and the further ones
 * (readStops), each block a list of them in the order of the board.
 */
export function boardBlocks(first, stops) {
  const blocks = [[first]];
  for (const stop of stops) {
    if (stop.joined) blocks.at(-1).push(stop);
    else blocks.push([stop]);
  }
  return blocks;
}

/**
 * The stops of a board ([{ path, joined }], the first stop first) with
 * another one first: its block goes to the front with it at its head, and the
 * lists stay as they were.
 */
export function ledBy(list, lead) {
  const blocks = boardBlocks(list[0], list.slice(1));
  const own = blocks.find((block) => block.includes(lead));
  const ordered = [[lead, ...own.filter((entry) => entry !== lead)], ...blocks.filter((block) => block !== own)];
  return ordered.flatMap((block) => block.map((entry, i) => ({ path: entry.path, joined: i > 0 })));
}
