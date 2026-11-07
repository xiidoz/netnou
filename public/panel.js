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

import { townToShow, townsAlong } from './stops.js';
import { mdiAlert, mdiChevronRight, mdiChevronUp, mdiClose, mdiFilterVariant } from './vendor/material-design-icons/icons.js';

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

/**
 * A line as a rider says it: a name that is a number with the kind of the
 * line before it, "Tram 10", "Bus 36"; "U1" or "RE 31" as they are, as the
 * server names it (labelled in server/lib/addresses.js). Where its stop has
 * the name in two kinds (`both`), with the kind whatever the name is: a bus
 * named U1 that stands in for the U-Bahn is "Bus U1".
 */
export const lineSaid = (name, mode, { t }, both = false) => (both || /^\d/.test(name) ? `${t(`address.kind.${kindOf(mode)}`)} ${name}` : name);

/**
 * The badge of a line in a list of departures: where its stop has the name
 * in two kinds (`both`), such as tram 4 and a bus 4 that stands in for it,
 * with the short name of its kind before the name, "Tram 4" and "Bus 4", as
 * colour alone would not tell them apart; not where the name begins with it
 * already ("U1"). A screen reader hears the line as a rider says it (lineSaid).
 */
export function lineBadge(name, mode, context, both = false) {
  const short = both ? context.t(`badge.kind.${kindOf(mode)}`) : '';
  const shown = short && !name.startsWith(short) ? `${short} ${name}` : name;
  const said = lineSaid(name, mode, context, both);
  return said === shown ? badge(shown, mode) : badge([], mode, h('span', { 'aria-hidden': 'true' }, shown), h('span', { class: 'spoken' }, said));
}

/**
 * The names whose badges say their kind (lineBadge) in departures from one
 * stop or several: those each stop has that day in more than one kind (its
 * `today.twoKinds` from api/departures), and those the departures show in
 * more than one, as where one stop of several has the tram and another the
 * bus, or after midnight.
 * @param todays the `today` of each stop, or null
 */
export function twoKinds(todays, departures) {
  const names = new Set(todays.flatMap((today) => today?.twoKinds ?? []));
  const kinds = new Map();
  for (const { line, mode } of departures) {
    if (!kinds.has(line)) kinds.set(line, new Set());
    kinds.get(line).add(kindOf(mode));
  }
  for (const [name, modes] of kinds) if (modes.size > 1) names.add(name);
  return names;
}

export const delayNode = (delay) => h('span', { class: 'delay', 'data-delay': delayClass(delay) }, delayText(delay));

/**
 * A clock time without what a language writes before or after its digits:
 * "1:34 PM" is "1:34", "13:34" stays. Beside the time a train leaves, the
 * planned time needs no "PM": a delay is minutes, and the time before it
 * says which half of the day it is.
 */
export const clockOf = (text) => text.replace(/^\D+|\D+$/g, '');

/**
 * The delay where a list shows the time a train leaves or arrives: as a sum
 * with the planned time, "13:36+1" after "13:37" ("1:36+1" after "1:37 PM"),
 * the planned time grey and as wide as any clock time, so that the signs line
 * up down the list (style.css). On time the planned time is left out and
 * "±0" stands in its place; without a delay known, nothing. A screen reader
 * hears the planned time in full, "planned 1:36 PM", before the delay.
 * @param context { t, time }: the texts and the time of day of a moment
 */
export function delaySum(planned, delay, { t, time }) {
  const text = delayText(delay);
  if (!text) return delayNode(delay);
  const shown = leavesAt({ planned, delay }) !== planned;
  return h('span', { class: 'delay', 'data-delay': delayClass(delay) },
    h('span', { class: 'planned' }, shown ? [h('span', { 'aria-hidden': 'true' }, clockOf(time(planned))), h('span', { class: 'spoken' }, `${t('departures.planned', { time: time(planned) })} `)] : null),
    text);
}

/**
 * Where no delay of a departure is reported while delays come in for others:
 * the map's question mark (delayFlag) in the place of the delay, so that it
 * is not taken for one on time; a screen reader hears what it means.
 * @param withPlanned whether the place of the planned time comes before it, as in a sum (delaySum): it then lines up with the other delays
 */
export const unknownDelay = ({ t }, withPlanned = true) => h('span', { class: 'delay', 'data-delay': 'none' },
  withPlanned ? h('span', { class: 'planned' }) : null, h('span', { 'aria-hidden': 'true' }, '?'), h('span', { class: 'spoken' }, t('departures.noDelay')));

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
 * off than an hour the time it leaves says more (#165): that, or nothing
 * where the row has it already.
 * @param far 'time' or 'none': what stands there beyond the hour
 * @param context { t, time, now }: the texts, the time of day of a moment, and now (epoch seconds)
 */
export function untilText(leaves, far, { t, time, now }) {
  const minutes = Math.floor(leaves / 60) - Math.floor(now / 60);
  if (minutes > MINUTES_MAX) return far === 'time' ? time(leaves) : '';
  return minutes < 1 ? t('departures.now') : t('departures.minutes', { count: minutes });
}

/** The minutes until a departure leaves, which the page counts down by themselves between two answers of the server (tickTimes in app.js). */
export function minutesNode(dep, far, context) {
  const leaves = leavesAt(dep);
  return h('span', { class: 'minutes', 'data-leaves': leaves, 'data-far': far }, untilText(leaves, far, context));
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
  const { t } = context;
  const signed = board.departures.some((dep) => dep.warnings.length > 0);
  // (the badges of a name the stop has in two kinds say their kind)
  const withKinds = { ...context, twoKinds: twoKinds([board.today], board.departures) };
  const rows = board.departures.map((dep) => h('li', {}, departureRow(dep, signed, withKinds)));
  // (the 24 hours the text speaks of are the furthest departures() in server/lib/timetable.js looks)
  if (!rows.length) return [h('p', { class: 'panel-empty' }, t('departures.none'))];
  const list = (part) => h('ul', { class: `rows departures${signed ? ' signed' : ''}` }, part);
  const split = tomorrowAt(board.departures, context);
  if (split < 0) return [list(rows)];
  return [split > 0 ? list(rows.slice(0, split)) : null, h('h2', { class: 'rows-head day-head' }, t('departures.tomorrow')), list(rows.slice(split))].filter(Boolean);
}

/**
 * The row of a departure, which opens its trip, in two lines and in the
 * order of a board: the line's badge, where it goes, and on the right when it
 * leaves, the minutes until then or, where the visitor chose times of day,
 * the time; below where it goes, in small print, the time it leaves where the
 * minutes stand on the right, the delay as a sum with the planned time
 * (delaySum; beside minutes alone), and the platform. Without a delay
 * reported while delays come in for others (`live`), the map's question
 * mark (unknownDelay). The badge says the kind where the stop has the line's
 * name in two kinds (context.twoKinds, lineBadge).
 * @param signed whether a train of its list has something wrong with it (delayCell)
 * @param byLine whether it is the next departure of a way in the list of a
 *   stop's lines (lineLists): without the badge, which its line has, and
 *   one of another day says so where the minutes stand
 */
function departureRow(dep, signed, context, byLine = false) {
  const { t, time, day, now, times, live } = context;
  const later = byLine && day(dep.planned) > day(now);
  const unknown = live && !dep.cancelled && (dep.delay === null || dep.delay === undefined);
  const leaves = () => h('span', { class: 'time' }, time(leavesAt(dep)));
  // (on the right: one of another day says so; with both, beyond the hour nothing, as the time is below)
  const when = later ? h('span', { class: 'day' }, t('departures.tomorrow'))
    : times === 'time' ? leaves()
      : minutesNode(dep, times === 'minutes' ? 'time' : 'none', context);
  return h('button', { type: 'button', class: `row departure times-${times}${byLine ? ' by-line' : ''}${dep.cancelled ? ' cancelled' : ''}`, 'data-trip': dep.trip },
    byLine ? null : lineBadge(dep.line, dep.mode, context, context.twoKinds?.has(dep.line)),
    h('span', { class: 'name', title: dep.to }, dep.to),
    h('span', { class: 'details' },
      times === 'both' || later ? leaves() : null,
      delayCell(dep.cancelled ? h('span', { class: 'delay' }) : unknown ? unknownDelay(context, times !== 'minutes') : times === 'minutes' ? delayNode(dep.delay) : delaySum(dep.planned, dep.delay, context), dep.warnings, signed, context),
      h('span', { class: 'platform' }, dep.cancelled ? t('departures.cancelled') : dep.platform ? t('stop.platform', { platform: dep.platform }) : '')),
    when,
  );
}

// ---------- the lines of a stop ----------

/**
 * The badge of a line that leads to it, with the sign in it that says so, as
 * at the top of a trip (#147): a link to its page, which the page opens in
 * its details instead, by what data-line says of it.
 * @param line { name, mode, agency, at, path } as api/departures?list=lines has it
 */
export function lineLink(line, context) {
  const label = context.t('line.open', { line: lineSaid(line.name, line.mode, context) });
  const { name, mode, agency, at } = line;
  return h('a', { class: 'to-line', href: line.path, 'aria-label': label, title: label, 'data-line': JSON.stringify({ name, mode, agency, at }) },
    badge(line.name, line.mode, iconOf(mdiChevronRight)));
}

/**
 * Every line of a stop with each way it goes from there and its next
 * departure (#255), under the kinds where there are several: the badge of
 * the line, which leads to it, beside its ways. A way with no departure in
 * the next 24 hours says so where the minutes stand and opens nothing. Below
 * each way, how often it leaves there that way now and when last today
 * (#289); after the lines, the towns they go to.
 * @param board as api/departures?list=lines answers, with `lines`
 */
export function lineLists(board, context) {
  const { t, times } = context;
  const lines = board.lines ?? [];
  if (!lines.length) return [h('p', { class: 'panel-empty' }, t('departures.none'))];
  const signed = lines.some((line) => line.ways.some((way) => way.departure?.warnings.length > 0));
  const kinds = [...new Set(lines.map((line) => kindOf(line.mode)))];
  // (each way with how often it leaves here that way now, and when last today, #289)
  const way = (line, { to, departure, facts }) => h('li', {}, departure
    ? departureRow({ ...departure, line: line.name, mode: line.mode }, signed, context, true)
    : h('div', { class: `row departure times-${times} by-line resting` },
      h('span', { class: 'name', title: to }, to),
      h('abbr', { class: 'later', title: t('lines.laterLong') }, t('lines.later'))),
  facts ? h('p', { class: 'line-facts' }, todayText(facts, context)) : null);
  const towns = board.towns?.towns ?? [];
  return [...kinds.flatMap((kind) => [
    kinds.length > 1 ? h('h2', { class: 'rows-head' }, t(`mode.${kind}`)) : null,
    h('ul', { class: `line-rows${signed ? ' signed' : ''}` }, lines.filter((line) => kindOf(line.mode) === kind).map((line) =>
      h('li', {}, lineLink(line, context), h('ul', {}, line.ways.map((one) => way(line, one)))))),
  ]),
  // (the towns its lines go to, the nearest first)
  towns.length ? h('p', { class: 'lines-towns' }, towns.length === 1 && !board.towns.more ? t('facts.townsOne', { town: towns[0] })
    : board.towns.more ? t('facts.townsMore', { towns: towns.join(', '), count: board.towns.more }) : t('facts.towns', { towns: context.list(towns) })) : null,
  ].filter(Boolean);
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
 * The chip beside the switch of a stop that says which lines its next
 * departures are of and opens the sheet to choose them (#164): "Filter"
 * while it shows every line (#255: "All lines" is the list beside it), or
 * "only" and the one direction chosen, its sign and its name, or how many
 * where they are several: which way each of them goes would be no more than
 * the arrowhead of its sign there, and the departures below name it. With a
 * cross that shows all again.
 * @param chosen the directions chosen, each with its `name` (directionName in app.js)
 */
export function choiceChip(chosen, context) {
  const { t } = context;
  const parts = !chosen.length
    ? [h('span', {}, t('choice.filter'))]
    : chosen.length === 1 ? [h('span', {}, t('choice.only')), directionSign(chosen[0]), h('span', {}, chosen[0].name)]
      : [h('span', {}, t('choice.several', { count: chosen.length }))];
  // (a line named by a number said with its kind, as a tram 4 and a bus 4 may go to the same place)
  const label = chosen.length ? `${t('choice.only')} ${chosen.map((direction) => `${lineSaid(direction.line, direction.mode, context)} ${direction.name}`).join(', ')}` : t('choice.filter');
  return h('span', { class: `choice${chosen.length ? ' chosen' : ''}` },
    h('button', { type: 'button', class: 'choice-open', 'aria-label': label, 'aria-haspopup': 'dialog', title: t('choice.title') }, iconOf(mdiFilterVariant), parts),
    chosen.length ? h('button', { type: 'button', class: 'choice-clear', 'aria-label': t('choice.clear'), title: t('choice.clear') }, iconOf(mdiClose)) : null,
  );
}

/** The views of a stop (#255): its next departures, and every line with when it next leaves each way. */
export const VIEWS = ['departures', 'lines'];

/**
 * The line below the name of a stop: the switch between its next departures
 * and all its lines, with the departures the chip of the lines they are of.
 * What makes the details the board is not here but in their corner (app.js,
 * "the board"): it changes what the details are, not what they show. A
 * board has no switch (view null), as it shows the departures alone:
 * "Departures" and the chip; on a screen on a wall set up for one purpose,
 * as at a platform, not even the chip (null), as nobody is to choose there.
 * @param view what is shown, of VIEWS, or null
 * @param chip the chip (choiceChip), or null
 */
export function departuresSub(view, chip, context) {
  const { t } = context;
  if (!view && !chip) return h('p', { class: 'sub' }, t('departures.title'));
  const names = { departures: t('view.departures'), lines: t('view.lines') };
  const label = view
    ? h('span', { class: 'view-switch', role: 'group', 'aria-label': t('view.label') },
      VIEWS.map((one) => h('button', { type: 'button', 'aria-pressed': String(one === view), 'data-view': one }, names[one])))
    : h('span', {}, t('departures.title'));
  return h('p', { class: 'sub with-choice' }, label, view === 'lines' ? null : chip);
}

/**
 * The name of a stop as the heading of its details, with its town below it
 * where the name does not say it (#254), as the search and the stops of a
 * trip show it (townToShow in stops.js).
 * @param town the town it is in, null where none is known
 */
export function stopHeading(name, town) {
  const shown = townToShow(name, town);
  return shown ? [h('span', { class: 'stop' }, name), h('span', { class: 'town' }, shown)] : name;
}

/**
 * The head of the details: the name of what they are of, as the main heading
 * of the page while they are open (#254), and what follows it.
 */
export const panelHead = (heading, ...more) => h('div', { class: 'panel-head' }, h('h1', {}, heading), more);

// ---------- what the timetable says beyond the minute (#289) ----------

/**
 * How often, in words (server/lib/facts.js): "alle 10 Min.", "spätestens
 * alle 4 Min.", "stündlich", "zweimal pro Stunde".
 * @param often { every } | { atMost } | { perHour: [few, many] } | { none }
 */
export function oftenText(often, { t }) {
  if (often.every !== undefined) {
    if (often.every % 60 !== 0) return t('facts.every', { count: often.every });
    return often.every === 60 ? t('facts.hourly') : t('facts.everyHours', { count: often.every / 60 });
  }
  if (often.atMost !== undefined) return t('facts.atMost', { count: often.atMost });
  if (often.none) return t('facts.none');
  const [few, many] = often.perHour;
  if (few === 0) return t('facts.perHourAtMost', { count: many });
  return few === many ? t('facts.perHour', { count: few }) : t('facts.perHourRange', { few, many });
}

/**
 * A whole hour as a clock says it, "19 Uhr", "7 PM"; where the language says
 * the hour by its number alone (en-GB: "19"), as the time "19:00". Midnight
 * at the end of a stretch of hours is its 24th hour where the clock counts
 * so: "20–24 Uhr".
 * @param end whether it ends a stretch
 * @param context { hour, time }: the hour and the time of day of a moment
 */
function hourParts(epoch, { hour, time }, end = false) {
  const said = hour(epoch);
  const [, digits, rest] = /^0?(\d+)(.*)$/.exec(/^\d+$/.test(said) ? time(epoch) : said) ?? [null, said, ''];
  // (a clock of 24 hours, which has neither AM nor PM)
  return [end && digits === '0' && !/[ap]\.?\s?m\b/i.test(rest) ? '24' : digits, rest];
}

/** A whole hour as a clock says it (hourParts). */
export const hourText = (epoch, context) => hourParts(epoch, context, true).join('');

/** A stretch of whole hours: "5–7 Uhr", "20–24 Uhr", "11 AM–1 PM". */
export function hoursText(from, to, context) {
  const [a, aRest] = hourParts(from, context);
  const [b, bRest] = hourParts(to, context, true);
  // (what both say after the hour once: " Uhr", and " AM" within one half of the day; a time, "20:00", in full)
  const once = aRest === bRest && !aRest.startsWith(':') && (!/[ap]\.?\s?m\b/i.test(aRest) || to - from < 12 * 3600);
  return once ? `${a}–${b}${bRest}` : `${a}${aRest}–${b}${bRest}`;
}

const firstUp = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// (a short part of a line kept whole where the line breaks, "letzte Fahrt 01:04" not after "letzte")
const whole = (text) => text.replace(/ /g, '\u00a0');

/**
 * What runs now, of a line or of a line at a stop, in a line of the details:
 * how often in the hour it is and until when that holds, and the last trip
 * of the service day; before the first, the first; after the last, that
 * none comes any more.
 * @param day { first, last, runs } of the service day (facts.js), null where nothing runs that day
 * @param context { t, time, hour, now }
 * @param stop the stop these are of, which the line then names first, or null where it is the stop shown
 */
export function todayText(day, context, stop = null) {
  const { t, time, now } = context;
  const run = day && day.first !== null && now >= day.first && now <= day.last ? day.runs.find(({ from, to }) => from <= now && now < to) : null;
  const said = !day || day.first === null ? t('facts.noneToday')
    : now > day.last ? t('facts.overToday')
      : [
        now < day.first ? whole(t('facts.first', { time: time(day.first) })) : null,
        run ? t('facts.until', { often: oftenText(run, context), until: hourText(run.to, context) }) : null,
        whole(t('facts.last', { time: time(day.last) })),
      ].filter(Boolean).join('\u00a0· ');
  // (where the figures are of, where that is not the stop shown: a line's last trip at its busiest stop is not that at the next)
  return firstUp(stop ? t('facts.fromStop', { stop, said: said.charAt(0).toLowerCase() + said.slice(1) }) : said);
}

/**
 * The line below the name of a stop that says what leaves it on the service
 * day: how many lines, of how many, and from when to when.
 * @param today { first, last, lines, all } as api/departures has it, or null
 */
export function stopToday(today, context) {
  const { t, time } = context;
  if (!today) return null;
  // (of how many, where some of its lines do not run today: their badges are all under "Alle Linien")
  const lines = (today.all ?? today.lines) > today.lines ? t('facts.linesOfToday', { count: today.lines, all: today.all }) : t('facts.linesToday', { count: today.lines });
  const said = today.first === null ? t('facts.stopNone') : t('facts.stopToday', { lines, first: time(today.first), last: time(today.last) });
  return h('p', { class: 'facts' }, said);
}

/** The days of a week as their timetable groups them: "Mo, Fr", "Di–Do", Monday first, a run of three or more as a range. */
export function daysText(dates, { weekday }) {
  // (noon of each day in the area, whose weekday it is; dates as yyyymmdd)
  const days = dates.map((date) => {
    const noon = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), 12) / 1000;
    return { name: weekday(noon), order: (new Date(noon * 1000).getUTCDay() + 6) % 7 };
  }).sort((a, b) => a.order - b.order);
  const parts = [];
  for (let k = 0; k < days.length;) {
    let end = k;
    while (end + 1 < days.length && days[end + 1].order === days[end].order + 1) end++;
    if (end - k >= 2) parts.push(`${days[k].name}–${days[end].name}`);
    else for (let j = k; j <= end; j++) parts.push(days[j].name);
    k = end + 1;
  }
  return parts.join(', ');
}

/** Whether a stretch of hours (a run of hourly() in facts.js) is the one a group of days says already. */
const sameRun = (run, often) => run.from === often.from && run.to === often.to && run.every === often.every && run.atMost === often.atMost && String(run.perHour) === String(often.perHour);

/**
 * The timetable of a line after its stops (#289), the way it goes that its
 * stops show: of the coming days, by their kind as a timetable has them
 * (Mo–Fr, Sa, So, apart where the first or last trip differs), two lines
 * each: its first and last trip, and the longest stretch of hours one set of
 * words holds for, else how many trips it makes. How often it runs hour by
 * hour is folded away below each, opened and closed by its own head (a
 * disclosure, which works without the script); folded, the hours are in the
 * page all the same. Then how long it takes from end to end, its stops, its
 * towns. Its heading stands before it, not in it: below a long list of
 * stops it waits at the foot of the details while they scroll, as the way
 * down to it (style.css, app.js).
 * @param facts as api/line has them (`facts`), or none
 * @param context { t, time, hour, weekday, list }
 * @param way which of its ways (facts.ways)
 * @param open the kinds of day whose hours are shown, by their dates joined with commas
 * @returns [its heading, the timetable], or null
 */
export function lineTimetable(facts, context, way = 0, open = new Set()) {
  const { t, time, list } = context;
  const week = facts?.ways?.[way]?.week;
  if (!week?.length) return null;
  const { stop } = facts.ways[way];
  const order = (group) => Math.min(...group.dates.map((date) => (new Date(Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8))).getUTCDay() + 6) % 7));
  const groups = [...week].sort((a, b) => order(a) - order(b));
  // (the hours of a group, where they say more than its second line)
  const hours = (group) => (group.runs.length > 1 || (group.runs.length === 1 && !(group.often && sameRun(group.runs[0], group.often))) ? group.runs : []);
  const often = (group) => {
    if (group.often) return t('facts.during', { hours: hoursText(group.often.from, group.often.to, context), often: oftenText(group.often, context) });
    if (!group.trips) return null;
    const [few, many] = group.trips;
    return few === many ? t('facts.trips', { count: few }) : t('facts.tripsRange', { few, many });
  };
  // (the head of a kind of day: its name, and beside it its two lines; a summary holds no blocks, so spans)
  // (the kind of day today is, marked so: the rider need not work out that Wednesday is "Mo–Fr")
  const head = (group, folds) => [
    h('span', { class: 'when' }, daysText(group.dates, context), group.dates.includes(facts.date) ? h('span', { class: 'today' }, t('facts.todayMark')) : null),
    h('span', { class: 'said' },
      h('span', { class: 'span' }, group.first === null ? t('facts.noTrips') : `${time(group.first)}–${time(group.last)}`),
      group.first === null ? null : h('span', { class: 'often' }, often(group))),
    folds ? iconOf(mdiChevronUp) : null,
  ];
  const days = groups.map((group) => {
    const shown = hours(group);
    if (!shown.length) return h('li', {}, h('div', { class: 'days-head' }, head(group, false)));
    const key = group.dates.join(',');
    return h('li', {}, h('details', { class: 'days', open: open.has(key), 'data-days': key },
      h('summary', { class: 'days-head', 'data-focus': `days ${key}` }, head(group, true)),
      h('ul', { class: 'runs' }, shown.map((run) => h('li', {}, h('span', { class: 'hours' }, hoursText(run.from, run.to, context)), ' ', h('span', {}, oftenText(run, context)))))));
  });
  const towns = facts.towns ?? [];
  const along = [
    [facts.minutes !== null && facts.minutes !== undefined ? t('facts.endToEnd', { count: facts.minutes }) : null, facts.stops ? t('facts.stops', { count: facts.stops }) : null].filter(Boolean).join(' · '),
    !towns.length ? null : towns.length <= 4 ? t('facts.through', { towns: list(towns) }) : t('facts.throughMany', { count: towns.length, from: towns[0], to: towns.at(-1) }),
  ].filter(Boolean);
  return [
    h('h2', { class: 'timetable-head' }, h('button', { type: 'button', class: 'to-timetable' },
      h('span', { class: 'what' }, h('span', { class: 'title' }, t('facts.timetable')), stop ? h('span', { class: 'from' }, t('facts.timetableFrom', { stop })) : null),
      iconOf(mdiChevronUp))),
    h('section', { class: 'line-timetable' },
      h('ul', { class: 'timetable-days' }, days),
      along.length ? h('div', { class: 'along' }, along.map((said) => h('p', {}, said))) : null),
  ];
}

// ---------- a line ----------

// The rows of the stops of a line (#256), in px, as style.css has them: a
// station, and one with a line below its name; and the padding above them.
export const STOP_ROW = 32;
export const NOTED_ROW = 44;
const STOPS_TOP = 6;
// Where its line runs, from the left of the list, and that of a branch.
const LINE_X = 36;
const BRANCH_X = LINE_X + 18;
// A vehicle as the map draws it from zoom 14 (app.js): its radius, and its
// arrowhead from the edge of the disc at ±0.6 rad to 6 px beyond, pointing
// down the list, the way it goes.
export const VEHICLE_R = 11;
const point = (a, r) => `${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
const ARROW_DOWN = `M${point(Math.PI / 2, VEHICLE_R + 6)}L${point(Math.PI / 2 + 0.6, VEHICLE_R)}L${point(Math.PI / 2 - 0.6, VEHICLE_R)}Z`;

/** What a vehicle carries on its disc, on the map and in the stops of its line: the first word of its line, four letters at most. */
export function vehicleLabel(line) {
  const first = line.trim().split(/\s+/)[0] || '?';
  return first.length > 4 ? first.slice(0, 4) : first;
}

// The colour of a delay as a flag on a marker, by its class. Late, it is one
// class "hotter" than the dots, for the same reason (see .delay in style.css).
export const FLAG_COLOR = { early: 'early', ok: 'ok', minor: 'major', major: 'severe', severe: 'severe' };

/**
 * The flag a vehicle carries at its shoulder: its delay in minutes, early or
 * late, or a question mark where none is reported while others have one
 * (`live`). On time to the minute it carries none.
 * @returns { text, color } with the class of its colour (FLAG_COLOR, or none for the question mark), or null
 */
export function delayFlag(delay, live) {
  if (delay === null || delay === undefined) return live ? { text: '?', color: 'none' } : null;
  if (Math.round(delay / 60) === 0) return null;
  return { text: delayText(delay), color: FLAG_COLOR[delayClass(delay)] };
}

/**
 * The head of the details of a line: its name and kind, who runs it and how
 * many of its vehicles are under way; and where it goes two ways, the
 * switch between them (#256), each named by the destination it shows over
 * most of its way.
 * @param way the way shown, or null for no switch
 */
export function lineHead(line, context, way = null) {
  const { t } = context;
  const sub = [line.agency, line.vehicles.length ? t('line.vehicles', { count: line.vehicles.length }) : ''].filter(Boolean).join(' · ');
  const ways = line.ways ?? [];
  return panelHead([badge(line.name, line.mode), h('span', {}, t(`mode.${kindOf(line.mode)}`))], h('p', { class: 'sub' }, sub),
    // (how often it runs now the way its stops show and its last trip today, #289)
    line.facts?.ways?.length ? h('p', { class: 'facts' }, todayText(line.facts.ways[Math.min(way ?? 0, line.facts.ways.length - 1)].today, context, line.facts.ways[Math.min(way ?? 0, line.facts.ways.length - 1)].stop)) : null,
    way !== null && ways.length > 1
      ? h('p', { class: 'sub with-choice line-ways' }, h('span', {}, t('line.toward')),
        h('span', { class: 'view-switch ways', role: 'group', 'aria-label': t('line.ways') },
          ways.map((one, i) => h('button', { type: 'button', 'aria-pressed': String(i === way), 'data-way': i, title: t('line.to', { destination: one.to }) }, h('span', {}, one.to)))))
      : null);
}

/**
 * The stops of a line in one direction (#256), as a trip lists its stops: a
 * line with a ring for each station, each a link to its page, the town
 * below a name that does not say it (#246) and that some trips start or end
 * there; branches where they leave the line or join it, the line going on
 * beside them. Its vehicles under way on that line where they are, as the
 * map draws them, with their flags; each opens its trip.
 * @param line as api/line answers, with `ways` (Timetable.lineStops)
 * @param context { t, live, colorBy, flags, moving }: whether delays are
 *   coming in (for the question mark of a flag), the map's settings for the
 *   colour of a vehicle and its flag, and whether the page moves the
 *   vehicles: then it draws them itself on a canvas, under a button for each
 *   that cannot be seen (app.js); else they are drawn in their places, as
 *   the page sent has them
 */
export function lineStops(line, context, way = 0) {
  const { t } = context;
  const one = line.ways?.[way];
  if (!one) return [];
  const towns = townsAlong([...one.stops, ...one.branches.flatMap((branch) => branch.stops)]);
  const noteOf = (stop) => (stop.start && stop.end ? t('line.turns') : stop.start ? t('line.starts') : stop.end ? t('line.ends') : null);
  // (the rows one after the other, and the middle of each, where the vehicles between them are placed)
  let y = STOPS_TOP;
  const row = (stop, town, note, className) => {
    const below = [town, note].filter(Boolean).join(' · ');
    const height = below ? NOTED_ROW : STOP_ROW;
    const middle = y + height / 2;
    y += height;
    const name = below ? h('span', { class: 'name' }, h('span', { class: 'stop' }, stop.name), h('span', { class: 'town' }, below)) : h('span', { class: 'name' }, stop.name);
    return { middle, node: h('li', { class: className }, h('a', { class: `row on-line${below ? ' in-town' : ''}`, href: stop.path, 'data-station': stop.id, title: stop.name }, h('span', { class: 'rail' }), name)) };
  };
  const ends = (i, n) => `on-line station${i === 0 ? ' first' : ''}${i === n - 1 ? ' last' : ''}`;
  const middles = [];
  const inBranches = one.branches.map(() => []);
  let next = one.stops.length; // (the town of the next stop of a branch, after those of the list)
  const branch = (k) => {
    const { after, before, stops } = one.branches[k];
    // (one that leaves the line, one that joins it, one that does both, as a loop off a station and back, or one apart)
    const kind = [after !== null ? 'leaves' : null, before !== null ? 'joins' : null].filter(Boolean).join(' ') || 'apart';
    return h('li', { class: `branch-part ${kind}` }, h('ul', { class: 'branch' }, stops.map((stop, i) => {
      const { middle, node } = row(stop, towns[next++], null, ends(i, stops.length));
      inBranches[k].push(middle);
      return node;
    })));
  };
  // (a branch that leaves the line after its station, one that joins it before its station, one apart at the end)
  const items = [];
  one.stops.forEach((stop, i) => {
    one.branches.forEach((b, k) => b.after === null && b.before === i && items.push(branch(k)));
    const { middle, node } = row(stop, towns[i], noteOf(stop), ends(i, one.stops.length));
    middles.push(middle);
    items.push(node);
    one.branches.forEach((b, k) => b.after === i && items.push(branch(k)));
  });
  one.branches.forEach((b, k) => b.after === null && b.before === null && items.push(branch(k)));
  // the vehicles, between the middles of the rows of their two stations, as far as they have come
  const at = (v, i) => {
    if (v.branch === null) return [LINE_X, middles[i]];
    const { after, before } = one.branches[v.branch];
    const mids = inBranches[v.branch];
    return i < 0 ? [LINE_X, middles[after]] : i >= mids.length ? [LINE_X, middles[before]] : [BRANCH_X, mids[i]];
  };
  // (and where they will be when, from their tracks, for the page to move them by itself: app.js)
  const vehicles = one.vehicles.map((v) => {
    const track = (v.track ?? []).flatMap((value, k) => (k % 2 === 0 ? [value] : at(v, value).map((px) => Math.round(px * 10) / 10)));
    const [x0, y0] = at(v, v.from);
    const [x1, y1] = at(v, v.until);
    const [x, y] = track.length ? trackAt(track, context.now) : [x0 + (x1 - x0) * v.come, y0 + (y1 - y0) * v.come];
    return (context.moving ? movingVehicle : lineVehicle)(line, v, x, y, context, track);
  });
  const list = h('ul', { class: 'line-stops', 'data-mode': kindOf(line.mode) }, items);
  if (!vehicles.length) return [h('div', { class: 'line-body' }, list)];
  return [h('div', { class: 'line-body' }, list, context.moving
    ? h('div', { class: 'line-vehicles' }, h('canvas', { class: 'line-canvas', 'aria-hidden': 'true' }), vehicles)
    : h('svg', { class: 'line-vehicles', height: Math.round(y + STOPS_TOP) }, vehicles))];
}

/**
 * Where a vehicle on the stops of a line is at a moment, by its track:
 * [time, x, y, …], from one place to the next as the time goes, before the
 * first at the first and after the last at the last.
 */
export function trackAt(track, now) {
  if (now <= track[0]) return [track[1], track[2]];
  for (let k = 3; k < track.length; k += 3) {
    if (now >= track[k]) continue;
    const f = (now - track[k - 3]) / (track[k] - track[k - 3]);
    return [track[k - 2] + (track[k + 1] - track[k - 2]) * f, track[k - 1] + (track[k + 2] - track[k - 1]) * f];
  }
  return [track[track.length - 2], track[track.length - 1]];
}

/**
 * The sign of a vehicle on the stops of a line, as the map draws it, around
 * the middle of its disc: its parts, what it is called, and what its
 * colour goes by.
 */
function vehicleSign(line, v, { t, live = false, colorBy = 'mode', flags = true }) {
  const label = vehicleLabel(line.name);
  const font = label.length > 3 ? 8 : label.length > 2 ? 9.5 : 11;
  // (no flag where the colour says the delay, nor where the visitor switched them off, as on the map)
  const flag = colorBy === 'mode' && flags ? delayFlag(v.delay, live) : null;
  const width = flag ? (flag.text === '?' ? 12 : flag.text.length * 5.4 + 6) : 0;
  const attrs = {
    'data-trip': v.id,
    'aria-label': [line.name, t('line.to', { destination: v.to }), delayText(v.delay)].filter(Boolean).join(' '),
    'data-mode': kindOf(line.mode),
    'data-delay': colorBy === 'delay' ? delayClass(v.delay) : null,
  };
  const parts = [
    h('path', { d: ARROW_DOWN }),
    h('circle', { r: VEHICLE_R }),
    h('text', { y: (font * 0.36).toFixed(1), 'font-size': font }, label),
    flag ? h('g', { class: `flag ${flag.color}`, transform: `translate(${VEHICLE_R * 0.55} ${-VEHICLE_R - 5})` },
      h('rect', { width: width.toFixed(1), height: 12, rx: 4 }),
      h('text', { x: (width / 2).toFixed(1), y: 9 }, flag.text)) : null,
    // (the ring of the keyboard focus, last, round all of it: its arrowhead and its flag inside)
    h('rect', { class: 'ring', x: -19, y: -21, width: (19 + Math.max(19, VEHICLE_R * 0.55 + width + 3)).toFixed(1), height: 42, rx: 10 }),
  ];
  return { attrs, parts };
}

/** A vehicle on the line of the stops (lineStops) in its place, as the page sent has it: a button drawn there, with its track in px. */
function lineVehicle(line, v, x, y, context, track = []) {
  const { attrs, parts } = vehicleSign(line, v, context);
  return h('g', { class: 'line-vehicle', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'data-trip': v.id, role: 'button', tabindex: '0', ...attrs, 'data-track': track.length ? track.join(',') : null },
    h('rect', { class: 'hit', x: -18, y: -18, width: 36, height: 36, rx: 18 }), parts);
}

/**
 * A vehicle on the line of the stops (lineStops) that the page moves and
 * draws itself, as the map does (app.js): a button that cannot be seen, for a
 * tap, the keyboard and a screen reader, with what the page draws it by:
 * where it is (data-at), its track in px, its kind, delay and label.
 */
function movingVehicle(line, v, x, y, { t }, track = []) {
  return h('button', { type: 'button', class: 'line-vehicle', 'data-trip': v.id, 'aria-label': [line.name, t('line.to', { destination: v.to }), delayText(v.delay)].filter(Boolean).join(' '),
    'data-mode': kindOf(line.mode), 'data-late': v.delay ?? null, 'data-label': vehicleLabel(line.name),
    'data-at': `${x.toFixed(1)},${y.toFixed(1)}`, 'data-track': track.length ? track.join(',') : null });
}
