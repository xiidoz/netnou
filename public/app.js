// The server has no vehicle positions – the GTFS-Realtime feed only carries
// delays. For every vehicle it sends "knots": (time, lat, lon) along its route
// for the next minute or two, already shifted by the current delay. This
// script animates each vehicle along its knots and draws everything onto one
// canvas.
//
// No text for visitors is written out here: it comes from locales/ through t()
// (see i18n.js). Of what the server sends only data is shown – the names of
// lines, stops and operators, and the notes of the feed.

import { formatNumber, formatTime, languagePicker, loadLanguage, setTimeZone, t, translatePage } from './i18n.js';
import { buildIndex, search, searchLines } from './search.js';
import { mdiChevronLeft, mdiChevronRight, mdiClose, mdiMagnify } from './vendor/material-design-icons/icons.js';
import { AttributionControl, MapLibreMap, NavigationControl } from './vendor/maplibre-gl/maplibre-gl.mjs';

const APP_NAME = 'Netnou';

// The modes with a chip. Same ids as MODES in server/lib/timetable.js, the
// --mode-* colors in style.css and the mode.* texts in locales/ – all of which
// also have 'other'.
const MODES = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance'];
// Later entries are drawn on top: trains over trams over buses.
const DRAW_ORDER = ['other', 'bus', 'tram', 'subway', 'suburban', 'regional', 'longdistance'];
const RAIL_MODES = ['subway', 'suburban', 'regional', 'longdistance'];

const POLL_MS = 10_000;
const RETRY_LOADING_MS = 5000; // while the server has no timetable yet
const RETRY_NO_REALTIME_MS = 3000;
const QUICK_RETRIES = 5; // so often in a row; the realtime feed may also be down for hours
const PANEL_REFRESH_MS = 15_000;
const MOVE_SETTLE_MS = 150; // wait this long after the map was moved before reloading
const FRAME_MS = 80;
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
// Delay classes in seconds; the legend is made from them.
const DELAY_MINOR_S = 120;
const DELAY_MAJOR_S = 300;
const DELAY_SEVERE_S = 600;
const BADGE_DELAY_S = 180; // from here a marker carries its delay as a badge
// Realtime data older than this counts as timetable only. When its fetches
// fail, the server keeps the last delays up to the same age (STALE_AFTER_S in
// server/lib/realtime.js).
const LIVE_MAX_AGE_S = 180;
// The visitor's own position: the first one brings the map in to LOCATE_ZOOM,
// and one that takes longer than LOCATE_TIMEOUT_MS to find counts as not found.
const LOCATE_ZOOM = 15;
const LOCATE_TIMEOUT_MS = 15_000;
const NOTE_MS = 6000; // a note on what the visitor just did goes away after this
// The search: how many lines and stops it lists, the zoom a chosen stop brings
// the map in to, and how far in the map goes at most to show a line.
const LINE_LIMIT = 3;
const SEARCH_LIMIT = 8;
const SEARCH_ZOOM = 16;
const LINE_ZOOM = 15;
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

// The icons on the page's own buttons, by the name data-icon asks for them in
// index.html. They are from Material Design Icons (vendor/material-design-icons),
// each the shape of one icon in a box of 24 by 24; style.css gives it its size
// and its colour. Shapes and not characters: where a character sits in its box
// is up to the font, and the font is the device's.
const ICONS = { close: mdiClose, left: mdiChevronLeft, right: mdiChevronRight, search: mdiMagnify };

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  // (what it is on says what it is for)
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}
for (const node of document.querySelectorAll('[data-icon]')) node.append(icon(node.dataset.icon));

// What is stored may be anything – written by another version of the page or
// by hand – so whoever reads a setting checks its shape.
function loadSetting(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(`netnou.${key}`)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(`netnou.${key}`, JSON.stringify(value));
  } catch {
    // private mode or blocked storage: the setting just does not persist
  }
}

// The texts come first: the map takes those of its controls when it is created.
const language = await loadLanguage();
translatePage();

// ---------- state ----------

const state = {
  clockOffset: 0, // server time minus browser time, seconds
  vehicles: new Map(),
  drawList: [],
  counts: {}, // vehicles per mode in the whole area, from the server
  loaded: null, // map section and detail the vehicles were last requested for
  stations: [],
  stationsLoaded: null, // map section the stations were requested for
  realtimeAt: null,
  scheduleOnly: 0, // answers without realtime data in a row
  online: false, // last poll delivered vehicles
  areaKnown: false, // api/area has answered: the map shows the area
  outline: [], // the edge of the area: rings of [lat, lon]
  enabled: new Set([...MODES, 'other']),
  colorBy: loadSetting('colorBy', 'mode') === 'delay' ? 'delay' : 'mode',
  selection: null, // { type: 'trip' | 'station' | 'line', id, data }, see select()
  hits: [],
  position: null, // the visitor's own while they have it shown: { lat, lon, accuracy in metres, stale }
  follow: false, // the map stays centred on it
  banner: null, // what the banner says for as long as it is so
  note: null, // what it says in its place for a moment, on something the visitor did
};
// Stored are the modes switched off, so that a mode added later starts switched on.
const hiddenModes = loadSetting('hiddenModes', []);
if (Array.isArray(hiddenModes)) for (const mode of MODES) if (hiddenModes.includes(mode)) state.enabled.delete(mode);

const now = () => Date.now() / 1000 + state.clockOffset;

function delayClass(delay) {
  if (delay === null || delay === undefined) return 'none';
  if (delay < DELAY_MINOR_S) return 'ok';
  if (delay < DELAY_MAJOR_S) return 'minor';
  if (delay < DELAY_SEVERE_S) return 'major';
  return 'severe';
}

function delayText(delay) {
  if (delay === null || delay === undefined) return '';
  const minutes = Math.round(delay / 60);
  if (minutes === 0) return '±0';
  return minutes > 0 ? `+${minutes}` : `−${-minutes}`;
}

// Colors live in style.css so that canvas and DOM share one palette.
let colors = {};
function readColors() {
  const style = getComputedStyle(document.documentElement);
  const get = (name) => style.getPropertyValue(name).trim();
  colors = { mode: {}, delay: {}, text: get('--text'), bg: get('--bg'), accent: get('--accent'), muted: get('--text-muted'), veil: get('--veil'), veilLine: get('--veil-line'), location: get('--location') };
  for (const mode of DRAW_ORDER) colors.mode[mode] = get(`--mode-${mode}`);
  for (const cls of ['ok', 'minor', 'major', 'severe', 'none']) colors.delay[cls] = get(`--delay-${cls}`);
}
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  readColors();
  draw();
});

// ---------- map ----------

/**
 * A style for MapLibre out of a URL template for raster tiles. Of the
 * placeholders besides {z}, {x} and {y} it knows {s}, the subdomains a to c,
 * and {r}, "@2x" on a dense screen.
 */
function rasterStyle(template) {
  const url = template.replace('{r}', window.devicePixelRatio > 1 ? '@2x' : '');
  const tiles = url.includes('{s}') ? ['a', 'b', 'c'].map((subdomain) => url.replace('{s}', subdomain)) : [url];
  return { version: 8, sources: { tiles: { type: 'raster', tiles, tileSize: 256, maxzoom: 19 } }, layers: [{ id: 'tiles', type: 'raster', source: 'tiles' }] };
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
    // (see loadArea); until then the map is empty.
    style: { version: 8, sources: {}, layers: [] },
    center: [0, 0],
    zoom: MIN_ZOOM,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
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
const detailWanted = () => (map.getZoom() >= LABEL_ZOOM ? 'full' : 'lite');
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

function shortLabel(line) {
  const first = line.trim().split(/\s+/)[0] || '?';
  return first.length > 4 ? first.slice(0, 4) : first;
}

function applyVehicles(list) {
  const seen = new Set();
  for (const v of list) {
    seen.add(v.id);
    const known = state.vehicles.get(v.id);
    if (known) Object.assign(known, v);
    else state.vehicles.set(v.id, { ...v, label: shortLabel(v.line), lat: null, lon: null });
  }
  for (const id of state.vehicles.keys()) if (!seen.has(id)) state.vehicles.delete(id);
  state.drawList = [...state.vehicles.values()].sort((a, b) => DRAW_ORDER.indexOf(a.mode) - DRAW_ORDER.indexOf(b.mode));
}

// ---------- drawing ----------

let lastDraw = 0;

function vehicleColor(v) {
  return state.colorBy === 'delay' ? colors.delay[delayClass(v.delay)] : colors.mode[v.mode] ?? colors.mode.other;
}

function stationShown(station, zoom) {
  if (zoom >= ALL_STATIONS_ZOOM) return station.modes.some((mode) => state.enabled.has(mode));
  if (zoom >= STATION_ZOOM) return station.modes.some((mode) => RAIL_MODES.includes(mode) && state.enabled.has(mode));
  return false;
}

function draw() {
  const time = now();
  const dt = Math.min(performance.now() - lastDraw, 1000);
  lastDraw = performance.now();

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewSize.x, viewSize.y);

  const zoom = map.getZoom();
  const project = (lat, lon) => {
    const point = map.project([lon, lat]);
    return [point.x, point.y];
  };
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

  // stations
  const stationRadius = zoom >= 15 ? 4 : 3;
  ctx.fillStyle = colors.bg;
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 1.5;
  for (const station of state.stations) {
    if (!stationShown(station, zoom)) continue;
    const [x, y] = project(station.lat, station.lon);
    if (!onScreen(x, y)) continue;
    ctx.beginPath();
    ctx.arc(x, y, stationRadius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    hits.push({ x, y, r: stationRadius + 5, station });
  }
  // the station whose departures are open, at any zoom
  if (selection?.type === 'station' && selection.data?.lat !== undefined) {
    const [x, y] = project(selection.data.lat, selection.data.lon);
    ctx.beginPath();
    ctx.arc(x, y, stationRadius + 3, 0, 2 * Math.PI);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
  }

  // route of the selected trip
  if (selection?.type === 'trip' && selection.data) {
    const color = colors.mode[selection.data.mode] ?? colors.mode.other;
    const path = selection.data.path;
    const points = selection.data.stops.map((stop) => project(stop.lat, stop.lon));
    ctx.beginPath();
    for (let i = 0; i < path.length; i += 2) {
      const [x, y] = project(path[i], path[i + 1]);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (zoom >= 11) {
      ctx.lineWidth = 2;
      for (const [x, y] of points) {
        if (!onScreen(x, y)) continue;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // While a line is looked at, its vehicles are the only ones, whatever the filters say.
  const only = selection?.type === 'line' ? selection.ids : null;
  // How large the vehicles are. Those of a line that is looked at are few and
  // what the map is about: they carry their name at any zoom.
  const labeled = zoom >= LABEL_ZOOM || Boolean(only);
  const r = labeled ? (zoom >= 14 ? 11 : 10) : 4.5;

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
  let selectedVehicle = null;

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

    const color = vehicleColor(v);
    const fillAlpha = v.delay === null && state.colorBy === 'mode' ? 0.55 : 1;
    // outline and label are white in both themes
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = color;
    ctx.lineWidth = labeled ? 1.5 : 1;

    if (labeled && target.k > 0) {
      // arrowhead pointing towards the next stop
      const [ax, ay] = project(v.knots[target.k - 2], v.knots[target.k - 1]);
      const [bx, by] = project(v.knots[target.k + 1], v.knots[target.k + 2]);
      const a = Math.atan2(by - ay, bx - ax);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * (r + 6), y + Math.sin(a) * (r + 6));
      ctx.lineTo(x + Math.cos(a + 0.6) * r, y + Math.sin(a + 0.6) * r);
      ctx.lineTo(x + Math.cos(a - 0.6) * r, y + Math.sin(a - 0.6) * r);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    if (fillAlpha < 1) {
      // schedule-only vehicles: paler, on an opaque base so the map does not shine through
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.fillStyle = color;
      ctx.globalAlpha = fillAlpha;
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();

    if (labeled) {
      // (except on the yellow of a minor delay, which does not carry white text)
      ctx.fillStyle = state.colorBy === 'delay' && delayClass(v.delay) === 'minor' ? '#1b1f24' : '#fff';
      ctx.font = `700 ${v.label.length > 3 ? 8 : v.label.length > 2 ? 9.5 : 11}px system-ui, sans-serif`;
      ctx.fillText(v.label, x, y + 0.5);

      if (state.colorBy === 'mode' && v.delay >= BADGE_DELAY_S) {
        const text = delayText(v.delay);
        ctx.font = '700 9px system-ui, sans-serif';
        const w = ctx.measureText(text).width + 6;
        const bx = x + r * 0.55;
        const by = y - r - 5;
        // one class "hotter" than the dots, for the same reason (see .delay in style.css)
        ctx.fillStyle = colors.delay[delayClass(v.delay) === 'minor' ? 'major' : 'severe'];
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(bx, by, w, 12, 4);
        else ctx.rect(bx, by, w, 12);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, bx + w / 2, by + 6.5);
      }
    }

    hits.push({ x, y, r: Math.max(r + 3, 10), vehicle: v });
    if (selection?.type === 'trip' && selection.id === v.id) selectedVehicle = { x, y };
  }

  if (selectedVehicle) {
    ctx.beginPath();
    ctx.arc(selectedVehicle.x, selectedVehicle.y, r + 5, 0, 2 * Math.PI);
    ctx.strokeStyle = colors.text;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  state.hits = hits;
}

function frame() {
  if (performance.now() - lastDraw >= FRAME_MS) draw();
  requestAnimationFrame(frame);
}

// ---------- interaction ----------

function hitTest(point) {
  let best = null;
  let bestScore = Infinity;
  for (const hit of state.hits) {
    const d = Math.hypot(hit.x - point.x, hit.y - point.y);
    if (d > hit.r) continue;
    // vehicles win over the station they are standing at
    const score = d + (hit.station ? 1000 : 0);
    if (score < bestScore) {
      best = hit;
      bestScore = score;
    }
  }
  return best;
}

const tooltip = $('tooltip');

function vehicleSummary(v) {
  const parts = [`${v.line} → ${v.to}`];
  if (v.delay === null) parts.push(t('delay.none'));
  else parts.push(Math.round(v.delay / 60) === 0 ? t('delay.onTime') : t('delay.minutes', { delay: delayText(v.delay) }));
  return parts.join(' · ');
}

map.on('mousemove', (event) => {
  const hit = hitTest(event.point);
  map.getContainer().classList.toggle('clickable', !!hit);
  tooltip.hidden = !hit;
  if (!hit) return;
  tooltip.textContent = hit.vehicle ? vehicleSummary(hit.vehicle) : hit.station.name;
  tooltip.style.transform = `translate(${event.point.x + 14}px, ${event.point.y + 14}px)`;
});
map.on('mouseout', () => { tooltip.hidden = true; });

map.on('click', (event) => {
  const hit = hitTest(event.point);
  if (hit?.vehicle) select('trip', hit.vehicle.id);
  else if (hit?.station) select('station', hit.station.id);
  else closePanel();
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

/** Whether a place is inside the outline of the area – by the even-odd rule, as the veil is drawn. */
function inArea(lat, lon) {
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

// Stops and lines are searched for in the browser (search.js): what is typed
// is sent nowhere, and neither is the visitor's position, which puts what is
// around them first. The list of both is fetched when the field is first used.

const searchBox = $('search');
const searchField = $('search-field');
const searchResults = $('search-results');
const narrowScreen = matchMedia('(max-width: 720px)'); // as in style.css
let searchable = null; // what search.js looks through, once it is there
let searchableLoading = null; // the request for it while it is under way
let found = []; // what choosing each of the results listed does
let active = -1; // the one the arrow keys have reached, as an index into them

function loadSearchable() {
  searchableLoading ??= fetch('api/search')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    // (with the names of the modes as the visitor reads them: "bus 33" is a line of the buses)
    .then((data) => { searchable = buildIndex(data, Object.fromEntries(DRAW_ORDER.map((mode) => [mode, t(`mode.${mode}`)]))); })
    .catch((err) => {
      // (also while the server has no timetable yet; asked for again with the next letter)
      console.warn('stops and lines not loaded:', err);
      searchableLoading = null;
    });
  return searchableLoading;
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

/** Shows the lines and the stops found below the field, or a note in their place. */
function listResults(lines, stops, note = '') {
  const option = (choose, props, children) => {
    found.push(choose);
    return el('li', { id: `search-result-${found.length - 1}`, role: 'option', 'aria-selected': 'false', onclick: choose, ...props }, children);
  };
  found = [];
  // A line begins with its name on the colour of its mode, as in the departures.
  const lineRows = lines.map((line) => option(() => chooseLine(line), { class: 'line' }, [
    badge(line.name, line.mode),
    el('span', { class: 'name' }, [el('span', { class: 'to', text: line.to.join(' – ') }), el('span', { class: 'agency', text: line.agency })]),
  ]));
  const stopRows = stops.map((stop) => {
    // The dots say what stops there, as the chips do.
    const dots = stop.modes.map((mode) => {
      const dot = el('span', { class: 'swatch' });
      dot.style.setProperty('--chip-color', `var(--mode-${mode})`);
      return dot;
    });
    return option(() => chooseStop(stop), { title: stop.modes.map((mode) => t(`mode.${mode}`)).join(', ') }, [
      el('span', { class: 'dots' }, dots),
      el('span', { class: 'name', text: stop.name }),
    ]);
  });
  // (each kind under its heading where there are both)
  const heading = (text) => (lines.length && stops.length ? [el('li', { class: 'search-heading', role: 'presentation', text })] : []);
  searchResults.replaceChildren(...heading(t('search.lines')), ...lineRows, ...heading(t('search.stops')), ...stopRows);
  $('search-note').textContent = note;
  setActive(-1);
  searchBox.classList.toggle('open', found.length > 0 || note !== '');
  searchField.setAttribute('aria-expanded', String(found.length > 0));
}

async function runSearch() {
  const query = searchField.value;
  if (!query.trim()) return listResults([], []);
  if (!searchable) {
    listResults([], [], t('search.loading'));
    await loadSearchable();
    // typed on meanwhile: that letter has its own turn
    if (searchField.value !== query) return undefined;
    if (!searchable) return listResults([], [], t('search.failed'));
  }
  const lines = searchLines(searchable, query, { near: state.position, limit: LINE_LIMIT });
  const stops = search(searchable, query, { near: state.position, limit: SEARCH_LIMIT });
  return listResults(lines, stops, lines.length || stops.length ? '' : t('search.none'));
}

/** Shuts the list, and on a narrow screen the field with it. */
function closeSearch() {
  listResults([], []);
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

function chooseStop(stop) {
  leaveSearch(stop.name);
  // On a narrow screen the departures cover the lower half: the stop goes above the middle.
  map.flyTo({ center: [stop.lon, stop.lat], zoom: Math.max(map.getZoom(), SEARCH_ZOOM), offset: [0, narrowScreen.matches ? -0.12 * viewSize.y : 0] });
  select('station', stop.id);
}

searchField.addEventListener('input', runSearch);
searchField.addEventListener('focus', () => {
  loadSearchable();
  // what is in the field from last time is typed over, and found again until then
  searchField.select();
  runSearch();
});
searchField.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!found.length) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    setActive(active < 0 && step < 0 ? found.length - 1 : (active + step + found.length) % found.length);
  } else if (event.key === 'Enter') {
    // without the arrow keys it is the first one, the most likely
    found[Math.max(active, 0)]?.();
  } else if (event.key === 'Escape') {
    // (and not the details as well, which the same key closes otherwise)
    event.stopPropagation();
    closeSearch();
    searchField.blur();
  }
});
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
$('search-close').addEventListener('click', closeSearch);

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

  const container = $('modes');
  for (const mode of MODES) {
    const count = el('span', { class: 'count', text: formatNumber(0) });
    chipCounts.set(mode, count);
    const chip = el('button', { type: 'button', class: 'chip', 'aria-pressed': String(state.enabled.has(mode)) }, [
      el('span', { class: 'swatch' }),
      el('span', { class: 'name', text: t(`mode.${mode}`) }),
      count,
    ]);
    chip.style.setProperty('--chip-color', `var(--mode-${mode})`);
    chip.addEventListener('click', () => {
      if (state.enabled.has(mode)) state.enabled.delete(mode);
      else state.enabled.add(mode);
      chip.setAttribute('aria-pressed', String(state.enabled.has(mode)));
      saveSetting('hiddenModes', MODES.filter((other) => !state.enabled.has(other)));
      updateStatus();
      draw();
    });
    container.append(chip);
  }
  watchChipRow(container, $('modes-back'), $('modes-on'));

  const from = (seconds) => t('delay.from', { minutes: seconds / 60 });
  const legend = [['ok', t('delay.onTime')], ['minor', from(DELAY_MINOR_S)], ['major', from(DELAY_MAJOR_S)], ['severe', from(DELAY_SEVERE_S)], ['none', t('delay.none')]];
  $('delay-legend').append(...legend.map(([delay, text]) => el('li', {}, [el('span', { class: 'swatch', data: { delay } }), text])));

  const buttons = document.querySelectorAll('[data-color-by]');
  const apply = () => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.colorBy === state.colorBy));
    $('delay-legend').hidden = state.colorBy !== 'delay';
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      state.colorBy = button.dataset.colorBy;
      saveSetting('colorBy', state.colorBy);
      apply();
      draw();
    });
  }
  apply();
}

function updateStatus() {
  if (!state.online) return;
  // The numbers refer to the whole area, not just the map section in view.
  const counts = state.counts;
  let shown = 0;
  for (const [mode, count] of Object.entries(counts)) if (state.enabled.has(mode)) shown += count;
  for (const [mode, node] of chipCounts) node.textContent = formatNumber(counts[mode] ?? 0);

  const age = state.realtimeAt === null ? null : Math.max(0, Math.round(now() - state.realtimeAt));
  const live = age !== null && age < LIVE_MAX_AGE_S;
  $('status').dataset.state = live ? 'live' : 'schedule';
  const realtime = live ? t('status.live', { seconds: age }) : t('status.scheduleOnly');
  $('status-text').textContent = `${t('status.vehicles', { count: shown })} · ${realtime}`;
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

// ---------- detail panel ----------

const panel = $('panel');
const panelBody = $('panel-body');
let panelTimer = null;

function closePanel() {
  state.selection = null;
  clearTimeout(panelTimer);
  panel.hidden = true;
  draw();
}
$('panel-close').addEventListener('click', closePanel);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.selection) closePanel();
});

/**
 * Opens the details of a trip, a station or a line.
 * @param more what else there is to know: of a line what it is ({ line }),
 *   of a trip the line it was chosen from ({ from }), to which the way leads back
 */
function select(type, id, more = {}) {
  // The row that was activated is about to go: keep the keyboard focus in the panel.
  if (panelBody.contains(document.activeElement)) panel.focus({ preventScroll: true });
  state.selection = { type, id, data: null, ...more };
  panel.hidden = false;
  panelBody.replaceChildren(el('p', { class: 'panel-empty', text: t('panel.loading') }));
  loadSelection(true);
}

function selectionUrl({ type, id, line }) {
  if (type === 'trip') return `api/trip?id=${encodeURIComponent(id)}`;
  // (a line is its name, its mode and its operator together)
  if (type === 'line') return `api/line?${new URLSearchParams({ name: line.name, mode: line.mode, agency: line.agency })}`;
  return `api/departures?station=${encodeURIComponent(id)}`;
}

async function loadSelection(first = false) {
  const selection = state.selection;
  if (!selection) return;
  clearTimeout(panelTimer);
  try {
    const res = await fetch(selectionUrl(selection));
    const data = res.ok ? await res.json() : null;
    if (state.selection !== selection) return; // user moved on meanwhile
    if (data) {
      selection.data = data;
      if (selection.type === 'trip') renderTrip(data, first);
      else if (selection.type === 'line') renderLine(data, first);
      else renderStation(data);
      draw();
    } else if (first) {
      panelBody.replaceChildren(el('p', { class: 'panel-empty', text: t('panel.noData') }));
    }
  } catch (err) {
    console.warn('details not loaded:', err);
    if (first && state.selection === selection) panelBody.replaceChildren(el('p', { class: 'panel-empty', text: t('panel.loadFailed') }));
  }
  if (state.selection === selection && !document.hidden) panelTimer = setTimeout(loadSelection, PANEL_REFRESH_MS);
}

/** Replaces what the panel shows. It is rebuilt with every refresh, so the row that has the keyboard focus gets it back. */
function fillPanel(...nodes) {
  const focused = [...panelBody.querySelectorAll('.row')].indexOf(document.activeElement);
  panelBody.replaceChildren(...nodes);
  if (focused >= 0) panelBody.querySelectorAll('.row')[focused]?.focus({ preventScroll: true });
}

const platformText = (platform) => (platform ? t('stop.platform', { platform }) : '');

function badge(line, mode) {
  const node = el('span', { class: 'badge', text: line });
  node.style.setProperty('--badge-color', `var(--mode-${mode})`);
  return node;
}

function delayNode(delay) {
  return el('span', { class: 'delay', text: delayText(delay), data: { delay: delayClass(delay) } });
}

function notesList(notes, alert) {
  const items = notes.map((note) => el('li', { text: note }));
  if (alert) items.unshift(el('li', { class: 'alert', text: alert }));
  return items.length ? el('ul', { class: 'notes' }, items) : '';
}

function renderTrip(trip, scrollToNext) {
  const scrollTop = panelBody.scrollTop;
  const lastIndex = trip.stops.length - 1;
  let nextFound = false;
  let nextRow = null;

  const rows = trip.stops.map((stop, i) => {
    const isLast = i === lastIndex;
    const planned = isLast ? stop.arr : stop.dep;
    const delay = isLast ? stop.arrDelay : stop.depDelay ?? stop.arrDelay;
    const past = planned + (delay ?? 0) < trip.now;
    const isNext = !past && !nextFound && !stop.skipped;
    if (isNext) nextFound = true;

    const classes = ['row', 'stop'];
    if (past) classes.push('past');
    if (isNext) classes.push('next');
    if (stop.skipped) classes.push('cancelled');
    const row = el('button', { type: 'button', class: classes.join(' '), onclick: () => select('station', stop.station) }, [
      el('span', { class: 'rail' }),
      el('span', { class: 'time', text: formatTime(planned) }),
      stop.skipped ? el('span') : delayNode(delay),
      el('span', { class: 'name', text: stop.name, title: stop.name }),
      el('span', { class: 'platform', text: stop.skipped ? t('stop.skipped') : platformText(stop.platform) }),
    ]);
    if (isNext) nextRow = row;
    return el('li', {}, [row]);
  });

  const list = el('ul', { class: 'rows' }, rows);
  list.style.setProperty('--badge-color', `var(--mode-${trip.mode})`);
  const mode = t(`mode.${DRAW_ORDER.includes(trip.mode) ? trip.mode : 'other'}`);
  // Who provides the realtime data shown leads the notes, which are feed content and stay as they are.
  const notes = trip.realtime && trip.source ? [t('trip.source', { source: trip.source }), ...trip.notes] : trip.notes;
  // A trip chosen from the vehicles of a line leads back to them.
  const from = state.selection.from;
  const back = from ? el('button', { type: 'button', class: 'back', 'aria-label': t('line.back', { line: from.name }), onclick: () => selectLine(from) }, [icon('left'), badge(from.name, from.mode)]) : '';
  fillPanel(
    el('div', { class: 'panel-head' }, [
      back,
      el('h2', {}, [badge(trip.line, trip.mode), el('span', { text: `→ ${trip.to}` })]),
      el('p', { class: 'sub', text: [mode, trip.agency, trip.realtime ? t('trip.realtime') : t('trip.scheduleOnly')].filter(Boolean).join(' · ') }),
      notesList(notes, trip.cancelled ? t('trip.cancelled') : null),
    ]),
    list,
  );
  if (scrollToNext) nextRow?.scrollIntoView({ block: 'center' });
  else panelBody.scrollTop = scrollTop;
}

/** Opens the view of a line: its vehicles under way in the panel and, alone, on the map. */
function selectLine(line) {
  select('line', JSON.stringify([line.name, line.mode, line.agency]), { line });
}

/** What of each edge of the map is to stay free, so that the cards do not cover what is shown in between. */
function clearOfCards() {
  const margin = 40;
  const card = $('controls').getBoundingClientRect();
  const details = panel.getBoundingClientRect();
  // on a narrow screen the cards are above and below, else to the left and the right
  const padding = narrowScreen.matches
    ? { top: card.bottom + margin, bottom: viewSize.y - details.top + margin, left: margin, right: margin }
    : { top: margin, bottom: margin, left: card.right + margin, right: viewSize.x - details.left + margin };
  // (in a window too small for that, better covered in part than not shown)
  const fits = padding.left + padding.right < 0.8 * viewSize.x && padding.top + padding.bottom < 0.8 * viewSize.y;
  return fits ? padding : { top: margin, bottom: margin, left: margin, right: margin };
}

function renderLine(line, first) {
  const scrollTop = panelBody.scrollTop;
  const selection = state.selection;
  selection.ids = new Set(line.vehicles.map((v) => v.id)); // the map shows these alone, see draw()

  // under where they go, in the order of the server: the one with the fewest stops left first
  const byDestination = new Map();
  for (const v of line.vehicles) byDestination.set(v.to, [...(byDestination.get(v.to) ?? []), v]);
  const lists = [...byDestination].flatMap(([destination, vehicles]) => [
    el('h3', { class: 'rows-head', text: t('line.to', { destination }) }),
    el('ul', { class: 'rows' }, vehicles.map((v) => el('li', {}, [
      el('button', { type: 'button', class: 'row vehicle', onclick: () => select('trip', v.id, { from: selection.line }) }, [
        el('span', { class: 'name', text: t('line.next', { stop: v.next }), title: v.next }),
        delayNode(v.delay),
      ]),
    ]))),
  ]);
  const mode = t(`mode.${DRAW_ORDER.includes(line.mode) ? line.mode : 'other'}`);
  fillPanel(
    el('div', { class: 'panel-head' }, [
      el('h2', {}, [badge(line.name, line.mode), el('span', { text: mode })]),
      el('p', { class: 'sub', text: [line.agency, line.vehicles.length ? t('line.vehicles', { count: line.vehicles.length }) : ''].filter(Boolean).join(' · ') }),
    ]),
    ...(lists.length ? lists : [el('p', { class: 'panel-empty', text: t('line.none') })]),
  );
  panelBody.scrollTop = scrollTop;

  // Once, when the line is chosen: all its vehicles into view, between the cards.
  if (first && line.vehicles.length) {
    const lats = line.vehicles.map((v) => v.lat);
    const lons = line.vehicles.map((v) => v.lon);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: clearOfCards(), maxZoom: LINE_ZOOM });
  }
}

function renderStation(board) {
  const scrollTop = panelBody.scrollTop;
  const rows = board.departures.map((dep) =>
    el('li', {}, [
      el('button', { type: 'button', class: `row departure${dep.cancelled ? ' cancelled' : ''}`, onclick: () => select('trip', dep.trip) }, [
        el('span', { class: 'time', text: formatTime(dep.planned) }),
        dep.cancelled ? el('span') : delayNode(dep.delay),
        badge(dep.line, dep.mode),
        el('span', { class: 'name', text: dep.to, title: dep.to }),
        el('span', { class: 'platform', text: dep.cancelled ? t('departures.cancelled') : platformText(dep.platform) }),
      ]),
    ]),
  );
  fillPanel(
    el('div', { class: 'panel-head' }, [el('h2', { text: board.name }), el('p', { class: 'sub', text: t('departures.title') }), notesList(board.notes)]),
    // (the two hours the text speaks of are the default window of departures() in server/lib/timetable.js)
    rows.length ? el('ul', { class: 'rows' }, rows) : el('p', { class: 'panel-empty', text: t('departures.none') }),
  );
  panelBody.scrollTop = scrollTop;
}

// ---------- data loading ----------

let pollTimer = null;
let pollSeq = 0;
let stationSeq = 0;

// What the server covers and how to show it: the area and its name, the map
// section to start with, the map behind it and the time zone. It does not
// change while the server runs, so it is asked for until it has answered once.
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * What is running, for the credits: the name with a link to where it comes
 * from and the version, "edge" together with its commit. If the server knows
 * of a newer release, a marker follows that leads to the release notes.
 * @param about the answer of api/status, or null if there was none
 */
function versionCredit(about) {
  if (typeof about?.version !== 'string' || typeof about.homepage !== 'string') return '';
  const version = about.version === 'edge' && about.commit ? `edge · ${about.commit.slice(0, 7)}` : about.version;
  const credit = `<a href="${escapeHtml(about.homepage)}" target="_blank" rel="noopener">${APP_NAME}</a> ${escapeHtml(version)}`;
  if (!about.update) return credit;
  const note = escapeHtml(t('update.available', { version: about.update.version }));
  return `${credit} <a class="update" href="${escapeHtml(about.update.url)}" title="${note}" target="_blank" rel="noopener">↑ ${escapeHtml(about.update.version)}</a>`;
}

async function loadArea() {
  // (api/status says which version runs; the map does without it if need be)
  const [res, about] = await Promise.all([fetch('api/area'), fetch('api/status').then((status) => (status.ok ? status.json() : null)).catch(() => null)]);
  if (!res.ok) throw new Error(`api/area: HTTP ${res.status}`);
  const area = await res.json();
  if (state.areaKnown) return; // asked twice at the same time
  // Returning visitors get the section they last looked at.
  const saved = loadSetting('view', null);

  setTimeZone(area.timeZone);
  $('area-name').textContent = area.name;
  document.title = area.name ? `${APP_NAME} – ${area.name}` : APP_NAME;

  const [south, west, north, east] = area.bbox;
  // Lines are followed beyond the area, so the map reaches well beyond it too
  // (but not beyond the latitudes a web map has).
  const limit = [Math.max(south - 6, -85), west - 9, Math.min(north + 6, 85), east + 9];
  map.setMaxBounds([[limit[1], limit[0]], [limit[3], limit[2]]]);
  const usable = saved && [saved.lat, saved.lon, saved.zoom].every(Number.isFinite)
    && saved.lat >= limit[0] && saved.lon >= limit[1] && saved.lat <= limit[2] && saved.lon <= limit[3];
  // (at once: gliding there from the placeholder would show nothing, and the vehicles are asked for right after)
  if (usable) map.jumpTo({ center: [saved.lon, saved.lat], zoom: saved.zoom });
  else map.fitBounds([[area.view[1], area.view[0]], [area.view[3], area.view[2]]], { animate: false });

  // Which map, and whom to name for the data, are settings of the server. A
  // style names its sources itself; what the server adds for the map and for
  // the data is HTML and may contain links.
  map.setStyle(area.styleUrl ?? rasterStyle(area.tileUrl), { transformStyle: (previous, next) => localizedStyle(next) });
  // The version goes into one credit with the data: MapLibre puts the credits
  // in the order of their length, and this way the version is always the last
  // thing in the corner, with a marker or without.
  const data = [`${t('attribution.data')} ${area.attribution.data}`, versionCredit(about)].filter(Boolean).join(' | ');
  const credits = [area.attribution.map, data].filter(Boolean);
  // (the credits first: of the controls in a bottom corner, the one added last is on top)
  map.addControl(new AttributionControl({ customAttribution: credits }), 'bottom-right');
  map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
  // (a browser tells where it is to pages with HTTPS only)
  if (window.isSecureContext && navigator.geolocation) map.addControl(locateControl, 'bottom-right');
  state.outline = area.outline;
  $('area-hint').hidden = false;
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
    if (!state.areaKnown) await loadArea();
    const request = { box: boxAround(map.getBounds(), VEHICLE_MARGIN), detail: detailWanted() };
    const res = await fetch(`api/vehicles?bbox=${boxQuery(request.box)}&detail=${request.detail}`);
    const data = await res.json();
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
      state.counts = data.counts;
      state.loaded = request;
      applyVehicles(data.vehicles);
      state.online = true;
      updateStatus();
      loadStations();
      // The first answer usually predates the server's first realtime fetch.
      state.scheduleOnly = data.realtime === null ? state.scheduleOnly + 1 : 0;
      if (data.realtime === null && state.scheduleOnly <= QUICK_RETRIES) delay = RETRY_NO_REALTIME_MS;
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
// what was loaded, or needs the other level of detail.
let moveTimer = null;
map.on('moveend', () => {
  if (!state.areaKnown) return; // still the placeholder view
  const center = map.getCenter();
  saveSetting('view', { lat: center.lat, lon: center.lng, zoom: map.getZoom() });
  clearTimeout(moveTimer);
  if (!state.loaded) return; // the first poll has not happened yet
  if (state.loaded.detail !== detailWanted() || !boxCovers(state.loaded.box, map.getBounds())) moveTimer = setTimeout(poll, MOVE_SETTLE_MS);
  else loadStations();
});

// A hidden tab stops polling, which in turn lets the server pause its realtime downloads.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  poll();
  loadSelection();
});
window.addEventListener('online', poll);

function init() {
  // The lists have a column for the time, as wide as the language writes it (14:05 or 12:05 PM).
  const hours = Array.from({ length: 24 }, (_, hour) => formatTime(hour * 3600));
  document.documentElement.style.setProperty('--time-chars', Math.max(...hours.map((text) => text.length)));
  buildControls();
  $('controls').hidden = false;
  resizeCanvas();
  requestAnimationFrame(frame);
  setInterval(updateStatus, 1000);
  poll();
  // Makes the page installable as an app and lets it start offline (see sw.js).
  navigator.serviceWorker?.register('sw.js').catch((err) => console.warn('service worker not registered:', err));
}

init();
