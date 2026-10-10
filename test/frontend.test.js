// The page itself is not run here – that takes a browser. These tests keep in
// step what has to agree across files: the languages (i18n.js, locales/, sw.js),
// the keys of the texts (locales/, app.js, index.html) and the mode ids (server,
// page, style sheet). i18n.js needs no browser and is run as it is.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ATTRIBUTES, LANGUAGES, formatNumber, formatTime, loadLanguage, pageTexts, pickLanguage, setTimeZone, t } from '../public/i18n.js';
import en from '../public/locales/en.js';
import { MODES } from '../server/lib/timetable.js';

const publicDir = new URL('../public/', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, publicDir), 'utf8');

// Keys that are put together while the page runs, by what they start with. The
// rest of each is checked where it comes from (mode.<id>: see the mode ids below).
const DYNAMIC_KEYS = ['mode.'];

// A comment or a string literal. Good enough for the code as it is written
// here: no regular expression in it contains a quote or two slashes, and no
// template literal contains another one.
const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const withoutComments = (source) => source.replace(TOKEN, (token) => (token.startsWith('/') ? '' : token));

const shell = /const SHELL = \[([^\]]*)\]/.exec(read('sw.js'))[1].match(/'[^']+'/g).map((entry) => entry.slice(1, -1));
const codes = LANGUAGES.map(([code]) => code);
const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
const arrayIn = (source, name) => new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source)[1].match(/'[^']+'/g).map((entry) => entry.slice(1, -1));

test('the service worker precaches files that exist', () => {
  assert.ok(shell.length > 0);
  for (const file of shell) assert.ok(fs.existsSync(new URL(file === './' ? 'index.html' : file, publicDir)), `${file} in SHELL of sw.js does not exist`);
  for (const file of ['app.js', 'i18n.js', 'search.js', 'style.css']) assert.ok(shell.includes(file), `${file} is missing in SHELL of sw.js`);
});

// An installed app starts from the shell alone: a script in it that imports
// one that is not would leave the page blank without a connection.
test('what the scripts of the page import is precached with them', () => {
  for (const file of shell.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))) {
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    for (const [, target] of withoutComments(read(file)).matchAll(/\bfrom\s*['"]\.\/([^'"]+)['"]/g)) {
      assert.ok(shell.includes(folder + target), `${file} imports ${folder}${target}, which is not in SHELL of sw.js`);
    }
  }
});

test('a language is a file in locales/, an entry in LANGUAGES and one in the shell of the service worker', () => {
  const files = fs.readdirSync(new URL('locales/', publicDir)).map((name) => name.replace(/\.js$/, ''));
  const precached = shell.filter((file) => file.startsWith('locales/')).map((file) => file.slice('locales/'.length, -'.js'.length));
  assert.deepEqual(files.sort(), codes.toSorted(), 'the files in public/locales and LANGUAGES in i18n.js differ');
  assert.deepEqual(precached.sort(), codes.toSorted(), 'SHELL in sw.js and LANGUAGES in i18n.js differ');
  assert.ok(codes.includes('en'), 'English is the fallback');
  for (const [code, name] of LANGUAGES) {
    // pickLanguage compares with the primary subtag of the browser's languages
    assert.match(code, /^[a-z]{2,3}$/, `${code}: a language code without region`);
    assert.ok(name.trim(), `${code}: the name of the language`);
  }
});

test('every language has the texts of English, with the same placeholders and its own plural forms', async () => {
  for (const code of codes) {
    const messages = (await import(new URL(`locales/${code}.js`, publicDir))).default;
    assert.deepEqual(Object.keys(messages).sort(), Object.keys(en).sort(), `${code}: not the keys of en.js`);
    const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories.toSorted();
    for (const [key, reference] of Object.entries(en)) {
      const message = messages[key];
      if (typeof reference === 'string') {
        assert.equal(typeof message, 'string', `${code}: ${key} is a text in en.js`);
        assert.ok(message.trim(), `${code}: ${key} is empty`);
        assert.deepEqual(placeholders(message), placeholders(reference), `${code}: placeholders of ${key}`);
        continue;
      }
      assert.equal(typeof message, 'object', `${code}: ${key} has plural forms in en.js`);
      assert.deepEqual(Object.keys(message).sort(), forms, `${code}: plural forms of ${key}`);
      // A form may leave a placeholder out ("one vehicle"), 'other' has them all.
      const known = placeholders(reference.other);
      assert.deepEqual(placeholders(message.other), known, `${code}: placeholders of ${key}`);
      for (const [form, text] of Object.entries(message)) {
        assert.ok(typeof text === 'string' && text.trim(), `${code}: ${key}.${form} is empty`);
        assert.deepEqual(placeholders(text).filter((name) => !known.includes(name)), [], `${code}: placeholders of ${key}.${form}`);
      }
    }
  }
});

test('every key in use has a text and every text is in use', () => {
  const used = new Set();
  const scripts = fs.readdirSync(publicDir).filter((name) => name.endsWith('.js'));
  for (const name of scripts) {
    const code = withoutComments(read(name));
    for (const [, key] of code.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(key);
    for (const [, prefix] of code.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) assert.ok(DYNAMIC_KEYS.includes(prefix), `${name}: keys starting with ${prefix} are not in DYNAMIC_KEYS of this test`);
  }
  // In app.js the key of every text can be read off the call.
  for (const [call] of withoutComments(read('app.js')).matchAll(/\bt\([^)]{0,30}/g)) assert.match(call, /^t\(\s*['`]/, `app.js: ${call}… – a key this test cannot read`);
  for (const [, key] of read('index.html').matchAll(/\sdata-i18n(?:-[a-z-]+)?="([^"]*)"/g)) used.add(key);

  for (const key of used) assert.ok(key in en, `${key} is used but has no text in locales/en.js`);
  for (const key of Object.keys(en)) assert.ok(used.has(key) || DYNAMIC_KEYS.some((prefix) => key.startsWith(prefix)), `${key} in locales/en.js is not used`);
});

test('what index.html hides from screen readers is no stop for the keyboard either', () => {
  const hidden = read('index.html').match(/<[a-z][^>]*\saria-hidden="true"[^>]*>/g) ?? [];
  // the arrows of the row of filters
  assert.equal(hidden.length, 2);
  for (const tag of hidden) {
    assert.match(tag, /^<button /, tag);
    assert.match(tag, /\stabindex="-1"/, `${tag} could be reached with the Tab key`);
  }
});

test('index.html carries the English texts and marks them for translation', () => {
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.match(html, /<html lang="en">/);
  let marked = 0;
  // a start tag, the text that follows it and whether the element ends there
  for (const [, tag, attributeText, text, end] of html.matchAll(/<([a-z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>([^<]*)(?=(<\/?[\w-]*))/g)) {
    const attributes = new Map([...attributeText.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']));
    for (const [name, key] of attributes) {
      if (name === 'data-i18n') {
        // (translatePage replaces all the element contains)
        assert.equal(end, `</${tag}`, `<${tag} data-i18n="${key}"> may contain text only`);
        assert.equal(text, en[key], `<${tag} data-i18n="${key}">`);
        marked++;
      } else if (name.startsWith('data-i18n-')) {
        const attribute = name.slice('data-i18n-'.length);
        assert.ok(ATTRIBUTES.includes(attribute), `${name}: ${attribute} is not in ATTRIBUTES of i18n.js`);
        assert.equal(attributes.get(attribute), en[key], `<${tag} ${attribute}> with ${name}="${key}"`);
        marked++;
      }
    }
  }
  assert.ok(marked > 0);
  assert.equal(marked, html.match(/\sdata-i18n(-[a-z-]+)?=/g).length, 'a data-i18n attribute this test did not understand');
});

// app.js gets the elements of the page by their ids, and stops at the first
// one that is not there.
test('every element app.js asks for by its id is in index.html', () => {
  const html = read('index.html');
  const ids = new Set([...withoutComments(read('app.js')).matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]));
  assert.ok(ids.size > 10, 'the ids were not found in app.js');
  for (const id of ids) assert.ok(html.includes(` id="${id}"`), `app.js asks for #${id}, which is not in index.html`);
});

test('the dialog that says how it works is named by its heading, in the words of the button that opens it', () => {
  const html = read('index.html');
  const heading = /<dialog [^>]*aria-labelledby="([^"]+)"/.exec(html)[1];
  assert.match(html, new RegExp(`<h2 id="${heading}" data-i18n="about.title">`));
  assert.match(html, /<button [^>]*id="about-open"[^>]*data-i18n="about.title">/);
});

// Light or dark is the visitor's choice or else the device's scheme, and
// theme.js is the one place that decides it.
test('the colour scheme is put on the page first, and the style sheet follows it alone', () => {
  const html = read('index.html');
  const script = html.indexOf('<script src="theme.js"></script>');
  assert.ok(script > 0, 'index.html loads theme.js as a script that is waited for');
  assert.ok(script < html.indexOf('<link rel="stylesheet"'), 'theme.js comes before the style sheets');
  assert.ok(shell.includes('theme.js'), 'theme.js is missing in SHELL of sw.js');
  // (a media query would follow the device whatever the visitor chose)
  assert.doesNotMatch(read('style.css'), /prefers-color-scheme/);
  assert.match(read('style.css'), /^:root\[data-theme="dark"\] \{$/m);
  assert.match(read('theme.js'), /dataset\.theme = dark \? 'dark' : 'light'/);
  // the choices in the settings are the ones the script knows
  const choices = [...html.matchAll(/\sdata-theme-choice="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(choices, arrayIn(read('app.js'), 'THEMES'));
  // what app.js stores is what theme.js reads
  assert.match(read('app.js'), /saveSetting\('theme', /);
  assert.match(read('theme.js'), /localStorage\.getItem\('netnou\.theme'\)/);
});

// A pragmatic check, not a proof: it reads the string literals of app.js and
// knows nothing about where they end up.
test('app.js has no text for visitors of its own', () => {
  const source = read('app.js');
  // Literals of several words that are not text; what stands before them says so.
  const NOT_TEXT = [
    /console\.\w+\($/, /new Error\($/, // said to developers, in English
    /\bclass: $/, // class names
    /\.on\($/, // event names
    /\.font = $/, // a canvas font
  ];
  // Where a literal is written out as it is.
  const SINKS = /(\.textContent = |\btext: |\btitle: |'aria-label': |showBanner\(|showNote\(|\.fillText\()$/;
  const nonAsciiLetter = (text) => [...text].some((char) => char > '\x7f' && /\p{L}/u.test(char));

  let literals = 0;
  for (const match of source.matchAll(TOKEN)) {
    if (match[0].startsWith('/')) continue; // a comment
    const before = source.slice(0, match.index);
    const where = `app.js:${before.split('\n').length}: ${match[0]}`;
    // (what a template literal computes is not a literal)
    const literal = match[0].slice(1, -1).replace(/\$\{[^}]*\}/g, '');
    literals++;
    if (SINKS.test(before)) assert.doesNotMatch(literal, /\p{L}/u, `${where} – text belongs in locales/`);
    if (NOT_TEXT.some((context) => context.test(before))) continue;
    assert.ok(!/\p{L}{2,}\s+\p{L}{2,}/u.test(literal) && !nonAsciiLetter(literal), `${where} – text belongs in locales/`);
  }
  assert.ok(literals > 100, 'the literals of app.js were not found');
});

test('the mode ids of the server, the page, the style sheet and the texts are the same', () => {
  const app = read('app.js');
  const expected = MODES.toSorted();
  assert.deepEqual(arrayIn(app, 'DRAW_ORDER').sort(), expected, 'DRAW_ORDER in app.js');
  assert.deepEqual([...new Set([...read('style.css').matchAll(/^\s*--mode-([a-z]+):/gm)].map((match) => match[1]))].sort(), expected, '--mode-* in style.css');
  assert.deepEqual(Object.keys(en).filter((key) => key.startsWith('mode.')).map((key) => key.slice('mode.'.length)).sort(), expected, 'mode.* in locales/en.js');
  for (const name of ['MODES', 'RAIL_MODES']) for (const mode of arrayIn(app, name)) assert.ok(MODES.includes(mode), `${mode} in ${name} of app.js`);
});

// The button for the visitor's own position is the page's, its icons are the
// library's: an update of the library that renames them would leave it blank.
test('the classes app.js borrows from the map library are in its style sheet', () => {
  const css = read('vendor/maplibre-gl/maplibre-gl.css');
  const borrowed = new Set(read('app.js').match(/\bmaplibregl-[a-z-]+/g));
  assert.ok(borrowed.size > 0, 'the classes were not found in app.js');
  for (const name of borrowed) assert.match(css, new RegExp(`\\.${name}(?![\\w-])`), `.${name} is not in the style sheet of MapLibre`);
});

// MapLibre fades nothing in while it loads its first style. A style given at
// the start, even an empty one, would be that first one: the map of the area
// would come after it and be drawn frame after frame while its tiles arrive.
test('the map starts without a style, and raster tiles do not fade in', () => {
  const app = withoutComments(read('app.js'));
  const options = /new MapLibreMap\(\{([\s\S]*?)\n {2}\}\);/.exec(app);
  assert.ok(options, 'the options of the map were not found in app.js');
  assert.doesNotMatch(options[1], /^\s*style:/m, 'the map is created with a style');
  assert.match(app, /'raster-fade-duration': 0/);
});

// ('xx' stands for a language the page does not have, whatever is added to it)
test('the language is the stored choice, else the first language of the browser that exists, else English', () => {
  assert.equal(pickLanguage('de', ['en-US']), 'de');
  assert.equal(pickLanguage('en', ['de-DE']), 'en');
  assert.equal(pickLanguage(null, ['xx-XX', 'de-AT', 'en']), 'de');
  assert.equal(pickLanguage(null, ['en-GB', 'de']), 'en');
  assert.equal(pickLanguage('xx', ['DE-de']), 'de'); // stored by another version of the page
  assert.equal(pickLanguage(null, ['xx']), 'en');
  assert.equal(pickLanguage(null, []), 'en');
});

// ?lang=de is how a search engine, whose browser speaks English, reads the page in German.
test('an address that asks for a language gets it, unless the visitor chose one themselves', () => {
  assert.equal(pickLanguage(null, ['en-US'], 'de'), 'de');
  assert.equal(pickLanguage(null, [], 'de'), 'de');
  assert.equal(pickLanguage('en', ['de-DE'], 'de'), 'en');
  assert.equal(pickLanguage(null, ['de-DE'], 'xx'), 'de');
  assert.equal(pickLanguage(null, ['de-DE'], ''), 'de');
  assert.equal(pickLanguage(null, ['xx'], null), 'en');
});

test('what the page is called and says about itself, with and without the name of its area', async () => {
  const de = (await import(new URL('locales/de.js', publicDir))).default;
  await loadLanguage('en', []);
  assert.deepEqual(pageTexts('Testland'), { title: 'Live map of public transport: Testland – Netnou', description: en['page.descriptionIn'].replace('{area}', 'Testland') });
  assert.deepEqual(pageTexts(''), { title: 'Live map of public transport – Netnou', description: en['page.description'] });
  // in another language than the visitor's, as the server asks for it
  assert.deepEqual(pageTexts('Testland', de), { title: 'ÖPNV-Live-Karte: Testland – Netnou', description: de['page.descriptionIn'].replace('{area}', 'Testland') });
  // an instance with a name of its own
  assert.equal(pageTexts('Testland', de, 'Bus & Bahn live').title, 'ÖPNV-Live-Karte: Testland – Bus & Bahn live');
  assert.equal(pageTexts('', undefined, 'Bus & Bahn live').title, 'Live map of public transport – Bus & Bahn live');
  assert.equal(t('page.title', {}, de), 'ÖPNV-Live-Karte');
  assert.equal(t('page.title'), 'Live map of public transport');
});

test('texts with placeholders and plural forms, numbers and times in the language', async () => {
  const de = (await import(new URL('locales/de.js', publicDir))).default;
  const plain = (text) => text.replace(/\s/g, ' '); // newer ICU data puts a narrow no-break space before AM

  assert.equal(await loadLanguage('de', ['en-US']), 'de');
  assert.equal(t('status.vehicles', { count: 1 }), de['status.vehicles'].one.replace('{count}', '1'));
  assert.equal(t('status.vehicles', { count: 1234 }), de['status.vehicles'].other.replace('{count}', '1.234'));
  assert.equal(t('trip.source', { source: 'VAG' }), de['trip.source'].replace('{source}', 'VAG'));
  assert.equal(t('trip.source'), de['trip.source']); // nothing to put in: the placeholder stays
  assert.equal(t('no.such.key'), 'no.such.key');
  // the clocks of the area, not of the visitor
  setTimeZone('Europe/Berlin');
  assert.equal(formatTime(0), '01:00');
  setTimeZone('America/New_York');
  assert.equal(formatTime(0), '19:00');

  assert.equal(await loadLanguage(null, ['xx', 'en-US', 'de']), 'en');
  assert.equal(t('status.vehicles', { count: 1 }), en['status.vehicles'].one.replace('{count}', '1'));
  assert.equal(t('status.vehicles', { count: 1234 }), en['status.vehicles'].other.replace('{count}', '1,234'));
  assert.equal(formatNumber(1234), '1,234');
  assert.equal(plain(formatTime(0)), '7:00 PM');
  setTimeZone('Europe/Berlin');
  assert.equal(plain(formatTime(0)), '1:00 AM');
  // the regional variant the browser asks for decides how times are written
  await loadLanguage('en', ['de', 'en-GB']);
  assert.equal(formatTime(0), '01:00');
});
