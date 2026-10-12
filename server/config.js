// Settings, all from environment variables that begin with NETNOU_ and all
// optional. loadConfig() checks them and throws an Error whose message names
// the variable at fault.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_NAME, LANGUAGES } from '../public/i18n.js';
import { Area } from './lib/area.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The languages the page has texts in.
const LANGUAGE_CODES = LANGUAGES.map(([code]) => code);

// The built-in area: the VGN, the transit network around Nürnberg (see
// tools/build-vgn-area.mjs).
const VGN = {
  file: path.join(root, 'server', 'areas', 'vgn.geojson'),
  name: 'Großraum Nürnberg (VGN)',
  // The cities of Nürnberg, Fürth and Erlangen.
  view: [49.376, 10.916, 49.604, 11.204],
  // The VGN spans five Bavarian administrative regions.
  osmUrls: ['mittelfranken', 'oberfranken', 'oberpfalz', 'unterfranken', 'schwaben'].map((r) => `https://download.geofabrik.de/europe/germany/bayern/${r}-latest.osm.pbf`),
};

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// Up to 0.7 the settings had no prefix. These are the names of then that can
// hardly mean anything but a setting of Netnou. PORT, HOST and LANGUAGE are
// not among them: a shell or a platform sets those for reasons of its own.
const ONCE_PLAIN = [
  'DATA_DIR', 'AREA_FILE', 'BBOX', 'AREA_NAME', 'VIEW', 'TIMEZONE', 'MAP_STYLE_URL', 'MAP_ORIGINS', 'TILE_URL', 'TILE_ATTRIBUTION',
  'DATA_ATTRIBUTION', 'OSM_PBF_URLS', 'OSM_MAX_AGE_DAYS', 'FEED_URL', 'FEED_CHECK_MINUTES', 'DOWNLOAD_TIMEOUT_MINUTES', 'REALTIME_URL',
  'REALTIME_INTERVAL_SECONDS', 'REALTIME_IDLE_SECONDS', 'UPDATE_CHECK', 'PUBLIC_URL', 'SEARCH_ENGINES', 'SITE_NAME', 'SITE_TITLE',
  'SITE_DESCRIPTION', 'LINKS', 'BRAND_DIR',
];
// (the two that also came with a language at their end: SITE_TITLE_EN)
const ONCE_PLAIN_BY_LANGUAGE = /^SITE_(TITLE|DESCRIPTION)_[A-Z]+$/;

/**
 * The names without a prefix that are still set and no longer read, for a
 * line each in the log: an instance that was updated without them being
 * renamed would otherwise run with its defaults and say nothing. A name that
 * is set under its new name as well is left out.
 * @param {Record<string, string | undefined>} [env]
 */
export function plainNames(env = process.env) {
  return Object.keys(env).filter((name) => (ONCE_PLAIN.includes(name) || ONCE_PLAIN_BY_LANGUAGE.test(name)) && env[`NETNOU_${name}`] === undefined);
}

/** "south,west,north,east" -> four numbers, or null if the text is anything else. */
export function parseBox(text) {
  const fields = (text ?? '').split(',').map((s) => s.trim());
  return fields.length === 4 && fields.every((s) => DECIMAL.test(s)) ? fields.map(Number) : null;
}

/** An address as NETNOU_PUBLIC_URL may be: http(s), and nothing after the path. With a slash at its end, null if it is none. */
function pageAddress(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.search || url.hash || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/*$/, '/')}`;
  } catch {
    return null;
  }
}

/**
 * The operator's links as NETNOU_LINKS gives them: "Text=address, Text=address".
 * An address is a full http(s) one or a path on the same host ("/imprint").
 * @returns [{ text, href }], or the part that is not understood as { wrong }
 */
function operatorLinks(value) {
  const links = [];
  for (const part of value.split(',').map((item) => item.trim()).filter(Boolean)) {
    const at = part.indexOf('=');
    const text = part.slice(0, Math.max(at, 0)).trim();
    const href = part.slice(at + 1).trim();
    const path = /^\/(?!\/)\S*$/.test(href);
    if (!text || !(path || (isHttpUrl(href) && !/\s/.test(href)))) return { wrong: part };
    links.push({ text, href });
  }
  return links;
}

function isHttpUrl(value) {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

// The map behind the vehicles unless the operator names another one: the
// vector tiles of OpenFreeMap, which need no key and set no limit on requests.
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

/**
 * Origin of a tile URL template for the Content-Security-Policy, or null if
 * the template is not an http(s) URL. {s}, the placeholder for a subdomain,
 * becomes a wildcard:
 * https://{s}.tile.example.org/{z}/{x}/{y}.png -> https://*.tile.example.org
 */
function tileOrigin(template) {
  const wildcard = /^https?:\/\/[^./?#]*\{s\}[^./?#]*\./i.test(template);
  try {
    const url = new URL(wildcard ? template.replace(/^(https?:\/\/)[^.]*\./i, '$1') : template);
    // A placeholder anywhere else in the host name cannot be expressed in the policy.
    if (!/^https?:$/.test(url.protocol) || /[{}]|%7b/i.test(url.host)) return null;
    return `${url.protocol}//${wildcard ? '*.' : ''}${url.host}`;
  } catch {
    return null;
  }
}

/** @param name the setting the file comes from, for the error message */
function readArea(file, name) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`${name}: ${file} cannot be read (${err.code ?? err.message})`, { cause: err });
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`${name}: ${file} is not valid JSON (${err.message})`, { cause: err });
  }
  const isRing = (ring) => Array.isArray(ring) && ring.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (json?.outline !== undefined && !(Array.isArray(json.outline) && json.outline.every(isRing))) {
    throw new Error(`${name}: ${file}: "outline" must be an array of rings of [longitude, latitude]`);
  }
  try {
    return { area: Area.fromGeoJson(json), outline: json?.outline };
  } catch (err) {
    throw new Error(`${name}: ${file}: ${err.message}`, { cause: err });
  }
}

/**
 * Reads the settings from `env`.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  // Except for NETNOU_AREA_NAME and NETNOU_OSM_PBF_URLS an empty value counts as not set.
  const text = (name) => (env[name] ?? '').trim();
  const invalid = (name, expected) => new Error(`${name} must be ${expected} (got "${env[name]}")`);

  /**
   * Words of the operator's own for the page, by its languages: { de, en },
   * each a text on one line or null. There are three ways to give them, and
   * the more particular one wins: `name` as a text is for every language;
   * `name` as a JSON object is for the languages it names, {"de": "…"}; and
   * `name` with a language at its end, NETNOU_SITE_TITLE_EN, is for that one alone.
   */
  function ownWords(name) {
    const oneLine = (words) => words.replace(/\s+/g, ' ').trim() || null;
    const languages = LANGUAGE_CODES.join(', ');
    let forAll = null;
    let byLanguage = {};
    if (text(name).startsWith('{')) {
      const expected = `a text, or texts by language as a JSON object such as {${LANGUAGE_CODES.map((code) => `"${code}": "…"`).join(', ')}}`;
      try {
        byLanguage = JSON.parse(text(name));
      } catch {
        throw invalid(name, expected);
      }
      if (byLanguage === null || Array.isArray(byLanguage) || Object.values(byLanguage).some((words) => typeof words !== 'string')) throw invalid(name, expected);
      // (a language the page does not have is a slip of the pen: better said than passed over)
      const unknown = Object.keys(byLanguage).find((code) => !LANGUAGE_CODES.includes(code));
      if (unknown !== undefined) throw new Error(`${name}: the page has no language "${unknown}"; it has ${languages}`);
    } else {
      forAll = oneLine(text(name));
    }
    const stray = Object.keys(env).find((key) => key.startsWith(`${name}_`) && !LANGUAGE_CODES.includes(key.slice(name.length + 1).toLowerCase()));
    if (stray) throw new Error(`${stray}: the page has no such language; it has ${languages}`);
    return Object.fromEntries(LANGUAGE_CODES.map((code) => [code, oneLine(text(`${name}_${code.toUpperCase()}`)) ?? oneLine(byLanguage[code] ?? '') ?? forAll]));
  }


  function number(name, fallback, min, max, { integer = false } = {}) {
    const raw = text(name);
    const value = raw === '' ? fallback : DECIMAL.test(raw) ? Number(raw) : NaN;
    if (!(value >= min && value <= max) || (integer && !Number.isInteger(value))) {
      throw invalid(name, `a ${integer ? 'whole ' : ''}number from ${min} to ${max}`);
    }
    return value;
  }

  function onOff(name, fallback) {
    const raw = text(name).toLowerCase();
    if (raw !== '' && raw !== 'on' && raw !== 'off') throw invalid(name, '"on" or "off"');
    return raw === '' ? fallback : raw === 'on';
  }

  function box(name) {
    const parts = parseBox(text(name));
    const [south, west, north, east] = parts ?? [];
    if (!parts || south < -90 || north > 90 || west < -180 || east > 180 || south >= north || west >= east) {
      throw invalid(name, '"south,west,north,east" in degrees with south < north and west < east, e.g. 49.30,10.82,49.68,11.30');
    }
    return parts;
  }

  function httpUrl(name, value) {
    if (!isHttpUrl(value)) throw new Error(`${name} must be an http(s) URL (got "${value}")`);
    return value;
  }

  // The area covered: trips serving at least one stop in it are imported, and
  // inside it vehicles follow roads and tracks. Either a GeoJSON file with
  // polygons (NETNOU_AREA_FILE), a rectangle (NETNOU_BBOX), or – by default – the VGN.
  if (text('NETNOU_AREA_FILE') && text('NETNOU_BBOX')) throw new Error('NETNOU_AREA_FILE and NETNOU_BBOX are both set; use only one of them');
  const custom = Boolean(text('NETNOU_AREA_FILE') || text('NETNOU_BBOX'));
  let area;
  let outline;
  if (text('NETNOU_BBOX')) area = Area.fromBbox(box('NETNOU_BBOX'));
  else if (custom) ({ area, outline } = readArea(path.resolve(text('NETNOU_AREA_FILE')), 'NETNOU_AREA_FILE'));
  else ({ area, outline } = readArea(VGN.file, 'built-in area'));

  let timeZone;
  try {
    // The resolved name, so the page gets the usual spelling whatever was typed.
    timeZone = new Intl.DateTimeFormat('en-US', { timeZone: text('NETNOU_TIMEZONE') || 'Europe/Berlin' }).resolvedOptions().timeZone;
  } catch {
    throw invalid('NETNOU_TIMEZONE', 'an IANA time zone name such as Europe/Berlin');
  }

  // The map behind the vehicles: a MapLibre style, which names its tiles, fonts
  // and icons itself (NETNOU_MAP_STYLE_URL), or plain raster tiles (NETNOU_TILE_URL). The
  // page may load from the server of either and from those in NETNOU_MAP_ORIGINS.
  if (text('NETNOU_MAP_STYLE_URL') && text('NETNOU_TILE_URL')) throw new Error('NETNOU_MAP_STYLE_URL and NETNOU_TILE_URL are both set; use only one of them');
  const tileUrl = text('NETNOU_TILE_URL') || null;
  if (tileUrl && (!tileOrigin(tileUrl) || !['{z}', '{x}', '{y}'].every((part) => tileUrl.includes(part)))) {
    throw invalid('NETNOU_TILE_URL', 'an http(s) URL template with {z}, {x} and {y}, e.g. https://tiles.example.org/{z}/{x}/{y}.png');
  }
  const styleUrl = tileUrl ? null : httpUrl('NETNOU_MAP_STYLE_URL', text('NETNOU_MAP_STYLE_URL') || MAP_STYLE_URL);
  const mapOrigins = [
    tileUrl ? tileOrigin(tileUrl) : new URL(styleUrl).origin,
    ...text('NETNOU_MAP_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean).map((url) => new URL(httpUrl('NETNOU_MAP_ORIGINS', url)).origin),
  ];

  // OpenStreetMap extracts (.osm.pbf) that together cover the area; the route
  // geometry between stops is computed from them. A custom area has to name
  // its own; without any, vehicles move in straight lines between stops. An
  // empty NETNOU_OSM_PBF_URLS turns the route geometry off for the VGN as well.
  const language = text('NETNOU_LANGUAGE').toLowerCase() || 'de';
  if (!LANGUAGE_CODES.includes(language)) throw invalid('NETNOU_LANGUAGE', `one of the languages of the page: ${LANGUAGE_CODES.join(', ')}`);
  const publicUrl = text('NETNOU_PUBLIC_URL') ? pageAddress(text('NETNOU_PUBLIC_URL')) : null;
  if (text('NETNOU_PUBLIC_URL') && !publicUrl) throw invalid('NETNOU_PUBLIC_URL', 'the http(s) address of the page, without a query, e.g. https://transit.example.org/');

  const links = operatorLinks(text('NETNOU_LINKS'));
  if (links.wrong !== undefined) {
    throw new Error(`NETNOU_LINKS must be links as "Text=address", separated by commas, each address an http(s) URL or a path that starts with "/" (not understood: "${links.wrong}")`);
  }

  const osmUrls = env.NETNOU_OSM_PBF_URLS === undefined
    ? (custom ? [] : VGN.osmUrls)
    : env.NETNOU_OSM_PBF_URLS.split(',').map((s) => s.trim()).filter(Boolean).map((url) => httpUrl('NETNOU_OSM_PBF_URLS', url));

  return {
    port: number('NETNOU_PORT', 8080, 0, 65535, { integer: true }),
    // Address to listen on; undefined = all interfaces.
    host: text('NETNOU_HOST') || undefined,
    publicDir: path.join(root, 'public'),
    dataDir: path.resolve(text('NETNOU_DATA_DIR') || path.join(root, 'data')),

    area,
    // What the map draws as the edge of the area: rings of [lon, lat]. A GeoJSON
    // file may bring its own as a top-level "outline" member (useful when its
    // polygons are adjacent parts whose inner borders should not show).
    areaOutline: outline ?? area.polygons.flat(),
    // What the instance calls itself, where the page names itself: its
    // heading, its title, the installed app. The credits name the software.
    siteName: text('NETNOU_SITE_NAME') || APP_NAME,
    // What the page is called in the tab of a browser and in the results of a
    // search engine, and what it says about itself there: the operator's own
    // words, as they are, in place of the ones the page has in each of its
    // languages (pageTexts in public/i18n.js). By language, null where the
    // page's own are to stand.
    siteTitle: ownWords('NETNOU_SITE_TITLE'),
    siteDescription: ownWords('NETNOU_SITE_DESCRIPTION'),
    // A folder with the operator's own icons and picture for previews of
    // links, which take the place of the built-in ones (ownFiles in
    // lib/page.js); null if there is to be none.
    brandDir: text('NETNOU_BRAND_DIR') ? path.resolve(text('NETNOU_BRAND_DIR')) : null,
    // Links of the operator's own at the foot of the header card, e.g. to an
    // imprint and a privacy notice: [{ text, href }].
    links,
    // Shown next to the page title.
    areaName: env.NETNOU_AREA_NAME === undefined ? (custom ? '' : VGN.name) : env.NETNOU_AREA_NAME.trim(),
    // Map section on the first visit. Default: all of a custom area.
    view: text('NETNOU_VIEW') ? box('NETNOU_VIEW') : custom ? area.bbox : VGN.view,

    // The zone the times of the feed are in (agency_timezone is not read).
    timeZone,
    // The map: the URL of a style or a template for raster tiles, one of them
    // null, and the origins the page may load it from.
    styleUrl,
    tileUrl,
    mapOrigins: [...new Set(mapOrigins)],
    // Credit for the map (HTML). A style names its sources itself, raster tiles cannot.
    tileAttribution: text('NETNOU_TILE_ATTRIBUTION') || (tileUrl ? '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' : ''),
    // Credit for the timetable and realtime data (HTML).
    dataAttribution: text('NETNOU_DATA_ATTRIBUTION') || '<a href="https://gtfs.de">GTFS.DE</a> / <a href="https://www.delfi.de">DELFI e.V.</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)',

    // Other feeds must follow the conventions of the gtfs.de one in a few
    // places, e.g. how train categories are told apart (routeMode in
    // lib/timetable.js) and rows grouped by trip in stop_times.txt.
    feedUrl: httpUrl('NETNOU_FEED_URL', text('NETNOU_FEED_URL') || 'https://download.gtfs.de/germany/free/latest.zip'),
    feedCheckMs: number('NETNOU_FEED_CHECK_MINUTES', 15, 1, 1440) * 60_000,
    // Limit for one download of the feed or of an OSM extract.
    downloadTimeoutMs: number('NETNOU_DOWNLOAD_TIMEOUT_MINUTES', 30, 1, 1440) * 60_000,

    osmUrls,
    osmMaxAgeMs: number('NETNOU_OSM_MAX_AGE_DAYS', 30, 1, 3650) * 86_400_000,

    realtimeUrl: httpUrl('NETNOU_REALTIME_URL', text('NETNOU_REALTIME_URL') || 'https://realtime.gtfs.de/realtime-free.pb'),
    realtimeIntervalMs: number('NETNOU_REALTIME_INTERVAL_SECONDS', 30, 10, 3600) * 1000,
    // Polling stops this long after the last browser request.
    realtimeIdleMs: number('NETNOU_REALTIME_IDLE_SECONDS', 120, 30, 86400) * 1000,

    // Whether to ask once a day if there is a newer release (lib/update.js).
    updateCheck: onOff('NETNOU_UPDATE_CHECK', true),

    // What the page says about itself before any script runs, for search
    // engines and previews of links (lib/page.js): the language it says it
    // in, and the address under which visitors reach the instance.
    language,
    publicUrl,
    // Whether search engines may list the instance. If nothing is said, one
    // that knows its own address is listed and any other is not: most
    // instances are private or for trying things out, and whoever names the
    // address wants to be found.
    searchEngines: onOff('NETNOU_SEARCH_ENGINES', Boolean(publicUrl)),
  };
}
