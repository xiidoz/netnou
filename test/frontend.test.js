// The page itself is not run here – that takes a browser. These tests keep in
// step what has to agree across files: the languages (i18n.js, locales/, sw.js),
// the keys of the texts (locales/, app.js, index.html) and the mode ids (server,
// page, style sheet). i18n.js needs no browser and is run as it is.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { ATTRIBUTES, LANGUAGES, READMES, dayOf, formatNumber, formatTime, loadLanguage, pageTexts, pickLanguage, sentInAnother, setTimeZone, t } from '../public/i18n.js';
import en from '../public/locales/en.js';
import { tomorrowAt as nextDayAt } from '../public/panel.js';
import { PAGE_INLINE, PAGE_MODULES } from '../server/lib/page.js';
import { MODES } from '../server/lib/timetable.js';

const publicDir = new URL('../public/', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, publicDir), 'utf8');

// Keys that are put together while the page runs, by what they start with. The
// rest of each is checked where it comes from (mode.<id>: see the mode ids below).
const DYNAMIC_KEYS = ['mode.', 'address.kind.'];

// A comment or a string literal. Good enough for the code as it is written
// here: no regular expression in it contains a quote or two slashes, and no
// template literal contains another one.
const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const withoutComments = (source) => source.replace(TOKEN, (token) => (token.startsWith('/') ? '' : token));

const shell = /const SHELL = \[([^\]]*)\]/.exec(read('sw.js'))[1].match(/'[^']+'/g).map((entry) => entry.slice(1, -1));
const codes = LANGUAGES.map(([code]) => code);
const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
const arrayIn = (source, name) => new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(source)[1].match(/'[^']+'/g).map((entry) => entry.slice(1, -1));

/**
 * Runs first.js as a browser does before it draws the page, and returns what
 * the script has put on the root of the page.
 * @param lang     the language the page came in
 * @param search   the query of its address
 * @param stored   what the browser has kept, by its key
 * @param browser  the languages of the browser, most wanted first
 * @param dark     whether the device has the dark scheme
 * @param blocked  whether the browser refuses to keep or tell anything
 */
function firstScript({ lang = 'en', search = '', stored = {}, browser = [], dark = false, blocked = false } = {}) {
  const root = { lang, dataset: { languages: codes.join(' ') } };
  const getItem = (key) => {
    if (blocked) throw new Error('blocked');
    return stored[key] ?? null;
  };
  const document = { documentElement: root, baseURI: 'https://karte.example.org/live/', head: { appendChild: (node) => node }, createElement: () => ({}), querySelector: () => null };
  const context = { document, location: { search }, navigator: { languages: browser }, localStorage: { getItem }, matchMedia: () => ({ matches: dark }), URL, URLSearchParams };
  context.window = context;
  vm.runInNewContext(read('first.js'), context);
  return root.dataset;
}

// The page changes the address in the bar when a stop or a line is opened
// (#37): its own files and data are found from where the instance is all the
// same, which first.js makes the base of the page, as a whole address.
test('first.js keeps where the instance is as the base of the page, also at the address of a stop', () => {
  for (const sent of [null, { href: '../' }]) {
    const made = [];
    const document = { documentElement: { lang: 'de', dataset: { languages: codes.join(' ') } }, baseURI: 'https://karte.example.org/live/', head: { appendChild: (node) => made.push(node) && node }, createElement: () => ({}), querySelector: (selector) => (selector === 'base' ? sent : null) };
    const context = { document, location: { search: '' }, navigator: { languages: [] }, localStorage: { getItem: () => null }, matchMedia: () => ({ matches: false }), URL, URLSearchParams };
    context.window = context;
    vm.runInNewContext(read('first.js'), context);
    assert.equal((sent ?? made[0]).href, 'https://karte.example.org/live/');
    assert.equal(made.length, sent ? 0 : 1);
  }
});

test('the service worker precaches files that exist', () => {
  assert.ok(shell.length > 0);
  for (const file of shell) assert.ok(fs.existsSync(new URL(file === './' ? 'index.html' : file, publicDir)), `${file} in SHELL of sw.js does not exist`);
  for (const file of ['app.js', 'i18n.js', 'search.js']) assert.ok(shell.includes(file), `${file} is missing in SHELL of sw.js`);
  // (the style sheets and the first script come within the page, which is in the shell)
  for (const file of PAGE_INLINE) assert.ok(!shell.includes(file), `${file} comes within the page and need not be in SHELL of sw.js`);
});

// A browser paints the page once it has its style sheets and has run the
// script it waits for. The server writes them into the page as it sends it
// (PAGE_INLINE in server/lib/page.js), so that no request for them comes
// before the first paint; index.html names them as files all the same.
test('what the page waits for before it paints is what the server writes into it', () => {
  const html = read('index.html');
  const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]*)">/g)].map(([, file]) => file);
  const waited = [...html.matchAll(/<script src="([^"]*)"><\/script>/g)].map(([, file]) => file);
  assert.deepEqual(PAGE_INLINE.toSorted(), [...sheets, ...waited].sort());
  for (const file of PAGE_INLINE) {
    assert.ok(fs.existsSync(new URL(file, publicDir)), `${file} does not exist`);
    // (what is between the tags must not end them)
    assert.doesNotMatch(read(file), /<\/(style|script)/i, `${file} would end its own tag`);
  }
});

// The search runs in a thread of its own, which the page starts by the name
// of its script. An installed app has that script with the others.
test('the thread the page starts is a script of its own that is precached', () => {
  const started = [...withoutComments(read('app.js')).matchAll(/new Worker\('([^']+)', \{ type: 'module' \}\)/g)].map(([, file]) => file);
  assert.deepEqual(started, ['search-worker.js']);
  for (const file of started) assert.ok(shell.includes(file), `${file} is missing in SHELL of sw.js`);
  // (it fetches the list from where the page has its data)
  assert.match(withoutComments(read('search-worker.js')), /fetch\('api\/search'\)/);
});

// The page is sent in the language its browser asks for, and says so (Vary). A
// start without a connection takes the one that was kept, whatever the browser
// asks for by then: a cache that held that against it would have no page at all.
test('the service worker finds the page it kept, whatever is asked for besides', () => {
  assert.match(withoutComments(read('sw.js')), /caches\.match\(request, \{ ignoreSearch: true, ignoreVary: true \}\)/);
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

// The server names the scripts of the page in its head, so that a browser
// fetches them all at once (PAGE_MODULES in server/lib/page.js). One that is
// missing there is fetched late, and one too many for nothing.
test('the scripts the page starts with are the ones the server names', () => {
  const found = new Set(['app.js']);
  for (const file of found) {
    const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    for (const [, target] of withoutComments(read(file)).matchAll(/\bfrom\s*['"]\.\/([^'"]+)['"]/g)) found.add(folder + target);
  }
  assert.deepEqual([...found].sort(), PAGE_MODULES.toSorted());
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

test('every README names the languages of all of them at its top, its own as text and the others as links', () => {
  // (English first, the main one; then the others of READMES, each in its own name as LANGUAGES has it)
  const readmes = [['en', 'README.md'], ...READMES.map((code) => [code, `README.${code}.md`])];
  const nameOf = (code) => LANGUAGES.find(([language]) => language === code)?.[1];
  for (const [code, file] of readmes) {
    assert.ok(nameOf(code), `${code} is not a language of the page`);
    const row = readmes.map(([other, otherFile]) => (other === code ? nameOf(other) : `<a href="${otherFile}">${nameOf(other)}</a>`)).join(' • ');
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(text.split('\n').some((line) => line.trim() === row), `${file} does not name the languages as: ${row}`);
  }
});

test('every picture the READMEs show is a file of the repository', () => {
  for (const file of ['README.md', ...READMES.map((code) => `README.${code}.md`)]) {
    const text = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const pictures = [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)|<img\s[^>]*src="([^"]+)"/g)].map(([, markdown, html]) => markdown ?? html);
    assert.ok(pictures.length > 0, `${file} shows no pictures`);
    for (const picture of pictures.filter((src) => !/^https?:/.test(src))) assert.ok(fs.existsSync(new URL(`../${picture}`, import.meta.url)), `${file} shows ${picture}, which is not there`);
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
  // (and those the server writes into the page at the address of a stop or a line, #37)
  for (const name of ['index.js', 'lib/addresses.js']) {
    for (const [, key] of withoutComments(fs.readFileSync(new URL(`../server/${name}`, import.meta.url), 'utf8')).matchAll(/\bt\(\s*'([^']+)'/g)) used.add(key);
  }
  // In app.js and panel.js the key of every text can be read off the call.
  for (const name of ['app.js', 'panel.js']) {
    for (const [call] of withoutComments(read(name)).matchAll(/\bt\([^)]{0,30}/g)) assert.match(call, /^t\(\s*['`]/, `${name}: ${call}… – a key this test cannot read`);
  }
  for (const [, key] of read('index.html').matchAll(/\sdata-i18n(?:-[a-z-]+)?="([^"]*)"/g)) used.add(key);

  for (const key of used) assert.ok(key in en, `${key} is used but has no text in locales/en.js`);
  for (const key of Object.keys(en)) assert.ok(used.has(key) || DYNAMIC_KEYS.some((prefix) => key.startsWith(prefix)), `${key} in locales/en.js is not used`);
});

test('what index.html hides from screen readers is no stop for the keyboard either', () => {
  const hidden = read('index.html').match(/<[a-z][^>]*\saria-hidden="true"[^>]*>/g) ?? [];
  // the arrows of the row of filters on a phone
  assert.equal(hidden.length, 2);
  for (const tag of hidden) {
    assert.match(tag, /^<button /, tag);
    assert.match(tag, /\stabindex="-1"/, `${tag} could be reached with the Tab key`);
  }
});

test('index.html carries the English texts and marks them for translation', () => {
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  // (as the browser reads them: "&#38;" is "&", as the server writes it, see escapeHtml in server/lib/page.js)
  const decoded = (value) => value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  assert.match(html, /<html lang="en">/);
  let marked = 0;
  // a start tag, the text that follows it and whether the element ends there
  for (const [, tag, attributeText, text, end] of html.matchAll(/<([a-z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*>([^<]*)(?=(<\/?[\w-]*))/g)) {
    const attributes = new Map([...attributeText.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']));
    for (const [name, key] of attributes) {
      if (name === 'data-i18n') {
        // (translatePage replaces all the element contains)
        assert.equal(end, `</${tag}`, `<${tag} data-i18n="${key}"> may contain text only`);
        assert.equal(decoded(text), en[key], `<${tag} data-i18n="${key}">`);
        marked++;
      } else if (name.startsWith('data-i18n-')) {
        const attribute = name.slice('data-i18n-'.length);
        assert.ok(ATTRIBUTES.includes(attribute), `${name}: ${attribute} is not in ATTRIBUTES of i18n.js`);
        assert.equal(decoded(attributes.get(attribute)), en[key], `<${tag} ${attribute}> with ${name}="${key}"`);
        marked++;
      }
    }
  }
  assert.ok(marked > 0);
  assert.equal(marked, html.match(/\sdata-i18n(-[a-z-]+)?=/g).length, 'a data-i18n attribute this test did not understand');
});

// app.js gets the elements of the page by their ids, and stops at the first
// one that is not there.
test('what app.js writes into the address bar keeps the stop or the line that is open', () => {
  // (the page has a base, where the instance is: an address of a query alone would be taken from there, without the path)
  const writes = [...withoutComments(read('app.js')).matchAll(/history\.(?:push|replace)State\([^,]+, '', ([^;]*)\);/g)];
  assert.ok(writes.length >= 4, `only ${writes.length} writes found`);
  for (const [call, address] of writes) assert.match(address, /^(`\$\{location\.pathname\}|new URL\()/, call);
});

test('every element app.js asks for by its id is in index.html', () => {
  const html = read('index.html');
  const ids = new Set([...withoutComments(read('app.js')).matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]));
  assert.ok(ids.size > 10, 'the ids were not found in app.js');
  for (const id of ids) assert.ok(html.includes(` id="${id}"`), `app.js asks for #${id}, which is not in index.html`);
});

// Back goes to what was open before, one step (#188, #190). What is opened
// next gets an address of its own once the server has answered (showAddress
// in loadSelection), and what closes a board, or opens a line or a trip after
// it, leaves the board's address as it was: only a board that changes in
// place (its button, its edge, its stops) writes it anew.
test('what is opened or closed after a board or a vehicle on the map leaves a step back to what was open', () => {
  const app = withoutComments(read('app.js'));
  assert.deepEqual(app.match(/setBoard\(null\b[^)]*\)/g), ['setBoard(null, false)', 'setBoard(null, false)']);
  // (the next address has a board where one is shown, not where the address before had one; and the lines chosen of a stop that is open, #164)
  // (with the name of the details it was opened from, where it was, for the way back to them)
  assert.match(app, /history\.pushState\(from \? \{ from \} : null, '', new URL\(`\$\{path\}\$\{boardQuery\(location\.search, state\.board, state\.extra, state\.lines\)\}`/);
  // (a vehicle chosen on the map goes straight to its trip, not by the map alone)
  const click = app.slice(app.indexOf("map.on('click'"));
  assert.doesNotMatch(click.slice(0, click.indexOf('});')), /showAddress/);
});

test('the dialog that says how it works is named by its heading, in the words of the button that opens it', () => {
  const html = read('index.html');
  const heading = /<dialog [^>]*aria-labelledby="([^"]+)"/.exec(html)[1];
  assert.match(html, new RegExp(`<h2 id="${heading}" data-i18n="about.title">`));
  assert.match(html, /<button [^>]*id="about-open"[^>]*data-i18n="about.title">/);
});

// Light or dark is the visitor's choice or else the device's scheme, and
// first.js is the one place that decides it.
test('the colour scheme is put on the page first, and the style sheet follows it alone', () => {
  const html = read('index.html');
  const script = html.indexOf('<script src="first.js"></script>');
  assert.ok(script > 0, 'index.html loads first.js as a script that is waited for');
  assert.ok(script < html.indexOf('<link rel="stylesheet"'), 'first.js comes before the style sheets');
  // (a media query would follow the device whatever the visitor chose)
  assert.doesNotMatch(read('style.css'), /prefers-color-scheme/);
  assert.match(read('style.css'), /^:root\[data-theme="dark"\] \{$/m);
  // the choices in the settings are the ones the script knows
  const choices = [...html.matchAll(/\sdata-theme-choice="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(choices, arrayIn(read('app.js'), 'THEMES'));
  // what app.js stores is what first.js reads
  assert.match(read('app.js'), /saveSetting\('theme', /);

  assert.equal(firstScript().theme, 'light');
  assert.equal(firstScript({ dark: true }).theme, 'dark');
  assert.equal(firstScript({ dark: true, stored: { 'netnou.theme': '"light"' } }).theme, 'light');
  assert.equal(firstScript({ stored: { 'netnou.theme': '"dark"' } }).theme, 'dark');
  assert.equal(firstScript({ dark: true, stored: { 'netnou.theme': '"auto"' } }).theme, 'dark');
  // (written by another version of the page, or not to be read at all)
  assert.equal(firstScript({ dark: true, stored: { 'netnou.theme': 'dark{' } }).theme, 'dark');
  assert.equal(firstScript({ dark: true, blocked: true }).theme, 'dark');
  // a display has its scheme from its address, whatever is stored
  assert.equal(firstScript({ search: '?display&theme=dark', stored: { 'netnou.theme': '"light"' } }).theme, 'dark');
  assert.equal(firstScript({ search: '?display=fixed', dark: true, stored: { 'netnou.theme': '"light"' } }).theme, 'dark');
});

// The header card is in the page as most visitors get it, and shows before
// the scripts have run where it is what this visitor gets (first.js). For
// that the page, its style sheet and its scripts have to agree on what the
// card is like as it comes.
test('the header card comes as most visitors get it', () => {
  const html = read('index.html');
  const css = read('style.css');
  const app = read('app.js');
  const card = /<header class="card controls" id="controls">[\s\S]*?<\/header>/.exec(html)?.[0];
  assert.ok(card, 'the header card was not found, or is hidden by an attribute of its own');
  // out of sight until a script says that it is what the visitor gets
  assert.ok(css.includes(':root:not([data-controls]) .controls { display: none; }'));
  assert.match(read('first.js'), /root\.dataset\.controls = 'shown'/);
  assert.match(app, /document\.documentElement\.dataset\.controls = 'shown'/);

  // a chip for every mode, switched on, in its colour and with its name; those
  // of the kinds that only some timetables have are hidden until the server
  // shows them (test/page.test.js)
  const modes = arrayIn(app, 'MODES');
  const chips = [...card.matchAll(/<button type="button" class="chip" data-mode="([a-z]+)" aria-pressed="true"( hidden)?><span class="swatch"><\/span><span class="name" data-i18n="mode\.([a-z]+)">[^<]+<\/span><span class="count">0<\/span><\/button>/g)];
  assert.deepEqual(chips.map(([, mode]) => mode), modes);
  assert.deepEqual(chips.filter(([, , hidden]) => hidden).map(([, mode]) => mode), ['ferry', 'cable', 'other']);
  assert.equal(card.match(/class="chip"/g).length, modes.length);
  for (const [, mode, , key] of chips) {
    assert.equal(key, mode);
    assert.ok(css.includes(`.chip[data-mode="${mode}"] { --chip-color: var(--mode-${mode}); }`), `the colour of the chip of ${mode}`);
  }
  // the delays as numbers on vehicles coloured by kind, as the settings have it first (#220), and so without the legend of the delays
  assert.match(card, /<button type="button" data-delays-choice="number" aria-pressed="true"/);
  assert.match(card, /<button type="button" data-delays-choice="color" aria-pressed="false"/);
  assert.match(card, /<button type="button" data-delays-choice="off" aria-pressed="false"/);
  assert.match(card, /<ul class="legend" id="delay-legend" hidden><\/ul>/);
  // of the arrows of the row of chips the one at its end, where the row goes on
  assert.match(card, /<button type="button" class="chips-more back" id="modes-back" [^>]*\shidden>/);
  assert.match(card, /<button type="button" class="chips-more" id="modes-on" [^>]*"true">/);
  // an icon wherever the card has one; the server draws them (test/page.test.js)
  for (const part of ['id="search-open"', 'id="display-toggle"', 'id="settings-open"', 'class="search-sign"']) assert.match(card, new RegExp(`<[a-z]+ [^>]*${part}[^>]*\\sdata-icon="mdi\\w+"|<[a-z]+ [^>]*\\sdata-icon="mdi\\w+"[^>]*${part}`), part);
  // (an element that asks for an icon is empty: the icon is all it holds)
  assert.equal(html.match(/\sdata-icon="[^"]*"[^>]*><\//g).length, html.match(/\sdata-icon=/g).length);
});

test('the header card shows at once where the page came as this visitor gets it', () => {
  const shown = (situation) => firstScript(situation).controls === 'shown';
  // the language of the page is the visitor's: picked as i18n.js picks it
  const browsers = [[], ['xx'], ['de-DE', 'en'], ['en-US'], ['xx-XX', 'de-AT', 'en'], ['EN-gb', 'de'], ['fr', 'en', 'de']];
  for (const lang of codes) {
    for (const browser of browsers) {
      for (const stored of [null, ...codes, 'xx']) {
        for (const asked of [null, ...codes, 'xx', '']) {
          const situation = { lang, browser, stored: stored === null ? {} : { 'netnou.lang': stored }, search: asked === null ? '' : `?lang=${asked}` };
          assert.equal(shown(situation), pickLanguage(stored, browser, asked) === lang, JSON.stringify(situation));
        }
      }
    }
  }
  assert.ok(shown({ lang: 'de', browser: ['de-DE'] }));
  assert.ok(!shown({ lang: 'de', browser: ['en-US'] }));
  // (a browser of no language the page has gets English)
  assert.ok(shown({ lang: 'en', browser: ['xx'] }));
  // (a browser that keeps nothing has chosen nothing)
  assert.ok(shown({ lang: 'de', browser: ['de'], blocked: true }));
  assert.ok(!shown({ lang: 'en', browser: ['de'], blocked: true }));
  // the key the choice of a language is kept under
  assert.match(read('i18n.js'), /^const STORAGE_KEY = 'netnou\.lang';$/m);

  // a display is the page without most of the card
  assert.ok(!shown({ search: '?display' }));
  assert.ok(!shown({ search: '?display=fixed&lang=en' }));
  // modes switched off and colours by delay change the card: read as app.js reads them
  assert.ok(!shown({ stored: { 'netnou.colorBy': '"delay"' } }));
  assert.ok(shown({ stored: { 'netnou.colorBy': '"mode"' } }));
  assert.ok(!shown({ stored: { 'netnou.hiddenModes': '["bus"]' } }));
  assert.ok(shown({ stored: { 'netnou.hiddenModes': '[]' } }));
  // (not what the page stored: app.js takes the card as it comes then, too)
  assert.ok(shown({ stored: { 'netnou.colorBy': 'delay', 'netnou.hiddenModes': '{"bus":1}' } }));
  assert.ok(shown({ stored: { 'netnou.hiddenModes': 'bus,tram' } }));
  assert.match(read('app.js'), /loadSetting\('colorBy', 'mode'\) === 'delay'/);
  assert.match(read('app.js'), /loadSetting\('hiddenModes', \[\]\)/);
  // what does not show in the card leaves it as it comes
  assert.ok(shown({ dark: true, stored: { 'netnou.theme': '"dark"', 'netnou.flags': 'false', 'netnou.view': '{"lat":49.4,"lon":11,"zoom":14}' } }));
});

// The script puts the title and the description of the page into the visitor's
// language. Where the operator has words of their own for them (NETNOU_SITE_TITLE,
// NETNOU_SITE_DESCRIPTION), the server sends those and tells the script of them with
// the area, by language; the script has to take them, or a search engine,
// which runs it, reads the page's own words after all.
test('the script takes a title and a description of the operator\'s own for the visitor\'s language', () => {
  const app = withoutComments(read('app.js'));
  assert.match(app, /pageTitle = area\.siteTitle\[language\] \?\? page\.title;/);
  assert.match(app, /querySelector\('meta\[name="description"\]'\)\.content = area\.siteDescription\[language\] \?\? page\.description;/);
  // (and nowhere else does it set either: the title is that, or the one of the stop or the line whose address the page is at, #37)
  assert.deepEqual(app.match(/document\.title = [^;]+;/g), ['document.title = title ?? pageTitle;', 'document.title = pageTitle;']);
  assert.equal(app.match(/meta\[name="description"\]/g).length, 1);
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
  for (const mode of arrayIn(app, 'MODES')) assert.ok(MODES.includes(mode), `${mode} in MODES of app.js`);
  for (const mode of arrayIn(read('stops.js'), 'RAIL_MODES')) assert.ok(MODES.includes(mode), `${mode} in RAIL_MODES of stops.js`);
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

// The page keeps nothing moving that has it paint anew at every frame: an
// animation of a shadow did so for as long as the page was open, on top of
// the frames the map and the vehicles need. The browser animates size,
// place and opacity by itself.
test('the style sheet animates only transform and opacity', () => {
  const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)];
  assert.ok(keyframes.length > 0, 'no @keyframes found in style.css');
  for (const [, name, body] of keyframes) {
    for (const [, property] of body.matchAll(/([\w-]+)\s*:/g)) assert.ok(['transform', 'opacity'].includes(property), `@keyframes ${name} animates ${property}`);
  }
});

// Between two frames of the canvas the page waits with a timer (nextFrame in
// app.js), as long as quietMs where nothing moves. Something that changes
// what the canvas shows has to say so through askDraw, which cuts the wait
// short: drawAsked set by itself would wait for the timer.
test('what asks for the canvas to be drawn anew wakes the frames', () => {
  const app = withoutComments(read('app.js'));
  assert.deepEqual(app.match(/\bdrawAsked = true\b/g), ['drawAsked = true', 'drawAsked = true'], 'drawAsked = true outside its declaration and askDraw');
  assert.match(app, /function askDraw\(\) \{\s*drawAsked = true;\s*nextFrame\(\);\s*\}/);
  assert.deepEqual(app.match(/requestAnimationFrame\(/g), ['requestAnimationFrame('], 'requestAnimationFrame outside nextFrame');
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

// The server writes the title and the description into the page in the
// language it picks by the browser's languages or the address; a language
// chosen with the picker is kept in the browser, and the server knows nothing
// of it. Where that is another, the page writes its own (#195); else it keeps
// the server's, which says more of a line, and is what a search engine reads.
test('the page writes a title of its own where the visitor chose another language than the server wrote it in', async () => {
  await loadLanguage('en', ['de-DE']);
  assert.ok(sentInAnother('de'));
  assert.ok(!sentInAnother('en'));
  await loadLanguage('en', ['en-GB'], 'de');
  assert.ok(sentInAnother('de'));
  // without a choice, also where the page is in another language than the server's: a browser that names none gets the instance's main one from the server
  await loadLanguage(null, ['de-DE']);
  assert.ok(!sentInAnother('de'));
  await loadLanguage(null, ['en-US']);
  assert.ok(!sentInAnother('de'));
  await loadLanguage('xx', ['en-US']);
  assert.ok(!sentInAnother('de'));
  assert.match(withoutComments(read('app.js')), /let servedAt = sentInAnother\(\) \? null : here\(\);/);
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

// The line "tomorrow" in a list of departures, where tomorrowAt in panel.js
// puts it. The list is in the order they leave:
// after midnight a train of the day before that leaves late is among those
// of today, and the next day begins with the first planned for it (#193).
test('the next day begins with the first departure planned for it, not with a late one of the day before', () => {
  const at = (time) => Date.parse(time) / 1000;
  const tomorrowAt = (time, planned) => nextDayAt(planned.map((when) => ({ planned: at(when) })), { day: dayOf, now: at(time) });
  setTimeZone('Europe/Berlin');
  // Sunday, ten past midnight: 00:17, 00:17, 23:25 of Saturday 56 minutes late, 00:34, 00:46
  const night = ['2026-10-18T00:17+02:00', '2026-10-18T00:17+02:00', '2026-10-17T23:25+02:00', '2026-10-18T00:34+02:00', '2026-10-18T00:46+02:00'];
  assert.equal(tomorrowAt('2026-10-18T00:10+02:00', night), -1);
  assert.equal(tomorrowAt('2026-10-18T00:10+02:00', [...night, '2026-10-19T00:05+02:00']), 5);
  // before midnight
  assert.equal(tomorrowAt('2026-10-17T23:50+02:00', ['2026-10-17T23:55+02:00', '2026-10-18T00:05+02:00']), 1);
  assert.equal(tomorrowAt('2026-10-17T23:50+02:00', ['2026-10-18T00:05+02:00']), 0);
  assert.equal(tomorrowAt('2026-10-17T23:50+02:00', ['2026-10-17T23:55+02:00']), -1);
});
