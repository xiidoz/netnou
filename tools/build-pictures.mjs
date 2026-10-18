// Takes the pictures of the page that the READMEs show, with a headless
// Chrome, from a server of this checkout that it starts on the data in
// tools/pictures/: a Monday at 13:37 around Nürnberg and Fürth, with delays
// made up for it (build-picture-data.mjs). So the pictures come out the same
// at whatever hour they are taken, and show what the page looks like now:
//
//   docs/pictures/phone.webp   three phones: the departures of Nürnberg Plärrer,
//                              the trip of a bus that has just left there a few
//                              minutes late, and the search
//   docs/pictures/wide.webp    a wide screen as the page usually looks: the map
//                              with the trip of that bus beside it
//   docs/pictures/board.webp   a wide screen with the departures of a stop as a
//                              board beside the map
//   docs/pictures/map.webp     that bus close up on the map alone, for the image
//                              of link previews (npm run build:social)
//
// Run it by hand after a change to the look of the card, the details, the
// search or the board, then npm run build:social:
//
//   npm run build:pictures
//
// CHROME=<path> if Chrome, Chromium or Edge is not found automatically, and
// CHROME_ARGS=--no-sandbox in a container. It talks to the browser over a
// WebSocket, which needs Node.js 22.4 or newer. The map behind the vehicles
// comes from OpenFreeMap as for any visitor, so it needs the internet.
//
// The pictures are in English and in the light scheme. The page sets its
// texts in the system font, and they look a little different from one
// operating system to the next; on Linux, `fc-match system-ui` should name a
// sans-serif font.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stopPath } from '../public/address.js';
import { chromeArgs, findChrome } from './chrome.mjs';

// The stop of the board, by its name in the timetable, and what is typed into the search.
const BOARD_STOP = 'Nürnberg Hbf';
const SEARCH = 'Fürth';
// The screens, in CSS pixels, and how many pixels of the pictures make one of
// them: sharp at the width the READMEs show them at, and not too heavy.
const PHONE = { width: 390, height: 844, mobile: true };
const WIDE = { width: 1280, height: 800, mobile: false };
const SCALE = 1.5;
// The map of the link preview: a small screen drawn at four times the pixels,
// so that the vehicles come out large where a preview is shown small. Its
// shape is that of the part of the preview it fills (build-social-preview.mjs).
const CLOSE_UP = { width: 330, height: 320, mobile: false, scale: 4 };
// The map as the page usually shows a trip on a wide screen; as close as the
// map of the link preview comes; and where the search is opened: Nürnberg and
// Fürth, as the page keeps the last view of a visitor.
const USUAL_ZOOM = 14;
const CLOSE_ZOOM = 16;
const SEARCH_VIEW = { lat: 49.462, lon: 11.03, zoom: 11.6 };
// How the pictures are laid out, in CSS pixels.
const PADDING = 20;
const GAP = 24;
// Where in its round of two seconds the pulse of the status dot is held, in milliseconds.
const PULSE_MS = 600;

if (typeof WebSocket === 'undefined') throw new Error('build-pictures needs Node.js 22.4 or newer, for the WebSocket that talks to the browser');

const root = fileURLToPath(new URL('../', import.meta.url));
const data = path.join(root, 'tools', 'pictures');
const out = path.join(root, 'docs', 'pictures');
const moment = JSON.parse(fs.readFileSync(path.join(data, 'moment.json'), 'utf8'));
const at = Date.parse(moment.now);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks `check` until it says yes, for at most `ms`; what it last said. */
async function until(check, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const result = await check();
    if (result || Date.now() > end) return result;
    await sleep(500);
  }
}

/** Starts a process, and resolves with what it says to stdout or stderr that `pattern` finds in it. */
function started(child, pattern, what) {
  return new Promise((resolve, reject) => {
    let said = '';
    const hear = (chunk) => {
      said += chunk;
      const found = pattern.exec(said);
      if (found) resolve(found);
    };
    child.stdout?.on('data', hear);
    child.stderr?.on('data', hear);
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`${what} stopped (${code}): ${said.trim().split('\n').slice(-3).join(' / ')}`)));
  });
}

/** Stops a process and waits until it has, unless it has stopped by itself already. */
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await stopped;
}

// ---------- the server ----------

/**
 * The files of the data as their publishers would serve them, on a port of
 * the system's choosing, with the date of the timetable as their date.
 */
async function serveData() {
  const files = { '/feed.zip': 'feed.zip', '/osm.pbf': 'osm.pbf', '/realtime.pb': 'realtime.pb' };
  const modified = new Date(at - 86_400_000).toUTCString();
  const server = http.createServer((req, res) => {
    const file = files[new URL(req.url, 'http://localhost').pathname];
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    const body = fs.readFileSync(path.join(data, file));
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length, 'Last-Modified': modified, ETag: `"${file}"` });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

/**
 * A server of this checkout on the data, its clock held at the moment
 * (frozen-clock.mjs), with a data directory of its own; none of the settings
 * of the shell, which would change what it shows.
 */
async function startServer(dataUrl, dataDir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NETNOU_')));
  Object.assign(env, {
    NETNOU_HOST: '127.0.0.1',
    NETNOU_PORT: '0',
    NETNOU_DATA_DIR: dataDir,
    NETNOU_FEED_URL: `${dataUrl}/feed.zip`,
    NETNOU_REALTIME_URL: `${dataUrl}/realtime.pb`,
    NETNOU_OSM_PBF_URLS: `${dataUrl}/osm.pbf`,
    NETNOU_UPDATE_CHECK: 'off',
    FAKE_NOW: moment.now,
  });
  const clock = pathToFileURL(path.join(root, 'tools', 'frozen-clock.mjs')).href;
  const server = spawn(process.execPath, ['--import', clock, path.join(root, 'server', 'index.js')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const [, base] = await started(server, /Netnou listening on (http:\/\/\S+?),? /, 'the server');
  return { server, base: base.replace(/\/$/, '') };
}

const files = await serveData();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-pictures-data-'));
const { server, base } = await startServer(files.url, dataDir);
const get = async (pathname) => {
  const res = await fetch(`${base}/${pathname}`);
  if (!res.ok) throw new Error(`${base}/${pathname}: ${res.status}`);
  return res.json();
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-pictures-'));
let page = null;
try {
  // Its timetable read and its routes worked out, from the data: a minute or two.
  const ready = await until(async () => {
    const status = await get('api/status').catch(() => null);
    return status?.timetable?.state === 'ready' && status.routes?.segments > 0;
  }, 600_000);
  if (!ready) throw new Error('the server did not read the data within 10 minutes');
  const stations = await get('api/stations');
  const station = (name) => {
    const found = stations.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`the data has no stop "${name}"`);
    return found;
  };
  const stop = station(moment.stop);
  const boardStop = station(BOARD_STOP);
  const stopAddress = `${stopPath(stop.name, stop.lat, stop.lon)}?lang=en`;
  // The delays in before the first vehicles: the departures of a stop start the
  // fetching of the realtime feed, and the server, whose clock stands still,
  // would keep vehicles worked out without them for good.
  await get(`api/departures?station=${encodeURIComponent(stop.id)}`);
  if (!(await until(async () => (await get('api/status')).realtime?.fetchedAt, 120_000))) throw new Error('the server did not read the delays within two minutes');
  // The trip of the bus, at its address.
  const trip = await get(`api/trip?id=${encodeURIComponent(moment.follow)}`);
  const tripAddress = `${trip.address}?lang=en`;
  console.log(`following the ${moment.kind} ${trip.line} to ${trip.to}, ${moment.late} s late at ${moment.stop}`);

  page = await openPage();

  async function evaluate(expression) {
    const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
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
      if (page.loading.size) quietSince = Date.now();
      await sleep(100);
    }
    await sleep(800);
  }
  /** Opens an address of the server, or a whole URL, and waits for the page to have loaded. */
  async function go(address) {
    const done = new Promise((resolve) => (page.loaded = resolve));
    page.loading.clear();
    await page.send('Page.navigate', { url: /^[a-z]+:/.test(address) ? address : `${base}/${address}` });
    await done;
  }
  async function screen({ width, height, mobile, scale = SCALE }) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
    await page.send('Emulation.setTouchEmulationEnabled', mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  }
  async function shoot(name, format = 'png') {
    // The fonts looked up anew, as when the page gets one more: the canvas of the
    // vehicles keeps the font it found first, and its letters came out in one of
    // two forms from run to run. A face that loads nothing does it.
    await evaluate("document.fonts.add(new FontFace('netnou-pictures', 'local(netnou-pictures)')); 0");
    await sleep(600);
    // What moves by itself held still: the pulse of the status dot, from the next frame on.
    await evaluate(`for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = ${PULSE_MS}; }`);
    await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const { data: picture } = await page.send('Page.captureScreenshot', format === 'png' ? { format } : { format, quality: 82 });
    fs.writeFileSync(path.join(format === 'png' ? tmp : out, `${name}.${format}`), Buffer.from(picture, 'base64'));
    console.log(`taken: ${name}`);
  }
  /** Opens the trip of the bus at its address, as a link to it does: the map goes to where the bus is. */
  async function openTrip() {
    await go(tripAddress);
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
  // The trip of the bus, a stop further on.
  await openTrip();
  await settle();
  await shoot('trip');
  // The search, on the map of Nürnberg and Fürth.
  await go('?lang=en');
  await waitFor("/\\d/.test(document.getElementById('status-text').textContent)", 'The vehicles');
  await evaluate("document.getElementById('search-open').click(); document.getElementById('search-field').focus()");
  await page.send('Input.insertText', { text: SEARCH });
  await waitFor("document.querySelectorAll('#search-results li').length > 0", 'What the search finds');
  await settle();
  await shoot('search');

  await screen(WIDE);
  // The page as it usually looks on a wide screen: the trip of the bus beside the map of the city.
  await openTrip();
  await zoomTo(USUAL_ZOOM);
  await settle();
  await shoot('wide');
  // The departures of a stop as a board beside the map, as on a screen on a wall.
  await go(`${stopPath(boardStop.name, boardStop.lat, boardStop.lon)}?lang=en&board=50`);
  await waitFor("document.querySelectorAll('.board-rows > li').length > 0", 'The board');
  // (the map further out than the stop opens it: more of the city, and still the names of lines and stops)
  await zoomTo(USUAL_ZOOM);
  await settle();
  await shoot('board');

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
    const sheet = path.join(tmp, `${file}.html`);
    fs.writeFileSync(sheet, html);
    const size = { width: PADDING * 2 + names.length * width + (names.length - 1) * GAP, height: PADDING * 2 + height };
    await page.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: SCALE, mobile: false });
    await page.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    await go(pathToFileURL(sheet).href);
    const { data: picture } = await page.send('Page.captureScreenshot', { format: 'webp', quality: 82, clip: { x: 0, y: 0, ...size, scale: 1 } });
    const target = path.join(out, `${file}.webp`);
    fs.writeFileSync(target, Buffer.from(picture, 'base64'));
    console.log(`docs/pictures/${file}.webp: ${Math.round(size.width * SCALE)}x${Math.round(size.height * SCALE)}, ${Math.round(fs.statSync(target).size / 1024)} kB`);
  }
  fs.mkdirSync(out, { recursive: true });
  await compose('phone', ['departures', 'trip', 'search'], PHONE, 28);
  await compose('wide', ['wide'], WIDE, 12);
  await compose('board', ['board'], WIDE, 12);

  // The bus close up on the map alone, for the image of link previews: its trip
  // at its address, as a display without controls, on the place it is at.
  await screen(CLOSE_UP);
  const { vehicles } = await get(`api/vehicles?vehicle=${encodeURIComponent(moment.follow)}`);
  const bus = vehicles.find((vehicle) => vehicle.id === moment.follow);
  if (!bus) throw new Error(`the ${moment.kind} ${trip.line} is not under way at the moment of the data`);
  const [, lat, lon] = bus.knots;
  await go(`${trip.address}?${new URLSearchParams({ lang: 'en', display: 'fixed', view: `${lat.toFixed(5)},${lon.toFixed(5)},${CLOSE_ZOOM}` })}`);
  await waitFor("/\\d/.test(document.getElementById('status-text').textContent)", 'The vehicles');
  // (what a display keeps of the card, the details and the credits too: the image of link previews has credits of its own)
  await evaluate("for (const node of document.querySelectorAll('#controls, #panel, .maplibregl-control-container, #display-leave')) node.style.display = 'none'");
  await settle();
  await shoot('map', 'webp');
} finally {
  await page?.close();
  await stop(server);
  files.server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}

/**
 * The page of a new browser, set up as every picture starts: a first visit,
 * with the one tip seen and the search where the view is kept, in the light
 * scheme, and the clock of the page held at the moment, as that of the server
 * is, so that every vehicle is where it is then. It counts the requests on the
 * way, to see when the map has its tiles and the page its answers.
 */
async function openPage() {
  const browser = await openBrowser();
  const page = { send: browser.send, loading: new Set(), loaded: null, close: () => browser.close() };
  browser.on(({ method, params }) => {
    if (method === 'Network.requestWillBeSent') page.loading.add(params.requestId);
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') page.loading.delete(params.requestId);
    if (method === 'Page.loadEventFired') page.loaded?.();
  });
  try {
    await page.send('Page.enable');
    await page.send('Network.enable');
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.clear(); localStorage.setItem('netnou.tipped', 'true'); localStorage.setItem('netnou.view', ${JSON.stringify(JSON.stringify(SEARCH_VIEW))}); } catch {}
Date.now = () => ${at};`,
    });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  } catch (error) {
    await browser.close();
    throw error;
  }
  return page;
}

/**
 * A headless Chrome showing one page, spoken to over the DevTools protocol:
 * send() a command, on() events, close() it. It listens on a port of its
 * choosing and says which.
 */
async function openBrowser() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-pictures-browser-'));
  // (the page drawn without the GPU, the map with it: on the GPU, edges of the card came out a shade apart from run to run)
  const chrome = spawn(findChrome(), ['--headless=new', '--hide-scrollbars', '--disable-gpu-rasterization', '--remote-debugging-port=0', `--user-data-dir=${profile}`, ...chromeArgs(), 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const [, browserUrl] = await started(chrome, /DevTools listening on (ws:\/\/\S+)/, 'the browser');
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
      await stop(chrome);
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}
