// The page itself is not run here – that takes a browser. These tests keep in
// step what has to agree across files: the languages (i18n.js, locales/, sw.js),
// the keys of the texts (locales/, app.js, index.html) and the mode ids (server,
// page, style sheet). i18n.js needs no browser and is run as it is.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { ATTRIBUTES, LANGUAGES, READMES, dayOf, dayStartOf, formatNumber, formatTime, formatWhen, languageToOffer, loadLanguage, pageTexts, pickLanguage, sentInAnother, setTimeZone, t, textsOf } from '../public/i18n.js';
import { serviceDayStart, setTimeZone as setServerZone } from '../server/lib/time.js';
import en from '../public/locales/en.js';
import { tomorrowAt as nextDayAt } from '../public/panel.js';
import { PAGE_INLINE, PAGE_MODULES } from '../server/lib/page.js';
import { MODES } from '../server/lib/timetable.js';

const publicDir = new URL('../public/', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, publicDir), 'utf8');

// Keys that are put together while the page runs, by what they start with. The
// rest of each is checked where it comes from (mode.<id>: see the mode ids below).
const DYNAMIC_KEYS = ['mode.', 'address.kind.', 'badge.kind.', 'kind.listed.', 'kind.listedPartly.'];

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

test("a board's narrow row has the same rules by the board's width and by its width in its type (style.css)", () => {
  const css = read('style.css');
  const rules = (query) => {
    const start = css.indexOf(`@container ${query} {`);
    assert.ok(start >= 0, query);
    const end = css.indexOf('\n}\n', start);
    return css.slice(css.indexOf('{', start) + 1, end).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  };
  assert.deepEqual(rules('rows (max-width: 21em)'), rules('board (max-width: 520px)'));
});

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
  // (a limit until the answer begins, shorter where a list is kept, #367, and a longer one for the list itself)
  const worker = withoutComments(read('search-worker.js'));
  assert.match(worker, /let limit = setTimeout\(\(\) => asking\.abort\(\), 20_000\);\s*try \{\s*const res = await fetch\('api\/search', \{ signal: asking\.signal,/);
  assert.match(worker, /limit = setTimeout\(\(\) => asking\.abort\(\), 120_000\);/);
});

// The search keeps its list for a search without a connection (search-worker.js,
// #367): the page says whether its connection is known to be lost, and a stop
// the search found, which opens by its place, opens what the page holds of it.
test('the search is told whether the connection is known to be lost, and a stop it found opens what the page holds of it without one', () => {
  const app = withoutComments(read('app.js'));
  assert.match(app, /finder\.postMessage\(\{ turn: \+\+turn, query, near, view, limits, modeNames, favourites, lost: connectionLost\(\) \}\);/);
  assert.match(app, /selection\.type === 'station' && Boolean\(selection\.at\?\.name\) && board === null && kept\.data\?\.name === selection\.at\.name\s*&& metres\(kept\.data\.lat, kept\.data\.lon, selection\.at\.lat, selection\.at\.lon\) <= SAME_PLACE_M\);\s*const held = \[\.\.\.visited\]\.find\(\(\[, kept\]\) => same\(kept\)\);/);
  // (at the same place: a stop of the same name 300 m away is another, #299)
  assert.match(app, /const SAME_PLACE_M = 25;/);
  const worker = withoutComments(read('search-worker.js'));
  assert.match(worker, /const KEPT_WAIT_MS = 3000;/);
  assert.match(worker, /fetch\('api\/search', \{ signal: asking\.signal, cache: 'no-store', headers: tag \? \{ 'If-None-Match': tag \} : \{\} \}\)/);
});

// The service worker keeps what the map needs to start (sw.js, "the map", #366);
// where it did not serve the page, as at the first visit, the page lists the
// files it fetched, once the map has drawn with the server's style.
test('the page lists the files of other servers it fetched for its service worker, once, when the map has drawn with the server\'s style', () => {
  const app = withoutComments(read('app.js'));
  assert.match(app, /if \(area\.styleUrl && !mapStyled\) \{\s*mapStyled = true;\s*map\.on\('idle', sayMapFiles\);\s*\}/);
  assert.match(app, /navigator\.serviceWorker\.addEventListener\('controllerchange', sayMapFiles\);/);
  // (and at a start without a connection, the map shows the area as held, with its style, before the server answers; as
  // it answers, the map stays where it is, its style and credits where the style is the same)
  assert.match(app, /if \(stored && !state\.areaShown\) showStoredArea\(stored\);/);
  assert.match(app, /function showStoredArea\(stored\) \{\s*try \{\s*showArea\(stored\.area, null\);\s*mapHeld = true;\s*\} catch \(err\) \{\s*console\.warn\('held area not shown:', err\);/);
  // (and wherever the server cannot say it: the connection lost before it answered, or no timetable yet)
  assert.match(app, /const waiting = state\.areaKnown \? null : await loadArea\(\);\s*if \(waiting && !state\.areaShown\) showHeldArea\(\);/);
  assert.match(app, /if \(state\.bannerOfServer\) showBanner\(null\);\s*if \(!state\.areaShown\) showHeldArea\(\);/);
  // (a part of the map's setup that failed, not one of its tiles: set up anew, whole, as the server answers)
  assert.match(app, /map\.on\('error', \(event\) => \{\s*if \(!event\.tile\) mapUnset = true;\s*console\.error\(event\.error \?\? event\);/);
  assert.match(app, /holdArea\(area, state\.clockOffset\);\s*heldClock = state\.clockOffset;\s*showArea\(area, about\);\s*state\.areaKnown = true;/);
  assert.match(app, /if \(!again\) \{\s*state\.viewAsked = OPENED_AS_DISPLAY && Boolean\(usable\);/);
  assert.match(app, /function setMapStyle\(area\) \{\s*if \(\(area\.styleUrl \?\? area\.tileUrl\) === mapStyleShown && !mapUnset\) return;\s*if \(mapUnset\) map\.setStyle\(null\);\s*mapUnset = false;\s*mapStyleShown = area\.styleUrl \?\? area\.tileUrl;\s*map\.setStyle\(area\.styleUrl \?\? rasterStyle\(area\.tileUrl\), \{ transformStyle:/);
  // (and where it failed after the area came, as a style still on its way at a start without a connection: anew at a good
  // poll, a few times at most, a minute apart)
  assert.match(app, /if \(mapUnset && mapHeld && areaAnswer && mapRetries < MAP_RETRIES && !\(Date\.now\(\) - mapRetriedAt < MAP_RETRY_MS\)\) \{\s*mapRetries \+= 1;\s*mapRetriedAt = Date\.now\(\);\s*setMapStyle\(areaAnswer\);/);
  // (the details the page was sent with, on the map as held; and again with the server's area)
  assert.match(app, /if \(state\.sentOpened && open\?\.unplaced && !open\.left && open\.path === here\(\)\) \{\s*placeSent\(open\);\s*open\.unplaced = true;/);
  assert.match(app, /if \(!again\) \{\s*map\.addControl\(new AttributionControl\(/);
  assert.match(app, /map\.on\('moveend', \(\) => \{\s*if \(!state\.areaShown\) return;/);
  // (to each service worker that serves the page: one that takes over from an older one as well)
  assert.match(app, /if \(!worker \|\| worker === mapFilesTold \|\| !mapStyled \|\| !map\.loaded\(\)\) return;\s*mapFilesTold = worker;\s*worker\.postMessage\(\{ mapFiles: performance\.getEntriesByType\('resource'\)\.map\(\(entry\) => entry\.name\)\.filter\(\(name\) => !name\.startsWith\(`\$\{location\.origin\}\/`\)\) \}\);/);
});

// On a train the connection comes back for seconds between tunnels, often
// without the browser noticing: while it fails, the page tries again soon, the
// open details first, each try given TRY_MS for its answer to begin (#365).
test('while the connection fails, the page tries again 2, 4 and 8 s after a try began and then every 10 s, the open details first; with a connection as before', () => {
  const app = withoutComments(read('app.js'));
  assert.match(app, /const TRY_MS = 8000;/);
  assert.match(app, /const RETRY_MS = \[2000, 4000, 8000, 10_000\];/);
  assert.match(app, /const step = RETRY_MS\[Math\.min\(tries, RETRY_MS\.length\) - 1\];\s*return Math\.max\(0, begun \+ step \* \(0\.8 \+ Math\.random\(\) \* 0\.4\) - Date\.now\(\)\);/);
  assert.match(app, /function failingNow\(\) \{\s*return connectionLost\(\) \|\| Boolean\(state\.selection\?\.failing\);/);
  // (the tries in a row while no answer comes at all: the details' sooner only then, not for an answer that is an error)
  assert.match(app, /answered = true;\s*await further;\s*if \(state\.selection !== selection \|\| selection\.turn !== turn\) return;\s*selection\.unanswered = false;\s*detailTries = 0;\s*if \(connectionLost\(\)\) poll\(\);\s*if \(data\) \{/);
  assert.match(app, /if \(state\.selection === selection && selection\.turn === turn\) \{\s*if \(!answered\) selection\.unanswered = true;\s*disconnected\(selection\);\s*\}/);
  // (the map's own count, which its answers end, as they end the details': the connection has worked since)
  assert.match(app, /delay = RETRY_LOADING_MS;\s*mapTries = 0;\s*detailTries = 0;\s*\} else if \(res\.ok\) \{\s*mapTries = 0;\s*detailTries = 0;/);
  assert.match(app, /delay = retryIn\(begun, \+\+mapTries\);\s*const open = state\.selection;\s*if \(open\?\.failing && !open\.left && !open\.asking && !document\.hidden\) \{\s*open\.unanswered = true;\s*clearTimeout\(panelTimer\);\s*panelTimer = setTimeout\(loadSelection, delay\);\s*\}\s*\}\s*if \(!document\.hidden\) pollTimer = setTimeout\(poll, delay\);/);
  // (the map's question waits for the open details' while they try and no answer comes, and follows any answer of theirs)
  assert.match(app, /async function poll\(\) \{\s*clearTimeout\(pollTimer\);\s*if \(detailsFirst\(\)\) \{\s*if \(!document\.hidden\) pollTimer = setTimeout\(poll, POLL_MS\);\s*return;\s*\}/);
  assert.match(app, /return connectionLost\(\) && Boolean\(open\?\.failing && open\.unanswered\) && !open\.left && \(Boolean\(open\.asking\) \|\| Date\.now\(\) - open\.askedAt < DETAILS_FIRST_MS\);/);
  assert.match(app, /const begun = \(selection\.askedAt = Date\.now\(\)\);\s*let answered = false;/);
  assert.match(app, /if \(document\.hidden\) return;\s*startAsking\(\);\s*loadSelection\(\);\s*poll\(\);/);
  // (and the details first when the browser is online again: theirs is the handler added first)
  assert.ok(app.indexOf("addEventListener('online', () => {") < app.indexOf("window.addEventListener('online', poll);"));
});

// A stop's answer holds its next 40 departures; while the connection is lost,
// those after them that the page asked for now and then move up (#364).
test('a stop asks for its departures after those listed now and then, keeps them between, and its lists show them where the connection is lost', () => {
  const app = withoutComments(read('app.js'));
  assert.match(app, /const LATER_MS = 5 \* 60_000;/);
  assert.match(app, /return selection\.type === 'station' && !first && \(selection\.laterLines !== choiceValue\(lines\) \|\| !\(Date\.now\(\) - selection\.laterAt < LATER_MS\)\);/);
  // (not with the first question, which comes as small as before; right after its answer; of all lines where they can be shown)
  assert.match(app, /panelTimer = setTimeout\(loadSelection, selection\.failing && selection\.unanswered \? retryIn\(begun, \+\+detailTries\) : selection\.laterSoon \? LATER_FIRST_MS : PANEL_REFRESH_MS\);/);
  assert.match(app, /\(state\.view === 'lines' \|\| \(later && !FIXED\)\) && state\.board === null \? '&list=lines' : ''/);
  assert.match(app, /\$\{later \? '&later=1' : ''\}`;/);
  assert.match(app, /connected\(selection\);\s*if \(selection\.type === 'station'\) keepLater\(selection, data\);/);
  // (the further stops of a board likewise, each by its own time)
  assert.match(app, /const later = Boolean\(known\.departures\) && !\(Date\.now\(\) - known\.laterAt < LATER_MS\);/);
  assert.match(app, /if \(later\) \{\s*known\.laterAt = Date\.now\(\);\s*answer\.laterNow = answer\.now;\s*\} else if \(known\.departures\?\.later\) \{\s*answer\.later = known\.departures\.later;/);
  // (a board's lists, whether the delays shown are old, and a start at the map that opens what lies ahead, with them)
  assert.match(app, /heldDepartures\(entry\.known\.departures, now\(\), true, entry\.known\.departures\.departures\.length \|\| Infinity\);/);
  assert.match(app, /const listOf = heldShown\(\) \? heldOf : \(entry\) => entry\.known\.departures\.departures;/);
  // (and what has left of them is noticed as of the answer's own, also where the rows show the time of day)
  assert.match(app, /const held = \[\.\.\.departuresShown\(data, lost\), \.\.\.\(state\.board === null \? \[\] : \[\.\.\.boardStopData\.values\(\)\]\.flatMap\(\(stop\) => \(stop\?\.departures \? departuresShown\(stop\.departures, lost\) : \[\]\)\)\)\];/);
  assert.match(app, /: heldDepartures\(data, at, held, data\.departures\?\.length \|\| Infinity\)\.departures;/);
  assert.match(app, /if \(type === 'station'\) return heldDepartures\(data, at, true\)\.departures\.length > 0;/);
});

// A page that starts from the service worker's cache is of the version kept
// there: it knows that version as the page was sent with it, not by the
// server's first answer, which may come from a newer one (#363).
test('the page knows the version of its files as it was sent, and compares it with the server\'s', () => {
  const app = withoutComments(read('app.js'));
  assert.match(app, /let runningVersion = document\.querySelector\('meta\[name="netnou-page-version"\]'\)\?\.content \?\? null;/);
  assert.match(app, /const versionOf = \(about\) => about\.pageVersion \?\? null;/);
  // (and tells the service worker, at the start and when another one takes the page over: sw.js takes its files from that version, and
  // keeps the texts of the language it says)
  assert.match(app, /const sayVersion = \(\) => navigator\.serviceWorker\.controller\?\.postMessage\(\{ pageVersion: runningVersion, language \}\);\s*if \(navigator\.serviceWorker\) \{\s*sayVersion\(\);\s*navigator\.serviceWorker\.addEventListener\('controllerchange', sayVersion\);/);
});

// The page is sent in the language its browser asks for, and says so (Vary). A
// start without a connection takes the one that was kept, whatever the browser
// asks for by then: a cache that held that against it would have no page at all.
test('the service worker finds the page it kept, whatever is asked for besides', () => {
  const sw = withoutComments(read('sw.js'));
  assert.match(sw, /caches\.match\(PAGE, \{ cacheName: CACHE, ignoreSearch: true, ignoreVary: true \}\)/);
  assert.match(sw, /caches\.match\(request, \{ cacheName: `\$\{CACHE_PREFIX\}\$\{version\}`, ignoreSearch: true, ignoreVary: true \}\)/);
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

test('a language is a file in locales/ and an entry in LANGUAGES; of them, the shell of the service worker has English', () => {
  const files = fs.readdirSync(new URL('locales/', publicDir)).map((name) => name.replace(/\.js$/, ''));
  const precached = shell.filter((file) => file.startsWith('locales/'));
  assert.deepEqual(files.sort(), codes.toSorted(), 'the files in public/locales and LANGUAGES in i18n.js differ');
  // (the others it keeps as a browser uses them: sw.js, LANGUAGE_FILE)
  assert.deepEqual(precached, ['locales/en.js'], 'SHELL in sw.js has the texts of English, which fill any gaps, and no other language');
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
      // (and beside them, texts of numbers of their own: "twice an hour", #289)
      assert.deepEqual(Object.keys(message).filter((form) => !/^\d+$/.test(form)).sort(), forms, `${code}: plural forms of ${key}`);
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
  // (and where details the page holds, or an address it could not ask about, take its place without a connection)
  assert.deepEqual(app.match(/setBoard\(null\b[^)]*\)/g), ['setBoard(null, false)', 'setBoard(null, false)', 'setBoard(null, false)', 'setBoard(null, false)']);
  // (the next address has a board where one is shown, not where the address before had one; and the lines chosen of a stop that is open, #164)
  // (with the name of the details it was opened from, where it was, for the way back to them)
  assert.match(app, /history\[step\]\(from \? \{ from, \.\.\.\(fromStop \? \{ fromStop \} : \{\}\) \} : null, '', new URL\(`\$\{path\}\$\{boardQuery\(location\.search, state\.board, state\.extra, state\.lines\)\}`/);
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

  // a chip for every mode, switched on, in its colour and with its name, its
  // count left to the script (#289: none is 0 before it runs); those
  // of the kinds that only some timetables have are hidden until the server
  // shows them (test/page.test.js)
  const modes = arrayIn(app, 'MODES');
  const chips = [...card.matchAll(/<button type="button" class="chip" data-mode="([a-z]+)" aria-pressed="true"( hidden)?><span class="swatch"><\/span><span class="name" data-i18n="mode\.([a-z]+)">[^<]+<\/span><span class="count"><\/span><\/button>/g)];
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
          assert.equal(shown(situation), pickLanguage(stored, browser, asked, lang) === lang, JSON.stringify(situation));
        }
      }
    }
  }
  // (the page keeps the language it was sent in, #287: the server picked it from the languages the browser named with its request)
  assert.ok(shown({ lang: 'de', browser: ['de-DE'] }));
  assert.ok(shown({ lang: 'de', browser: ['en-US'] }));
  assert.ok(!shown({ lang: 'de', browser: ['en-US'], stored: { 'netnou.lang': 'en' } }));
  // (a browser of no language the page has gets English)
  assert.ok(shown({ lang: 'en', browser: ['xx'] }));
  // (a browser that keeps nothing has chosen nothing)
  assert.ok(shown({ lang: 'de', browser: ['de'], blocked: true }));
  assert.ok(shown({ lang: 'en', browser: ['de'], blocked: true }));
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
  // (and nowhere else does it set either: the title is that, or the one of the stop, the line or the trip whose address the page
  // is at, #37, also where the page opened them with the answer it was sent with before it knew this, #333; the page's own
  // where its address names nothing now, #362)
  assert.deepEqual(app.match(/document\.title = [^;]+;/g), ['document.title = title ?? pageTitle;', 'document.title = pageTitle;', 'document.title = here() && open?.data && !open.left && open.path === here() ? detailsTitle(open) : pageTitle;']);
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
  // (each with the short name its badges have where a stop has a name in two kinds)
  assert.deepEqual(Object.keys(en).filter((key) => key.startsWith('badge.kind.')).map((key) => key.slice('badge.kind.'.length)).sort(), expected, 'badge.kind.* in locales/en.js');
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
// WCAG 1.4.3: a delay is small text, 4.5:1 against the ground of the details and against the grey of a row under the
// pointer, in both themes (the colours of the map, under white letters, are others: #215)
test('delays as text hold 4.5:1 on the ground and on a row under the pointer, light and dark', () => {
  const css = read('style.css');
  const block = (selector) => css.slice(css.indexOf(`${selector} {`), css.indexOf('\n}', css.indexOf(`${selector} {`)));
  const tokens = (text) => Object.fromEntries([...text.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((match) => [match[1], match[2]]));
  const light = tokens(block(':root'));
  const dark = { ...light, ...tokens(block(':root[data-theme="dark"]')) };
  const lum = (hex) => {
    const [r, g, b] = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  for (const [theme, set] of [['light', light], ['dark', dark]]) {
    for (const kind of ['early', 'ok', 'major', 'severe']) {
      const text = set[`delay-${kind}-text`];
      assert.ok(text, `--delay-${kind}-text in ${theme}`);
      for (const ground of ['bg', 'bg-subtle']) assert.ok(ratio(text, set[ground]) >= 4.5, `${theme} ${kind} on --${ground}: ${ratio(text, set[ground]).toFixed(2)}`);
    }
  }
});

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
test('the language is the stored choice, else the one the address asks for, else the one the page was sent in, else the first of the browser that exists, else English', () => {
  // (#287: a page sent in the main language to whoever named none, as a search engine, stays in it in a browser of another language)
  assert.equal(pickLanguage(null, ['en-US'], null, 'de'), 'de');
  assert.equal(pickLanguage(null, ['en-US'], 'en', 'de'), 'en');
  assert.equal(pickLanguage('en', ['de-DE'], null, 'de'), 'en');
  assert.equal(pickLanguage(null, ['de-DE'], null, 'xx'), 'de');
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

// A link to the English page opened by a German browser (#287): the page
// offers German, in German. Not where the visitor chose a language, and not
// where the address names none or one there is not: the page is then in the
// browser's language already, or the browser's is not here at all.
test('the page offers the browser\'s language where the address asks for another one, unless one was chosen', async () => {
  assert.equal(languageToOffer(null, ['de-DE', 'en'], 'en'), 'de');
  assert.equal(languageToOffer(null, ['xx', 'en-GB'], 'de'), 'en');
  assert.equal(languageToOffer(null, ['de-AT'], 'de'), null);
  assert.equal(languageToOffer('en', ['de-DE'], 'en'), null);
  assert.equal(languageToOffer('de', ['de-DE'], 'en'), null);
  assert.equal(languageToOffer('xx', ['de-DE'], 'en'), 'de'); // stored by another version of the page
  assert.equal(languageToOffer(null, ['de-DE'], null), null);
  assert.equal(languageToOffer(null, ['de-DE'], 'xx'), null);
  assert.equal(languageToOffer(null, ['fr-FR'], 'de'), null);
  assert.equal(languageToOffer(null, [], 'de'), null);
  // (in the language it offers, whatever the page is in)
  await loadLanguage('en', []);
  for (const [code] of LANGUAGES) {
    const texts = await textsOf(code);
    for (const key of ['offer.text', 'offer.switch', 'offer.never', 'panel.close']) assert.ok(texts[key], `${code}: ${key}`);
  }
  assert.equal(t('offer.switch', {}, await textsOf('de')), 'Zu Deutsch wechseln');
  assert.equal(t('offer.switch'), 'Switch to English');
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
  assert.match(withoutComments(read('app.js')), /let servedAt = sentInAnother\(\) \|\| KEPT \? null : here\(\);/);
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

test('a time of another day than now is said with its day: yesterday, a weekday of the week before, earlier its date (#375)', async () => {
  const plain = (text) => text.replace(/\s/g, ' ');
  const at = (iso) => Date.parse(iso) / 1000;
  setTimeZone('Europe/Berlin');
  // (Tuesday, 17 November, 15:37 in Nürnberg)
  const now = at('2026-11-17T14:37:00Z');
  await loadLanguage('de', ['de-DE']);
  assert.equal(formatWhen(at('2026-11-17T12:37:00Z'), now), '13:37');
  assert.equal(formatWhen(at('2026-11-16T12:37:00Z'), now), 'gestern 13:37');
  assert.equal(formatWhen(at('2026-11-15T12:37:00Z'), now), 'Sonntag 13:37');
  assert.equal(formatWhen(at('2026-11-11T12:37:00Z'), now), 'Mittwoch 13:37');
  assert.equal(formatWhen(at('2026-11-10T12:37:00Z'), now), '10. November 13:37');
  // by the dates where the area is, not by 24 hours: 23:58 is yesterday's at 00:05, and today's at 23:59
  assert.equal(formatWhen(at('2026-11-16T22:58:00Z'), at('2026-11-16T23:05:00Z')), 'gestern 23:58');
  assert.equal(formatWhen(at('2026-11-16T22:58:00Z'), at('2026-11-16T22:59:00Z')), '23:58');
  // (the night the clocks go back has 25 hours, and is one day)
  assert.equal(formatWhen(at('2026-10-24T12:37:00Z'), at('2026-10-25T14:37:00Z')), 'gestern 14:37');
  // a time ahead of the page's clock, where the server's runs ahead: the time alone
  assert.equal(formatWhen(at('2026-11-17T15:37:00Z'), now), '16:37');
  // the note as it reads
  assert.equal(t('panel.offline', { time: formatWhen(at('2026-11-16T12:37:00Z'), now) }), 'Stand gestern 13:37 · keine Verbindung');
  // in English, in the visitor's regional variant
  await loadLanguage('en', ['en-US']);
  assert.equal(plain(formatWhen(at('2026-11-16T12:37:00Z'), now)), 'yesterday, 1:37 PM');
  assert.equal(plain(formatWhen(at('2026-11-15T12:37:00Z'), now)), 'Sunday, 1:37 PM');
  assert.equal(plain(formatWhen(at('2026-11-10T12:37:00Z'), now)), 'November 10, 1:37 PM');
  await loadLanguage('en', ['de', 'en-GB']);
  assert.equal(formatWhen(at('2026-11-10T12:37:00Z'), now), '10 November, 13:37');
  // the start of a service day as the server counts it, also on the days the clocks change (a line's hours, panel.js)
  setServerZone('Europe/Berlin');
  for (const date of ['20261104', '20260329', '20261025', '20261026']) assert.equal(dayStartOf(date), serviceDayStart(date), date);
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

// What makes the details of a stop its board is in their corner, between the
// heart and the share button (#81): it changes what the details are, as they do.
test('the button of the board is in the corner of the details, between the heart and the share button', () => {
  const page = read('index.html');
  const at = (id) => page.indexOf(`id="${id}"`);
  assert.ok(at('panel-favourite') > 0 && at('panel-favourite') < at('panel-board') && at('panel-board') < at('panel-share') && at('panel-share') < at('panel-close'));
  assert.match(page, /<button type="button" class="board-toggle" id="panel-board" hidden aria-pressed="false" aria-label="Enlarge" data-i18n-aria-label="panel\.enlarge" title="Enlarge" data-i18n-title="panel\.enlarge" data-icon="mdiArrowExpand"><\/button>/);
});

test('where the connection is lost, the details say how old they are, and what did not load keeps the way back and is tried again', () => {
  const app = withoutComments(read('app.js'));
  // until a first answer has come, every try is the first: what failed to load opens as it would have, with its address
  assert.match(app, /first \|\|= !selection\.loaded;/);
  // a fetch that fails keeps what is shown, with a note of the time of its last answer, which a screen reader hears once:
  // written only as it changes
  assert.match(app, /if \(state\.selection === selection && selection\.turn === turn\) \{\s*if \(!answered\) selection\.unanswered = true;\s*disconnected\(selection\);/);
  assert.match(app, /if \(!was\) say\(selection\.loaded \? lostSince\(\) : t\('panel\.loadFailed'\)\);/);
  assert.match(app, /function say\(text\) \{\s*const said = \$\('panel-said'\);\s*if \(said\.textContent !== text\) said\.textContent = text;/);
  assert.match(read('index.html'), /<p class="spoken" id="panel-said" role="status"><\/p>/);
  // the way back from what did not load is not the history's: the address never went there
  // (not from details Back has left already, while the address it went to opens)
  assert.match(app, /if \(state\.selection\?\.left\) return;\s*(\/\/[^\n]*\n\s*)*if \(event\.detail === 0 && \(panel\.contains\(document\.activeElement\) \|\| document\.activeElement === document\.body\)\) focusBack = openedBy\(state\.selection\);\s*if \(state\.selection\?\.loaded\) history\.back\(\);\s*else backFromFailed\(\);/);
  // tried again at once when the browser is online again
  assert.match(app, /addEventListener\('online', \(\) => \{/);
});

test('without a connection the card says it, and the map goes on with what it has, not covered by a banner (#382)', () => {
  const app = withoutComments(read('app.js'));
  const css = read('style.css');
  // no banner says it: neither its text nor a way to show it so is left
  assert.doesNotMatch(app, /banner\.offline|bannerOffline/);
  for (const language of ['de', 'en']) assert.doesNotMatch(read(`locales/${language}.js`), /'banner\.offline'/);
  assert.match(app, /const text = state\.note \?\? state\.banner \?\? '';/);
  // the card's line, as dark as the text; read out once as the connection goes, where open details do not say it
  // themselves, and emptied as it comes back, which is not read out
  assert.match(css, /\.status\[data-state="error"\] \{ color: var\(--text\); \}/);
  // (outside the card, which hides what it holds where it is folded)
  assert.match(read('index.html'), /<p class="spoken" id="map-said" role="status"><\/p>\s*<!--[^]*?-->\s*<p class="spoken" id="status-said" role="status"><\/p>/);
  assert.match(app, /const went = !state\.lost;\s*state\.lost = true;[^]*?if \(went && \(panel\.hidden \|\| !state\.selection\)\) \$\('status-said'\)\.textContent = t\('status\.noConnection'\);/);
  // (a server that loads its timetable is a connection: not lost, and what was said of a loss emptied unread, as on an answer)
  assert.match(app, /state\.lost = false;\s*\$\('status-said'\)\.textContent = '';\s*showBanner\(loadingText\(data\), true\);/);
  // (and what the server said as it loaded its timetable goes as the connection does; that the map cannot be drawn stays)
  assert.match(app, /if \(state\.bannerOfServer\) showBanner\(null\);/);
  assert.match(app, /state\.bannerOfServer = Boolean\(message\) && ofServer;/);
  assert.match(app, /showBanner\(null\);\s*(\/\/[^\n]*\n\s*)*state\.lost = false;\s*\$\('status-said'\)\.textContent = '';/);
  // an empty map says that its vehicles come once the connection is back, also with nothing open; of the kinds shown,
  // and not where none is
  // (where the connection is lost, not while the server loads its timetable; the kinds by the chips the card shows; an
  // open line's own vehicles whatever is chosen)
  assert.match(app, /const kinds = \(\) => selection\?\.type === 'line' \|\| \[\.\.\.chipCounts\]\.some\(\(\[mode, node\]\) => state\.enabled\.has\(mode\) && !node\.parentElement\.hidden\);\s*const lost = state\.lost && \(panel\.hidden \|\| Boolean\(selection\?\.failing\)\) && state\.board === null && !state\.display && tip\.hidden && offer\.hidden && kinds\(\);/);
  // the one tip waits for a later landing at a stop
  assert.match(app, /OFFERING \|\| connectionLost\(\)\) return;/);
});

test('what gets the keyboard focus in the details is in sight: clear of the timetable heading, which waits at the foot only where there is room, in a sheet risen as far as it needs, never on credits under it', () => {
  const app = withoutComments(read('app.js'));
  // the keyboard's focus alone, and not the focus given back after an answer of the server, which leaves the list where it is
  assert.match(app, /if \(focusGivenBack \|\| !event\.target\.matches\(':focus-visible'\)\) return;/);
  assert.match(app, /focusGivenBack = true;\s*const same = which && focused >= 0[^\n]*\n\s*if \(again\) again\.focus/);
  // clear of the heading of a line's timetable waiting at the foot
  assert.match(app, /const bottom = pinned && !pinned\.contains\(target\) \? pinned\.getBoundingClientRect\(\)\.top : box\.bottom;/);
  // a sheet too low for it rises to the lowest of its heights that leaves the room, for a row and for the timetable's key
  assert.match(app, /const lacks = target\.offsetHeight \+ 16 - \(bottom - box\.top\);/);
  // (the heading as it is after the browser scrolled the list for the focus, not as the last scroll left it)
  assert.match(app, /if \(!narrowScreen\.matches \|\| state\.board !== null\) return null;\s*pinTimetable\(\);/);
  assert.match(app, /return higher\.find\(\(height\) => height - now >= lacks\) \?\? higher\.at\(-1\) \?\? null;/);
  assert.equal(app.match(/const height = sheetFor\((event\.target|heading)\);\s*if \(height !== null\) \{\s*restSheet\(height\);/g)?.length, 2);
  // a line's timetable heading waits at the foot only where a stop and its ring fit beside it, else it comes after them
  assert.match(app, /const loose = !panel\.classList\.contains\('dragging'\) && panelBody\.clientHeight - head\.offsetHeight < Math\.max\(row\?\.offsetHeight \?\? 0, 36\) \+ 16;/);
  assert.match(app, /head\.classList\.toggle\('pinned', !loose && /);
  assert.match(read('style.css'), /\.timetable-head\.loose \{ position: static; \}/);
  // the credits are out of the keyboard's way where the details lie over their middle, with the map's buttons moved
  assert.match(app, /credits\.inert = !panel\.hidden && box\.width > 0 && panel\.contains\(document\.elementFromPoint\(/);
  assert.match(app, /group\.style\.visibility = out \? 'hidden' : '';\s*\}\s*coverCredits\(\);/);
});

test('a dialog that says something opens on its text, which the keys scroll and which is a stop of its own while it is long', () => {
  const app = withoutComments(read('app.js'));
  const html = read('index.html');
  for (const id of ['about', 'notes']) assert.match(html, new RegExp(`<div class="dialog-body" role="document" aria-labelledby="${id}-title" tabindex="-1">`));
  // the one of the directions to choose is its choices, and opens on its button
  assert.match(html, /<button[^>]*id="choice-close"[^>]*><\/button>\s*<div class="dialog-body">/);
  assert.match(app, /\$\('about-open'\)\.addEventListener\('click', \(\) => openOnText\(aboutDialog\)\);/);
  assert.match(app, /openOnText\(notesDialog\);/);
  assert.match(app, /const scrollStop = \(text\) => \{ text\.tabIndex = text\.scrollHeight > text\.clientHeight \+ 1 \? 0 : -1; \};/);
  assert.match(app, /dialog\.showModal\(\);\s*text\.scrollTop = 0;\s*scrollStop\(text\);\s*text\.focus\(\{ preventScroll: true \}\);/);
  assert.match(app, /for \(const id of \['about', 'notes'\]\) textStops\.observe\(\$\(id\)\.querySelector\('\.dialog-body'\)\);/);
  // its ring a frame inside the dialog's edge, over the button in its corner
  assert.match(read('style.css'), /\.dialog:has\(> \.dialog-body:focus-visible\)::after \{ content: ""; position: absolute; inset: 0; z-index: 3; border: 2px solid var\(--accent\);/);
});

test('the keyboard reaches the map from its first stop, and the map shows its keys while it has the keyboard', () => {
  const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
  const app = withoutComments(read('app.js'));
  const css = read('style.css');
  // (the way to the map is the first stop of the Tab key, before the offer of a language and the details, which come first
  // of the rest since #290; seen only while it has the focus, and not where there is no map to go to)
  assert.match(html, /<body>\s*<a class="skip" id="skip-map" href="#map" data-i18n="map\.skip">/);
  assert.match(app, /\$\('skip-map'\)\.addEventListener\('click', \(event\) => \{\s*event\.preventDefault\(\);\s*map\.getCanvas\(\)\.focus\(\);/);
  assert.match(css, /\.skip:not\(:focus\) \{ transform: translateY\(calc\(-100% - var\(--gap\) - var\(--safe-top\) - 24px\)\); \}/);
  assert.match(css, /:root\[data-board="alone"\] \.skip, :root\[data-display="fixed"\] \.skip \{ display: none; \}/);
  // (the keys show and go with the crosshair, hidden from a screen reader, which has them as the map's description; the free
  // map of the crosshair and its tooltip end above them; the other notes give way meanwhile)
  assert.match(app, /if \(!keysOnMap\(\)\) \{\s*showMapKeys\(false\);\s*dropAim\(\);/);
  assert.match(app, /const mapKeys = el\('p', \{ class: 'tip map-keys', 'aria-hidden': 'true' \}\);/);
  assert.match(app, /const aboveKeys = \(padding\) => \(keys === null \? padding : \{ \.\.\.padding, bottom: Math\.max\(padding\.bottom, viewSize\.y - keys \+ 8\) \}\);/);
  assert.match(app, /if \(keys !== null\) edges\.bottom = Math\.min\(edges\.bottom, keys - 4\);/);
  // (in a short window, where they would leave the crosshair no room, they give way to it)
  assert.match(app, /if \(room\.covered && keysTop\(\) !== null\) \{\s*mapKeys\.classList\.add\('gave-way'\);/);
  assert.match(css, /body:has\(> \.map-keys:not\(\[hidden\], \.gave-way\)\) :is\(#tip, #offer, #map-note\) \{ visibility: hidden; \}/);
  // (above the banner where both stand at the foot of the map; placed anew as it comes and goes)
  assert.match(app, /if \(meets\(banner, mapKeys\.getBoundingClientRect\(\)\)\) mapKeys\.style\.bottom = /);
  assert.match(app, /crossResized\.observe\(\$\('banner'\)\);/);
  // (on a narrow screen, where the banner stands in the middle, the crosshair and its tooltip on the side of it with more room)
  assert.match(app, /padding = viewSize\.y - below\.top - below\.bottom >= viewSize\.y - above\.top - above\.bottom \? below : above;/);
  assert.match(app, /if \(padding\.top >= banner\.bottom\) edges\.top = Math\.max\(edges\.top, banner\.bottom \+ 4\);\s*else edges\.bottom = Math\.min\(edges\.bottom, banner\.top - 4\);/);
  // (not half under the card in a short window: they give way there too)
  assert.match(app, /if \(meets\(\$\('controls'\)\.getBoundingClientRect\(\), mapKeys\.getBoundingClientRect\(\)\)\) mapKeys\.classList\.add\('gave-way'\);/);
});

test('the map with the keyboard has its crosshair in the middle of its free part, and Enter opens what lies under it', () => {
  const app = withoutComments(read('app.js'));
  // where the card and the details leave the map free, a sheet that leaves too little of it coming down
  // (as the keyboard comes onto the map, not as the card or a sheet changes later, which may be the visitor's own doing)
  assert.match(app, /if \(arrived\) roomForCross\(\);\s*const was = cross\.placed \? cross\.point : null;[\s\S]*?cross\.view = \{ \.\.\.viewSize \};\s*clearMapButtons\(\);\s*showMapKeys\(true\);\s*let room = crossRoom\(\);[\s\S]*?\s*cross\.free = room\.padding;\s*cross\.covered = room\.covered;/);
  assert.match(app, /placeCross\(true\);/);
  // (one test for the room: a sheet down to the highest height at which the map fits; never against a hand)
  assert.match(app, /const fitting = heights\.filter\(\(height\) => freeMap\(height\)\.fits\);/);
  assert.match(app, /if \(panel\.classList\.contains\('dragging'\) \|\| \$\('controls'\)\.classList\.contains\('dragging'\)\) return;/);
  // (on a wide screen too low for the map beside the card or below it, the strip below the card, clear of the details and the
  // map's buttons; the card is left as the visitor has it)
  assert.match(app, /const padding = \{ top: Math\.max\(card\.bottom, bubble\?\.bottom \?\? 0\) \+ margin, bottom: viewSize\.y - bottom \+ margin, left: margin, right: viewSize\.x - right \+ margin \};/);
  // (the arrows go from mark to mark where one lies ahead within a step, in the way of the key; else the map's own step)
  assert.match(app, /if \(along < 6 \|\| along > STEP_PX \|\| across > 0\.58 \* along\) continue;/);
  // (a key held down, and the dots of a far view, travel as without the crosshair)
  assert.match(app, /if \(event\.repeat \|\| map\.getZoom\(\) < LABEL_ZOOM\) \{\s*cross\.step = null;\s*return false;\s*\}/);
  // (what a step goes for is the aim at once, held while it comes)
  assert.match(app, /function aimStep\(hit\) \{\s*cross\.aim = hit;\s*cross\.hushed = null;\s*cross\.step = \{ key: hitKey\(hit\), until: performance\.now\(\) \+ 400 \};/);
  // (of several on one spot, the one a tap opens first; a further press goes to the others before moving on)
  assert.match(app, /const order = \(hit\) => \(hit\.above \? 0 : hit\.vehicle \? 1 : 2\);/);
  assert.match(app, /const stacked = state\.hits\.filter\(\(hit\) => onSpot\(at, hit\) && !cross\.seen\.has\(hitKey\(hit\)\)\)/);
  // (held while it comes, until its glide ends; the free map from where a sheet comes to rest; what was just aimed at moves
  // with the crosshair where that moves after all)
  assert.match(app, /else map\.once\('moveend', \(\) => \{\s*if \(cross\.step !== step\) return;\s*cross\.step = null;\s*if \(performance\.now\(\) >= step\.sayAt\) sayAim\(\);/);
  assert.match(app, /const sized = panel\.classList\.contains\('sized'\) && parseFloat\(panel\.style\.height\);/);
  // (back under the crosshair, a vehicle is held as after a step; a stale aim is not said)
  assert.match(app, /cross\.aim = mark;\s*cross\.holdR = mark\.vehicle \? CROSS_PX \/ 2 \+ mark\.r : 0;/);
  // (a stop whose name the map writes has a tooltip where a tap there would open something else)
  assert.match(app, /const unseen = aim\?\.named && hitKey\(hitTest\(cross\.point\)\) !== hitKey\(aim\);/);
  assert.match(app, /if \(keysOnMap\(\) && \(key === undefined \|\| hitKey\(cross\.aim\) === key\)\) line\.textContent = text;/);
  // (Escape with nothing open puts the tooltip away until the aim changes, and only that where one showed before the key;
  // the tooltip as wide as the free map lets it be)
  assert.match(app, /addEventListener\('keydown', \(event\) => \{\s*const shown = !tooltip\.hidden;/);
  assert.match(app, /if \(event\.key === 'Escape' && !state\.selection && keysOnMap\(\)\) \{\s*if \(shown\) event\.stopPropagation\(\);\s*cross\.hushed = hitKey\(cross\.aim\) \?\? '';/);
  // (on any change of the map's size, what lies under the crosshair stays there, aimed at or not)
  assert.match(app, /if \(grown\.x \|\| grown\.y \|\| \(\(cross\.aim \|\| cross\.settle\) && performance\.now\(\) < cross\.keepUntil\)\) map\.panBy\(\[-dx, -dy\], \{ duration: 0 \}\);/);
  // (and not placed by the card or the sheet before MapLibre has taken a change of the map's size, which places it then)
  assert.match(app, /const crossResized = new ResizeObserver\(\(\) => \{\s*const box = map\.getContainer\(\);\s*if \(keysOnMap\(\) && box\.clientWidth === viewSize\.x && box\.clientHeight === viewSize\.y\) placeCross\(\);\s*\}\);/);
  assert.match(app, /tooltip\.style\.maxWidth = `\$\{Math\.max\(0, Math\.min\(320, right - left\)\)\}px`;/);
  // (said soon after a step's glide)
  assert.match(app, /const STEP_SAID_MS = 450;/);
  assert.match(app, /if \(zoomKey\(event\) \|\| stepKey\(event\)\) return;/);
  // (the settings close as the keyboard comes onto the map)
  assert.match(app, /if \(!settings\.hidden\) showSettings\(false\);\s*\}\s*placeCross\(true\);/);
  // (a notice of the last Enter goes as the map moves or the crosshair comes onto something)
  assert.match(app, /if \(hit\) cross\.notice = null;/);
  // (a stop comes back on the place of the mark that was aimed at)
  assert.match(app, /const markAt = hit\.station \? map\.unproject\(\[hit\.x, hit\.y\]\) : null;\s*const opening = openHit\(hit\);/);
  assert.match(app, /\{ station: hit\.station, at: markAt \}/);
  // (back under it, what it opened is its aim again, held and said)
  assert.match(app, /clearTimeout\(cross\.timer\);\s*cross\.timer = setTimeout\(sayAim, STEP_SAID_MS\);\s*if \(Math\.hypot\(mark\.x - at\.x, mark\.y - at\.y\) > 1\) return;/);
  assert.match(app, /opening\.then\(\(opened\) => \{\s*if \(opened !== true\) cross\.opened = null;/);
  assert.doesNotMatch(app, /forCross/);
  // (on a phone an unfolded card folds first, as a tap on the map folds it)
  assert.match(app, /if \(card\.unfolded\) \{\s*card\.unfolded = false;\s*showFold\(\);\s*if \(freeMap\(\)\.fits\) return;\s*\}/);
  // (and where there is no free map at all, no tooltip over the details)
  assert.match(app, /const text = cross\.covered \? null : /);
  assert.match(app, /function clearOfCards\(\) \{\s*return freeMap\(\)\.padding;\s*\}/);
  assert.match(read('style.css'), /left: var\(--cross-x, 50%\); top: var\(--cross-y, 50%\); width: 48px; height: 48px; margin: -24px 0 0 -24px;/);
  // + and − zoom around it, and the map's own keys, which zoom around the middle of all of it, do not hear them
  assert.match(app, /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(app, /const wanted = map\.getZoom\(\) \+ by \* \(event\.shiftKey \? 2 : 1\);/);
  assert.match(app, /map\.easeTo\(\{ zoom, around: map\.unproject\(\[cross\.point\.x, cross\.point\.y\]\), duration: 300, easing: \(t\) => t \* \(2 - t\)/);
  // (the first key after a click places and aims it before it acts)
  assert.match(app, /if \(keysOnMap\(\) && !cross\.placed && event\.key !== 'Tab'\) \{\s*placeCross\(!\['Shift', 'Control', 'Alt', 'Meta', 'Escape'\]\.includes\(event\.key\)\);\s*aimCross\(\);\s*if \(event\.key === 'Enter'\) \{\s*event\.preventDefault\(\);\s*return;\s*\}\s*\}\s*if \(zoomKey\(event\) \|\| stepKey\(event\)\) return;/);
  // the camera's middle is the map's own, as without the keyboard: the page's own moves of the map are not shifted
  assert.doesNotMatch(app, /padding \}\);|setPadding/);
  // what it aims at is what a tap there opens, held while it is inside, shown as for a mouse, and said in a line's words
  assert.match(app, /const hit = held \|\| hitTest\(at\);/);
  assert.match(app, /if \(keysOnMap\(\)\) \{\s*if \(!cross\.placed\) placeCross\(\);/);
  // (not between a change of the map's size and its placing anew; what is on it moved by half the change)
  assert.match(app, /const dx = was \? cross\.point\.x - was\.x - grown\.x \/ 2 : 0;/);
  assert.match(app, /return vehicleName\(\{ name: v\.line, mode: v\.mode \}, \{ to: v\.to, delay: fresh \? v\.delay : null \}, drawing\(\)\);/);
  assert.match(read('index.html'), /<p class="spoken" id="map-said" role="status"><\/p>/);
  // the last input used has the tooltip: a mouse moving over the map, until a key
  assert.match(app, /map\.getCanvas\(\)\.addEventListener\('keydown', \(event\) => \{\s*const shown = !tooltip\.hidden;\s*cross\.mouse = false;/);
  // Enter opens it as a tap does, the keyboard going into its details; on nothing it says so and nothing changes
  assert.match(app, /if \(hit\) openHit\(hit\);\s*else closePanel\(\);/);
  assert.match(app, /if \(event\.key !== 'Enter' \|\| event\.repeat/);
  // (a stop of a board is open already: the keyboard onto the board)
  assert.match(app, /const opening = openHit\(hit\);\s*if \(!opening\) \{\s*panel\.focus\(\{ preventScroll: true \}\);\s*return;\s*\}\s*cross\.opened = /);
  // (a favourite opened by its address: into its details once they are there, if the keyboard waited)
  assert.match(app, /if \(opened === null \|\| !keysOnMap\(\)\) return;\s*if \(opened\) intoDetails\(\);/);
  assert.match(app, /const moves = state\.moves;\s*const res = await askServer\(`api\/address\?path=\$\{encodeURIComponent\(path\)\}`\)\.catch\(\(\) => null\);\s*if \(state\.moves !== moves\) return null;/);
  // (back under the crosshair by its mark, nearest of its places, with the next frame)
  assert.match(app, /cross\.settle = \{ key: opened\.key, until: performance\.now\(\) \+ 1000 \};/);
  // (what Enter opened, opened again by its address, is known by its name and place)
  assert.match(app, /return Boolean\(at\?\.name && Number\.isFinite\(at\.lat\) && Number\.isFinite\(at\.lon\) && sameStop\(opened\.station, at\)\);/);
  assert.match(app, /noticeOnMap\(t\('map\.nothing'\)\);\s*return;/);
  // (a favourite whose address does not answer says so beside it as well)
  assert.match(app, /cross\.opened = null;\s*noticeOnMap\(t\('status\.noConnection'\)\);/);
  // (Enter as the first key after a click shows the crosshair, and opens nothing not yet in sight)
  assert.match(app, /if \(event\.key === 'Enter'\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/);
  // the details give the keyboard back to the map, also where they took the place of others, and what it opened lies under
  // the crosshair again only as those very details close
  assert.match(app, /panelOpener = map\.getCanvas\(\);/);
  assert.match(app, /if \(!openedByCross\(state\.selection\)\) cross\.opened = null;/);
  assert.match(app, /if \(!opened \|\| !keysOnMap\(\) \|\| !panel\.hidden\) return;/);
  assert.match(app, /cross\.opened = null;\s*setSheetHeight\(null\);/);
});

test('long without an answer, the details show their delays grey for as long as it lasts and say how old they are; Back without a connection goes to what the page holds', () => {
  const app = withoutComments(read('app.js'));
  const css = read('style.css');
  // grey from two minutes after the last answer, and so for as long as it lasts: never by the timetable alone (#361)
  assert.match(app, /const STALE_S = 120;/);
  assert.match(app, /return now\(\) - shownAt\(selection\) >= STALE_S \? 1 : 0;/);
  // (as the delays turn grey, a screen reader hears it once, however the details come to be drawn anew then)
  assert.match(app, /if \(stage > \(state\.selection\.stage \?\? 0\)\) say\(lostSince\(\)\);/);
  assert.match(app, /let shown = data;/);
  assert.doesNotMatch(app, /SCHEDULE_S|byTimetable|offlineSchedule|heardAt/);
  // the note gives the time of what the details show, true whether or not the page saw the connection go: their own last
  // answer, or for "Alle Linien" kept from an earlier one, that one's, with its day where that is another than today (#375);
  // that the delays are not current only where it shows one
  assert.match(app, /const time = formatWhen\(shownAt\(selection\), now\(\)\);/);
  assert.match(app, /const stale = staleness\(\) === 1 && showsDelays\(selection\);\s*if \(selection\.connecting\) return stale \? t\('panel\.connectingStale', \{ time \}\) : t\('panel\.connecting', \{ time \}\);\s*return stale \? t\('panel\.offlineStale', \{ time \}\) : t\('panel\.offline', \{ time \}\);/);
  assert.match(app, /return linesAt \? Math\.min\(selection\.answeredAt, linesAt\) : selection\.answeredAt;/);
  assert.match(app, /data\.linesAt = selection\.data\.linesAt;\s*data\.linesDay = selection\.data\.linesDay;\s*\} else if \(data\.lines\) \{\s*data\.linesAt = selection\.answeredAt;\s*data\.linesDay = data\.today \? \{ date: data\.today\.date, last: data\.today\.last \} : null;\s*\}/);
  // the delays held are grey wherever they are drawn: a line's vehicles and the map's, flags and colours, and a vehicle's
  // name says none then; a departure without one keeps its question mark, as at the last answer
  assert.match(app, /colors\.delay\[delaysHeld \? 'none' : delayClass\(v\.delay\)\]/);
  assert.match(app, /color: colors\.delay\[delaysHeld \? 'none' : flag\.color\]/);
  assert.match(app, /delaysHeld = !state\.online && staleness\(\) === 1;/);
  assert.match(app, /delaysHeld = staleness\(\) === 1;/);
  assert.match(read('panel.js'), /stale \? null : delayText\(v\.delay\)/);
  assert.match(app, /return heldShown\(selection\) && selection\.liveAt !== undefined \? selection\.liveAt : realtimeState\(\) === 'live';/);
  // a departure shown by its time of day goes once it has left, as one shown by its minutes
  assert.match(app, /\|\| goneSinceDrawn\(at\)\)\) \{/);
  // the note is never cut: it goes on in a second line, between its parts, with its dot
  assert.match(app, /if \(!item\.classList\.contains\('connection'\)\) open\(item\);/);
  assert.match(css, /\.panel-head \.notes \.connection \.part \{ display: inline; padding: 0; white-space: nowrap; overflow: visible; \}/);
  assert.match(read('locales/de.js'), /'panel\.offline': 'Stand \{time\} · keine Verbindung',\s*'panel\.offlineStale': 'Stand \{time\} · keine Verbindung · Verspätungen veraltet',/);
  assert.match(read('locales/en.js'), /'panel\.offline': 'As of \{time\} · no connection',[^]*'panel\.offlineStale': 'As of \{time\} · no connection · delays not current',/);
  assert.match(css, /#panel\.stale \.delay \{ color: var\(--text-muted\); \}/);
  // the folded card does not say what the head says, and a sheet up to it stays below it as it grows
  assert.match(css, /:root\[data-lost\] \.status\[data-state="error"\] \{ display: none; \}/);
  assert.match(app, /if \(sheetAtTop \|\| panel\.offsetHeight > high \+ 1\) setSheetHeight\(high\);\s*\}\)\.observe\(\$\('controls'\)\);/);
  // an address the page cannot ask about: what it showed in this visit, else that it will load, once the connection is back
  assert.match(app, /res = await askServer\(`api\/address\?path=\$\{encodeURIComponent\(path\)\}`\);\s*\} catch \{\s*clearTimeout\(slow\);\s*return here\(\) === path && state\.moves === moves \? addressLost\(path, loaded\) : true;/);
  // (every question to the server gives up after ANSWER_MS: a hang counts as not coming; while the connection fails, after
  // TRY_MS where its answer has not begun, #365)
  assert.match(app, /const whole = giveUp\(ANSWER_MS\);\s*const begun = failingNow\(\) \? giveUp\(TRY_MS\) : null;\s*const asked = fetch\(url, \{ signal: asking\.signal \}\);\s*asked\.then\(\(\) => clearTimeout\(begun\), \(\) => \{\s*clearTimeout\(begun\);\s*clearTimeout\(whole\);\s*\}\);\s*return asked;/);
  assert.deepEqual(app.match(/\bfetch\(/g), ['fetch(']);
  assert.match(app, /function openPending\(\) \{\s*const \{ loaded \} = state\.addressPending;\s*state\.addressPending = false;\s*openAddress\(loaded\);/);
  assert.match(app, /if \(state\.addressPending\) openPending\(\);/);
  // what did not load has the head its row knew of it
  assert.match(app, /hint: tripHint\(row\.dataset\.trip\)/);
  assert.match(app, /if \(type === 'trip' && hint\) return el\('div', \{ class: 'panel-head' \}, \[el\('h1', \{\}, \[badge\(hint\.line, hint\.mode\)/);
});

test('without a connection, a vehicle whose known way has ended leaves the map and a line, and an open line keeps its vehicles by its stops', () => {
  const app = withoutComments(read('app.js'));
  assert.match(app, /const beyond = !state\.online && time > v\.knots\[v\.knots\.length - 3\];\s*const target = beyond \? openPlace\(v\.id, time\) : positionAt\(v\.knots, time\);\s*if \(!target\) continue;/);
  assert.match(app, /const ended = node\.dataset\.track !== undefined && at > track\[track\.length - 3\];\s*if \(ended && node === document\.activeElement\) panel\.focus\(\{ preventScroll: true \}\);\s*node\.hidden = ended;/);
  assert.match(app, /\} else if \(selection\.type === 'line'\) \{/);
  // drawn anew when a day begins, or the service day of what is shown ends (#375); the screen reader's line not left with an
  // older note than the one shown, emptied, which is not read out
  assert.match(app, /dayTurned\(state\.selection, now\(\)\)\) \{\s*showSelection\(\);\s*if \(\$\('panel-said'\)\.textContent !== \(lostSince\(\) \?\? ''\)\) say\(''\);\s*return;\s*\}/);
  assert.match(app, /function dayTurned\(selection, at\) \{\s*const drawn = selection\.drawnAt \?\? at;\s*if \(dayOf\(drawn\) !== dayOf\(at\)\) return true;/);
  assert.match(app, /const ends = \[data\.today\?\.last, data\.linesDay\?\.last, data\.facts\?\.last\]\.filter\(\(last\) => last >= drawn\);\s*return ends\.some\(\(last\) => last < at\);/);
  assert.match(app, /day: dayOf, dayStart: dayStartOf,/);
  // ("nicht in 24 h" only as far as the departures held reach, the server's two hours)
  assert.match(app, /const LATER_S = 7200;/);
  // a board says it too, after its rows or alone
  assert.match(app, /const lost = state\.selection\?\.failing && !heldMore \? toDom\(whenBack\(drawing\(\)\)\) : null;/);
});

test('what a board block says where it has no rows is as large and as dark as rows, and starts where they do (#374)', () => {
  const app = withoutComments(read('app.js'));
  const css = read('style.css');
  // each message that stands in place of the rows is marked: departures that did not load, a stop not in the timetable,
  // that more come once the connection is back, that there are none
  assert.match(app, /const alone = \(node\) => \{\s*node\.classList\.add\('alone'\);\s*return node;\s*\};/);
  assert.match(app, /const notYet = \[\.\.\.gone, alone\(el\('p', \{ class: 'panel-empty', text: t\('panel\.loadFailed'\) \}\)\)\];/);
  assert.match(app, /if \(!shown\.length\) \{\s*if \(state\.selection\?\.failing && block\.some\(\(entry\) => !entry\.known\?\.gone\)\) return notYet;\s*return block\.every\(\(entry\) => entry\.known\?\.gone\) \? gone\.map\(alone\) : gone;\s*\}/);
  assert.match(app, /if \(!rows\.length\) return \[\.\.\.gone, alone\(lost \?\? el\('p', \{ class: 'panel-empty', text: t\('departures\.none'\) \}\)\)\];\s*return \[\.\.\.gone, el\('ul', \{ class: `board-rows times-\$\{times\}` \}, rows\), lost\]\.filter\(Boolean\);/);
  // (in the text's colour and the block's own size, which is its rows'; flush, as is the line below rows, which stays grey)
  assert.match(css, /\.board-block > \.panel-empty \{ padding-left: 0; padding-right: 0; \}\n\.board-block > \.alone \{ color: var\(--text\); font-size: 1em; text-wrap: balance; \}/);
  assert.match(css, /\.panel-empty \{ padding: 14px; color: var\(--text-muted\); margin: 0; \}/);
  // (the details keep their empty lists as they are: the rule is the board's alone)
  assert.equal((css.replace(/\/\*[\s\S]*?\*\//g, '').match(/\.alone\b/g) ?? []).length, 1);
});

test('a start without a connection opens what the page holds for its address, saying that it connects; the app at the map opens what was open (#362)', () => {
  const app = withoutComments(read('app.js'));
  const sw = read('sw.js');
  // the service worker marks the page it keeps as it serves it, at the address of details and at the map
  assert.match(sw, /const KEPT_MARK = '<meta name="netnou-kept" content="">';/);
  assert.match(sw, /if \(request\.mode === 'navigate' && \(path === '\.\/' \|\| \/\^\(stop\|line\|trip\)\\\/\/\.test\(path\)\)\) \{\s*event\.respondWith\(start\(event, path, url\)\);/);
  assert.match(sw, /return keptPage\(kept, path === '\.\/' \? '' : `<base href="\$\{'\.\.\/'\.repeat\(path\.split\('\/'\)\.length - 1\)\}">\\n {2}`\);/);
  // (with the headers it was kept with, its security policy among them)
  assert.match(sw, /const headers = new Headers\(kept\.headers\);\s*headers\.delete\('Content-Length'\);\s*headers\.delete\('Content-Encoding'\);/);
  assert.match(app, /const KEPT = Boolean\(document\.querySelector\('meta\[name="netnou-kept"\]'\)\);/);
  assert.match(app, /if \(KEPT\) startHeld\(\)\.finally\(recallHeld\);\s*else setTimeout\(recallHeld, 2000\);/);
  // (a stop without a place of its own placed by its answer; a 404 for what is held asks the address again)
  assert.match(app, /const \{ lat, lon \} = selection\.at \?\? selection\.data \?\? \{\};/);
  assert.match(app, /if \(res\.status === 404\) \{\s*state\.selection = null;\s*openAddress\(\);\s*return;\s*\}/);
  // what is held opens as Back without a connection opens it, saying that the page connects, until its first answer or failure
  assert.match(app, /const lost = connectionLost\(\);\s*restoreHeld\(entry, path, lost, !lost\);\s*placeSent\(entry\.selection\);/);
  // (at the address of a stop by its name and place, as a favourite's link has it, the stop held under its own address, which
  // takes that one's place)
  assert.match(app, /const held = \(await heldDetails\(path\)\) \?\? \(atMap \? null : await heldStopStored\(path\)\);/);
  assert.match(app, /const held = visited\.get\(path\) \?\? heldStop\(\[\.\.\.visited\.values\(\)\], path\);/);
  assert.match(app, /const own = held\.selection\.path \?\? path;\s*if \(own !== path\) stepHeld = true;\s*restore\(held, own, \.\.\.more\);/);
  // (drawn as held, as where the connection is lost, while it connects: only the note tells them apart, its dot grey)
  assert.match(app, /return Boolean\(selection\?\.failing \|\| selection\?\.connecting\);/);
  assert.match(app, /lost: heldShown\(\), laterKnown: !heldShown\(\) \|\| !\(now\(\) - shownAt\(state\.selection\) > LATER_S\), staleS: STALE_S \};/);
  assert.match(read('style.css'), /\.panel-head \.notes \.connection\.connecting \.dot \{ background: var\(--delay-none\); \}/);
  // (an error answer ends the waiting: an address gone says so)
  assert.match(app, /\} else if \(heldShown\(selection\)\) \{[^]*?\}\s*disconnected\(selection\);/);
  assert.match(app, /const lost = !connecting && \(lostNow \|\| connectionLost\(\) \|\| Boolean\(state\.selection\?\.failing\)\);\s*back\.selection\.connecting = connecting;/);
  assert.match(app, /selection\.liveAt = realtimeState\(\) === 'live';\s*if \(selection\.connecting && !selection\.failing\) say\(''\);\s*selection\.connecting = false;/);
  assert.match(app, /selection\.failing = true;\s*selection\.connecting = false;/);
  // at the map, what was open last, where any of it lies ahead
  assert.match(app, /const fits = held && readBoard\(location\.search\) === null && \(atMap \|\| asked === choiceValue\(held\.lines \?\? \[\]\)\);\s*if \(fits && \(!atMap \|\| stillAhead\(held\)\)\) \{/);
  // each answer stored, not a board's, with which address is open, the map alone too; the area with the server's clock
  assert.match(app, /if \(entry\.board === null\) holdDetails\(path, \{ \.\.\.entry, selection: storable\(selection\) \}\);/);
  assert.match(app, /showAddress\('', null\);\s*holdLast\(''\);/);
  assert.match(app, /holdArea\(area, state\.clockOffset\);/);
  assert.match(app, /const VISITED = HELD;/);
  assert.match(read('locales/de.js'), /'panel\.connecting': 'Stand \{time\} · Verbinde …',\s*'panel\.connectingStale': 'Stand \{time\} · Verbinde … · Verspätungen veraltet',/);
  assert.match(read('locales/en.js'), /'panel\.connecting': 'As of \{time\} · connecting …',[^]*'panel\.connectingStale': 'As of \{time\} · connecting … · delays not current',/);
});
