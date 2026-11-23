#!/usr/bin/env node
// Writes what a browser lacks of some languages into their locale files.
//
// Chrome ships the texts of a language but not always its formats: for the
// languages below, Intl falls back to another language, and a page in Icelandic
// would say "6 PM" and "Monday". Node has the full Unicode data, so this takes
// them from there: times, days, months, lists, numbers and the names of the
// page's languages, as `export const formats` at the end of the file. The page
// uses them only where the browser has no formats of its own (public/i18n.js).
//
// Run it after adding a language to LANGUAGES, as `names` lists them all:
//   node tools/build-locale-formats.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES } from '../public/i18n.js';

// (the languages of the page for which Intl.DateTimeFormat.supportedLocalesOf answers nothing in Chrome)
const WITHOUT_FORMATS = ['be', 'ga', 'ha', 'is', 'ku', 'mk', 'mt', 'sq'];
const LOCALES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'locales');

const at = (hour, day = 23, month = 10) => Date.UTC(2026, month, day, hour, 36);
const part = (parts, type) => parts.find((item) => item.type === type)?.value;

/** The pattern of a time or an hour: {HH} or {H} or {h}, {mm}, {a}. */
function clockPattern(format) {
  const twelve = format.resolvedOptions().hourCycle === 'h12';
  const padded = part(format.formatToParts(at(9)), 'hour').length === 2;
  const token = { hour: twelve ? '{h}' : padded ? '{HH}' : '{H}', minute: '{mm}', dayPeriod: '{a}' };
  return format.formatToParts(at(13)).map(({ type, value }) => token[type] ?? value).join('');
}

function formatsOf(code) {
  const zone = { timeZone: 'UTC' };
  const time = new Intl.DateTimeFormat(code, { timeStyle: 'short', ...zone });
  const hour = new Intl.DateTimeFormat(code, { hour: 'numeric', ...zone });
  const date = new Intl.DateTimeFormat(code, { day: 'numeric', month: 'long', ...zone });
  const days = (weekday) => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(code, { weekday, ...zone }).format(at(12, 22 + i))); // (22 November 2026 is a Sunday)
  const list = new Intl.ListFormat(code, { type: 'conjunction' });
  const between = (words) => list.formatToParts(words).filter(({ type }) => type === 'literal').map(({ value }) => value);
  const number = new Intl.NumberFormat(code);
  const big = number.formatToParts(1234567.5);
  const names = new Intl.DisplayNames([code], { type: 'language', fallback: 'none' });
  return {
    time: clockPattern(time),
    hour: clockPattern(hour),
    ...(time.resolvedOptions().hourCycle === 'h12' ? { periods: [part(time.formatToParts(at(9)), 'dayPeriod'), part(time.formatToParts(at(13)), 'dayPeriod')] } : {}),
    date: date.formatToParts(at(12)).map(({ type, value }) => ({ day: '{d}', month: '{month}' })[type] ?? value).join(''),
    weekdays: days('long'),
    days: days('short'),
    months: Array.from({ length: 12 }, (_, month) => part(date.formatToParts(at(12, 23, month)), 'month')),
    list: [between(['A', 'B'])[0], between(['A', 'B', 'C']).at(-1)],
    number: { group: part(big, 'group'), decimal: part(big, 'decimal'), from: part(number.formatToParts(1234), 'group') ? 4 : 5, minus: part(number.formatToParts(-5), 'minusSign') },
    names: Object.fromEntries(LANGUAGES.map(([other]) => [other, names.of(other)]).filter(([, name]) => name)),
  };
}

const text = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\u00a0/g, '\\u00a0').replace(/\u202f/g, '\\u202f')}'`;
const written = (value) => {
  if (typeof value === 'string') return text(value);
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `[${value.map(written).join(', ')}]`;
  return `{ ${Object.entries(value).map(([key, item]) => `${/^[a-z]+$/i.test(key) ? key : text(key)}: ${written(item)}`).join(', ')} }`;
};

const HEAD = '// What a browser without formats of this language needs (see tools/build-locale-formats.mjs, which writes this).\n';
for (const code of WITHOUT_FORMATS) {
  const file = path.join(LOCALES, `${code}.js`);
  if (!fs.existsSync(file)) continue;
  const texts = fs.readFileSync(file, 'utf8').split(`\n${HEAD}`)[0].trimEnd();
  const lines = Object.entries(formatsOf(code)).map(([key, value]) => `  ${key}: ${written(value)},`);
  fs.writeFileSync(file, `${texts}\n\n${HEAD}export const formats = {\n${lines.join('\n')}\n};\n`);
}
