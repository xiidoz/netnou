// What the server writes into the page before it sends it (server/lib/page.js),
// tried on the real index.html: if that file changes in a way the server does
// not find its places in any more, this is where it shows.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { LANGUAGES, pageTexts } from '../public/i18n.js';
import de from '../public/locales/de.js';
import en from '../public/locales/en.js';
import { LANGUAGE_CODES, renderPage, robotsTxt, sitemapXml } from '../server/lib/page.js';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const URL_ = 'https://karte.example.org/live/';
const tag = (page, pattern) => pattern.exec(page)?.[1];
const german = { language: 'de', asked: null, texts: de, areaName: 'Großraum Nürnberg (VGN)', publicUrl: URL_ };

test('the languages of the page are those of its texts', () => {
  assert.deepEqual(LANGUAGE_CODES, LANGUAGES.map(([code]) => code));
});

test('the page says what and where it is, in the language of the instance', () => {
  const page = renderPage(html, german);
  assert.match(page, /<html lang="de">/);
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

  // nothing else of the file is touched: with what was added taken out and the four places put back, it is the file
  const added = page.slice(page.indexOf('  <meta property="og:type"'), page.indexOf('</head>'));
  const back = page.replace(added, '').replace('<html lang="de">', '<html lang="en">').replace(/<title>[^<]*<\/title>/, '<title>Netnou</title>')
    .replace(description, en['page.description']).replace('<p id="area-name">Großraum Nürnberg (VGN)</p>', '<p id="area-name"></p>');
  assert.equal(back, html);
});

test('the page names its address and its versions in other languages', () => {
  const page = renderPage(html, german);
  assert.equal(tag(page, /<link rel="canonical" href="([^"]*)"/), URL_);
  assert.equal(tag(page, /<meta property="og:url" content="([^"]*)"/), URL_);
  const versions = [...page.matchAll(/<link rel="alternate" hreflang="([^"]*)" href="([^"]*)"/g)].map(([, code, href]) => [code, href]);
  assert.deepEqual(versions, [['de', `${URL_}?lang=de`], ['en', `${URL_}?lang=en`], ['x-default', URL_]]);

  // asked for in English: the same versions, and this one is the address of its own
  const english = renderPage(html, { ...german, language: 'en', asked: 'en', texts: en });
  assert.match(english, /<html lang="en">/);
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
  const xml = sitemapXml(URL_);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'));
  assert.deepEqual([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => loc), [URL_, `${URL_}?lang=de`, `${URL_}?lang=en`]);
  // each with all of them as its versions
  const links = [...xml.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"\/>/g)].map(([, code, href]) => `${code} ${href}`);
  assert.equal(links.length, 9);
  assert.deepEqual(links.slice(0, 3), [`de ${URL_}?lang=de`, `en ${URL_}?lang=en`, `x-default ${URL_}`]);
  assert.deepEqual(links.slice(3, 6), links.slice(0, 3));
});
