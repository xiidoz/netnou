// Display mode in the address of the page: what an address asks for, and the
// address for what is shown. Without the page around it, so that it can be
// tested as it is (test/display.test.js).
//
// Display mode is the page without its controls. A visitor gets there with
// the button with the eye in the title row and back the same way: of the card
// that row stays, and the map is moved and what is on it chosen as before.
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
// and the board of a stop where one is open (below). So the address can be
// kept, or given to another browser, and shows the same there – also in one
// that has nothing stored, as on many a wall.

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
export function displayQuery({ fixed, language, board = null, settings: { view, theme, colorBy, flags, hiddenModes, times, clock } }, modes) {
  const asked = [fixed ? 'display=fixed' : 'display', `view=${view.lat.toFixed(4)},${view.lon.toFixed(4)},${view.zoom.toFixed(1)}`, `lang=${language}`];
  if (theme === 'light' || theme === 'dark') asked.push(`theme=${theme}`);
  if (colorBy === 'delay') asked.push('color=delay');
  if (!flags) asked.push('flags=off');
  if (hiddenModes.length) asked.push(`modes=${modes.filter((mode) => !hiddenModes.includes(mode)).join(',')}`);
  if (times === 'time' || times === 'minutes') asked.push(`times=${times}`);
  if (clock === false) asked.push('clock=off');
  if (board !== null) asked.push(`board=${board}`);
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
 * or with none (null); what else it asks for stays as it was written.
 * @param search the query of the address so far, as location.search has it
 */
export function boardQuery(search, share) {
  const kept = search.replace(/^\?/, '').split('&').filter((part) => part && !/^board(=|$)/.test(part));
  if (share !== null) kept.push(`board=${share}`);
  return kept.length ? `?${kept.join('&')}` : '';
}
