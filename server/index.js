import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadConfig, parseBox } from './config.js';
import { FeedUpdater } from './lib/feed.js';
import { RealtimePoller } from './lib/realtime.js';
import { LANGUAGE_CODES, ownFiles, renderManifest, renderPage, robotsTxt, sitemapXml } from './lib/page.js';
import { setTimeZone } from './lib/time.js';
import { lite } from './lib/timetable.js';
import { describeBuild, githubReleases, UpdateChecker } from './lib/update.js';

const log = (message) => console.log(`${new Date().toISOString()} ${message}`);

let config;
try {
  config = loadConfig();
} catch (err) {
  // A wrong setting is for the operator to fix: name it, without a stack trace.
  console.error(`Configuration error: ${err.message}`);
  process.exit(1);
}
setTimeZone(config.timeZone);
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const build = describeBuild(pkg);
const homepage = pkg.homepage.replace(/#.*$/, '');
// Those the server asks for data can tell what is asking and where to read about it.
const userAgent = `Netnou/${build.version} (+${homepage})`;

let timetable = null;

const realtime = new RealtimePoller({
  url: config.realtimeUrl,
  intervalMs: config.realtimeIntervalMs,
  idleMs: config.realtimeIdleMs,
  getTimetable: () => timetable,
  log,
  userAgent,
});

const updates = new UpdateChecker({
  current: build.version,
  releases: config.updateCheck ? githubReleases(pkg.repository) : null,
  userAgent,
  log,
});

const feed = new FeedUpdater({
  url: config.feedUrl,
  dataDir: config.dataDir,
  area: config.area,
  checkMs: config.feedCheckMs,
  downloadTimeoutMs: config.downloadTimeoutMs,
  osm: { urls: config.osmUrls, maxAgeMs: config.osmMaxAgeMs },
  log,
  onTimetable(next) {
    timetable = next;
    // Trip ids are only valid within one feed version.
    realtime.reset();
    vehicleCache = null;
    searchCache = null;
  },
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|xml)|image\/svg)/;

const MAP_ORIGINS = config.mapOrigins.join(' ');
// Data is no page for the results of a search engine, and on an instance that
// is not to be found (SEARCH_ENGINES) nothing is. It may be read all the same:
// a search engine that runs the page asks for data as a browser does, and one
// that may not read an answer never sees that it is asked not to list it.
const NOT_LISTED = { 'X-Robots-Tag': 'noindex' };
// A sitemap lists full addresses, and it is an invitation.
const sitemapAt = config.searchEngines ? config.publicUrl : null;

const SECURITY_HEADERS = {
  ...(config.searchEngines ? {} : NOT_LISTED),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // The map is the only thing the page loads from elsewhere: MapLibre fetches
  // the style, tiles and fonts (connect-src) and may load icons as images. What
  // it has fetched it turns into images by way of blob: URLs.
  'Content-Security-Policy':
    `default-src 'self'; img-src 'self' data: blob: ${MAP_ORIGINS}; style-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' ${MAP_ORIGINS}; frame-ancestors 'none'`,
};

const gzip = (body) => zlib.gzipSync(body, { level: 6 });

/** @param compress how to gzip the body, for a caller that keeps the result */
function send(req, res, status, type, body, headers = {}, compress = gzip) {
  const head = { ...SECURITY_HEADERS, 'Content-Type': type, ...headers };
  if (COMPRESSIBLE.test(type)) {
    head.Vary = 'Accept-Encoding';
    if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
      body = compress(body);
      head['Content-Encoding'] = 'gzip';
    }
  }
  head['Content-Length'] = body.length;
  res.writeHead(status, head);
  res.end(req.method === 'HEAD' ? undefined : body);
}

function sendJson(req, res, status, value, headers = {}) {
  send(req, res, status, MIME['.json'], Buffer.from(JSON.stringify(value)), { 'Cache-Control': 'no-store', ...NOT_LISTED, ...headers });
}

/** Whether If-None-Match names `etag`: a list of tags, any of them possibly weak (W/"…"), or "*". */
function etagMatches(req, etag) {
  const tags = (req.headers['if-none-match'] ?? '').split(',').map((tag) => tag.trim().replace(/^W\//, ''));
  return tags.includes(etag) || tags.includes('*');
}

// The compressed form of each static file, by path: the map library is over a
// megabyte, too much to compress again for every visitor.
const compressed = new Map();

// The operator's own icons and picture for previews of links, if they have
// put any into a folder for them (BRAND_DIR): looked for once, at the start.
const own = ownFiles(config.brandDir);
if (own.files.size) log(`Own files from ${config.brandDir}: ${[...own.files.keys()].join(', ')}`);

// The page is index.html with what the instance is written into it
// (lib/page.js), in its main language or the one the address asks for. Put
// together once for each and again when the file has changed.
const texts = Object.fromEntries(await Promise.all(LANGUAGE_CODES.map(async (code) => [code, (await import(`../public/locales/${code}.js`)).default])));
const pages = new Map();

function servePage(req, res, url) {
  const file = path.join(config.publicDir, 'index.html');
  const stat = fs.statSync(file);
  const stamp = `${stat.size}-${stat.mtimeMs}`;
  const asked = LANGUAGE_CODES.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : null;
  let page = pages.get(asked);
  if (page?.stamp !== stamp) {
    const language = asked ?? config.language;
    const body = Buffer.from(renderPage(fs.readFileSync(file, 'utf8'), { language, asked, texts: texts[language], siteName: config.siteName, areaName: config.areaName, links: config.links, preview: own.preview, publicUrl: config.publicUrl, listed: config.searchEngines }));
    page = { stamp, body, etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`, packed: null };
    pages.set(asked, page);
  }
  // Always revalidate, as the files are: a deploy shows up immediately.
  const headers = { ETag: page.etag, 'Cache-Control': 'no-cache' };
  if (etagMatches(req, page.etag)) {
    res.writeHead(304, { ...headers, Vary: 'Accept-Encoding' });
    return res.end();
  }
  return send(req, res, 200, MIME['.html'], page.body, headers, (body) => (page.packed ??= gzip(body)));
}

// The manifest of the installed app says what the instance is called, in its
// main language (lib/page.js). Put together once and again when the file has
// changed.
let manifest = null;

function serveManifest(req, res) {
  const file = path.join(config.publicDir, 'manifest.webmanifest');
  const stat = fs.statSync(file);
  const stamp = `${stat.size}-${stat.mtimeMs}`;
  if (manifest?.stamp !== stamp) {
    const body = Buffer.from(renderManifest(fs.readFileSync(file, 'utf8'), { language: config.language, texts: texts[config.language], siteName: config.siteName, areaName: config.areaName }));
    manifest = { stamp, body, etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"` };
  }
  const headers = { ETag: manifest.etag, 'Cache-Control': 'no-cache' };
  if (etagMatches(req, manifest.etag)) {
    res.writeHead(304, { ...headers, Vary: 'Accept-Encoding' });
    return res.end();
  }
  return send(req, res, 200, MIME['.webmanifest'], manifest.body, headers);
}

function serveStatic(req, res, pathname) {
  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  // (a file of the operator's own takes the place of the built-in one of that address)
  const file = own.files.get(relative.slice(1)) ?? path.join(config.publicDir, path.normalize(relative));
  // path.join resolves "..", so anything outside publicDir is a traversal attempt.
  if (!own.files.has(relative.slice(1)) && !file.startsWith(config.publicDir + path.sep)) return sendJson(req, res, 404, { error: 'not found' });
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    stat = null;
  }
  if (!stat?.isFile()) return sendJson(req, res, 404, { error: 'not found' });

  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  // Always revalidate: that is one small request per file and this way a deploy shows up immediately.
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (etagMatches(req, etag)) {
    res.writeHead(304, COMPRESSIBLE.test(type) ? { ...headers, Vary: 'Accept-Encoding' } : headers);
    return res.end();
  }
  send(req, res, 200, type, fs.readFileSync(file), headers, (body) => {
    if (compressed.get(file)?.etag !== etag) compressed.set(file, { etag, body: gzip(body) });
    return compressed.get(file).body;
  });
}

// The vehicles of the whole area are the same for every browser, so compute
// them at most once a second; each request then picks its map section.
let vehicleCache = null;

function vehicles() {
  const now = Math.floor(Date.now() / 1000);
  if (!vehicleCache || vehicleCache.now !== now) {
    const all = timetable.vehicles(now, realtime.snapshot);
    const counts = {};
    for (const v of all) counts[v.mode] = (counts[v.mode] ?? 0) + 1;
    vehicleCache = { now, realtime: realtime.snapshot ? realtime.status.feedTimestamp : null, counts, all };
  }
  return vehicleCache;
}

// What the page searches stops and lines in is the same for every browser and
// only changes with the timetable. It is a quarter of a megabyte even compressed,
// so it is put together and compressed once, and its ETag lets a browser that
// has it keep it.
let searchCache = null;

function searchIndex() {
  if (!searchCache) {
    const body = Buffer.from(JSON.stringify(timetable.searchIndex()));
    searchCache = { body, etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`, packed: null };
  }
  return searchCache;
}

const inBox = (box, lat, lon) => lat >= box[0] && lat <= box[2] && lon >= box[1] && lon <= box[3];

function status() {
  return {
    // What is running (see describeBuild), where it comes from and, if one is
    // known, the newer release: { version, url }.
    version: build.version,
    commit: build.commit,
    homepage,
    update: updates.update,
    now: Math.floor(Date.now() / 1000),
    timetable: {
      ...feed.status,
      feedLastModified: timetable?.source.lastModified ?? null,
      importedAt: timetable?.source.importedAt ?? null,
      trips: timetable?.tripCount ?? 0,
      validFrom: timetable?.dates[0] ?? null,
      validUntil: timetable?.dates.at(-1) ?? null,
    },
    // Route geometry from OpenStreetMap: number of routed hops and age of the OSM data.
    routes: { segments: timetable?.segPts.length ?? 0, osmFetchedAt: timetable?.source.osm ?? null },
    realtime: realtime.status,
    area: { name: config.areaName, bbox: config.area.bbox },
    view: config.view,
  };
}

// What the page needs to know about the area and the map; it does not change
// while the server runs.
const areaInfo = {
  // What the instance calls itself, and the area it shows.
  siteName: config.siteName,
  name: config.areaName,
  bbox: config.area.bbox,
  view: config.view,
  // rings of [lat, lon]
  outline: config.areaOutline.map((ring) => ring.map(([lon, lat]) => [lat, lon])),
  // The zone all times are to be shown in.
  timeZone: config.timeZone,
  // The map behind the vehicles: a MapLibre style or raster tiles, the other is null.
  styleUrl: config.styleUrl,
  tileUrl: config.tileUrl,
  // HTML, set by the operator. A style names its sources itself; map is what to show besides.
  attribution: { map: config.tileAttribution, data: config.dataAttribution },
};
const areaEtag = `"${crypto.createHash('sha1').update(JSON.stringify(areaInfo)).digest('hex').slice(0, 16)}"`;

function handleApi(req, res, url) {
  if (url.pathname === '/api/status') return sendJson(req, res, 200, status());
  if (url.pathname === '/api/area') {
    if (etagMatches(req, areaEtag)) {
      res.writeHead(304, { ETag: areaEtag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' });
      return res.end();
    }
    return sendJson(req, res, 200, areaInfo, { ETag: areaEtag, 'Cache-Control': 'no-cache' });
  }
  // Nothing to answer from yet. The page words its own notice from state and
  // step; the message is for whoever reads the raw answer.
  if (!timetable) return sendJson(req, res, 503, { state: feed.status.state, step: feed.status.step, message: feed.status.message });

  const now = Math.floor(Date.now() / 1000);
  switch (url.pathname) {
    // ?bbox=south,west,north,east limits the answer to a map section;
    // ?detail=lite sends two knots per vehicle instead of its route geometry.
    // Without a map section the answer is always the reduced one: the full
    // geometry of every vehicle is more than any client should ask for.
    case '/api/vehicles': {
      realtime.touch();
      const { now: at, realtime: feedTime, counts, all } = vehicles();
      const box = parseBox(url.searchParams.get('bbox'));
      const reduced = !box || url.searchParams.get('detail') === 'lite';
      const list = [];
      for (const v of all) {
        if (box && !inBox(box, v.lat, v.lon)) continue;
        list.push({ id: v.id, line: v.line, mode: v.mode, to: v.to, delay: v.delay, knots: reduced ? lite(v, at) : v.knots });
      }
      return sendJson(req, res, 200, { now: at, realtime: feedTime, counts, vehicles: list });
    }

    case '/api/stations': {
      const box = parseBox(url.searchParams.get('bbox'));
      return sendJson(req, res, 200, box ? timetable.stations.filter((s) => inBox(box, s.lat, s.lon)) : timetable.stations);
    }

    // All stations and lines at once, for the search of the page, which
    // happens in the browser: what somebody types is nothing the server gets
    // to see.
    case '/api/search': {
      const index = searchIndex();
      const headers = { ETag: index.etag, 'Cache-Control': 'no-cache', ...NOT_LISTED };
      if (etagMatches(req, index.etag)) {
        res.writeHead(304, { ...headers, Vary: 'Accept-Encoding' });
        return res.end();
      }
      return send(req, res, 200, MIME['.json'], index.body, headers, (body) => (index.packed ??= gzip(body)));
    }

    // The vehicles of one line that are under way. A line is named as
    // /api/search lists it: by name, mode and agency together.
    case '/api/line': {
      const line = { name: url.searchParams.get('name') ?? '', mode: url.searchParams.get('mode') ?? '', agency: url.searchParams.get('agency') ?? '' };
      const { now: at, all } = vehicles();
      const found = timetable.lineVehicles(line, all);
      if (!found) return sendJson(req, res, 404, { error: 'line not found' });
      realtime.touch();
      return sendJson(req, res, 200, { now: at, ...found });
    }

    case '/api/trip': {
      // id = <trip_id>_<service day yyyymmdd>, as handed out by /api/vehicles
      // and /api/departures. The trip_id itself may contain underscores.
      const match = /^(.+)_(\d{8})$/.exec(url.searchParams.get('id') ?? '');
      const trip = match && timetable.trip(match[1], match[2], realtime.snapshot);
      if (!trip) return sendJson(req, res, 404, { error: 'trip not found' });
      realtime.touch();
      return sendJson(req, res, 200, { now, ...trip });
    }

    case '/api/departures': {
      const board = timetable.departures(url.searchParams.get('station') ?? '', now, realtime.snapshot);
      if (!board) return sendJson(req, res, 404, { error: 'station not found' });
      realtime.touch();
      return sendJson(req, res, 200, { now, ...board });
    }

    default:
      return sendJson(req, res, 404, { error: 'not found' });
  }
}

const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    if (url.pathname === '/' || url.pathname === '/index.html') return servePage(req, res, url);
    if (url.pathname === '/manifest.webmanifest') return serveManifest(req, res);
    if (url.pathname === '/robots.txt') return send(req, res, 200, MIME['.txt'], Buffer.from(robotsTxt(sitemapAt)), { 'Cache-Control': 'no-cache' });
    if (url.pathname === '/sitemap.xml' && sitemapAt) return send(req, res, 200, MIME['.xml'], Buffer.from(sitemapXml(sitemapAt)), { 'Cache-Control': 'no-cache' });
    return serveStatic(req, res, decodeURIComponent(url.pathname));
  } catch (err) {
    // A URL that cannot be decoded is the client's mistake and not worth a log
    // line: any scanner could fill the log with them.
    const malformed = err instanceof URIError || err.code === 'ERR_INVALID_URL';
    if (!malformed) log(`Error handling ${req.method} ${req.url}: ${err.stack ?? err}`);
    if (!res.headersSent) res.writeHead(malformed ? 400 : 500);
    res.end();
  }
});

server.on('error', (err) => {
  // E.g. the port is taken, or HOST is not an address of this machine.
  console.error(`Cannot listen on ${config.host ? `${config.host}, ` : ''}port ${config.port}: ${err.message}`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  // The port actually bound (PORT=0 lets the system pick one). Listening on
  // all interfaces, localhost is the address to try first.
  const { port } = server.address();
  const host = !config.host ? 'localhost' : config.host.includes(':') ? `[${config.host}]` : config.host;
  log(`Netnou listening on http://${host}:${port}, area ${config.areaName || 'custom area'} (${config.area.bbox.join(',')})`);
  feed.start().catch((err) => {
    log(`Timetable: cannot start: ${err.message}`);
    process.exit(1);
  });
  updates.start();
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
