// What the server writes into the page before it sends it (server/lib/page.js),
// tried on the real index.html: if that file changes in a way the server does
// not find its places in any more, this is where it shows.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LANGUAGES, pageTexts, pickLanguage } from '../public/i18n.js';
import de from '../public/locales/de.js';
import en from '../public/locales/en.js';
import * as shapes from '../public/vendor/material-design-icons/icons.js';
import { inlineHashes, LANGUAGE_CODES, languageFor, ownFiles, PAGE_INLINE, PAGE_MODULES, pictureSize, renderManifest, renderPage, robotsTxt, securityPolicy, sitemapFiles } from '../server/lib/page.js';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const URL_ = 'https://karte.example.org/live/';
const tag = (page, pattern) => pattern.exec(page)?.[1];
const german = { language: 'de', asked: null, texts: de, siteName: 'Netnou', areaName: 'Großraum Nürnberg (VGN)', publicUrl: URL_, listed: true };
const escaped = (text) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const ICON = /<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="([^"]*)"\/><\/svg>/g;

/** The texts of a page that are marked for translation: [what, key, text], for the text of an element and for each attribute. */
function markedTexts(page) {
  const found = [];
  for (const [, tag, text] of page.replace(/<!--[\s\S]*?-->/g, '').matchAll(/(<[a-z][\w-]*\s[^<>]*>)([^<]*)/g)) {
    for (const [, attribute, key] of tag.matchAll(/\sdata-i18n-([a-z-]+)="([^"]*)"/g)) found.push([attribute, key, new RegExp(`\\s${attribute}="([^"]*)"`).exec(tag)[1]]);
    const own = /\sdata-i18n="([^"]*)"/.exec(tag);
    if (own) found.push(['text', own[1], text]);
  }
  return found;
}

test('the languages of the page are those of its texts', () => {
  assert.deepEqual(LANGUAGE_CODES, LANGUAGES.map(([code]) => code));
});

// Where the address names no language, the page is sent in the one its own
// script would pick for the browser: then it comes as the visitor gets it.
// ('xx' stands for a language the page does not have, whatever is added to it)
test('the language of the page is the one the page would pick for the browser that asks', () => {
  // as browsers ask: most wanted first, each with its region and without
  assert.equal(languageFor('de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7', 'en'), 'de');
  assert.equal(languageFor('en-US,en;q=0.9', 'de'), 'en');
  assert.equal(languageFor('en-GB', 'de'), 'en');
  assert.equal(languageFor('xx-XX,xx;q=0.9,de-AT;q=0.8,en;q=0.7', 'en'), 'de');
  // by the weights, wherever they stand; of two with the same weight the first
  assert.equal(languageFor('en;q=0.1, de;q=0.9', 'en'), 'de');
  assert.equal(languageFor('en;q=0.5,de;q=0.5', 'de'), 'en');
  assert.equal(languageFor(' DE ; q = 0.8 , en ; q=0.4', 'en'), 'de');
  // a language that is not wanted at all is none
  assert.equal(languageFor('de;q=0, en', 'de'), 'en');
  assert.equal(languageFor('xx, de;q=0.000', 'de'), 'en');
  // none the page has: English, as the page picks for such a browser
  assert.equal(languageFor('xx-XX,xx;q=0.9', 'de'), 'en');
  // nothing said, or nothing that says anything: the main language of the instance
  for (const header of [undefined, '', ' ', '*', '*;q=0.5', 'de;q=2', 'en;q=often', 'curl/8.5.0', ',,;']) {
    assert.equal(languageFor(header, 'de'), 'de', `${header}`);
    assert.equal(languageFor(header, 'en'), 'en', `${header}`);
  }
  // (what cannot be read is passed over, the rest counts)
  assert.equal(languageFor('en;q=often, de', 'en'), 'de');

  // the same choice as the script of the page makes from the same list
  const browsers = [['de-DE', 'de', 'en-US', 'en'], ['en-US', 'en'], ['xx-XX', 'xx'], ['xx', 'en', 'de'], ['EN-gb', 'de'], ['de']];
  for (const browser of browsers) {
    const header = browser.map((tag, index) => (index ? `${tag};q=${(1 - index / 10).toFixed(1)}` : tag)).join(',');
    for (const main of LANGUAGE_CODES) assert.equal(languageFor(header, main), pickLanguage(null, browser), header);
  }
});

test('the page says what and where it is, in the language of the instance', () => {
  const page = renderPage(html, german);
  assert.match(page, /<html lang="de"[ >]/);
  assert.equal(tag(page, /<title>([^<]*)<\/title>/), 'ÖPNV-Live-Karte: Großraum Nürnberg (VGN) – Netnou');
  const description = tag(page, /<meta name="description" content="([^"]*)"/);
  assert.equal(description, de['page.descriptionIn'].replace('{area}', 'Großraum Nürnberg (VGN)'));
  assert.match(description, /^Großraum Nürnberg \(VGN\): Busse, /);
  assert.equal(tag(page, /<p id="area-name">([^<]*)<\/p>/), 'Großraum Nürnberg (VGN)');
  // the same as the script puts in for the visitor
  assert.deepEqual(pageTexts('Großraum Nürnberg (VGN)', de), { title: tag(page, /<title>([^<]*)<\/title>/), description });

  // for previews of a link
  assert.equal(tag(page, /<meta property="og:title" content="([^"]*)"/), 'ÖPNV-Live-Karte: Großraum Nürnberg (VGN) – Netnou');
  assert.equal(tag(page, /<meta property="og:description" content="([^"]*)"/), description);
  assert.equal(tag(page, /<meta property="og:site_name" content="([^"]*)"/), 'Netnou');
  assert.equal(tag(page, /<meta property="og:image" content="([^"]*)"/), `${URL_}icons/icon-512.png`);
  assert.ok(fs.existsSync(new URL('../public/icons/icon-512.png', import.meta.url)));

  // Nothing else of the file is touched. In English, the language of the file:
  // with what was added taken out and the five places put back, it is the file.
  const english = renderPage(html, { ...german, language: 'en', texts: en });
  const added = english.slice(english.indexOf('  <meta property="og:type"'), english.indexOf('</head>'));
  // (the name is the software's own here, as in the file)
  const back = english.replace(added, '').replace(/<html lang="en"[^>]*>/, '<html lang="en">').replace(/<title>[^<]*<\/title>/, '<title>Netnou</title>')
    .replace(tag(english, /<meta name="description" content="([^"]*)"/), en['page.description']).replace('<p id="area-name">Großraum Nürnberg (VGN)</p>', '<p id="area-name"></p>')
    .replace(ICON, '');
  assert.equal(back, html);
});

// A visitor sees the page as it is sent until its scripts have run. The first
// of them shows the header card at once where the page is in the visitor's
// language (public/first.js), so the card has to be whole as it comes.
test('the page comes with its texts in its language and its icons drawn', () => {
  const page = renderPage(html, german);
  // every text the file marks for translation, and no other
  const texts = markedTexts(page);
  assert.deepEqual(texts.map(([what, key]) => [what, key]), markedTexts(html).map(([what, key]) => [what, key]));
  assert.ok(texts.length > 40, 'the texts were not found');
  for (const [what, key, text] of texts) {
    // (what the page says about itself names the area: see above)
    if (key === 'page.description') continue;
    assert.equal(text, escaped(de[key]), `${what} of ${key}`);
  }
  for (const text of ['Verbinde …', 'Ort, Haltestelle oder Linie suchen', 'Regionalzug', 'So funktioniert’s']) assert.ok(page.includes(text), text);
  for (const text of ['Connecting', 'Search for a stop', 'Regional train', 'How it works']) assert.ok(!page.includes(text), text);
  // the marks stay: the script puts in the texts of a visitor with another language by them
  assert.equal(page.match(/\sdata-i18n(-[a-z-]+)?=/g).length, html.match(/\sdata-i18n(-[a-z-]+)?=/g).length);
  // which languages there are, for the script that picks the visitor's before the page is drawn
  assert.ok(page.includes(`<html lang="de" data-languages="${LANGUAGE_CODES.join(' ')}">`));

  // in English the texts are those of the file
  assert.deepEqual(markedTexts(renderPage(html, { ...german, language: 'en', texts: en, areaName: '' })), markedTexts(html));
  // a text a language lacks is the English one
  const partial = { ...de };
  delete partial['status.connecting'];
  assert.ok(renderPage(html, { ...german, texts: partial }).includes('<span id="status-text" data-i18n="status.connecting">Connecting …</span>'));
  // and a text is text, whatever is in it
  const odd = renderPage(html, { ...german, texts: { ...de, 'status.connecting': 'Tom & <b>"Jerry"</b>', 'search.label': 'a "b" <c> & $1' } });
  assert.ok(odd.includes('data-i18n="status.connecting">Tom &#38; &#60;b&#62;&#34;Jerry&#34;&#60;/b&#62;</span>'));
  assert.ok(odd.includes(' placeholder="a &#34;b&#34; &#60;c&#62; &#38; $1" data-i18n-placeholder="search.label" aria-label="a &#34;b&#34; &#60;c&#62; &#38; $1" data-i18n-aria-label="search.label">'));

  // an icon in every element that asks for one, the shape of that name
  const asked = [...html.matchAll(/\sdata-icon="([^"]*)"/g)].map(([, name]) => name);
  assert.ok(asked.length >= 9, 'the icons were not found');
  const drawn = [...page.matchAll(new RegExp(`\\sdata-icon="([^"]*)"[^<>]*>${ICON.source}</`, 'g'))].map(([, name, shape]) => [name, shape]);
  assert.deepEqual(drawn, asked.map((name) => [name, shapes[name]]));
  assert.equal(page.match(ICON).length, asked.length);
  for (const name of asked) assert.equal(typeof shapes[name], 'string', `${name} is not in vendor/material-design-icons/icons.js`);
  assert.throws(() => renderPage(html.replace('data-icon="mdiCog"', 'data-icon="mdiNone"'), german), /index\.html: there is no icon mdiNone/);
});

test('the page names its address and its versions in other languages', () => {
  const page = renderPage(html, german);
  assert.equal(tag(page, /<link rel="canonical" href="([^"]*)"/), URL_);
  assert.equal(tag(page, /<meta property="og:url" content="([^"]*)"/), URL_);
  const versions = [...page.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map(([, code, href]) => [code, href]);
  assert.deepEqual(versions, [['de', `${URL_}?lang=de`], ['en', `${URL_}?lang=en`], ['x-default', URL_]]);

  // asked for in English: the same versions, and this one is the address of its own
  const english = renderPage(html, { ...german, language: 'en', asked: 'en', texts: en });
  assert.match(english, /<html lang="en"[ >]/);
  assert.equal(tag(english, /<title>([^<]*)<\/title>/), 'Live map of public transport: Großraum Nürnberg (VGN) – Netnou');
  assert.match(tag(english, /<meta name="description" content="([^"]*)"/), /^Großraum Nürnberg \(VGN\): buses, /);
  assert.equal(tag(english, /<link rel="canonical" href="([^"]*)"/), `${URL_}?lang=en`);
  assert.equal(tag(english, /<meta property="og:url" content="([^"]*)"/), `${URL_}?lang=en`);
  assert.deepEqual([...english.matchAll(/hreflang="([^"]*)" href="([^"]*)"/g)].map(([, code, href]) => [code, href]), versions);
});

test('without the address of the instance, nothing that needs one', () => {
  const page = renderPage(html, { ...german, publicUrl: null });
  assert.equal(tag(page, /<title>([^<]*)<\/title>/), 'ÖPNV-Live-Karte: Großraum Nürnberg (VGN) – Netnou');
  assert.match(page, /<meta property="og:title"/);
  for (const part of ['rel="canonical"', 'hreflang', 'og:url', 'og:image']) assert.ok(!page.includes(part), part);
});

test('a page that is not to be listed says so and keeps what a preview of a link needs', () => {
  const page = renderPage(html, { ...german, listed: false });
  assert.ok(page.includes('<meta name="robots" content="noindex">'));
  // what is there for search engines alone is left out
  for (const part of ['rel="canonical"', 'hreflang']) assert.ok(!page.includes(part), part);
  // texts and the picture are as on any other
  assert.equal(tag(page, /<title>([^<]*)<\/title>/), 'ÖPNV-Live-Karte: Großraum Nürnberg (VGN) – Netnou');
  assert.equal(tag(page, /<meta property="og:url" content="([^"]*)"/), URL_);
  assert.equal(tag(page, /<meta property="og:image" content="([^"]*)"/), `${URL_}icons/icon-512.png`);
  assert.ok(!renderPage(html, german).includes('name="robots"'));
  // not listed and without an address: the texts and the request, nothing else
  const bare = renderPage(html, { ...german, listed: false, publicUrl: null });
  assert.ok(bare.includes('<meta name="robots" content="noindex">'));
  for (const part of ['og:url', 'og:image', 'rel="canonical"', 'hreflang']) assert.ok(!bare.includes(part), part);
});

test('an instance with a name of its own carries it wherever the page names itself', () => {
  const page = renderPage(html, { ...german, siteName: 'Bus & Bahn live' });
  assert.equal(tag(page, /<h1>([^<]*)<\/h1>/), 'Bus &#38; Bahn live');
  assert.equal(tag(page, /<title>([^<]*)<\/title>/), 'ÖPNV-Live-Karte: Großraum Nürnberg (VGN) – Bus &#38; Bahn live');
  assert.equal(tag(page, /<meta property="og:site_name" content="([^"]*)"/), 'Bus &#38; Bahn live');
  assert.equal(tag(page, /<meta property="og:title" content="([^"]*)"/), 'ÖPNV-Live-Karte: Großraum Nürnberg (VGN) – Bus &#38; Bahn live');
  assert.equal(tag(page, /<meta name="apple-mobile-web-app-title" content="([^"]*)"/), 'Bus &#38; Bahn live');
  // and nowhere else: the rest of the page is that of any instance
  assert.equal(page.replaceAll('Bus &#38; Bahn live', 'Netnou'), renderPage(html, german));
  // without a name of its own, the page is as it always was
  assert.equal(tag(renderPage(html, german), /<h1>([^<]*)<\/h1>/), 'Netnou');
});

// The page words its title and its description in each of its languages. An
// operator may have words of their own for them, for the people the instance
// is for: those stand as they are, in one language, for everybody.
test('a title and a description of the operator\'s own take the place of the page\'s', () => {
  const own = { siteTitle: 'Bus & Bahn live im Großraum Nürnberg', siteDescription: 'Wo ist meine Bahn? "Live" auf der Karte, <jetzt> & hier.' };
  const said = { title: 'Bus &#38; Bahn live im Großraum Nürnberg', description: 'Wo ist meine Bahn? &#34;Live&#34; auf der Karte, &#60;jetzt&#62; &#38; hier.' };
  const page = renderPage(html, { ...german, ...own });
  assert.equal(tag(page, /<title>([^<]*)<\/title>/), said.title);
  assert.equal(tag(page, /<meta property="og:title" content="([^"]*)"/), said.title);
  assert.equal(tag(page, /<meta name="description" content="([^"]*)"/), said.description);
  assert.equal(tag(page, /<meta property="og:description" content="([^"]*)"/), said.description);
  // without the mark by which the script would put the page's own description in its place
  assert.ok(page.includes(`<meta name="description" content="${said.description}">`));
  // the name of the instance and of the area stay where else the page names them
  assert.equal(tag(page, /<h1>([^<]*)<\/h1>/), 'Netnou');
  assert.equal(tag(page, /<p id="area-name">([^<]*)<\/p>/), 'Großraum Nürnberg (VGN)');
  assert.equal(tag(page, /<meta property="og:site_name" content="([^"]*)"/), 'Netnou');
  // and nothing else changes: with the page's own words put back, it is the page of any instance
  const plain = renderPage(html, german);
  const worded = { title: tag(plain, /<title>([^<]*)<\/title>/), description: tag(plain, /<meta name="description" content="([^"]*)"/) };
  assert.equal(page.replaceAll(said.title, worded.title).replace(`content="${said.description}">`, `content="${worded.description}" data-i18n-content="page.description">`).replaceAll(said.description, worded.description), plain);
  // in one language: the page in English says the same
  const english = renderPage(html, { ...german, ...own, language: 'en', asked: 'en', texts: en });
  assert.equal(tag(english, /<title>([^<]*)<\/title>/), said.title);
  assert.equal(tag(english, /<meta name="description" content="([^"]*)"/), said.description);
  assert.ok(english.includes('>Connecting …<'));

  // one of the two alone leaves the other to the page
  const titled = renderPage(html, { ...german, siteTitle: own.siteTitle });
  assert.equal(tag(titled, /<title>([^<]*)<\/title>/), said.title);
  assert.ok(titled.includes(`<meta name="description" content="${worded.description}" data-i18n-content="page.description">`));
  const described = renderPage(html, { ...german, siteDescription: own.siteDescription });
  assert.equal(tag(described, /<title>([^<]*)<\/title>/), worded.title);
  assert.equal(tag(described, /<meta name="description" content="([^"]*)"/), said.description);

  // the installed app says the same of itself
  const file = fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8');
  assert.equal(JSON.parse(renderManifest(file, { ...german, ...own })).description, own.siteDescription);
  assert.equal(JSON.parse(renderManifest(file, { ...german, siteTitle: own.siteTitle })).description, de['page.descriptionIn'].replace('{area}', 'Großraum Nürnberg (VGN)'));
});

test('the page lets the map come from its servers, and lets only the sites named show it in a frame', () => {
  const map = ['https://maps.example.org', 'https://tiles.example.org'];
  const rest = "default-src 'self'; img-src 'self' data: blob: https://maps.example.org https://tiles.example.org; style-src 'self'; script-src 'self'; worker-src 'self'; connect-src 'self' https://maps.example.org https://tiles.example.org";
  assert.equal(securityPolicy({ mapOrigins: map }), `${rest}; frame-ancestors 'none'`);
  assert.equal(securityPolicy({ mapOrigins: map, embedOrigins: [] }), `${rest}; frame-ancestors 'none'`);
  assert.equal(securityPolicy({ mapOrigins: map, embedOrigins: ['https://home.example.org', 'http://homeassistant.local:8123'] }), `${rest}; frame-ancestors https://home.example.org http://homeassistant.local:8123`);
  assert.equal(securityPolicy({ mapOrigins: map, embedOrigins: ['*'] }), `${rest}; frame-ancestors *`);
});

// A browser paints the page once it has its style sheets and has run the
// first script, each a request of its own. Written into the page they come
// with it, and the answer allows them by their hashes.
test('the page carries its style sheets and its first script, and its answer allows them by their hashes', () => {
  const inline = new Map(PAGE_INLINE.map((file) => [file, fs.readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8')]));
  const page = renderPage(html, { ...german, inline });
  assert.ok(page.includes(`<script>${inline.get('first.js')}</script>`));
  assert.ok(page.includes(`<style>${inline.get('style.css')}</style>`));
  assert.ok(page.includes(`<style>${inline.get('vendor/maplibre-gl/maplibre-gl.css')}</style>`));
  assert.doesNotMatch(page, /<link rel="stylesheet"|<script src="first\.js">/);
  // (the script before the style sheets, as in the file: the colour scheme is settled before anything is drawn)
  assert.ok(page.indexOf('<script>') < page.indexOf('<style>'));
  // the hashes are of what stands between the tags
  const hashOf = (text) => `'sha256-${crypto.createHash('sha256').update(text).digest('base64')}'`;
  const hashes = inlineHashes(inline);
  assert.deepEqual(hashes, { styles: [hashOf(inline.get('style.css')), hashOf(inline.get('vendor/maplibre-gl/maplibre-gl.css'))], scripts: [hashOf(inline.get('first.js'))] });
  const policy = securityPolicy({ mapOrigins: ['https://tiles.example.org'] }, hashes);
  assert.ok(policy.includes(`; style-src 'self' ${hashes.styles[0]} ${hashes.styles[1]}; script-src 'self' ${hashes.scripts[0]}; worker-src 'self';`));
  // a file the page does not name is one too many
  assert.throws(() => renderPage(html, { ...german, inline: new Map([['other.css', 'p {}']]) }), /index\.html: nothing matches/);
  // without them the tags stay, and nothing inline is allowed
  assert.ok(renderPage(html, german).includes('<link rel="stylesheet" href="style.css">'));
  assert.ok(renderPage(html, german).includes('<script src="first.js"></script>'));
  assert.ok(securityPolicy({ mapOrigins: [] }).includes("; style-src 'self'; script-src 'self'; worker-src 'self';"));
});

test('the page names what it fetches at its start, and where its map comes from', () => {
  const modules = (page) => [...page.matchAll(/<link rel="modulepreload" href="([^"]*)"( fetchpriority="low")?>/g)].map(([, file]) => file);
  const page = renderPage(html, german);
  // its scripts, and the texts of its language with them
  assert.deepEqual(modules(page), [...PAGE_MODULES, 'locales/de.js']);
  // the texts and what puts them in first, the rest with less urgency
  for (const file of modules(page)) assert.equal(page.includes(`<link rel="modulepreload" href="${file}" fetchpriority="low">`), !(file === 'i18n.js' || file.startsWith('locales/')), file);
  for (const file of modules(page)) assert.ok(fs.existsSync(new URL(`../public/${file}`, import.meta.url)), file);
  // (English is among the scripts: every other language falls back on it)
  assert.deepEqual(modules(renderPage(html, { ...german, language: 'en', asked: 'en', texts: en })), PAGE_MODULES);
  // what the script asks the server first, in the way fetch() asks
  for (const address of ['api/area', 'api/status']) assert.ok(page.includes(`<link rel="preload" as="fetch" href="${address}" crossorigin>`), address);
  // and nothing of a map the server was not told of
  assert.equal(page.match(/rel="preload"/g).length, 2);
  assert.ok(!page.includes('rel="preconnect"'));

  // a style is fetched, and what it takes from other servers finds the connection made
  const styled = renderPage(html, { ...german, styleUrl: 'https://tiles.example.org/styles/bright?key=a&b=c', mapOrigins: ['https://tiles.example.org', 'https://fonts.example.org'] });
  assert.ok(styled.includes('<link rel="preload" as="fetch" href="https://tiles.example.org/styles/bright?key=a&#38;b=c" crossorigin>'));
  assert.deepEqual([...styled.matchAll(/<link rel="preconnect" href="([^"]*)" crossorigin>/g)].map(([, origin]) => origin), ['https://fonts.example.org']);

  // raster tiles have no style: the connection to their server, unless they come from several of one name
  const raster = renderPage(html, { ...german, mapOrigins: ['https://tile.example.org'] });
  assert.ok(raster.includes('<link rel="preconnect" href="https://tile.example.org" crossorigin>'));
  assert.equal(raster.match(/rel="preload"/g).length, 2);
  assert.ok(!renderPage(html, { ...german, mapOrigins: ['https://*.tile.example.org'] }).includes('rel="preconnect"'));
});

test('the operator\'s links stand at the foot of the header card, and nothing does without any', () => {
  const links = [{ text: 'Über', href: '/ueber' }, { text: 'Impressum & Kontakt', href: 'https://example.org/impressum?a=1&b=2' }];
  const page = renderPage(html, { ...german, links });
  const nav = /<nav class="links" id="links"([^>]*)>(.*?)<\/nav>/s.exec(page);
  assert.ok(!/\shidden/.test(nav[1]), 'the row is shown');
  assert.ok(nav[1].includes(` aria-label="${de['links.label']}"`));
  // a page on the same host takes the place of the map, one elsewhere opens in a new tab
  assert.equal(nav[2], '<a href="/ueber">Über</a>'
    + '<a href="https://example.org/impressum?a=1&#38;b=2" target="_blank" rel="noopener">Impressum &#38; Kontakt</a>');
  // inside the card, after everything else in it
  assert.ok(page.indexOf('id="links"') > page.indexOf('id="about-line"') && page.indexOf('id="links"') < page.indexOf('</header>'));

  // none: the row stays as the file has it, empty and hidden
  for (const none of [renderPage(html, german), renderPage(html, { ...german, links: [] })]) {
    assert.match(none, /<nav class="links" id="links"[^>]* hidden><\/nav>/);
    assert.ok(!none.includes('target="_blank"'));
  }
});

test('the header card has a chip for each kind of transport the timetable has, and none for the others', () => {
  const chips = (page) => [...page.matchAll(/<button type="button" class="chip" data-mode="([a-z]+)"[^>]*?( hidden)?>/g)].map(([, mode, hidden]) => (hidden ? `(${mode})` : mode));
  // as the file has them while there is no timetable: the six of most timetables
  assert.deepEqual(chips(renderPage(html, german)), ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', '(ferry)', '(cable)', '(other)']);
  // all of Germany, with its ferries and its cable cars and monorails
  const germany = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'ferry', 'cable'];
  assert.deepEqual(chips(renderPage(html, { ...german, kinds: germany })), [...germany, '(other)']);
  // a city with buses and trams alone
  assert.deepEqual(chips(renderPage(html, { ...german, kinds: ['tram', 'bus'] })), ['(subway)', 'tram', 'bus', '(suburban)', '(regional)', '(longdistance)', '(ferry)', '(cable)', '(other)']);
  // (with the name of the kind in the language of the page)
  assert.match(renderPage(html, { ...german, kinds: germany }), /<span class="name" data-i18n="mode\.cable">Seil- &#38; Schwebebahn<\/span>/);
});

test('files of the operator\'s own are found by their names, and only those that are there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-brand-'));
  try {
    assert.deepEqual(ownFiles(null), { files: new Map(), preview: null });
    assert.deepEqual(ownFiles(path.join(dir, 'not-there')), { files: new Map(), preview: null });
    assert.deepEqual(ownFiles(dir), { files: new Map(), preview: null });

    for (const name of ['favicon.svg', 'icon-512.png', 'preview.jpg', 'style.css', 'index.html']) fs.writeFileSync(path.join(dir, name), name);
    fs.mkdirSync(path.join(dir, 'icon-192.png')); // a folder of that name is no file
    const own = ownFiles(dir);
    // each under the address of the built-in one; nothing else of the page can be replaced
    assert.deepEqual([...own.files], [['favicon.svg', path.join(dir, 'favicon.svg')], ['icons/icon-512.png', path.join(dir, 'icon-512.png')], ['preview.jpg', path.join(dir, 'preview.jpg')]]);
    assert.equal(own.preview, 'preview.jpg');
    // of two pictures for previews, the png
    fs.writeFileSync(path.join(dir, 'preview.png'), 'png');
    assert.equal(ownFiles(dir).preview, 'preview.png');
    // every built-in icon there is to replace exists
    for (const address of ['favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']) {
      assert.ok(fs.existsSync(new URL(`../public/${address}`, import.meta.url)), address);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the size of a picture is read from its file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netnou-size-'));
  try {
    // a PNG: one of the page's own icons
    assert.deepEqual(pictureSize(new URL('../public/icons/icon-192.png', import.meta.url)), { width: 192, height: 192 });
    // a JPEG: start of image, an application segment to pass over, then the start of frame with height and width
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc2, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03, 0x01, 0x22, 0x00]);
    fs.writeFileSync(path.join(dir, 'preview.jpg'), jpeg);
    assert.deepEqual(pictureSize(path.join(dir, 'preview.jpg')), { width: 1200, height: 630 });
    // anything else, a file cut short and a file that is not there have none
    fs.writeFileSync(path.join(dir, 'preview.png'), 'not really a picture');
    fs.writeFileSync(path.join(dir, 'short.jpg'), jpeg.subarray(0, 10));
    for (const name of ['preview.png', 'short.jpg', 'not-there.png']) assert.equal(pictureSize(path.join(dir, name)), null, name);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a picture of the operator\'s own is what a preview of a link shows, large', () => {
  const page = renderPage(html, { ...german, preview: 'preview.png' });
  assert.equal(tag(page, /<meta property="og:image" content="([^"]*)"/), `${URL_}preview.png`);
  assert.equal(tag(page, /<meta name="twitter:card" content="([^"]*)"/), 'summary_large_image');
  // its size is said where it is known, and not claimed where it is not
  assert.ok(!page.includes('og:image:width'));
  const sized = renderPage(html, { ...german, preview: 'preview.png', previewSize: { width: 1200, height: 630 } });
  assert.equal(tag(sized, /<meta property="og:image:width" content="([^"]*)"/), '1200');
  assert.equal(tag(sized, /<meta property="og:image:height" content="([^"]*)"/), '630');
  // without one it is the icon, small, as before
  const plain = renderPage(html, german);
  assert.equal(tag(plain, /<meta name="twitter:card" content="([^"]*)"/), 'summary');
  assert.equal(tag(plain, /<meta property="og:image:width" content="([^"]*)"/), '512');
  // and without an address there is no picture to name
  const bare = renderPage(html, { ...german, preview: 'preview.png', publicUrl: null });
  assert.ok(!bare.includes('og:image'));
  assert.equal(tag(bare, /<meta name="twitter:card" content="([^"]*)"/), 'summary');
});

test('the installed app is called what the instance is called, in its language', () => {
  const file = fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8');
  const original = JSON.parse(file);
  const own = JSON.parse(renderManifest(file, { ...german, siteName: 'Bus & Bahn live' }));
  assert.deepEqual([own.name, own.short_name, own.lang], ['Bus & Bahn live', 'Bus & Bahn live', 'de']);
  assert.equal(own.description, de['page.descriptionIn'].replace('{area}', 'Großraum Nürnberg (VGN)'));
  // everything else is the file's: where it starts, how it looks, its icons
  assert.deepEqual({ ...own, name: 0, short_name: 0, lang: 0, description: 0 }, { ...original, name: 0, short_name: 0, lang: 0, description: 0 });
  assert.ok(own.icons.length >= 3 && own.start_url === './');
  // by default it is Netnou, in the main language of the instance
  const plain = JSON.parse(renderManifest(file, { ...german, language: 'en', texts: en, areaName: '' }));
  assert.deepEqual([plain.name, plain.short_name, plain.lang, plain.description], ['Netnou', 'Netnou', 'en', en['page.description']]);
});

test('an area without a name, and a name that is not plain text', () => {
  const nameless = renderPage(html, { ...german, areaName: '' });
  assert.equal(tag(nameless, /<title>([^<]*)<\/title>/), 'ÖPNV-Live-Karte – Netnou');
  assert.equal(tag(nameless, /<meta name="description" content="([^"]*)"/), de['page.description']);
  assert.equal(tag(nameless, /<p id="area-name">([^<]*)<\/p>/), '');

  // what an operator sets ends up as text, whatever it looks like
  const odd = renderPage(html, { ...german, areaName: 'Rhein & Ruhr <"$1">' });
  assert.equal(tag(odd, /<p id="area-name">([^<]*)<\/p>/), 'Rhein &#38; Ruhr &#60;&#34;$1&#34;&#62;');
  assert.ok(!odd.includes('<"$1">'));
  assert.match(tag(odd, /<title>([^<]*)<\/title>/), /^ÖPNV-Live-Karte: Rhein &#38; Ruhr /);
});

test('a page the server does not find its places in is no page', () => {
  assert.throws(() => renderPage(html.replace('<title>', '<title lang="en">'), german), /index\.html: nothing matches/);
  assert.throws(() => renderPage('<html lang="en"><head>\n</head></html>', german), /index\.html: nothing matches/);
});

test('robots.txt lets everything be read and names the sitemap where there is one', () => {
  assert.equal(robotsTxt(null), 'User-agent: *\nAllow: /\n');
  assert.equal(robotsTxt(URL_), `User-agent: *\nAllow: /\n\nSitemap: ${URL_}sitemap.xml\n`);
});

test('the sitemap lists the page once for the browser\'s language and once for each language', () => {
  const [xml, ...more] = sitemapFiles(URL_);
  assert.deepEqual(more, []);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'));
  assert.deepEqual([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => loc), [URL_, `${URL_}?lang=de`, `${URL_}?lang=en`]);
  // each with all of them as its versions
  const links = [...xml.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"\/>/g)].map(([, code, href]) => `${code} ${href}`);
  assert.equal(links.length, 9);
  assert.deepEqual(links.slice(0, 3), [`de ${URL_}?lang=de`, `en ${URL_}?lang=en`, `x-default ${URL_}`]);
  assert.deepEqual(links.slice(3, 6), links.slice(0, 3));
});
