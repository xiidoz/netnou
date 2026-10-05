// Renders docs/social-preview.png, the image shown where the repository is
// linked in chats and on social media, with a headless Chrome. It is put
// together from the README screenshot, the favicon and a few words, so run it
// by hand after renewing docs/screenshot.png:
//
//   node tools/build-social-preview.mjs   (CHROME=<path> if Chrome, Chromium or Edge is not found automatically)
//
// The image is not picked up from the repository: upload it under
// Settings → General → Social preview. GitHub wants 1280×640 px and less than
// 1 MB. Name and words keep 80 px away from the edges, in case a preview is
// cut to another shape.
//
// The words are set in the system font, as in the page, so the result looks
// a little different from one operating system to the next.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WIDTH = 1280;
const HEIGHT = 640;
const MAX_BYTES = 1_000_000;
// How much of the width the words take; the screenshot fills the rest.
const PANEL = 620;
const MARGIN = 80;

// Chrome, Chromium or Edge in the place each platform installs it; CHROME overrides the search.
function findChrome() {
  const env = process.env;
  if (env.CHROME) return env.CHROME;
  const candidates = {
    win32: [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).flatMap((dir) => [
      path.join(dir, 'Google/Chrome/Application/chrome.exe'),
      path.join(dir, 'Chromium/Application/chrome.exe'),
      path.join(dir, 'Microsoft/Edge/Application/msedge.exe'),
    ]),
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
  }[process.platform] ?? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    .flatMap((name) => (env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, name)));
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error('No Chrome, Chromium or Edge found. Set CHROME to the path of the browser.');
  return found;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const screenshot = path.join(root, 'docs', 'screenshot.png');
const favicon = path.join(root, 'public', 'favicon.svg');
const out = path.join(root, 'docs', 'social-preview.png');

// The colours of the page (public/style.css); the dots are those of the modes of transport.
const MODES = ['#0b5cad', '#d42a2a', '#7b3fa0', '#1e8a3c', '#4d5a66', '#d97200'];
const html = `<!DOCTYPE html>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #fff; }
  body { position: relative; font: 28px/1.35 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1b1f24; }
  /* The right-hand part of the screenshot at its own size, from its top edge: the map and the stop list. */
  .shot { position: absolute; top: 0; right: 0; width: ${WIDTH - PANEL}px; height: ${HEIGHT}px; background: url("${pathToFileURL(screenshot).href}") right top no-repeat; }
  .panel { position: absolute; inset: 0 auto 0 0; width: ${PANEL}px; padding: ${MARGIN}px 56px ${MARGIN}px ${MARGIN}px; background: #fff; box-shadow: 0 0 28px rgb(0 0 0 / 0.28); display: flex; flex-direction: column; }
  .name { display: flex; align-items: center; gap: 22px; }
  .name img { width: 96px; height: 96px; }
  h1 { font-size: 92px; line-height: 1; font-weight: 700; letter-spacing: -0.02em; }
  .line { margin-top: 44px; font-size: 45px; line-height: 1.16; font-weight: 650; letter-spacing: -0.01em; }
  .more { margin-top: 20px; color: #5c6670; }
  .modes { margin-top: auto; display: flex; gap: 14px; }
  .modes span { width: 26px; height: 26px; border-radius: 50%; }
  /* Whose map and whose data the screenshot shows: its own credits are cut off at the bottom. */
  .credits { position: absolute; right: 0; bottom: 0; padding: 3px 10px; background: rgb(255 255 255 / 0.9); color: #5c6670; font-size: 12px; line-height: 1.5; white-space: nowrap; }
</style>
<div class="shot"></div>
<div class="credits">OpenFreeMap © OpenMapTiles Data from OpenStreetMap · Timetable data: GTFS.DE / DELFI e.V. (CC BY-SA 4.0)</div>
<div class="panel">
  <div class="name"><img src="${pathToFileURL(favicon).href}" alt=""><h1>Netnou</h1></div>
  <p class="line">A live map of public transport</p>
  <p class="more">Buses, trams and trains with their delays, computed from GTFS, GTFS&#8209;Realtime and OpenStreetMap.</p>
  <div class="modes">${MODES.map((color) => `<span style="background:${color}"></span>`).join('')}</div>
</div>
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-social-'));
try {
  const source = path.join(tmp, 'social-preview.html');
  fs.writeFileSync(source, html);
  execFileSync(findChrome(), [
    '--headless=new', '--hide-scrollbars', '--force-device-scale-factor=1', `--user-data-dir=${path.join(tmp, 'profile')}`,
    `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${out}`, pathToFileURL(source).href,
  ], { stdio: 'ignore' });
  const png = fs.readFileSync(out);
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (width !== WIDTH || height !== HEIGHT) throw new Error(`got ${width}x${height} instead of ${WIDTH}x${HEIGHT}`);
  if (png.length >= MAX_BYTES) throw new Error(`${png.length} bytes: GitHub takes less than 1 MB`);
  console.log(`docs/social-preview.png: ${width}x${height}, ${png.length} bytes`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
