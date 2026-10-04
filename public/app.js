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
// From LABEL_ZOOM vehicles carry their line and follow their route.
const LABEL_ZOOM = 13;
// Stations appear from STATION_ZOOM (rail only) and from ALL_STATIONS_ZOOM (all).
const STATION_ZOOM = 13;
const ALL_STATIONS_ZOOM = 15;
// Delay classes in seconds; the legend is made from them.
const DELAY_MINOR_S = 120;
const DELAY_MAJOR_S = 300;
const DELAY_SEVERE_S = 600;
const BADGE_DELAY_S = 180; // from here a marker carries its delay as a badge
// Realtime data older than this counts as timetable only. When its fetches
// fail, the server keeps the last delays up to the same age (STALE_AFTER_S in
// server/lib/realtime.js).
const LIVE_MAX_AGE_S = 180;

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
  enabled: new Set([...MODES, 'other']),
  colorBy: loadSetting('colorBy', 'mode') === 'delay' ? 'delay' : 'mode',
  selection: null, // { type: 'trip' | 'station', id, data }
  hits: [],
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
  colors = { mode: {}, delay: {}, text: get('--text'), bg: get('--bg'), accent: get('--accent'), muted: get('--text-muted') };
  for (const mode of DRAW_ORDER) colors.mode[mode] = get(`--mode-${mode}`);
  for (const cls of ['ok', 'minor', 'major', 'severe', 'none']) colors.delay[cls] = get(`--delay-${cls}`);
}
readColors();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  readColors();
  draw();
});

// ---------- map ----------

const map = L.map('map', { zoomControl: false, minZoom: 6, maxZoom: 18 });
map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
// Leaflet needs some view before anything can be drawn. Which part of the
// world to show, and with which map tiles, the server says (see loadArea);
// until then the map is empty.
map.setView([0, 0], map.getMinZoom());

// The area is far larger than a screen at street level, so only what is in
// view (plus a margin, so that small pans need no reload) is requested.
// Zoomed out, where hundreds of vehicles are dots, a reduced form without
// route geometry is enough.
const boxAround = (bounds) => [bounds.getSouth(), bounds.getWest(), bounds.getNorth(), bounds.getEast()];
const boxQuery = (box) => box.map((v) => v.toFixed(4)).join(',');
const boxCovers = (box, bounds) => box[0] <= bounds.getSouth() && box[1] <= bounds.getWest() && box[2] >= bounds.getNorth() && box[3] >= bounds.getEast();
const detailWanted = () => (map.getZoom() >= LABEL_ZOOM ? 'full' : 'lite');

const canvas = L.DomUtil.create('canvas', 'overlay-canvas leaflet-zoom-hide', map.getPane('overlayPane'));
const ctx = canvas.getContext('2d');
let viewSize = map.getSize();

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  viewSize = map.getSize();
  canvas.width = Math.round(viewSize.x * dpr);
  canvas.height = Math.round(viewSize.y * dpr);
  canvas.style.width = `${viewSize.x}px`;
  canvas.style.height = `${viewSize.y}px`;
  placeCanvas();
}

// The overlay pane moves with the map; keep the canvas glued to the viewport.
function placeCanvas() {
  L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
  draw();
}

map.on('move zoomend', placeCanvas);
map.on('resize', resizeCanvas);

// Greys out everything outside the area, where vehicles are only followed
// roughly: one polygon covering the surroundings, with the area as its hole.
function showArea(area) {
  const [south, west, north, east] = area.bbox;
  const surroundings = [[south - 30, west - 60], [south - 30, east + 60], [north + 30, east + 60], [north + 30, west - 60]];
  map.createPane('veil');
  L.polygon([surroundings, ...area.outline], { pane: 'veil', className: 'area-veil', interactive: false, smoothFactor: 1.5 }).addTo(map);
  $('area-hint').hidden = false;
}

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
  const origin = map.getPixelBounds().min;
  const project = (lat, lon) => {
    const p = map.project([lat, lon], zoom);
    return [p.x - origin.x, p.y - origin.y];
  };
  // (with a margin: a marker whose centre is just outside still reaches in)
  const onScreen = (x, y) => x > -30 && y > -30 && x < viewSize.x + 30 && y < viewSize.y + 30;
  const hits = [];
  const selection = state.selection;

  // stations
  const stationRadius = zoom >= 16 ? 4 : 3;
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
    if (zoom >= 12) {
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

  // vehicles
  const labeled = zoom >= LABEL_ZOOM;
  const r = labeled ? (zoom >= 15 ? 11 : 10) : 4.5;
  // Ease towards the computed position so that a changed delay does not make
  // the marker jump.
  const ease = 1 - Math.exp(-dt / EASE_MS);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let selectedVehicle = null;

  for (const v of state.drawList) {
    if (!state.enabled.has(v.mode)) continue;
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
  const hit = hitTest(event.containerPoint);
  map.getContainer().classList.toggle('clickable', !!hit);
  tooltip.hidden = !hit;
  if (!hit) return;
  tooltip.textContent = hit.vehicle ? vehicleSummary(hit.vehicle) : hit.station.name;
  tooltip.style.transform = `translate(${event.containerPoint.x + 14}px, ${event.containerPoint.y + 14}px)`;
});
map.on('mouseout', () => { tooltip.hidden = true; });

map.on('click', (event) => {
  const hit = hitTest(event.containerPoint);
  if (hit?.vehicle) select('trip', hit.vehicle.id);
  else if (hit?.station) select('station', hit.station.id);
  else closePanel();
});

// ---------- controls ----------

const chipCounts = new Map();

function buildControls() {
  languagePicker($('language'));
  L.control.zoom({ position: 'bottomright', zoomInTitle: t('map.zoomIn'), zoomOutTitle: t('map.zoomOut') }).addTo(map);

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

function showBanner(message) {
  const banner = $('banner');
  // It is an alert: written only when it changes, so that it is read out once.
  if (banner.textContent !== (message ?? '')) banner.textContent = message ?? '';
  banner.hidden = !message;
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

function select(type, id) {
  // The row that was activated is about to go: keep the keyboard focus in the panel.
  if (panelBody.contains(document.activeElement)) panel.focus({ preventScroll: true });
  state.selection = { type, id, data: null };
  panel.hidden = false;
  panelBody.replaceChildren(el('p', { class: 'panel-empty', text: t('panel.loading') }));
  loadSelection(true);
}

async function loadSelection(first = false) {
  const selection = state.selection;
  if (!selection) return;
  clearTimeout(panelTimer);
  try {
    const url = selection.type === 'trip' ? `api/trip?id=${encodeURIComponent(selection.id)}` : `api/departures?station=${encodeURIComponent(selection.id)}`;
    const res = await fetch(url);
    const data = res.ok ? await res.json() : null;
    if (state.selection !== selection) return; // user moved on meanwhile
    if (data) {
      selection.data = data;
      if (selection.type === 'trip') renderTrip(data, first);
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
  fillPanel(
    el('div', { class: 'panel-head' }, [
      el('h2', {}, [badge(trip.line, trip.mode), el('span', { text: `→ ${trip.to}` })]),
      el('p', { class: 'sub', text: [mode, trip.agency, trip.realtime ? t('trip.realtime') : t('trip.scheduleOnly')].filter(Boolean).join(' · ') }),
      notesList(notes, trip.cancelled ? t('trip.cancelled') : null),
    ]),
    list,
  );
  if (scrollToNext) nextRow?.scrollIntoView({ block: 'center' });
  else panelBody.scrollTop = scrollTop;
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
// section to start with, the map tiles and the time zone. It does not change
// while the server runs, so it is asked for until it has answered once.
async function loadArea() {
  const res = await fetch('api/area');
  if (!res.ok) throw new Error(`api/area: HTTP ${res.status}`);
  const area = await res.json();
  if (state.areaKnown) return; // asked twice at the same time
  // Returning visitors get the section they last looked at.
  const saved = loadSetting('view', null);

  setTimeZone(area.timeZone);
  $('area-name').textContent = area.name;
  document.title = area.name ? `${APP_NAME} – ${area.name}` : APP_NAME;

  const [south, west, north, east] = area.bbox;
  // Lines are followed beyond the area, so the map reaches well beyond it too.
  const limit = L.latLngBounds([south - 6, west - 9], [north + 6, east + 9]);
  map.setMaxBounds(limit);
  const usable = saved && [saved.lat, saved.lon, saved.zoom].every(Number.isFinite) && limit.contains([saved.lat, saved.lon]);
  // (at once: gliding there from the placeholder would show nothing, and the vehicles are asked for right after)
  if (usable) map.setView([saved.lat, saved.lon], saved.zoom, { animate: false });
  else map.fitBounds([[area.view[0], area.view[1]], [area.view[2], area.view[3]]], { animate: false });

  // Which tiles and whom to name for them and for the data are settings of the
  // server; both attributions are HTML and may contain links.
  const attribution = `${area.attribution.map} · ${t('attribution.data')} ${area.attribution.data}`;
  L.tileLayer(area.tileUrl, { maxZoom: 19, attribution }).addTo(map);
  showArea(area);
  state.areaKnown = true;
}

// Stations are only drawn zoomed in, so they are only loaded then.
async function loadStations() {
  const bounds = map.getBounds();
  if (map.getZoom() < STATION_ZOOM || (state.stationsLoaded && boxCovers(state.stationsLoaded, bounds))) return;
  const box = boxAround(bounds.pad(STATION_MARGIN));
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
    const request = { box: boxAround(map.getBounds().pad(VEHICLE_MARGIN)), detail: detailWanted() };
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

async function init() {
  await loadLanguage();
  translatePage();
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
