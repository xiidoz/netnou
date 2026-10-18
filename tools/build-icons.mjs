// Renders the PNG app icons in public/icons from public/favicon.svg with a
// headless Chrome. Run by hand after changing the favicon:
//
//   node tools/build-icons.mjs            (CHROME=<path> if Chrome, Chromium or Edge is not found automatically)
//
// Two variants: the favicon as it is (rounded corners, transparent outside)
// and a full-bleed one whose symbol stays inside the central "safe zone",
// for platforms that cut the icon to their own shape (Android, iOS).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromeArgs, findChrome } from './chrome.mjs';

const chrome = findChrome();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const favicon = fs.readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8');

// Full-bleed variant: square background, symbol scaled down around the centre.
const [, open, background, symbol] = /^(<svg[^>]*>)\s*(<rect[^>]*\/>)([\s\S]*)<\/svg>\s*$/.exec(favicon) ?? [];
if (!symbol) throw new Error('favicon.svg: expected a background <rect> followed by the symbol');
const fill = /fill="([^"]+)"/.exec(background)[1];
const fullBleed = `${open}<rect width="32" height="32" fill="${fill}"/><g transform="translate(16 16) scale(0.7) translate(-16 -16)">${symbol}</g></svg>`;

const ICONS = [
  ['icon-192.png', favicon, 192],
  ['icon-512.png', favicon, 512],
  ['icon-maskable-512.png', fullBleed, 512],
  ['apple-touch-icon.png', fullBleed, 180],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-icons-'));
fs.mkdirSync(path.join(publicDir, 'icons'), { recursive: true });
try {
  for (const [name, svg, size] of ICONS) {
    const source = path.join(tmp, `${name}.html`);
    const out = path.join(publicDir, 'icons', name);
    // Pinned to the top left corner at a fixed pixel size: Chrome does not make
    // its window as narrow as the small icons, and the screenshot is cut from
    // that corner.
    fs.writeFileSync(path.join(tmp, `${name}.svg`), svg);
    fs.writeFileSync(source, `<!DOCTYPE html><body style="margin:0"><img src="${name}.svg" style="display:block;width:${size}px;height:${size}px">`);
    execFileSync(chrome, [
      '--headless=new', '--hide-scrollbars', '--default-background-color=00000000', `--user-data-dir=${path.join(tmp, 'profile')}`,
      `--window-size=${size},${size}`, `--screenshot=${out}`, ...chromeArgs(), pathToFileURL(source).href,
    ], { stdio: 'ignore' });
    const png = fs.readFileSync(out);
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    if (width !== size || height !== size) throw new Error(`${name}: got ${width}x${height} instead of ${size}x${size}`);
    console.log(`${name}: ${size}x${size}, ${png.length} bytes`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
