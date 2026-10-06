// Finds stops by their name, in the browser: what a visitor types stays
// there, and so does their position, which the order of the results makes use
// of. Nothing in here knows the page, so that test/search.test.js runs it as
// it is.
//
// A stop is found if every word typed is the beginning of a word of its name,
// in any order, or stands inside one. Where no stop is found that way, the
// words may be spelled a little differently.

// How close a match is. It comes first in the order of the results.
const BEGINNING = 0;
const INSIDE = 1;
const SPELLING = 2;

// What the names abbreviate. A name answers to both forms.
const SPELLED_OUT = { hbf: 'hauptbahnhof', bf: 'bahnhof', str: 'strasse', pl: 'platz' };
// A stop that trains call at is a "Bahnhof", whatever its name says.
const RAIL_MODES = ['suburban', 'regional', 'longdistance'];
// On a keyboard without them, umlauts are typed as two letters.
const TWO_LETTERS = { ä: 'ae', ö: 'oe', ü: 'ue' };

// The service of a stop is divided by the square of the distance to the
// visitor in kilometres, plus this much: a few metres make no difference, and
// neither does what the position is off by.
const NEAR_KM = 0.1;

/** Lower case and without accents, "ß" as "ss": "Plärrer" becomes "plarrer". */
export const fold = (text) => text.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '');

const split = (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The words somebody typed, each once: "Nürnberg, Plärrer" becomes ["nurnberg", "plarrer"]. */
export const wordsOf = (text) => [...new Set(split(fold(text)))];

/** The words a stop answers to: those of its name and what else they may be typed as. */
function wordsOfStop(name, modes) {
  const words = new Set();
  for (const written of split(name.toLowerCase())) {
    const word = fold(written);
    words.add(word);
    const twoLetters = written.replace(/[äöü]/g, (umlaut) => TWO_LETTERS[umlaut]);
    if (twoLetters !== written) words.add(fold(twoLetters));
    if (SPELLED_OUT[word]) words.add(SPELLED_OUT[word]);
    // "Ludwigstr." is the Ludwigstrasse
    else if (word.endsWith('str')) words.add(`${word}asse`);
  }
  if (modes.some((mode) => RAIL_MODES.includes(mode))) words.add('bahnhof');
  return [...words];
}

/**
 * Makes the stations of api/search searchable.
 * @param stations their columns: id, name, lat, lon, modes and service
 */
export function buildIndex(stations) {
  const words = stations.name.map((name, i) => wordsOfStop(name, stations.modes[i]));
  // every word once: among them the close spellings are looked for
  return { ...stations, words, vocabulary: [...new Set(words.flat())] };
}

/** How many slips a word of this length may contain and still be taken for another. */
const slipsAllowed = (word) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

/**
 * Whether `typed` is the beginning of `word` but for a few slips: a wrong, a
 * missing or an extra letter, or two that changed places.
 */
function nearlyBegins(word, typed, slips) {
  const m = typed.length;
  // distance between the first i letters typed and the letters of the word so far
  let before = null;
  let column = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= Math.min(word.length, m + slips); j++) {
    const next = [j];
    let least = j;
    for (let i = 1; i <= m; i++) {
      let distance = Math.min(column[i] + 1, next[i - 1] + 1, column[i - 1] + (typed[i - 1] === word[j - 1] ? 0 : 1));
      if (before && i > 1 && typed[i - 1] === word[j - 2] && typed[i - 2] === word[j - 1]) distance = Math.min(distance, before[i - 2] + 1);
      next[i] = distance;
      least = Math.min(least, distance);
    }
    if (next[m] <= slips) return true;
    if (least > slips) return false;
    before = column;
    column = next;
  }
  return false;
}

/** The words of the stops that `typed` may be a slip of. The first letter has to be right. */
function closeSpellings(vocabulary, typed) {
  const slips = slipsAllowed(typed);
  if (!slips) return null;
  return new Set(vocabulary.filter((word) => word[0] === typed[0] && nearlyBegins(word, typed, slips)));
}

/** How closely the words of a stop match those typed, or -1 if one of them does not at all. */
function closeness(words, typed, spellings) {
  let worst = BEGINNING;
  for (let k = 0; k < typed.length; k++) {
    const word = typed[k];
    let best = -1;
    if (words.some((own) => own.startsWith(word))) best = BEGINNING;
    else if (words.some((own) => own.includes(word))) best = INSIDE;
    else if (spellings?.[k] && words.some((own) => spellings[k].has(own))) best = SPELLING;
    if (best < 0) return -1;
    worst = Math.max(worst, best);
  }
  return worst;
}

const kilometres = (lat1, lon1, lat2, lon2) => Math.hypot(lat1 - lat2, (lon1 - lon2) * Math.cos((lat1 * Math.PI) / 180)) * 111.2;

/**
 * The stops that match what was typed, the most likely first: the closer
 * matches before the others, and among equally close ones those with more
 * service. Service counts for less the further a stop is from `near`.
 * @param index from buildIndex
 * @param near { lat, lon } of the visitor, if they have it shown
 * @returns up to `limit` of { id, name, lat, lon, modes }
 */
export function search(index, query, { near = null, limit = 8 } = {}) {
  const typed = wordsOf(query);
  if (!typed.length) return [];

  const collect = (spellings) => {
    const found = [];
    for (let i = 0; i < index.words.length; i++) {
      const match = closeness(index.words[i], typed, spellings);
      if (match >= 0) found.push({ i, match });
    }
    return found;
  };
  let found = collect(null);
  // Close spellings only where nothing is found without them: they bring in
  // what was not meant as well ("feuer" is nearly the beginning of "Fürth").
  if (!found.length) found = collect(typed.map((word) => closeSpellings(index.vocabulary, word)));

  const weight = (i) => (near ? index.service[i] / (kilometres(near.lat, near.lon, index.lat[i], index.lon[i]) + NEAR_KM) ** 2 : index.service[i]);
  return found
    .map(({ i, match }) => ({ i, match, weight: weight(i) }))
    .sort((a, b) => a.match - b.match || b.weight - a.weight || index.name[a.i].localeCompare(index.name[b.i]))
    .slice(0, limit)
    .map(({ i }) => ({ id: index.id[i], name: index.name[i], lat: index.lat[i], lon: index.lon[i], modes: index.modes[i] }));
}
