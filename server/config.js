// Settings, all from environment variables and all optional. loadConfig()
// checks them and throws an Error whose message names the variable at fault.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES } from '../public/i18n.js';
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

/** "south,west,north,east" -> four numbers, or null if the text is anything else. */
export function parseBox(text) {
  const fields = (text ?? '').split(',').map((s) => s.trim());
  return fields.length === 4 && fields.every((s) => DECIMAL.test(s)) ? fields.map(Number) : null;
}

/** An address as PUBLIC_URL may be: http(s), and nothing after the path. With a slash at its end, null if it is none. */
function pageAddress(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.search || url.hash || url.username || url.password) return null;
    return `${url.origin}${url.pathname.replace(/\/*$/, '/')}`;
  } catch {
    return null;
  }
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
  // Except for AREA_NAME and OSM_PBF_URLS an empty value counts as not set.
  const text = (name) => (env[name] ?? '').trim();
  const invalid = (name, expected) => new Error(`${name} must be ${expected} (got "${env[name]}")`);

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
  // polygons (AREA_FILE), a rectangle (BBOX), or – by default – the VGN.
  if (text('AREA_FILE') && text('BBOX')) throw new Error('AREA_FILE and BBOX are both set; use only one of them');
  const custom = Boolean(text('AREA_FILE') || text('BBOX'));
  let area;
  let outline;
  if (text('BBOX')) area = Area.fromBbox(box('BBOX'));
  else if (custom) ({ area, outline } = readArea(path.resolve(text('AREA_FILE')), 'AREA_FILE'));
  else ({ area, outline } = readArea(VGN.file, 'built-in area'));

  let timeZone;
  try {
    // The resolved name, so the page gets the usual spelling whatever was typed.
    timeZone = new Intl.DateTimeFormat('en-US', { timeZone: text('TIMEZONE') || 'Europe/Berlin' }).resolvedOptions().timeZone;
  } catch {
    throw invalid('TIMEZONE', 'an IANA time zone name such as Europe/Berlin');
  }

  // The map behind the vehicles: a MapLibre style, which names its tiles, fonts
  // and icons itself (MAP_STYLE_URL), or plain raster tiles (TILE_URL). The
  // page may load from the server of either and from those in MAP_ORIGINS.
  if (text('MAP_STYLE_URL') && text('TILE_URL')) throw new Error('MAP_STYLE_URL and TILE_URL are both set; use only one of them');
  const tileUrl = text('TILE_URL') || null;
  if (tileUrl && (!tileOrigin(tileUrl) || !['{z}', '{x}', '{y}'].every((part) => tileUrl.includes(part)))) {
    throw invalid('TILE_URL', 'an http(s) URL template with {z}, {x} and {y}, e.g. https://tiles.example.org/{z}/{x}/{y}.png');
  }
  const styleUrl = tileUrl ? null : httpUrl('MAP_STYLE_URL', text('MAP_STYLE_URL') || MAP_STYLE_URL);
  const mapOrigins = [
    tileUrl ? tileOrigin(tileUrl) : new URL(styleUrl).origin,
    ...text('MAP_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean).map((url) => new URL(httpUrl('MAP_ORIGINS', url)).origin),
  ];

  // OpenStreetMap extracts (.osm.pbf) that together cover the area; the route
  // geometry between stops is computed from them. A custom area has to name
  // its own; without any, vehicles move in straight lines between stops. An
  // empty OSM_PBF_URLS turns the route geometry off for the VGN as well.
  const language = text('LANGUAGE').toLowerCase() || 'de';
  if (!LANGUAGE_CODES.includes(language)) throw invalid('LANGUAGE', `one of the languages of the page: ${LANGUAGE_CODES.join(', ')}`);
  const publicUrl = text('PUBLIC_URL') ? pageAddress(text('PUBLIC_URL')) : null;
  if (text('PUBLIC_URL') && !publicUrl) throw invalid('PUBLIC_URL', 'the http(s) address of the page, without a query, e.g. https://transit.example.org/');

  const osmUrls = env.OSM_PBF_URLS === undefined
    ? (custom ? [] : VGN.osmUrls)
    : env.OSM_PBF_URLS.split(',').map((s) => s.trim()).filter(Boolean).map((url) => httpUrl('OSM_PBF_URLS', url));

  return {
    port: number('PORT', 8080, 0, 65535, { integer: true }),
    // Address to listen on; undefined = all interfaces.
    host: text('HOST') || undefined,
    publicDir: path.join(root, 'public'),
    dataDir: path.resolve(text('DATA_DIR') || path.join(root, 'data')),

    area,
    // What the map draws as the edge of the area: rings of [lon, lat]. A GeoJSON
    // file may bring its own as a top-level "outline" member (useful when its
    // polygons are adjacent parts whose inner borders should not show).
    areaOutline: outline ?? area.polygons.flat(),
    // Shown next to the page title.
    areaName: env.AREA_NAME === undefined ? (custom ? '' : VGN.name) : env.AREA_NAME.trim(),
    // Map section on the first visit. Default: all of a custom area.
    view: text('VIEW') ? box('VIEW') : custom ? area.bbox : VGN.view,

    // The zone the times of the feed are in (agency_timezone is not read).
    timeZone,
    // The map: the URL of a style or a template for raster tiles, one of them
    // null, and the origins the page may load it from.
    styleUrl,
    tileUrl,
    mapOrigins: [...new Set(mapOrigins)],
    // Credit for the map (HTML). A style names its sources itself, raster tiles cannot.
    tileAttribution: text('TILE_ATTRIBUTION') || (tileUrl ? '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' : ''),
    // Credit for the timetable and realtime data (HTML).
    dataAttribution: text('DATA_ATTRIBUTION') || '<a href="https://gtfs.de">GTFS.DE</a> / <a href="https://www.delfi.de">DELFI e.V.</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)',

    // Other feeds must follow the conventions of the gtfs.de one in a few
    // places, e.g. how train categories are told apart (routeMode in
    // lib/timetable.js) and rows grouped by trip in stop_times.txt.
    feedUrl: httpUrl('FEED_URL', text('FEED_URL') || 'https://download.gtfs.de/germany/free/latest.zip'),
    feedCheckMs: number('FEED_CHECK_MINUTES', 15, 1, 1440) * 60_000,
    // Limit for one download of the feed or of an OSM extract.
    downloadTimeoutMs: number('DOWNLOAD_TIMEOUT_MINUTES', 30, 1, 1440) * 60_000,

    osmUrls,
    osmMaxAgeMs: number('OSM_MAX_AGE_DAYS', 30, 1, 3650) * 86_400_000,

    realtimeUrl: httpUrl('REALTIME_URL', text('REALTIME_URL') || 'https://realtime.gtfs.de/realtime-free.pb'),
    realtimeIntervalMs: number('REALTIME_INTERVAL_SECONDS', 30, 10, 3600) * 1000,
    // Polling stops this long after the last browser request.
    realtimeIdleMs: number('REALTIME_IDLE_SECONDS', 120, 30, 86400) * 1000,

    // Whether to ask once a day if there is a newer release (lib/update.js).
    updateCheck: onOff('UPDATE_CHECK', true),

    // What the page says about itself before any script runs, for search
    // engines and previews of links (lib/page.js): the language it says it
    // in, and the address under which visitors reach the instance.
    language,
    publicUrl,
  };
}
