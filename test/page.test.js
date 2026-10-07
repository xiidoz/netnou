// What the server writes into the page before it sends it (server/lib/page.js),
// tried on the real index.html: if that file changes in a way the server does
// not find its places in any more, this is where it shows.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LANGUAGES, pageTexts } from '../public/i18n.js';
import de from '../public/locales/de.js';
import en from '../public/locales/en.js';
import { LANGUAGE_CODES, ownFiles, renderManifest, renderPage, robotsTxt, sitemapXml } from '../server/lib/page.js';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const URL_ = 'https://karte.example.org/live/';
const tag = (page, pattern) => pattern.exec(page)?.[1];
const german = { language: 'de', asked: null, texts: de, siteName: 'Netnou', areaName: 'Großraum Nürnberg (VGN)', publicUrl: URL_, listed: true };

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
  // (the name is the software's own here, as in the file)
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

test('the operator\'s links stand at the foot of the header card, and nothing does without any', () => {
  const links = [{ text: 'Über', href: '/ueber' }, { text: 'Impressum & Kontakt', href: 'https://example.org/impressum?a=1&b=2' }];
  const page = renderPage(html, { ...german, links });
  const nav = /<nav class="links" id="links"([^>]*)>(.*?)<\/nav>/s.exec(page);
  assert.ok(!/\shidden/.test(nav[1]), 'the row is shown');
  assert.match(nav[1], /aria-label="About this service"/);
  assert.equal(nav[2], '<a href="/ueber" target="_blank" rel="noopener">Über</a>'
    + '<a href="https://example.org/impressum?a=1&#38;b=2" target="_blank" rel="noopener">Impressum &#38; Kontakt</a>');
  // inside the card, after everything else in it
  assert.ok(page.indexOf('id="links"') > page.indexOf('id="about-line"') && page.indexOf('id="links"') < page.indexOf('</header>'));

  // none: the row stays as the file has it, empty and hidden
  for (const none of [renderPage(html, german), renderPage(html, { ...german, links: [] })]) {
    assert.match(none, /<nav class="links" id="links"[^>]* hidden><\/nav>/);
    assert.ok(!none.includes('target="_blank"'));
  }
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

test('a picture of the operator\'s own is what a preview of a link shows, large', () => {
  const page = renderPage(html, { ...german, preview: 'preview.png' });
  assert.equal(tag(page, /<meta property="og:image" content="([^"]*)"/), `${URL_}preview.png`);
  assert.equal(tag(page, /<meta name="twitter:card" content="([^"]*)"/), 'summary_large_image');
  // its size is not known and not claimed
  assert.ok(!page.includes('og:image:width'));
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
  const xml = sitemapXml(URL_);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'));
  assert.deepEqual([...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(([, loc]) => loc), [URL_, `${URL_}?lang=de`, `${URL_}?lang=en`]);
  // each with all of them as its versions
  const links = [...xml.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]*)" href="([^"]*)"\/>/g)].map(([, code, href]) => `${code} ${href}`);
  assert.equal(links.length, 9);
  assert.deepEqual(links.slice(0, 3), [`de ${URL_}?lang=de`, `en ${URL_}?lang=en`, `x-default ${URL_}`]);
  assert.deepEqual(links.slice(3, 6), links.slice(0, 3));
});
