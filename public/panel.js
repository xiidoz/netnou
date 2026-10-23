// What the details of a stop and of a line list, as a tree of elements (#254).
// The page makes the tree into its own elements (app.js); the server writes
// it into the page it sends for the address of the stop or the line, as it is
// at that moment (server/lib/page.js). One drawing for both: what a search
// engine reads in the page as it is sent is what a rider sees once the
// script runs, and a change to the one is a change to the other.
//
// The server's page has no script of its own, so nothing here listens: a row
// says in its data what it opens (data-trip), the chip of the lines of a stop
// is known by its class, and the page listens to the details for them.
// Without the page around it, so that it runs on the server and in the tests
// as it is (test/panel.test.js).

import { mdiAlert, mdiClose, mdiFilterVariant } from './vendor/material-design-icons/icons.js';

// The kinds of transport, as the API names them; any other is drawn as "other".
const KINDS = ['subway', 'tram', 'bus', 'suburban', 'regional', 'longdistance', 'ferry', 'cable', 'other'];
const kindOf = (mode) => (KINDS.includes(mode) ? mode : 'other');

// From how many seconds late (or early, below zero) a delay has which colour.
export const DELAY_EARLY_S = -60; // ahead of the timetable
export const DELAY_MINOR_S = 120;
export const DELAY_MAJOR_S = 300;
export const DELAY_SEVERE_S = 600;

// Up to this many minutes ahead a departure says in how many it leaves; beyond, its time of day says more (#165).
export const MINUTES_MAX = 60;

// A note is long beyond this many characters (isLong in app.js), and a warning in a list says this much of it (saidOf).
export const NOTE_CHARS = 120;

/**
 * An element: its tag, its attributes, and what is in it. Of what is in it,
 * a text is a text, and an empty one, null, undefined and false are nothing
 * (an empty text in the page would still be a node, and move the line it is
 * on); in the page, an element of its own may stand there as well. An
 * attribute that is null, undefined or false is left out.
 */
export const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== '') });

/** The shape of an icon (vendor/material-design-icons) in a box of 24 by 24, as iconSvg in server/lib/page.js and icon in app.js draw it. */
export const iconOf = (shape, attrs = {}) => h('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', ...attrs }, h('path', { d: shape }));

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The tree as HTML, for the page the server sends. */
export function toHtml(node) {
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
  const attrs = Object.entries(node.attrs)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([key, value]) => (value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`))
    .join('');
  return `<${node.tag}${attrs}>${node.children.map(toHtml).join('')}</${node.tag}>`;
}

// ---------- delays ----------

/** The colour class of a delay, in seconds: early, ok, minor, major, severe, or none where none is known. */
export function delayClass(delay) {
  if (delay === null || delay === undefined) return 'none';
  // (as delayText shows it)
  const shown = Math.round(delay / 60) * 60;
  if (shown <= DELAY_EARLY_S) return 'early';
  if (shown < DELAY_MINOR_S) return 'ok';
  if (shown < DELAY_MAJOR_S) return 'minor';
  if (shown < DELAY_SEVERE_S) return 'major';
  return 'severe';
}

/** A delay in seconds as whole minutes: "+3", "±0", "−1"; nothing where none is known. */
export function delayText(delay) {
  if (delay === null || delay === undefined) return '';
  const minutes = Math.round(delay / 60);
  if (minutes === 0) return '±0';
  return minutes > 0 ? `+${minutes}` : `−${-minutes}`;
}

/** The name of a line on the colour of its kind (style.css gives the colour by data-mode). */
export const badge = (line, mode, ...more) => h('span', { class: 'badge', 'data-mode': kindOf(mode) }, line, ...more);

export const delayNode = (delay) => h('span', { class: 'delay', 'data-delay': delayClass(delay) }, delayText(delay));

/** Whether a note of the feed warns: of what is wrong with a trip or a stop right now, such as the reason for a delay. */
export const warns = (note) => note.severity === 'warning' || note.severity === 'severe';

/** What the warnings of a train say, for its sign in a list: a line each, and of a long one how it begins. */
export function saidOf(warnings) {
  return warnings
    .map((note) => {
      const line = note.text.replace(/\s+/g, ' ');
      return line.length > NOTE_CHARS ? `${line.slice(0, NOTE_CHARS).trimEnd()} …` : line;
    })
    .join('\n');
}

/**
 * The sign of a warning. In the notes it stands where a note that does not
 * warn has its bullet, before what the warning says. In a list of trains it
 * stands for the warning: `said` is then what the warning says, which a
 * screen reader reads out and a pointer on the sign is shown (showSaid in app.js).
 */
export function warningSign(said, { t }) {
  return iconOf(mdiAlert, { class: 'icon sign', 'aria-hidden': null, role: 'img', 'aria-label': said ? t('notes.warningOf', { text: said }) : t('notes.warning'), 'data-said': said || null });
}

/**
 * The delay of a train in a list and, if something is wrong with the train
 * right now, the sign of a warning: after the delay, which the warning mostly
 * explains, and before the train. In a list with such a train every row
 * keeps the place of the sign, so that what follows begins at the same place
 * in all of them.
 * @param delay the delay as an element (delayNode), or an empty one of its kind
 * @param signed whether a train of the list has something wrong with it
 */
export function delayCell(delay, warnings, signed, context) {
  if (!signed) return delay;
  return h('span', { class: 'late' }, delay, warnings.length ? warningSign(saidOf(warnings), context) : null);
}

// ---------- departures ----------

/** When a departure leaves, in epoch seconds: as planned, moved by the delay as it is shown. */
export const leavesAt = (dep) => dep.planned + Math.round((dep.delay ?? 0) / 60) * 60;

/**
 * How long until a departure leaves: "4 min", "now" under a minute. Further
 * off than an hour its time of day says more (#165): that, or nothing where
 * the row has it already.
 * @param far 'time' or 'none': what stands there beyond the hour
 * @param context { t, time, now }: the texts, the time of day of a moment, and now (epoch seconds)
 */
export function untilText(leaves, planned, far, { t, time, now }) {
  const minutes = Math.floor(leaves / 60) - Math.floor(now / 60);
  if (minutes > MINUTES_MAX) return far === 'time' ? time(planned) : '';
  return minutes < 1 ? t('departures.now') : t('departures.minutes', { count: minutes });
}

/** The minutes until a departure leaves, which the page counts down by themselves between two answers of the server (tickTimes in app.js). */
export function minutesNode(dep, far, context) {
  const leaves = leavesAt(dep);
  return h('span', { class: 'minutes', 'data-leaves': leaves, 'data-planned': dep.planned, 'data-far': far }, untilText(leaves, dep.planned, far, context));
}

/**
 * Where in a list of departures the next day begins, which a line says
 * ("tomorrow"): the first planned for a later date, or -1. The list is in the
 * order they leave, and one of the day before that leaves late, after
 * midnight, is among those of today (#193).
 * @param context { day, now }: the date of a moment as YYYY-MM-DD where the area is, and now
 */
export function tomorrowAt(departures, { day, now }) {
  const today = day(now);
  // (dates as YYYY-MM-DD, which compare as the days do)
  return departures.findIndex((dep) => day(dep.planned) > today);
}

/**
 * The departures of a stop, as the details list them: a row for each, which
 * opens its trip; where the next day begins, a line between two lists.
 * @param board as api/departures answers
 * @param context { t, time, day, now, times }: times is the visitor's way of
 *   showing them (time of day, minutes or both)
 */
export function departureLists(board, context) {
  const { t, time, times } = context;
  const signed = board.departures.some((dep) => dep.warnings.length > 0);
  // (the time of day first, or the minutes in its place; with both, the minutes at the end of the row)
  const rows = board.departures.map((dep) =>
    h('li', {}, h('button', { type: 'button', class: `row departure times-${times}${dep.cancelled ? ' cancelled' : ''}`, 'data-trip': dep.trip },
      times === 'minutes' ? minutesNode(dep, 'time', context) : h('span', { class: 'time' }, time(dep.planned)),
      delayCell(dep.cancelled ? h('span', { class: 'delay' }) : delayNode(dep.delay), dep.warnings, signed, context),
      badge(dep.line, dep.mode),
      h('span', { class: 'name', title: dep.to }, dep.to),
      h('span', { class: 'platform' }, dep.cancelled ? t('departures.cancelled') : dep.platform ? t('stop.platform', { platform: dep.platform }) : ''),
      times === 'both' ? minutesNode(dep, 'none', context) : null,
    )),
  );
  // (the 24 hours the text speaks of are the furthest departures() in server/lib/timetable.js looks)
  if (!rows.length) return [h('p', { class: 'panel-empty' }, t('departures.none'))];
  const list = (part) => h('ul', { class: `rows${signed ? ' signed' : ''}` }, part);
  const split = tomorrowAt(board.departures, context);
  if (split < 0) return [list(rows)];
  return [split > 0 ? list(rows.slice(0, split)) : null, h('h3', { class: 'rows-head day-head' }, t('departures.tomorrow')), list(rows.slice(split))].filter(Boolean);
}

/**
 * The sign of a direction: a disc in the colour of its kind with the name of
 * its line, and the arrowhead pointing where it leaves the stop, as drawDisc
 * and drawArrow in app.js draw a vehicle, with their white edges. None for a
 * whole line.
 */
export function directionSign({ line, mode, heading = null }) {
  // (a long name narrower, as on the map)
  const narrow = line.length > 3 ? { textLength: 17, lengthAdjust: 'spacingAndGlyphs' } : {};
  return h('svg', { class: 'direction-sign', viewBox: '-17 -17 34 34', 'aria-hidden': 'true', 'data-mode': kindOf(mode) },
    // (the arrowhead as drawArrow has it: from the edge of the disc at ±0.6 rad to 6 beyond)
    heading !== null ? h('path', { d: 'M0,-16L5.65,-8.25L-5.65,-8.25Z', transform: `rotate(${heading})` }) : null,
    h('circle', { r: 10 }),
    h('text', { y: 3.2, 'text-anchor': 'middle', ...narrow }, line),
  );
}

/**
 * The chip beside "Departures" that says which lines of a stop are shown and
 * opens the sheet to choose them (#164): every line, or "only" and the signs
 * of the directions chosen, with the name of the one where it is one, and a
 * cross that shows all again.
 * @param chosen the directions chosen, each with its `name` (directionName in app.js)
 */
export function choiceChip(chosen, { t }) {
  const parts = !chosen.length
    ? [h('span', {}, t('choice.all'))]
    : [h('span', {}, t('choice.only')), chosen.slice(0, 4).map(directionSign), chosen.length === 1 ? h('span', {}, chosen[0].name) : chosen.length > 4 ? h('span', {}, t('choice.more', { count: chosen.length - 4 })) : null];
  const label = chosen.length ? `${t('choice.only')} ${chosen.map((direction) => `${direction.line} ${direction.name}`).join(', ')}` : t('choice.all');
  return h('span', { class: `choice${chosen.length ? ' chosen' : ''}` },
    h('button', { type: 'button', class: 'choice-open', 'aria-label': label, 'aria-haspopup': 'dialog', title: t('choice.title') }, iconOf(mdiFilterVariant), parts),
    chosen.length ? h('button', { type: 'button', class: 'choice-clear', 'aria-label': t('choice.clear'), title: t('choice.clear') }, iconOf(mdiClose)) : null,
  );
}

/**
 * The line below the name of a stop: "Departures", and the chip with what is
 * shown, where there is one to choose (null: none, as on a screen on a wall
 * set up for a platform).
 */
export function departuresSub(chip, { t }) {
  if (!chip) return h('p', { class: 'sub' }, t('departures.title'));
  return h('p', { class: 'sub with-choice' }, h('span', {}, t('departures.title')), chip);
}

/**
 * The head of the details: the name of what they are of, as the main heading
 * of the page while they are open (#254), and what follows it.
 */
export const panelHead = (heading, ...more) => h('div', { class: 'panel-head' }, h('h1', {}, heading), more);

// ---------- a line ----------

/** The head of the details of a line: its name and kind, who runs it and how many of its vehicles are under way. */
export function lineHead(line, { t }) {
  const sub = [line.agency, line.vehicles.length ? t('line.vehicles', { count: line.vehicles.length }) : ''].filter(Boolean).join(' · ');
  return panelHead([badge(line.name, line.mode), h('span', {}, t(`mode.${kindOf(line.mode)}`))], h('p', { class: 'sub' }, sub));
}

/**
 * The vehicles of a line under way, under where they go, in the order of the
 * server: the one with the fewest stops left first. A row opens its trip.
 * @param line as api/line answers
 */
export function vehicleLists(line, context) {
  const { t } = context;
  if (!line.vehicles.length) return [h('p', { class: 'panel-empty' }, t('line.none'))];
  const byDestination = new Map();
  for (const v of line.vehicles) byDestination.set(v.to, [...(byDestination.get(v.to) ?? []), v]);
  const signed = line.vehicles.some((v) => v.warnings.length > 0);
  return [...byDestination].flatMap(([destination, vehicles]) => [
    h('h3', { class: 'rows-head' }, t('line.to', { destination })),
    h('ul', { class: `rows${signed ? ' signed' : ''}` }, vehicles.map((v) =>
      h('li', {}, h('button', { type: 'button', class: 'row vehicle', 'data-trip': v.id },
        h('span', { class: 'name', title: v.next }, t('line.next', { stop: v.next })),
        delayCell(delayNode(v.delay), v.warnings, signed, context),
      )),
    )),
  ]);
}
