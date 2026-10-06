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
const FALLBACK = 'en';
const STORAGE_KEY = 'netnou.lang';
// The attributes data-i18n-<attribute> can fill in, see translatePage().
export const ATTRIBUTES = ['aria-label', 'title', 'content', 'placeholder'];

const primary = (tag) => tag.toLowerCase().split('-')[0];

let language = FALLBACK;
let messages = en;
// What numbers and times are formatted for: the visitor's regional variant of
// the language where the browser names one (en-GB: 14:05, en-US: 2:05 PM).
let locale = FALLBACK;
let timeZone; // of the area; undefined = the browser's
let numberFormat;
let pluralRules;
let timeFormat;

function setFormats() {
  numberFormat = new Intl.NumberFormat(locale);
  pluralRules = new Intl.PluralRules(locale);
  timeFormat = new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone });
}
setFormats();

function storedLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode or blocked storage
  }
}

/**
 * The language to show: the one chosen with the picker, else the first of the
 * browser's languages (navigator.languages, most wanted first) that exists
 * here, else English.
 */
export function pickLanguage(stored, preferred) {
  const available = LANGUAGES.map(([code]) => code);
  if (available.includes(stored)) return stored;
  return preferred.map(primary).find((code) => available.includes(code)) ?? FALLBACK;
}

/** Loads the texts of the visitor's language and returns its code. Before that, t() answers in English. */
export async function loadLanguage(stored = storedLanguage(), preferred = navigator.languages ?? []) {
  language = pickLanguage(stored, preferred);
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
 * The text for a key of locales/en.js. {name} in it is replaced by params.name,
 * numbers formatted for the language; plural forms are chosen by params.count.
 */
export function t(key, params = {}) {
  let message = messages[key] ?? en[key];
  if (message === undefined) return key;
  if (typeof message === 'object') message = message[pluralRules.select(params.count)] ?? message.other;
  return message.replace(/\{(\w+)\}/g, (placeholder, name) => {
    const value = params[name];
    if (value === undefined) return placeholder;
    return typeof value === 'number' ? formatNumber(value) : value;
  });
}

export const formatNumber = (value) => numberFormat.format(value);

/** Clock time of a point in time given in epoch seconds. */
export const formatTime = (epoch) => timeFormat.format(epoch * 1000);

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

/** Fills the language picker. Choosing a language stores it and reloads the page, which then starts in it. */
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
    location.reload();
  });
}
