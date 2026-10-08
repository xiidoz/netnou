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
//   theme=light|dark          else as the device has it (theme.js reads it)
//   color=delay               coloured by delay, else by kind of transport
//   flags=off                 without the delay flags
//   modes=tram,subway         only these kinds of transport, else all
//   lang=…                    the language, as on the page with its controls
// So the address can be kept, or given to another browser, and shows the same
// there – also in one that has nothing stored, as on many a wall.

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
    settings: {
      view: address.has('view') ? { lat, lon, zoom } : null,
      theme: address.get('theme'),
      colorBy: address.get('color'),
      flags: address.get('flags') !== 'off',
      hiddenModes: shown ? modes.filter((mode) => !shown.includes(mode)) : [],
    },
  };
}

/**
 * The query of the address of a display that shows this: what readDisplay
 * makes the same of again. Only what differs from a display without any
 * settings is named, but for the section of the map and the language.
 * @param modes the kinds of transport there are
 */
export function displayQuery({ fixed, language, settings: { view, theme, colorBy, flags, hiddenModes } }, modes) {
  const asked = [fixed ? 'display=fixed' : 'display', `view=${view.lat.toFixed(4)},${view.lon.toFixed(4)},${view.zoom.toFixed(1)}`, `lang=${language}`];
  if (theme === 'light' || theme === 'dark') asked.push(`theme=${theme}`);
  if (colorBy === 'delay') asked.push('color=delay');
  if (!flags) asked.push('flags=off');
  if (hiddenModes.length) asked.push(`modes=${modes.filter((mode) => !hiddenModes.includes(mode)).join(',')}`);
  return `?${asked.join('&')}`;
}
