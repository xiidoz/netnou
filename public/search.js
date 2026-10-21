// Finds stops, lines and towns by their name, in the browser: what a visitor types
// stays there, and so does their position, which the order of the results
// makes use of. Nothing in here knows the page, so that test/search.test.js
// runs it as it is.
//
// A stop is found if every word typed is the beginning of a word of its name,
// in any order, or stands inside one. Where no stop is found that way, the
// words may be spelled a little differently. The town a stop is in counts as
// part of its name, whether the name says it or not: "Marienplatz" in Munich
// is found by "münchen marienplatz".
//
// The names of all stops are one text, and a word is looked for by reading
// through that text. Nothing is made for each stop: a list of all the stops
// of a country is a quarter of a million of them, and a phone would take
// seconds and tens of megabytes to give each its words.

import { fold, townToShow } from './stops.js';

// How close a match is. It comes first in the order of the results. A search
// goes as far as one of the three: to what begins with the words typed, to
// what has them inside as well, or to close spellings too.
const BEGINNING = 0;
const INSIDE = 1;
const SPELLING = 2;
const NOT = 3;

// What the names abbreviate. A name answers to both forms, and so does what
// is typed: "hbf" finds a "Hauptbahnhof".
const SPELLED_OUT = [['hbf', 'hauptbahnhof'], ['hauptbf', 'hauptbahnhof'], ['bf', 'bahnhof'], ['bhf', 'bahnhof'], ['str', 'strasse'], ['pl', 'platz']];
// What a stop answers to besides the words of its name, as the signs it has:
// one for each of the abbreviations, in their order, then
// - RAIL: trains call at it. That is a "Bahnhof", whatever its name says.
// - STREET: a word of its name ends in "str", which is "…strasse".
const ANSWERS = [...SPELLED_OUT.map(([, long]) => long), 'bahnhof'];
const RAIL = 1 << SPELLED_OUT.length;
const STREET = 2 << SPELLED_OUT.length;
const RAIL_MODES = ['suburban', 'regional', 'longdistance'];
// On a keyboard without them, umlauts are typed as two letters: the letter
// without its dots and an "e". These are ä, ö and ü.
const TWO_LETTERS = [0xe4, 0xf6, 0xfc];

// The service of a stop is divided by the square of the distance to the
// visitor in kilometres, plus this much: a few metres make no difference, and
// neither does what the position is off by.
const NEAR_KM = 0.1;

// Where one word typed leaves no more stops than this, the next word is
// looked for in their names alone; with more of them, reading through all
// the names once again is quicker.
const FEW = 30_000;

// (characters as their numbers)
const SPACE = 32;
const NEWLINE = 10;
const [DIGIT_0, DIGIT_9, LOWER_A, LOWER_E, LOWER_Z] = [48, 57, 97, 101, 122];


const split = (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** The words somebody typed, each once: "Nürnberg, Plärrer" becomes ["nurnberg", "plarrer"]. */
export const wordsOf = (text) => [...new Set(split(fold(text)))];

/** A name as one word: "ICE 12" becomes "ice12", "U-Bahn" becomes "ubahn". */
const compact = (text) => split(fold(text)).join('');

/** What was sent as the difference from the one before it, in 1e-5 degrees, as degrees. */
function degrees(differences) {
  const out = new Float64Array(differences.length);
  let sum = 0;
  for (let i = 0; i < out.length; i++) out[i] = (sum += differences[i]) / 1e5;
  return out;
}

// (what lettersOf has said of a character)
const lettersKnown = new Map();

/**
 * What a character of a name is in the text of its words (wordsTexts), for
 * every character that is not a plain letter or digit: the letters it is
 * compared as, a space if it is neither letter nor digit, and nothing if it
 * is an accent that stands by itself.
 * @param code the character, in lower case, as its number
 */
function lettersOf(code) {
  let letters = lettersKnown.get(code);
  if (letters === undefined) lettersKnown.set(code, (letters = fold(String.fromCodePoint(code)).replace(/[^\p{L}\p{N}]+/gu, ' ')));
  return letters;
}

// (numbers of two bytes are characters as they are, in the order the machine has its bytes in)
const asText = new TextDecoder(new Uint8Array(Uint16Array.of(1).buffer)[0] ? 'utf-16le' : 'utf-16be');

/**
 * The names of all stops as texts to look for words in: the words of a name
 * as fold() and wordsOf() make them, each between two spaces, and every name
 * on a line. "Nürnberg Hbf" and "Fürth (Bay) Hbf" become
 * " nurnberg hbf \n furth bay hbf \n".
 *
 * The stops with an umlaut in their name are in a second text as well, as
 * they are typed on a keyboard without umlauts: "Nürnberg" answers to
 * "nuernberg" too.
 * @param names of `count` stops, a line each
 * @returns { plain, twoLetters }, each with its `text` and with `starts`:
 *   where each line begins, and after the last one where the text ends. Of
 *   the second text `stops` says which stop each line is of, and `lineOf`
 *   which line a stop has there, -1 for none.
 */
function wordsTexts(names, count) {
  // (written character by character into room for them all: put together with what a text can do, it takes three times as long)
  const lower = names.toLowerCase();
  let plain = new Uint16Array(lower.length + 3 * count + 8);
  let two = new Uint16Array(plain.length >> 2);
  const longer = (codes, room) => {
    const more = new Uint16Array(Math.max(room, codes.length + (codes.length >> 1)));
    more.set(codes);
    return more;
  };
  const starts = new Int32Array(count + 1);
  const twoStarts = [0];
  const stops = [];
  const lineOf = new Int32Array(count).fill(-1);
  let [n, m] = [0, 0]; // how much of the two is written
  for (let line = 0, from = 0; line < count; line++) {
    let to = lower.indexOf('\n', from);
    if (to < 0) to = lower.length;
    // (a character becomes three at most, and the line gets a space at each end and a line break)
    const room = 3 * Math.max(0, to - from) + 3;
    if (n + room > plain.length) plain = longer(plain, n + room);
    if (m + room > two.length) two = longer(two, m + room);
    const twoFrom = m;
    let umlaut = false;
    let gap = true; // whether a space was written last
    plain[n++] = SPACE;
    two[m++] = SPACE;
    for (let i = from; i < to; i++) {
      let code = lower.charCodeAt(i);
      if ((code >= LOWER_A && code <= LOWER_Z) || (code >= DIGIT_0 && code <= DIGIT_9)) {
        plain[n++] = code;
        two[m++] = code;
        gap = false;
        continue;
      }
      let letters = ' ';
      if (code > 127) {
        code = lower.codePointAt(i);
        if (code > 0xffff) i++;
        letters = lettersOf(code);
      }
      if (letters === ' ') {
        if (!gap) {
          plain[n++] = SPACE;
          two[m++] = SPACE;
        }
        gap = true;
        continue;
      }
      for (let k = 0; k < letters.length; k++) {
        plain[n++] = letters.charCodeAt(k);
        two[m++] = letters.charCodeAt(k);
        gap = false;
      }
      if (TWO_LETTERS.includes(code)) {
        two[m++] = LOWER_E;
        umlaut = true;
      }
    }
    if (!gap) {
      plain[n++] = SPACE;
      two[m++] = SPACE;
    }
    plain[n++] = NEWLINE;
    two[m++] = NEWLINE;
    starts[line + 1] = n;
    if (umlaut) {
      lineOf[line] = stops.length;
      stops.push(line);
      twoStarts.push(m);
    } else {
      m = twoFrom;
    }
    from = to + 1;
  }
  return { plain: { text: asText.decode(plain.subarray(0, n)), starts }, twoLetters: { text: asText.decode(two.subarray(0, m)), starts: Int32Array.from(twoStarts), stops: Int32Array.from(stops), lineOf } };
}

/**
 * Makes what api/search sends searchable.
 * @param list its answer: the stations, the lines and the names of the modes
 * @param modeNames what the visitor reads the modes called, by mode: with
 *   { bus: 'Bus' } somebody may type "bus 33" for line 33 of the buses
 */
export function buildIndex({ modes, stations, lines }, modeNames = {}) {
  const { names } = stations;
  const count = stations.lat.length;
  // where each name begins in the text of them all, and after the last one where that ends
  const nameStarts = new Int32Array(count + 1);
  for (let i = 1; i <= count; i++) nameStarts[i] = i < count ? names.indexOf('\n', nameStarts[i - 1]) + 1 : names.length + 1;

  const kinds = Uint8Array.from(stations.modes);
  const rail = RAIL_MODES.reduce((sum, mode) => sum | (1 << modes.indexOf(mode)), 0);
  const { plain, twoLetters } = wordsTexts(names, count);
  // The towns are looked through as the stops are: their names as texts of
  // words. A town has no signs. Found itself (#24), a town has the service
  // of all its stations and the rectangle around them, [south, west,
  // north, east] for each.
  const towns = stations.towns ?? [];
  const townOf = stations.town ? Int32Array.from(stations.town) : new Int32Array(count).fill(-1);
  const lat = degrees(stations.lat);
  const lon = degrees(stations.lon);
  const townService = new Float64Array(towns.length);
  const box = new Float64Array(4 * towns.length);
  for (let t = 0; t < towns.length; t++) box.set([Infinity, Infinity, -Infinity, -Infinity], 4 * t);
  for (let i = 0; i < count; i++) {
    const t = townOf[i];
    if (t < 0) continue;
    townService[t] += stations.service[i];
    box[4 * t] = Math.min(box[4 * t], lat[i]);
    box[4 * t + 1] = Math.min(box[4 * t + 1], lon[i]);
    box[4 * t + 2] = Math.max(box[4 * t + 2], lat[i]);
    box[4 * t + 3] = Math.max(box[4 * t + 3], lon[i]);
  }
  return {
    count,
    modes,
    names,
    nameStarts,
    plain,
    twoLetters,
    towns: {
      count: towns.length,
      names: towns,
      // (where another town has the name too, '' elsewhere)
      districts: stations.districts ?? towns.map(() => ''),
      service: townService,
      box,
      ...wordsTexts(towns.join('\n'), towns.length),
      signs: new Uint8Array(towns.length),
    },
    // (the number of its town for every stop, -1 where none is known)
    townOf,
    lat,
    lon,
    kinds,
    service: Float64Array.from(stations.service),
    signs: signsOf(plain, kinds.map((kind) => kind & rail)),
    // For every stop how closely it matches the word that is being looked
    // for, and all the words so far.
    marks: new Uint8Array(count),
    worst: new Uint8Array(count),
    // The same for the longest word of the last search, without close
    // spellings and with them: while the words after it are typed, the next
    // search has that word again.
    first: { marks: new Uint8Array(count), of: null },
    slips: { marks: new Uint8Array(count), of: null },
    lines: {
      name: lines.name,
      mode: lines.mode.map((number) => modes[number]),
      agency: lines.agency.map((number) => lines.agencies[number]),
      to: lines.to,
      lat: degrees(lines.lat),
      lon: degrees(lines.lon),
      service: lines.service,
      compact: lines.name.map(compact),
    },
    modeOf: new Map(Object.entries(modeNames).map(([mode, name]) => [compact(name), mode])),
  };
}

/** How many slips a word of this length may contain and still be taken for another. */
const slipsAllowed = (word) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

/**
 * Whether `typed` is the beginning of a word but for a few slips: a wrong, a
 * missing or an extra letter, or two that changed places.
 * @param text has the word, from `from` to before `to`: a word of a name is
 *   looked at where it stands in the text of them all
 * @param rows three rows of numbers to work in, each with room for one more than the letters typed
 */
function nearlyBegins(text, from, to, typed, slips, rows) {
  const m = typed.length;
  // (the word would have to be longer for all that was typed to be in it)
  if (to - from < m - slips) return false;
  // The distance between the first i letters typed and the letters of the
  // word so far, for the i that are no further from the number of those
  // letters than there may be slips: further off, the distance is more than
  // that in any case, and counts as one more.
  let [before, column, next] = rows;
  for (let i = 0; i <= m; i++) column[i] = i;
  for (let j = 1; j <= Math.min(to - from, m + slips); j++) {
    const letter = text.charCodeAt(from + j - 1);
    const low = Math.max(1, j - slips);
    const high = Math.min(m, j + slips);
    next[low - 1] = low === 1 ? j : slips + 1;
    let least = next[low - 1];
    for (let i = low; i <= high; i++) {
      let distance = Math.min((i < j + slips ? column[i] : slips + 1) + 1, next[i - 1] + 1, column[i - 1] + (typed.charCodeAt(i - 1) === letter ? 0 : 1));
      if (j > 1 && i > 1 && typed.charCodeAt(i - 1) === text.charCodeAt(from + j - 2) && typed.charCodeAt(i - 2) === letter) distance = Math.min(distance, before[i - 2] + 1);
      next[i] = distance;
      if (distance < least) least = distance;
    }
    if (high === m && next[m] <= slips) return true;
    if (least > slips) return false;
    [before, column, next] = [column, next, before];
  }
  return false;
}

/**
 * What a word typed is looked for as.
 * @returns { word, ends, begins, inside, slips, rows, close, slip, also, towns }.
 *   - A stop with one of the signs `begins` matches as if a word of its name
 *     began with the word typed, one with a sign of `inside` as if it had it
 *     inside, and one with a sign of `slip` as a close spelling.
 *   - `ends` is what a word of a name may end on to do the same: for
 *     "ludwigstras" that is "ludwigstr".
 *   - `close(word)` says whether the word typed may be a slip of a word of a name.
 *   - `also` is the same for what the word typed stands for, if it is an
 *     abbreviation: "hbf" is looked for as "hauptbahnhof" as well. Not so
 *     "str", which is the beginning of "strasse" and finds it as it is.
 *   - `towns` is for townMarks to keep what it finds.
 */
function formsOf(word) {
  let [begins, inside, slip] = [0, 0, 0];
  ANSWERS.forEach((long, bit) => {
    if (long.startsWith(word)) begins |= 1 << bit;
    else if (long.includes(word)) inside |= 1 << bit;
  });
  // "…str" is "…strasse". Typed up to somewhere in the "asse", it is in the
  // names that have what was typed before that at the end of a word …
  const ends = [];
  for (let end = 1; end <= 4 && end < word.length; end++) {
    if (!word.endsWith('asse'.slice(0, end))) continue;
    const before = word.slice(0, -end);
    if (before.endsWith('str')) ends.push(before);
    else if ('str'.endsWith(before)) inside |= STREET;
  }
  // … and what is all in the "asse" is in every "…strasse".
  if ('asse'.includes(word)) inside |= STREET;

  const slips = slipsAllowed(word);
  const rows = [0, 1, 2].map(() => new Int32Array(word.length + 1));
  const known = new Map();
  const close = (other) => {
    let is = known.get(other);
    if (is === undefined) known.set(other, (is = nearlyBegins(other, 0, other.length, word, slips, rows)));
    return is;
  };
  // (the first letter has to be right)
  if (slips) ANSWERS.forEach((long, bit) => { if (long[0] === word[0] && close(long)) slip |= 1 << bit; });
  const long = SPELLED_OUT.find(([short, full]) => short === word && !full.startsWith(short))?.[1];
  return { word, ends, begins, inside, slips, rows, close, slip, also: long ? formsOf(long) : null, towns: [] };
}

/**
 * Reads through a text of names (wordsTexts) and says where `part` is found.
 * @param names { text, starts } and, where its lines are not all the stops, the stop of each line
 * @param found is called with the stop, whether a word begins there, and
 *   where in the text that is; it says whether there is more to learn of that stop
 */
function eachFound({ text, starts, stops }, part, found) {
  let line = 0;
  for (let at = text.indexOf(part); at >= 0;) {
    while (starts[line + 1] <= at) line++;
    at = text.indexOf(part, found(stops ? stops[line] : line, text.charCodeAt(at - 1) === SPACE, at) ? at + 1 : starts[line + 1]);
  }
}

/**
 * The signs of all stops (see ANSWERS).
 * @param plain their names, from wordsTexts
 * @param trains for every stop whether trains call at it
 */
function signsOf(plain, trains) {
  const signs = trains.map((is) => (is ? RAIL : 0));
  SPELLED_OUT.forEach(([short], bit) => eachFound(plain, `${short} `, (stop, begins) => {
    // (a word of its own, and not the end of one)
    if (begins) signs[stop] |= 1 << bit;
    return !begins;
  }));
  eachFound(plain, 'str ', (stop) => {
    signs[stop] |= STREET;
    return false;
  });
  return signs;
}

/** How closely a stop with these signs matches a word typed, as far as the search goes. */
const bySigns = (signs, form, level) => (signs & form.begins ? BEGINNING : level >= INSIDE && signs & form.inside ? INSIDE : level >= SPELLING && signs & form.slip ? SPELLING : NOT);

/**
 * Marks all stops by how closely their names match a word typed (formsOf):
 * with BEGINNING where a word of the name begins with it, with INSIDE where
 * one has it elsewhere, if the search goes that far. A mark only ever gets better.
 * @param marks for every stop how closely it matches so far
 * @param index the stops, or the towns in their place: { count, plain, twoLetters, signs }
 */
function markForm(marks, index, form, level) {
  const { word } = form;
  /** Marks the stops that have `part`, by whether a word begins with it. */
  const mark = (names, part) => eachFound(names, part, (stop, begins) => {
    if (begins) marks[stop] = BEGINNING;
    else if (marks[stop] > INSIDE) marks[stop] = INSIDE;
    // (a name may have it inside one word and at the beginning of a later one)
    return !begins;
  });
  for (const names of [index.plain, index.twoLetters]) {
    if (word.length > 1) {
      mark(names, word);
      continue;
    }
    // A single letter is in nearly every name. The words that begin with it
    // are found by the space before them, and what has it inside only if
    // the search goes that far.
    eachFound(names, ` ${word}`, (stop) => {
      marks[stop] = BEGINNING;
      return false;
    });
    if (level < INSIDE) continue;
    eachFound(names, word, (stop) => {
      if (marks[stop] > INSIDE) marks[stop] = INSIDE;
      return false;
    });
  }
  for (const end of form.ends) mark(index.plain, `${end} `);
  const asked = form.begins | (level >= INSIDE ? form.inside : 0);
  if (!asked) return;
  const { signs } = index;
  for (let i = 0; i < index.count; i++) {
    if (!(signs[i] & asked)) continue;
    const match = bySigns(signs[i], form, level);
    if (match < marks[i]) marks[i] = match;
  }
}

/** Marks all stops by how closely they match a word typed, or what it stands for (markForm). */
function markAll(marks, index, form, level) {
  marks.fill(NOT);
  markForm(marks, index, form, level);
  if (form.also) markForm(marks, index, form.also, level);
}

/** What a word of a name answers to as well for ending in "str". */
const street = (word) => (word.endsWith('str') ? `${word}asse` : null);

/**
 * The words of a text of names that begin with a letter: where each begins
 * and which stop it is of. A slip is looked for among them, and after one
 * search for it comes the next as a rule, when the next letter is typed: the
 * words are kept.
 */
function wordsWith(names, letter) {
  names.words ??= new Map();
  if (!names.words.has(letter)) {
    const [at, of] = [[], []];
    eachFound(names, ` ${letter}`, (stop, begins, where) => {
      at.push(where + 1);
      of.push(stop);
      return true;
    });
    names.words.set(letter, { at: Int32Array.from(at), of: Int32Array.from(of) });
  }
  return names.words.get(letter);
}

/**
 * Marks the stops that have a word the word typed may be a slip of, as far
 * as they are not marked yet. The first letter has to be right.
 * @param index the stops, or the towns in their place
 */
function markSlips(marks, index, form) {
  const { word: typed, slips, rows, close } = form;
  if (!slips) return;
  // With one slip allowed, the second and the third letter of a word tell
  // most of the others apart without a closer look: one of them is where it
  // was typed, or next to that.
  const [second, third] = [typed.charCodeAt(1), typed.charCodeAt(2)];
  for (const names of [index.plain, index.twoLetters]) {
    const { text } = names;
    const { at, of } = wordsWith(names, typed[0]);
    for (let k = 0; k < at.length; k++) {
      if (marks[of[k]] !== NOT) continue;
      const from = at[k];
      if (slips === 1) {
        const [a, b] = [text.charCodeAt(from + 1), text.charCodeAt(from + 2)];
        if (a !== second && b !== third && a !== third && b !== second) continue;
      }
      const end = text.indexOf(' ', from);
      // ("…str" is "…strasse" too; as it is typed without umlauts, a word abbreviates nothing)
      const streets = names === index.plain && end - from >= 3 && text.startsWith('str', end - 3);
      if (nearlyBegins(text, from, end, typed, slips, rows) || (streets && close(`${text.slice(from, end)}asse`))) marks[of[k]] = SPELLING;
    }
  }
  if (!form.slip) return;
  for (let i = 0; i < index.count; i++) if (marks[i] === NOT && index.signs[i] & form.slip) marks[i] = SPELLING;
}

/**
 * How closely each town matches a word typed (formsOf), as far as the search
 * goes: the stops of a town match the word as closely as the town does, if
 * their own names do not match it more closely.
 * @returns for every town how closely it matches, or null if none does
 */
function townMarks(index, form, level) {
  if (form.towns[level] === undefined) {
    const marks = new Uint8Array(index.towns.count);
    markAll(marks, index.towns, form, Math.min(level, INSIDE));
    if (level === SPELLING) markSlips(marks, index.towns, form);
    form.towns[level] = marks.some((mark) => mark !== NOT) ? marks : null;
  }
  return form.towns[level];
}

/** Marks every stop as its town is marked, where that is better than its own mark. */
function markByTown(marks, index, form, level) {
  const towns = townMarks(index, form, level);
  if (!towns) return;
  const { count, townOf } = index;
  for (let i = 0; i < count; i++) if (townOf[i] >= 0 && towns[townOf[i]] < marks[i]) marks[i] = towns[townOf[i]];
}

/** How closely the name of one stop matches a word typed (formsOf), as far as the search goes: what markAll and markSlips mark it with. */
function nameMatch(index, i, form, level) {
  // (what an abbreviation stands for is looked for as it is written, without slips)
  const other = form.also ? nameMatch(index, i, form.also, Math.min(level, INSIDE)) : NOT;
  return other === BEGINNING ? BEGINNING : Math.min(other, matchOfWord(index, i, form, level));
}

/** The same for the word typed alone, without what it may stand for. */
function matchOfWord(index, i, form, level) {
  const { plain, twoLetters } = index;
  const { word } = form;
  const name = plain.text.slice(plain.starts[i], plain.starts[i + 1]);
  const line = twoLetters.lineOf[i];
  const other = line < 0 ? '' : twoLetters.text.slice(twoLetters.starts[line], twoLetters.starts[line + 1]);
  if (name.includes(` ${word}`) || other.includes(` ${word}`)) return BEGINNING;
  if (form.ends.some((end) => name.includes(` ${end} `))) return BEGINNING;
  let match = bySigns(index.signs[i], form, level);
  if (match > INSIDE && level >= INSIDE && (name.includes(word) || other.includes(word) || form.ends.some((end) => name.includes(`${end} `)))) match = INSIDE;
  if (match !== NOT || level < SPELLING || !form.slips) return match;
  const slip = (own, streets) => own[0] === word[0] && (form.close(own) || (streets && street(own) !== null && form.close(street(own))));
  return name.split(' ').some((own) => slip(own, true)) || other.split(' ').some((own) => slip(own, false)) ? SPELLING : NOT;
}

/** How closely one stop matches a word typed, by its name or by its town. */
function matchOf(index, i, form, level) {
  const town = index.townOf[i] < 0 ? NOT : townMarks(index, form, level)?.[index.townOf[i]] ?? NOT;
  return town === BEGINNING ? BEGINNING : Math.min(town, nameMatch(index, i, form, level));
}

const kilometres = (lat1, lon1, lat2, lon2) => Math.hypot(lat1 - lat2, (lon1 - lon2) * Math.cos((lat1 * Math.PI) / 180)) * 111.2;

/**
 * What the service of a stop or a line counts for: all of it, or less the
 * further it is from `near`. Near what the map shows (#154), what is in view
 * counts in full and what is outside the less the further it is, at the
 * scale of the view: as far again out as the view reaches from its middle,
 * a sixteenth. With all of the country in view, service decides.
 */
const weigh = (service, lat, lon, near) => {
  if (!near) return service;
  const km = kilometres(near.lat, near.lon, lat, lon);
  if (near.km === undefined) return service / (km + NEAR_KM) ** 2;
  const reach = Math.max(near.km, NEAR_KM);
  return service / (1 + Math.max(0, km - reach) / reach) ** 4;
};

const nameOf = (index, i) => index.names.slice(index.nameStarts[i], index.nameStarts[i + 1] - 1);

/**
 * The stops that match all the words typed, as far as the search goes, the
 * most likely first.
 * @param forms the words (formsOf), the longest first: it is in the fewest names
 * @returns up to `limit` of { i, match, weight }: the number of the stop,
 *   how closely it matches and what its service counts for
 */
function find(index, forms, level, near, limit) {
  const { count, marks, worst, first, slips } = index;
  const plain = Math.min(level, INSIDE);
  // the stops that match all the words so far, once they are few
  let left = null;
  forms.forEach((form, k) => {
    if (left) {
      left = left.filter((i) => {
        const match = matchOf(index, i, form, level);
        if (match > worst[i]) worst[i] = match;
        return match !== NOT;
      });
      return;
    }
    if (k) {
      markAll(marks, index, form, plain);
      if (level === SPELLING) markSlips(marks, index, form);
      markByTown(marks, index, form, level);
      for (let i = 0; i < count; i++) if (marks[i] > worst[i]) worst[i] = marks[i];
    } else {
      if (first.of !== `${plain} ${form.word}`) {
        markAll(first.marks, index, form, plain);
        markByTown(first.marks, index, form, plain);
        first.of = `${plain} ${form.word}`;
      }
      if (level === SPELLING && slips.of !== form.word) {
        slips.marks.set(first.marks);
        markSlips(slips.marks, index, form);
        markByTown(slips.marks, index, form, SPELLING);
        slips.of = form.word;
      }
      worst.set(level === SPELLING ? slips.marks : first.marks);
    }
    if (k + 1 === forms.length) return;
    let some = 0;
    for (let i = 0; i < count && some <= FEW; i++) if (worst[i] !== NOT) some++;
    if (some > FEW) return;
    left = [];
    for (let i = 0; i < count; i++) if (worst[i] !== NOT) left.push(i);
  });

  // The best ones so far, in their order.
  const best = [];
  const before = (a, b) => a.match - b.match || b.weight - a.weight || nameOf(index, a.i).localeCompare(nameOf(index, b.i));
  let last = null; // of them, once there are as many as are asked for
  const take = (i) => {
    const match = worst[i];
    if (match === NOT || (last && match > last.match)) return;
    const weight = weigh(index.service[i], index.lat[i], index.lon[i], near);
    if (last && match === last.match && weight < last.weight) return;
    const found = { i, match, weight };
    if (last && before(last, found) <= 0) return;
    let place = last ? limit - 1 : best.length;
    while (place > 0 && before(found, best[place - 1]) < 0) place--;
    best.splice(place, 0, found);
    if (best.length > limit) best.pop();
    if (best.length === limit) last = best[limit - 1];
  };
  if (left) left.forEach(take);
  else for (let i = 0; i < count; i++) take(i);
  return best;
}

/**
 * The stops that match what was typed, the most likely first: the closer
 * matches before the others, and among equally close ones those with more
 * service. Service counts for less the further a stop is from `near`.
 * @param index from buildIndex
 * @param near { lat, lon } of the visitor, if they have it shown; else of
 *   the middle of what the map shows, with `km`, how far it reaches from there
 * @returns up to `limit` of { name, lat, lon, modes, town }; `town` only
 *   where one is known and the name does not say it
 */
export function search(index, query, { near = null, limit = 8 } = {}) {
  const forms = wordsOf(query).sort((a, b) => b.length - a.length).map(formsOf);
  if (!forms.length || limit < 1) return [];
  // Single letters first by what begins with them alone: that fills the
  // list as a rule, and then nothing found another way would be on it.
  let best = forms[0].word.length === 1 ? find(index, forms, BEGINNING, near, limit) : [];
  if (best.length < limit) best = find(index, forms, INSIDE, near, limit);
  // Close spellings only where nothing is found without them: they bring in
  // what was not meant as well ("feuer" is nearly the beginning of "Fürth").
  if (!best.length) best = find(index, forms, SPELLING, near, limit);
  return best.map(({ i }) => {
    const town = townToShow(nameOf(index, i), index.towns.names[index.townOf[i]]);
    return { name: nameOf(index, i), lat: index.lat[i], lon: index.lon[i], modes: index.modes.filter((_, bit) => index.kinds[i] & (1 << bit)), ...(town ? { town } : {}) };
  });
}

/**
 * The towns whose name has a word that begins with each word typed (#24):
 * "fürth" is the town of Fürth, "neuenk" every Neuenkirchen. Not by a word
 * inside a name, nor by a close spelling, which would bring in many a town
 * that was not meant, and not before three letters are typed. A town of
 * exactly that name comes first, then the one with more service, which
 * counts for less the further from `near` the town is.
 * @param index from buildIndex
 * @param near as for search()
 * @returns up to `limit` of { name, district, box }: `district` only where
 *   another town has the name too, `box` the rectangle around its stations,
 *   [south, west, north, east]
 */
export function searchTowns(index, query, { near = null, limit = 3 } = {}) {
  const words = wordsOf(query);
  const { towns } = index;
  if (!towns.count || limit < 1 || words.join('').length < 3) return [];
  // (each word marks the towns that have a word that begins with it; a town is found by all of them)
  const marks = words.map((word) => townMarks(index, formsOf(word), BEGINNING));
  if (marks.some((mark) => !mark)) return [];
  const typed = [...words].sort().join(' ');
  const found = [];
  for (let t = 0; t < towns.count; t++) {
    if (marks.some((mark) => mark[t] !== BEGINNING)) continue;
    const name = towns.names[t];
    const exact = split(fold(name)).sort().join(' ') === typed;
    const [south, west, north, east] = towns.box.subarray(4 * t, 4 * t + 4);
    found.push({ t, exact, weight: weigh(towns.service[t], (south + north) / 2, (west + east) / 2, near) });
  }
  return found
    .sort((a, b) => b.exact - a.exact || b.weight - a.weight || towns.names[a.t].localeCompare(towns.names[b.t]))
    .slice(0, limit)
    .map(({ t }) => ({ name: towns.names[t], ...(towns.districts[t] ? { district: towns.districts[t] } : {}), box: Array.from(towns.box.subarray(4 * t, 4 * t + 4)) }));
}

/**
 * The lines whose name begins with what was typed, spaces left out: "u1" and
 * "s 1" are the U1 and the S1, "33" is line 33 and after it 330 and 331. The
 * name of a mode in front narrows it down, and then the letter of the line
 * may be left out: "bus 33", "U-Bahn 1". A line of exactly that name comes
 * first, one of that number after it, then the one with more trips, which
 * count for less the further from `near` the line runs.
 * @param index from buildIndex
 * @param near as for search()
 * @returns up to `limit` of { name, mode, agency, to }
 */
export function searchLines(index, query, { near = null, limit = 3 } = {}) {
  const typed = split(fold(query));
  if (!typed.length) return [];
  // what a name may begin with: all that was typed, or what follows the name of a mode
  const wanted = [{ mode: null, begin: typed.join('') }];
  for (let k = 1; k < typed.length; k++) {
    const mode = index.modeOf.get(typed.slice(0, k).join(''));
    if (mode) wanted.push({ mode, begin: typed.slice(k).join('') });
  }

  const { lines } = index;
  const found = [];
  for (let i = 0; i < lines.name.length; i++) {
    const name = lines.compact[i];
    const number = name.replace(/^\p{L}+/u, '');
    // -1: not found; 0: begins with it; 1: its number is that; 2: its name is
    let exact = -1;
    for (const { mode, begin } of wanted) {
      if (mode && mode !== lines.mode[i]) continue;
      if (name.startsWith(begin)) exact = Math.max(exact, name === begin ? 2 : 0);
      else if (mode && number.startsWith(begin)) exact = Math.max(exact, number === begin ? 1 : 0);
    }
    if (exact >= 0) found.push({ i, exact, weight: weigh(lines.service[i], lines.lat[i], lines.lon[i], near) });
  }
  return found
    .sort((a, b) => b.exact - a.exact || b.weight - a.weight || lines.name[a.i].localeCompare(lines.name[b.i], undefined, { numeric: true }))
    .slice(0, limit)
    // (with where it runs: lines of a name may be in places apart, #152)
    .map(({ i }) => ({ name: lines.name[i], mode: lines.mode[i], agency: lines.agency[i], to: lines.to[i], at: [lines.lat[i], lines.lon[i]] }));
}
