// The texts of the page in the visitor's language, without a framework and
// without a build step: one module per language in locales/, of which only the
// one in use is loaded (plus English, which fills any gaps).
//
// Adding a language takes three steps; test/frontend.test.js fails if one of
// them is forgotten or a text is missing:
//   1. copy locales/en.js to locales/<code>.js and translate the values,
//   2. add it to LANGUAGES below,
//   3. add the file to SHELL in sw.js, so that the installed app starts offline with it.

import en from './locales/en.js';

// [code, the language's own name]. The code is the primary subtag of a language
// tag, so 'de' also serves a browser that asks for de-AT or de-CH.
export const LANGUAGES = [
  ['de', 'Deutsch'],
  ['en', 'English'],
];
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

const primary = (tag) => tag.toLowerCase().split('-')[0];

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

function setFormats() {
  numberFormat = new Intl.NumberFormat(locale);
  pluralRules = new Intl.PluralRules(locale);
  timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone });
  dayFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });
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
 * address asks for, else the first of the browser's languages
 * (navigator.languages, most wanted first) that exists here, else English.
 */
export function pickLanguage(stored, preferred, asked = null) {
  const available = LANGUAGES.map(([code]) => code);
  if (available.includes(stored)) return stored;
  if (available.includes(asked)) return asked;
  return preferred.map(primary).find((code) => available.includes(code)) ?? FALLBACK;
}

/** Loads the texts of the visitor's language and returns its code. Before that, t() answers in English. */
export async function loadLanguage(stored = storedLanguage(), preferred = navigator.languages ?? [], asked = askedLanguage()) {
  language = pickLanguage(stored, preferred, asked);
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
 * Whether the page is in a language chosen with the picker that the server
 * did not write it in: then the title and the description the server gave
 * it are in another language than the page.
 * @param sent the language the server wrote the page in
 */
export const sentInAnother = (sent = SENT) => chosen && language !== sent;

/**
 * The text for a key of locales/en.js. {name} in it is replaced by params.name,
 * numbers formatted for the language; plural forms are chosen by params.count.
 * @param texts those of another language than the visitor's, for the server
 */
export function t(key, params = {}, texts = messages) {
  let message = texts[key] ?? en[key];
  if (message === undefined) return key;
  if (typeof message === 'object') message = message[pluralRules.select(params.count)] ?? message.other;
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => {
    const value = params[name];
    if (value === undefined) return placeholder;
    return typeof value === 'number' ? formatNumber(value) : value;
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

/**
 * Fills the language picker. Choosing a language stores it and loads the page
 * again, which then starts in it – from the address without a language of its
 * own, which would say something else than what was just chosen.
 */
export function languagePicker(select) {
  for (const [code, name] of LANGUAGES) {
    const option = new Option(name, code, false, code === language);
    option.lang = code;
    select.append(option);
  }
  select.addEventListener('change', () => {
    try {
      localStorage.setItem(STORAGE_KEY, select.value);
    } catch {
      // private mode or blocked storage: the choice cannot be kept, so show what is in use
      select.value = language;
      return;
    }
    const address = new URL(location.href);
    address.searchParams.delete(ADDRESS_KEY);
    location.replace(address);
  });
}
