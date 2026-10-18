// Renders docs/social-preview.png, the image shown where the repository is
// linked in chats and on social media, with a headless Chrome. It is put
// together from the pictures of the READMEs, the favicon and a few words, so
// run it by hand after npm run build:pictures:
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
import { chromeArgs, findChrome } from './chrome.mjs';

const WIDTH = 1280;
const HEIGHT = 640;
const MAX_BYTES = 1_000_000;
// How much of the width the words take; two phones fill the rest.
const PANEL = 620;
const MARGIN = 80;
// docs/pictures/phone.webp as build-pictures.mjs lays it out, in CSS pixels:
// three phones 390 px wide, 24 px apart, 20 px from the edges. The first two
// show here, each SHOWN px wide, side by side in the middle, from TOP down.
const PHONES = { width: 390, gap: 24, padding: 20, count: 3 };
const SHOWN = 280;
const TOP = 28;
const ZOOM = SHOWN / PHONES.width;
const phonesWidth = (PHONES.padding * 2 + PHONES.count * PHONES.width + (PHONES.count - 1) * PHONES.gap) * ZOOM;
const phonesLeft = (WIDTH - PANEL - (2 * PHONES.width + PHONES.gap) * ZOOM) / 2 - PHONES.padding * ZOOM;
const phonesTop = TOP - PHONES.padding * ZOOM;
// (to the middle of the gap after the second phone: the third stays out)
const phonesShown = (PHONES.padding + 2 * PHONES.width + 1.5 * PHONES.gap) * ZOOM;

const root = fileURLToPath(new URL('../', import.meta.url));
const phones = path.join(root, 'docs', 'pictures', 'phone.webp');
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
  /* The departures of a stop and the trip of one of them, on a phone each. */
  .shot { position: absolute; top: 0; right: 0; width: ${WIDTH - PANEL}px; height: ${HEIGHT}px; background: #e9edf1; }
  .phones { position: absolute; top: 0; left: ${phonesLeft}px; width: ${phonesShown}px; height: ${HEIGHT}px; background: url("${pathToFileURL(phones).href}") 0 ${phonesTop}px / ${phonesWidth}px auto no-repeat; }
  .panel { position: absolute; inset: 0 auto 0 0; width: ${PANEL}px; padding: ${MARGIN}px 56px ${MARGIN}px ${MARGIN}px; background: #fff; box-shadow: 0 0 28px rgb(0 0 0 / 0.28); display: flex; flex-direction: column; }
  .name { display: flex; align-items: center; gap: 22px; }
  .name img { width: 96px; height: 96px; }
  h1 { font-size: 92px; line-height: 1; font-weight: 700; letter-spacing: -0.02em; }
  .line { margin-top: 44px; font-size: 45px; line-height: 1.16; font-weight: 650; letter-spacing: -0.01em; }
  .more { margin-top: 20px; color: #5c6670; }
  .modes { margin-top: auto; display: flex; gap: 14px; }
  .modes span { width: 26px; height: 26px; border-radius: 50%; }
  /* Whose map and whose data the phones show: their own credits are under the details. */
  .credits { position: absolute; right: 0; bottom: 0; padding: 3px 10px; background: rgb(255 255 255 / 0.9); color: #5c6670; font-size: 12px; line-height: 1.5; white-space: nowrap; }
</style>
<div class="shot"><div class="phones"></div></div>
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
    `--window-size=${WIDTH},${HEIGHT}`, `--screenshot=${out}`, ...chromeArgs(), pathToFileURL(source).href,
  ], { stdio: 'ignore' });
  const png = fs.readFileSync(out);
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (width !== WIDTH || height !== HEIGHT) throw new Error(`got ${width}x${height} instead of ${WIDTH}x${HEIGHT}`);
  if (png.length >= MAX_BYTES) throw new Error(`${png.length} bytes: GitHub takes less than 1 MB`);
  console.log(`docs/social-preview.png: ${width}x${height}, ${png.length} bytes`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
