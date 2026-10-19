// Makes the data that build-pictures.mjs takes the pictures of the READMEs
// from, in tools/pictures/: a Monday at 13:37 around Nürnberg and Fürth, so
// that the pictures come out the same at whatever hour and on whatever day
// they are taken.
//
//   feed.zip      the timetable of that day, cut out of a GTFS feed of gtfs.de:
//                 the trips that call in the area of the pictures in the hours
//                 around the moment, with their stops, lines and operators
//   osm.pbf       the roads and tracks of that area and the borders of its
//                 towns, cut out of an OpenStreetMap extract of Geofabrik
//   realtime.pb   delays for those trips, made up, as a GTFS-Realtime feed of
//                 the kind gtfs.de publishes; the bus the pictures follow has
//                 just left a stop, a few minutes late
//   moment.json   the moment, the bus that the pictures follow, and what the
//                 data was made from
//
// Run it by hand, and only when the pictures need other data:
//
//   node tools/build-picture-data.mjs <feed.zip of gtfs.de> <mittelfranken-latest.osm.pbf of Geofabrik>
//
// The feed has to run on the day of MOMENT; the extract has to cover AREA.
// stop_times.txt is read twice, which takes a minute or two for the feed of
// Germany. The delays are not real: each trip gets one from its id, the same
// one every time.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { eachLine, parseCsvLine } from '../server/lib/csv.js';
import { classifyWay } from '../server/lib/network.js';
import { Reader } from '../server/lib/pb.js';
import { openZip } from '../server/lib/zip.js';

// The moment the pictures show, a Monday afternoon, in the time zone of the default area.
const MOMENT = '2026-10-19T13:37:00+02:00';
const DAY = '20261019';
const MIDNIGHT = Date.parse('2026-10-19T00:00:00+02:00') / 1000;
// The trips kept: those that call in AREA and are under way at some time
// between FROM and TO, in seconds of the day: the hour before the moment, and
// the two hours after it that the departures of a stop reach.
const AREA = { south: 49.39, west: 10.92, north: 49.5, east: 11.17 };
const FROM = 12 * 3600 + 30 * 60;
const TO = 15 * 3600 + 45 * 60;
// The roads, tracks and borders kept: those in AREA and this much around it, in degrees.
const MARGIN = 0.02;
// The borders kept, by their admin_level: of the towns and of the districts (towns.js).
const BORDER_LEVELS = ['8', '6'];
// The stop whose departures the pictures show, and the vehicle they follow: one that has left the stop
// AT SINCE seconds before the moment, LATE.min to LATE.max seconds late, with AHEAD stops or more still
// ahead of it.
const STOP = 'Nürnberg Plärrer';
const AT = 'Nürnberg Hallertor';
const SINCE = 20;
const LATE = { min: 60, max: 180 };
const AHEAD = 5;

const [feedFile, extractFile] = process.argv.slice(2);
if (!feedFile || !extractFile) throw new Error('usage: node tools/build-picture-data.mjs <feed.zip> <extract.osm.pbf>');
const out = fileURLToPath(new URL('pictures/', import.meta.url));
const now = Date.parse(MOMENT) / 1000;
const inArea = (lat, lon, margin = 0) => lat >= AREA.south - margin && lat <= AREA.north + margin && lon >= AREA.west - margin && lon <= AREA.east + margin;

// ---------- writing bytes: protobuf, zip ----------

/** A growing buffer that protobuf messages are written into. */
class Bytes {
  constructor() {
    this.buf = Buffer.alloc(1 << 16);
    this.length = 0;
  }

  room(n) {
    if (this.length + n <= this.buf.length) return;
    const bigger = Buffer.alloc(Math.max(2 * this.buf.length, this.length + n));
    this.buf.copy(bigger, 0, 0, this.length);
    this.buf = bigger;
  }

  /** A whole number of up to 2^53 as a varint; a negative one as the ten bytes of its two's complement. */
  varint(value) {
    this.room(10);
    if (value < 0) {
      let rest = BigInt.asUintN(64, BigInt(value));
      for (; rest >= 128n; rest >>= 7n) this.buf[this.length++] = Number(rest & 127n) | 128;
      this.buf[this.length++] = Number(rest);
      return this;
    }
    for (; value >= 128; value = Math.floor(value / 128)) this.buf[this.length++] = (value % 128) | 128;
    this.buf[this.length++] = value;
    return this;
  }

  sint(value) {
    return this.varint(value < 0 ? -2 * value - 1 : 2 * value);
  }

  raw(data) {
    this.room(data.length);
    data.copy(this.buf, this.length);
    this.length += data.length;
    return this;
  }

  // Fields: a varint, a length-delimited one (bytes, a text, a message), and packed numbers.
  number(field, value) {
    return this.varint(field * 8).varint(value);
  }

  bytes(field, data) {
    return this.varint(field * 8 + 2).varint(data.length).raw(data);
  }

  text(field, text) {
    return this.bytes(field, Buffer.from(text));
  }

  message(field, write) {
    const inner = new Bytes();
    write(inner);
    return this.bytes(field, inner.done());
  }

  packed(field, values, signed = false) {
    const inner = new Bytes();
    for (const value of values) {
      if (signed) inner.sint(value);
      else inner.varint(value);
    }
    return this.bytes(field, inner.done());
  }

  done() {
    return this.buf.subarray(0, this.length);
  }
}

/** A zip of the files [name, contents], each deflated, as GTFS feeds come. */
function zipOf(files) {
  const parts = [];
  const directory = [];
  let offset = 0;
  for (const [name, data] of files) {
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const fixed = Buffer.alloc(26);
    fixed.writeUInt16LE(20, 0); // version needed
    fixed.writeUInt16LE(0x0800, 2); // the name is UTF-8
    fixed.writeUInt16LE(8, 4); // deflate
    fixed.writeUInt32LE(zlib.crc32(data), 10);
    fixed.writeUInt32LE(packed.length, 14);
    fixed.writeUInt32LE(data.length, 18);
    fixed.writeUInt16LE(Buffer.byteLength(name), 22);
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), fixed, Buffer.from(name)]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    fixed.copy(central, 6);
    central.writeUInt32LE(offset, 42);
    directory.push(Buffer.concat([central, Buffer.from(name)]));
    parts.push(local, packed);
    offset += local.length + packed.length;
  }
  const size = directory.reduce((sum, entry) => sum + entry.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...directory, end]);
}

// ---------- the timetable ----------

const zip = await openZip(feedFile);
/** Goes through a file of the feed: its header, then each row as its fields and its line as it is. */
async function table(name, onRow) {
  let columns = null;
  await eachLine(await zip.stream(name), (line) => {
    if (!line) return;
    if (!columns) {
      columns = Object.fromEntries(parseCsvLine(line.replace(/^\uFEFF/, '')).map((column, i) => [column.trim(), i]));
      onRow(null, line.replace(/^\uFEFF/, ''), columns);
      return;
    }
    onRow(parseCsvLine(line), line, columns);
  });
}
const csvLine = (fields) => fields.map((value) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)).join(',');
const seconds = (time) => {
  if (!time) return null;
  const [h, m, s] = time.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

const headers = {};
const stops = new Map();
await table('stops.txt', (row, line, c) => {
  if (!row) return void (headers.stops = line);
  stops.set(row[c.stop_id], { name: row[c.stop_name], lat: Number(row[c.stop_lat]), lon: Number(row[c.stop_lon]), parent: row[c.parent_station] ?? '', line });
});
// The services that run on the day: by their days of the week, and the dates that add or take one away.
const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(Date.parse(MOMENT)).getUTCDay()];
const services = new Set();
try {
  await table('calendar.txt', (row, line, c) => {
    if (row && row[c[weekday]] === '1' && row[c.start_date] <= DAY && DAY <= row[c.end_date]) services.add(row[c.service_id]);
  });
} catch {
  // (a feed may say everything in calendar_dates.txt)
}
await table('calendar_dates.txt', (row, line, c) => {
  if (!row || row[c.date] !== DAY) return;
  if (row[c.exception_type] === '1') services.add(row[c.service_id]);
  else services.delete(row[c.service_id]);
});
const routes = new Map();
await table('routes.txt', (row, line, c) => {
  if (!row) return void (headers.routes = line);
  routes.set(row[c.route_id], { agency: row[c.agency_id] ?? '', type: Number(row[c.route_type]), name: row[c.route_short_name] || row[c.route_long_name], line });
});
// (who publishes the feed, as it says itself, kept as it is)
const feedInfo = [];
try {
  await table('feed_info.txt', (row, line) => feedInfo.push(line));
} catch {
  // (a feed need not say it)
}
const agencies = new Map();
await table('agency.txt', (row, line, c) => {
  if (!row) return void (headers.agency = line);
  agencies.set(row[c.agency_id] ?? '', { name: row[c.agency_name], line });
});
const trips = new Map();
let tripColumns = null;
await table('trips.txt', (row, line, c) => {
  if (!row) {
    headers.trips = line;
    tripColumns = c;
    return;
  }
  if (services.has(row[c.service_id])) trips.set(row[c.trip_id], { route: row[c.route_id], fields: row, inArea: false, first: Infinity, last: -Infinity });
});
console.log(`${services.size} services and ${trips.size} trips run on ${DAY}`);

// Which of them call in the area while the pictures need them: first where each calls and when.
await table('stop_times.txt', (row, line, c) => {
  if (!row) return void (headers.stopTimes = line);
  const trip = trips.get(row[c.trip_id]);
  if (!trip) return;
  const stop = stops.get(row[c.stop_id]);
  if (stop && inArea(stop.lat, stop.lon)) trip.inArea = true;
  for (const time of [seconds(row[c.arrival_time]), seconds(row[c.departure_time])]) {
    if (time === null) continue;
    trip.first = Math.min(trip.first, time);
    trip.last = Math.max(trip.last, time);
  }
});
for (const [id, trip] of trips) if (!(trip.inArea && trip.first <= TO && trip.last >= FROM)) trips.delete(id);
// Then their stop times, as they are.
await table('stop_times.txt', (row, line, c) => {
  if (!row) return;
  const trip = trips.get(row[c.trip_id]);
  if (!trip) return;
  (trip.rows ??= []).push({ line, stop: row[c.stop_id], sequence: Number(row[c.stop_sequence]), arr: seconds(row[c.arrival_time]), dep: seconds(row[c.departure_time]), headsign: c.stop_headsign === undefined ? '' : row[c.stop_headsign] });
});
for (const trip of trips.values()) trip.rows.sort((a, b) => a.sequence - b.sequence);
console.log(`${trips.size} trips call in the area between ${FROM / 3600} h and ${TO / 3600} h`);

// The vehicle the pictures follow: a bus if one is such, else a tram, else any; of them, the least late.
// Its delay is made up so that it is where it is at the moment.
const atStop = (id) => stops.get(id)?.name === AT || stops.get(stops.get(id)?.parent)?.name === AT;
const KINDS = [['bus', (type) => type === 3 || (type >= 700 && type < 800)], ['tram', (type) => type === 0 || (type >= 900 && type < 1000)], ['vehicle', () => true]];
let followed = null;
for (const [kind, isKind] of KINDS) {
  for (const [id, trip] of trips) {
    if (!isKind(routes.get(trip.route)?.type)) continue;
    const index = trip.rows.findIndex((row) => atStop(row.stop));
    if (index < 0 || index >= trip.rows.length - AHEAD || trip.rows[index].dep === null) continue;
    const late = now - SINCE - MIDNIGHT - trip.rows[index].dep;
    if (late < LATE.min || late > LATE.max || (followed && late >= followed.late)) continue;
    followed = { id, trip, index, kind, late };
  }
  if (followed) break;
}
if (!followed) throw new Error(`nothing leaves ${AT} ${LATE.min / 60} to ${LATE.max / 60} min before the moment by the timetable`);

// ---------- the delays, made up ----------

/** A whole number from a text, the same for the same text (FNV-1a). */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
// How late a trip is, from the start, in seconds; null for one without realtime data. Most are on time
// or a minute late, some a few minutes, a few a minute early.
function madeUpDelay(id) {
  const share = hash(id) % 100;
  if (share < 4) return null;
  if (share < 44) return 0;
  if (share < 64) return 60;
  if (share < 76) return 120;
  if (share < 83) return 180;
  if (share < 87) return 300;
  if (share < 89) return 480;
  return -60;
}

const feed = new Bytes();
feed.message(1, (header) => header.text(1, '2.0').number(2, 0).number(3, now));
const late = new Map(); // agency id -> the trips with realtime data, for the note that names who provides it
for (const [id, trip] of trips) {
  const delay = madeUpDelay(id);
  if (delay === null && id !== followed.id) continue;
  // (the vehicle the pictures follow: as late as it is from two stops before the stop on, a minute late before)
  const from = Math.max(0, followed.index - 2);
  const updates = id !== followed.id ? [[trip.rows[0].sequence, delay]] : from > 0 ? [[trip.rows[0].sequence, 60], [trip.rows[from].sequence, followed.late]] : [[trip.rows[0].sequence, followed.late]];
  feed.message(2, (entity) => entity.text(1, `trip-${id}`).message(3, (update) => {
    update.message(1, (descriptor) => descriptor.text(1, id).text(3, DAY));
    for (const [sequence, seconds] of updates) {
      update.message(2, (stopTime) => stopTime.number(1, sequence).message(2, (event) => event.number(1, seconds)).message(3, (event) => event.number(1, seconds)));
    }
  }));
  const agency = routes.get(trip.route).agency;
  late.set(agency, [...(late.get(agency) ?? []), id]);
}
// (the note gtfs.de gives each trip, which the page shows as the source of its delay data)
for (const [agency, ids] of late) {
  feed.message(2, (entity) => entity.text(1, `source-${agency}`).message(5, (alert) => {
    for (const id of ids) alert.message(5, (selector) => selector.message(4, (descriptor) => descriptor.text(1, id).text(3, DAY)));
    alert.message(11, (text) => text.message(1, (translation) => translation.text(1, `Echtzeitdaten aufbereitet von GTFS.de, bereitgestellt von ${agencies.get(agency)?.name ?? agency}`).text(2, 'de')));
  }));
}

// ---------- the map data ----------

/** Goes through the blocks of data of an extract, each as its table of texts and its groups. */
function eachBlock(buf, onBlock) {
  for (let pos = 0; pos < buf.length;) {
    const headerLength = buf.readUInt32BE(pos);
    const header = new Reader(buf, pos + 4, pos + 4 + headerLength);
    let type = '';
    let size = 0;
    for (let f; (f = header.next());) {
      if (f === 1) type = header.string();
      else if (f === 3) size = header.varint();
      else header.skip(header.wire);
    }
    const blob = new Reader(buf, pos + 4 + headerLength, pos + 4 + headerLength + size);
    pos += 4 + headerLength + size;
    let data = null;
    for (let f; (f = blob.next());) {
      if (f === 1) data = Buffer.from(blob.bytes());
      else if (f === 3) data = zlib.inflateSync(blob.bytes());
      else blob.skip(blob.wire);
    }
    if (type !== 'OSMData') continue;
    const block = new Reader(data);
    const strings = [];
    const groups = [];
    let granularity = 100;
    let latOffset = 0;
    let lonOffset = 0;
    for (let f; (f = block.next());) {
      if (f === 1) {
        const table = block.sub();
        for (let g; (g = table.next());) {
          if (g === 1) strings.push(table.string());
          else table.skip(table.wire);
        }
      } else if (f === 2) groups.push(block.sub());
      else if (f === 17) granularity = block.varint();
      else if (f === 19) latOffset = block.int64();
      else if (f === 20) lonOffset = block.int64();
      else block.skip(block.wire);
    }
    onBlock({ strings, groups, granularity, latOffset, lonOffset });
  }
}
const packed = (reader, signed) => {
  const values = [];
  for (let value = 0; reader.pos < reader.end;) values.push(signed ? (value += reader.sint()) : reader.varint());
  return values;
};
/** Each node, way or relation of an extract, as its kind (1, 2, 3), its id, and for a node its latitude and longitude, for the others a way to read the rest. */
function eachElement(buf, kinds, onElement) {
  eachBlock(buf, ({ strings, groups, granularity, latOffset, lonOffset }) => {
    for (const group of groups) {
      for (let f; (f = group.next());) {
        if (f === 2 && kinds.includes(1)) {
          const dense = group.sub();
          let ids = [];
          let lats = [];
          let lons = [];
          for (let g; (g = dense.next());) {
            if (g === 1) ids = packed(dense.sub(), true);
            else if (g === 8) lats = packed(dense.sub(), true);
            else if (g === 9) lons = packed(dense.sub(), true);
            else dense.skip(dense.wire);
          }
          for (let i = 0; i < ids.length; i++) onElement(1, ids[i], (latOffset + granularity * lats[i]) / 1e9, (lonOffset + granularity * lons[i]) / 1e9);
        } else if ((f === 3 && kinds.includes(2)) || (f === 4 && kinds.includes(3))) {
          const element = group.sub();
          const read = { id: 0, keys: [], vals: [], refs: [], roles: [], members: [], types: [] };
          for (let g; (g = element.next());) {
            if (g === 1) read.id = element.varint();
            else if (g === 2) read.keys = packed(element.sub());
            else if (g === 3) read.vals = packed(element.sub());
            else if (g === 8 && f === 3) read.refs = packed(element.sub(), true);
            else if (g === 8) read.roles = packed(element.sub());
            else if (g === 9) read.members = packed(element.sub(), true);
            else if (g === 10) read.types = packed(element.sub());
            else element.skip(element.wire);
          }
          read.tags = () => Object.fromEntries(read.keys.map((key, i) => [strings[key], strings[read.vals[i]]]));
          read.role = (i) => strings[read.roles[i]];
          onElement(f === 3 ? 2 : 3, read.id, read);
        } else group.skip(group.wire);
      }
    }
  });
}

const extract = fs.readFileSync(extractFile);
// The nodes in the area with its margin; the roads and tracks among the ways that reach into it, and every
// way that does, for the borders.
const near = new Set();
eachElement(extract, [1], (kind, id, lat, lon) => {
  if (inArea(lat, lon, MARGIN)) near.add(id);
});
const ways = new Map(); // id -> { tags, refs }
const touching = new Set();
eachElement(extract, [2], (kind, id, way) => {
  if (!way.refs.some((ref) => near.has(ref))) return;
  touching.add(id);
  const tags = way.tags();
  if (classifyWay(tags)) ways.set(id, { tags, refs: way.refs });
});
// The borders of the towns and districts that reach into it, with all their ways: a town is found in the
// search by the whole of its border.
const relations = new Map(); // id -> { tags, members: [[way id, role]] }
eachElement(extract, [3], (kind, id, relation) => {
  const tags = relation.tags();
  if (tags.boundary !== 'administrative' || !BORDER_LEVELS.includes(tags.admin_level) || !tags.name) return;
  const members = relation.members.map((member, i) => [relation.types[i], member, relation.role(i)]).filter(([type]) => type === 1).map(([, member, role]) => [member, role]);
  if (!members.some(([member]) => touching.has(member))) return;
  relations.set(id, { tags: { type: tags.type ?? 'boundary', boundary: tags.boundary, admin_level: tags.admin_level, name: tags.name }, members });
});
const borderWays = new Set([...relations.values()].flatMap(({ members }) => members.map(([member]) => member)).filter((id) => !ways.has(id)));
eachElement(extract, [2], (kind, id, way) => {
  if (borderWays.has(id)) ways.set(id, { tags: {}, refs: way.refs });
});
const wanted = new Set([...ways.values()].flatMap(({ refs }) => refs));
const nodes = new Map(); // id -> [lat, lon] in 1e-7 degrees
eachElement(extract, [1], (kind, id, lat, lon) => {
  if (wanted.has(id)) nodes.set(id, [Math.round(lat * 1e7), Math.round(lon * 1e7)]);
});
console.log(`${nodes.size} nodes, ${ways.size} ways and ${relations.size} borders of the map`);

/** An .osm.pbf of the nodes, ways and relations, in that order and by their ids, as an extract is. */
function pbfOf() {
  const blocks = [];
  const blob = (type, data) => {
    const body = new Bytes().number(2, data.length).bytes(3, zlib.deflateSync(data, { level: 9 })).done();
    const header = new Bytes().text(1, type).number(3, body.length).done();
    const length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    blocks.push(length, header, body);
  };
  blob('OSMHeader', new Bytes().text(4, 'OsmSchema-V0.6').text(4, 'DenseNodes').text(5, 'Sort.Type_then_ID').text(16, 'netnou build-picture-data').done());
  // (a block: its table of texts, of which the first is empty, and one group written by `write`)
  const block = (write) => {
    const texts = [''];
    const index = new Map([['', 0]]);
    const textId = (text) => {
      if (!index.has(text)) index.set(text, texts.push(text) - 1);
      return index.get(text);
    };
    const group = new Bytes();
    write(group, textId);
    blob('OSMData', new Bytes().message(1, (table) => texts.forEach((text) => table.text(1, text))).bytes(2, group.done()).done());
  };
  const deltas = (values) => values.map((value, i) => value - (i ? values[i - 1] : 0));
  const SIZE = 8000;
  const nodeIds = [...nodes.keys()].sort((a, b) => a - b);
  for (let i = 0; i < nodeIds.length; i += SIZE) {
    const ids = nodeIds.slice(i, i + SIZE);
    block((group) => group.message(2, (dense) => dense
      .packed(1, deltas(ids), true)
      .packed(8, deltas(ids.map((id) => nodes.get(id)[0])), true)
      .packed(9, deltas(ids.map((id) => nodes.get(id)[1])), true)));
  }
  const wayIds = [...ways.keys()].sort((a, b) => a - b);
  for (let i = 0; i < wayIds.length; i += SIZE) {
    block((group, textId) => {
      for (const id of wayIds.slice(i, i + SIZE)) {
        const { tags, refs } = ways.get(id);
        group.message(3, (way) => way.number(1, id).packed(2, Object.keys(tags).map(textId)).packed(3, Object.values(tags).map(textId)).packed(8, deltas(refs), true));
      }
    });
  }
  block((group, textId) => {
    for (const id of [...relations.keys()].sort((a, b) => a - b)) {
      const { tags, members } = relations.get(id);
      group.message(4, (relation) => relation.number(1, id)
        .packed(2, Object.keys(tags).map(textId)).packed(3, Object.values(tags).map(textId))
        .packed(8, members.map(([, role]) => textId(role)))
        .packed(9, deltas(members.map(([member]) => member)), true)
        .packed(10, members.map(() => 1)));
    }
  });
  return Buffer.concat(blocks);
}

// ---------- writing it all ----------

const keptStops = new Set();
for (const trip of trips.values()) {
  for (const row of trip.rows) {
    keptStops.add(row.stop);
    if (stops.get(row.stop)?.parent) keptStops.add(stops.get(row.stop).parent);
  }
}
const keptRoutes = new Set([...trips.values()].map((trip) => trip.route));
const keptAgencies = new Set([...keptRoutes].map((id) => routes.get(id).agency));
const text = (header, lines) => Buffer.from(`${[header, ...lines].join('\n')}\n`);
const feedZip = zipOf([
  ...(feedInfo.length ? [['feed_info.txt', text(feedInfo[0], feedInfo.slice(1))]] : []),
  ['agency.txt', text(headers.agency, [...keptAgencies].map((id) => agencies.get(id).line))],
  ['stops.txt', text(headers.stops, [...keptStops].filter((id) => stops.has(id)).map((id) => stops.get(id).line))],
  ['routes.txt', text(headers.routes, [...keptRoutes].map((id) => routes.get(id).line))],
  // (one service for all trips: they run on the day and on no other)
  ['trips.txt', text(headers.trips, [...trips.values()].map(({ fields }) => csvLine(fields.map((value, i) => (i === tripColumns.service_id ? 'pictures' : value)))))],
  ['stop_times.txt', text(headers.stopTimes, [...trips.values()].flatMap((trip) => trip.rows.map((row) => row.line)))],
  ['calendar_dates.txt', text('service_id,date,exception_type', [`pictures,${DAY},1`])],
]);

// What the extract says of its own date: the time of the OpenStreetMap data it holds.
let extractDate = null;
const head = (() => {
  const headerLength = extract.readUInt32BE(0);
  const header = new Reader(extract, 4, 4 + headerLength);
  let size = 0;
  for (let f; (f = header.next());) {
    if (f === 3) size = header.varint();
    else header.skip(header.wire);
  }
  const blob = new Reader(extract, 4 + headerLength, 4 + headerLength + size);
  for (let f; (f = blob.next());) {
    if (f === 3) return new Reader(zlib.inflateSync(blob.bytes()));
    blob.skip(blob.wire);
  }
  return null;
})();
for (let f; head && (f = head.next());) {
  if (f === 32) extractDate = new Date(head.int64() * 1000).toISOString();
  else head.skip(head.wire);
}

const at = followed.trip.rows[followed.index];
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'feed.zip'), feedZip);
fs.writeFileSync(path.join(out, 'osm.pbf'), pbfOf());
fs.writeFileSync(path.join(out, 'realtime.pb'), feed.done());
fs.writeFileSync(path.join(out, 'moment.json'), `${JSON.stringify({
  now: MOMENT,
  stop: STOP,
  at: AT,
  follow: `${followed.id}_${DAY}`,
  kind: followed.kind,
  line: routes.get(followed.trip.route).name,
  to: at.headsign || stops.get(followed.trip.rows.at(-1).stop).name,
  leaves: new Date((MIDNIGHT + at.dep) * 1000).toISOString(),
  late: followed.late,
  area: [AREA.south, AREA.west, AREA.north, AREA.east],
  feed: path.basename(feedFile),
  map: { file: path.basename(extractFile), date: extractDate },
}, null, 2)}\n`);
for (const name of ['feed.zip', 'osm.pbf', 'realtime.pb', 'moment.json']) console.log(`tools/pictures/${name}: ${Math.round(fs.statSync(path.join(out, name)).size / 1024)} kB`);
const clock = (time) => `${Math.floor(time / 3600)}:${String(Math.floor(time / 60) % 60).padStart(2, '0')}`;
console.log(`follows the ${followed.kind} ${routes.get(followed.trip.route).name} (${followed.id}), leaving ${AT} by the timetable at ${clock(at.dep)}, ${followed.late} s late`);
