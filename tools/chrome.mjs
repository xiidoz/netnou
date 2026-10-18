// Chrome, Chromium or Edge for the tools that render with a headless browser:
// build-icons, build-social-preview and build-pictures. CHROME names the
// browser where it is not found by itself, CHROME_ARGS adds to its command
// line, for example --no-sandbox in a container that leaves Chromium no
// sandbox of its own.

import fs from 'node:fs';
import path from 'node:path';

// Chrome, Chromium or Edge in the place each platform installs it; CHROME overrides the search.
export function findChrome() {
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

/** What CHROME_ARGS adds to the command line of the browser. */
export const chromeArgs = () => (process.env.CHROME_ARGS ?? '').split(/\s+/).filter(Boolean);
