// Minimal protobuf wire-format reader plus a GTFS-Realtime decoder.
// Only the fields this service uses are decoded; everything else is skipped.

export class Reader {
  constructor(buf, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }

  // Unsigned varint as a Number (exact up to 2^53, plenty for timestamps).
  varint() {
    const buf = this.buf;
    let result = 0;
    let mul = 1;
    for (let i = 0; i < 10; i++) {
      const b = buf[this.pos++];
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
    throw new Error('protobuf: varint too long');
  }

  // Signed 32-bit varint. Negative int32 values are sent as 10-byte
  // two's-complement varints, so only the low 32 bits are kept.
  int32() {
    const buf = this.buf;
    let lo = 0;
    for (let i = 0; i < 10; i++) {
      const b = buf[this.pos++];
      if (i < 4) lo |= (b & 0x7f) << (7 * i);
      else if (i === 4) lo |= (b & 0x0f) << 28;
      if (b < 0x80) return lo | 0;
    }
    throw new Error('protobuf: varint too long');
  }

  // Signed 64-bit varint as a Number.
  int64() {
    const start = this.pos;
    const v = this.varint();
    if (this.pos - start < 10) return v;
    return v - 18446744073709551616; // 2^64
  }

  // Zigzag-encoded signed varint (sint32/sint64) as a Number.
  sint() {
    const z = this.varint();
    return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
  }

  string() {
    const len = this.varint();
    const s = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  // Length-delimited field as a view into the underlying buffer (no copy).
  bytes() {
    const len = this.varint();
    const view = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return view;
  }

  // Reader over a length-delimited sub-message; advances past it.
  sub() {
    const len = this.varint();
    const r = new Reader(this.buf, this.pos, this.pos + len);
    this.pos += len;
    return r;
  }

  skip(wireType) {
    switch (wireType) {
      case 0: this.varint(); break;
      case 1: this.pos += 8; break;
      case 2: { const len = this.varint(); this.pos += len; break; }
      case 5: this.pos += 4; break;
      default: throw new Error(`protobuf: unsupported wire type ${wireType}`);
    }
  }

  // Returns the next field number (wire type in this.wire), or 0 at the end.
  next() {
    if (this.pos >= this.end) return 0;
    const tag = this.varint();
    this.wire = tag & 7;
    return tag >>> 3;
  }
}

// `rel` is the schedule_relationship of a trip or stop time update.
function readTripDescriptor(r) {
  const trip = { tripId: '', startDate: '', rel: 0 };
  for (let f; (f = r.next());) {
    if (f === 1) trip.tripId = r.string();
    else if (f === 3) trip.startDate = r.string();
    else if (f === 4) trip.rel = r.varint();
    else r.skip(r.wire);
  }
  return trip;
}

function readStopTimeEvent(r) {
  const ev = { delay: null, time: null };
  for (let f; (f = r.next());) {
    if (f === 1) ev.delay = r.int32();
    else if (f === 2) ev.time = r.int64();
    else r.skip(r.wire);
  }
  return ev;
}

function readStopTimeUpdate(r) {
  const stu = { seq: null, stopId: '', arr: null, dep: null, rel: 0 };
  for (let f; (f = r.next());) {
    if (f === 1) stu.seq = r.varint();
    else if (f === 2) stu.arr = readStopTimeEvent(r.sub());
    else if (f === 3) stu.dep = readStopTimeEvent(r.sub());
    else if (f === 4) stu.stopId = r.string();
    else if (f === 5) stu.rel = r.varint();
    else r.skip(r.wire);
  }
  return stu;
}

// The trip descriptor is field 1 and written first by every producer we have
// seen, but protobuf does not guarantee order, so stop_time_updates are
// collected as sub-readers and only decoded once the trip passed the filter.
function readTripUpdate(r, wantTrip) {
  let trip = null;
  const pending = [];
  for (let f; (f = r.next());) {
    if (f === 1) trip = readTripDescriptor(r.sub());
    else if (f === 2) pending.push(r.sub());
    else r.skip(r.wire);
  }
  if (!trip || (wantTrip && !wantTrip(trip))) return null;
  return { trip, stopTimeUpdates: pending.map(readStopTimeUpdate) };
}

// Of a text that comes in several languages the German one is taken, otherwise
// the first: the alerts of the gtfs.de feed are German. The page shows these
// texts as they are, whatever language the visitor chose.
function readTranslated(r) {
  let fallback = '';
  let german = '';
  for (let f; (f = r.next());) {
    if (f !== 1) { r.skip(r.wire); continue; }
    const t = r.sub();
    let text = '';
    let lang = '';
    for (let g; (g = t.next());) {
      if (g === 1) text = t.string();
      else if (g === 2) lang = t.string();
      else t.skip(t.wire);
    }
    if (!fallback) fallback = text;
    if (lang.toLowerCase().startsWith('de')) german = text;
  }
  return german || fallback;
}

// Whom an alert is for. Only trips and stops are read: an alert addressed to a
// whole agency, route or route type has neither and is not shown anywhere.
function readEntitySelector(r) {
  const sel = { tripId: '', stopId: '' };
  for (let f; (f = r.next());) {
    if (f === 4) sel.tripId = readTripDescriptor(r.sub()).tripId;
    else if (f === 5) sel.stopId = r.string();
    else r.skip(r.wire);
  }
  return sel;
}

function readAlert(r) {
  const alert = { periods: [], informed: [], header: '', description: '' };
  for (let f; (f = r.next());) {
    if (f === 1) {
      // Active period in epoch seconds; 0 = open on that side.
      const p = r.sub();
      const period = { start: 0, end: 0 };
      for (let g; (g = p.next());) {
        if (g === 1) period.start = p.varint();
        else if (g === 2) period.end = p.varint();
        else p.skip(p.wire);
      }
      alert.periods.push(period);
    } else if (f === 5) alert.informed.push(readEntitySelector(r.sub()));
    else if (f === 10) alert.header = readTranslated(r.sub());
    else if (f === 11) alert.description = readTranslated(r.sub());
    else r.skip(r.wire);
  }
  return alert;
}

/**
 * Decode a GTFS-Realtime FeedMessage.
 * @param {Buffer} buf
 * @param {{wantTrip?: (trip: object) => boolean, wantAlert?: (alert: object) => boolean}} [filter]
 *   Predicates to drop entities early; the feed covers a whole country.
 */
export function decodeFeed(buf, filter = {}) {
  const r = new Reader(buf);
  const out = { timestamp: 0, tripUpdates: [], alerts: [] };
  for (let f; (f = r.next());) {
    if (f === 1) {
      const h = r.sub();
      for (let g; (g = h.next());) {
        if (g === 3) out.timestamp = h.varint();
        else h.skip(h.wire);
      }
    } else if (f === 2) {
      const e = r.sub();
      for (let g; (g = e.next());) {
        if (g === 3) {
          const tu = readTripUpdate(e.sub(), filter.wantTrip);
          if (tu) out.tripUpdates.push(tu);
        } else if (g === 5) {
          const alert = readAlert(e.sub());
          if (!filter.wantAlert || filter.wantAlert(alert)) out.alerts.push(alert);
        } else e.skip(e.wire);
      }
    } else r.skip(r.wire);
  }
  return out;
}
