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
      `--window-size=${size},${size}`, `--screenshot=${out}`, pathToFileURL(source).href,
    ], { stdio: 'ignore' });
    const png = fs.readFileSync(out);
    const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    if (width !== size || height !== size) throw new Error(`${name}: got ${width}x${height} instead of ${size}x${size}`);
    console.log(`${name}: ${size}x${size}, ${png.length} bytes`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
