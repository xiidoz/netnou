// Service worker of the installable app. Its only job is to let the app start
// without a connection (and then say so) instead of showing a browser error.
//
// Everything is fetched from the network first, so a new version of the page
// is used as soon as it is deployed; the cache is the fallback for offline
// starts. Live data (api/) and the map are never cached.

// Changed files need no new name: with network first the cache follows. Bump
// the version only to get rid of entries for files that were removed or renamed.
const CACHE_PREFIX = 'netnou-shell-';
const CACHE = `${CACHE_PREFIX}v2`;
// What the page needs to start. test/frontend.test.js checks that the files
// exist and that every language of i18n.js is among them.
const SHELL = [
  './',
  'app.js',
  'display.js',
  'i18n.js',
  'search.js',
  'theme.js',
  'locales/de.js',
  'locales/en.js',
  'style.css',
  'favicon.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'vendor/maplibre-gl/maplibre-gl.mjs',
  'vendor/maplibre-gl/maplibre-gl-shared.mjs',
  'vendor/maplibre-gl/maplibre-gl-worker.mjs',
  'vendor/maplibre-gl/maplibre-gl.css',
  'vendor/material-design-icons/icons.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  // Remove this app's older caches – and only those: other apps on the same
  // origin (under another path) keep theirs in the same cache storage.
  const outdated = (name) => name.startsWith(CACHE_PREFIX) && name !== CACHE;
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter(outdated).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  // Of this origin only the shell is kept. It may serve more than this app's
  // files: its live data (api/) and even the map (MAP_STYLE_URL or TILE_URL of
  // the server), of which there is no end.
  if (!SHELL.includes(url.pathname.slice(scope.pathname.length) || './')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(request, { ignoreSearch: true })) ?? Response.error()),
  );
});
