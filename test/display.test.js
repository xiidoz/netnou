import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displayQuery, readDisplay } from '../public/display.js';

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
    settings: { view: null, theme: null, colorBy: null, flags: true, hiddenModes: [] },
  });
  // (as a browser writes it after a form, and with a value that means nothing)
  assert.equal(readDisplay('?display=', MODES).fixed, false);
  assert.equal(readDisplay('?display=wall', MODES).fixed, false);
  assert.equal(readDisplay('?display=fixed', MODES).fixed, true);
});

test('the address says what a display shows', () => {
  assert.deepEqual(readDisplay('?display=fixed&view=49.4478,11.0765,13.4&theme=dark&color=delay&flags=off&modes=tram,subway&lang=de', MODES), {
    fixed: true,
    language: 'de',
    settings: {
      view: { lat: 49.4478, lon: 11.0765, zoom: 13.4 },
      theme: 'dark',
      colorBy: 'delay',
      flags: false,
      hiddenModes: ['bus', 'suburban', 'regional', 'longdistance'],
    },
  });
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
    { fixed: false, language: 'de', settings: { view: { lat: 49.4478, lon: 11.0765, zoom: 14.2 }, theme: null, colorBy: null, flags: true, hiddenModes: [] } },
    { fixed: true, language: 'en', settings: { view: { lat: 50.3, lon: 11.9, zoom: 9 }, theme: 'dark', colorBy: 'delay', flags: false, hiddenModes: ['bus'] } },
    { fixed: false, language: 'de', settings: { view: { lat: -33.9, lon: 18.4, zoom: 11.5 }, theme: 'light', colorBy: null, flags: true, hiddenModes: MODES } },
  ];
  for (const display of displays) assert.deepEqual(readDisplay(displayQuery(display, MODES), MODES), display);

  assert.equal(displayQuery(displays[0], MODES), '?display&view=49.4478,11.0765,14.2&lang=de');
  assert.equal(displayQuery(displays[1], MODES), '?display=fixed&view=50.3000,11.9000,9.0&lang=en&theme=dark&color=delay&flags=off&modes=subway,tram,suburban,regional,longdistance');
  // what the page keeps for "as the device has it", or by the kind of transport, is not named
  assert.equal(displayQuery({ ...displays[0], settings: { ...displays[0].settings, theme: 'auto', colorBy: 'mode' } }, MODES), '?display&view=49.4478,11.0765,14.2&lang=de');
});
