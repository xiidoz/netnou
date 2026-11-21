// The list of the page's languages (#392), behind the gear: in which order it
// shows them, what it says of each, and which a search finds. Without the
// page, so that the tests run it as it is (test/frontend.test.js); app.js
// draws the list.

import { LANGUAGES, primaryCode, secondCodes } from './i18n.js';
import { fold } from './stops.js';

// Other names a language is found by besides those the browser knows
// (Intl.DisplayNames): its own name in Latin letters, as someone types it
// without a keyboard for its script, and names in common use.
export const ALIASES = {
  ar: ['arabi', 'arabiya'],
  be: ['belaruskaja', 'bielaruskaja'],
  bg: ['balgarski', 'bulgarski'],
  bn: ['bangla'],
  cs: ['cesky'],
  el: ['ellinika'],
  es: ['castellano'],
  fa: ['farsi', 'dari'],
  fil: ['tagalog', 'pilipino'],
  he: ['ivrit'],
  hi: ['hindi'],
  ja: ['nihongo'],
  ko: ['hangugeo', 'hangukeo'],
  ku: ['kurmanji'],
  mk: ['makedonski'],
  mr: ['marathi'],
  nl: ['vlaams', 'flemish'],
  nb: ['bokmal', 'norsk'],
  ru: ['russkij', 'russkiy', 'russki'],
  sr: ['srpski'],
  ta: ['tamil'],
  te: ['telugu'],
  uk: ['ukrainska', 'ukrainskyi'],
  ur: ['urdu'],
  zh: ['zhongwen', 'putonghua', 'mandarin'],
};

/** The name of a language in another one, as the browser has it, or null where it has none. */
export function nameIn(code, language) {
  try {
    return new Intl.DisplayNames([language], { type: 'language', fallback: 'none' }).of(code) ?? null;
  } catch {
    return null; // a language Intl does not know
  }
}

const firstUp = (text, language) => text.charAt(0).toLocaleUpperCase(language) + text.slice(1);

/**
 * A language's name in another one as it stands alone, on a line of its own:
 * with a capital first letter where the language writes it in lower case
 * within a sentence ("allemand"); null where it has none.
 */
export function nameAlone(code, language) {
  const name = nameIn(code, language);
  return name ? firstUp(name, language) : null;
}

/** What a row says below a language's own name: its name in the page's language, or null where that says the same. */
export function secondName(code, own, page) {
  const name = nameAlone(code, page);
  return name && fold(name) !== fold(own) ? name : null;
}

// (as the stop search folds what is typed, and for names in Arabic script also the forms of yeh and kaf that Persian
// writes, and the article al- at the start of a word: "عربية" finds "العربية")
const folded = (text) => fold(text).replace(/[یى]/g, 'ي').replace(/ک/g, 'ك');
const words = (text) => folded(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((word) => word.replace(/^ال(?=\p{L})/u, ''));

/**
 * The order of the list: the language in use and those of the browser's
 * languages that the page has, in the browser's order ("Your languages"),
 * then all the others in the order of LANGUAGES, their own names, the same
 * whatever language the page is in.
 * @param preferred the browser's languages, as navigator.languages
 */
export function languageOrder(current, preferred, codes = LANGUAGES.map(([code]) => code)) {
  const yours = [...new Set([current, ...preferred.map(primaryCode)])].filter((code) => codes.includes(code));
  return { yours, more: codes.filter((code) => !yours.includes(code)) };
}

/**
 * Whether what is typed finds a language: the start of a word of its own
 * name, of its name in the page's language, in each of the browser's
 * languages or in English, of its codes or of an alias (ALIASES); or the
 * start of one of those names as a whole, for what is typed with a space.
 * Capitals and accents do not count. Nothing typed finds all.
 * @param context { page, preferred }: the page's language and the browser's languages
 */
export function languageFound(code, own, typed, { page, preferred = [] }) {
  const wanted = folded(typed).trim();
  if (!wanted) return true;
  const names = [own, nameIn(code, page), ...preferred.map((tag) => nameIn(code, tag)), nameIn(code, 'en'), code, ...secondCodes(code), ...(ALIASES[code] ?? [])].filter(Boolean);
  const start = wanted.replace(/^ال(?=\p{L})/u, '');
  return names.some((name) => folded(name).startsWith(wanted) || words(name).some((word) => word.startsWith(start)));
}
