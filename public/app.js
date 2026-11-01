// The server has no vehicle positions – the GTFS-Realtime feed only carries
// delays. For every vehicle it sends "knots": (time, lat, lon) along its route
// for the next minute or two, already shifted by the current delay. This
// script animates each vehicle along its knots and draws everything onto one
// canvas.
//
// No text for visitors is written out here: it comes from locales/ through t()
// (see i18n.js). Of what the server sends only data is shown – the names of
// lines, stops and operators, and the notes of the feed.

import { parseAddress, stopPath, wordsOf } from './address.js';
import { APP_NAME, READMES, dayOf, formatNumber, formatTime, languagePicker, loadLanguage, pageTexts, sentInAnother, setTimeZone, t, translatePage } from './i18n.js';
import { FAVOURITE_NAME_ZOOM, HEART_MIDDLE, PLACES_ZOOM, RAIL_MODES, heartMark, joiningLines, mergePlaces, namePrecedence, namedAt, placeNames, stopMark, townToShow, townsAlong, withoutStyleStops } from './stops.js';
import { favouritesFrom, isFavourite, lineFavourite, sameStop, stopFavourite, withChoice, withFavourite } from './favourites.js';
import { choiceValue, readChoice, toggled } from './choice.js';
import { DELAY_MAJOR_S, DELAY_MINOR_S, DELAY_SEVERE_S, MINUTES_MAX, NOTE_CHARS, badge as badgeOf, choiceChip as choiceChipOf, clockOf, delayCell as delayCellOf, delayClass, delayNode as delayNodeOf, delaySum as delaySumOf, delayFlag, delayText, departureLists, departuresSub as departuresSubOf, directionSign as directionSignOf, leavesAt, lineHead, lineLists, lineStops, minutesNode as minutesNodeOf, trackAt, VEHICLE_R, panelHead as panelHeadOf, stopHeading, tomorrowAt as tomorrowAtOf, untilText as untilTextOf, vehicleLabel, warningSign as warningSignOf, warns } from './panel.js';
import { BOARD_MAX, BOARD_SHARE, BOARD_STOPS, boardBlocks, boardQuery, boardShare, displayQuery, ledBy, readBoard, readDisplay, readStops } from './display.js';
import { mdiArrowCollapse, mdiArrowExpand, mdiChevronRight, mdiCityVariantOutline, mdiFullscreen, mdiFullscreenExit, mdiHeart, mdiHeartOutline, mdiMinusCircleOutline, mdiPlaylistPlus, mdiPlus } from './vendor/material-design-icons/icons.js';
import { AttributionControl, MapLibreMap, NavigationControl } from './vendor/maplibre-gl/maplibre-gl.mjs';

// The modes, each with a chip where the timetable has it. Same ids as MODES in
// server/lib/timetable.js, the --mode-* colors in style.css and the mode.*
// texts in locales/.
const MODES = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'ferry', 'cable', 'other'];
// Later entries are drawn on top: trains over trams over buses.
const DRAW_ORDER = ['other', 'bus', 'ferry', 'cable', 'tram', 'subway', 'suburban', 'regional', 'longdistance'];

// Display mode: the page without its controls, with what is shown in its
// address (see display.js for what an address says). ASKED is what the
// address the page was opened with asks for, if it asks for a display.
const ASKED = readDisplay(location.search, MODES);
const OPENED_AS_DISPLAY = ASKED !== null;
// A screen on a wall that nobody operates: the map stands still, and the page looks after itself (startFixed).
const FIXED = ASKED?.fixed ?? false;
const DISPLAY_LEAVE_MS = 6000; // how long the way out shows after a fixed display was touched
// A new version on the server (see "a new version"): how often a page in view
// asks for it, and how long nobody has to use the page before it loads itself again.
const VERSION_CHECK_MS = 5 * 60_000;
const IDLE_RELOAD_MS = 2 * 60_000;

// How departure times show, in every list of them (#81): the time of day,
// the minutes until it leaves, or both.
const TIMES = ['time', 'minutes', 'both'];
// (minutes count up to an hour, MINUTES_MAX in panel.js; a departure further off shows its time of day, #165)

const POLL_MS = 10_000;
const RETRY_LOADING_MS = 5000; // while the server has no timetable yet
const RETRY_NO_REALTIME_MS = 3000;
const QUICK_RETRIES = 5; // so often in a row; the realtime feed may also be down for hours
const PANEL_REFRESH_MS = 15_000;
const MOVE_SETTLE_MS = 150; // wait this long after the map was moved before reloading
const FRAME_MS = 80;
// Between two frames the vehicles move on by the time alone. Zoomed out that
// is less than the eye can tell: no frame is drawn before the fastest of
// them (FASTEST_M_S, a train at full speed) could have moved STILL_PX, half a
// pixel – seconds on a map of the whole country, where a frame draws
// thousands of markers. And a marker gliding to where it belongs stands
// there, as far as the eye is concerned, once it is nearer than that. See frame().
const FASTEST_M_S = 100;
const STILL_PX = 0.5;
const EASE_MS = 300;
const JUMP_DEG = 0.02; // a marker further off than this (1–2 km) jumps instead of gliding
// Share of the map section loaded beyond each of its edges.
const VEHICLE_MARGIN = 0.25;
const STATION_MARGIN = 0.5;
// Zoom levels are those of MapLibre, one less than the numbers in the address
// of a raster tile: at zoom 0 the world is 512 px wide, and any value in
// between two levels occurs.
const MIN_ZOOM = 5;
const MAX_ZOOM = 17;
// From LABEL_ZOOM vehicles carry their line and follow their route.
const LABEL_ZOOM = 12;
// Stations appear from STATION_ZOOM (rail only) and from ALL_STATIONS_ZOOM (all).
const STATION_ZOOM = 12;
const ALL_STATIONS_ZOOM = 14;
// A tap this near a stop opens it (#222): 28 px across, which a finger finds.
// Where it hits a vehicle as well, the vehicle wins (hitTest).
const STOP_HIT_PX = 14;
// Delay classes in seconds (DELAY_*_S in panel.js); the legend is made from them. A delay belongs to
// the class of the whole minutes it is shown as: what reads "+2" is "from 2 min".
// Vehicles count as being at one place when their markers are at most
// NEAR_IN_PX apart: one would hide the other. Once they do, they go on doing
// so up to NEAR_OUT_PX, or two that are about NEAR_IN_PX apart would be
// together in one frame and apart in the next.
const NEAR_IN_PX = 4;
const NEAR_OUT_PX = 8;
const PLACE_R = 5; // the dot that marks such a place, under the bubble with the vehicles
// The ring around the chosen vehicle: how far its middle is from the edge of
// the marker, how wide it is, and how wide the white edge on either side of it.
const RING_GAP = 5;
const RING_WIDTH = 2.5;
const RING_EDGE = 1;
// The ring of a stop of the selected trip or line (routeRing): closer to its mark than that of an open stop. And the zoom from which its stops are shown.
const ROUTE_RING_GAP = 3;
const ROUTE_STOPS_ZOOM = 11;
// The details as a sheet on a narrow screen: the share of the screen it takes
// at its middle height (as .panel in style.css), how far a finger has to
// move to drag and not to tap, how far below its lowest height the sheet
// has to be let go of to close, and from what speed (px per ms) letting go of
// it is a flick.
const SHEET_MIDDLE = 0.48;
const SHEET_DRAG_PX = 6;
const SHEET_CLOSE_PX = 56;
const SHEET_FLICK = 0.3;
// The notes in the head of the details, which does not scroll. On a narrow
// screen, where the details are a sheet and every note is one line: how many
// lines there are for all notes, the page's own among them. On a wide one
// those of the feed have these lines at least and a share of the height the
// details have by themselves, and a note may have so many characters to
// stand there in full.
const NOTES_LINES = 4;
const NOTES_SHARE = 0.25;
// (and NOTE_CHARS in panel.js)
// Realtime data older than this counts as timetable only. When its fetches
// fail, the server keeps the last delays up to the same age (STALE_AFTER_S in
// server/lib/realtime.js).
const LIVE_MAX_AGE_S = 180;
// Without any realtime data the page waits this long before it calls that an
// outage: the server may be fetching the feed for the first time, or again
// after a pause, and gives one fetch as long (FETCH_LIMIT_MS in
// server/lib/realtime-worker.js).
const REALTIME_GRACE_MS = 90_000;
// The visitor's own position: the first one brings the map in to LOCATE_ZOOM,
// and one that takes longer than LOCATE_TIMEOUT_MS to find counts as not found.
const LOCATE_ZOOM = 15;
const LOCATE_TIMEOUT_MS = 15_000;
const NOTE_MS = 6000; // a note on what the visitor just did goes away after this
// The search: how many towns, lines and stops it lists, the zoom a chosen stop
// brings the map in to, and how far in the map goes at most to show a line or
// a town.
const TOWN_LIMIT = 3;
const LINE_LIMIT = 3;
const SEARCH_LIMIT = 8;
const SEARCH_ZOOM = 16;
const LINE_ZOOM = 15;
const TOWN_ZOOM = 14;
const EQUATOR_M = 40_075_017; // its length; what a pixel of the map stands for follows from it

const $ = (id) => document.getElementById(id);

// No 'style' attribute: the Content-Security-Policy (server/index.js) forbids
// inline styles. Set node.style.… instead.
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'data') Object.assign(node.dataset, value);
    else if (key === 'onclick') node.addEventListener('click', value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

/**
 * Makes a tree of panel.js into elements of the page; an element of its own
 * may stand in it already. What is inside an svg is svg as well.
 */
function toDom(node, svg = false) {
  if (typeof node === 'string' || typeof node === 'number') return document.createTextNode(String(node));
  if (node instanceof Node) return node;
  const inSvg = svg || node.tag === 'svg';
  const out = inSvg ? document.createElementNS('http://www.w3.org/2000/svg', node.tag) : document.createElement(node.tag);
  for (const [key, value] of Object.entries(node.attrs)) if (value !== null && value !== undefined && value !== false) out.setAttribute(key, value === true ? '' : value);
  out.append(...node.children.map((child) => toDom(child, inSvg)));
  return out;
}

/**
 * What panel.js needs to draw: the texts, times of day and dates where the
 * area is, the clock, how departure times show, and for the vehicles of a
 * line as on the map, whether delays come in and how the vehicles are coloured and flagged.
 */
function drawing() {
  return { t, time: formatTime, day: dayOf, now: now(), times: state.times, live: realtimeState() === 'live', colorBy: state.colorBy, flags: state.flags, moving: true };
}

// The icons on the page's own buttons are from Material Design Icons
// (vendor/material-design-icons), each the shape of one icon in a box of 24 by
// 24; style.css gives it its size and its colour. Shapes and not characters:
// where a character sits in its box is up to the font, and the font is the
// device's. Those of index.html are in the page as it comes: the server draws
// them where data-icon asks for one, as this does for what the script builds
// (iconSvg in server/lib/page.js).
function icon(shape) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  // (what it is on says what it is for)
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', shape);
  svg.append(path);
  return svg;
}

// What is stored may be anything – written by another version of the page or
// by hand – so whoever reads a setting checks its shape.
function loadSetting(key, fallback) {
  // (a page opened as a display has its settings from the address)
  if (ASKED) return ASKED.settings[key] ?? fallback;
  try {
    return JSON.parse(localStorage.getItem(`netnou.${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  // (a display keeps what is set in its address, see writeAddress)
  if (state.display) {
    writeAddress();
    return;
  }
  try {
    localStorage.setItem(`netnou.${key}`, JSON.stringify(value));
  } catch {
    // private mode or blocked storage: the setting just does not persist
  }
}

// The favourites (#245, favourites.js) are kept in the browser beside the
// settings, but are none of them: the address of a display does not carry
// them, and the page reads them whatever it was opened as.
const FAVOURITES_KEY = 'netnou.favourites';
let favourites = (() => {
  try {
    return favouritesFrom(JSON.parse(localStorage.getItem(FAVOURITES_KEY)));
  } catch {
    return favouritesFrom(null);
  }
})();

function keepFavourites() {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites));
  } catch {
    // private mode or blocked storage: they last as long as the page
  }
}

// The texts come first: the map takes those of its controls when it is created.
// (The page came in its own language, which is the visitor's in most cases:
// then this changes nothing in it.)
const language = await loadLanguage();
translatePage();

// ---------- state ----------

const state = {
  clockOffset: 0, // server time minus browser time, seconds
  vehicles: new Map(),
  drawList: [],
  counts: {}, // vehicles per mode in the whole area, from the server
  kinds: null, // the modes the timetable has, from the server: a chip for each of them
  loaded: null, // map section and detail the vehicles were last requested for
  stations: [],
  stationsLoaded: null, // map section the stations were requested for
  realtimeAt: null,
  scheduleOnly: 0, // answers without realtime data in a row
  // For telling an outage from a start, see realtimeState(): since when (browser clock, ms)
  // the page has been asking, and whether it has had current realtime data since then.
  askingSince: Date.now(),
  wasLive: false,
  online: false, // last poll delivered vehicles
  areaKnown: false, // api/area has answered: the map shows the area
  addressOpened: false, // what the address of the page names has been asked for (openAddress)
  viewAsked: false, // the address of a display named the section of the map, which the stop it names then does not move (loadArea)
  outline: [], // the edge of the area: rings of [lat, lon]; none where the instance has no area
  bbox: null, // the rectangle around the area, or around all the instance covers: [south, west, north, east]
  thinned: false, // the last answer left vehicles out: zoomed out, where a screen cannot take them all
  many: true, // the last answer held thousands of vehicles (MANY); assumed until the first one is there
  enabled: new Set(MODES),
  display: OPENED_AS_DISPLAY, // the map without the controls, see "display mode"
  colorBy: loadSetting('colorBy', 'mode') === 'delay' ? 'delay' : 'mode',
  flags: loadSetting('flags', true) !== false, // the vehicles carry their delay as a flag
  theme: 'auto', // one of THEMES, see there
  times: 'both', // one of TIMES, see there
  clock: loadSetting('clock', true) !== false, // the board of a stop has a clock
  board: null, // the share of the screen in percent the open stop takes as a board, or null for its details (see "the board")
  extra: [], // the further stops on the board of the open stop: [{ path, joined }], see "a board of several stops"
  adding: null, // while the search is to add a stop to the board: { block } or { block: null } for a block of its own
  selection: null, // { type: 'trip' | 'station' | 'line', id, data }, see select()
  lines: [], // the lines and directions of the open stop that are chosen to be shown, none for every line (#164, choice.js)
  directions: null, // what there is to choose from at the open stop: { id, list } as api/departures has it
  view: 'departures', // what the open stop shows, of VIEWS in panel.js: its next departures or all its lines (#255)
  hits: [], // what can be pointed at on the map: { x, y, r, vehicle or station; named: a stop with its name on the map }, see draw()
  covers: [], // the boxes of the bubbles, which hide what is under them: [x, y, width, height]
  chosenAt: null, // where on the screen the chosen vehicle is drawn, if it is in view: { x, y, … }
  position: null, // the visitor's own while they have it shown: { lat, lon, accuracy in metres, stale }
  follow: false, // the map stays centred on it
  banner: null, // what the banner says for as long as it is so
  note: null, // what it says in its place for a moment, on something the visitor did
};
// Stored are the modes switched off, so that a mode added later starts switched on.
const hiddenModes = loadSetting('hiddenModes', []);
if (Array.isArray(hiddenModes)) for (const mode of MODES) if (hiddenModes.includes(mode)) state.enabled.delete(mode);

const now = () => Date.now() / 1000 + state.clockOffset;

// Colors live in style.css so that canvas and DOM share one palette.
let colors = {};
function readColors() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(name).trim();
  colors = { mode: {}, delay: {}, letters: get('--letters'), stopEdge: get('--stop-edge'), text: get('--text'), bg: get('--bg'), border: get('--border'), accent: get('--accent'), muted: get('--text-muted'), veil: get('--veil'), veilLine: get('--veil-line'), location: get('--location') };
  for (const mode of DRAW_ORDER) colors.mode[mode] = get(`--mode-${mode}`);
  for (const cls of ['early', 'ok', 'minor', 'major', 'severe', 'none']) colors.delay[cls] = get(`--delay-${cls}`);
}
readColors();

// Light or dark: the visitor's choice in the settings, or 'auto' for what the
// device has. first.js puts it on the page, before this script runs and again
// whenever it changes; the colours drawn here follow.
const THEMES = ['auto', 'light', 'dark'];
// The colour a browser gives its own bars, one per scheme (index.html), each as the file has it.
const barColors = [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) => ({ meta, own: meta.content, scheme: meta.media.includes('dark') ? 'dark' : 'light' }));

function applyTheme() {
  // (without first.js the page stays light)
  window.applyColorScheme?.();
  // (a browser picks the bar colour by the device's scheme: with a choice, both say the chosen one)
  const chosen = barColors.find(({ scheme }) => scheme === state.theme)?.own;
  for (const { meta, own } of barColors) meta.content = chosen ?? own;
  readColors();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  applyTheme();
  draw();
});

// ---------- map ----------

/**
 * A style for MapLibre out of a URL template for raster tiles. Of the
 * placeholders besides {z}, {x} and {y} it knows {s}, the subdomains a to c,
 * and {r}, "@2x" on a dense screen. A tile shows as soon as it is there:
 * fading it in would have the map drawn frame after frame while tiles arrive.
 */
function rasterStyle(template) {
  const url = template.replace('{r}', window.devicePixelRatio > 1 ? '@2x' : '');
  const tiles = url.includes('{s}') ? ['a', 'b', 'c'].map((subdomain) => url.replace('{s}', subdomain)) : [url];
  return { version: 8, sources: { tiles: { type: 'raster', tiles, tileSize: 256, maxzoom: 19 } }, layers: [{ id: 'tiles', type: 'raster', source: 'tiles', paint: { 'raster-fade-duration': 0 } }] };
}

/**
 * A style with the names on the map in the visitor's language. Styles for
 * tiles in the OpenMapTiles scheme, which most vector tiles follow, ask for
 * the English name of a place (name_en) before its local one; here the name
 * in the visitor's language takes the place of the English one. A style that
 * names places in another way stays as it is.
 */
function localizedStyle(style) {
  if (language === 'en') return style;
  const own = ['coalesce', ['get', `name:${language}`], ['get', 'name']];
  const rewrite = (value) => (!Array.isArray(value) ? value : value[0] === 'get' && value[1] === 'name_en' ? own : value.map(rewrite));
  const localized = (layer) => ({ ...layer, layout: { ...layer.layout, 'text-field': rewrite(layer.layout['text-field']) } });
  return { ...style, layers: style.layers.map((layer) => (layer.layout?.['text-field'] ? localized(layer) : layer)) };
}

let map;
try {
  map = new MapLibreMap({
    container: 'map',
    // Which part of the world to show, and with which map, the server says
    // (see loadArea). Until then the map has no style, not even an empty one:
    // without one MapLibre draws nothing, and the map of the area is the
    // first it loads. That one it shows without fading its labels in, in a
    // handful of frames where it would take dozens.
    center: [0, 0],
    zoom: MIN_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
    // (a display on a wall is looked at, not moved)
    interactive: !FIXED,
    // North stays up and the view flat.
    dragRotate: false,
    touchPitch: false,
    maxPitch: 0,
    // (added in loadArea, with the credits for the data)
    attributionControl: false,
    locale: {
      'Map.Title': t('map.label'),
      'NavigationControl.ZoomIn': t('map.zoomIn'),
      'NavigationControl.ZoomOut': t('map.zoomOut'),
      'AttributionControl.ToggleAttribution': t('map.credits'),
    },
  });
} catch (err) {
  // MapLibre draws with WebGL 2, which an old browser lacks and a locked-down
  // one refuses. Without a map there is nothing to show.
  showBanner(t('map.unsupported'));
  throw err;
}
map.touchZoomRotate.disableRotation();
map.keyboard.disableRotation();

// The area is far larger than a screen at street level, so only what is in
// view (plus a margin, so that small pans need no reload) is requested.
// Zoomed out, where hundreds of vehicles are dots, a reduced form without
// route geometry is enough.
/** [south, west, north, east] of a map section, widened on every side by a share of its height and width. */
function boxAround(bounds, margin) {
  const lat = (bounds.getNorth() - bounds.getSouth()) * margin;
  const lon = (bounds.getEast() - bounds.getWest()) * margin;
  return [bounds.getSouth() - lat, bounds.getWest() - lon, bounds.getNorth() + lat, bounds.getEast() + lon];
}
const boxQuery = (box) => box.map((v) => v.toFixed(4)).join(',');
const boxCovers = (box, bounds) => box[0] <= bounds.getSouth() && box[1] <= bounds.getWest() && box[2] >= bounds.getNorth() && box[3] >= bounds.getEast();
// Whether there is a pointer that can rest on something without pressing it:
// a mouse can, a finger cannot.
const hovering = matchMedia('(hover: hover)');
// An answer with more vehicles than the first number counts as one of
// thousands, until one has fewer than the second.
const MANY = [3000, 2500];
/**
 * How much of each vehicle the map asks for. Zoomed in, its way along its
 * route. Zoomed out it is a dot, and where it is and where it gets in a
 * minute is all the map draws of it: a pointer that rests on it is also told
 * where it goes ('lite'). Without such a pointer nothing would show that, and
 * among thousands of vehicles it is not worth twice the size: the answer is
 * then the smallest there is ('minimal').
 */
const detailWanted = () => (map.getZoom() >= LABEL_ZOOM ? 'full' : hovering.matches && !state.many ? 'lite' : 'minimal');
/** The zoom a request names, in quarters: where a screen cannot take every vehicle, the answer is thinned out for that zoom. */
const zoomAsked = () => Math.floor(map.getZoom() * 4) / 4;

/**
 * The kinds of transport that are switched on, for the request for the
 * vehicles, where any is off: the answer leaves the others out, and where it
 * is thinned out, more of these fit.
 */
function modesQuery() {
  const on = MODES.filter((mode) => state.enabled.has(mode));
  return on.length === MODES.length ? '' : `&modes=${on.join(',')}`;
}

/**
 * What a visitor has picked, for the request for the vehicles: a line shown
 * alone and the vehicle of an open trip are on the map at every zoom, also
 * where the answer is thinned out.
 */
function pickedQuery() {
  const selection = state.selection;
  if (selection?.type === 'trip') return `&vehicle=${encodeURIComponent(selection.id)}`;
  if (selection?.type === 'line') return `&${new URLSearchParams({ line: selection.line.name, mode: selection.line.mode, agency: selection.line.agency, ...(selection.line.at ? { at: selection.line.at.join(',') } : {}) })}`;
  return '';
}

/**
 * After something was picked or let go of: where vehicles are left out, they
 * are asked for again at once, so that what is picked comes and what no
 * longer is goes. `before` is pickedQuery() as it was.
 */
function pickedChanged(before) {
  if (state.thinned && pickedQuery() !== before) poll();
}

/** The vehicles of an answer in the smallest form, which has a column for each property, as an object each. */
function fromColumns({ now, ahead, vehicles: { id, line, mode, delay, unit, at } }) {
  return id.map((value, i) => ({
    id: value,
    line: line[i],
    mode: mode[i],
    delay: delay[i],
    unit: unit[i] ?? undefined,
    // where it is now and where in `ahead` seconds: the first as whole numbers of 1e-5 degrees, the second as how far from there
    knots: [now, at[4 * i] / 1e5, at[4 * i + 1] / 1e5, now + ahead, (at[4 * i] + at[4 * i + 2]) / 1e5, (at[4 * i + 1] + at[4 * i + 3]) / 1e5],
  }));
}
/** How many metres a pixel of the map stands for at a latitude and a zoom level. */
const metresPerPixel = (lat, zoom) => (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

// All that is Netnou's own is drawn on one canvas lying on the map. The mouse
// and the fingers go through it to the map (see .overlay-canvas in style.css).
const canvas = el('canvas', { class: 'overlay-canvas' });
map.getCanvasContainer().append(canvas);
const ctx = canvas.getContext('2d');
let viewSize = { x: 0, y: 0 };

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const container = map.getContainer();
  viewSize = { x: container.clientWidth, y: container.clientHeight };
  canvas.width = Math.round(viewSize.x * dpr);
  canvas.height = Math.round(viewSize.y * dpr);
  canvas.style.width = `${viewSize.x}px`;
  canvas.style.height = `${viewSize.y}px`;
  draw();
}

// The map moves frame by frame, also while it zooms, and the canvas with it.
map.on('move', () => draw());
map.on('resize', resizeCanvas);

// ---------- vehicle positions ----------

/**
 * Position at a time along knots [t0, lat0, lon0, t1, lat1, lon1, …]; k = knot being approached.
 * Same interpolation as positionAt in server/lib/timetable.js.
 */
function positionAt(knots, time) {
  const n = knots.length;
  if (time <= knots[0]) return { lat: knots[1], lon: knots[2], k: -1 };
  for (let k = 3; k < n; k += 3) {
    if (time < knots[k]) {
      const span = knots[k] - knots[k - 3];
      const f = span > 0 ? (time - knots[k - 3]) / span : 1;
      const moving = knots[k + 1] !== knots[k - 2] || knots[k + 2] !== knots[k - 1];
      return {
        lat: knots[k - 2] + (knots[k + 1] - knots[k - 2]) * f,
        lon: knots[k - 1] + (knots[k + 2] - knots[k - 1]) * f,
        k: moving ? k : -1,
      };
    }
  }
  return { lat: knots[n - 2], lon: knots[n - 1], k: -1 };
}

function applyVehicles(list) {
  const seen = new Set();
  for (const v of list) {
    seen.add(v.id);
    const known = state.vehicles.get(v.id);
    if (known) Object.assign(known, v);
    else state.vehicles.set(v.id, { ...v, label: vehicleLabel(v.line), lat: null, lon: null });
  }
  for (const id of state.vehicles.keys()) if (!seen.has(id)) state.vehicles.delete(id);
  state.drawList = [...state.vehicles.values()].sort((a, b) => DRAW_ORDER.indexOf(a.mode) - DRAW_ORDER.indexOf(b.mode));
  // (those that have come show with the next frame, those that have gone go with it)
  askDraw();
}

// ---------- drawing ----------

let lastDraw = 0;
// When the next frame is due, see frame(): at once where something has
// changed that the canvas shows, or a marker is still gliding; else after
// the fastest vehicle could have moved half a pixel at this zoom (quietMs).
let drawAsked = true;
let settling = false;
let quietMs = FRAME_MS;

function vehicleColor(v) {
  return state.colorBy === 'delay' ? colors.delay[delayClass(v.delay)] : colors.mode[v.mode] ?? colors.mode.other;
}

/** By name, numbers by their value: N2 before N10. For the order within a group, which must not change from frame to frame. */
const byLabel = (a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }) || (a.id < b.id ? -1 : 1);

// (the helpers that draw a vehicle draw on the map, or where they are given another canvas: the stops of a line)
function setLabelFont(label, c = ctx) {
  c.font = `700 ${label.length > 3 ? 8 : label.length > 2 ? 9.5 : 11}px system-ui, sans-serif`;
}

/** The path of a box with round corners. */
function roundedBox(x, y, w, h, radius, c = ctx) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, radius);
  else c.rect(x, y, w, h);
}

/**
 * The arrowhead of what is under way, pointing along the angle a from a
 * circle of radius r around (x, y). In the colours set; drawn before what it
 * belongs to, which covers its base.
 */
function drawArrow(x, y, r, a, c = ctx) {
  c.beginPath();
  c.moveTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
  c.lineTo(x + Math.cos(a + 0.6) * r, y + Math.sin(a + 0.6) * r);
  c.lineTo(x + Math.cos(a - 0.6) * r, y + Math.sin(a - 0.6) * r);
  c.closePath();
  c.stroke();
  c.fill();
}

/** The round marker of a vehicle, with its name where there is room for one. */
function drawDisc(x, y, r, v, labeled, c = ctx) {
  // outline and label are white in both themes
  c.strokeStyle = '#fff';
  c.fillStyle = vehicleColor(v);
  c.lineWidth = labeled ? 1.5 : 1;
  c.beginPath();
  c.arc(x, y, r, 0, 2 * Math.PI);
  c.fill();
  c.stroke();
  if (!labeled) return;
  c.fillStyle = colors.letters;
  setLabelFont(v.label, c);
  c.fillText(v.label, x, y + 0.5);
}

/**
 * The ring around the chosen vehicle, in its colour. Drawn before its marker,
 * so that the arrow and the flag of the marker lie on it and not under it.
 * The ring has a thin edge of white on its inside and its outside, as the
 * markers have one: the route of the trip has the same colour and runs right
 * under it, and the edges keep the two apart.
 * @param w the width of a marker for several, 0 for a round one
 */
function drawRing(x, y, r, w, color) {
  // (the outline of the marker, moved out by RING_GAP)
  if (w) roundedBox(x - w / 2 - RING_GAP, y - r - RING_GAP, w + 2 * RING_GAP, 2 * (r + RING_GAP), r + RING_GAP);
  else {
    ctx.beginPath();
    ctx.arc(x, y, r + RING_GAP, 0, 2 * Math.PI);
  }
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = RING_WIDTH + 2 * RING_EDGE;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = RING_WIDTH;
  ctx.stroke();
}

/**
 * The flag a vehicle carries at its shoulder (delayFlag in panel.js), in its
 * colour. None when the vehicles are coloured by delay: the colour says both
 * then. And none at all for a visitor who has switched the flags off.
 */
function flagOf(v, live) {
  if (state.colorBy !== 'mode' || !state.flags) return null;
  const flag = delayFlag(v.delay, live);
  return flag && { text: flag.text, color: colors.delay[flag.color] };
}

/** The flag of a vehicle at x, y: its width. */
function drawFlag(x, y, flag, c = ctx) {
  c.font = '700 9px system-ui, sans-serif';
  const w = flag.text === '?' ? 12 : c.measureText(flag.text).width + 6;
  c.fillStyle = flag.color;
  roundedBox(x, y, w, 12, 4, c);
  c.fill();
  // (with the white edge of the markers: a flag may have about the colour of the one it sits on, green on an S-Bahn)
  c.strokeStyle = '#fff';
  c.lineWidth = 1;
  c.stroke();
  c.fillStyle = colors.letters;
  c.fillText(flag.text, x + w / 2, y + 6.5);
  return w;
}

/**
 * The mark of a stop: a white pill with a dot in the colour of each kind that
 * calls there (stopMark), the same in both themes, as the vehicles keep their
 * colours. Its size, as stopMark gives it.
 */
function drawStop(x, y, modes, big) {
  const kinds = MODES.filter((mode) => modes.includes(mode));
  const mark = stopMark(kinds.length, big);
  roundedBox(x - mark.w / 2, y - mark.h / 2, mark.w, mark.h, mark.corner);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = colors.stopEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  kinds.forEach((mode, i) => {
    ctx.beginPath();
    ctx.arc(x + mark.dots[i][0], y + mark.dots[i][1], mark.dot, 0, 2 * Math.PI);
    ctx.fillStyle = colors.mode[mode] ?? colors.mode.other;
    ctx.fill();
  });
  return mark;
}

/**
 * The mark of a favourite stop (#245): a white heart with the dots of its
 * kinds (heartMark), its edge as the pill has it. Its size, as heartMark gives it.
 */
function drawHeartStop(x, y, modes, big) {
  const kinds = MODES.filter((mode) => modes.includes(mode));
  const mark = heartMark(kinds.length, big);
  const shape = heartShape(x, y, mark.size);
  ctx.fillStyle = '#fff';
  ctx.fill(shape);
  ctx.strokeStyle = colors.stopEdge;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke(shape);
  kinds.forEach((mode, i) => {
    ctx.beginPath();
    ctx.arc(x + mark.dots[i][0], y + mark.dots[i][1], mark.dot, 0, 2 * Math.PI);
    ctx.fillStyle = colors.mode[mode] ?? colors.mode.other;
    ctx.fill();
  });
  return mark;
}

const HEART = new Path2D(mdiHeart);
/** The outline of the heart of mdiHeart, with the middle of the mark at x, y and its box of 24 this many px. */
function heartShape(x, y, size) {
  const shape = new Path2D();
  shape.addPath(HEART, new DOMMatrix().translate(x - (HEART_MIDDLE[0] / 24) * size, y - (HEART_MIDDLE[1] / 24) * size).scale(size / 24));
  return shape;
}

// The ring of an open favourite follows its heart at the same distance all
// round, RING_GAP as the ring of a pill: the outline grown by a wide stroke,
// less the outline grown by a narrower one, which a path alone cannot say.
// So it is cut on a canvas of its own, once for each heart and set of
// colours, and laid on the map from there.
const heartRings = new Map();
function heartRing(x, y, modes, big) {
  const kinds = MODES.filter((mode) => modes.includes(mode)).map((mode) => colors.mode[mode] ?? colors.mode.other);
  const dpr = ctx.getTransform().a;
  const key = `${kinds.join()} ${big} ${dpr}`;
  if (!heartRings.has(key)) heartRings.set(key, cutHeartRing(kinds, big, dpr));
  const ring = heartRings.get(key);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(ring, Math.round(x * dpr - ring.width / 2), Math.round(y * dpr - ring.height / 2));
  ctx.restore();
}

function cutHeartRing(kinds, big, dpr) {
  const { size } = heartMark(kinds.length, big);
  const side = Math.ceil((size + 2 * (RING_GAP + RING_WIDTH + RING_EDGE + 2)) * dpr);
  const canvasOf = () => (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(side, side) : Object.assign(document.createElement('canvas'), { width: side, height: side }));
  // (what lies from `from` to `to` px outside the heart, in one style)
  const band = (canvas, from, to, style) => {
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const shape = heartShape(side / dpr / 2, side / dpr / 2, size);
    c.lineJoin = 'round';
    c.fillStyle = style;
    c.strokeStyle = style;
    c.lineWidth = 2 * to;
    c.fill(shape);
    c.stroke(shape);
    c.globalCompositeOperation = 'destination-out';
    c.lineWidth = 2 * from;
    c.fill(shape);
    c.stroke(shape);
    return c;
  };
  // (the colours of the kinds round it as kindsRing has them, on white edges)
  const colour = canvasOf();
  let style = kinds[0] ?? colors.mode.other;
  if (kinds.length > 1) {
    style = colour.getContext('2d').createConicGradient(-Math.PI / 2, side / dpr / 2, side / dpr / 2);
    kinds.forEach((kind, i) => {
      style.addColorStop(i / kinds.length, kind);
      style.addColorStop((i + 1) / kinds.length, kind);
    });
  }
  band(colour, RING_GAP, RING_GAP + RING_WIDTH, style);
  const ring = canvasOf();
  const c = band(ring, RING_GAP - RING_EDGE, RING_GAP + RING_WIDTH + RING_EDGE, '#fff');
  c.globalCompositeOperation = 'source-over';
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.drawImage(colour, 0, 0);
  return ring;
}

// ---------- the lines of a stop to show (#164) ----------

// Beside "Departures" a chip says which lines a stop's departures are of: all,
// or only those chosen. It opens a sheet to choose them in, the directions of
// each line as chips; its cross shows every line again. A direction is a line
// with where it goes next (choice.js), and its sign is the line as the map
// draws its vehicle, the arrowhead turned to where it leaves the stop.

/** The sign of a direction (panel.js), for the chip and the sheet. */
function directionSign(direction) {
  return toDom(directionSignOf(direction));
}

/** The directions of the open stop there is to choose from, if they are known: as api/departures lists them. */
const stopDirections = () => (state.directions && state.directions.id === state.selection?.data?.id ? state.directions.list : null);

/** What a direction is called: where its trips go, and where another direction of its line goes there too, by way of where. */
function directionName(direction, list) {
  const twin = list.some((other) => other !== direction && other.mode === direction.mode && other.line === direction.line && other.to === direction.to);
  return twin ? t('choice.via', { to: direction.to, stop: direction.next }) : direction.to;
}

/**
 * The line below the name of the open stop: the switch between its next
 * departures and all its lines (#255), and the chip of the lines the
 * departures are of. A board has no switch, as it shows the departures
 * alone: "Departures" and the chip. A screen on a wall has neither: it shows
 * its stop as it was set up, at a platform those of the platform, and nobody
 * is to choose there.
 */
function departuresSub(board = false) {
  return toDom(departuresSubOf(FIXED || board ? null : state.view, FIXED ? null : choiceChip(), drawing()));
}

/** Shows the stops of the open line in its other direction (#256), with what the last answer had of them. */
function showWay(way) {
  const selection = state.selection;
  if (selection?.type !== 'line' || !selection.data || selection.way === way) return;
  selection.way = way;
  renderLine(selection.data, false);
}

/** Shows the next departures of the open stop, or all its lines (#255): those of the last answer at once, if it had them, and asked for anew. */
function showView(view) {
  if (view === state.view || state.selection?.type !== 'station') return;
  state.view = view;
  showSelection(false);
  loadSelection();
}

/** The chip: every line, or "only" and the directions chosen (panel.js); a tap on it opens the sheet, its cross shows all again (see the details' clicks). */
function choiceChip() {
  const list = stopDirections() ?? [];
  const chosen = state.lines.map((key) => list.find((direction) => direction.key === key)).filter(Boolean);
  return choiceChipOf(chosen.map((direction) => ({ ...direction, name: directionName(direction, list) })), drawing());
}

// The sheet in which they are chosen: a dialog as the one of the notes.
const choiceDialog = $('choice');
closesByClick(choiceDialog, $('choice-close'));
// (the focus goes back to the chip, built anew meanwhile)
choiceDialog.addEventListener('close', () => {
  if (!panelHead.contains(document.activeElement)) (panelHead.querySelector('.choice-open') ?? panel).focus({ preventScroll: true });
});

function openChoice() {
  renderChoice();
  choiceDialog.showModal();
  $('choice-list').parentNode.scrollTop = 0;
}

/** Fills the sheet: every line with its directions, on where they are shown. */
function renderChoice() {
  const list = stopDirections();
  const node = $('choice-list');
  if (!list) {
    node.replaceChildren(el('p', { text: t('panel.loading') }));
    return;
  }
  const focused = node.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  const all = !state.lines.length;
  const chip = (key, pressed, children, onclick) => el('button', { type: 'button', class: 'chip', 'aria-pressed': String(pressed), data: { key }, onclick }, children);
  const lines = [];
  for (const direction of list) {
    const last = lines.at(-1);
    if (last && last.mode === direction.mode && last.line === direction.line) last.directions.push(direction);
    else lines.push({ mode: direction.mode, line: direction.line, directions: [direction] });
  }
  node.replaceChildren(
    // (every line again, where only some are shown: while all are, it would do nothing)
    ...(all ? [] : [chip('', false, [el('span', { class: 'name', text: t('choice.all') })], () => applyChoice([]))]),
    el('ul', { class: 'choice-lines' }, lines.map(({ directions }) => el('li', {}, directions.map((direction) => {
      const name = directionName(direction, list);
      const on = all || state.lines.includes(direction.key) || state.lines.includes(direction.key.split('~')[0]);
      const button = chip(direction.key, on, [directionSign(direction), el('span', { class: 'name', text: name })], () => applyChoice(toggled(state.lines, direction.key)));
      button.dataset.mode = direction.mode;
      button.setAttribute('aria-label', t('choice.direction', { line: direction.line, to: name }));
      return button;
    })))),
  );
  if (focused !== null && focused !== undefined) node.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
}

/**
 * Shows these lines of the open stop, every one for none: in the address,
 * in its favourite if it is one, and asked for anew, as the server chooses
 * among the departures before it counts them (#164).
 */
function applyChoice(keys) {
  const data = state.selection?.data;
  if (state.selection?.type !== 'station' || !data) return;
  state.lines = keys;
  state.selection.linesAsked = true;
  if (state.display) writeAddress();
  else history.replaceState(null, '', `${location.pathname}${boardQuery(location.search, state.board, state.extra, state.lines)}`);
  if (isFavourite(favourites, 'stops', data)) {
    favourites = withChoice(favourites, data, keys);
    keepFavourites();
  }
  if (choiceDialog.open) renderChoice();
  // (the chip at once; the departures with the answer)
  showSelection(false);
  loadSelection();
}

/**
 * An open stop: its departures as they came (the answer of api/departures, or
 * what a board keeps of a further stop), its id and the kinds that call
 * there – as its station on the map has them, else as its departures say.
 */
function openStop(place) {
  const data = place.departures && !Array.isArray(place.departures) ? place.departures : place;
  const station = state.stations.find((each) => each.id === data.id);
  if (station) return { id: data.id, modes: station.modes, places: station.places ?? null };
  const seen = new Set((data.departures ?? []).map((departure) => departure.mode));
  return { id: data.id, modes: MODES.filter((mode) => seen.has(mode)), places: null };
}

/**
 * Where the marks of a station are on the screen: from PLACES_ZOOM one at
 * each of its places, where its modes stop apart (#234), those that would
 * touch as one (mergePlaces); else one at its own point.
 * @param station { lat, lon, modes }
 * @param places its places as api/stations has them, or null
 * @returns [{ x, y, modes }]
 */
function marksOf(station, places, zoom, big, project) {
  if (zoom < PLACES_ZOOM || !places) {
    const [x, y] = project(station.lat, station.lon);
    return [{ x, y, modes: station.modes }];
  }
  return mergePlaces(places.map((place) => {
    const [x, y] = project(place.lat, place.lon);
    return { x, y, modes: place.modes };
  }), big, MODES);
}

/** The dashed lines that join the marks of a station (#234): dark on the light map, light on the dark one. */
function drawJoins(pairs) {
  if (!pairs.length) return;
  ctx.beginPath();
  for (const [a, b] of pairs) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.strokeStyle = colors.text;
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * The colour of the ring around an open stop (#234): those of its kinds in
 * turn around it, as the dot under a bubble shows those of the vehicles in it,
 * and as a chosen vehicle has a ring in its own colour.
 */
function kindsRing(x, y, modes) {
  const kinds = MODES.filter((mode) => modes.includes(mode)).map((mode) => colors.mode[mode]);
  if (kinds.length < 2 || !ctx.createConicGradient) return kinds[0] ?? colors.mode.other;
  const ring = ctx.createConicGradient(-Math.PI / 2, x, y);
  kinds.forEach((color, i) => {
    ring.addColorStop(i / kinds.length, color);
    ring.addColorStop((i + 1) / kinds.length, color);
  });
  return ring;
}

// The widths of the names of stops, in the font they are drawn in (draw), measured once each.
const nameWidths = new Map();
function nameWidth(name) {
  let width = nameWidths.get(name);
  if (width === undefined) {
    width = ctx.measureText(name).width;
    nameWidths.set(name, width);
  }
  return width;
}

function stationShown(station, zoom) {
  if (zoom >= ALL_STATIONS_ZOOM) return station.modes.some((mode) => state.enabled.has(mode));
  if (zoom >= STATION_ZOOM) return station.modes.some((mode) => RAIL_MODES.includes(mode) && state.enabled.has(mode));
  return false;
}

/**
 * The route the map draws for what is selected (#148): of a trip, its path
 * and its stops at their platforms; of a line, the paths of its trips of the
 * day and the stations they call at. Each stop has a key by which the
 * stations of the map are told to be one of them (`calls`, `keyOf`): the id
 * of its station, or for a line, whose route has the places of its stations
 * alone, that place, as api/stations has it too. Null where nothing with a
 * route is selected.
 * @param selection state.selection
 * @returns { paths, mode, stops: [{ lat, lon, key }], keyOf, calls } or null
 */
function routeShown(selection) {
  let route = null;
  if (selection?.type === 'trip' && selection.data) {
    const { path, stops, mode } = selection.data;
    route = { paths: [path], mode, stops: stops.map(({ lat, lon, station }) => ({ lat, lon, key: station })), keyOf: (station) => station.id };
  } else if (selection?.type === 'line' && selection.route) {
    const { paths, stations } = selection.route;
    const keyOf = (station) => `${station.lat},${station.lon}`;
    const stops = [];
    for (let i = 0; i < stations.length; i += 2) stops.push({ lat: stations[i], lon: stations[i + 1], key: keyOf({ lat: stations[i], lon: stations[i + 1] }) });
    route = { paths, mode: selection.line.mode, stops, keyOf };
  }
  if (!route) return null;
  const keys = new Set(route.stops.map((stop) => stop.key));
  return { ...route, calls: (station) => keys.has(route.keyOf(station)) };
}

/**
 * The ring of the mark of a stop of the selected route: in the colour of its
 * mode, ROUTE_RING_GAP out from the pill and with white edges, as the ring of
 * an open stop has them; round a heart, the heart's own ring.
 */
function routeRing(mark, mode, big) {
  if (mark.favourite) {
    heartRing(mark.x, mark.y, [mode], big);
    return;
  }
  const pill = stopMark(mark.kinds.length, big);
  roundedBox(mark.x - pill.w / 2 - ROUTE_RING_GAP, mark.y - pill.h / 2 - ROUTE_RING_GAP, pill.w + 2 * ROUTE_RING_GAP, pill.h + 2 * ROUTE_RING_GAP, pill.corner + ROUTE_RING_GAP);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = RING_WIDTH + 2 * RING_EDGE;
  ctx.stroke();
  ctx.strokeStyle = colors.mode[mode] ?? colors.mode.other;
  ctx.lineWidth = RING_WIDTH;
  ctx.stroke();
}

function draw() {
  const time = now();
  // The time the markers glide by (ease, below). Where vehicles have just
  // come, that of one frame however long the last one is ago: the glide of a
  // marker to where it now belongs starts with this frame.
  const dt = Math.min(performance.now() - lastDraw, drawAsked ? FRAME_MS : 1000);
  lastDraw = performance.now();
  drawAsked = false;
  settling = false;

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewSize.x, viewSize.y);

  const zoom = map.getZoom();
  const project = (lat, lon) => {
    const point = map.project([lon, lat]);
    return [point.x, point.y];
  };
  // How far a degree is in pixels here, for how far a marker is from where it
  // belongs: along the parallel, and along the meridian at the middle of the
  // view (near enough; the map is flat and north is up).
  const centreLat = map.getCenter().lat;
  const pxPerLon = (512 * 2 ** zoom) / 360;
  const pxPerLat = pxPerLon / Math.cos((centreLat * Math.PI) / 180);
  quietMs = Math.max(FRAME_MS, (1000 * STILL_PX * metresPerPixel(centreLat, zoom)) / FASTEST_M_S);
  // (with a margin: a marker whose centre is just outside still reaches in)
  const onScreen = (x, y) => x > -30 && y > -30 && x < viewSize.x + 30 && y < viewSize.y + 30;
  const hits = [];
  const selection = state.selection;

  // Everything outside the area, where vehicles are only followed roughly, is
  // greyed out: the whole view with the area as its hole. On this canvas and
  // not as a layer of the map, whose colours the dark theme turns round (see
  // --map-filter in style.css).
  if (state.outline.length) {
    const edge = new Path2D();
    for (const ring of state.outline) {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = project(ring[i][0], ring[i][1]);
        if (i) edge.lineTo(x, y);
        else edge.moveTo(x, y);
      }
      edge.closePath();
    }
    const veil = new Path2D(edge);
    veil.rect(0, 0, viewSize.x, viewSize.y);
    ctx.fillStyle = colors.veil;
    ctx.fill(veil, 'evenodd');
    ctx.strokeStyle = colors.veilLine;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke(edge);
  }

  // Stops (#222): each a pill with the dots of its kinds (drawStop), and its
  // name beside it from the zoom namedAt says, where there is room. A station
  // whose modes stop at places apart has a mark at each from PLACES_ZOOM
  // (marksOf), every one with its name, and dashed lines join them, so that
  // they show as one station (#234). Under the vehicles, which may stand on
  // them; the lines under the marks. A favourite stop is a heart
  // (drawHeartStop), at every zoom and with its name from FAVOURITE_NAME_ZOOM
  // (#245). Below ALL_STATIONS_ZOOM, where the map has no stops of its own,
  // it lies above the vehicles, which would hide it there (`lifted`, drawn
  // after them); from there with the other stops, under them.
  // The route of the selected trip, or that of the selected line: where its
  // trips of the day run (#148). Lines in the colour of the mode, one stroke
  // for all, so that where they lie on each other they are no darker; under
  // the stops and their names. Its stops are the marks of the stations it
  // calls at, from zoom 11, each in a ring of its colour (routeRing): one
  // mark for a stop, where a dot of its own would stand beside the mark –
  // the platform of a trip is not where the mark of its station is, between
  // its platforms – or on it. Where the map has no mark of the station, a dot
  // where the route stops; a station it passes keeps its mark as it is.
  const route = routeShown(selection);
  if (route) {
    ctx.beginPath();
    for (const path of route.paths) {
      for (let i = 0; i < path.length; i += 2) {
        const [x, y] = project(path[i], path[i + 1]);
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = colors.mode[route.mode] ?? colors.mode.other;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const routeStops = route !== null && zoom >= ROUTE_STOPS_ZOOM;

  const big = zoom >= 15;
  const above = zoom < ALL_STATIONS_ZOOM;
  const shownFavourites = FIXED ? [] : favourites.stops; // (a screen on a wall shows what its address says)
  const isFavouriteStop = (stop) => shownFavourites.some((kept) => sameStop(kept, stop));
  const marks = [];
  const joins = [];
  const drawn = new Set(); // (the stations whose marks are on the map)
  for (const station of state.stations) {
    if (!stationShown(station, zoom)) continue;
    const favourite = isFavouriteStop(station);
    if (favourite && above) continue;
    const parts = marksOf(station, station.places, zoom, big, project);
    if (!parts.some(({ x, y }) => onScreen(x, y))) continue;
    drawn.add(station.id);
    for (const [a, b] of joiningLines(parts)) joins.push([parts[a], parts[b]]);
    // (of a station the route calls at, the mark of the place of its mode: those of its other modes stay as they are)
    const calledAt = routeStops && route.calls(station);
    for (const part of parts) {
      const hit = { x: part.x, y: part.y, r: STOP_HIT_PX, station };
      hits.push(hit);
      const ringed = calledAt && part.modes.includes(route.mode);
      marks.push({ x: part.x, y: part.y, kinds: part.modes, id: station.id, name: station.name, modes: station.modes, favourite, hit, ...(ringed ? { ringed, key: route.keyOf(station), space: ROUTE_RING_GAP + RING_WIDTH + 4 } : {}) });
    }
  }
  // (the dots where the route stops, of the stations whose mark is not on the map: under the marks of others)
  if (routeStops) {
    const marked = new Set(marks.filter((mark) => mark.ringed).map((mark) => mark.key));
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.mode[route.mode] ?? colors.mode.other;
    for (const stop of route.stops) {
      if (marked.has(stop.key)) continue;
      const [x, y] = project(stop.lat, stop.lon);
      if (!onScreen(x, y)) continue;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.stroke();
    }
  }
  drawJoins(joins);
  for (const mark of marks) {
    if (mark.ringed) routeRing(mark, route.mode, big);
    Object.assign(mark, (mark.favourite ? drawHeartStop : drawStop)(mark.x, mark.y, mark.kinds, big));
  }
  // The station whose departures are open, at any zoom, and the further stops
  // of its board: on top of the others, each of their marks in a ring in the
  // colours of its kinds (kindsRing), as the chosen vehicle has one in its
  // own, and with their names.
  const open = [];
  if (selection?.type === 'station' && selection.data?.lat !== undefined) {
    const further = state.board === null ? [] : state.extra.map((stop) => boardStopData.get(stop.path)).filter((place) => place && !place.gone);
    for (const place of [selection.data, ...further]) {
      const { id, modes, places } = openStop(place);
      const parts = marksOf({ lat: place.lat, lon: place.lon, modes }, places, zoom, big, project);
      // (its lines, where its marks are not on the map with the others)
      if (!drawn.has(id)) drawJoins(joiningLines(parts).map(([a, b]) => [parts[a], parts[b]]));
      // (the name of the mark nearest the station's own point goes wherever it falls, as an open stop's does)
      const [px, py] = project(place.lat, place.lon);
      const nearest = parts.reduce((best, part) => (Math.hypot(part.x - px, part.y - py) < Math.hypot(best.x - px, best.y - py) ? part : best));
      // (an open favourite has its hearts in rings of their shape, above the vehicles where the others are, see "Stops")
      const loved = isFavouriteStop(place);
      for (const { x, y, modes: kinds } of parts) {
        if (loved) {
          if (!above) heartRing(x, y, kinds, big);
          const mark = above ? heartMark(kinds.length, big) : drawHeartStop(x, y, kinds, big);
          open.push({ x, y, ...mark, kinds, id, name: place.name, modes, open: x === nearest.x && y === nearest.y, ringed: true, space: RING_GAP + RING_WIDTH + 4, favourite: true, lifted: above });
          continue;
        }
        const mark = stopMark(kinds.length, big);
        // (the outline of the pill moved out by RING_GAP, with white edges, as drawRing has it)
        roundedBox(x - mark.w / 2 - RING_GAP, y - mark.h / 2 - RING_GAP, mark.w + 2 * RING_GAP, mark.h + 2 * RING_GAP, mark.corner + RING_GAP);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = RING_WIDTH + 2 * RING_EDGE;
        ctx.stroke();
        ctx.strokeStyle = kindsRing(x, y, kinds);
        ctx.lineWidth = RING_WIDTH;
        ctx.stroke();
        drawStop(x, y, kinds, big);
        open.push({ x, y, ...mark, id, name: place.name, modes, open: x === nearest.x && y === nearest.y, ringed: true, space: RING_GAP + RING_WIDTH + 4 });
      }
    }
  }
  const openIds = new Set(open.map((mark) => mark.id));
  // (the favourites above the vehicles, but for an open one: as the station on
  // the map has them, else as they were kept, where the map has no station)
  const lifted = [];
  if (above) {
    for (const kept of shownFavourites) {
      const station = state.stations.find((each) => sameStop(kept, each)) ?? { ...kept, modes: kept.modes ?? [] };
      if (openIds.has(station.id) || !station.modes.some((mode) => state.enabled.has(mode))) continue;
      const [x, y] = project(station.lat, station.lon);
      if (!onScreen(x, y)) continue;
      lifted.push({ x, y, ...heartMark(station.modes.length, big), kinds: station.modes, id: station.id, name: station.name, modes: station.modes, favourite: true, lifted: true, station });
    }
  }
  const hasName = (mark) => namedAt(mark.modes, zoom) || (mark.favourite && zoom >= FAVOURITE_NAME_ZOOM);
  const stopNames = [...open, ...marks.filter((mark) => !openIds.has(mark.id) && hasName(mark)), ...lifted.filter(hasName)].sort(namePrecedence);
  // (the lifted ones get theirs after the vehicles, with them)
  const liftedNames = [];
  const writeName = (mark, left) => {
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = colors.bg;
    ctx.fillStyle = colors.text;
    // (a halo in the colour of the ground, so that the name reads on any map)
    ctx.strokeText(mark.name, left, mark.y + 0.5);
    ctx.fillText(mark.name, left, mark.y + 0.5);
  };
  if (stopNames.length) {
    ctx.font = '600 12px system-ui, sans-serif';
    for (const mark of stopNames) mark.width = nameWidth(mark.name);
    // (clear of every mark, an open one with its ring)
    const obstacles = [...marks, ...open, ...lifted].map(({ x, y, w, h, ringed }) => {
      const out = ringed ? RING_GAP + RING_WIDTH : 0;
      return [x - w / 2 - out, y - h / 2 - out, w + 2 * out, h + 2 * out];
    });
    const lefts = placeNames(stopNames, obstacles);
    const withNames = [];
    stopNames.forEach((mark, i) => {
      if (lefts[i] === null) return;
      if (mark.lifted) liftedNames.push([mark, lefts[i]]);
      else {
        writeName(mark, lefts[i]);
        withNames.push(mark);
      }
    });
    // (a mark whose name is on the map needs no tooltip to say it again; that of an open one is its own)
    for (const mark of withNames) {
      if (mark.hit) mark.hit.named = true;
      else for (const other of marks) if (other.id === mark.id && Math.abs(other.x - mark.x) < 4 && Math.abs(other.y - mark.y) < 4) other.hit.named = true;
    }
  }

  // While a line is looked at, its vehicles are the only ones, whatever the filters say.
  const only = selection?.type === 'line' ? selection.ids : null;
  // How large the vehicles are. Those of a line that is looked at are few and
  // what the map is about: they carry their name at any zoom.
  const labeled = zoom >= LABEL_ZOOM || Boolean(only);
  const r = labeled ? (zoom >= 14 ? 11 : 10) : 4.5;
  // A vehicle without a reported delay carries a sign of that – while others
  // have one. Without any realtime data the card says so once (updateStatus).
  const live = realtimeState() === 'live';

  // The visitor's own position, under the vehicles. The ring around it is
  // wider than their markers, the arrow and the ring of the selected one
  // included, so that it shows around a vehicle the visitor is in.
  if (state.position) {
    const { lat, lon, accuracy, stale } = state.position;
    const [x, y] = project(lat, lon);
    const ring = r + 9;
    const color = stale ? colors.muted : colors.location;
    // how far off it may be, in its true size – where that is more than the ring shows anyway
    const spread = accuracy / metresPerPixel(lat, zoom);
    if (spread > ring) {
      ctx.beginPath();
      ctx.arc(x, y, spread, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.16;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // (white under the colour and around the dot, as around the vehicles: it shows on any map)
    ctx.beginPath();
    ctx.arc(x, y, ring, 0, 2 * Math.PI);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // vehicles
  // Ease towards the computed position so that a changed delay does not make
  // the marker jump.
  const ease = 1 - Math.exp(-dt / EASE_MS);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // The chosen one has a ring around it and is drawn after the others of its
  // kind, so that none of them lies on it. Where it is drawn, if it is in view: { x, y }.
  let chosen = null;
  const isChosen = (v) => selection?.type === 'trip' && selection.id === v.id;
  const named = []; // those that are drawn with their name: { v, x, y, a }

  for (const v of state.drawList) {
    if (only ? !only.has(v.id) : !state.enabled.has(v.mode)) continue;
    const target = positionAt(v.knots, time);
    if (v.lat === null || Math.abs(target.lat - v.lat) + Math.abs(target.lon - v.lon) > JUMP_DEG) {
      v.lat = target.lat;
      v.lon = target.lon;
    } else {
      v.lat += (target.lat - v.lat) * ease;
      v.lon += (target.lon - v.lon) * ease;
    }
    const [x, y] = project(v.lat, v.lon);
    if (!onScreen(x, y)) continue;
    // (still on its way to where it belongs: the next frame follows at once)
    if (!settling && Math.abs(target.lat - v.lat) * pxPerLat + Math.abs(target.lon - v.lon) * pxPerLon > STILL_PX) settling = true;

    if (!labeled) {
      hits.push({ x, y, r: Math.max(r + 3, 10), vehicle: v });
      // (the chosen one after the loop)
      if (isChosen(v)) chosen = { x, y, dot: v };
      else drawDisc(x, y, r, v, false);
      continue;
    }
    // under way: the direction, towards the next stop
    let a = null;
    if (target.k > 0) {
      const [ax, ay] = project(v.knots[target.k - 2], v.knots[target.k - 1]);
      const [bx, by] = project(v.knots[target.k + 1], v.knots[target.k + 2]);
      a = Math.atan2(by - ay, bx - ax);
    }
    named.push({ v, x, y, a });
  }
  if (chosen?.dot) {
    drawRing(chosen.x, chosen.y, r, 0, vehicleColor(chosen.dot));
    drawDisc(chosen.x, chosen.y, r, chosen.dot, false);
  }

  // Which of them are at one place: so close that one would hide the other,
  // and standing there together or heading the same way. Two that only pass
  // each other are not. The first one found at a place stands for it.
  const groups = [];
  for (const entry of named) {
    const home = groups.find(([first]) => {
      const limit = entry.v.near === first.v.id ? NEAR_OUT_PX : NEAR_IN_PX;
      if (Math.abs(entry.x - first.x) > limit || Math.abs(entry.y - first.y) > limit) return false;
      if (entry.a === null || first.a === null) return entry.a === first.a;
      return Math.cos(entry.a - first.a) > 0.85; // within about 30 degrees
    });
    if (home) home.push(entry);
    else groups.push([entry]);
  }
  for (const group of groups) for (const { v } of group) v.near = group.length > 1 ? group[0].v.id : null;

  // One vehicle at a place is a round marker. Trains that run coupled (the
  // server says which, see `unit` in docs/api.md) are one marker with the name
  // of each. Whatever else is at one place – buses at a stop, trains that
  // stand at the same platform – is in a bubble above it, drawn last and so
  // on top of all else.
  const bubbles = [];
  const holdsChosen = (group) => group.some((member) => isChosen(member.v));
  // (the one with the chosen vehicle last)
  for (const group of [...groups].sort((one, other) => holdsChosen(one) - holdsChosen(other))) {
    const [{ v, x, y, a }] = group;
    if (group.length > 1 && !group.every((other) => other.v.unit && other.v.unit === v.unit)) {
      bubbles.push(group);
      continue;
    }
    const color = vehicleColor(v);
    if (group.length === 1) {
      if (isChosen(v)) {
        drawRing(x, y, r, 0, color);
        chosen = { x, y };
      }
      ctx.strokeStyle = '#fff';
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5;
      if (a !== null) drawArrow(x, y, r, a);
      drawDisc(x, y, r, v, true);
      const flag = flagOf(v, live);
      if (flag) drawFlag(x + r * 0.55, y - r - 5, flag);
      hits.push({ x, y, r: Math.max(r + 3, 10), vehicle: v });
      continue;
    }

    // coupled: one marker in the colour of the mode, as long as its names need
    const members = group.map((member) => member.v).sort(byLabel);
    const widths = members.map((member) => {
      setLabelFont(member.label);
      return Math.max(2 * r - 2, ctx.measureText(member.label).width + 8);
    });
    const w = widths.reduce((sum, width) => sum + width, 2);
    if (holdsChosen(group)) {
      drawRing(x, y, r, w, color);
      chosen = { x, y };
    }
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    // (the arrowhead leaves it where it is heading: at an end, or in between for up and down)
    if (a !== null) drawArrow(x + (w / 2 - r) * Math.cos(a), y, r, a);
    roundedBox(x - w / 2, y - r, w, 2 * r, r);
    ctx.fill();
    ctx.stroke();
    let left = x - w / 2 + 1;
    members.forEach((member, i) => {
      const middle = left + widths[i] / 2;
      ctx.fillStyle = colors.letters;
      setLabelFont(member.label);
      ctx.fillText(member.label, middle, y + 0.5);
      // each name is its own to point at
      hits.push({ x: middle, y, r: Math.max(widths[i] / 2 + 2, 10), vehicle: member });
      left += widths[i];
      if (i === members.length - 1) return;
      ctx.beginPath();
      ctx.moveTo(left, y - r + 4);
      ctx.lineTo(left, y + r - 4);
      ctx.strokeStyle = 'rgb(255 255 255 / 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    // (they run by the same times: the delay of one is that of all)
    const flag = flagOf(members[0], live);
    if (flag) drawFlag(x + w / 2 - r * 0.45, y - r - 5, flag);
  }

  // The favourites lifted above the vehicles (see "Stops" above), with their
  // names. A tap finds them before the vehicles under them.
  for (const mark of open) {
    if (!mark.lifted) continue;
    heartRing(mark.x, mark.y, mark.kinds, big);
    drawHeartStop(mark.x, mark.y, mark.kinds, big);
  }
  for (const mark of lifted) {
    drawHeartStop(mark.x, mark.y, mark.kinds, big);
    hits.push({ x: mark.x, y: mark.y, r: Math.max(STOP_HIT_PX, mark.w / 2), station: mark.station, above: true, named: liftedNames.some(([withName]) => withName === mark) });
  }
  for (const [mark, left] of liftedNames) writeName(mark, left);

  // What a bubble covers cannot be pointed at through it (hitTest).
  const covers = [];
  for (const group of bubbles) {
    const [{ x, y, a }] = group;
    const members = group.map((member) => member.v).sort(byLabel);
    const flags = members.map((member) => flagOf(member, live));
    // One flag on the bubble where it is the same for all in it; else each has its own, which takes some room.
    const shared = flags[0] && flags.every((flag) => flag?.text === flags[0].text) ? flags[0] : null;
    const own = !shared && flags.some(Boolean);
    const perRow = members.length <= 3 ? members.length : Math.ceil(Math.sqrt(members.length));
    const rows = Math.ceil(members.length / perRow);
    const cell = 2 * r + 3;
    const across = cell + (own ? 11 : 0);
    const down = cell + (own ? 5 : 0);
    const pad = 5;
    const padTop = pad + (own ? 2 : 0);
    const w = perRow * across + 2 * pad + (own ? 4 : 0);
    const h = rows * down + padTop + pad;
    // above the place, or below it where there is no room above; and within the sides of the map
    const below = y - 14 - h < 4;
    const bx = Math.max(4, Math.min(viewSize.x - w - 4, x - w / 2));
    const by = below ? y + 14 : y - 14 - h;
    const tip = Math.max(bx + 12, Math.min(bx + w - 12, x));
    const edge = below ? by : by + h;
    const out = below ? -7 : 7;

    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / 0.3)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = colors.bg;
    roundedBox(bx, by, w, h, 9);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = colors.border;
    ctx.lineWidth = 1;
    roundedBox(bx + 0.5, by + 0.5, w - 1, h - 1, 9);
    ctx.stroke();
    // its tip, pointing at the place
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.moveTo(tip - 6, edge - Math.sign(out));
    ctx.lineTo(tip, edge + out);
    ctx.lineTo(tip + 6, edge - Math.sign(out));
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tip - 6, edge - Math.sign(out) * 0.5);
    ctx.lineTo(tip, edge + out);
    ctx.lineTo(tip + 6, edge - Math.sign(out) * 0.5);
    ctx.stroke();

    const cellAt = (i) => [bx + pad + cell / 2 + (i % perRow) * across, by + padTop + down - cell / 2 + Math.floor(i / perRow) * down];
    // (its ring under all the markers: they are too close to each other for a ring to go between them)
    const picked = members.findIndex(isChosen);
    if (picked >= 0) {
      const [cx, cy] = cellAt(picked);
      // (kept within the bubble: at its edge the white of the ring would stand out over it by a hair)
      ctx.save();
      roundedBox(bx, by, w, h, 9);
      ctx.clip();
      drawRing(cx, cy, r, 0, vehicleColor(members[picked]));
      ctx.restore();
      chosen = { x: cx, y: cy };
    }
    members.forEach((member, i) => {
      const [cx, cy] = cellAt(i);
      drawDisc(cx, cy, r, member, true);
      if (own && flags[i]) drawFlag(cx + r * 0.55, cy - r - 5, flags[i]);
      hits.push({ x: cx, y: cy, r: cell / 2, vehicle: member, top: true });
    });
    if (shared) drawFlag(bx + w - 8, by - 6, shared);
    covers.push([bx, Math.min(by, edge + out), w, h + 7]);

    // The place itself: the small dot a vehicle is on a map zoomed out, with a
    // slice in each of the colours of those in the bubble – and with the
    // direction if all of them are under way together.
    const kinds = [...new Set(group.map((member) => vehicleColor(member.v)))];
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    if (group.every((member) => member.a !== null)) {
      ctx.fillStyle = kinds[0];
      drawArrow(x, y, PLACE_R, a);
    }
    kinds.forEach((color, i) => {
      // (from the top, clockwise; one kind is the whole dot)
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, PLACE_R, (i / kinds.length - 0.25) * 2 * Math.PI, ((i + 1) / kinds.length - 0.25) * 2 * Math.PI);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    });
    ctx.beginPath();
    ctx.arc(x, y, PLACE_R, 0, 2 * Math.PI);
    ctx.stroke();
  }

  state.hits = hits;
  state.covers = covers;
  state.chosenAt = chosen;
  nextFrame();
}

// A frame draws every vehicle in view: thousands on a map of the whole
// country, which on a slow device takes longer than a frame lasts. So frames
// come as often as they are needed and no oftener: FRAME_MS apart while a
// marker glides or something has changed, else quietMs apart, as the zoom
// has it (see draw). Moving the map draws by itself (map.on('move')).
// Between two, the page asks the browser for no frame at all, but waits for
// the next with a timer: a frame asked for draws the page anew, also where
// nothing on it has changed.
let frameTimer = null;
let framePending = false;

// The vehicles on the stops of a line (lineStops in panel.js) are drawn as
// the map draws its own, on a canvas of their own over the line of the
// list, and move along their tracks with the frames: every FRAME_MS while
// they are shown, between two answers of the server too. An element moved by
// a third of a pixel is drawn a whole pixel on now and then by Firefox and
// by Chrome on a phone, whatever moves it; a canvas draws it where it is.
// Over each is a button that cannot be seen, for a tap, the keyboard and a
// screen reader; the ring of the keyboard focus is drawn on the canvas.
let lastLineMove = 0;
const LINE_CANVAS_PX = 100; // its width: the line of the list, a branch beside it and the flags
const lineTracks = new WeakMap(); // a vehicle's button → its track, read once: [time, x, y, …]
const lineCanvas = () => (panel.hidden ? null : panelBody.querySelector('canvas.line-canvas'));

/** Makes the canvas of the vehicles on the stops of a line as high as the list, at the resolution of the screen (as far as a canvas may be that high). */
function fitLineCanvas(paper) {
  const height = paper.parentNode.offsetHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 16_000 / Math.max(1, height));
  paper.width = Math.round(LINE_CANVAS_PX * dpr);
  paper.height = Math.round(height * dpr);
}

function drawLineVehicles(paper) {
  lastLineMove = performance.now();
  const c = paper.getContext('2d');
  const dpr = paper.width / LINE_CANVAS_PX;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, LINE_CANVAS_PX, paper.height / dpr);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const live = realtimeState() === 'live';
  const at = now();
  let focused = null;
  for (const node of paper.parentNode.querySelectorAll('button.line-vehicle')) {
    if (!lineTracks.has(node)) lineTracks.set(node, node.dataset.track ? node.dataset.track.split(',').map(Number) : [0, ...node.dataset.at.split(',').map(Number)]);
    const [x, y] = trackAt(lineTracks.get(node), at);
    // (its button where it is: one that cannot be seen may well go by whole pixels)
    node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const v = { mode: node.dataset.mode, delay: node.dataset.late === undefined ? null : Number(node.dataset.late), label: node.dataset.label };
    c.strokeStyle = '#fff';
    c.fillStyle = vehicleColor(v);
    c.lineWidth = 1.5;
    drawArrow(x, y, VEHICLE_R, Math.PI / 2, c);
    drawDisc(x, y, VEHICLE_R, v, true, c);
    const flag = flagOf(v, live);
    const width = flag ? drawFlag(x + VEHICLE_R * 0.55, y - VEHICLE_R - 5, flag, c) : 0;
    if (node.matches(':focus-visible')) focused = { x, y, width };
  }
  // the ring of the keyboard focus last, over all of them: round the whole of its vehicle, its flag inside
  if (focused) {
    roundedBox(focused.x - 19, focused.y - 21, 19 + Math.max(19, VEHICLE_R * 0.55 + focused.width + 3), 42, 10, c);
    c.strokeStyle = colors.accent;
    c.lineWidth = 2;
    c.stroke();
  }
}

function frame() {
  framePending = false;
  const paper = lineCanvas();
  if (paper && performance.now() - lastLineMove >= FRAME_MS) drawLineVehicles(paper);
  if (performance.now() - lastDraw >= (drawAsked || settling ? FRAME_MS : quietMs)) draw();
  else nextFrame();
}

/** Asks for the next frame for when it is due: after each draw, and when something has changed. */
function nextFrame() {
  if (framePending) return;
  clearTimeout(frameTimer);
  const ask = () => {
    framePending = true;
    requestAnimationFrame(frame);
  };
  // (the next frame of the map, or of the vehicles on the stops of a line where that is sooner)
  let wait = lastDraw + (drawAsked || settling ? FRAME_MS : quietMs) - performance.now();
  if (lineCanvas()) wait = Math.min(wait, lastLineMove + FRAME_MS - performance.now());
  if (wait > 0) frameTimer = setTimeout(ask, Math.ceil(wait));
  else ask();
}

/** Says that what the canvas shows has changed: drawn with the next frame. */
function askDraw() {
  drawAsked = true;
  nextFrame();
}

// ---------- interaction ----------

function hitTest(point) {
  let best = null;
  let bestScore = Infinity;
  // Under a bubble nothing can be pointed at but what is in it.
  const covered = state.covers.some(([x, y, w, h]) => point.x >= x && point.x <= x + w && point.y >= y && point.y <= y + h);
  for (const hit of state.hits) {
    if (covered && !hit.top) continue;
    const d = Math.hypot(hit.x - point.x, hit.y - point.y);
    if (d > hit.r) continue;
    // vehicles win over the station they are standing at; a favourite drawn above them over the vehicles
    const score = d + (hit.above ? -1000 : hit.station ? 1000 : 0);
    if (score < bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return best;
}

const tooltip = $('tooltip');

function vehicleSummary(v) {
  // (in the smallest form a vehicle comes without where it goes)
  const parts = [v.to ? `${v.line} → ${v.to}` : v.line];
  if (v.delay === null) parts.push(t('delay.none'));
  else parts.push(Math.round(v.delay / 60) === 0 ? t('delay.onTime') : t('delay.minutes', { delay: delayText(v.delay) }));
  return parts.join(' · ');
}

// The tooltip names what the pointer hovers over. A finger does not hover
// (`hovering`, above): its tap arrives as a pointer that moved there, and
// would leave the tooltip standing.
const hideTooltip = () => { tooltip.hidden = true; };

map.on('mousemove', (event) => {
  // (a display on a wall has nothing to point at: the map tells of the pointer all the same)
  if (FIXED) return;
  const hit = hitTest(event.point);
  map.getContainer().classList.toggle('clickable', !!hit);
  tooltip.hidden = !hit || !hovering.matches || Boolean(hit.named);
  if (tooltip.hidden) return;
  tooltip.textContent = hit.vehicle ? vehicleSummary(hit.vehicle) : hit.station.name;
  tooltip.style.transform = `translate(${event.point.x + 14}px, ${event.point.y + 14}px)`;
});
// It goes when the pointer leaves the map, when the map moves away under it,
// and when what it names is chosen: the details say more, and may come to lie
// right where it stood.
map.on('mouseout', hideTooltip);
map.on('movestart', hideTooltip);

map.on('click', (event) => {
  // (the tap that folds the unfolded card does only that: see "the card while details are open")
  if (FIXED || performance.now() - cardFoldedAt < 700) return;
  hideTooltip();
  const hit = hitTest(event.point);
  if (hit?.vehicle) select('trip', hit.vehicle.id);
  else if (hit?.station) {
    // (the stops of a board are open already, the one it is of and its further stops)
    if (onBoard(hit.station)) return;
    if (hit.station.id) select('station', hit.station.id);
    else openFavouriteStop(hit.station);
  } else closePanel();
  // (what was tapped is not to end up under its own details)
  if (hit) clearOfSheet(hit.y);
});

// ---------- the visitor's own position ----------

// Nothing asks for it before the visitor touches the button, and at the next
// visit the function is off again. The position stays in the browser: what
// the server and the map get to see is the section of the map, as always.

let watch = null; // the running navigator.geolocation.watchPosition; null while the function is off
// The map is on its way to the first position. Those that come meanwhile do
// not move it: following them at once would end the flight halfway in.
let arriving = false;

// The button wears the classes of MapLibre's own control for this, and with
// them its icons (vendor/maplibre-gl/maplibre-gl.css). The control itself is
// not used: it moves the map before it says where the visitor is, and for a
// visitor outside the area the map is to stay where it is.
const locateButton = el('button', { type: 'button', class: 'maplibregl-ctrl-geolocate', title: t('map.locate'), 'aria-label': t('map.locate'), 'aria-pressed': 'false', onclick: toggleLocating }, [
  el('span', { class: 'maplibregl-ctrl-icon', 'aria-hidden': 'true' }),
]);
/** For map.addControl: the button as a group of its own, like the zoom buttons. */
const locateControl = {
  onAdd: () => el('div', { class: 'maplibregl-ctrl maplibregl-ctrl-group' }, [locateButton]),
  onRemove: () => locateButton.parentNode.remove(),
};

/** Brings the button in line with what is going on. */
function showLocating() {
  const on = watch !== null;
  const { position, follow } = state;
  // no position yet, or none any more: the icon turns
  const waiting = on && (!position || !!position.stale);
  const failing = on && !!position?.stale;
  locateButton.setAttribute('aria-pressed', String(on));
  // The icon is blue while the function is on and red while positions fail to
  // come, with a dot in its middle while the map follows.
  const classes = locateButton.classList;
  classes.toggle('maplibregl-ctrl-geolocate-waiting', waiting);
  classes.toggle('maplibregl-ctrl-geolocate-active', on && follow && !failing);
  classes.toggle('maplibregl-ctrl-geolocate-active-error', follow && failing);
  classes.toggle('maplibregl-ctrl-geolocate-background', on && !follow && !failing);
  classes.toggle('maplibregl-ctrl-geolocate-background-error', !follow && failing);
}

/**
 * Whether a place is inside the outline of the area – by the even-odd rule, as
 * the veil is drawn. An instance without an outline has no area: there it is
 * the rectangle around all it covers. (Germany has one, its border.)
 */
function inArea(lat, lon) {
  if (!state.outline.length) return Boolean(state.bbox) && lat >= state.bbox[0] && lon >= state.bbox[1] && lat <= state.bbox[2] && lon <= state.bbox[3];
  let inside = false;
  for (const ring of state.outline) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [lat1, lon1] = ring[i];
      const [lat2, lon2] = ring[j];
      if ((lat1 > lat) !== (lat2 > lat) && lon < lon1 + ((lat - lat1) / (lat2 - lat1)) * (lon2 - lon1)) inside = !inside;
    }
  }
  return inside;
}

const centreOnPosition = () => map.easeTo({ center: [state.position.lon, state.position.lat] });

function stopLocating() {
  navigator.geolocation.clearWatch(watch);
  watch = null;
  state.position = null;
  state.follow = false;
  showLocating();
  draw();
}

function onPosition({ coords }) {
  if (watch === null) return; // was on its way when the function was switched off
  const { latitude: lat, longitude: lon, accuracy } = coords;
  const first = !state.position;
  // Whoever is outside the area would be led to an empty map, and find it
  // again at the next visit as the section last looked at.
  if (first && !inArea(lat, lon)) {
    stopLocating();
    showNote(t('locate.outside'));
    return;
  }
  state.position = { lat, lon, accuracy, stale: false };
  if (first) {
    // In to LOCATE_ZOOM – less far if the whole of an uncertain position would
    // not be in view then, and never out. After that the zoom is the visitor's.
    const fit = Math.log2((Math.min(viewSize.x, viewSize.y) * metresPerPixel(lat, 0)) / (2 * accuracy));
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), Math.min(LOCATE_ZOOM, fit)) }, { arriving: true });
    // (not where motion is reduced: there the map is at the position at once)
    arriving = map.isMoving();
  } else if (state.follow && !arriving) {
    centreOnPosition();
  }
  showLocating();
  draw();
}

function onPositionError(error) {
  if (watch === null) return;
  // Once there is a position, one that fails to come is waited out: the next
  // may come, after a tunnel for instance. Until then the marker is grey.
  if (state.position && error.code !== error.PERMISSION_DENIED) {
    state.position.stale = true;
    showLocating();
    draw();
    return;
  }
  stopLocating();
  showNote(error.code === error.PERMISSION_DENIED ? t('locate.denied') : t('locate.failed'));
}

// One touch switches the function on and has the map follow the visitor, the
// next one switches it off – unless the visitor has moved the map away
// meanwhile: then it brings the map back first.
function toggleLocating() {
  if (watch !== null && state.follow) {
    stopLocating();
    return;
  }
  state.follow = true;
  // (a position up to ten seconds old will do: the first one is there sooner)
  if (watch === null) watch = navigator.geolocation.watchPosition(onPosition, onPositionError, { enableHighAccuracy: true, maximumAge: 10_000, timeout: LOCATE_TIMEOUT_MS });
  else if (state.position) centreOnPosition();
  showLocating();
}

// Moving the map by hand ends the following; the marker stays. Zooming does
// not end it, and neither does what moves the map without a hand: the window
// changing its size, or the following itself.
map.on('movestart', (event) => {
  if (!state.follow || !state.position || !event.originalEvent || map.isZooming()) return;
  state.follow = false;
  showLocating();
});
map.on('moveend', (event) => {
  if (!event.arriving) return;
  arriving = false;
  // (the position may have become a better one during the flight)
  if (state.follow && state.position) centreOnPosition();
});

// ---------- search ----------

// Stops, lines and towns are searched for in the browser, in a thread of
// its own (search-worker.js with search.js): what is typed is sent nowhere,
// and neither is the visitor's position, which puts what is around them
// first. The list of them is fetched when the field is first used.

const searchBox = $('search');
const searchField = $('search-field');
const searchResults = $('search-results');
const narrowScreen = matchMedia('(max-width: 720px)'); // as in style.css
let finder = null; // the thread that searches, once the field has been used
let finderHasList = false; // whether it has the list, as far as its answers say: until the first one it is loading it
let turn = 0; // the number of the question it was asked last; an answer to an earlier one is too late
let found = []; // what choosing each of the results listed does
let active = -1; // the one the arrow keys have reached, as an index into them

/** Has the thread look for what was typed; with nothing typed, it gets the list ready. */
function ask(query) {
  if (!finder) {
    finder = new Worker('search-worker.js', { type: 'module' });
    finder.addEventListener('message', ({ data }) => answered(data));
    finder.addEventListener('error', (event) => {
      // (it could not be started, without a connection for one: the next letter starts it again)
      console.warn('search not started:', event.message);
      finder.terminate();
      finder = null;
      finderHasList = false;
      answered({ turn, failed: true });
    });
  }
  // Near is where the visitor is, if they have it shown; else what the map
  // shows: its middle, and how far it reaches from there, half its diagonal
  // (#154). Neither leaves the browser: the search is here. What the map
  // shows comes along: the favourites on it are listed first (#257).
  const bounds = map.getBounds();
  const near = state.position
    ? { lat: state.position.lat, lon: state.position.lon }
    : { lat: bounds.getCenter().lat, lon: bounds.getCenter().lng, km: bounds.getSouthWest().distanceTo(bounds.getNorthEast()) / 2000 };
  const view = [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
  // (with the names of the modes as the visitor reads them: "bus 33" is a line of the buses)
  const modeNames = Object.fromEntries(DRAW_ORDER.map((mode) => [mode, t(`mode.${mode}`)]));
  // (stops alone where one is added to a board)
  const limits = state.adding ? { towns: 0, lines: 0, stops: SEARCH_LIMIT } : { towns: TOWN_LIMIT, lines: LINE_LIMIT, stops: SEARCH_LIMIT };
  // (and the favourites, which come first, and are what it lists with nothing typed, with stations near the map below them)
  finder.postMessage({ turn: ++turn, query, near, view, limits, modeNames, favourites });
}

/** The list the thread has is not the server's any more: it loads it again with the next question. */
function forgetSearchList() {
  finder?.postMessage({ forget: true });
  finderHasList = false;
}

/** Marks the result the arrow keys have reached, for the eye and for a screen reader; -1 for none. */
function setActive(index) {
  active = index;
  const rows = [...searchResults.querySelectorAll('[role="option"]')];
  rows.forEach((row, i) => row.setAttribute('aria-selected', String(i === index)));
  const row = rows[index];
  if (row) {
    searchField.setAttribute('aria-activedescendant', row.id);
    row.scrollIntoView({ block: 'nearest' });
  } else {
    searchField.removeAttribute('aria-activedescendant');
  }
}

/**
 * A name with its town below it in small print, where there is one to show:
 * that of a stop whose name does not say it, in the search and in the stops
 * of a trip (#246), and the district of a town where another town has the
 * name too (#24). Its row has the class in-town.
 */
const nameInTown = (name, town, props = {}) =>
  town ? el('span', { class: 'name', ...props }, [el('span', { class: 'stop', text: name }), el('span', { class: 'town', text: town })]) : el('span', { class: 'name', text: name, ...props });

/**
 * Shows the towns, the lines and the stops found below the field, or a note
 * in their place; with nothing typed, the favourites and the stations near
 * the map suggested below them (`nearby`, #257).
 */
function listResults(towns, lines, stops, note = '', nearby = []) {
  const option = (choose, props, children) => {
    found.push(choose);
    return el('li', { id: `search-result-${found.length - 1}`, role: 'option', 'aria-selected': 'false', onclick: choose, ...props }, children);
  };
  found = [];
  // A town has a sign where a stop has its dots, and below its name its
  // district where another town has the name too (#24).
  const townRows = towns.map((town) => option(() => chooseTown(town), { class: `place${town.district ? ' in-town' : ''}` }, [
    el('span', { class: 'sign' }, [icon(mdiCityVariantOutline)]),
    nameInTown(town.name, town.district),
  ]));
  // A line begins with its name on the colour of its mode, as in the departures.
  // A favourite has a heart at the end of its row: a mark, not a button (#245).
  const heart = (item) => (item.favourite ? [el('span', { class: 'favourite', role: 'img', 'aria-label': t('search.favourite'), title: t('search.favourite') }, [icon(mdiHeart)])] : []);
  const lineRows = lines.map((line) => option(() => chooseLine(line), { class: 'line' }, [
    badge(line.name, line.mode),
    el('span', { class: 'name' }, [el('span', { class: 'to', text: line.to.join(' – ') }), el('span', { class: 'agency', text: line.agency })]),
    ...heart(line),
  ]));
  const stopRow = (stop) => {
    // The dots say what stops there, as the chips do.
    const dots = stop.modes.map((mode) => {
      const dot = el('span', { class: 'swatch' });
      dot.style.setProperty('--chip-color', `var(--mode-${mode})`);
      return dot;
    });
    // Below its name the town it is in, where the name does not say that: in small print, as a line has who runs it.
    return option(() => chooseStop(stop), { class: stop.town ? 'in-town' : '', title: stop.modes.map((mode) => t(`mode.${mode}`)).join(', ') }, [el('span', { class: 'dots' }, dots), nameInTown(stop.name, stop.town), ...heart(stop)]);
  };
  const stopRows = stops.map(stopRow);
  const nearbyRows = nearby.map(stopRow);
  // (each kind under its heading where more than one kind was found; the stations suggested always under theirs, which says why they are there)
  const kinds = [towns, lines, stops, nearby].filter((list) => list.length).length;
  const heading = (list, text, always = false) => ((kinds > 1 || always) && list.length ? [el('li', { class: 'search-heading', role: 'presentation', text })] : []);
  searchResults.replaceChildren(...heading(towns, t('search.towns')), ...townRows, ...heading(lines, t('search.lines')), ...lineRows, ...heading(stops, t('search.stops')), ...stopRows, ...heading(nearby, t('search.nearby'), true), ...nearbyRows);
  $('search-note').textContent = note;
  setActive(-1);
  // (where a stop is added to a board, what it is added to is said above, also before anything is typed)
  searchBox.classList.toggle('open', found.length > 0 || note !== '' || state.adding !== null);
  searchField.setAttribute('aria-expanded', String(found.length > 0));
}

function runSearch() {
  const query = searchField.value;
  ask(query);
  // (with nothing typed the thread answers with the favourites and the stations near the map; until it has its list, there is nothing)
  if (!query.trim()) {
    if (!finderHasList) listResults([], [], []);
  } else if (!finderHasList) listResults([], [], [], t('search.loading'));
}

/** Shows what the thread found, unless something else has been typed since. */
function answered({ turn: of, failed = false, towns = [], lines, stops, nearby = [] }) {
  // (whatever it was asked: it has the list now, or has not)
  finderHasList = !failed;
  // (typed on meanwhile)
  if (of !== turn) return;
  const typed = searchField.value.trim() !== '';
  if (failed) listResults([], [], [], typed ? t('search.failed') : '');
  else listResults(towns, lines, stops, !typed || towns.length || lines.length || stops.length ? '' : t('search.none'), nearby);
}

/** Shuts the list, and on a narrow screen the field with it. */
function closeSearch() {
  endAdding();
  // (an answer that is still to come would open it again)
  turn++;
  listResults([], [], []);
  $('controls').classList.remove('searching');
}

/** What choosing any result begins with: the search is done with, and the map is no longer led by the visitor's position. */
function leaveSearch(text) {
  closeSearch();
  searchField.value = text;
  searchField.blur(); // a keyboard on the screen goes away
  // (following the visitor would bring the map straight back)
  if (state.follow) {
    state.follow = false;
    showLocating();
  }
}

function chooseLine(line) {
  leaveSearch(line.name);
  selectLine(line);
}

/**
 * Shows a town: all its stations in view, with nothing opened (#24). What
 * was open is closed, so that the map is free for it.
 */
function chooseTown(town) {
  leaveSearch(town.name);
  if (!panel.hidden) closePanel();
  const [south, west, north, east] = town.box;
  map.fitBounds([[west, south], [east, north]], { padding: clearOfCards(), maxZoom: TOWN_ZOOM });
}

function chooseStop(stop) {
  if (state.adding) {
    const { block } = state.adding;
    leaveSearch('');
    addBoardStop(stop, block);
    return;
  }
  leaveSearch(stop.name);
  // On a narrow screen the departures cover the lower half: the stop goes above the middle.
  map.flyTo({ center: [stop.lon, stop.lat], zoom: Math.max(map.getZoom(), SEARCH_ZOOM), offset: stopOffset() });
  // (the list has no ids: a stop of it is asked for by its place)
  select('station', null, { at: stop });
}

searchField.addEventListener('input', runSearch);
// (true while the page gives the field the focus back: it does not open the results of last time then, see closePanel)
let focusGivenBack = false;
searchField.addEventListener('focus', () => {
  // what is in the field from last time is typed over, and found again until then
  searchField.select();
  if (!focusGivenBack) runSearch();
});
searchField.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!found.length) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    setActive(active < 0 && step < 0 ? found.length - 1 : (active + step + found.length) % found.length);
  } else if (event.key === 'Enter') {
    // without the arrow keys it is the first one, the most likely; and the key does nothing else (a button of a board that gets the focus would take it as a press)
    event.preventDefault();
    const choose = found[Math.max(active, 0)];
    if (!choose) return;
    choose();
    // (the details that open get the focus, and not the start of the page; a stop added to a board has it on the board already)
    if (!panel.hidden && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  } else if (event.key === 'Escape') {
    // (and not the details as well, which the same key closes otherwise)
    event.stopPropagation();
    cancelSearch();
  }
});

/** Whether the search is behind the button with the lens: above a board on a narrow screen, as style.css has it. */
const searchBehindLens = () => (narrowScreen.matches && state.board !== null) || document.documentElement.dataset.fold !== undefined;

/**
 * Shuts the search without choosing anything. The focus stays in the field;
 * where the field goes with the search (searchBehindLens), it goes to the
 * button that opens it. Where the search was to add a stop to a board, it
 * goes back to the button that opened it.
 */
function cancelSearch() {
  const adding = endAdding();
  closeSearch();
  if (adding) focusBoard(adding.block === null ? 'add' : `merge:${adding.block}`);
  else if (searchBehindLens()) {
    searchField.blur(); // a keyboard on the screen goes away
    $('search-open').focus();
  }
}
// A click on a result must not take the focus from the field first: the list
// would be shut before the click arrives.
searchResults.addEventListener('mousedown', (event) => event.preventDefault());
searchBox.addEventListener('focusout', (event) => {
  if (!searchBox.contains(event.relatedTarget)) closeSearch();
});
$('search-open').addEventListener('click', () => {
  $('controls').classList.add('searching');
  searchField.focus();
});
$('search-close').addEventListener('click', cancelSearch);

// ---------- controls ----------

const chipCounts = new Map();

/**
 * Shows where the row of chips goes on. On a narrow screen it is one row that
 * scrolls sideways (style.css): each of the two arrows is there while chips
 * are out of sight on its side, and moves the row that way.
 */
function watchChipRow(row, back, on) {
  const update = () => {
    back.hidden = row.scrollLeft < 1;
    on.hidden = row.scrollLeft + row.clientWidth > row.scrollWidth - 1;
  };
  const move = (direction) => row.scrollBy({ left: direction * row.clientWidth * 0.7 });
  back.addEventListener('click', () => move(-1));
  on.addEventListener('click', () => move(1));
  row.addEventListener('scroll', update, { passive: true });
  // A chip that gets the focus is to be seen whole and clear of the arrows
  // (the scroll-padding of the row); left to themselves, browsers are content
  // with a part of it.
  row.addEventListener('focusin', (event) => event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  // The row gets wider or narrower with the window, what is in it with the numbers on the chips.
  const sizes = new ResizeObserver(update);
  for (const node of [row, ...row.children]) sizes.observe(node);
  update();
}

function buildControls() {
  languagePicker($('language'));

  // The chips are in the page as it comes, each switched on (index.html):
  // the card can show before this has run. Here they get what they do.
  const container = $('modes');
  for (const mode of MODES) {
    const chip = container.querySelector(`[data-mode="${mode}"]`);
    const count = chip.querySelector('.count');
    count.textContent = formatNumber(0);
    chipCounts.set(mode, count);
    chip.setAttribute('aria-pressed', String(state.enabled.has(mode)));
    chip.addEventListener('click', () => {
      if (state.enabled.has(mode)) state.enabled.delete(mode);
      else state.enabled.add(mode);
      chip.setAttribute('aria-pressed', String(state.enabled.has(mode)));
      saveSetting('hiddenModes', MODES.filter((other) => !state.enabled.has(other)));
      updateStatus();
      draw();
      // (the answers hold the kinds that are on, and no others: asked for again at once)
      if (state.loaded) poll();
    });
  }
  watchChipRow(container, $('modes-back'), $('modes-on'));

  const from = (seconds) => t('delay.from', { minutes: seconds / 60 });
  const legend = [['early', t('delay.early')], ['ok', t('delay.onTime')], ['minor', from(DELAY_MINOR_S)], ['major', from(DELAY_MAJOR_S)], ['severe', from(DELAY_SEVERE_S)], ['none', t('delay.none')]];
  $('delay-legend').append(...legend.map(([delay, text]) => el('li', {}, [el('span', { class: 'swatch', data: { delay } }), text])));

}

let shownRealtime = null; // the realtime state the card showed last (updateStatus)

function updateStatus() {
  if (!state.online) return;
  // The numbers refer to the whole area, not just the map section in view.
  const counts = state.counts;
  let shown = 0;
  for (const [mode, count] of Object.entries(counts)) if (state.enabled.has(mode)) shown += count;
  for (const [mode, node] of chipCounts) node.textContent = formatNumber(counts[mode] ?? 0);
  // A chip for each kind the timetable has, and for no other: the page came
  // with those of the timetable the server had then (server/lib/page.js).
  if (state.kinds) for (const [mode, node] of chipCounts) node.parentElement.hidden = !state.kinds.includes(mode);

  // Without realtime data all positions are by the timetable alone. While it
  // may still be on its way that is said calmly, after that as a warning.
  const realtime = realtimeState();
  // (the vehicles say it too, with their flags (flagOf): drawn anew when it changes, which between two answers happens here first)
  if (realtime !== shownRealtime) askDraw();
  shownRealtime = realtime;
  $('status').dataset.state = { live: 'live', waiting: 'schedule', outage: 'outage' }[realtime];
  const text = realtime === 'live' ? t('status.live', { seconds: realtimeAge() }) : realtime === 'outage' ? t('status.outage') : t('status.waiting');
  $('status-text').textContent = `${t('status.vehicles', { count: shown })} · ${text}`;
}

/** How old the realtime data in use is, in whole seconds; null without any. */
function realtimeAge() {
  return state.realtimeAt === null ? null : Math.max(0, Math.round(now() - state.realtimeAt));
}

/**
 * Where the page stands with realtime data: 'live' with current data. Without,
 * 'waiting' while it may still come – the server fetches the feed only while
 * somebody looks, so the first answers after opening the page or coming back
 * to it are without – and 'outage' once it has been there and is gone, or has
 * not come in REALTIME_GRACE_MS.
 */
function realtimeState() {
  const age = realtimeAge();
  if (age !== null && age < LIVE_MAX_AGE_S) return 'live';
  return state.wasLive || Date.now() - state.askingSince > REALTIME_GRACE_MS ? 'outage' : 'waiting';
}

/** The page begins to ask for vehicles, or does so again after a pause: realtime data may take a while. */
function startAsking() {
  state.askingSince = Date.now();
  state.wasLive = false;
}

function renderBanner() {
  const banner = $('banner');
  const text = state.note ?? state.banner ?? '';
  // It is an alert: written only when it changes, so that it is read out once.
  if (banner.textContent !== text) banner.textContent = text;
  banner.hidden = !text;
}

/** What the visitor has to know for as long as it is so; null takes it away. */
function showBanner(message) {
  state.banner = message;
  renderBanner();
}

let noteTimer = null;
/** A note on something the visitor just did: it takes the place of the banner and goes away by itself. */
function showNote(message) {
  state.note = message;
  renderBanner();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    state.note = null;
    renderBanner();
  }, NOTE_MS);
}

/** What to tell the visitor while the server has no timetable yet, by the state and step of its 503 answer. */
function loadingText({ state: phase, step }) {
  if (phase === 'error') return t('loading.error');
  if (phase === 'starting') return t('loading.starting');
  if (step === 'download') return t('loading.download');
  if (step === 'import') return t('loading.import');
  if (step === 'routes') return t('loading.routes');
  return t('loading.timetable');
}

// ---------- the one tip ----------

// Once per browser, on landing at the address of a stop, one line above its
// departures says that a departure leads to its vehicle (#226): the thing a
// visitor from a search engine cannot guess. Not in a display, on a board,
// while a stop is added to one, or while a notice, a dialog or the settings
// are up. It goes with the next tap, click or key, or after a while.
const tip = $('tip');
const TIP_MS = 9000;
let tipTimer = null;

function offerTip() {
  if (ASKED || state.display || state.board !== null || state.adding || state.banner || state.note) return;
  if (aboutDialog.open || notesDialog.open || choiceDialog.open || settingsButton.getAttribute('aria-expanded') === 'true') return;
  if (loadSetting('tipped', false) === true) return;
  saveSetting('tipped', true);
  tip.textContent = matchMedia('(pointer: coarse)').matches ? t('tip.departure') : t('tip.departureMouse');
  tip.hidden = false;
  // On a phone above the details, which may still be gliding up (as in clearOfCards); else at the foot of the map beside the details.
  const details = panel.getBoundingClientRect();
  if (narrowScreen.matches) {
    const sheetTop = panel.classList.contains('sized') ? details.top : Math.min(details.top, viewSize.y * (1 - SHEET_MIDDLE));
    tip.style.bottom = `${viewSize.y - sheetTop + 10}px`;
  } else {
    tip.style.left = `${details.left / 2}px`;
  }
  tipTimer = setTimeout(hideTip, TIP_MS);
}

function hideTip() {
  clearTimeout(tipTimer);
  tip.hidden = true;
}
for (const type of ['click', 'keydown']) document.addEventListener(type, () => tip.hidden || hideTip(), true);
addEventListener('resize', () => tip.hidden || hideTip());

// ---------- how it works ----------

// How the page comes by what it shows, for whoever asks: a dialog over the
// page, its text in index.html. The browser keeps the keyboard inside it while
// it is open, closes it on Escape and gives the focus back to the button it
// was opened with.
const aboutDialog = $('about');
$('about-open').addEventListener('click', () => aboutDialog.showModal());
closesByClick(aboutDialog, $('about-close'));
// (what the map can do: with a mouse, what is tapped on a phone is clicked)
if (!matchMedia('(pointer: coarse)').matches) {
  $('use-vehicle').textContent = t('about.useVehicleMouse');
  $('use-stop').textContent = t('about.useStopMouse');
  $('use-departure').textContent = t('about.useDepartureMouse');
  $('use-modes').textContent = t('about.useModesMouse');
  $('use-favourite').textContent = t('about.useFavouriteMouse');
}

/** A dialog closes with its button, and with a click beside it. */
function closesByClick(dialog, button) {
  button.addEventListener('click', () => dialog.close());
  // (a click beside it lands on the dialog itself: what it says fills it, see .dialog-body in style.css)
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

// ---------- settings ----------

// What a visitor can set for themselves: a small box at the gear in the title
// row, which opens and shuts it. A click or a tap anywhere else shuts it too,
// and so does Escape (see the detail panel for the key).
const settings = $('settings');
const settingsButton = $('settings-open');

function showSettings(open) {
  settings.hidden = !open;
  settingsButton.setAttribute('aria-expanded', String(open));
}
settingsButton.addEventListener('click', () => showSettings(settings.hidden));
// (as it begins, and before anything else hears of it: the map keeps some of what happens on it to itself)
document.addEventListener('pointerdown', (event) => {
  if (!settings.hidden && !settings.contains(event.target) && !settingsButton.contains(event.target)) showSettings(false);
}, true);

// Light, dark or as the device has it: chosen in the settings, kept in the browser.
{
  const buttons = [...document.querySelectorAll('[data-theme-choice]')];
  const choose = (theme) => {
    state.theme = THEMES.includes(theme) ? theme : 'auto';
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === state.theme));
  };
  choose(loadSetting('theme', 'auto'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      choose(button.dataset.themeChoice);
      saveSetting('theme', state.theme);
      applyTheme();
      draw();
    });
  }
  applyTheme();
}

// How the vehicles show their delay (#220): as a number in a flag, coloured
// by kind (state.flags); as their colour, with its key in the card
// (state.colorBy); or not at all, for a calmer map. One setting, as together
// the two the page keeps give no more than these three; chosen in the
// settings, kept in the browser.
{
  const buttons = [...document.querySelectorAll('[data-delays-choice]')];
  const shown = () => (state.colorBy === 'delay' ? 'color' : state.flags ? 'number' : 'off');
  const show = () => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.delaysChoice === shown()));
    $('delay-legend').hidden = state.colorBy !== 'delay';
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const choice = button.dataset.delaysChoice;
      state.colorBy = choice === 'color' ? 'delay' : 'mode';
      // (coloured by delay the flags are left out whatever this says: kept for the way back)
      if (choice !== 'color') state.flags = choice === 'number';
      saveSetting('colorBy', state.colorBy);
      saveSetting('flags', state.flags);
      show();
      draw();
    });
  }
  show();
}

// Departure times as the time of day, as the minutes until they leave, or
// both: chosen in the settings, kept in the browser, for every list of
// departures (#81).
{
  const buttons = [...document.querySelectorAll('[data-times-choice]')];
  const choose = (times) => {
    state.times = TIMES.includes(times) ? times : 'both';
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.timesChoice === state.times));
  };
  choose(loadSetting('times', 'both'));
  for (const button of buttons) {
    button.addEventListener('click', () => {
      choose(button.dataset.timesChoice);
      saveSetting('times', state.times);
      showSelection();
    });
  }
}

// The clock on the board of a stop, or none for a board on a screen that
// has a clock of its own: chosen in the settings, kept in the browser.
{
  const buttons = [...document.querySelectorAll('[data-clock-choice]')];
  const show = () => {
    for (const button of buttons) button.setAttribute('aria-pressed', String((button.dataset.clockChoice === 'on') === state.clock));
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      state.clock = button.dataset.clockChoice === 'on';
      saveSetting('clock', state.clock);
      show();
      showSelection();
    });
  }
  show();
}

// ---------- detail panel ----------

const panel = $('panel');
// What the details are of stays at the top; what is listed scrolls below it.
const panelHead = $('panel-head');
const panelBody = $('panel-body');
let panelTimer = null;
// (what had the keyboard focus when the details opened: see closePanel)
let panelOpener = null;

// The header card folds (data-fold, style.css) to its title row and the line
// that positions are calculated. Its grip, a row at its foot, folds and
// unfolds it, with a tap or a pull. On a phone it folds by itself while the
// details of a stop, a line or a trip are open, so that the map has the room
// between it and them; unfolded there, it folds again when the map or the
// details are touched.
const card = { folded: false, unfolded: false }; // folded by the visitor; unfolded while details are open on a phone
let cardFoldedAt = -Infinity; // (when a touch on the map folded the card last)
const sheetOpen = () => narrowScreen.matches && !panel.hidden;
function showFold() {
  const fold = sheetOpen() ? !card.unfolded : card.folded;
  if (fold) document.documentElement.dataset.fold = '';
  else delete document.documentElement.dataset.fold;
  $('card-grip').setAttribute('aria-expanded', String(!fold));
}
function setFold(fold) {
  if (sheetOpen()) card.unfolded = !fold;
  else card.folded = fold;
  showFold();
}
// (also as the page comes: at the address of a stop or a line its details are open from the start)
new MutationObserver(() => {
  if (panel.hidden) card.unfolded = false;
  showFold();
}).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
narrowScreen.addEventListener('change', showFold);
showFold();
// The grip works as that of the details: a tap takes the card to its other
// height, gliding; pulled, the card's foot follows the finger, and let go it
// comes to rest folded or unfolded, the nearer or the one it was flicked to.
const controls = $('controls');
const grip = $('card-grip');
const folded = () => document.documentElement.dataset.fold !== undefined;
// The grip's strip below the card (style.css), a finger's worth, reaches into
// the map and stops short of the details: on a phone the sheet comes up to
// just below the card, and its own bar is then where the strip would be.
const GRIP_REACH_PX = 29; // (as high as the strip is in style.css)
function gripReach() {
  const room = sheetOpen() ? panel.getBoundingClientRect().top - grip.getBoundingClientRect().bottom - 4 : Infinity;
  grip.style.setProperty('--reach', `${Math.max(0, Math.min(GRIP_REACH_PX, Math.floor(room)))}px`);
}
const reaching = new ResizeObserver(gripReach);
reaching.observe(panel);
reaching.observe(controls);
narrowScreen.addEventListener('change', gripReach);
/** The card's height folded and unfolded, in px, as it is by itself: measured with the other state put on for a moment. */
function cardHeights() {
  const was = folded();
  const given = controls.classList.contains('sized') ? controls.style.height : null;
  controls.classList.remove('sized');
  controls.style.height = '';
  setFoldAttribute(true);
  const low = controls.offsetHeight;
  setFoldAttribute(false);
  const high = controls.offsetHeight;
  setFoldAttribute(was);
  if (given !== null) {
    controls.classList.add('sized');
    controls.style.height = given;
  }
  return [low, high];
}
function setFoldAttribute(fold) {
  if (fold) document.documentElement.dataset.fold = '';
  else delete document.documentElement.dataset.fold;
}
/** Gives the card a height of its own, all of it shown and what does not fit cut off; null takes that away. */
function sizeCard(height) {
  if (height === null) {
    controls.classList.remove('sized');
    controls.style.height = '';
    return;
  }
  controls.classList.add('sized');
  controls.style.height = `${Math.round(height)}px`;
}
let cardRest = null; // (the end of a glide under way)
/** Glides the card from the height it has to folded or unfolded, then leaves it as it is by itself. */
function restCard(fold) {
  clearTimeout(cardRest);
  const [low, high] = cardHeights();
  if (!controls.classList.contains('sized')) sizeCard(folded() ? low : high);
  setFoldAttribute(false);
  void controls.offsetHeight;
  sizeCard(fold ? low : high);
  const done = () => {
    sizeCard(null);
    setFold(fold);
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) done();
  else cardRest = setTimeout(done, 220);
}
grip.addEventListener('click', () => restCard(!folded()));
{
  let drag = null; // as for the details: where it began, the height then, and whether it has moved enough to be a pull
  grip.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    grip.classList.add('grabbed');
    drag = { id: event.pointerId, y: event.clientY, height: controls.offsetHeight, moved: false, last: [[event.timeStamp, event.clientY]] };
  });
  grip.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const by = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(by) < SHEET_DRAG_PX) return;
      drag.moved = true;
      clearTimeout(cardRest);
      grip.setPointerCapture(drag.id);
      drag.heights = cardHeights();
      controls.classList.add('dragging');
      sizeCard(drag.height);
      setFoldAttribute(false);
    }
    const [low, high] = drag.heights;
    sizeCard(Math.max(low - 12, Math.min(high + 12, drag.height + by)));
    drag.last.push([event.timeStamp, event.clientY]);
    if (drag.last.length > 5) drag.last.shift();
  });
  const end = (event) => {
    grip.classList.remove('grabbed');
    if (!drag || event.pointerId !== drag.id) return;
    const { moved, last, heights: [low, high] = [] } = drag;
    drag = null;
    if (!moved) return;
    controls.classList.remove('dragging');
    // (a pull ends without the click a tap ends in)
    const swallow = (click) => {
      click.stopPropagation();
      click.preventDefault();
    };
    grip.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => grip.removeEventListener('click', swallow, { capture: true }), 300);
    const [[t0, y0]] = last;
    const [t1, y1] = last.at(-1);
    const speed = t1 > t0 ? (y1 - y0) / (t1 - t0) : 0; // px per ms, downwards
    const now = controls.offsetHeight;
    const fold = event.type === 'pointercancel' ? now < (low + high) / 2 : speed > SHEET_FLICK ? false : speed < -SHEET_FLICK ? true : now < (low + high) / 2;
    restCard(fold);
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
// (a touch on the map folds the card and is not a tap on the map as well: as outside an open box)
for (const surface of [$('map'), panel]) {
  surface.addEventListener('pointerdown', () => {
    if (!sheetOpen() || !card.unfolded) return;
    card.unfolded = false;
    showFold();
    if (surface !== panel) cardFoldedAt = performance.now();
  });
}

function closePanel() {
  // (asked before a board that closes builds the details anew: see below)
  const keyboard = panel.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
  if (state.adding) closeSearch();
  // (a board closes with its details; its address stays as it was, the step back to it)
  if (state.board !== null) setBoard(null, false);
  const picked = pickedQuery();
  state.selection = null;
  state.extra = [];
  state.lines = [];
  if (choiceDialog.open) choiceDialog.close();
  shareable(false);
  showAddress('', null);
  pickedChanged(picked);
  clearTimeout(panelTimer);
  hideSaid();
  panel.hidden = true;
  mainHeading();
  // The keyboard focus goes back to what opened the details, or else to the
  // search, and not to the start of the page (#194). After a click or a tap
  // it is left where it falls: moved, it would show a ring.
  if (keyboard) {
    focusGivenBack = true;
    panelOpener?.focus({ preventScroll: true });
    if (document.activeElement !== panelOpener) (searchBehindLens() ? $('search-open') : searchField).focus({ preventScroll: true });
    focusGivenBack = false;
  }
  panelOpener = null;
  // (opened again, the sheet is as high as it is by itself)
  setSheetHeight(null);
  draw();
}
$('panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // Escape closes what is on top: a dialog lies over all else and closes by itself, then the settings, then the details.
  if (aboutDialog.open || notesDialog.open || choiceDialog.open) return;
  if (!settings.hidden) {
    showSettings(false);
    settingsButton.focus();
  } else if (state.selection) {
    closePanel();
  } else if (state.display && !FIXED) {
    leaveDisplay();
  }
});

// ---------- addresses (#37) ----------

// What is open, a stop or a line, has its address in the address bar of the
// browser, to be passed on, kept and found by a search: back closes it
// again, a reload keeps it. A trip has none. Addresses are from where the
// instance is, which first.js has made the base of the page.

/** The address the page is at, from where the instance is: 'stop/…', 'line/…', or '' for the map alone. */
const here = () => decodeURIComponent(location.pathname).slice(new URL(document.baseURI).pathname.length);
// The title of the page with nothing open, and the name of the instance (loadArea).
let pageTitle = document.title;
let siteName = APP_NAME;

/** The title of the page of a stop, with its town where the name does not say it (#254), as the server gives its page (stopTitle in server/lib/addresses.js). */
function stopTitle(name, town = null) {
  const shown = townToShow(name, town);
  return `${t('address.stopTitle', { stop: shown ? t('address.stopWithTown', { stop: name, town: shown }) : name })} – ${siteName}`;
}

function lineTitle({ name, mode }) {
  const line = /^\d/.test(name) ? `${t(`address.kind.${mode}`)} ${name}` : name;
  const words = t('address.lineTitle', { line, route: '' }).replace(/\s+/g, ' ').trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} – ${siteName}`;
}

/** The title of the page of a trip (#178), as the server writes it (tripWords in server/lib/addresses.js). */
function tripTitle({ line: name, mode, to }) {
  const line = /^\d/.test(name) ? `${t(`address.kind.${mode}`)} ${name}` : name;
  const words = t('address.tripTitle', { line, to });
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} – ${siteName}`;
}

// (the address the page was sent for: the title the server gave it says more than this script knows, a line's ends, and is kept while the page is there;
// not where it is in another language than the one chosen here, which the server knows nothing of)
let servedAt = sentInAnother() ? null : here();

/**
 * The address of a stop from what an answer says of it. The server keeps
 * the places of its stops to 1e-5 degrees (timetable.js) and writes their
 * addresses from that; api/departures answers the place as the timetable has
 * it, which the fourth decimal of the address may round the other way.
 */
const stopPathOf = ({ name, lat, lon }) => stopPath(name, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5);

/** Puts the address of what is open into the address bar, as a new step back, and gives the page its title. */
function showAddress(path, title) {
  if (path !== servedAt) {
    document.title = title ?? pageTitle;
    servedAt = null;
  }
  if (path === here()) return;
  // (the settings of the page in its address stay; a board, with its further stops, only where one is shown)
  history.pushState(null, '', new URL(`${path}${boardQuery(location.search, state.board, state.extra, state.lines)}`, document.baseURI));
}

/**
 * Opens what the address of the page names (api/address): the stop, with
 * the map on it, or the line. Where it names nothing, the page says so and
 * looks for the name in it with the search. False while the server has no
 * timetable to look in: asked again with its next answer.
 * @param loaded whether the page was loaded at the address: then the server
 *   has counted it as a visit of it already (#158)
 */
async function openAddress(loaded = false) {
  const path = here();
  if (!path) return true;
  const res = await fetch(`api/address?path=${encodeURIComponent(path)}`);
  if (res.status === 503) return false;
  if (!res.ok) {
    // (a board of several stops goes on with the others: see "a board of several stops")
    if (!(await openNextStop(path))) addressGone(path);
    return true;
  }
  const found = await res.json();
  // (a stop that has moved a little, or has another name: the address it has now; that of a line or a trip without a board, which only a stop has)
  const search = found.type === 'stop' ? location.search : boardQuery(location.search, null);
  if (found.path !== path || search !== location.search) history.replaceState(null, '', new URL(`${found.path}${search}`, document.baseURI));
  if (found.type === 'line') {
    selectLine(found, { counted: loaded });
    return true;
  }
  // (a trip, #178: the map is brought to it once it is there, see renderTrip, unless a display's address says where the map is)
  if (found.type === 'trip') {
    select('trip', found.id, { counted: loaded, fit: !(loaded && state.viewAsked) });
    return true;
  }
  // (the board of the stop, where the address has one: a line has none; and its further stops, read before the board is written into the address again)
  const board = readBoard(location.search);
  const stops = readStops(location.search, found.path.slice('stop/'.length));
  state.extra = stops;
  // (and the lines it shows, where the address names them: read before the board writes the address anew)
  const asked = new URLSearchParams(location.search);
  const lines = asked.has('lines') ? readChoice(asked.get('lines')) : undefined;
  state.lines = lines ?? [];
  if (board !== state.board) setBoard(board);
  // (as from the search: on a narrow screen the details cover the lower half, so the stop goes above the middle; a board does not.
  // A display whose address names a section of the map keeps that section: it was set up so.)
  const kept = loaded && state.viewAsked;
  if (!kept) map.easeTo({ center: [found.lon, found.lat], zoom: Math.max(map.getZoom(), SEARCH_ZOOM), offset: board === null ? stopOffset() : [0, 0], duration: 0 });
  // (landing here, not on a board: the one tip may follow, once the departures are there)
  select('station', null, { at: found, counted: loaded, kept, stops, tip: loaded && board === null, ...(lines ? { lines } : {}) });
  return true;
}

/**
 * Opens a favourite stop that was tapped where the map has no station of it
 * (#245), by its address: that finds it also where a new timetable has moved
 * it a little, as the address of the page does.
 */
async function openFavouriteStop(stop) {
  const path = stopPathOf(stop);
  const res = await fetch(`api/address?path=${encodeURIComponent(path)}`).catch(() => null);
  if (res?.status === 404) addressGone(path);
  if (!res?.ok) return;
  const found = await res.json();
  if (found.type === 'stop') select('station', null, { at: found });
}

/** Says that the address names nothing now, and looks for the name in it. */
function addressGone(path) {
  state.selection = null;
  askDraw(); // (what was open goes from the map with the next frame)
  shareable(false);
  panel.hidden = false;
  panelHead.replaceChildren();
  const gone = path.startsWith('stop/') ? t('address.stopGone') : path.startsWith('line/') ? t('address.lineGone') : path.startsWith('trip/') ? t('address.tripGone') : t('address.gone');
  panelBody.replaceChildren(el('p', { class: 'panel-empty', text: gone }));
  const named = parseAddress(path);
  if (!named) return;
  $('controls').classList.add('searching');
  searchField.value = wordsOf(named.name);
  runSearch();
}

// Back and forward: what the address names now is opened, or what is open closed.
addEventListener('popstate', () => {
  // (what the search was to add a stop to is gone)
  if (state.adding) closeSearch();
  if (here()) openAddress();
  else if (!panel.hidden) closePanel();
});

// The share button: on a phone, the phone's own sheet shares the address; on
// a computer it is copied, and a note says so for a moment.
const shareButton = $('panel-share');
const copiedNote = $('panel-copied');
// (and beside it the button that enlarges the details of a stop into a board, see "the board")
const boardButton = $('panel-board');
let copiedTimer = null;

/**
 * Shows the share button where what is open has an address, a stop or a
 * line, and for a stop the button that enlarges it into a board.
 */
function shareable(yes, board = false) {
  shareButton.hidden = !yes;
  boardButton.hidden = !board;
  if (!yes) copiedNote.hidden = true;
  panel.classList.toggle('shareable', yes);
  panel.classList.toggle('boardable', board);
  showFavourite();
}

// The heart before the share button (#245): a stop or a line is made a
// favourite with it, and is one no longer. A note says where a favourite is
// to be found, for a moment, as the one of the share button does.
const favouriteButton = $('panel-favourite');
const favouriteNote = $('panel-favourited');

/** What is open as it is kept as a favourite: { kind, item } of a stop or a line, else null. */
function openFavourite() {
  const selection = state.selection;
  if (!selection?.data) return null;
  if (selection.type === 'station') return { kind: 'stops', item: stopFavourite(selection.data, openStop(selection.data).modes, state.lines) };
  if (selection.type === 'line') return { kind: 'lines', item: lineFavourite(selection.data) };
  return null;
}

/** Shows the heart where a stop or a line is open: filled where it is a favourite. */
function showFavourite() {
  const open = shareButton.hidden ? null : openFavourite();
  favouriteButton.hidden = !open;
  panel.classList.toggle('favourable', open !== null);
  if (!open) {
    favouriteNote.hidden = true;
    return;
  }
  const yes = isFavourite(favourites, open.kind, open.item);
  const label = yes ? t('panel.unfavourite') : t('panel.favourite');
  favouriteButton.title = label;
  favouriteButton.setAttribute('aria-label', label);
  favouriteButton.classList.toggle('on', yes);
  favouriteButton.replaceChildren(icon(yes ? mdiHeart : mdiHeartOutline));
}

favouriteButton.addEventListener('click', () => {
  const open = openFavourite();
  if (!open) return;
  const yes = !isFavourite(favourites, open.kind, open.item);
  favourites = withFavourite(favourites, open.kind, open.item, yes);
  keepFavourites();
  showFavourite();
  // (one note at a time under the buttons; none where the heart goes empty, which says it)
  copiedNote.hidden = true;
  favouriteNote.hidden = !yes;
  clearTimeout(copiedTimer);
  if (yes) copiedTimer = setTimeout(() => { favouriteNote.hidden = true; }, 2000);
});

shareButton.addEventListener('click', async () => {
  // (the address alone, without the settings of this page)
  const url = new URL(here(), document.baseURI).href;
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    navigator.share({ title: document.title, url }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    return;
  }
  copiedNote.hidden = false;
  favouriteNote.hidden = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedNote.hidden = true;
  }, 2000);
});

/**
 * Opens the details of a trip, a station or a line.
 * @param id of a trip or a station; null for a line, and for a station of the search
 * @param more what else there is to know: of a line what it is ({ line }),
 *   of a station of the search where it is ({ at }); and { counted: true } for
 *   what the address the page was loaded at names, whose visit the server has
 *   counted already (#158), and { kept: true } where the map stays where the
 *   address of a display put it
 */
function select(type, id, more = {}) {
  // (the further stops of a board are those of the address it was opened with, else none: see "a board of several stops")
  state.extra = type === 'station' ? (more.stops ?? []) : [];
  // (a board is of a stop: what else is opened is shown as details, at an address of its own; that of the board stays as it was, the step back to it)
  if (type !== 'station' && state.board !== null) setBoard(null, false);
  // The row that was activated is about to go: keep the keyboard focus in the panel.
  if (panelBody.contains(document.activeElement) || panelHead.contains(document.activeElement)) panel.focus({ preventScroll: true });
  // (what they are opened from, to have the focus back when they close)
  if (panel.hidden) panelOpener = document.activeElement === document.body ? null : document.activeElement;
  const picked = pickedQuery();
  state.selection = { type, id, data: null, ...more };
  delete state.selection.stops;
  // (the lines of a stop to show: as the address asks, else as its favourite keeps them, see loadSelection)
  state.lines = type === 'station' ? (more.lines ?? []) : [];
  state.view = 'departures';
  state.selection.linesAsked = more.lines !== undefined;
  delete state.selection.lines;
  // (the ring around the chosen vehicle, or a line's vehicles alone, with the next frame: not with the server's answer)
  askDraw();
  pickedChanged(picked);
  // (a stop and a line have their addresses once the server has said what they are: loadSelection; a trip has none)
  shareable(false);
  panel.hidden = false;
  // (the page of an address has its details in it as the server sent it, #254: they stay until the answer comes)
  if (!(more.counted && panelBody.hasAttribute('data-sent'))) {
    panelHead.replaceChildren();
    panelBody.replaceChildren(el('p', { class: 'panel-empty', text: t('panel.loading') }));
    mainHeading();
  }
  panelBody.removeAttribute('data-sent');
  loadSelection(true);
}

/**
 * Where the details of what is chosen come from.
 * @param open whether it is the first request for a stop or a line that is
 *   opened: the server counts that as a visit of its address, where visits
 *   are counted (#158). A trip has no address.
 */
function selectionUrl({ type, id, line, at, route, fromTrip }, open = false, first = false) {
  if (type === 'trip') return `api/trip?id=${encodeURIComponent(id)}${open ? '&open=1' : ''}`;
  // (a line is its name, its mode and its operator together, and its place where lines of the name are in places
  // apart, #152; where it runs is asked for until it is known, #148)
  if (type === 'line') return `api/line?${new URLSearchParams({ name: line.name, mode: line.mode, agency: line.agency, ...(line.at ? { at: line.at.join(',') } : {}), ...(route ? {} : { route: '1' }), ...(open ? { open: '1' } : {}), ...(first && fromTrip ? { trip: fromTrip } : {}) })}`;
  // (only the lines chosen, #164; once, with the first answer, which lines and directions there are; and all
  // lines with their next departures while they are shown, #255, which a board does not)
  const choice = `${state.lines.length ? `&lines=${choiceValue(state.lines)}` : ''}${first ? '&directions=1' : ''}${state.view === 'lines' && state.board === null ? '&list=lines' : ''}`;
  return `${at ? `api/departures?at=${at.lat.toFixed(5)},${at.lon.toFixed(5)}` : `api/departures?station=${encodeURIComponent(id)}`}${open ? '&open=1' : ''}${choice}`;
}

async function loadSelection(first = false) {
  const selection = state.selection;
  if (!selection) return;
  clearTimeout(panelTimer);
  // (the further stops of a board alongside, so that it is drawn once with all of them)
  const further = selection.type === 'station' && state.board !== null && state.extra.length ? loadBoardStops() : null;
  try {
    // (an answer that was overtaken by a later question, as after a change of the lines chosen, is not shown)
    const turn = (selection.turn = (selection.turn ?? 0) + 1);
    const res = await fetch(selectionUrl(selection, first && !selection.counted, first));
    const data = res.ok ? await res.json() : null;
    await further;
    if (state.selection !== selection || selection.turn !== turn) return; // user moved on meanwhile
    if (data) {
      // (the lines of the stop as they were last, until the next answer with them: to be shown at once on the switch)
      if (selection.type === 'station' && !data.lines && selection.data?.id === data.id && selection.data.lines) data.lines = selection.data.lines;
      selection.data = data;
      if (data.directions) state.directions = { id: data.id, list: data.directions };
      if (data.route) selection.route = data.route;
      if (first && selection.type === 'station') {
        // (a favourite opens with the lines chosen for it, where the address does not ask for others: asked for again then)
        const kept = selection.linesAsked || state.lines.length ? null : favourites.stops.find((stop) => sameStop(stop, data));
        const again = kept?.lines !== undefined;
        if (again) state.lines = readChoice(choiceValue(kept.lines));
        showAddress(stopPathOf(data), stopTitle(data.name, data.town));
        shareable(true, true);
        // (a board keeps the stop it shows in the middle of the map, or all of its stops in view, unless the address of a display says where the map is)
        if (state.board !== null && !selection.kept) showBoardStops(data);
        if (again) {
          // (in the address as well, which showAddress leaves where it is that of the stop already)
          if (!state.display) history.replaceState(null, '', `${location.pathname}${boardQuery(location.search, state.board, state.extra, state.lines)}`);
          loadSelection();
          return;
        }
      }
      if (first && selection.type === 'line') {
        // (from now on asked for by the place the server has for it)
        selection.line = { ...selection.line, at: data.at };
        // (opened from a trip, in the direction that trip goes)
        if (data.way !== undefined) selection.way = data.way;
        showAddress(data.path, lineTitle(data));
        shareable(true);
      }
      if (first && selection.type === 'trip') {
        showAddress(data.address, tripTitle(data));
        shareable(true);
      }
      showSelection(first);
      draw();
    } else if (first) {
      panelBody.replaceChildren(el('p', { class: 'panel-empty', text: t('panel.noData') }));
      // (no station where the search has one: its list is of another timetable than the server's)
      if (selection.at) forgetSearchList();
    }
  } catch (err) {
    console.warn('details not loaded:', err);
    if (first && state.selection === selection) panelBody.replaceChildren(el('p', { class: 'panel-empty', text: t('panel.loadFailed') }));
  }
  if (state.selection === selection && !document.hidden) panelTimer = setTimeout(loadSelection, PANEL_REFRESH_MS);
}

/**
 * Shows the details of what is chosen, from what the server said of it last.
 * @param first whether it is shown for the first time
 */
function showSelection(first = false) {
  const { type, data } = state.selection ?? {};
  if (!data) return;
  if (type === 'trip') renderTrip(data, first);
  else if (type === 'line') renderLine(data, first);
  else renderStation(data);
}
// When the page gets another size, the notes in the head have other room (fitNotes).
map.on('resize', () => showSelection());

// (what in the lists of the panel can have the keyboard focus, which it gets back once they are built anew: rows, the badges of lines, the vehicles of a line)
const FOCUSED_IN_BODY = 'button.row, a.row, a.to-line, button.line-vehicle';

/**
 * Replaces what the panel shows: its head, which stays, and what scrolls
 * below it. Both are rebuilt with every refresh, so the row or the button of
 * the head that has the keyboard focus gets it back.
 * @param head the nodes of the head
 */
function fillPanel(head, ...nodes) {
  const focused = [...panelBody.querySelectorAll(FOCUSED_IN_BODY)].indexOf(document.activeElement);
  const inHead = [...panelHead.querySelectorAll('button')].indexOf(document.activeElement);
  // (a button of a board by what it does, where its place on the board changes: data-focus)
  const keyed = focusNext ?? (panel.contains(document.activeElement) ? document.activeElement.dataset?.focus : undefined);
  focusNext = null;
  panelHead.replaceChildren(...head);
  panelBody.replaceChildren(...nodes);
  mainHeading();
  fitNotes();
  // (the sign a pointer is on was built anew with its row, or is gone)
  if (!saidTip.hidden) {
    const sign = document.elementFromPoint(saidAt.x, saidAt.y)?.closest('.sign[data-said]');
    if (sign) showSaid(sign);
    else hideSaid();
  }
  const again = keyed && [...panel.querySelectorAll('[data-focus]')].find((node) => node.dataset.focus === keyed);
  if (again) again.focus({ preventScroll: true });
  else if (focused >= 0) panelBody.querySelectorAll(FOCUSED_IN_BODY)[focused]?.focus({ preventScroll: true });
  else if (inHead >= 0) (panelHead.querySelectorAll('button')[inHead] ?? panel).focus({ preventScroll: true });
}

// (what is to have the keyboard focus once the panel is filled anew, by its data-focus: see "a board of several stops")
let focusNext = null;

/**
 * The main heading of the page (#254): the name of what the details are of,
 * while they are open with one, as the server writes the page of its
 * address; else the name of the instance in the header card, which stands
 * there the same either way.
 */
function mainHeading() {
  const own = !panel.hidden && state.board === null && Boolean(panelHead.querySelector('h1'));
  const name = document.querySelector('.title h1, .title .site-name');
  if (!name || (name.tagName === 'H1') !== own) return;
  const swapped = document.createElement(own ? 'div' : 'h1');
  if (own) swapped.className = 'site-name';
  swapped.textContent = name.textContent;
  name.replaceWith(swapped);
}

// What the rows of panel.js open, and its chip of the lines of a stop: they
// say so in their data and their class, as in the page the server sends.
panel.addEventListener('click', (event) => {
  const row = event.target.closest('[data-trip]');
  const toLine = event.target.closest('a.to-line[data-line]');
  const view = event.target.closest('.view-switch [data-view]');
  const way = event.target.closest('.view-switch [data-way]');
  const station = event.target.closest('a.row[data-station]');
  // (a link to the page of a line or a stop: opened in the details, unless it is to open elsewhere)
  if ((toLine || station) && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
  if (toLine || station) event.preventDefault();
  if (row) select('trip', row.dataset.trip, { fit: 'unseen' });
  else if (station) select('station', station.dataset.station);
  else if (way) showWay(Number(way.dataset.way));
  else if (toLine) selectLine(JSON.parse(toLine.dataset.line));
  else if (view) showView(view.dataset.view);
  else if (event.target.closest('.choice-open')) openChoice();
  else if (event.target.closest('.choice-clear')) applyChoice([]);
});

const platformText = (platform) => (platform ? t('stop.platform', { platform }) : '');

function badge(line, mode, ...more) {
  return toDom(badgeOf(line, mode, ...more));
}

function delayNode(delay) {
  return toDom(delayNodeOf(delay));
}

/** The sign of a warning (panel.js): before a note that warns, or in a list for what the warnings of a train say. */
function warningSign(said = '') {
  return toDom(warningSignOf(said, drawing()));
}

/** A note is long if it does not stand in the head of the details as it is: its headline does, or how it begins. */
const isLong = (note) => note.text.length > NOTE_CHARS || note.text.includes('\n');

/** The delay of a train in a list, with the sign of a warning where something is wrong with it (panel.js). */
function delayCell(delay, warnings, signed) {
  return toDom(delayCellOf(delay, warnings, signed, drawing()));
}

// What the sign of a warning in a list says is shown at the sign while a
// pointer is on it, in the look of the tooltip of the map. A finger does not
// hover (`hovering`): its tap opens the train, whose first note the warning is.
const saidTip = $('said');
let saidAt = null; // where the pointer was when it came upon the sign: { x, y }
const hideSaid = () => { saidTip.hidden = true; };

function showSaid(sign) {
  saidTip.textContent = sign.dataset.said;
  saidTip.hidden = false;
  const at = sign.getBoundingClientRect();
  const page = document.documentElement;
  // below the sign, or above it where there is no room below; and as far left as it takes to be seen whole
  const x = Math.max(8, Math.min(at.left, page.clientWidth - saidTip.offsetWidth - 8));
  const below = at.bottom + 6;
  const y = below + saidTip.offsetHeight > page.clientHeight - 8 ? at.top - 6 - saidTip.offsetHeight : below;
  saidTip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}


panel.addEventListener('pointerover', (event) => {
  const sign = hovering.matches ? event.target.closest('.sign[data-said]') : null;
  if (!sign) return hideSaid();
  saidAt = { x: event.clientX, y: event.clientY };
  showSaid(sign);
});
panel.addEventListener('pointerleave', hideSaid);

/**
 * The notes in the head of the details: what the page has to say itself, and
 * the notes of the feed. Of those some operators write whole pages, and hang
 * dozens on one trip, while the head does not scroll and what is listed below
 * it must stay in sight. So a long note shows its headline, or its first
 * lines where it has none, on a button that opens it in full (showNotes); and
 * the notes are fitted to the room there is for them (fitNotes). A short
 * one stands there as it is.
 *
 * What warns comes first, with the sign of a warning: the page's own warning,
 * then the notes the feed marks as one. Then what else the page says, then
 * the other notes.
 * @param notes those of the feed: { title, text, severity }, title null where it has none
 * @param own lines of the page's own
 * @param alert a line of the page's own that warns
 */
function notesList(notes, own = [], alert = null) {
  // (the text in a part of its own: that is what a narrow screen cuts where it does not fit)
  const line = (text, name) => el('li', name ? { class: name } : {}, [el('span', { text })]);
  const warning = (item) => {
    item.classList.add('warning');
    item.querySelector('span').prepend(warningSign());
    return item;
  };
  const first = alert ? [warning(line(alert, 'alert'))] : [];
  const items = own.map((text) => line(text));
  // (the server has them in this order already; the page does not count on it)
  const urgent = notes.filter(warns);
  const ordered = [...urgent, ...notes.filter((note) => !warns(note))];
  const listed = ordered.map((note) => {
    const item = isLong(note) ? el('li', {}, [noteButton(note.title ?? note.text, [note])]) : line(note.text);
    return warns(note) ? warning(item) : item;
  });
  if (!first.length && !items.length && !listed.length) return '';
  const list = el('ul', { class: 'notes' }, [...first, ...listed.slice(0, urgent.length), ...items, ...listed.slice(urgent.length)]);
  notesToFit = { list, items: [...first, ...items], listed, notes: ordered };
  return list;
}

let notesToFit = null; // the list notesList() made last, until it is in the page: { list, items, listed, notes }

/**
 * Fits the notes in the head to the room there is for them. Only in the page
 * does a note have a size: fillPanel() calls this once the head is there.
 *
 * Of the notes of the feed, those there is no room for are taken out, last
 * ones first, and named by their number instead, on a button that opens
 * them. On a wide screen their room is a share of the height the details have
 * by themselves. On a narrow one, where the details are a sheet, all notes
 * together have NOTES_LINES lines, and each is one line, cut where it does
 * not fit (style.css). A note that is cut becomes a button as well, with its
 * headline if it has one.
 */
function fitNotes() {
  const { list, items, listed, notes } = notesToFit ?? {};
  notesToFit = null;
  if (!list?.isConnected) return;
  const narrow = narrowScreen.matches;
  if (listed.length) {
    const style = getComputedStyle(list);
    const line = parseFloat(style.lineHeight) || 1.4 * parseFloat(style.fontSize);
    const height = (part) => part.getBoundingClientRect().height;
    // (of a sheet's lines the page's own have taken theirs)
    const own = items.reduce((sum, item) => sum + height(item), 0);
    const room = narrow ? NOTES_LINES * line - own : Math.max(NOTES_LINES * line, NOTES_SHARE * viewSize.y);
    let rest = null; // the line that names those taken out
    for (let shown = listed.length - 1; shown > 0 && height(list) - own > room + 1; shown--) {
      listed[shown].remove();
      rest?.remove();
      const text = t('notes.more', { count: notes.length - shown });
      rest = el('li', {}, [noteButton(text, notes.slice(shown), text)]);
      list.append(rest);
    }
  }
  if (!narrow) return;
  /** Makes a button of a line that is cut and not one yet: with the text given, opening the note given. */
  const open = (item, text, note) => {
    const part = item.querySelector(':scope > span');
    if (!part || !item.isConnected || part.scrollWidth <= part.clientWidth) return;
    const button = noteButton(text ?? part.textContent, [note ?? { title: null, text: part.textContent, severity: null }]);
    // (the sign of a warning was in the text that goes)
    if (item.classList.contains('warning')) button.querySelector('span').prepend(warningSign());
    part.replaceWith(button);
  };
  for (const item of items) open(item);
  listed.forEach((item, i) => open(item, notes[i].title ?? notes[i].text, notes[i]));
}

function noteButton(text, notes, heading) {
  return el('button', { type: 'button', class: 'note', 'aria-haspopup': 'dialog', onclick: (event) => showNotes(notes, heading, event.currentTarget) }, [
    el('span', { text }),
    icon(mdiChevronRight),
  ]);
}

// What notes say in full: a dialog like "How it works", in the middle of a
// wide screen and a sheet from the bottom on a narrow one.
const notesDialog = $('notes');
let notesFrom = -1; // which button of the head opened it
closesByClick(notesDialog, $('notes-close'));
// The browser gives the focus back to the button the dialog was opened with.
// That one is gone if the details were refreshed meanwhile: the one in its place gets it then.
notesDialog.addEventListener('close', () => {
  if (!panelHead.contains(document.activeElement)) (panelHead.querySelectorAll('button')[notesFrom] ?? panel).focus({ preventScroll: true });
});

/**
 * Opens the dialog with one note or several.
 * @param heading what the dialog is called; without it, by the headline of its one note
 * @param from the button that opens it
 */
function showNotes(notes, heading, from) {
  const [only] = notes;
  $('notes-title').textContent = heading ?? only.title ?? t('notes.title');
  $('notes-text').replaceChildren(...notes.map((note) => {
    // (the headline of a single note is that of the dialog)
    const parts = [...(note.title !== null && heading ? [el('h3', { text: note.title })] : []), el('p', { text: note.text })];
    if (warns(note)) parts[0].prepend(warningSign());
    return el('div', { class: 'note-full' }, parts);
  }));
  notesFrom = [...panelHead.querySelectorAll('button')].indexOf(from);
  notesDialog.showModal();
  $('notes-text').parentNode.scrollTop = 0;
}

function renderTrip(trip, scrollToNext) {
  const scrollTop = panelBody.scrollTop;
  const lastIndex = trip.stops.length - 1;
  let nextFound = false;
  let nextRow = null;
  // where it is going from the stop ahead, which may be another place than where it set out for (#225)
  let to = trip.stops[lastIndex].to;
  // the town of a stop whose name does not say it, below the name as in the search (#246)
  const towns = townsAlong(trip.stops);

  const rows = trip.stops.map((stop, i) => {
    const isLast = i === lastIndex;
    const planned = isLast ? stop.arr : stop.dep;
    const delay = isLast ? stop.arrDelay : stop.depDelay ?? stop.arrDelay;
    const past = planned + (delay ?? 0) < trip.now;
    const isNext = !past && !nextFound && !stop.skipped;
    if (isNext) {
      nextFound = true;
      to = stop.to;
    }

    const classes = ['row', 'stop'];
    if (past) classes.push('past');
    if (isNext) classes.push('next');
    if (stop.skipped) classes.push('cancelled');
    if (towns[i]) classes.push('in-town');
    const row = el('button', { type: 'button', class: classes.join(' '), onclick: () => select('station', stop.station) }, [
      el('span', { class: 'rail' }),
      el('span', { class: 'time', text: formatTime(leavesAt({ planned, delay })) }),
      stop.skipped ? el('span') : delaySum(planned, delay),
      nameInTown(stop.name, towns[i], { title: stop.name }),
      el('span', { class: 'platform', text: stop.skipped ? t('stop.skipped') : platformText(stop.platform) }),
    ]);
    if (isNext) nextRow = row;
    return el('li', {}, [row]);
  });

  const list = el('ul', { class: 'rows' }, rows);
  list.style.setProperty('--badge-color', `var(--mode-${trip.mode})`);
  const mode = t(`mode.${DRAW_ORDER.includes(trip.mode) ? trip.mode : 'other'}`);
  // Who provides the realtime data shown leads the notes, which are feed content and stay as they are.
  const source = trip.realtime && trip.source ? [t('trip.source', { source: trip.source })] : [];
  // The badge leads to the line, whichever way the trip was chosen (#147),
  // with a sign in it: a finger cannot rest on it to find out.
  const line = { name: trip.line, mode: trip.mode, agency: trip.agency, at: trip.lineAt };
  const toLine = el('button', { type: 'button', class: 'to-line', 'aria-label': t('line.open', { line: trip.line }), title: t('line.open', { line: trip.line }), onclick: () => selectLine(line, { fromTrip: trip.id }) }, [
    badge(trip.line, trip.mode, icon(mdiChevronRight)),
  ]);
  fillPanel(
    [
      el('div', { class: 'panel-head' }, [
        el('h1', {}, [toLine, el('span', { text: `→ ${to}` })]),
        el('p', { class: 'sub', text: [mode, trip.agency, trip.realtime ? t('trip.realtime') : t('trip.scheduleOnly')].filter(Boolean).join(' · ') }),
        notesList(trip.notes, source, trip.cancelled ? t('trip.cancelled') : null),
      ]),
    ],
    list,
  );
  if (scrollToNext) nextRow?.scrollIntoView({ block: 'center' });
  else panelBody.scrollTop = scrollTop;

  // Once, when the trip is opened at its address (#178): the map on where it
  // is, between the stop it left last and the next one; where it is not
  // under way, on all of its run. Opened from a departure or from a vehicle
  // of a line ("unseen"), only to bring a vehicle under way into view, where
  // it is not in view already (#226).
  const selection = state.selection;
  if (!scrollToNext || !selection?.fit) return;
  const unseen = selection.fit === 'unseen';
  selection.fit = false;
  const next = trip.stops.findIndex((stop, i) => (i === lastIndex ? stop.arr + (stop.arrDelay ?? 0) : stop.dep + (stop.depDelay ?? stop.arrDelay ?? 0)) >= trip.now);
  if (unseen && next <= 0) return;
  const points = next > 0 ? [trip.stops[next - 1], trip.stops[next]].flatMap((stop) => [stop.lat, stop.lon]) : trip.path;
  if (points.length < 2 || (unseen && inSight(points))) return;
  const lats = points.filter((_, i) => i % 2 === 0);
  const lons = points.filter((_, i) => i % 2 === 1);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: clearOfCards(), maxZoom: LINE_ZOOM, duration: 0 });
}

/**
 * Opens the view of a line: its vehicles under way in the panel and, alone, on the map.
 * @param more as for select
 */
function selectLine(line, more = {}) {
  select('line', JSON.stringify([line.name, line.mode, line.agency, line.at ?? null]), { line, ...more });
}

/** Whether all the points (latitude, longitude, latitude, …) lie on the part of the map that the cards leave free. */
function inSight(points) {
  const room = clearOfCards();
  for (let i = 0; i < points.length; i += 2) {
    const { x, y } = map.project([points[i + 1], points[i]]);
    if (x < room.left || x > viewSize.x - room.right || y < room.top || y > viewSize.y - room.bottom) return false;
  }
  return true;
}

/** What of each edge of the map is to stay free, so that the cards do not cover what is shown in between. */
function clearOfCards() {
  // (on a phone between the card and the sheet there is room for little more than a vehicle's label as margin)
  const margin = narrowScreen.matches ? 24 : 40;
  const card = $('controls').getBoundingClientRect();
  const details = panel.getBoundingClientRect();
  // On a narrow screen the cards are above and below, else to the left and
  // the right; without details only the one. A sheet just opened is still
  // gliding up as it fills: as high as it may get by itself, as in
  // clearOfSheet.
  // (a board is beside the map, not on it)
  const over = !panel.hidden && state.board === null;
  const sheetTop = !over ? viewSize.y : panel.classList.contains('sized') ? details.top : Math.min(details.top, viewSize.y * (1 - SHEET_MIDDLE));
  const right = !over ? margin : viewSize.x - details.left + margin;
  const fits = (room) => room.left + room.right < 0.8 * viewSize.x && room.top + room.bottom < 0.8 * viewSize.y;
  const padding = narrowScreen.matches
    ? { top: card.bottom + margin, bottom: viewSize.y - sheetTop + margin, left: margin, right: margin }
    : { top: margin, bottom: margin, left: card.right + margin, right };
  if (fits(padding)) return padding;
  // (a map too narrow beside the card, such as beside a board: below the card then)
  const below = { top: card.bottom + margin, bottom: margin, left: margin, right };
  if (!narrowScreen.matches && fits(below)) return below;
  // (in a window too small for that, better covered in part than not shown)
  return { top: margin, bottom: margin, left: margin, right: margin };
}

/**
 * How far from the middle of the map a stop chosen on a narrow screen goes,
 * where the details are about to cover its lower half: above the middle,
 * and clear of the header card where that is taller, as with the colours of
 * the delays on a small phone.
 */
function stopOffset() {
  if (!narrowScreen.matches) return [0, 0];
  const margin = 24;
  const top = $('controls').getBoundingClientRect().bottom + margin;
  const bottom = viewSize.y * (1 - SHEET_MIDDLE) - margin;
  const y = top <= bottom ? Math.min(Math.max(0.38 * viewSize.y, top), bottom) : (top + bottom) / 2;
  return [0, y - viewSize.y / 2];
}

function renderLine(line, first) {
  const scrollTop = panelBody.scrollTop;
  const selection = state.selection;
  selection.ids = new Set(line.vehicles.map((v) => v.id)); // the map shows these alone, see draw()

  // (as the server writes them into the page of the line: panel.js)
  const drawn = drawing();
  // (its stops in one direction, which it shows until another is chosen, with its vehicles along them: #256)
  const way = Math.min(selection.way ?? 0, Math.max(0, (line.ways?.length ?? 1) - 1));
  fillPanel([toDom(lineHead(line, drawn, way))], ...lineStops(line, drawn, way).map((node) => toDom(node)));
  panelBody.scrollTop = scrollTop;
  // (its vehicles drawn at once, as high as the list, and with the frames from now on)
  const paper = lineCanvas();
  if (paper) {
    fitLineCanvas(paper);
    drawLineVehicles(paper);
    nextFrame();
  }

  // Once, when the line is chosen: where it runs into view, between the
  // cards, as far as it is in the area (#148); without that, its vehicles.
  const bounds = selection.route?.bounds;
  if (first && bounds) map.fitBounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]], { padding: clearOfCards(), maxZoom: LINE_ZOOM });
  else if (first && line.vehicles.length) {
    const lats = line.vehicles.map((v) => v.lat);
    const lons = line.vehicles.map((v) => v.lon);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: clearOfCards(), maxZoom: LINE_ZOOM });
  }
}

/** How many whole minutes until a departure leaves, as the clock goes. */
const minutesUntil = (leaves) => Math.floor(leaves / 60) - Math.floor(now() / 60);

/** How long until a departure leaves (panel.js). */
function untilText(leaves, far) {
  return untilTextOf(leaves, far, drawing());
}

/** A delay beside the time a train leaves or arrives, as a sum with the planned time (panel.js). */
function delaySum(planned, delay) {
  return toDom(delaySumOf(planned, delay, drawing()));
}

/** The minutes until a departure leaves, which count down by themselves between two answers of the server (tickTimes). */
function minutesNode(dep, far) {
  return toDom(minutesNodeOf(dep, far, drawing()));
}

/** Where in a list of departures the next day begins (panel.js). */
function tomorrowAt(departures) {
  return tomorrowAtOf(departures, drawing());
}

/** The minutes in the lists of departures and the clock of a board, as time goes on. */
function tickTimes() {
  if (panel.hidden) return;
  const update = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  for (const node of panel.querySelectorAll('.minutes[data-leaves]')) update(node, untilText(Number(node.dataset.leaves), node.dataset.far));
  const clock = panel.querySelector('.board-clock');
  if (clock) update(clock, formatTime(now()));
}


function renderStation(board) {
  if (state.board !== null) {
    renderBoard(board);
    return;
  }
  const scrollTop = panelBody.scrollTop;
  // (as the server writes them into the page of the stop: panel.js)
  // (its next departures, or all its lines: until they come, a word that they are on the way)
  const waiting = state.view === 'lines' && !board.lines;
  const listed = waiting ? [el('p', { class: 'panel-empty', text: t('panel.loading') })] : (state.view === 'lines' ? lineLists : departureLists)(board, drawing()).map((node) => toDom(node));
  fillPanel([toDom(panelHeadOf(stopHeading(board.name, board.town), departuresSub(), notesList(board.notes)))], ...listed);
  panelBody.scrollTop = scrollTop;
  // (the one tip, when there are departures to tap)
  if (state.selection?.tip && board.departures.length) {
    state.selection.tip = false;
    offerTip();
  }
}

// ---------- the details as a sheet ----------

// On a narrow screen the details are a sheet from the bottom of the screen.
// By itself it is as high as what it shows, up to the middle height. The bar
// at its top and its head move it: dragged, it follows the finger and comes
// to rest at one of three heights – its head alone, the middle, and up to
// the header card. Let go of slowly, that is the nearest one, and it closes
// well below the lowest; flicked, it is the next one in that direction, and
// it closes if there is none below.
// A tap on the bar takes it one height up, and from the highest back to the
// middle. What is listed below the head scrolls and does not move the sheet.
const sheetHandle = $('panel-handle');

/** The height of the sheet in px, or null for as high as it is by itself. */
function setSheetHeight(height) {
  // (from the height it has by itself to one it is given: the style sheet can only glide between two numbers)
  if (height !== null && !panel.classList.contains('sized')) {
    panel.style.height = `${panel.offsetHeight}px`;
    panel.classList.add('sized');
    void panel.offsetHeight;
  }
  panel.style.height = height === null ? '' : `${Math.round(height)}px`;
  panel.classList.toggle('sized', height !== null);
}

/** The heights the sheet rests at, lowest first. */
function sheetHeights() {
  const safe = parseFloat(getComputedStyle(panel).paddingBottom) || 0;
  const low = sheetHandle.offsetHeight + panelHead.offsetHeight + safe;
  const middle = Math.round(SHEET_MIDDLE * viewSize.y);
  // (up to the header card, and a gap as between the card and the edge of the screen)
  const high = Math.round(viewSize.y - $('controls').getBoundingClientRect().bottom - 8);
  return [Math.min(low, middle), middle, Math.max(high, middle)];
}

/** Moves the map so that what is at the height y of the screen is not under the sheet, if there is room for it above. */
function clearOfSheet(y) {
  if (!narrowScreen.matches || panel.hidden || state.board !== null) return;
  const top = $('controls').getBoundingClientRect().bottom;
  // (just opened, it is still filling up: as far as it may get by itself)
  const bottom = panel.classList.contains('sized') ? panel.getBoundingClientRect().top : viewSize.y * (1 - SHEET_MIDDLE);
  const margin = 44;
  if (bottom - top < 3 * margin || y < bottom - margin) return;
  map.panBy([0, y - (bottom - margin)], { duration: 300 });
}

/**
 * Keeps the map's buttons in its corner clear of the details (#187): beside
 * them on a wide screen, above the sheet on a narrow one, moving with it and
 * hidden while it leaves no map for them. A board has the map beside it, so
 * the corner is free. The credits under the buttons stay where they are.
 */
let buttonsMoved = { x: 0, y: 0 };
function clearMapButtons() {
  const groups = [...map.getContainer().querySelectorAll('.maplibregl-ctrl-bottom-right > .maplibregl-ctrl-group')];
  if (!groups.length) return;
  // (where they are without being moved)
  const rects = groups.map((group) => group.getBoundingClientRect());
  const at = {
    top: Math.min(...rects.map((r) => r.top)) - buttonsMoved.y,
    bottom: Math.max(...rects.map((r) => r.bottom)) - buttonsMoved.y,
    left: Math.min(...rects.map((r) => r.left)) - buttonsMoved.x,
    right: Math.max(...rects.map((r) => r.right)) - buttonsMoved.x,
  };
  const moved = { x: 0, y: 0 };
  let out = false;
  if (!panel.hidden && state.board === null) {
    const details = panel.getBoundingClientRect();
    // (as far from the details as from the edge of the screen)
    const gap = Math.max(0, window.innerWidth - at.right);
    if (!narrowScreen.matches) {
      if (details.bottom > at.top && details.left < at.right) moved.x = details.left - gap - at.right;
    } else if (details.top < at.bottom) {
      moved.y = details.top - gap - at.bottom;
      out = at.top + moved.y < $('controls').getBoundingClientRect().bottom + gap;
    }
  }
  buttonsMoved = moved;
  for (const group of groups) {
    group.style.transform = moved.x || moved.y ? `translate(${moved.x}px, ${moved.y}px)` : '';
    group.style.visibility = out ? 'hidden' : '';
  }
}
const clearing = new ResizeObserver(clearMapButtons);
clearing.observe(panel);
// (and their corner: the credits below them fold up once the map is there, which moves the buttons down, #254)
clearing.observe(map.getContainer().querySelector('.maplibregl-ctrl-bottom-right'));
map.on('resize', clearMapButtons);

/** The sheet comes to rest at a height, and what is chosen on the map stays in sight above it. */
function restSheet(height) {
  setSheetHeight(height);
  // (once it has got there: the way up is a transition of the style sheet)
  setTimeout(() => {
    if (state.chosenAt && state.selection) clearOfSheet(state.chosenAt.y);
  }, 220);
}

sheetHandle.addEventListener('click', () => {
  // (on a board the bar is the grip of its edge, see "the board")
  if (state.board !== null) return;
  const heights = sheetHeights();
  const now = panel.offsetHeight;
  // one up from where it is, and from the highest back to the middle
  const next = heights.find((height) => height > now + 4) ?? heights[1];
  restSheet(next);
});

{
  let drag = null; // while a finger is down on the bar or the head: where it began and whether it has moved enough to drag
  const begin = (event) => {
    if (!narrowScreen.matches || state.board !== null || !event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, y: event.clientY, height: panel.offsetHeight, moved: false, last: [[event.timeStamp, event.clientY]] };
    // From here on all of it comes to this part, wherever the pointer goes: a
    // finger does that by itself, a mouse does not. Not from a button in the
    // head, though: a click on it would then be one on the head.
    if (event.currentTarget === sheetHandle || !event.target.closest('button')) event.currentTarget.setPointerCapture(drag.id);
  };
  const move = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const by = drag.y - event.clientY;
    if (!drag.moved) {
      if (Math.abs(by) < SHEET_DRAG_PX) return;
      drag.moved = true;
      event.currentTarget.setPointerCapture(drag.id);
      panel.classList.add('dragging');
    }
    const [, , high] = sheetHeights();
    setSheetHeight(Math.max(24, Math.min(high + 16, drag.height + by)));
    drag.last.push([event.timeStamp, event.clientY]);
    if (drag.last.length > 5) drag.last.shift();
  };
  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { moved, last } = drag;
    drag = null;
    if (!moved) return;
    panel.classList.remove('dragging');
    // A tap ends in a click, a drag must not: on the bar it would move the sheet again, on a button in the head press it.
    const swallow = (click) => {
      click.stopPropagation();
      click.preventDefault();
    };
    panel.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => panel.removeEventListener('click', swallow, { capture: true }), 300);
    const [[t0, y0]] = last;
    const [t1, y1] = last.at(-1);
    const speed = t1 > t0 ? (y0 - y1) / (t1 - t0) : 0; // px per ms, upwards
    const now = panel.offsetHeight;
    const heights = sheetHeights();
    let rest; // the height to come to rest at, or undefined to close
    if (event.type === 'pointercancel') rest = heights[1];
    else if (speed > SHEET_FLICK) rest = heights.find((height) => height > now) ?? heights.at(-1);
    else if (speed < -SHEET_FLICK) rest = [...heights].reverse().find((height) => height < now);
    else if (now >= heights[0] - SHEET_CLOSE_PX) rest = heights.reduce((best, height) => (Math.abs(height - now) < Math.abs(best - now) ? height : best));
    if (rest === undefined) closePanel();
    else restSheet(rest);
  };
  for (const part of [sheetHandle, panelHead]) {
    part.addEventListener('pointerdown', begin);
    part.addEventListener('pointermove', move);
    part.addEventListener('pointerup', end);
    part.addEventListener('pointercancel', end);
  }
}

// On a wide screen the details are a card at the side, as high as they are by themselves.
narrowScreen.addEventListener('change', () => setSheetHeight(null));

// A dialog is a sheet on a narrow screen as well: its bar and its heading
// drag it down, and let go of far enough down it closes.
for (const [dialog, ...parts] of [[aboutDialog, $('about-handle'), $('about-title')], [notesDialog, $('notes-handle'), $('notes-title')], [choiceDialog, $('choice-handle'), $('choice-title')]]) {
  let drag = null;
  const shift = (px) => { dialog.style.transform = px ? `translateY(${Math.round(px)}px)` : ''; };
  const begin = (event) => {
    if (!narrowScreen.matches || !event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(drag.id);
  };
  const move = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const by = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(by) < SHEET_DRAG_PX) return;
      drag.moved = true;
      dialog.classList.add('dragging');
    }
    shift(Math.max(0, by));
  };
  const end = (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { moved, y } = drag;
    drag = null;
    if (!moved) return;
    dialog.classList.remove('dragging');
    shift(0);
    if (event.type !== 'pointercancel' && event.clientY - y > SHEET_CLOSE_PX) dialog.close();
  };
  for (const part of parts) {
    part.addEventListener('pointerdown', begin);
    part.addEventListener('pointermove', move);
    part.addEventListener('pointerup', end);
    part.addEventListener('pointercancel', end);
  }
}

// ---------- the board (#81) ----------

// The details of a stop enlarge into a board, for a screen that shows the
// departures there: the same on every screen, a dashboard whatever its size.
// On a screen wider than high the map is on the left and the board on the
// right; on one standing upright, a phone among them, the map is above and
// the board below (style.css). The edge between them is dragged by the grip
// in its middle, from a narrow board to all of the screen, where the map is
// gone; the map keeps the stop in its middle. The board is part of the
// address of the stop (board=<share>, display.js), so that the address opens
// it again, and with display=fixed puts it on a wall.

const upright = matchMedia('(orientation: portrait)'); // as in style.css
// The data of the timetable are credited on the map; with all of the screen
// the board does that itself (loadArea).
let boardCredits = '';
// (what a board took last, for the next one)
let boardWas = BOARD_SHARE;

/**
 * Enlarges the details of the open stop into a board that takes this share
 * of the screen, or makes it the details again (null).
 * @param written whether the address is to say so now: not while the edge is dragged
 */
function setBoard(share, written = true) {
  const was = state.board;
  state.board = share;
  const root = document.documentElement;
  if (share === null) {
    delete root.dataset.board;
    root.style.removeProperty('--board');
  } else {
    boardWas = share;
    root.dataset.board = share === 100 ? 'alone' : '';
    root.style.setProperty('--board', `${share}%`);
  }
  const label = share === null ? t('panel.enlarge') : t('panel.shrink');
  boardButton.title = label;
  boardButton.setAttribute('aria-label', label);
  boardButton.replaceChildren(icon(share === null ? mdiArrowExpand : mdiArrowCollapse));
  if ((was === null) !== (share === null)) {
    // (a sheet has a height of its own, a board its share; in the map's corner there is room for the map's own buttons)
    setSheetHeight(null);
    showSelection();
    const at = state.selection?.data;
    if (share !== null && state.selection?.type === 'station' && at) {
      showBoardStops(at);
      // (the further stops it had before it was made small, with their departures as they are now)
      if (state.extra.length) loadSelection();
    }
  }
  if (written) writeBoard();
}

/** Puts the board into the address of the page, or takes it out. */
function writeBoard() {
  if (state.display) writeAddress();
  else history.replaceState(null, '', `${location.pathname}${boardQuery(location.search, state.board, state.extra, state.lines)}`);
}

boardButton.addEventListener('click', () => setBoard(state.board === null ? boardWas : null));

/**
 * The departures of a stop as a board: the line, where it goes and when it
 * leaves, in type that grows with the board (style.css), as many as there is
 * room for (fitBoard). A row is not a button: a board is read, not operated.
 * A board of several stops has them in blocks, each one list (see "a board of
 * several stops"): in one column the first block's heading is the head of the
 * board, in columns each block has its own.
 */
function renderBoard(board) {
  const times = state.times;
  const entries = boardEntries(board);
  const blocks = boardBlocks(entries[0], entries.slice(1));
  const controls = !state.display;
  const columns = boardColumns(blocks.length);
  renderedColumns = columns;
  const headings = blocks.map((block, i) => blockHeading(block, i, i ? 'h3' : 'h2', controls, entries.length));
  // (the lines chosen are those of the open stop, whose block is the first)
  const sub = (i = 0) => (i ? el('p', { class: 'sub', text: t('departures.title') }) : departuresSub(true));
  const clock = state.clock ? [el('p', { class: 'board-clock', text: formatTime(now()) })] : [];
  // (the notes of the open stop in the head in either case: over the first column in columns)
  const head = columns > 1 ? [...clock, notesList(board.notes)] : [headings[0], sub(), ...clock, notesList(board.notes)];
  const sections = blocks.map((block, i) => el('section', { class: 'board-block' }, [
    ...(columns > 1 ? [headings[i], sub(i)] : i ? [headings[i]] : []),
    ...blockRows(block, times),
  ]));
  const credits = el('p', { class: 'board-credits' });
  credits.innerHTML = [escapeHtml(siteName), boardCredits].filter(Boolean).join(' · ');
  const blocksNode = el('div', { class: `board-blocks${columns > 1 ? ' columns' : ''}` }, sections);
  blocksNode.style.setProperty('--columns', columns);
  fillPanel(
    [el('div', { class: `panel-head board-head${columns > 1 ? ' columns' : ''}` }, head)],
    blocksNode,
    // (another stop, as a block of its own: up to BOARD_STOPS, and not on a wall)
    ...(controls && entries.length < BOARD_STOPS ? [el('button', { type: 'button', class: 'board-add', data: { focus: 'add' }, onclick: () => startAdding(null) }, [icon(mdiPlus), el('span', { text: t('board.another') })])] : []),
    credits,
  );
  fitBoard();
}

/** One departure on a board; in a list of several stops, with the stop it leaves from under where it goes. */
function boardRow(dep, times, from = null) {
  // (a delay shows where there is one: on time the board says nothing)
  const delay = Math.round((dep.delay ?? 0) / 60) === 0 ? null : dep.delay;
  // (with the time it leaves, as a sum with the planned time; before the minutes, alone)
  const late = delayCell(times === 'minutes' ? delayNode(delay) : delaySum(dep.planned, delay), dep.warnings, dep.warnings.length > 0);
  // (further off than an hour, the time of day stands where the minutes do, and with both not twice)
  const far = minutesUntil(leavesAt(dep)) > MINUTES_MAX;
  const at = (shown = true) => el('span', { class: 'at', text: shown ? formatTime(leavesAt(dep)) : '' });
  const when = dep.cancelled ? [el('span', { class: 'gone', text: t('departures.cancelled') })]
    : times === 'time' ? [at(), late]
      : times === 'minutes' ? [late, minutesNode(dep, 'time')]
        : [at(!far), late, minutesNode(dep, 'time')];
  const name = from === null
    ? el('span', { class: 'name', text: dep.to })
    : el('span', { class: 'name from' }, [el('span', { class: 'to', text: dep.to }), el('span', { class: 'stop', text: t('board.from', { stop: from }) })]);
  return el('li', { class: dep.cancelled ? 'cancelled' : '' }, [
    badge(dep.line, dep.mode),
    name,
    el('span', { class: 'platform', text: platformText(dep.platform) }),
    el('span', { class: `when times-${times}` }, when),
  ]);
}

/** What a block of a board shows below its heading: the stops of it the timetable does not have, and its departures. */
function blockRows(block, times) {
  const gone = block.filter((entry) => entry.known?.gone).map((entry) => el('p', { class: 'board-gone', text: t('board.gone', { stop: nameOf(entry) }) }));
  const shown = block.filter((entry) => entry.known?.departures);
  // (not yet there: the block waits for them)
  if (!shown.length) return gone;
  const { rows: from } = namesOf(block);
  const merged = shown.length > 1;
  const departures = merged ? mergedDepartures(shown) : shown[0].known.departures.departures.map((dep) => ({ dep, from: null }));
  const rows = departures.map((each) => boardRow(each.dep, times, merged ? from[block.indexOf(each.from)] : null));
  // (where the next day begins, a line across the board says so)
  const split = tomorrowAt(departures.map(({ dep }) => dep));
  if (split >= 0) rows.splice(split, 0, el('li', { class: 'day' }, [el('span', { text: t('departures.tomorrow') })]));
  return [...gone, rows.length ? el('ul', { class: `board-rows times-${times}` }, rows) : el('p', { class: 'panel-empty', text: t('departures.none') })];
}

/** Shows as many departures as each list of the board has room for: whole rows, those that do not fit hidden. */
function fitBoard() {
  const lists = [...panelBody.querySelectorAll('.board-rows')];
  // (all shown first: the blocks are shared out by how much they have, then each list is cut where its block ends)
  for (const list of lists) for (const row of list.children) row.hidden = false;
  shareBoard();
  // (where even the smallest type leaves too little room, the last blocks end below the board's)
  const end = panelBody.querySelector('.board-blocks')?.getBoundingClientRect().bottom ?? Infinity;
  const cuts = lists.map((list) => {
    const room = Math.min(list.getBoundingClientRect().bottom, end) + 0.5;
    const rows = [...list.children];
    return { rows, over: rows.findIndex((row) => row.getBoundingClientRect().bottom > room) };
  });
  for (const { rows, over } of cuts) {
    if (over >= 0) for (const row of rows.slice(over)) row.hidden = true;
    // (the line of the next day goes with the row it stands over)
    const shown = rows.filter((row) => !row.hidden);
    if (shown.at(-1)?.classList.contains('day')) shown.at(-1).hidden = true;
  }
}
/**
 * Gives each block of a board in one column its share of the height: what
 * it has, where that is less than an even share, and the rest evenly to the
 * others. In columns they are even (style.css).
 */
function shareBoard() {
  const node = panelBody.querySelector('.board-blocks');
  if (!node) return;
  const blocks = [...node.children];
  for (const block of blocks) block.style.height = '';
  node.style.fontSize = '';
  if (node.classList.contains('columns') || blocks.length < 2) return;
  let free = node.clientHeight - blocks.reduce((sum, block) => sum + Number.parseFloat(getComputedStyle(block).marginTop), 0);
  // Each block needs at least its heading and its next departure. Where the
  // board has no room for that in each, its type gets smaller until it has.
  let least = leastOfBlocks(blocks);
  for (let fit = 1, tries = 0; tries < 4 && sumOf(least.values()) > free && fit > BOARD_LEAST_TYPE; tries++) {
    fit = Math.max(BOARD_LEAST_TYPE, fit * free / sumOf(least.values()));
    node.style.fontSize = `${fit}em`;
    least = leastOfBlocks(blocks);
  }
  // (without a height of their own they are as high as all they have: style.css)
  const has = new Map(blocks.map((block) => [block, block.offsetHeight]));
  let open = blocks;
  while (open.length) {
    const share = free / open.length;
    // (what has less than an even share keeps what it has, what needs more for its next departure gets that)
    const set = open.filter((block) => has.get(block) <= share || least.get(block) >= share);
    if (!set.length) {
      for (const block of open) block.style.height = `${share}px`;
      break;
    }
    for (const block of set) {
      const height = has.get(block) <= share ? has.get(block) : least.get(block);
      block.style.height = `${height}px`;
      free -= height;
    }
    open = open.filter((block) => !set.includes(block));
  }
}

/** How high each block of a board has to be for its heading and its next departure (all it has, where it has none). */
function leastOfBlocks(blocks) {
  return new Map(blocks.map((block) => {
    const next = block.querySelector('.board-rows > li:not(.day)');
    if (!next) return [block, block.offsetHeight];
    return [block, next.getBoundingClientRect().bottom - block.getBoundingClientRect().top + Number.parseFloat(getComputedStyle(block).paddingBottom)];
  }));
}

const sumOf = (values) => [...values].reduce((all, value) => all + value, 0);
// (the board's room changes with its share of the screen, and with the screen; and with it how many columns its blocks have)
new ResizeObserver(() => {
  if (state.board === null) return;
  if (state.extra.length && boardColumns(boardBlocks({}, state.extra).length) !== renderedColumns) showSelection();
  else fitBoard();
}).observe(panel);

// ---------- a board of several stops (#163) ----------

// Besides the stop that is open, a board shows up to BOARD_STOPS - 1 more
// (display.js): each in a block of its own, or in the list of the block
// before it, their departures together in the order they leave. Where one is
// added decides which: the button at the foot of the board adds a block, the
// one at a block's heading adds to its list. The address says what is on the
// board, so that it opens the same again and goes on a wall that way; a stop
// the timetable does not have (any more) stays in it and says so.

// A wide board puts its blocks side by side, in columns as wide as 22 of
// the type of a column (style.css), which is less than the board's where
// that is needed, but not less than BOARD_COLUMN_TYPE of it, nor 16 pixels.
const BOARD_COLUMN_TYPE = 0.6;
// (where its blocks have no room for their next departures, a board's type gets smaller, but not below this of its own: shareBoard)
const BOARD_LEAST_TYPE = 0.6;
// (an answer of api/departures with fewer departures than this has all of the next 24 hours: departures() in server/lib/timetable.js, least)
const BOARD_LEAST = 10;
const STOP_RETRY_MS = 10 * 60_000; // a stop of an address the timetable does not have is asked for again after this
// What is known of each further stop, by its path: { name, lat, lon, departures (the answer of api/departures), gone, askedAt }.
const boardStopData = new Map();
let renderedColumns = 1; // the columns of the board drawn last

/** Asks for what is not yet known of a further stop of the board, and for its departures. */
async function loadBoardStop(stop) {
  let known = boardStopData.get(stop.path);
  if (!known || known.lost || (known.gone && Date.now() - known.askedAt > STOP_RETRY_MS)) {
    const res = await fetch(`api/address?path=${encodeURIComponent(`stop/${stop.path}`)}`);
    // (no timetable yet: asked again with the next refresh)
    if (res.status === 503) return;
    if (!res.ok) {
      boardStopData.set(stop.path, { gone: true, askedAt: Date.now() });
      return;
    }
    const found = await res.json();
    known = { name: found.name, lat: found.lat, lon: found.lon, departures: null, gone: false };
    // (a stop that has moved a little, or has another name: the address says where it is now)
    const path = found.path.slice('stop/'.length);
    boardStopData.set(path, known);
    if (path !== stop.path) {
      // (and where that is a stop on the board already, it is there once)
      const twice = path === boardList()[0].path || state.extra.some((other) => other !== stop && other.path === path);
      if (twice) state.extra = state.extra.filter((other) => other !== stop);
      else stop.path = path;
      writeBoard();
      if (twice) return;
    }
  }
  if (known.gone) return;
  const res = await fetch(`api/departures?at=${known.lat.toFixed(5)},${known.lon.toFixed(5)}`);
  // (not found at its place: a timetable since has it elsewhere, or not; asked again where it is)
  if (res.status === 404) {
    known.departures = null;
    known.lost = true;
  } else if (res.ok) {
    known.departures = await res.json();
  }
}

/**
 * Where the first stop of the address of a board is not in the timetable:
 * opens the board at the first further stop that is, its block first, and
 * keeps the one that is not in its list, so that it comes back with a later
 * timetable. False where the address has no further stop the timetable has.
 */
async function openNextStop(path) {
  const named = parseAddress(path);
  const board = readBoard(location.search);
  if (named?.type !== 'stop' || board === null) return false;
  const first = path.slice('stop/'.length);
  const stops = readStops(location.search, first);
  for (const stop of stops) {
    const res = await fetch(`api/address?path=${encodeURIComponent(`stop/${stop.path}`)}`);
    if (!res.ok) continue;
    const found = await res.json();
    // (the lists stay as the address has them, for when it is back)
    const rest = ledBy([{ path: first, joined: false }, ...stops], stop).slice(1);
    boardStopData.set(first, { gone: true, askedAt: Date.now() });
    history.replaceState(null, '', new URL(`${found.path}${boardQuery(location.search, board, rest)}`, document.baseURI));
    return openAddress();
  }
  return false;
}

/** Asks for the further stops of the board; a stop that does not answer keeps what it had. */
const loadBoardStops = () => Promise.allSettled(state.extra.map(loadBoardStop));

/** The stops of the board in its order, the open one first, each with what is known of it: [{ path, joined, known }]. */
function boardEntries(board) {
  return [
    { path: stopPathOf(board).slice('stop/'.length), joined: false, known: { name: board.name, lat: board.lat, lon: board.lon, departures: board, gone: false } },
    ...state.extra.map((stop) => ({ ...stop, known: boardStopData.get(stop.path) ?? null })),
  ];
}

/** The name of a stop of the board; of one the timetable does not have, the words of its address. */
function nameOf(entry) {
  if (entry.known?.name) return entry.known.name;
  return wordsOf(entry.path.split('@')[0]).replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

/**
 * The names of the stops of a block, in full and as a list of several
 * writes them after the first (shortNames): { full, short, rows }. Where two
 * have the same name (a stop on each side of the street), the heading counts
 * them, so that each minus says which; a row says where it leaves from, which
 * is the same name for both: where it goes says which side.
 */
function namesOf(block) {
  const names = block.map(nameOf);
  const apart = [...new Set(names)];
  const shorter = new Map(apart.map((name, i) => [name, apart.length > 1 ? shortNames(apart)[i] : name]));
  const counted = (name, i) => (names.indexOf(name) === names.lastIndexOf(name) ? '' : ` (${names.slice(0, i + 1).filter((other) => other === name).length})`);
  return {
    full: names.map((name, i) => name + counted(name, i)),
    short: names.map((name, i) => shorter.get(name) + counted(name, i)),
    rows: names.map((name) => shorter.get(name)),
  };
}

/**
 * Names as a list of several stops writes them after the first: without the
 * words they all begin with, but never without a word of their own, and
 * only where they stay apart.
 */
function shortNames(names) {
  const words = names.map((name) => name.split(' '));
  let shared = 0;
  while (words.every((each) => each.length > shared + 1 && each[shared] === words[0][shared])) shared++;
  const apart = (cut) => new Set(words.map((each) => each.slice(cut).join(' '))).size === words.length;
  while (shared > 0 && !apart(shared)) shared--;
  return words.map((each) => each.slice(shared).join(' '));
}

/**
 * The departures of the stops of one list in the order they leave: [{ dep, from }].
 * Each stop's answer ends somewhere (departures() in server/lib/timetable.js
 * sends only so many), so the list ends where the first of them does: past
 * that, a busy stop would seem to have nothing more.
 */
function mergedDepartures(entries) {
  const lists = entries.filter((entry) => entry.known.departures.departures.length);
  // (an answer of fewer than BOARD_LEAST has all of the next 24 hours; one whose last departure has left is old, and is cut where it ends anyway)
  const cut = lists.map((entry) => entry.known.departures.departures).filter((deps) => deps.length >= BOARD_LEAST).map((deps) => Math.max(...deps.map(leavesAt))).filter((last) => last >= now());
  const until = Math.min(Infinity, ...cut);
  return lists
    .flatMap((entry, order) => entry.known.departures.departures.map((dep) => ({ dep, from: entry, order })))
    .filter(({ dep }) => leavesAt(dep) <= until)
    .sort((a, b) => leavesAt(a.dep) - leavesAt(b.dep) || a.order - b.order);
}

/**
 * The heading of a block: the names of its stops, after the first without
 * what they all begin with. With the controls, a minus after each name takes
 * that stop away (once the board has several), and the list button adds a
 * stop to the block. Its name for a screen reader is the names alone.
 */
function blockHeading(block, index, tag, controls, total) {
  const { full: names, short } = namesOf(block);
  const control = (shape, label, focus, onclick, name) => el('button', { type: 'button', class: `board-control ${name}`, title: label, 'aria-label': label, data: { focus }, onclick }, [icon(shape)]);
  const parts = block.map((entry, i) => {
    // (after the first, a dot before each name: style.css)
    const name = i ? short[i] : names[i];
    if (!(controls && total > 1)) return el('span', { class: 'stop', text: name });
    // (its minus goes with its last letter: it stays on the line of the name it takes away)
    const letters = [...name];
    const minus = control(mdiMinusCircleOutline, t('board.remove', { stop: names[i] }), `remove:${entry.path}`, () => removeBoardStop(entry.path), 'remove');
    return el('span', { class: 'stop' }, [letters.slice(0, -1).join(''), el('span', { class: 'end' }, [letters.at(-1), minus])]);
  });
  if (controls && total < BOARD_STOPS) parts.push(control(mdiPlaylistPlus, t('board.merge', { stop: names[0] }), `merge:${index}`, () => startAdding(index), 'merge'));
  const heading = el(tag, { class: 'board-heading' }, parts);
  if (block.length > 1 || controls) heading.setAttribute('aria-label', new Intl.ListFormat(language, { type: 'conjunction' }).format(names));
  return heading;
}

/** How many columns the blocks of a board stand in: as many as the board has room for, in type not too small (BOARD_COLUMN_TYPE). */
function boardColumns(blocks) {
  const size = Number.parseFloat(getComputedStyle(panelBody).fontSize) || 16;
  // (as the column's type is worked out in style.css: the board's width less its edges and the gaps, shared out, and 22 of the type in each)
  const type = (columns) => (panel.clientWidth - (0.6 + 1.2 * columns) * size) / columns / 22;
  for (let columns = blocks; columns > 1; columns--) if (type(columns) >= Math.max(16, BOARD_COLUMN_TYPE * size)) return columns;
  return 1;
}

/** Brings the stops of the board into view: the open one in the middle of the map, or all of them where there are several. */
function showBoardStops(first) {
  const places = [first, ...state.extra.map((stop) => boardStopData.get(stop.path))].filter((place) => place && !place.gone && Number.isFinite(place.lat));
  if (places.length < 2) {
    map.jumpTo({ center: [first.lon, first.lat] });
    return;
  }
  const lats = places.map((place) => place.lat);
  const lons = places.map((place) => place.lon);
  const padding = clearOfCards();
  // (on a narrow map the credits lie across its foot until it is touched: no stop under them)
  const credits = map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.getBoundingClientRect();
  const view = map.getContainer().getBoundingClientRect();
  if (credits && credits.width > view.width / 2) {
    const below = view.bottom - credits.top + 8;
    if (padding.top + below < 0.8 * view.height) padding.bottom = Math.max(padding.bottom, below);
  }
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding, maxZoom: SEARCH_ZOOM, duration: 0 });
}

/** The stops of the board in its order, the open one first: [{ path, joined }]. */
function boardList() {
  const data = state.selection?.data;
  const first = data ? stopPathOf(data).slice('stop/'.length) : here().slice('stop/'.length);
  return [{ path: first, joined: false }, ...state.extra.map((stop) => ({ ...stop }))];
}

/** Whether a stop on the map is one of the open board's: the one it is of, or a further one. */
function onBoard(station) {
  const open = state.selection?.type === 'station' && state.selection.data;
  if (!open || state.board === null) return false;
  const path = stopPathOf(station);
  return [open, ...state.extra.map((stop) => boardStopData.get(stop.path))].some((place) => place?.name && stopPathOf(place) === path);
}

/** Takes a stop out of the list of a board: the stop after it begins its block where it did. */
function without(list, at) {
  const [gone] = list.splice(at, 1);
  if (list[at] && !gone.joined) list[at].joined = false;
  if (list.length) list[0].joined = false;
  return list;
}

/**
 * Adds a stop of the search to the board: to the list of a block, or (null)
 * as a block of its own. One that is on the board already moves there.
 */
function addBoardStop(stop, block) {
  const path = stopPathOf(stop).slice('stop/'.length);
  // (what the search knows of it, until its departures are there)
  if (!boardStopData.get(path)?.name) boardStopData.set(path, { name: stop.name, lat: stop.lat, lon: stop.lon, departures: null, gone: false });
  const list = boardList();
  const blocks = boardBlocks(list[0], list.slice(1));
  const into = block === null ? null : blocks[block];
  const at = list.findIndex((entry) => entry.path === path);
  // (in that list already: nothing to do)
  if (at >= 0 && into?.includes(list[at])) {
    focusBoard(`remove:${path}`);
    return;
  }
  const after = into?.at(-1) ?? null;
  if (at >= 0) without(list, at);
  if (after) list.splice(list.indexOf(after) + 1, 0, { path, joined: true });
  else list.push({ path, joined: false });
  usableFirst(list);
  applyBoardList(list, `remove:${path}`);
}

/** Takes a stop off the board; the keyboard focus goes to the minus of the stop after it. */
function removeBoardStop(path) {
  const list = boardList();
  const at = list.findIndex((entry) => entry.path === path);
  if (at < 0) return;
  const next = list[at + 1] ?? null;
  without(list, at);
  if (!usableFirst(list)) {
    closePanel();
    return;
  }
  // (one stop left: it has no minus, but the list button)
  applyBoardList(list, list.length < 2 ? 'merge:0' : `remove:${(next ?? list.at(-1)).path}`);
}

/**
 * Puts a stop the timetable has at the front of the list of a board, where
 * the first is none: the board is at its first stop. False where it has none.
 */
function usableFirst(list) {
  const current = boardList()[0].path;
  const usable = list.findIndex((entry) => entry.path === current || boardStopData.get(entry.path)?.name);
  if (usable < 0) return false;
  if (usable === 0) return true;
  list.splice(0, list.length, ...ledBy(list, list[usable]));
  return true;
}

/** Puts the board in this order: the address, the open stop where the first one has changed, and the board as it is now. */
function applyBoardList(list, focus) {
  const was = boardList()[0].path;
  if (list[0].path !== was) {
    // (the stop that was first stays known, if it is still on the board elsewhere)
    const data = state.selection?.data;
    if (data) boardStopData.set(was, { name: data.name, lat: data.lat, lon: data.lon, departures: data, gone: false });
    const first = boardStopData.get(list[0].path);
    state.selection = { type: 'station', id: null, data: first.departures ?? null, at: { name: first.name, lat: first.lat, lon: first.lon } };
    // (the lines chosen were of the stop that led)
    state.lines = [];
    // (in place of the address so far, not as a step back: then the title, which showAddress gives it without a step there)
    history.replaceState(null, '', new URL(`stop/${list[0].path}${location.search}`, document.baseURI));
    showAddress(`stop/${list[0].path}`, stopTitle(first.name, first.departures?.town));
  }
  state.extra = list.slice(1);
  writeBoard();
  focusNext = focus;
  askDraw();
  showSelection();
  if (state.selection?.data) showBoardStops(state.selection.data);
  // (with the departures of what is new on it, and of all others as they are now)
  loadSelection();
}

/** Moves the keyboard focus to a button of the board, by what it does (data-focus). */
function focusBoard(key) {
  const node = [...panel.querySelectorAll('[data-focus]')].find((each) => each.dataset.focus === key);
  (node ?? panel).focus({ preventScroll: true });
}

/** Opens the search to add a stop to the board: to the list of a block, or (null) as a block of its own. */
function startAdding(block) {
  const list = boardList();
  const into = block === null ? null : boardBlocks(list[0], list.slice(1))[block];
  const first = into && (block === 0 ? state.selection?.data?.name : nameOf({ ...into[0], known: boardStopData.get(into[0].path) ?? null }));
  state.adding = { block };
  const mode = $('search-mode');
  mode.textContent = block === null ? t('board.addTitle') : t('board.mergeTitle', { stop: first });
  mode.hidden = false;
  searchResults.setAttribute('aria-labelledby', 'search-mode');
  document.documentElement.dataset.adding = '';
  $('controls').classList.add('searching');
  searchField.value = '';
  searchField.focus();
  runSearch();
}

/** Ends adding to the board, if the search was doing that: what it was, or null. */
function endAdding() {
  const adding = state.adding;
  if (!adding) return null;
  state.adding = null;
  $('search-mode').hidden = true;
  searchResults.removeAttribute('aria-labelledby');
  delete document.documentElement.dataset.adding;
  return adding;
}

// The grip in the middle of the edge: dragged, the edge follows it; from
// the keyboard the arrows move it. Where the board takes as much as it may
// beside the map, the next step is all of the screen, and from there back.
{
  let drag = null; // the pointer that holds the grip
  sheetHandle.addEventListener('pointerdown', (event) => {
    if (state.board === null || !event.isPrimary || event.button !== 0) return;
    drag = event.pointerId;
    sheetHandle.setPointerCapture(drag);
    panel.classList.add('dragging');
  });
  sheetHandle.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag) return;
    const share = boardShare(100 * (upright.matches ? 1 - event.clientY / innerHeight : 1 - event.clientX / innerWidth));
    if (share !== state.board) setBoard(share, false);
  });
  const end = (event) => {
    if (event.pointerId !== drag) return;
    drag = null;
    panel.classList.remove('dragging');
    writeBoard();
  };
  sheetHandle.addEventListener('pointerup', end);
  sheetHandle.addEventListener('pointercancel', end);
  sheetHandle.addEventListener('keydown', (event) => {
    const by = { ArrowLeft: 5, ArrowUp: 5, ArrowRight: -5, ArrowDown: -5 }[event.key];
    if (state.board === null || !by) return;
    event.preventDefault();
    const larger = by > 0;
    const next = state.board === 100 ? (larger ? 100 : BOARD_MAX) : state.board === BOARD_MAX && larger ? 100 : boardShare(state.board + by);
    if (next !== state.board) setBoard(next);
  });
}

// ---------- data loading ----------

let pollTimer = null;
let pollSeq = 0;
let stationSeq = 0;

// What the server covers and how to show it: the area and its name, the map
// section to start with, the map behind it and the time zone. It does not
// change while the server runs, so it is asked for until it has answered once.
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Where the links to the software lead: to its README in the language of the
// page where there is one of its own (READMES), else to the main one, which a
// phone shows only below a list of the files of the repository unless the
// address asks for it.
function readmeOf(homepage) {
  const language = document.documentElement.lang;
  return READMES.includes(language) ? `${homepage}/blob/main/README.${language}.md` : `${homepage}#readme`;
}

/**
 * What is running, for the credits: the name with a link to where it comes
 * from and the version, "edge" together with its commit. If the server knows
 * of a newer release, a marker follows that leads to the release notes.
 * @param about the answer of api/status, or null if there was none
 */
function versionCredit(about) {
  if (typeof about?.version !== 'string' || typeof about.homepage !== 'string') return '';
  const version = about.version === 'edge' && about.commit ? `edge · ${about.commit.slice(0, 7)}` : about.version;
  const credit = `<a href="${escapeHtml(readmeOf(about.homepage))}" target="_blank" rel="noopener">${APP_NAME}</a> ${escapeHtml(version)}`;
  if (!about.update) return credit;
  const note = escapeHtml(t('update.available', { version: about.update.version }));
  return `${credit} <a class="update" href="${escapeHtml(about.update.url)}" title="${note}" target="_blank" rel="noopener">↑ ${escapeHtml(about.update.version)}</a>`;
}

/**
 * @returns nothing once the map shows the area. An instance without an area
 *   does not know what it covers before it has a timetable: then what the
 *   server says of how far it has got, as it does where vehicles are asked for.
 */
async function loadArea() {
  // (api/status says which version runs; the map does without it if need be)
  const [res, about] = await Promise.all([fetch('api/area'), fetch('api/status').then((status) => (status.ok ? status.json() : null)).catch(() => null)]);
  // (and that is the version the page runs, see "a new version")
  if (about && runningVersion === null) runningVersion = versionOf(about);
  if (res.status === 503) return res.json();
  if (!res.ok) throw new Error(`api/area: HTTP ${res.status}`);
  const area = await res.json();
  if (state.areaKnown) return; // asked twice at the same time
  // Returning visitors get the section they last looked at.
  const saved = loadSetting('view', null);

  setTimeZone(area.timeZone);
  $('area-name').textContent = area.name;
  // What the server wrote into the page before it sent it (server/lib/page.js),
  // now in the visitor's language: the operator's own title and description
  // where they have them for that language, else the page's.
  const page = pageTexts(area.name, undefined, area.siteName);
  pageTitle = area.siteTitle[language] ?? page.title;
  siteName = area.siteName;
  // (at the address of a stop or a line, the page keeps the title and the description of what it names, unless they are in
  // another language than the one chosen here: then the page's own, and the title of what is open once it is there, see showAddress)
  if (!here() || sentInAnother()) {
    document.title = pageTitle;
    document.querySelector('meta[name="description"]').content = area.siteDescription[language] ?? page.description;
  }

  const [south, west, north, east] = area.bbox;
  // Lines are followed beyond the area, so the map reaches well beyond it too
  // (but not beyond the latitudes a web map has).
  const limit = [Math.max(south - 6, -85), west - 9, Math.min(north + 6, 85), east + 9];
  map.setMaxBounds([[limit[1], limit[0]], [limit[3], limit[2]]]);
  const usable = saved && [saved.lat, saved.lon, saved.zoom].every(Number.isFinite)
    && saved.lat >= limit[0] && saved.lon >= limit[1] && saved.lat <= limit[2] && saved.lon <= limit[3];
  // (at once: gliding there from the placeholder would show nothing, and the vehicles are asked for right after)
  state.viewAsked = OPENED_AS_DISPLAY && Boolean(usable);
  if (usable) map.jumpTo({ center: [saved.lon, saved.lat], zoom: saved.zoom });
  else map.fitBounds([[area.view[1], area.view[0]], [area.view[3], area.view[2]]], { animate: false });

  // Which map, and whom to name for the data, are settings of the server. A
  // style names its sources itself; what the server adds for the map and for
  // the data is HTML and may contain links.
  map.setStyle(area.styleUrl ?? rasterStyle(area.tileUrl), { transformStyle: (previous, next) => withoutStyleStops(localizedStyle(next)) });
  // The version goes into one credit with the data: MapLibre puts the credits
  // in the order of their length, and this way the version is always the last
  // thing in the corner, with a marker or without.
  const data = [`${t('attribution.data')} ${area.attribution.data}`, versionCredit(about)].filter(Boolean).join(' | ');
  const credits = [area.attribution.map, data].filter(Boolean);
  // (where a board takes all of the screen, it names the data itself: the map is not there)
  boardCredits = `${t('attribution.data')} ${area.attribution.data}`;
  // (the credits first: of the controls in a bottom corner, the one added last is on top)
  map.addControl(new AttributionControl({ customAttribution: credits }), 'bottom-right');
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  // (a browser tells where it is to pages with HTTPS only)
  if (window.isSecureContext && navigator.geolocation) map.addControl(locateControl, 'bottom-right');
  // (not every browser lets a page have the whole screen: an iPhone does not)
  if (document.fullscreenEnabled) map.addControl(fullscreenControl, 'bottom-right');
  // (details may be open already, from the address)
  clearMapButtons();
  state.outline = area.outline;
  state.bbox = area.bbox;
  askDraw();
  // What "how it works" ends with: the software by its name, as in the credits, with the way to its source.
  if (typeof about?.homepage === 'string') {
    const [before, after] = t('about.source').split('{software}');
    $('about-source').replaceChildren(before, el('a', { href: readmeOf(about.homepage), target: '_blank', rel: 'noopener', text: APP_NAME }), after);
    $('about-source').hidden = false;
  }
  state.areaKnown = true;
}

// Stations are only drawn zoomed in, so they are only loaded then.
async function loadStations() {
  const bounds = map.getBounds();
  if (map.getZoom() < STATION_ZOOM || (state.stationsLoaded && boxCovers(state.stationsLoaded, bounds))) return;
  const box = boxAround(bounds, STATION_MARGIN);
  const seq = ++stationSeq;
  try {
    const res = await fetch(`api/stations?bbox=${boxQuery(box)}`);
    if (!res.ok || seq !== stationSeq) return;
    state.stations = await res.json();
    state.stationsLoaded = box;
    draw();
  } catch (err) {
    // tried again when the map moves or with the next poll
    console.warn('stations not loaded:', err);
  }
}

async function poll() {
  clearTimeout(pollTimer);
  const seq = ++pollSeq;
  let delay = POLL_MS;
  try {
    // (without an area the server cannot say what it covers before it has a timetable)
    const waiting = state.areaKnown ? null : await loadArea();
    const request = { box: boxAround(map.getBounds(), VEHICLE_MARGIN), detail: detailWanted(), zoom: zoomAsked() };
    const res = waiting ? { status: 503 } : await fetch(`api/vehicles?bbox=${boxQuery(request.box)}&detail=${request.detail}&zoom=${request.zoom}${modesQuery()}${pickedQuery()}`);
    const data = waiting ?? await res.json();
    // The map was moved meanwhile and a newer request is under way.
    if (seq !== pollSeq) return;
    if (res.status === 503) {
      // The server has no timetable yet. Its own message is English and meant
      // for operators; visitors get a text chosen by the state and step.
      state.online = false;
      showBanner(loadingText(data));
      $('status').dataset.state = data.state === 'error' ? 'error' : 'schedule';
      $('status-text').textContent = data.state === 'error' ? t('status.noTimetable') : t('status.loading');
      delay = RETRY_LOADING_MS;
    } else if (res.ok) {
      showBanner(null);
      const offset = data.now - Date.now() / 1000;
      // The server clock arrives with up to ~1 s of jitter; follow it slowly so vehicles do not twitch.
      state.clockOffset = state.vehicles.size ? state.clockOffset * 0.8 + offset * 0.2 : offset;
      state.realtimeAt = data.realtime;
      // (the first answer, or the first one again after the server or the connection was away)
      if (!state.online) startAsking();
      // (once there is a timetable to look in)
      if (!state.addressOpened) {
        state.addressOpened = true;
        openAddress(true).then((done) => {
          if (!done) state.addressOpened = false;
        }).catch((err) => {
          console.warn('address not opened:', err);
          state.addressOpened = false;
        });
      }
      if (realtimeState() === 'live') state.wasLive = true;
      state.counts = data.counts;
      state.kinds = data.kinds ?? null;
      state.loaded = request;
      // (zoomed out, an instance with very many vehicles shows a share of them: "How it works" says so from then on)
      state.thinned = Object.keys(data.thinned).length > 0;
      if (state.thinned) $('about-thinned').hidden = false;
      const list = Array.isArray(data.vehicles) ? data.vehicles : fromColumns(data);
      state.many = list.length > MANY[state.many ? 1 : 0];
      applyVehicles(list);
      state.online = true;
      updateStatus();
      loadStations();
      // The first answer usually predates the server's first realtime fetch.
      state.scheduleOnly = data.realtime === null ? state.scheduleOnly + 1 : 0;
      if (data.realtime === null && state.scheduleOnly <= QUICK_RETRIES) delay = RETRY_NO_REALTIME_MS;
      // (asked for before it was known how many there are: again at once, in the form that fits their number)
      if (request.detail !== detailWanted() && request.zoom === zoomAsked()) delay = 0;
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    if (seq !== pollSeq) return;
    // Not only a failed request ends up here but any error in the code above.
    console.warn('poll failed:', err);
    state.online = false;
    $('status').dataset.state = 'error';
    $('status-text').textContent = t('status.noConnection');
    // The installed app also starts without a connection – but has nothing to show then.
    if (!navigator.onLine) showBanner(t('banner.offline'));
  }
  if (!document.hidden) pollTimer = setTimeout(poll, delay);
}

// After moving the map: reload at once if the new section is not covered by
// what was loaded, needs the other level of detail, or was thinned out for
// another zoom.
let moveTimer = null;
map.on('moveend', () => {
  if (!state.areaKnown) return; // still the placeholder view
  const center = map.getCenter();
  saveSetting('view', { lat: center.lat, lon: center.lng, zoom: map.getZoom() });
  clearTimeout(moveTimer);
  if (!state.loaded) return; // the first poll has not happened yet
  if (state.loaded.detail !== detailWanted() || (state.thinned && state.loaded.zoom !== zoomAsked()) || !boxCovers(state.loaded.box, map.getBounds())) moveTimer = setTimeout(poll, MOVE_SETTLE_MS);
  else loadStations();
});

// A hidden tab stops polling, which in turn lets the server pause its realtime downloads.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  startAsking();
  poll();
  loadSelection();
});
window.addEventListener('online', poll);

// ---------- display mode ----------

// A display comes from its address alone (display.js). The page makes one at
// "As a wall screen", at the foot of the settings: it opens again as a screen
// on a wall, with what is set here in its address. While a display that is
// not fixed shows, the button with the eye in the title row brings the
// controls back, as the button at the foot does on a fixed one (startFixed).
const displayButton = $('display-toggle');
displayButton.addEventListener('click', leaveDisplay);
$('wall-start').addEventListener('click', () => {
  // (with the path: the stop or the line that is open stays in it; a query alone would be taken from the base of the page, where the instance is)
  location.href = `${location.pathname}${displaySearch(true)}`;
});

/** The query of an address for what is shown, as a display. */
function displaySearch(fixed) {
  const center = map.getCenter();
  const settings = {
    view: { lat: center.lat, lon: center.lng, zoom: map.getZoom() },
    theme: state.theme,
    colorBy: state.colorBy,
    flags: state.flags,
    hiddenModes: MODES.filter((mode) => !state.enabled.has(mode)),
    times: state.times,
    clock: state.clock,
  };
  return displayQuery({ fixed, language, board: state.board, stops: state.extra, lines: state.lines, settings }, MODES);
}

/** Puts what is shown into the address, in place of the address so far: the page is not loaded again. */
function writeAddress() {
  if (!state.areaKnown) return;
  // (with the path, as above)
  history.replaceState(null, '', `${location.pathname}${displaySearch(FIXED)}`);
}

/** Marks the page as a display, for the style sheet. */
function showDisplay() {
  if (state.display) document.documentElement.dataset.display = FIXED ? 'fixed' : '';
}

/**
 * Brings the controls back. What is set came with the address and not from
 * this browser: the page with its controls starts afresh, with what is stored
 * here, and with the board that is open.
 */
function leaveDisplay() {
  location.search = boardQuery(ASKED.language ? `?lang=${encodeURIComponent(ASKED.language)}` : '', state.board, state.extra, state.lines);
}

/**
 * What a display on a wall does besides showing the map: nobody operates it,
 * so it looks after itself. And it shows the way out to whoever touches it
 * after all: the button in the corner is gone there.
 */
function startFixed() {
  const leave = $('display-leave');
  let leaveTimer = null;
  const showLeave = () => {
    leave.hidden = false;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => { leave.hidden = true; }, DISPLAY_LEAVE_MS);
  };
  document.addEventListener('pointerdown', showLeave);
  document.addEventListener('keydown', showLeave);
  leave.addEventListener('click', leaveDisplay);

  // The screen stays on where the browser lets a page ask for that; the
  // browser takes it back whenever the page is hidden.
  const keepAwake = () => navigator.wakeLock?.request('screen').catch(() => {});
  keepAwake();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) keepAwake();
  });
  // (nobody reloads it: it does so itself once the server runs another version, see "a new version")
}

// ---------- a new version ----------

// A page that is open while the server is updated runs the old version until
// it is loaded again: a tab left open, a phone that brings its tab back
// without loading it, the installed app, a screen on a wall. And what it
// loads later, such as the thread of the search, is of the new version and
// may not fit the old. So the page asks which version the server runs, as it
// comes into view and every few minutes while it is in view. Once that has
// changed it loads itself again at a moment nobody is using it: as it comes
// into view, after a while without a touch, a click or a key, and on a screen
// on a wall at once. What is open stays, as it is in the address, and so do
// the settings and the map, which the browser keeps; an open trip and what
// was typed into the search go.

let runningVersion = null; // the version the server ran when the page was loaded (versionOf)
let newVersion = false; // the server runs another one by now
let lastInput = Date.now(); // when the page was last touched, clicked or typed into
for (const type of ['pointerdown', 'keydown', 'wheel']) addEventListener(type, () => { lastInput = Date.now(); }, { capture: true, passive: true });

/** What tells one version of the server from another, of an answer of api/status. */
const versionOf = (about) => `${about.version} ${about.commit ?? ''}`;

/** Asks which version the server runs. True if it is another than the page's. */
async function checkVersion() {
  try {
    const res = await fetch('api/status');
    if (!res.ok) return newVersion;
    const version = versionOf(await res.json());
    if (runningVersion === null) runningVersion = version;
    else if (version !== runningVersion) newVersion = true;
  } catch {
    // no connection: the next check will tell
  }
  return newVersion;
}

/** Loads the page again where the server runs another version and nobody is using the page. */
function reloadIfIdle() {
  if (newVersion && !document.hidden && (FIXED || Date.now() - lastInput >= IDLE_RELOAD_MS)) location.reload();
}

setInterval(async () => {
  if (document.hidden) return;
  await checkVersion();
  reloadIfIdle();
}, VERSION_CHECK_MS);
// (when it comes into view, nobody has begun to use it yet)
document.addEventListener('visibilitychange', async () => {
  if (!document.hidden && (await checkVersion())) location.reload();
});
// (a page in use is loaded again as soon as it is left alone for a while: this costs no request)
setInterval(reloadIfIdle, 15_000);

// ---------- full screen ----------

// The whole screen for the page: a button in the corner of the map, with the
// zoom buttons. Its icon is one of the page's own, MapLibre's style sheet has none.
const fullscreenButton = el('button', { type: 'button', onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}) });
/** For map.addControl: the button as a group of its own, like the zoom buttons. */
const fullscreenControl = {
  onAdd: () => el('div', { class: 'maplibregl-ctrl maplibregl-ctrl-group own-icon' }, [fullscreenButton]),
  onRemove: () => fullscreenButton.parentNode.remove(),
};
/** Brings the button in line with whether the page has the whole screen. */
function showFullscreen() {
  const on = Boolean(document.fullscreenElement);
  const label = on ? t('map.fullscreenExit') : t('map.fullscreen');
  fullscreenButton.title = label;
  fullscreenButton.setAttribute('aria-label', label);
  fullscreenButton.replaceChildren(icon(on ? mdiFullscreenExit : mdiFullscreen));
}
// (the browser tells: Escape leaves it too, and no click of the button's is behind that)
document.addEventListener('fullscreenchange', showFullscreen);
showFullscreen();

function init() {
  // The lists have a column for the time, as wide as the language writes it (14:05 or 12:05 PM).
  const hours = Array.from({ length: 24 }, (_, hour) => formatTime(hour * 3600));
  document.documentElement.style.setProperty('--time-chars', Math.max(...hours.map((text) => text.length)));
  // (and one for the planned time beside a delay, which leaves out "PM" and the like, see clockOf in panel.js)
  document.documentElement.style.setProperty('--clock-chars', Math.max(...hours.map((text) => clockOf(text).length)));
  // (and one for the minutes until a departure leaves, up to an hour, and the time of day in their place beyond it)
  const minutes = [t('departures.now'), t('departures.minutes', { count: MINUTES_MAX }), ...hours];
  document.documentElement.style.setProperty('--minutes-chars', Math.max(...minutes.map((text) => text.length)));
  buildControls();
  // (the header card is what this visitor gets now; where the page came that way, first.js has shown it already)
  document.documentElement.dataset.controls = 'shown';
  // (and what was typed into it before this script had arrived is looked for)
  if (searchField.value) runSearch();
  resizeCanvas();
  nextFrame();
  setInterval(updateStatus, 1000);
  setInterval(tickTimes, 1000);
  showDisplay();
  if (FIXED) startFixed();
  poll();
  // Makes the page installable as an app and lets it start offline (see sw.js).
  navigator.serviceWorker?.register('sw.js').catch((err) => console.warn('service worker not registered:', err));
}

init();
