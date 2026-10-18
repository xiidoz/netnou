// Takes the pictures of the page that the READMEs show, from a running
// instance of the default area, with a headless Chrome:
//
//   docs/pictures/phone.webp   three phones: the departures of a stop, the trip
//                              of a bus that leaves there a few minutes late,
//                              and the search
//   docs/pictures/wide.webp    a wide screen as the page usually looks: the map
//                              with the trip of that bus beside it
//   docs/pictures/board.webp   a wide screen with the departures of a stop as a
//                              board beside the map
//   docs/pictures/map.webp     that bus close up on the map alone, for the image
//                              of link previews (npm run build:social)
//
// Run it by hand after a change to the look of the card, the details, the
// search or the board, while the server runs and much is under way, best
// around midday on a weekday. Then npm run build:social, which makes the image
// for link previews from map.webp:
//
//   npm start                                 (in another window)
//   npm run build:pictures                    (the instance at http://localhost:8080)
//   npm run build:pictures -- http://localhost:9000
//
// CHROME=<path> if Chrome, Chromium or Edge is not found automatically, and
// CHROME_ARGS=--no-sandbox in a container. It talks to the browser over a
// WebSocket, which needs Node.js 22.4 or newer.
//
// The pictures show the instance as it is at that moment, in English and in
// the light scheme, so no two runs give the same ones. The page sets its texts
// in the system font, and they look a little different from one operating
// system to the next; on Linux, `fc-match system-ui` should name a sans-serif
// font.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stopPath } from '../public/address.js';
import { chromeArgs, findChrome } from './chrome.mjs';

// What the pictures show in the default area: the stop of the phones and the
// one of the board, by their names in the timetable, and what is typed into
// the search. Of the departures at STOP, the pictures follow a bus a few
// minutes late (LATE, in seconds) that leaves there no sooner than LEAVING
// seconds from now, so that it is still on the list for the last of them.
const STOP = 'Nürnberg Plärrer';
const BOARD_STOP = 'Nürnberg Hbf';
const SEARCH = 'Fürth';
const LATE = { from: 120, to: 600 };
const LEAVING = 180;
// The screens, in CSS pixels, and how many pixels of the pictures make one of
// them: sharp at the width the READMEs show them at, and not too heavy.
const PHONE = { width: 390, height: 844, mobile: true };
const WIDE = { width: 1280, height: 800, mobile: false };
const SCALE = 1.5;
// The map of the link preview: a small screen drawn at four times the pixels,
// so that the vehicles come out large where a preview is shown small. Its
// shape is that of the part of the preview it fills (build-social-preview.mjs).
const CLOSE_UP = { width: 330, height: 320, mobile: false, scale: 4 };
// The zoom of the map as the page usually shows a trip on a wide screen, and
// as close as the map of the link preview comes.
const USUAL_ZOOM = 14;
const CLOSE_ZOOM = 16;
// About how many seconds the close-up takes from asking where the vehicle is
// to the picture: the map is put where it will be by then.
const AHEAD = 6;
// How the pictures are laid out, in CSS pixels.
const PADDING = 20;
const GAP = 24;

if (typeof WebSocket === 'undefined') throw new Error('build-pictures needs Node.js 22.4 or newer, for the WebSocket that talks to the browser');

const base = (process.argv[2] ?? 'http://localhost:8080').replace(/\/+$/, '');
const out = fileURLToPath(new URL('../docs/pictures/', import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(pathname) {
  const res = await fetch(`${base}/${pathname}`);
  if (!res.ok) throw new Error(`${base}/${pathname}: ${res.status}`);
  return res.json();
}

/** Asks `check` until it says yes, for at most `ms`; what it last said. */
async function until(check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const result = await check();
    if (result || Date.now() > end) return result;
    await sleep(500);
  }
}

/**
 * A headless Chrome showing one page, spoken to over the DevTools protocol:
 * send() a command, on() events, close() it. It listens on a port of its
 * choosing and says which.
 */
async function openBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-pictures-'));
  const chrome = spawn(findChrome(), ['--headless=new', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, ...chromeArgs(), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const browserUrl = await new Promise((resolve, reject) => {
    let said = '';
    chrome.stderr.on('data', (chunk) => {
      said += chunk;
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(said);
      if (found) resolve(found[1]);
    });
    chrome.on('error', reject);
    chrome.on('exit', (code) => reject(new Error(`the browser stopped (${code}): ${said.trim().split('\n').at(-1)}`)));
  });
  const targets = await (await fetch(`http://${new URL(browserUrl).host}/json/list`)).json();
  const socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('no connection to the browser'));
  });
  let lastId = 0;
  const pending = new Map();
  const listeners = new Set();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      for (const listener of listeners) listener(message);
      return;
    }
    const { resolve, reject, method } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(`${method}: ${message.error.message}`));
    else resolve(message.result);
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++lastId, { resolve, reject, method });
      socket.send(JSON.stringify({ id: lastId, method, params }));
    }),
    on: (listener) => listeners.add(listener),
    async close() {
      socket.close();
      // (unless it has stopped by itself already)
      if (chrome.exitCode === null && chrome.signalCode === null) {
        const stopped = new Promise((resolve) => chrome.once('exit', resolve));
        chrome.kill();
        await stopped;
      }
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

// ---------- the instance ----------

// Its timetable read, its routes worked out, and realtime data come in: asking
// for vehicles is what starts the fetching of the realtime feed.
const status = await get('api/status');
if (status.timetable?.state !== 'ready') throw new Error(`${base}: the timetable is not read yet (${status.timetable?.state}); try again once the page shows vehicles`);
if (!status.routes?.segments) console.warn('No routes yet: the vehicles move in straight lines. Better wait until they follow roads and tracks.');
await get('api/vehicles');
if (!(await until(async () => (await get('api/status')).realtime?.fetchedAt, 120_000))) console.warn('No realtime data: the pictures show the timetable only.');
const vehicles = (await get('api/vehicles')).vehicles?.length ?? 0;
if (vehicles < 500) console.warn(`Only ${vehicles} vehicles under way: the map looks empty. Around midday on a weekday there are many more.`);

const stations = await get('api/stations');
function station(name) {
  const found = stations.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`${base} has no stop "${name}": the pictures are of the default area`);
  return found;
}
const stop = station(STOP);
const boardStop = station(BOARD_STOP);
const stopAddress = `${stopPath(stop.name, stop.lat, stop.lon)}?lang=en`;

// When a trip leaves or reaches one of its stops, by the timetable and the delay reported for it.
const leaves = (stop) => stop.dep + (stop.depDelay ?? stop.arrDelay ?? 0);
const reaches = (stop) => stop.arr + (stop.arrDelay ?? stop.depDelay ?? 0);

/**
 * The departure at the stop that the pictures follow: a bus a few minutes
 * late, else any bus, else any departure, whose vehicle is under way and
 * leaves the stop no sooner than LEAVING seconds from now.
 */
async function departureToFollow() {
  const { now, departures } = await get(`api/departures?station=${encodeURIComponent(stop.id)}`);
  const candidates = [];
  for (const departure of departures) {
    if (departure.cancelled || departure.planned + departure.delay - now < LEAVING) continue;
    const trip = await get(`api/trip?id=${encodeURIComponent(departure.trip)}`);
    if (leaves(trip.stops[0]) >= trip.now || reaches(trip.stops.at(-1)) <= trip.now) continue;
    const candidate = { departure, bus: departure.mode === 'bus', late: departure.delay >= LATE.from && departure.delay <= LATE.to };
    if (candidate.bus && candidate.late) return departure;
    candidates.push(candidate);
  }
  const found = candidates.find((candidate) => candidate.bus) ?? candidates[0];
  if (!found) throw new Error(`no vehicle under way leaves ${STOP} in the next hours`);
  console.warn(`No bus a few minutes late leaves ${STOP} now: the pictures follow the ${found.departure.mode} ${found.departure.line} to ${found.departure.to}.`);
  return found.departure;
}

/**
 * Where the vehicle of a trip is `ahead` seconds from now, as the server works
 * it out for the page: in this form of the answer two knots, where it is now and
 * where in a minute, between which it moves in a straight line.
 */
async function whereIn(tripId, ahead) {
  const { vehicles } = await get(`api/vehicles?vehicle=${encodeURIComponent(tripId)}`);
  const vehicle = vehicles.find((candidate) => candidate.id === tripId);
  if (!vehicle) throw new Error(`the ${followed.mode} ${followed.line} to ${followed.to} is no longer under way: run it once more`);
  const [from, lat, lon, to, nextLat, nextLon] = vehicle.knots;
  const share = to > from ? Math.min(1, ahead / (to - from)) : 0;
  return { lat: lat + share * ((nextLat ?? lat) - lat), lon: lon + share * ((nextLon ?? lon) - lon) };
}

const followed = await departureToFollow();
console.log(`following: ${followed.mode} ${followed.line} to ${followed.to}, ${Math.round(followed.delay / 60)} min late`);

// ---------- the pictures ----------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-pictures-'));
const browser = await openBrowser();
try {
  const { send } = browser;
  await send('Page.enable');
  await send('Network.enable');
  // (every picture as on a first visit, and the one tip as seen: nothing kept from one picture to the next)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: "try { localStorage.clear(); localStorage.setItem('netnou.tipped', 'true'); } catch {}" });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  // The requests on the way, to see when the map has its tiles and the page its answers.
  const loading = new Set();
  let loaded = null;
  browser.on(({ method, params }) => {
    if (method === 'Network.requestWillBeSent') loading.add(params.requestId);
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') loading.delete(params.requestId);
    if (method === 'Page.loadEventFired') loaded?.();
  });

  async function evaluate(expression) {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  }
  async function waitFor(expression, what) {
    if (!(await until(() => evaluate(expression), 30_000))) throw new Error(`${what} did not show within 30 s`);
  }
  // Until nothing has been loading for two seconds (at most 20), and the sheet has stopped gliding.
  async function settle() {
    let quietSince = Date.now();
    const end = Date.now() + 20_000;
    while (Date.now() < end && Date.now() - quietSince < 2000) {
      if (loading.size) quietSince = Date.now();
      await sleep(100);
    }
    await sleep(800);
  }
  /** Opens an address of the instance, or a whole URL, and waits for the page to have loaded. */
  async function go(address) {
    const done = new Promise((resolve) => (loaded = resolve));
    loading.clear();
    await send('Page.navigate', { url: /^[a-z]+:/.test(address) ? address : `${base}/${address}` });
    await done;
  }
  async function screen({ width, height, mobile, scale = SCALE }) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    await send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  }
  async function shoot(name, format = 'png') {
    const { data } = await send('Page.captureScreenshot', format === 'png' ? { format } : { format, quality: 82 });
    const file = path.join(format === 'png' ? tmp : out, `${name}.${format}`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`taken: ${name}`);
  }
  /** Taps the departure that the pictures follow, in the list of the stop that the page shows. */
  async function tapFollowed() {
    await waitFor("document.querySelectorAll('#panel-body .row.departure').length > 0", 'The departures');
    const { departures } = await get(`api/departures?station=${encodeURIComponent(stop.id)}`);
    const row = departures.findIndex((departure) => departure.trip === followed.trip);
    if (row < 0) throw new Error(`the ${followed.mode} ${followed.line} to ${followed.to} has left ${STOP}: run it once more`);
    await evaluate(`document.querySelectorAll('#panel-body .row.departure')[${row}].click()`);
    await waitFor("document.querySelector('#panel-body .rail') !== null", 'The trip');
  }
  // The zoom the map is at, as the page keeps it: in the address of a display, else in the browser.
  const zoomNow = () => evaluate("Number((new URL(location.href).searchParams.get('view') ?? JSON.parse(localStorage.getItem('netnou.view') ?? '{}').zoom ?? '').toString().split(',').at(-1)) || null");
  /** Zooms the map with its own buttons until it is at about `zoom`, around the middle of the map. */
  async function zoomTo(zoom) {
    for (let step = 0; step < 8; step++) {
      const now = await zoomNow();
      if (now === null || Math.abs(now - zoom) < 0.5) return;
      await evaluate(`document.querySelector('.maplibregl-ctrl-zoom-${now > zoom ? 'out' : 'in'}').click()`);
      await sleep(700);
    }
  }

  await screen(PHONE);
  // The departures of the stop, as somebody coming from a search engine sees them.
  await go(stopAddress);
  await waitFor("document.querySelectorAll('#panel-body .row.departure').length > 0", 'The departures');
  await settle();
  await shoot('departures');
  // The trip of the bus: a tap on its departure, and the map goes to it.
  await tapFollowed();
  await settle();
  await shoot('trip');
  // The search, on the map of the whole area as the page opens.
  await go('?lang=en');
  await waitFor("/\\d/.test(document.getElementById('status-text').textContent)", 'The vehicles');
  await evaluate("document.getElementById('search-open').click(); document.getElementById('search-field').focus()");
  await send('Input.insertText', { text: SEARCH });
  await waitFor("document.querySelectorAll('#search-results li').length > 0", 'What the search finds');
  await settle();
  await shoot('search');

  await screen(WIDE);
  // The page as it usually looks on a wide screen: the trip of the bus beside the map of the city.
  await go(stopAddress);
  await tapFollowed();
  await zoomTo(USUAL_ZOOM);
  await settle();
  await shoot('wide');
  const tripUrl = new URL(await evaluate('location.href'));
  // The departures of a stop as a board beside the map, as on a screen on a wall.
  await go(`${stopPath(boardStop.name, boardStop.lat, boardStop.lon)}?lang=en&board=50`);
  await waitFor("document.querySelectorAll('.board-rows > li').length > 0", 'The board');
  // (the map further out than the stop opens it: more of the city, and still the names of lines and stops)
  await zoomTo(USUAL_ZOOM);
  await settle();
  await shoot('board');

  // The bus close up on the map alone, for the image of link previews: its trip
  // at its address, as a display without controls, on the place it is at about now.
  await screen(CLOSE_UP);
  const { lat, lon } = await whereIn(followed.trip, AHEAD);
  tripUrl.search = new URLSearchParams({ lang: 'en', display: 'fixed', view: `${lat.toFixed(5)},${lon.toFixed(5)},${CLOSE_ZOOM}` }).toString();
  await go(tripUrl.href);
  await waitFor("/\\d/.test(document.getElementById('status-text').textContent)", 'The vehicles');
  // (what a display keeps of the card, the details and the credits too: the image of link previews has credits of its own)
  await evaluate("for (const node of document.querySelectorAll('#controls, #panel, .maplibregl-control-container, #display-leave')) node.style.display = 'none'");
  await settle();
  fs.mkdirSync(out, { recursive: true });
  await shoot('map', 'webp');

  // The pictures for the READMEs: on a transparent ground, so that they sit on
  // GitHub's light and dark pages alike, each with rounded corners and a shadow.
  async function compose(file, names, { width, height }, radius) {
    const html = `<!DOCTYPE html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: transparent; }
  body { display: flex; gap: ${GAP}px; padding: ${PADDING}px; width: max-content; }
  img { display: block; width: ${width}px; height: ${height}px; border-radius: ${radius}px; box-shadow: 0 0 0 1px rgb(0 0 0 / 0.14), 0 4px 18px rgb(0 0 0 / 0.18); }
</style>
${names.map((name) => `<img src="${name}.png" alt="">`).join('\n')}
`;
    const page = path.join(tmp, `${file}.html`);
    fs.writeFileSync(page, html);
    const size = { width: PADDING * 2 + names.length * width + (names.length - 1) * GAP, height: PADDING * 2 + height };
    await send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: SCALE, mobile: false });
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await go(pathToFileURL(page).href);
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 82, clip: { x: 0, y: 0, ...size, scale: 1 } });
    const target = path.join(out, `${file}.webp`);
    fs.writeFileSync(target, Buffer.from(data, 'base64'));
    console.log(`docs/pictures/${file}.webp: ${Math.round(size.width * SCALE)}x${Math.round(size.height * SCALE)}, ${Math.round(fs.statSync(target).size / 1024)} kB`);
  }
  await compose('phone', ['departures', 'trip', 'search'], PHONE, 28);
  await compose('wide', ['wide'], WIDE, 12);
  await compose('board', ['board'], WIDE, 12);
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
