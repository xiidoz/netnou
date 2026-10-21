// The lines and directions of a stop that a visitor chooses to see (#164),
// for the page and the server. The feed says nothing of a direction, and the
// destinations of a line vary from trip to trip (the U1 has eleven at
// Nürnberg Plärrer). Where a line goes next from the stop splits it the way a
// rider means: a direction is the line with its next station, and the trips
// that end earlier on the same way are in it. Without the page around it, so
// that it can be tested as it is (test/choice.test.js).
//
// A choice is a list of keys, each a direction or a whole line, by names as
// the addresses have them (address.js), so that it outlasts a new timetable:
//   subway/u1~nuernberg-weisser-turm   the U1 towards Nürnberg Weißer Turm
//   tram/4                             tram 4 both ways
// In the address of a stop and of its board, and to api/departures, they go
// as lines=<key>,<key>…; an empty choice is every line.

import { slug } from './address.js';

/** The kinds of transport, as the API names them (MODES in server/lib/timetable.js). */
const KINDS = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'ferry', 'cable', 'other'];
// (more than any stop has directions: what is beyond is left out)
const MOST = 64;
const KEY = /^([a-z]+)\/([a-z0-9-]+)(?:~([a-z0-9-]+))?$/;

/** The key of a direction ({ mode, line, next }), or of a whole line where it has no next station. */
export const choiceKey = ({ mode, line, next = null }) => `${mode}/${slug(line)}${next ? `~${slug(next)}` : ''}`;

/**
 * The choice a `lines` value names, which may be anything someone typed: the
 * keys of the shape above, each once, in small letters. None for null.
 */
export function readChoice(value) {
  if (typeof value !== 'string') return [];
  const keys = [];
  for (const part of value.toLowerCase().split(',')) {
    const key = part.trim();
    const parts = KEY.exec(key);
    if (!parts || !KINDS.includes(parts[1]) || keys.includes(key)) continue;
    keys.push(key);
    if (keys.length === MOST) break;
  }
  return keys;
}

/** The value of `lines` for a choice: written as it is, as the address of a stop is. */
export const choiceValue = (keys) => keys.join(',');

/** Whether a departure of a line ({ mode, line, next }) is to be shown: by every one for none chosen, else by its direction or its whole line. */
export function inChoice(keys, departure) {
  if (!keys.length) return true;
  const line = choiceKey({ ...departure, next: null });
  return keys.includes(line) || keys.includes(choiceKey(departure));
}

/**
 * The choice after a tap on a direction: while every line is shown, only
 * that one; else it in or out. With none left, every line is shown again.
 */
export function toggled(keys, key) {
  if (!keys.length) return [key];
  return keys.includes(key) ? keys.filter((other) => other !== key) : [...keys, key];
}

/**
 * The bearing from one place to another, in degrees clockwise from north:
 * where a direction leaves its stop, for the arrowhead of its sign.
 */
export function bearing(lat1, lon1, lat2, lon2) {
  const east = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.round(((Math.atan2(east, lat2 - lat1) * 180) / Math.PI + 360) % 360);
}
