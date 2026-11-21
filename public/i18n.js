// The texts of the page in the visitor's language, without a framework and
// without a build step: one module per language in locales/, of which only the
// one in use is loaded (plus English, which fills any gaps).
//
// Adding a language takes two steps; test/frontend.test.js fails if one of
// them is forgotten or a text is missing:
//   1. copy locales/en.js to locales/<code>.js and translate the values,
//   2. add it to LANGUAGES below.
// The installed app keeps the texts of the languages a browser uses (sw.js).

import en from './locales/en.js';

// [code, the language's own name], in the order of those names as
// Intl.Collator sorts them: Latin letters, then Greek, Cyrillic and the other
// scripts. The code is the primary subtag of a language tag, so 'de' also
// serves a browser that asks for de-AT or de-CH (and see SAME).
export const LANGUAGES = [
  ['af', 'Afrikaans'],
  ['id', 'Bahasa Indonesia'],
  ['bs', 'Bosanski'],
  ['ca', 'Català'],
  ['cs', 'Čeština'],
  ['da', 'Dansk'],
  ['de', 'Deutsch'],
  ['et', 'Eesti'],
  ['en', 'English'],
  ['es', 'Español'],
  ['fil', 'Filipino'],
  ['fr', 'Français'],
  ['ga', 'Gaeilge'],
  ['ha', 'Hausa'],
  ['hr', 'Hrvatski'],
  ['is', 'Íslenska'],
  ['it', 'Italiano'],
  ['sw', 'Kiswahili'],
  ['ku', 'Kurdî'],
  ['lv', 'Latviešu'],
  ['lt', 'Lietuvių'],
  ['hu', 'Magyar'],
  ['mt', 'Malti'],
  ['nl', 'Nederlands'],
  ['nb', 'Norsk'],
  ['pl', 'Polski'],
  ['pt', 'Português'],
  ['ro', 'Română'],
  ['sq', 'Shqip'],
  ['sk', 'Slovenčina'],
  ['sl', 'Slovenščina'],
  ['fi', 'Suomi'],
  ['sv', 'Svenska'],
  ['vi', 'Tiếng Việt'],
  ['tr', 'Türkçe'],
  ['el', 'Ελληνικά'],
  ['be', 'Беларуская'],
  ['bg', 'Български'],
  ['mk', 'Македонски'],
  ['ru', 'Русский'],
  ['sr', 'Српски'],
  ['uk', 'Українська'],
  ['mr', 'मराठी'],
  ['hi', 'हिन्दी'],
  ['bn', 'বাংলা'],
  ['ta', 'தமிழ்'],
  ['te', 'తెలుగు'],
  ['ko', '한국어'],
  ['zh', '中文'],
  ['ja', '日本語'],
];
// Codes a browser may name a language by besides the one above: Norwegian
// Bokmål as Norwegian (no), Filipino as Tagalog (tl), and the older codes of
// Hebrew and Indonesian (iw, in), which Android still gives.
const SAME = { no: 'nb', tl: 'fil', iw: 'he', in: 'id' };
// The languages the repository has a README of its own in, README.<code>.md:
// the page's links to the software lead to the one in the language of the
// page, else to the main one in English, README.md. Every README names all of
// them at its top, English first (test/frontend.test.js).
export const READMES = ['de'];
const FALLBACK = 'en';
const STORAGE_KEY = 'netnou.lang';
// An address may ask for a language: ?lang=de. That is how a search engine
// gets to read the page in each of them (see server/lib/page.js).
const ADDRESS_KEY = 'lang';
// What the software is called. An instance may call itself something else
// (NETNOU_SITE_NAME of the server); the credits name the software all the same.
export const APP_NAME = 'Netnou';
// The attributes data-i18n-<attribute> can fill in, see translatePage().
export const ATTRIBUTES = ['aria-label', 'title', 'content', 'placeholder'];

const primary = (tag) => {
  const code = tag.toLowerCase().split('-')[0];
  return SAME[code] ?? code;
};

// The language the server wrote the page in, as <html lang> says before
// translatePage puts the visitor's there: picked by the browser's languages
// or the address (server/lib/page.js), as the server knows nothing of a
// language chosen with the picker, which is kept in the browser.
const SENT = typeof document === 'undefined' ? null : document.documentElement.lang;

let language = FALLBACK;
let chosen = false; // whether it is the one chosen with the picker
let messages = en;
// What numbers and times are formatted for: the visitor's regional variant of
// the language where the browser names one (en-GB: 14:05, en-US: 2:05 PM).
let locale = FALLBACK;
let timeZone; // of the area; undefined = the browser's
let numberFormat;
let pluralRules;
let timeFormat;
let dayFormat;
let hourFormat;
let weekdayFormat;
let fullWeekdayFormat;
let dateFormat;
let partsFormat;
let listFormat;

/**
 * A language tag whose numbers are written with the digits 0–9, as line
 * numbers, platforms, delays and the signs have them: Bengali and Marathi,
 * for example, would write times with their own digits, beside a delay "+2".
 */
export function latinDigits(tag) {
  try {
    return new Intl.Locale(tag, { numberingSystem: 'latn' }).toString();
  } catch {
    return tag; // not a language tag Intl knows
  }
}

function setFormats() {
  const digits = latinDigits(locale);
  numberFormat = new Intl.NumberFormat(digits);
  pluralRules = new Intl.PluralRules(locale);
  timeFormat = new Intl.DateTimeFormat(digits, { timeStyle: 'short', timeZone });
  dayFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
  hourFormat = new Intl.DateTimeFormat(digits, { hour: 'numeric', timeZone });
  weekdayFormat = new Intl.DateTimeFormat(digits, { weekday: 'short', timeZone });
  fullWeekdayFormat = new Intl.DateTimeFormat(digits, { weekday: 'long', timeZone });
  // (the day and the month in words, as the server writes a line's dates; the order of the visitor's region, as the time)
  dateFormat = new Intl.DateTimeFormat(digits, { day: 'numeric', month: 'long', timeZone });
  partsFormat = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  listFormat = new Intl.ListFormat(locale, { type: 'conjunction' });
}
setFormats();

function storedLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode or blocked storage
  }
}

/** The language the address of the page asks for, if it names one. */
function askedLanguage() {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(ADDRESS_KEY);
}

/**
 * The language to show: the one chosen with the picker, else the one the
 * address asks for, else the one the server sent the page in (`sent`), else
 * the first of the browser's languages (navigator.languages, most wanted
 * first) that exists here, else English. The server picks among the
 * browser's languages too, as it names them with its request; a page that
 * was asked for without any, as a search engine asks and then renders the
 * page in a browser of its own, keeps the main language it came in (#287).
 */
export function pickLanguage(stored, preferred, asked = null, sent = null) {
  const available = LANGUAGES.map(([code]) => code);
  if (available.includes(stored)) return stored;
  if (available.includes(asked)) return asked;
  if (available.includes(sent)) return sent;
  return preferred.map(primary).find((code) => available.includes(code)) ?? FALLBACK;
}

/** Loads the texts of the visitor's language and returns its code. Before that, t() answers in English. */
export async function loadLanguage(stored = storedLanguage(), preferred = navigator.languages ?? [], asked = askedLanguage(), sent = SENT) {
  language = pickLanguage(stored, preferred, asked, sent);
  chosen = language === stored;
  messages = en;
  if (language !== FALLBACK) {
    try {
      messages = (await import(`./locales/${language}.js`)).default;
    } catch (err) {
      console.warn(`language ${language} not loaded:`, err);
      language = FALLBACK;
    }
  }
  locale = preferred.find((tag) => primary(tag) === language) ?? language;
  setFormats();
  return language;
}

/**
 * The language to offer a visitor whom the address shows the page in another
 * one than their browser asks for (#287): the first of the browser's
 * languages that exists here, where it is not the one the address asks for.
 * Nothing where a language was chosen with the picker, or where the address
 * asks for none (or for one there is not): then the page is in the browser's.
 */
export function languageToOffer(stored = storedLanguage(), preferred = navigator.languages ?? [], asked = askedLanguage()) {
  const available = LANGUAGES.map(([code]) => code);
  if (available.includes(stored) || !available.includes(asked)) return null;
  const wanted = preferred.map(primary).find((code) => available.includes(code));
  return wanted && wanted !== asked ? wanted : null;
}

// The language of texts other than the visitor's, which t() is given: their
// plural forms and numbers follow that language's rules, not those of the
// page's. The server writes pages in every language with them (#384).
const languageOf = new WeakMap([[en, FALLBACK]]);
const rulesByLanguage = new Map();

/** Marks the texts of a language as such, for t(); returns them. */
export function textsIn(code, texts) {
  languageOf.set(texts, code);
  return texts;
}

/** The plural rules and the numbers of a language, made once. */
function rulesOf(code) {
  if (!rulesByLanguage.has(code)) rulesByLanguage.set(code, { plural: new Intl.PluralRules(code), number: new Intl.NumberFormat(latinDigits(code)) });
  return rulesByLanguage.get(code);
}

/** The texts of a language, for t(): to say something in it on a page in another one. */
export async function textsOf(code) {
  return code === FALLBACK ? en : textsIn(code, (await import(`./locales/${code}.js`)).default);
}

/**
 * Chooses a language as the picker does: kept in the browser, and the page
 * loaded again from its address without a language of its own, which would
 * say something else than what was just chosen. Where it cannot be kept
 * (private mode, blocked storage), nothing happens, unless `anyway`: the
 * address without a language shows the page in the browser's.
 */
export function chooseLanguage(code, anyway = false) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    if (!anyway) return false;
  }
  const address = new URL(location.href);
  address.searchParams.delete(ADDRESS_KEY);
  location.replace(address);
  return true;
}

/**
 * Whether the page is in a language chosen with the picker that the server
 * did not write it in: then the title and the description the server gave
 * it are in another language than the page.
 * @param sent the language the server wrote the page in
 */
export const sentInAnother = (sent = SENT) => chosen && language !== sent;

/**
 * The text for a key of locales/en.js. {name} in it is replaced by params.name,
 * numbers formatted for the language; plural forms are chosen by params.count.
 * @param texts those of another language than the visitor's, for the server:
 *   by the rules of their language where it is known (textsIn), else the page's
 */
export function t(key, params = {}, texts = messages) {
  let message = texts[key] ?? en[key];
  if (message === undefined) return key;
  const own = texts !== messages && languageOf.has(texts) ? rulesOf(languageOf.get(texts)) : null;
  // (a plural by the number itself where the language has words of its own for it, "twice", else by its kind)
  if (typeof message === 'object') message = message[params.count] ?? message[(own?.plural ?? pluralRules).select(params.count)] ?? message.other;
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => {
    const value = params[name];
    if (value === undefined) return placeholder;
    return typeof value === 'number' ? (own?.number ?? numberFormat).format(value) : value;
  });
}

/**
 * What the page is called and what it says about itself, with the name of the
 * area it shows if it has one. The server writes the same into the page before
 * it sends it, in the language of `texts` (server/lib/page.js).
 * @param site what the instance calls itself
 */
export function pageTexts(area, texts = messages, site = APP_NAME) {
  const title = area ? `${t('page.title', {}, texts)}: ${area}` : t('page.title', {}, texts);
  return { title: `${title} – ${site}`, description: area ? t('page.descriptionIn', { area }, texts) : t('page.description', {}, texts) };
}

export const formatNumber = (value) => numberFormat.format(value);

/** Clock time of a point in time given in epoch seconds. */
export const formatTime = (epoch) => timeFormat.format(epoch * 1000);

/** The date of a point in time given in epoch seconds, as YYYY-MM-DD where the area is: what tells today from tomorrow. */
export const dayOf = (epoch) => dayFormat.format(epoch * 1000);

/** The hour of a point in time given in epoch seconds, as a clock says a whole hour: "19 Uhr", "7 PM" (hoursText in panel.js). */
export const formatHour = (epoch) => hourFormat.format(epoch * 1000);

/** The day of the week of a point in time given in epoch seconds, short: "Mo", "Mon". */
export const formatWeekday = (epoch) => weekdayFormat.format(epoch * 1000);

/**
 * The start of a service day where the area is, as the timetable counts its
 * times: noon less 12 hours, in epoch seconds; as server/lib/time.js has it.
 * @param date yyyymmdd
 */
export function dayStartOf(date) {
  const noon = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), 12);
  const p = Object.fromEntries(partsFormat.formatToParts(noon).map(({ type, value }) => [type, +value]));
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - noon;
  return (noon - offset) / 1000 - 12 * 3600;
}

/**
 * When a moment was, as a note of how old what is shown is says it (#375):
 * its time of day; where it was on another day than `now` (where the area is,
 * as the times shown), with that day before it: "gestern 13:37", in the week
 * before the weekday, "Montag 13:37", earlier the date, "9. November 13:37".
 * @param epoch, now in epoch seconds
 */
export function formatWhen(epoch, now) {
  const time = formatTime(epoch);
  // (whole days between the two dates, which a day of 23 or 25 hours, as where the clocks change, does not upset)
  const date = (at) => Date.parse(`${dayOf(at)}T00:00:00Z`);
  const days = Math.round((date(now) - date(epoch)) / 86_400_000);
  if (!(days >= 1)) return time;
  if (days === 1) return t('when.yesterday', { time });
  if (days < 7) return t('when.weekday', { day: fullWeekdayFormat.format(epoch * 1000), time });
  return t('when.date', { date: dateFormat.format(epoch * 1000), time });
}

/** Words as a list: "a, b und c". */
export const formatList = (words) => listFormat.format(words);

/**
 * Times are shown in the time zone of the area (timeZone of api/area), as on
 * the clocks at the stops, not in the visitor's. Until it is known, the
 * browser's zone is used.
 */
export function setTimeZone(zone) {
  const before = timeZone;
  timeZone = zone;
  try {
    setFormats();
  } catch (err) {
    // not a zone this browser knows: stay with what was used so far
    console.warn(`time zone ${zone} not usable:`, err);
    timeZone = before;
  }
}

/**
 * Puts the texts into the static page (index.html holds the English ones):
 * data-i18n="key" sets the text of an element, data-i18n-<attribute>="key" one
 * of its ATTRIBUTES.
 */
export function translatePage() {
  document.documentElement.lang = language;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const attribute of ATTRIBUTES) {
    const source = `data-i18n-${attribute}`;
    for (const node of document.querySelectorAll(`[${source}]`)) node.setAttribute(attribute, t(node.getAttribute(source)));
  }
}

/** Fills the language picker. Choosing a language keeps it and loads the page again in it (chooseLanguage). */
export function languagePicker(select) {
  for (const [code, name] of LANGUAGES) {
    const option = new Option(name, code, false, code === language);
    option.lang = code;
    select.append(option);
  }
  select.addEventListener('change', () => {
    // (where the choice cannot be kept: show what is in use)
    if (!chooseLanguage(select.value)) select.value = language;
  });
}
