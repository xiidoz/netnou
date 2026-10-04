// GTFS times are seconds since "noon minus 12h" of the service day in the
// agency time zone. One zone is used for the whole feed: the one set with
// setTimeZone (TIMEZONE, default Europe/Berlin, which every agency in the
// gtfs.de feed uses). agency_timezone in the feed is not read.
//
// The zone is module state and therefore per thread. The import worker has its
// own copy of this module and never sets the zone – it only uses addDays and
// weekday, which are plain calendar arithmetic and the same in every zone.

let partsFormat;
const dayStartCache = new Map();

/** Sets the time zone of the feed (an IANA name); throws a RangeError for an unknown one. */
export function setTimeZone(timeZone) {
  partsFormat = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  dayStartCache.clear();
}
setTimeZone('Europe/Berlin');

function localParts(epochMs) {
  const p = {};
  for (const { type, value } of partsFormat.formatToParts(epochMs)) p[type] = +value;
  return p;
}

function utcOffsetSec(epochMs) {
  const p = localParts(epochMs);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(epochMs / 1000) * 1000) / 1000;
}

/** Epoch seconds of GTFS time 00:00:00 on service day `yyyymmdd`. */
export function serviceDayStart(yyyymmdd) {
  let start = dayStartCache.get(yyyymmdd);
  if (start === undefined) {
    const noonUtc = Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8), 12);
    start = noonUtc / 1000 - utcOffsetSec(noonUtc) - 12 * 3600;
    if (dayStartCache.size > 100) dayStartCache.clear();
    dayStartCache.set(yyyymmdd, start);
  }
  return start;
}

/** Local calendar date (yyyymmdd) at the given epoch seconds. */
export function localDate(epochSec) {
  const p = localParts(epochSec * 1000);
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

export function addDays(yyyymmdd, days) {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8) + days));
  return d.toISOString().slice(0, 10).replaceAll('-', '');
}

/** Day of week of a calendar date, 0 = Monday … 6 = Sunday. */
export function weekday(yyyymmdd) {
  const d = new Date(Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8)));
  return (d.getUTCDay() + 6) % 7;
}
