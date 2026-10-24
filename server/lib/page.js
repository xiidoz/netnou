// What a search engine reads, and what a chat shows of a link, is the page as
// the server sends it: no script has run yet. So the server writes into
// index.html what the instance is – the name of its area in the title, the
// description and the heading, in its main language – and where it is to be
// found. The same texts are put in by the script for whoever looks at the page
// (pageTexts in public/i18n.js).
//
// A visitor sees the page as the server sends it too, for as long as its
// scripts are on their way: on a phone that is seconds. So the server sends
// the header card whole, its texts in the language of the page and its icons
// drawn. Whether that is the card this visitor gets, the first script of the
// page finds out (public/first.js), and shows it at once if it is. For most it
// is: where the address names no language, the page is sent in the one the
// page itself would pick for the browser that asks (languageFor).
//
// The page picks its language in the browser, which a search engine never
// gets to see in another language than that of its own browser. Hence an
// address per language, ?lang=de, which the page names as its other versions.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, pageTexts, pickLanguage, t } from '../../public/i18n.js';
import * as shapes from '../../public/vendor/material-design-icons/icons.js';
import { choiceChip, departureLists, departuresSub, h, lineHead, lineLists, lineStops, panelHead, stopHeading, toHtml } from '../../public/panel.js';

export const LANGUAGE_CODES = LANGUAGES.map(([code]) => code);
// The picture of a link's preview: the icon, unless the operator has one of
// their own, wide as chats show it.
const PREVIEW_ICON = { path: 'icons/icon-512.png', size: 512 };

// What an operator may bring files of their own for, in a folder outside the
// repository: by the name of the file there, the address it is served under.
// The icons take the place of the built-in ones; the preview is theirs alone.
const OWN_ICONS = {
  'favicon.svg': 'favicon.svg',
  'icon-192.png': 'icons/icon-192.png',
  'icon-512.png': 'icons/icon-512.png',
  'icon-maskable-512.png': 'icons/icon-maskable-512.png',
  'apple-touch-icon.png': 'icons/apple-touch-icon.png',
};
const OWN_PREVIEWS = ['preview.png', 'preview.jpg'];

// The scripts the page starts with. A browser learns of each from the one
// before – of app.js from the page, of what app.js imports from app.js, and
// so on down to the map library – and would fetch them one after the other.
// Named in the head of the page, they are all asked for at once. A test
// compares the list with what the scripts import (test/frontend.test.js).
export const PAGE_MODULES = [
  'app.js',
  'i18n.js',
  'locales/en.js',
  'display.js',
  'address.js',
  'stops.js',
  'panel.js',
  'favourites.js',
  'choice.js',
  'vendor/material-design-icons/icons.js',
  'vendor/maplibre-gl/maplibre-gl.mjs',
  'vendor/maplibre-gl/maplibre-gl-shared.mjs',
];

// What a browser has to have before it paints the page: its style sheets,
// and the one script it waits for. Each is a request of its own, and on a
// phone a request is most of a second. So the server writes them into the
// page as it is sent (renderPage), and the Content-Security-Policy of that
// answer allows them by their hashes (inlineHashes, securityPolicy).
// index.html names them as files all the same, which a test holds together
// with this list (test/frontend.test.js).
export const PAGE_INLINE = ['first.js', 'style.css', 'vendor/maplibre-gl/maplibre-gl.css'];

/**
 * The hashes by which a Content-Security-Policy allows what is written into
 * the page, as securityPolicy takes them: { styles, scripts }.
 * @param inline the files written into the page, by their address (PAGE_INLINE)
 */
export function inlineHashes(inline) {
  const hashOf = (text) => `'sha256-${crypto.createHash('sha256').update(text).digest('base64')}'`;
  const of = (ending) => [...inline].filter(([file]) => file.endsWith(ending)).map(([, text]) => hashOf(text));
  return { styles: of('.css'), scripts: of('.js') };
}

/**
 * The operator's own files in `dir`, as far as they are there.
 * @param dir the folder, or null; one that does not exist is one without files
 * @returns { files, preview }: the files by the address they are served
 *   under, and the address of the picture for previews, null without one
 */
export function ownFiles(dir) {
  const files = new Map();
  const isFile = (name) => fs.statSync(path.join(dir, name), { throwIfNoEntry: false })?.isFile() ?? false;
  if (!dir) return { files, preview: null };
  for (const [name, address] of Object.entries(OWN_ICONS)) if (isFile(name)) files.set(address, path.join(dir, name));
  const preview = OWN_PREVIEWS.find(isFile) ?? null;
  if (preview) files.set(preview, path.join(dir, preview));
  return { files, preview };
}

/**
 * The version of each icon and of the preview picture: a few characters of
 * what is in the file, the operator's own or the built-in one, by the
 * address it is served under. The page and the manifest name each with its
 * version (?v=…). A search engine, a chat or a browser keeps an icon by its
 * address and may not ask for it again for weeks; with the version in it, a
 * new icon has a new address and is fetched anew.
 * @param own what ownFiles found
 * @param publicDir where the built-in files are
 */
export function versionsOfFiles(own, publicDir) {
  const versions = {};
  for (const address of [...Object.values(OWN_ICONS), ...(own.preview ? [own.preview] : [])]) {
    try {
      versions[address] = crypto.createHash('sha1').update(fs.readFileSync(own.files.get(address) ?? path.join(publicDir, address))).digest('hex').slice(0, 10);
    } catch {
      // (a built-in file that is missing has no version: its address stays as it is)
    }
  }
  return versions;
}

/** An address of the page's files with the version of the file, where it has one (versionsOfFiles). */
const versioned = (address, known) => (known[address] ? `${address}?v=${known[address]}` : address);

/**
 * How large a picture is, read from its file: { width, height } of a PNG or a
 * JPEG, null of anything else and of a file that cannot be read.
 */
export function pictureSize(file) {
  let data;
  try {
    data = fs.readFileSync(file);
  } catch {
    return null;
  }
  // PNG: its signature, then the first chunk, which begins with width and height
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.toString('latin1', 12, 16) === 'IHDR') {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  // JPEG: segments, each a marker and its length; the "start of frame" among them has the size
  if (data.length >= 4 && data.readUInt16BE(0) === 0xffd8) {
    let at = 2;
    while (at + 9 <= data.length && data[at] === 0xff) {
      const marker = data[at + 1];
      // (C0 to CF but for three that are something else)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: data.readUInt16BE(at + 7), height: data.readUInt16BE(at + 5) };
      at += 2 + data.readUInt16BE(at + 2);
    }
  }
  return null;
}

/**
 * The language of the page for a browser whose address names none: the one
 * the page would pick for it in the browser (pickLanguage in public/i18n.js),
 * from the languages the browser says it wants. So the page comes as its
 * visitor gets it, and its header card can show before the scripts have run.
 * Whoever says nothing of languages – a search engine, as a rule – gets the
 * main language of the instance.
 * @param header the Accept-Language header of the request, undefined without
 *   one: "de-DE,de;q=0.9,en;q=0.8", most wanted first unless the weights say otherwise
 * @param main the main language of the instance
 */
export function languageFor(header = '', main) {
  const wanted = header.split(',')
    .map((part) => /^\s*([a-z]{1,8}(?:-[a-z0-9]{1,8})*)\s*(?:;\s*q\s*=\s*([01](?:\.\d{0,3})?))?\s*$/i.exec(part))
    // (a language that is not one, a weight that is none, "any language" and a language not wanted at all)
    .filter((match) => match && Number(match[2] ?? 1) > 0)
    .sort((a, b) => Number(b[2] ?? 1) - Number(a[2] ?? 1))
    .map((match) => match[1]);
  return wanted.length ? pickLanguage(null, wanted) : main;
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The title of a page as renderPage wrote it, as text. */
/**
 * The Content-Security-Policy of the server's answers. The map is the only
 * thing the page loads from elsewhere: MapLibre fetches the style, tiles and
 * fonts (connect-src) and may load icons as images, and what it has fetched
 * it turns into images by way of blob: URLs. Another site may show the page
 * in a frame of its own, as a dashboard does, only if it is one of
 * `embedOrigins` (NETNOU_EMBED_ORIGINS): unless the operator names some, none.
 * @param hashes those of the style sheets and the script written into the
 *   page (inlineHashes), for the answer that is the page; no other inline
 *   style or script is allowed
 */
export function securityPolicy({ mapOrigins = [], embedOrigins = [] }, hashes = { styles: [], scripts: [] }) {
  const map = mapOrigins.join(' ');
  const allowed = (list) => list.map((hash) => ` ${hash}`).join('');
  return `default-src 'self'; img-src 'self' data: blob: ${map}; style-src 'self'${allowed(hashes.styles)}; script-src 'self'${allowed(hashes.scripts)}; worker-src 'self'; connect-src 'self' ${map}; frame-ancestors ${embedOrigins.length ? embedOrigins.join(' ') : "'none'"}`;
}

export const titleOf = (html) => (/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

/** The title of the page at the address of a stop or a line: the title of what it names (lib/addresses.js), then the instance. */
export const addressTitle = (title, siteName) => `${title} – ${siteName}`;

/**
 * The texts of index.html, which has the English ones, in another language:
 * what translatePage (public/i18n.js) does in the browser. data-i18n names the
 * key of the text of an element, data-i18n-<attribute> that of an attribute.
 * @param texts the texts of the language (a module of public/locales)
 */
function translate(html, texts) {
  // a start tag and the text that follows it
  return html.replace(/(<[a-z][\w-]*\s[^<>]*>)([^<]*)/g, (whole, tag, text) => {
    if (!tag.includes(' data-i18n')) return whole;
    let start = tag;
    for (const [, attribute, key] of tag.matchAll(/\sdata-i18n-([a-z-]+)="([^"]*)"/g)) {
      start = start.replace(new RegExp(`(\\s${attribute}=")[^"]*`), (_, before) => `${before}${escapeHtml(t(key, {}, texts))}`);
    }
    const own = /\sdata-i18n="([^"]*)"/.exec(tag);
    return start + (own ? escapeHtml(t(own[1], {}, texts)) : text);
  });
}

/** An icon as app.js draws it (icon there): the shape of that name from vendor/material-design-icons. */
function iconSvg(name) {
  if (!shapes[name]) throw new Error(`index.html: there is no icon ${name}`);
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${shapes[name]}"/></svg>`;
}

/** The address of the page in one language, or without one in that of the visitor's browser. */
const addressIn = (publicUrl, language) => (language ? `${publicUrl}?lang=${language}` : publicUrl);

/** The versions of the page in each language and the one that follows the browser, as [hreflang, address]. */
const versions = (publicUrl) => [...LANGUAGE_CODES.map((code) => [code, addressIn(publicUrl, code)]), ['x-default', publicUrl]];

/**
 * index.html as it is sent.
 * @param html the file
 * @param language what its texts are to be in
 * @param asked the language the address asked for, null if it named none:
 *   the page is then the one that follows the browser, whatever it is in
 * @param texts the texts of that language (a module of public/locales)
 * @param siteName what the instance calls itself
 * @param areaName may be empty
 * @param siteTitle the operator's own title of the page in that language,
 *   null for the one the page has, with the names of the area and the instance
 * @param siteDescription the operator's own description in that language, null for the page's
 * @param links the operator's own, [{ text, href }], at the foot of the header card
 * @param preview the address of the operator's picture for previews of
 *   links (ownFiles), null to show the icon
 * @param previewSize its { width, height } (pictureSize), null if not known
 * @param publicUrl the address of the instance with a slash at its end, or
 *   null: then all that needs a full address is left out
 * @param listed whether search engines may list the page; if not, it asks
 *   them not to and leaves out what is there for them alone
 * @param styleUrl the style of the map, null with raster tiles
 * @param mapOrigins the servers the map comes from, as the
 *   Content-Security-Policy names them
 * @param kinds the kinds of transport the timetable has (MODES in
 *   lib/timetable.js), which get a chip and no others; null while there is no
 *   timetable: the chips are then those that index.html shows
 * @param nearby the stations the search suggests for the first view of the
 *   instance (#257), [{ name, town, path }]: links in the list of the search,
 *   which is not shown until the search is opened, and then with the
 *   page's own
 * @param address the address of a stop, a line or a trip that the page is
 *   sent for (#37, #178), null for the page itself: { path, depth } of the
 *   address, with { title, description, heading, sub, unlisted } of what it
 *   names (lib/addresses.js) and, of a stop or a line, the `panel` its details
 *   show now (panelHtml), or { gone } with the text that says it names nothing now, or neither
 *   while that is not known yet (there is no timetable)
 * @param inline the style sheets and the first script, by their address in
 *   index.html (PAGE_INLINE), to be written into the page in place of the
 *   tags that name them; null leaves the tags
 */
export function renderPage(html, { language, asked, texts, siteName, areaName, siteTitle = null, siteDescription = null, links = [], preview = null, previewSize = null, publicUrl, listed, styleUrl = null, mapOrigins = [], kinds = null, nearby = [], address = null, inline = null, fileVersions = {} }) {
  const worded = pageTexts(areaName, texts, siteName);
  const named = Boolean(address?.title);
  const title = named ? addressTitle(address.title, siteName) : siteTitle ?? worded.title;
  const description = named ? address.description : siteDescription ?? worded.description;
  // The texts first: of what follows, some takes the place of one of them.
  // Then the icons, each into the empty element that asks for one.
  let page = translate(html, texts).replace(/(<[a-z]+\s(?:[^<>]*\s)?data-icon="([^"]*)"[^<>]*>)(?=<\/)/g, (_, start, name) => start + iconSvg(name));
  const put = (pattern, replacement) => {
    // (index.html has changed and this file has not: better no page than one that says the wrong thing)
    if (!pattern.test(page)) throw new Error(`index.html: nothing matches ${pattern}`);
    page = page.replace(pattern, replacement);
  };
  // (which languages there are: first.js picks the visitor's among them, and sees whether it is that of the page)
  put(/<html lang="[^"]*">/, () => `<html lang="${language}" data-languages="${LANGUAGE_CODES.join(' ')}">`);
  // The style sheets and the first script within the page, so that a browser
  // paints it as soon as it has arrived, without a request for each of them
  // first; the answer allows them by their hashes (securityPolicy). As they
  // are, byte for byte: the hash is of what stands between the tags.
  for (const [file, text] of inline ?? []) {
    const named = file.replace(/[./]/g, '\\$&');
    if (file.endsWith('.css')) put(new RegExp(`<link rel="stylesheet" href="${named}">`), () => `<style>${text}</style>`);
    else put(new RegExp(`<script src="${named}"></script>`), () => `<script>${text}</script>`);
  }
  // (at an address, the page's own files are as many steps up as the address is deep)
  if (address) put(/<meta charset="utf-8">\n/, (start) => `${start}  <base href="${'../'.repeat(address.depth)}">\n`);
  put(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  // (a description of the operator's own, or of what an address names, stands as it is: without the mark by which the script would put the page's in its place)
  put(/(<meta name="description" content=")[^"]*"( data-i18n-content="page\.description")/, (_, start, mark) => `${start}${escapeHtml(description)}"${siteDescription === null && !named ? mark : ''}`);
  put(/(<meta name="apple-mobile-web-app-title" content=")[^"]*"/, (_, start) => `${start}${escapeHtml(siteName)}"`);
  // (the main heading of the page, except at an address: there it is the name of what that names, in its details, #254)
  put(/<h1>[^<]*<\/h1>/, () => (named ? `<div class="site-name">${escapeHtml(siteName)}</div>` : `<h1>${escapeHtml(siteName)}</h1>`));
  put(/(<p id="area-name">)[^<]*/, (_, start) => `${start}${escapeHtml(areaName)}`);
  // (the icons by addresses with their versions: a new one is fetched anew)
  for (const file of Object.keys(fileVersions)) page = page.replaceAll(`href="${file}"`, `href="${versioned(file, fileVersions)}"`);
  // A chip for each kind of transport the timetable has, so that none comes
  // or goes once the script has run (it follows the timetable from then on).
  if (kinds) put(/(<button type="button" class="chip" data-mode="([a-z]+)"[^>]*?)( hidden)?>/g, (_, start, mode) => `${start}${kinds.includes(mode) ? '' : ' hidden'}>`);
  // A page elsewhere opens in a new tab, like the links of the credits: the
  // map stays where it is. A page next to the instance (a path on the same
  // host) takes the place of the map: it belongs to the same site, and its
  // way back would open the map a second time in a tab of its own.
  const elsewhere = (href) => (href.startsWith('/') ? '' : ' target="_blank" rel="noopener"');
  const anchors = links.map(({ text, href }) => `<a href="${escapeHtml(href)}"${elsewhere(href)}>${escapeHtml(text)}</a>`).join('');
  put(/(<nav class="links"[^>]*?) hidden><\/nav>/, (whole, start) => (links.length ? `${start}>${anchors}</nav>` : whole));
  // The stations the search suggests near the first view (#257), each a link
  // to its page: what a search engine has to find its way into the stops and
  // lines from the page itself. As the search lists them, under their heading.
  if (nearby.length) {
    const rows = [
      h('li', { class: 'search-heading', role: 'presentation' }, t('search.nearby', {}, texts)),
      ...nearby.map((stop) => h('li', { role: 'option', 'aria-selected': 'false', class: stop.town ? 'in-town' : null }, h('a', { href: stop.path }, stop.town ? [h('span', { class: 'stop' }, stop.name), ' ', h('span', { class: 'town' }, stop.town)] : stop.name))),
    ];
    put(/(<ul class="search-results" id="search-results"[^>]*>)(<\/ul>)/, (_, start, end) => `${start}${rows.map(toHtml).join('')}${end}`);
  }
  // At an address, its details are open from the start: those of a stop or
  // a line as the page shows them, at the moment the page is sent (#254),
  // which the script keeps until it has them anew (data-sent); of a trip its
  // name and what it is. What a search engine reads is what a rider sees.
  if (named || address?.gone) {
    put(/(<aside class="card panel" id="panel") hidden/, (_, start) => start);
    if (named) put(/<div id="panel-head"><\/div>/, () => `<div id="panel-head">${address.panel?.head ?? toHtml(panelHead(address.heading, h('p', { class: 'sub' }, address.sub)))}</div>`);
    put(/<div id="panel-body"><\/div>/, () => (address.panel ? `<div id="panel-body" data-sent>${address.panel.body}</div>` : `<div id="panel-body"><p class="panel-empty">${escapeHtml(named ? address.description : address.gone)}</p></div>`));
  }

  // For previews of a link (Open Graph, which the others read as well).
  const tags = [
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${escapeHtml(siteName)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    // (a picture of the operator's own is a wide one and shown large; the icon is not)
    `<meta name="twitter:card" content="${preview && publicUrl ? 'summary_large_image' : 'summary'}">`,
  ];
  // (also said with every answer of the server, see NOT_LISTED in index.js; an address that names nothing, or nothing yet, or a trip, which lives for its day, is not to be listed either)
  if (!listed || (address && !named) || address?.unlisted) tags.push('<meta name="robots" content="noindex">');
  if (publicUrl) {
    const own = publicUrl + (named ? address.path : '');
    const canonical = escapeHtml(addressIn(own, asked));
    if (listed && (!address || named) && !address?.unlisted) {
      tags.push(
        `<link rel="canonical" href="${canonical}">`,
        ...versions(own).map(([code, href]) => `<link rel="alternate" hreflang="${code}" href="${escapeHtml(href)}">`),
      );
    }
    tags.push(`<meta property="og:url" content="${canonical}">`);
    if (preview) {
      tags.push(`<meta property="og:image" content="${escapeHtml(publicUrl + versioned(preview, fileVersions))}">`);
      // (some chats show a picture large only if they know its size before they have fetched it)
      if (previewSize) tags.push(`<meta property="og:image:width" content="${previewSize.width}">`, `<meta property="og:image:height" content="${previewSize.height}">`);
    } else {
      tags.push(
        `<meta property="og:image" content="${escapeHtml(publicUrl + versioned(PREVIEW_ICON.path, fileVersions))}">`,
        `<meta property="og:image:width" content="${PREVIEW_ICON.size}">`,
        `<meta property="og:image:height" content="${PREVIEW_ICON.size}">`,
      );
    }
  }

  // What the page asks for as soon as it runs, so that the browser has asked
  // by then: its scripts, with the texts of its language (the visitor's, in
  // most cases), what the server says of the area and of itself (loadArea in
  // app.js), and the map. Of the map its style where it has one – else, and
  // for what a style takes from other servers, the connection is made ready.
  // Of the scripts, the texts and what puts them in are wanted first: they
  // are small, and the header card of a visitor whose language is another
  // than the page's waits for them (first.js). The rest, the map library
  // above all, is large and has time until the card stands; asked for with
  // less urgency, it does not hold up the texts – nor, as Lighthouse sees it,
  // the first paint.
  const own = `locales/${language}.js`;
  const urgent = (file) => file === 'i18n.js' || file.startsWith('locales/');
  const styleOrigin = styleUrl ? new URL(styleUrl).origin : null;
  tags.push(
    ...[...PAGE_MODULES, ...(PAGE_MODULES.includes(own) ? [] : [own])].map((file) => `<link rel="modulepreload" href="${file}"${urgent(file) ? '' : ' fetchpriority="low"'}>`),
    // (crossorigin: as fetch() asks, or the answer is not the one it takes)
    '<link rel="preload" as="fetch" href="api/area" crossorigin>',
    '<link rel="preload" as="fetch" href="api/status" crossorigin>',
  );
  if (styleUrl) tags.push(`<link rel="preload" as="fetch" href="${escapeHtml(styleUrl)}" crossorigin>`);
  // (a name with a wildcard, from tiles with {s}, is none to connect to)
  for (const origin of mapOrigins) if (origin !== styleOrigin && !origin.includes('*')) tags.push(`<link rel="preconnect" href="${escapeHtml(origin)}" crossorigin>`);

  put(/\n<\/head>/, () => `\n${tags.map((tag) => `  ${tag}`).join('\n')}\n</head>`);
  return page;
}

/**
 * The manifest of the installed app as it is sent: the file, with the name of
 * the instance, and its language and description in place of the English ones.
 * @param json the file
 * @param siteDescription the operator's own description in that language, null for the page's
 * @param fileVersions of the icons, which it names by addresses with their versions (versionsOfFiles)
 */
export function renderManifest(json, { language, texts, siteName, areaName, siteDescription = null, fileVersions = {} }) {
  const manifest = JSON.parse(json);
  const icons = manifest.icons?.map((icon) => ({ ...icon, src: versioned(icon.src, fileVersions) }));
  return JSON.stringify({ ...manifest, name: siteName, short_name: siteName, description: siteDescription ?? pageTexts(areaName, texts, siteName).description, lang: language, ...(icons ? { icons } : {}) }, null, 2);
}

/**
 * The details of a stop or a line as the page shows them (public/panel.js),
 * as they are at a moment, to be written into the page of its address
 * (#254): a stop's departures, with the times as the page shows them until
 * the visitor chooses otherwise (both, state.times in app.js), the switch to
 * all its lines and the chip of the lines the departures are of, and behind
 * the switch all its lines, each a link to its page (#255); a line's
 * stops in its first direction, each a link to its page, with its vehicles
 * where they are (#256). The notes of a stop come with the script.
 * @param kind 'stop' or 'line'
 * @param data what api/departures (with list=lines) or api/line answers for it
 * @param fixed whether the page is a screen on a wall set up for one purpose, which has neither switch nor chip
 * @returns { head, body } as HTML
 */
export function panelHtml(kind, data, { language, texts, timeZone, now, fixed = false }) {
  const time = new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone });
  const day = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
  const drawing = { t: (key, params) => t(key, params, texts), time: (epoch) => time.format(epoch * 1000), day: (epoch) => day.format(epoch * 1000), now, times: 'both' };
  const [head, body] = kind === 'stop'
    ? [panelHead(stopHeading(data.name, data.town), fixed ? departuresSub(null, null, drawing) : departuresSub('departures', choiceChip([], drawing), drawing)),
      [...departureLists(data, drawing), fixed ? null : h('div', { class: 'view-lines', hidden: true }, lineLists(data, drawing))].filter(Boolean)]
    : [lineHead(data, drawing, 0), lineStops(data, { ...drawing, live: data.vehicles.some((v) => v.delay !== null) }, 0)];
  return { head: toHtml(head), body: body.map(toHtml).join('') };
}

/**
 * Search engines may read everything, also on an instance that is not to be
 * listed: what is not to be listed says so itself, in a header of the answer,
 * and a search engine that may not read it would never get to see that.
 * @param sitemapAt the address of the instance if it has a sitemap, else null
 */
export function robotsTxt(sitemapAt) {
  return `User-agent: *\nAllow: /\n${sitemapAt ? `\nSitemap: ${sitemapAt}sitemap.xml\n` : ''}`;
}

// A sitemap may list this many addresses at the most (sitemaps.org).
export const SITEMAP_MAX = 50_000;

/**
 * The sitemap of an instance: the addresses of the page, each with the
 * others as its versions in other languages, and those of its stops and
 * lines (#37). Up to `max` addresses are one file, sitemap.xml. More are
 * cut into files of that many, sitemap-1.xml on, which sitemap.xml then
 * lists: those of the default area are one file, the 270,000 of all of
 * Germany six. Each address has the date of the timetable it was made from
 * (#254), where that is known: what a stop or a line lists comes from it.
 * @param paths the addresses of the stops and lines, from where the instance is
 * @param lastmod that date, YYYY-MM-DD, or null
 * @returns the files: sitemap.xml, then sitemap-1.xml on if there are more
 */
export function sitemapFiles(publicUrl, paths = [], max = SITEMAP_MAX, lastmod = null) {
  const escapeXml = (text) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  const all = versions(publicUrl);
  const links = all.map(([code, href]) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${escapeXml(href)}"/>`).join('\n');
  // (the one that follows the browser first: it is the address people pass on)
  const dated = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
  const urls = [all.at(-1), ...all.slice(0, -1)].map(([, href]) => `  <url>\n    <loc>${escapeXml(href)}</loc>${dated ? `\n    ${dated}` : ''}\n${links}\n  </url>`);
  for (const path of paths) urls.push(`  <url><loc>${escapeXml(publicUrl + path)}</loc>${dated}</url>`);
  const head = '<?xml version="1.0" encoding="UTF-8"?>\n';
  const urlset = (listed) => `${head}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${listed.join('\n')}\n</urlset>\n`;
  if (urls.length <= max) return [urlset(urls)];
  const parts = Array.from({ length: Math.ceil(urls.length / max) }, (_, i) => urlset(urls.slice(i * max, (i + 1) * max)));
  const files = parts.map((_, i) => `  <sitemap><loc>${escapeXml(`${publicUrl}sitemap-${i + 1}.xml`)}</loc></sitemap>`);
  return [`${head}<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.join('\n')}\n</sitemapindex>\n`, ...parts];
}
