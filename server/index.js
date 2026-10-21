import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseAddress, stopPath } from '../public/address.js';
import { readChoice } from '../public/choice.js';
import { t } from '../public/i18n.js';
import { loadConfig, parseBox, parsePlace } from './config.js';
import { Addresses, stopTitle } from './lib/addresses.js';
import { FeedUpdater } from './lib/feed.js';
import { RealtimePoller } from './lib/realtime.js';
import { addressTitle, inlineHashes, LANGUAGE_CODES, languageFor, ownFiles, PAGE_INLINE, pictureSize, renderManifest, renderPage, robotsTxt, securityPolicy, sitemapFiles, titleOf, versionsOfFiles } from './lib/page.js';
import { setTimeZone } from './lib/time.js';
import { sharesFor, thinOut, ZOOM_ALL, ZOOM_MIN } from './lib/thinning.js';
import { LITE_AHEAD_S, MODES, lite } from './lib/timetable.js';
import { describeBuild, githubReleases, UpdateChecker } from './lib/update.js';
import { Visits } from './lib/visits.js';

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

// Visits of the page, reported to the analytics service the operator names, if any (#114).
const visits = config.visits ? new Visits(config.visits, { publicUrl: config.publicUrl, userAgent, log }) : null;

const feed = new FeedUpdater({
  url: config.feedUrl,
  dataDir: config.dataDir,
  area: config.area,
  agencies: config.agencies,
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
    describeArea();
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

// Data is no page for the results of a search engine, and on an instance that
// is not to be found (NETNOU_SEARCH_ENGINES) nothing is. It may be read all the same:
// a search engine that runs the page asks for data as a browser does, and one
// that may not read an answer never sees that it is asked not to list it.
const NOT_LISTED = { 'X-Robots-Tag': 'noindex' };
// A sitemap lists full addresses, and it is an invitation.
const sitemapAt = config.searchEngines ? config.publicUrl : null;

const SECURITY_HEADERS = {
  ...(config.searchEngines ? {} : NOT_LISTED),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': securityPolicy(config),
};

const gzip = (body) => zlib.gzipSync(body, { level: 6 });
// Brotli at its best: a sixth smaller than gzip for the scripts of the page,
// but most of a second of work for each half of the map library. So it is
// for what is kept once it is compressed, and it is made beside the requests.
const brotli = (body, done) => zlib.brotliCompress(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }, done);

/**
 * Whether a browser takes a content coding, by its Accept-Encoding ("gzip,
 * deflate, br"): named with a weight above 0, or not named where "*" is
 * (RFC 9110, 12.5.3). A weight of 0 says that it is not to be used.
 */
function takes(accepted, coding) {
  let weight = null;
  let others = 0;
  for (const part of accepted.split(',')) {
    const match = /^\s*([\w*-]+)\s*(?:;\s*q\s*=\s*([01](?:\.\d{0,3})?))?\s*$/i.exec(part);
    if (!match) continue;
    // (x-gzip is an old name of gzip)
    const name = match[1].toLowerCase().replace(/^x-gzip$/, 'gzip');
    if (name === coding) weight = Number(match[2] ?? 1);
    else if (name === '*') others = Number(match[2] ?? 1);
  }
  return (weight ?? others) > 0;
}

/**
 * A body that is sent again and again, with its compressed forms, each made
 * once: gzip when it is first asked for, Brotli from then on beside the
 * requests. Until that is there, a browser that takes Brotli gets gzip.
 */
function keep(body) {
  let gzipped = null;
  let smallest = null; // with Brotli; false while it is being made, and for good if that fails
  return {
    body,
    /** The smallest form a browser takes that accepts these encodings: [encoding, body]. */
    pick(accepted) {
      if (takes(accepted, 'br')) {
        if (smallest) return ['br', smallest];
        if (smallest === null) {
          smallest = false;
          brotli(body, (err, packed) => {
            if (!err) smallest = packed;
          });
        }
      }
      if (takes(accepted, 'gzip')) return ['gzip', (gzipped ??= gzip(body))];
      return [null, body];
    },
  };
}

/** What an answer that may be compressed depends on: the encodings the browser takes, besides what its headers name already. */
const varies = (headers) => (headers.Vary ? `${headers.Vary}, Accept-Encoding` : 'Accept-Encoding');

/** @param kept the body as keep() has it, for a caller that sends the same again; else it is compressed for this answer alone, with gzip */
function send(req, res, status, type, body, headers = {}, kept = null) {
  const head = { ...SECURITY_HEADERS, 'Content-Type': type, ...headers };
  if (COMPRESSIBLE.test(type)) {
    head.Vary = varies(headers);
    if (body.length > 1024) {
      const accepted = req.headers['accept-encoding'] ?? '';
      let encoding = null;
      if (kept) [encoding, body] = kept.pick(accepted);
      else if (takes(accepted, 'gzip')) [encoding, body] = ['gzip', gzip(body)];
      if (encoding) head['Content-Encoding'] = encoding;
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

// Each static file with its compressed forms, by path: the map library is
// over a megabyte, too much to compress again for every visitor.
const compressed = new Map();

// The operator's own icons and picture for previews of links, if they have
// put any into a folder for them (NETNOU_BRAND_DIR): looked for once, at the start.
const own = ownFiles(config.brandDir);
const previewSize = own.preview ? pictureSize(own.files.get(own.preview)) : null;
if (own.files.size) log(`Own files from ${config.brandDir}: ${[...own.files.keys()].join(', ')}`);
// (and the version of each, by which the page names them: a changed icon has a new address)
const fileVersions = versionsOfFiles(own, config.publicDir);

// The page is index.html with what the instance is written into it
// (lib/page.js), in the language the address asks for, else in the one the
// browser asks for, else in the main language of the instance. Put together
// once for each and again when the file has changed.
const texts = Object.fromEntries(await Promise.all(LANGUAGE_CODES.map(async (code) => [code, (await import(`../public/locales/${code}.js`)).default])));
const pages = new Map();

// The style sheets and the first script of the page come within it
// (PAGE_INLINE in lib/page.js), and the Content-Security-Policy of the page
// allows them by their hashes: read again when one of them has changed.
let inlined = null;
function pageInline() {
  const files = PAGE_INLINE.map((file) => path.join(config.publicDir, file));
  const stamp = files.map((file) => {
    const stat = fs.statSync(file);
    return `${stat.size}-${stat.mtimeMs}`;
  }).join();
  if (inlined?.stamp !== stamp) {
    const inline = new Map(PAGE_INLINE.map((file, i) => [file, fs.readFileSync(files[i], 'utf8')]));
    inlined = { stamp, inline, headers: { 'Content-Security-Policy': securityPolicy(config, inlineHashes(inline)) } };
  }
  return inlined;
}

/** The language a page is sent in: the one its address asks for (`asked`), else the browser's, else the main one of the instance. */
function pageLanguage(req, url) {
  const asked = LANGUAGE_CODES.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : null;
  // (the header is read for this one answer and kept nowhere)
  return { asked, language: asked ?? languageFor(req.headers['accept-language'], config.language) };
}

/** index.html as it is sent (renderPage), in a language: the page itself, or at the address of a stop or a line. */
function pageBody(language, asked, address = null) {
  const file = path.join(config.publicDir, 'index.html');
  return Buffer.from(renderPage(fs.readFileSync(file, 'utf8'), { language, asked, texts: texts[language], siteName: config.siteName, areaName: config.areaName, siteTitle: config.siteTitle[language], siteDescription: config.siteDescription[language], links: config.links, preview: own.preview, previewSize, publicUrl: config.publicUrl, listed: config.searchEngines, styleUrl: config.styleUrl, mapOrigins: config.mapOrigins, kinds: timetable?.kinds ?? null, address, inline: pageInline().inline, fileVersions }));
}

const etagOf = (body) => `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;

function servePage(req, res, url) {
  const file = path.join(config.publicDir, 'index.html');
  const stat = fs.statSync(file);
  // (the page has a chip for each kind of transport the timetable has: another timetable may need another page)
  const stamp = `${stat.size}-${stat.mtimeMs}-${pageInline().stamp}-${timetable?.kinds.join() ?? ''}`;
  const { asked, language } = pageLanguage(req, url);
  // (the page of an address with a language names that address as its own: not the same page)
  const key = asked ? `?lang=${asked}` : language;
  let page = pages.get(key);
  if (page?.stamp !== stamp) {
    const body = pageBody(language, asked);
    page = { stamp, body, etag: etagOf(body), packed: null };
    pages.set(key, page);
  }
  // Always revalidate, as the files are: a deploy shows up immediately. Where
  // the address names no language, the same address has an answer for each:
  // whoever keeps answers is told to keep them apart by the browser's languages.
  const headers = { ETag: page.etag, 'Cache-Control': 'no-cache', ...(asked ? {} : { Vary: 'Accept-Language' }), ...pageInline().headers };
  // (a visit whether the page is sent or "not modified")
  visits?.seen(req, res, { pathname: url.pathname, query: url.searchParams, title: (page.title ??= titleOf(page.body.toString())) });
  if (etagMatches(req, page.etag)) {
    res.writeHead(304, { ...headers, Vary: varies(headers) });
    return res.end();
  }
  return send(req, res, 200, MIME['.html'], page.body, headers, (page.packed ??= keep(page.body)));
}

// What the addresses of stops, lines (#37) and trips (#178) name, in the
// timetable of the moment: looked up again in each new one.
let addresses = null;
const addressesNow = () => (addresses?.timetable === timetable ? addresses : (addresses = new Addresses(timetable)));

/**
 * What an address of a stop, a line or a trip names in the timetable
 * (lib/addresses.js), or null: { type, found, path }, with the number of the
 * station or line, or the run of the trip ({ trip, date }), and its address
 * now.
 */
function addressed(asked) {
  const named = parseAddress(asked.toLowerCase());
  if (!named || !timetable) return null;
  if (named.type === 'trip') {
    const run = addressesNow().trip(named);
    return run && { type: 'trip', found: run, path: addressesNow().tripPath(run.trip, run.date) };
  }
  const found = named.type === 'stop' ? addressesNow().station(named) : addressesNow().line(named);
  if (found < 0) return null;
  return { type: named.type, found, path: named.type === 'stop' ? addressesNow().stationPath(found) : addressesNow().linePath(found) };
}

/**
 * A stop or a line that the page opens, which it marks in its first request
 * for it (?open=1): a visit of its address (#158), with the title its page
 * has in the language the browser asks for.
 * @param path the address, as addressed() has it
 * @param titled (language, texts) => the title of what it names (lib/addresses.js)
 */
function visitOpened(req, res, url, path, titled) {
  if (!visits || url.searchParams.get('open') !== '1') return;
  const language = languageFor(req.headers['accept-language'], config.language);
  visits.opened(req, res, { pathname: `/${path}`, title: addressTitle(titled(language, texts[language]), config.siteName) });
}

/**
 * The page at the address of a stop or a line (#37), with what it names
 * written into it for search engines and previews. An address that names
 * it otherwise than its own does now (the stop has moved a little, or has
 * another name) sends the browser on to that one; one that names nothing is
 * the page saying so, with 404. Without a timetable that cannot be told
 * yet: the page is sent as it is, and asks again when there is one.
 */
function serveAddress(req, res, url) {
  const asked = decodeURIComponent(url.pathname.slice(1));
  // (the page's own files are as many steps up as the address is deep)
  const address = { path: asked, depth: asked.split('/').length - 1 };
  const { asked: askedLanguage, language } = pageLanguage(req, url);
  const words = texts[language];
  let status = 200;
  if (timetable) {
    const named = addressed(asked);
    if (!named) {
      address.gone = t(asked.startsWith('line/') ? 'address.lineGone' : asked.startsWith('trip/') ? 'address.tripGone' : 'address.stopGone', {}, words);
      status = 404;
    } else if (named.path !== asked) {
      res.writeHead(301, { ...SECURITY_HEADERS, Location: `${'../'.repeat(address.depth)}${named.path}${url.search}`, 'Cache-Control': 'no-cache' });
      return res.end();
    } else {
      const { found } = named;
      Object.assign(address, named.type === 'stop' ? addressesNow().stationWords(found, language, words) : named.type === 'line' ? addressesNow().lineWords(found, language, words) : addressesNow().tripWords(found.trip, found.date, language, words));
    }
  }
  const body = pageBody(language, askedLanguage, address);
  const etag = etagOf(body);
  // (a trip lives for its day: not for search engines either)
  const headers = { ETag: etag, 'Cache-Control': 'no-cache', ...(askedLanguage ? {} : { Vary: 'Accept-Language' }), ...(status === 200 && !address.unlisted ? {} : NOT_LISTED), ...pageInline().headers };
  // (the page of a stop, a line, or of one no longer in the timetable is a visit as the page is)
  visits?.seen(req, res, { pathname: url.pathname, query: url.searchParams, title: titleOf(body.toString()) });
  if (status === 200 && etagMatches(req, etag)) {
    res.writeHead(304, { ...headers, Vary: varies(headers) });
    return res.end();
  }
  return send(req, res, status, MIME['.html'], body, headers);
}

/**
 * A path as it is answered (#198): without a slash twice in a row, and the
 * address of a stop, a line or a trip without one at its end. One in
 * another form is sent on to this one (moved).
 */
function cleanPath(pathname) {
  const clean = pathname.replace(/\/{2,}/g, '/');
  return /^\/(stop|line|trip)\/./i.test(clean) ? clean.replace(/\/$/, '') : clean;
}

/**
 * Sends the browser on (301) from the path it asked for to another, given
 * from where the instance is, by an address from where the browser is: an
 * instance may be at a path of its own behind a proxy.
 */
function moved(res, from, to) {
  res.writeHead(301, { ...SECURITY_HEADERS, Location: `${'../'.repeat(from.split('/').length - 2)}${to.slice(1)}`, 'Cache-Control': 'no-cache' });
  res.end();
}

/** Whether a request is a browser's for a page: it takes HTML, which a script, a picture or a style sheet does not. */
const asksForPage = (req) => /\btext\/html\b/.test(req.headers.accept ?? '');

/**
 * The page at an address that names nothing, for a browser that asks for a
 * page there (#198): with 404, and what the page says at it (addressGone in
 * app.js), as at the address of a stop that is not in the timetable. Not a
 * visit of the page: such paths are tried by scanners above all.
 */
function serveMissing(req, res, url) {
  const { asked: askedLanguage, language } = pageLanguage(req, url);
  // (the page's own files are as many steps up as the browser sees the path deep: "%2F" is no step)
  const address = { path: url.pathname.slice(1), depth: url.pathname.split('/').length - 2, gone: t('address.gone', {}, texts[language]) };
  // (a script that asks for the same address gets JSON: whoever keeps answers is told to keep them apart)
  const headers = { 'Cache-Control': 'no-cache', Vary: askedLanguage ? 'Accept' : 'Accept, Accept-Language', ...NOT_LISTED, ...pageInline().headers };
  return send(req, res, 404, MIME['.html'], pageBody(language, askedLanguage, address), headers);
}

// The sitemap with the addresses of the stops and lines of the timetable
// (lib/page.js): all its files put together at once for each timetable, and
// kept as they are sent, without the addresses (which would take 65 MB in
// all of Germany, the files take 25 MB).
let sitemaps = { of: undefined, files: [] };

function serveSitemap(req, res, part) {
  if (sitemaps.of !== timetable) sitemaps = { of: timetable, files: sitemapFiles(sitemapAt, timetable ? addressesNow().paths() : []).map((xml) => keep(Buffer.from(xml))) };
  const kept = sitemaps.files[part];
  if (!kept) return send(req, res, 404, MIME['.txt'], Buffer.from('not found\n'), { 'Cache-Control': 'no-cache' });
  return send(req, res, 200, MIME['.xml'], kept.body, { 'Cache-Control': 'no-cache' }, kept);
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
    const body = Buffer.from(renderManifest(fs.readFileSync(file, 'utf8'), { language: config.language, texts: texts[config.language], siteName: config.siteName, areaName: config.areaName, siteDescription: config.siteDescription[config.language], fileVersions }));
    manifest = { stamp, body, etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"` };
  }
  const headers = { ETag: manifest.etag, 'Cache-Control': 'no-cache' };
  if (etagMatches(req, manifest.etag)) {
    res.writeHead(304, { ...headers, Vary: 'Accept-Encoding' });
    return res.end();
  }
  return send(req, res, 200, MIME['.webmanifest'], manifest.body, headers);
}

/** @param url the address asked for, where a browser that asks for a page gets one if there is no file (serveMissing) */
function serveStatic(req, res, pathname, url = null) {
  const missing = () => (url && asksForPage(req) ? serveMissing(req, res, url) : sendJson(req, res, 404, { error: 'not found' }));
  const relative = pathname.endsWith('/') ? `${pathname}index.html` : pathname;
  // (a file of the operator's own takes the place of the built-in one of that address)
  const file = own.files.get(relative.slice(1)) ?? path.join(config.publicDir, path.normalize(relative));
  // path.join resolves "..", so anything outside publicDir is a traversal attempt.
  if (!own.files.has(relative.slice(1)) && !file.startsWith(config.publicDir + path.sep)) return missing();
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    stat = null;
  }
  if (!stat?.isFile()) return missing();

  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const etag = `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;
  // Always revalidate: that is one small request per file and this way a deploy shows up immediately.
  const headers = { ETag: etag, 'Cache-Control': 'no-cache' };
  if (etagMatches(req, etag)) {
    res.writeHead(304, COMPRESSIBLE.test(type) ? { ...headers, Vary: 'Accept-Encoding' } : headers);
    return res.end();
  }
  if (!COMPRESSIBLE.test(type)) return send(req, res, 200, type, fs.readFileSync(file), headers);
  if (compressed.get(file)?.etag !== etag) compressed.set(file, { etag, kept: keep(fs.readFileSync(file)) });
  const { kept } = compressed.get(file);
  return send(req, res, 200, type, kept.body, headers, kept);
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
    vehicleCache = { now, realtime: realtime.snapshot ? realtime.status.feedTimestamp : null, counts, all, thinned: new Map() };
  }
  return vehicleCache;
}

// Where a screen cannot take every vehicle, a zoomed-out map shows a share of
// them (lib/thinning.js). The shares follow the number of vehicles under way
// and are worked out again after this many seconds, for each choice of kinds
// that a map shows.
const SHARES_S = 60;
let shareCache = { timetable: null, byKinds: new Map() };

/**
 * Which of the vehicles of this second an answer for a map at this zoom
 * holds: { shown, shares } as thinOut gives it, or null where nothing is left
 * out. Worked out once for each quarter of a zoom.
 * @param counted for each of MODES whether the map shows it
 */
function thinned(zoom, counted) {
  const cache = vehicles();
  if (shareCache.timetable !== timetable) shareCache = { timetable, byKinds: new Map() };
  const kinds = counted.reduce((bits, is, k) => bits | (is << k), 0);
  let known = shareCache.byKinds.get(kinds);
  const age = known ? cache.now - known.at : Infinity;
  if (age < 0 || age >= SHARES_S) shareCache.byKinds.set(kinds, (known = { at: cache.now, shares: sharesFor(cache.all, counted) }));
  const quarter = Math.floor(Math.min(ZOOM_ALL, Math.max(ZOOM_MIN, zoom)) * 4) / 4;
  const key = `${kinds}/${quarter}`;
  if (!cache.thinned.has(key)) cache.thinned.set(key, thinOut(cache.all, quarter, known.shares));
  return cache.thinned.get(key);
}

// What the page searches stops and lines in is the same for every browser and
// only changes with the timetable. Even compressed it is megabytes for a
// whole country, so it is put together and compressed once, and its ETag lets
// a browser that has it keep it. With it comes what finds the station that
// the list has at a place: the list has no ids.
let searchCache = null;

function searchList() {
  if (!searchCache) {
    const { list, stationAt } = timetable.searchList();
    const body = Buffer.from(JSON.stringify(list));
    searchCache = { body, etag: `"${crypto.createHash('sha1').update(body).digest('hex').slice(0, 16)}"`, packed: null, stationAt };
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
    routes: { segments: timetable?.segmentCount ?? 0, osmFetchedAt: timetable?.source.osm ?? null },
    realtime: realtime.status,
    // What the instance covers: its area, or without one (Germany) the
    // rectangle around its stops, null until a timetable is loaded; its
    // operators, null for all.
    area: { name: config.areaName, bbox: areaInfo?.bbox ?? null, agencies: config.agencies?.map(({ name }) => name) ?? null },
    view: config.view,
  };
}

// What the page needs to know about the area and the map. With an area it
// does not change while the server runs. Without one (Germany), what the
// instance covers is its extent, the rectangle around its stops: known once a
// timetable is loaded, null until then, and new with every timetable.
let areaInfo = null;
let areaEtag = null;

function describeArea() {
  const bbox = config.area?.bbox ?? timetable?.bbox ?? null;
  areaInfo = bbox && {
    // What the instance calls itself, and the area it shows.
    siteName: config.siteName,
    name: config.areaName,
    // The operator's own title and description of the page, by language: null
    // for a language they have none in, and the page then words its own.
    siteTitle: config.siteTitle,
    siteDescription: config.siteDescription,
    bbox,
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
  areaEtag = `"${crypto.createHash('sha1').update(JSON.stringify(areaInfo)).digest('hex').slice(0, 16)}"`;
}
describeArea();

function handleApi(req, res, url) {
  if (url.pathname === '/api/status') return sendJson(req, res, 200, status());
  if (url.pathname === '/api/area' && areaInfo) {
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
    // ?detail=lite sends two knots per vehicle instead of its route geometry,
    // and ?detail=minimal less still: what a map needs for a dot for each.
    // Without a map section the answer is always a reduced one: the full
    // geometry of every vehicle is more than any client should ask for.
    //
    // ?zoom= is the zoom of the map the answer is for. Where a screen at that
    // zoom cannot take every vehicle, the answer is thinned out
    // (lib/thinning.js) and says of which kinds it holds what share. Without
    // a zoom nothing is left out.
    // ?modes=bus,tram,… are the kinds of transport a map shows: the answer
    // has no others, and where it is thinned out they take no room.
    // A line (?line=, &mode=, &agency= as /api/line takes them) and a vehicle
    // (?vehicle=<id>) are in the answer whatever is left out: what a visitor
    // has picked stays on the map.
    case '/api/vehicles': {
      realtime.touch();
      const { now: at, realtime: feedTime, counts, all } = vehicles();
      const box = parseBox(url.searchParams.get('bbox'));
      const detail = url.searchParams.get('detail');
      const reduced = !box || detail === 'lite' || detail === 'minimal';
      const zoom = url.searchParams.get('zoom') ?? '';
      const only = url.searchParams.get('modes')?.split(',');
      const counted = MODES.map((mode) => !only || only.includes(mode));
      const wanted = new Set(MODES.filter((mode, k) => counted[k]));
      const thin = /^\d+(\.\d+)?$/.test(zoom) ? thinned(Number(zoom), counted) : null;
      const line = url.searchParams.has('line') ? timetable.lineNumber({ name: url.searchParams.get('line'), mode: url.searchParams.get('mode') ?? '', agency: url.searchParams.get('agency') ?? '' }, parsePlace(url.searchParams.get('at'))) : undefined;
      const picked = /^(.+)_(\d{8})$/.exec(url.searchParams.get('vehicle') ?? '');
      const pickedTrip = picked ? timetable.tripIndex.get(picked[1]) : undefined;
      const list = [];
      for (let i = 0; i < all.length; i++) {
        const v = all[i];
        if (box && !inBox(box, v.lat, v.lon)) continue;
        const left = !wanted.has(v.mode) || (thin && !thin.shown[i]);
        if (left && v.lineIndex !== line && !(pickedTrip !== undefined && v.is(pickedTrip, picked[2]))) continue;
        list.push(v);
      }
      // (kinds: those the timetable has, for which the page shows chips)
      const head = { now: at, realtime: feedTime, counts, thinned: thin?.shares ?? {}, kinds: timetable.kinds };
      // The smallest form: a column for each property of all vehicles, and
      // where each is now and how far it gets in LITE_AHEAD_S, as whole
      // numbers of 1e-5 degrees. Not where it goes, which a dot does not say.
      // About half of what an object for each comes to.
      if (detail === 'minimal') {
        const where = [];
        for (const v of list) {
          const [, lat, lon, , aheadLat, aheadLon] = lite(v, at);
          const [iLat, iLon] = [Math.round(lat * 1e5), Math.round(lon * 1e5)];
          where.push(iLat, iLon, Math.round(aheadLat * 1e5) - iLat, Math.round(aheadLon * 1e5) - iLon);
        }
        return sendJson(req, res, 200, {
          ...head,
          ahead: LITE_AHEAD_S,
          vehicles: { id: list.map((v) => v.id), line: list.map((v) => v.line), mode: list.map((v) => v.mode), delay: list.map((v) => v.delay), unit: list.map((v) => v.unit ?? null), at: where },
        });
      }
      // (unit: only there for trains that run coupled, and then the same for each of them)
      return sendJson(req, res, 200, { ...head, vehicles: list.map((v) => ({ id: v.id, line: v.line, mode: v.mode, to: v.to, delay: v.delay, unit: v.unit, knots: reduced ? lite(v, at) : v.knots })) });
    }

    case '/api/stations': {
      const box = parseBox(url.searchParams.get('bbox'));
      return sendJson(req, res, 200, box ? timetable.stations.filter((s) => inBox(box, s.lat, s.lon)) : timetable.stations);
    }

    // All stations and lines at once, for the search of the page, which
    // happens in the browser: what somebody types is nothing the server gets
    // to see.
    case '/api/search': {
      const list = searchList();
      const headers = { ETag: list.etag, 'Cache-Control': 'no-cache', ...NOT_LISTED };
      if (etagMatches(req, list.etag)) {
        res.writeHead(304, { ...headers, Vary: 'Accept-Encoding' });
        return res.end();
      }
      return send(req, res, 200, MIME['.json'], list.body, headers, (list.packed ??= keep(list.body)));
    }

    // The vehicles of one line that are under way. A line is named as
    // /api/search lists it: by name, mode and agency together.
    case '/api/line': {
      // (of the lines of a name in places apart, the one at the place asked for, #152)
      const line = { name: url.searchParams.get('name') ?? '', mode: url.searchParams.get('mode') ?? '', agency: url.searchParams.get('agency') ?? '' };
      const index = timetable.lineNumber(line, parsePlace(url.searchParams.get('at')));
      if (index === undefined) return sendJson(req, res, 404, { error: 'line not found' });
      const { now: at, all } = vehicles();
      realtime.touch();
      // (where it runs, asked for once: when the page opens the line, #148)
      const route = url.searchParams.get('route') === '1' ? { route: timetable.lineRoute(index, at) } : {};
      const path = addressesNow().linePath(index);
      visitOpened(req, res, url, path, (language, words) => addressesNow().lineWords(index, language, words).title);
      return sendJson(req, res, 200, { now: at, ...timetable.lineVehicles(index, all), path, ...route });
    }

    case '/api/trip': {
      // id = <trip_id>_<service day yyyymmdd>, as handed out by /api/vehicles
      // and /api/departures. The trip_id itself may contain underscores.
      const match = /^(.+)_(\d{8})$/.exec(url.searchParams.get('id') ?? '');
      const trip = match && timetable.trip(match[1], match[2], realtime.snapshot);
      if (!trip) return sendJson(req, res, 404, { error: 'trip not found' });
      realtime.touch();
      // (its address, #178, and the visit of it where the page opens it)
      const number = timetable.tripIndex.get(match[1]);
      const address = addressesNow().tripPath(number, match[2]);
      visitOpened(req, res, url, address, (language, words) => addressesNow().tripWords(number, match[2], language, words).title);
      return sendJson(req, res, 200, { now, ...trip, address });
    }

    case '/api/address': {
      // What the address of a stop, a line or a trip names now (#37, #178), for the page at it.
      const named = addressed(url.searchParams.get('path') ?? '');
      if (!named) return sendJson(req, res, 404, { error: 'not found' });
      if (named.type === 'trip') {
        const { trip, date } = named.found;
        return sendJson(req, res, 200, { type: 'trip', id: `${timetable.tripId(trip)}_${date}`, path: named.path });
      }
      if (named.type === 'stop') {
        const { name, lat, lon } = timetable.stations[named.found];
        return sendJson(req, res, 200, { type: 'stop', name, lat, lon, path: named.path });
      }
      const { name, mode, agency, place } = timetable.lines[named.found];
      return sendJson(req, res, 200, { type: 'line', name, mode, agency, at: place, path: named.path });
    }

    case '/api/departures': {
      // A station is named by its id, or by its place as /api/search lists it.
      const at = parsePlace(url.searchParams.get('at'));
      const station = at ? searchList().stationAt(...at) : url.searchParams.get('station');
      // (only the lines and directions chosen, where some are: public/choice.js, #164)
      const board = timetable.departures(station ?? '', now, realtime.snapshot, { lines: readChoice(url.searchParams.get('lines')) });
      if (!board) return sendJson(req, res, 404, { error: 'station not found' });
      realtime.touch();
      // (its address as the page writes it into its own: by the name and the place of the station)
      visitOpened(req, res, url, stopPath(board.name, board.lat, board.lon), (language, words) => stopTitle(board.name, words));
      // (and what there is to choose from, where the page asks for it: once, as it does not change with the minute)
      const directions = url.searchParams.get('directions') === '1' ? { directions: timetable.directions(board.id) } : {};
      return sendJson(req, res, 200, { now, ...board, ...directions });
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
    // (a path that begins with "//" is a path too, not the name of a host; any path is answered in its clean form)
    const url = new URL(req.url.startsWith('/') ? `http://localhost${req.url}` : req.url, 'http://localhost');
    const clean = cleanPath(url.pathname);
    if (clean !== url.pathname) return moved(res, url.pathname, `${clean}${url.search}`);
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    if (url.pathname === '/' || url.pathname === '/index.html') return servePage(req, res, url);
    if (url.pathname === '/manifest.webmanifest') return serveManifest(req, res);
    // Where a page names no icon, browsers and search engines ask for this
    // one, and Google's asks for it also where the page does: the icon of
    // the app, own or built-in, a PNG as a favicon may be.
    if (url.pathname === '/favicon.ico') return serveStatic(req, res, '/icons/icon-192.png');
    if (url.pathname === '/robots.txt') return send(req, res, 200, MIME['.txt'], Buffer.from(robotsTxt(sitemapAt)), { 'Cache-Control': 'no-cache' });
    const sitemap = /^\/sitemap(?:-(\d{1,4}))?\.xml$/.exec(url.pathname);
    if (sitemap && sitemapAt) return serveSitemap(req, res, Number(sitemap[1] ?? 0));
    // (in capitals as well: the address is looked up in small letters, and sent on to its own)
    if (/^\/(stop|line|trip)\//i.test(url.pathname)) return serveAddress(req, res, url);
    return serveStatic(req, res, decodeURIComponent(url.pathname), url);
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
  // E.g. the port is taken, or NETNOU_HOST is not an address of this machine.
  console.error(`Cannot listen on ${config.host ? `${config.host}, ` : ''}port ${config.port}: ${err.message}`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  // The port actually bound (NETNOU_PORT=0 lets the system pick one). Listening on
  // all interfaces, localhost is the address to try first.
  const { port } = server.address();
  const host = !config.host ? 'localhost' : config.host.includes(':') ? `[${config.host}]` : config.host;
  log(`Netnou listening on http://${host}:${port}, ${config.area ? `area ${config.areaName || 'custom area'} (${config.area.bbox.join(',')})` : `the whole feed${config.areaName ? ` (${config.areaName})` : ''}`}${config.agencies ? `, operators: ${config.agencies.map(({ name }) => name).join(', ')}` : ''}`);
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
