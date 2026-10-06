# HTTP API

The page talks to the server through eight read-only JSON endpoints. They are
open to other clients as well.

- [Conventions](#conventions)
- [Status codes](#status-codes)
- [`GET /api/status`](#get-apistatus)
- [`GET /api/area`](#get-apiarea)
- [`GET /api/vehicles`](#get-apivehicles)
- [`GET /api/stations`](#get-apistations)
- [`GET /api/search`](#get-apisearch)
- [`GET /api/line`](#get-apiline)
- [`GET /api/trip`](#get-apitrip)
- [`GET /api/departures`](#get-apidepartures)
- [Knots](#knots)
- [Modes](#modes)
- [Stability and licence](#stability-and-licence)

The examples are taken from an instance with the default settings and are
shortened where marked with `…`.

## Conventions

- Only `GET` and `HEAD`. There is no authentication and there are no CORS
  headers, so a page on another origin cannot call the API from a browser.
- Answers are JSON in UTF-8, compressed with gzip when the client accepts it
  and the body is larger than 1 kB.
- Answers carry `Cache-Control: no-store`, except `/api/area`, which has an
  `ETag` and answers `304` to a matching `If-None-Match`.
- **Times** are Unix time in seconds. **Delays** are in seconds, positive when
  late. **Coordinates** are WGS 84 degrees. A **box** is
  `south,west,north,east`.
- A **service day** is a date `yyyymmdd` in the time zone of the feed
  (`TIMEZONE`). As in GTFS, a trip that starts after midnight can belong to
  the service day before.
- A **trip id** is `<trip_id>_<service day>`, for example `671753_20261004`,
  where `trip_id` is the one of the GTFS feed (it may itself contain
  underscores). It names one run of a trip on one day and is what
  `/api/vehicles` and `/api/departures` hand out and `/api/trip` takes. Trip
  ids change when the feed is republished.

## Status codes

| Code | When | Body |
| --- | --- | --- |
| 200 | success | see the endpoints |
| 304 | `/api/area` or `/api/search` with a matching `If-None-Match` | none |
| 400 | the URL cannot be decoded | none |
| 404 | unknown trip, station, line or path | `{ "error": "…" }` |
| 405 | any method other than `GET` and `HEAD`; the `Allow` header names them | none |
| 500 | an error in the server | none |
| 503 | no timetable is loaded yet | see below |

While the server has no timetable, right after the first start or when the
feed cannot be loaded, every `/api/` path except `/api/status` and `/api/area`
answers 503:

```json
{ "state": "loading", "step": "download", "message": "downloading https://download.gtfs.de/germany/free/latest.zip" }
```

| Field | Values |
| --- | --- |
| `state` | `starting` (the feed has not been looked at yet), `loading`, `error` (the last attempt failed; the next one follows by itself) |
| `step` | with `loading`: `download`, `import` or `routes`; otherwise `null` |
| `message` | English text for operators, the same as in the log |

A client should show its own text for `state` and `step` and try again after
a few seconds.

## `GET /api/status`

The state of the server, meant for monitoring. Always 200. It does not start
the fetching of the realtime feed.

```json
{
  "version": "0.2.0",
  "commit": "479e29cd13b2afc6b2c447e6e7b452f4ccf1beda",
  "homepage": "https://github.com/xiidoz/netnou",
  "update": { "version": "0.3.0", "url": "https://github.com/xiidoz/netnou/releases/tag/v0.3.0" },
  "now": 1791148705,
  "timetable": {
    "state": "ready",
    "step": null,
    "message": "98147 trips, 13489 stations, 53399 routed hops",
    "checkedAt": 1791148692,
    "error": null,
    "feedLastModified": "Sat, 03 Oct 2026 08:30:51 GMT",
    "importedAt": "2026-10-04T16:33:08.002Z",
    "trips": 98147,
    "validFrom": "20261003",
    "validUntil": "20261102"
  },
  "routes": { "segments": 53399, "osmFetchedAt": "2026-10-04T16:34:20.781Z" },
  "realtime": { "polling": true, "fetchedAt": 1791148697, "feedTimestamp": 1791148698, "matchedTrips": 800, "error": null, "fetches": 412, "failures": 3 },
  "area": { "name": "Großraum Nürnberg (VGN)", "bbox": [48.5842, 10.0399, 50.5232, 12.5939] },
  "view": [49.376, 10.916, 49.604, 11.204]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | string | what runs: the number of a release (`0.2.0`), `edge` for a build of the main branch between two releases, or a number with `+dev` for a checkout or an image built by hand |
| `commit` | string or null | the commit an image was built from; `null` for a development build |
| `homepage` | string | where the software comes from, as `package.json` says |
| `update` | object or null | the latest release, if it is newer than what runs: its `version` and the `url` of its notes. `null` if there is none, none is known, or the check is switched off ([Version and updates](configuration.md#version-and-updates)) |
| `now` | time | clock of the server |
| `timetable.state` | string | `starting`, `loading`, `ready` or `error` |
| `timetable.step` | string or null | as in the 503 answer; also set while a newer feed is imported in the background |
| `timetable.message` | string | what the server is doing, or a summary of the loaded timetable |
| `timetable.checkedAt` | time or null | when the feed was last successfully asked for its version |
| `timetable.error` | string or null | why the last update failed. Can be set while `state` is `ready`: the previous timetable stays in use |
| `timetable.feedLastModified` | string or null | `Last-Modified` header of the imported feed |
| `timetable.importedAt` | string or null | when it was imported, ISO 8601 |
| `timetable.trips` | integer | trips in the area |
| `timetable.validFrom`, `validUntil` | service day or null | first and last day the timetable covers |
| `routes.segments` | integer | hops that have route geometry; 0 means straight lines everywhere |
| `routes.osmFetchedAt` | string or null | age of the OpenStreetMap data, ISO 8601 |
| `realtime.polling` | boolean | whether the realtime feed is being fetched right now |
| `realtime.fetchedAt` | time or null | last successful fetch |
| `realtime.feedTimestamp` | time or null | timestamp inside the realtime feed |
| `realtime.matchedTrips` | integer | trip updates that matched a trip of the timetable |
| `realtime.error` | string or null | why the last fetch failed |
| `realtime.fetches`, `realtime.failures` | integer | fetches begun and fetches failed since the server started |
| `area.name`, `area.bbox`, `view` | | as in `/api/area` |

## `GET /api/area`

What a client needs to know about the instance. It does not change while the
server runs and is available while the timetable is still loading.

```json
{
  "name": "Großraum Nürnberg (VGN)",
  "bbox": [48.5842, 10.0399, 50.5232, 12.5939],
  "view": [49.376, 10.916, 49.604, 11.204],
  "outline": [[[49.22, 11.9362], [49.2145, 11.9445], …]],
  "timeZone": "Europe/Berlin",
  "styleUrl": "https://tiles.openfreemap.org/styles/bright",
  "tileUrl": null,
  "attribution": {
    "map": "",
    "data": "<a href=\"https://gtfs.de\">GTFS.DE</a> / <a href=\"https://www.delfi.de\">DELFI e.V.</a> (<a href=\"https://creativecommons.org/licenses/by-sa/4.0/\">CC BY-SA 4.0</a>)"
  }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | name of the area, `""` if it has none |
| `bbox` | box | rectangle around the area |
| `view` | box | map section to show first |
| `outline` | array of rings | the edge of the area, each ring an array of `[latitude, longitude]`. Note the order: the GeoJSON file the area comes from has longitude first |
| `timeZone` | string | IANA name of the zone all times of day are meant in |
| `styleUrl` | string or `null` | URL of the [MapLibre style](https://maplibre.org/maplibre-style-spec/) of the map behind the vehicles; `null` if the instance uses raster tiles |
| `tileUrl` | string or `null` | URL template of raster tiles, with `{z}`, `{x}`, `{y}` and possibly `{s}` and `{r}`; `null` if the instance uses a style |
| `attribution.map`, `attribution.data` | string (HTML) | credits for the map and for the timetable data, to be shown with the map. `map` is empty where the style names its sources itself |

## `GET /api/vehicles`

The vehicles under way right now. Starts the fetching of the realtime feed or
keeps it going.

| Parameter | Meaning |
| --- | --- |
| `bbox` | box; only vehicles currently inside are returned |
| `detail=lite` | the reduced form of [knots](#knots) |

Without a valid `bbox`, all vehicles are returned, always in the reduced
form.

```json
{
  "now": 1791148705,
  "realtime": 1791148698,
  "counts": { "bus": 225, "tram": 17, "subway": 18, "regional": 75, "longdistance": 23, "suburban": 15 },
  "vehicles": [
    {
      "id": "671753_20261004",
      "line": "10",
      "mode": "tram",
      "to": "Dutzendteich",
      "delay": 41,
      "knots": [1791148701.8, 49.45362, 11.0696, 1791148708.8, 49.45331, 11.0695, 1791148720.5, 49.4528, 11.06928, …]
    },
    …
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `now` | time | clock of the server; positions are computed against it, so a client should follow it instead of its own clock |
| `realtime` | time or null | timestamp of the realtime feed in use; `null` means the answer is based on the timetable alone |
| `counts` | object | vehicles per [mode](#modes) in the whole area, whatever the `bbox`; a mode without vehicles is absent |
| `vehicles[].id` | trip id | for `/api/trip` |
| `vehicles[].line` | string | name of the line |
| `vehicles[].mode` | string | see [Modes](#modes) |
| `vehicles[].to` | string | destination |
| `vehicles[].delay` | delay or null | delay at the next stop; `null` if there is no realtime data for the trip |
| `vehicles[].knots` | array of numbers | where the vehicle is from now on, see [Knots](#knots) |

A vehicle appears 30 seconds before it leaves its first stop and disappears
15 seconds after it has reached its last one. The server computes the
vehicles at most once a second.

## `GET /api/stations`

The stations of the area, optionally within `bbox`. A station groups the
platforms of one stop. Does not touch the realtime feed.

```json
[
  { "id": "258216", "name": "Nürnberg Tiergärtnertor", "lat": 49.45812, "lon": 11.07301, "modes": ["tram", "bus"] },
  { "id": "435287", "name": "Nürnberg Hallertor", "lat": 49.45518, "lon": 11.07032, "modes": ["tram", "bus"] },
  …
]
```

The answer is a plain array. `id` is for `/api/departures`; `modes` lists the
modes that call at the station.

## `GET /api/search`

All stations and lines of the area at once, for the search of the page. The
search itself happens in the browser, so the endpoint takes no query: what
somebody types is nothing the server gets to see. Does not touch the
realtime feed.

```json
{
  "stations": {
    "id": ["258216", "435287", …],
    "name": ["Nürnberg Tiergärtnertor", "Nürnberg Hallertor", …],
    "lat": [49.45812, 49.45518, …],
    "lon": [11.07301, 11.07032, …],
    "modes": [["tram", "bus"], ["tram", "bus"], …],
    "service": [1634, 3446, …]
  },
  "lines": {
    "name": ["U1", "33", …],
    "mode": ["subway", "bus", …],
    "agency": ["VerkehrsAG Nürnberg", "Stadtverkehr Fürth", …],
    "to": [["Fürth Hardhöhe", "Langwasser Süd"], ["Fürth Hauptbahnhof", "Flughafen N U E"], …],
    "lat": [49.44428, 49.48582, …],
    "lon": [11.05986, 11.03156, …],
    "service": [1911, 296, …]
  }
}
```

Both are sent as one array per property: the n-th entries of all arrays of
`stations` belong to one station, those of `lines` to one line. That is a
quarter less to transfer than one object for each, about 290 kB compressed
for the default area with its 13,489 stations and 1,506 lines.

The stations are those of `/api/stations`, in the same order.

| Field | Type | Meaning |
| --- | --- | --- |
| `id`, `name`, `lat`, `lon`, `modes` | arrays | as in [`/api/stations`](#get-apistations) |
| `service` | array of integers | how often a trip stops at the station over the whole timetable; a measure of how much is going on there compared with other stations, not a number of departures per day |

A line is the routes of the feed that have the same name, the same mode and
the same agency. The name alone does not say which line it is: agencies
number their lines independently, and a replacement bus runs under the name
of its train. Lines without a stop in the area are left out.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | array of strings | what the line is called, as `line` of a vehicle |
| `mode` | array of strings | one of the [modes](#modes) |
| `agency` | array of strings | who runs it |
| `to` | array of arrays | the one or two destinations most of its trips have; the feed has no other description of a line |
| `lat`, `lon` | arrays of numbers | the middle of its stops inside the area |
| `service` | array of integers | the number of its trips in the whole timetable |

The answer only changes with the timetable. It carries an `ETag`, and a
request with a matching `If-None-Match` is answered with 304.

## `GET /api/line`

The vehicles of one line that are under way.

| Parameter | Meaning |
| --- | --- |
| `name`, `mode`, `agency` | the line, as [`/api/search`](#get-apisearch) lists it; all three are needed |

```json
{
  "now": 1791287110,
  "name": "U1",
  "mode": "subway",
  "agency": "VerkehrsAG Nürnberg",
  "vehicles": [
    { "id": "1441544_20261006", "to": "Eberhardshof", "next": "Nürnberg Plärrer", "delay": null, "lat": 49.44936, "lon": 11.06877 },
    { "id": "1362834_20261006", "to": "Eberhardshof", "next": "Nürnberg Hasenbuck", "delay": null, "lat": 49.42065, "lon": 11.09807 },
    …
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | for `/api/trip` |
| `to` | string | where the vehicle goes |
| `next` | string | the name of the stop ahead of it |
| `delay` | integer or `null` | seconds at that stop; `null` without realtime data |
| `lat`, `lon` | numbers | where it is at `now` |

The vehicles are sorted by destination and, among those with the same one,
by how many stops they have left. A line with no vehicle under way answers
with an empty list; a line that does not exist with 404. Asking keeps the
server fetching the realtime feed, like `/api/vehicles`.

## `GET /api/trip`

One run of a trip: `?id=<trip id>`. Keeps the fetching of the realtime feed
going. 404 `{ "error": "trip not found" }` for a malformed id, an unknown
trip or a day on which the trip does not run.

```json
{
  "now": 1791148705,
  "id": "671753_20261004",
  "line": "10",
  "mode": "tram",
  "to": "Dutzendteich",
  "agency": "VerkehrsAG Nürnberg",
  "realtime": true,
  "source": "VAG Nürnberg",
  "cancelled": false,
  "notes": [],
  "path": [49.49253, 11.05405, 49.49195, 11.0543, 49.49181, 11.05421, …],
  "stops": [
    { "station": "637231", "name": "Nürnberg Am Wegfeld", "platform": "", "lat": 49.492527, "lon": 11.05403,
      "arr": 1791147960, "dep": 1791147960, "arrDelay": null, "depDelay": null, "skipped": false },
    { "station": "56536", "name": "Nürnberg Bamberger Str.", "platform": "", "lat": 49.483826, "lon": 11.059016,
      "arr": 1791148080, "dep": 1791148080, "arrDelay": 41, "depDelay": 41, "skipped": false },
    …
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `line`, `mode`, `to` | | as for a vehicle |
| `agency` | string | operator, from the timetable |
| `realtime` | boolean | whether there is realtime data for this run |
| `source` | string or null | who provides the realtime data of the trip, where the feed says so |
| `cancelled` | boolean | the whole run is cancelled |
| `notes` | array of strings | notes of the feed about the trip, in the language of the feed |
| `path` | array of numbers | the whole route as a flat list `lat, lon, lat, lon, …` |
| `stops[].station` | string | id for `/api/departures` |
| `stops[].name`, `platform` | string | name of the stop; platform, `""` if unknown |
| `stops[].arr`, `dep` | time | arrival and departure according to the timetable |
| `stops[].arrDelay`, `depDelay` | delay or null | reported delays; `null` where nothing is known |
| `stops[].skipped` | boolean | the run does not call here today |

The expected time is the timetable time plus the delay.

## `GET /api/departures`

The departure board of a station: `?station=<station id>`. Keeps the fetching
of the realtime feed going. 404 `{ "error": "station not found" }` for an
unknown id.

```json
{
  "now": 1791148705,
  "id": "184578",
  "name": "Nürnberg Obere Turnstr.",
  "lat": 49.45108,
  "lon": 11.066786,
  "notes": [],
  "departures": [
    { "trip": "21032_20261004", "line": "4", "mode": "tram", "to": "Am Wegfeld", "platform": "", "planned": 1791148680, "delay": 0, "cancelled": false },
    { "trip": "671753_20261004", "line": "10", "mode": "tram", "to": "Dutzendteich", "platform": "", "planned": 1791148740, "delay": 41, "cancelled": false },
    …
  ]
}
```

The board covers the next two hours with at most 40 departures from all
platforms of the station, sorted by expected time (`planned` + `delay`). A
departure stays on the board until 30 seconds after its expected time.
`cancelled` is true when the run is cancelled or skips this station. `notes`
are notes of the feed about the station, such as a lift out of order.

## Knots

The realtime feed has no vehicle positions. The server works out where each
vehicle should be and sends that as knots: a flat array of triples

```text
[time, latitude, longitude, time, latitude, longitude, …]
```

A client finds the two knots around the current server time and interpolates
linearly between them. Two successive knots with the same position mean the
vehicle is standing at a stop.

- **Full form** (with `bbox`, without `detail=lite`): the knots follow the
  route geometry. They start at or before `now` and reach at least 90 seconds
  ahead, or to the end of the trip. A client therefore has to ask again well
  within 90 seconds; the page does so every 10.
- **Reduced form**: exactly two knots, the position now and the position in 60
  seconds. It is meant for zoomed-out views with many vehicles, where the
  route geometry is smaller than a pixel.

`positionAt` in `public/app.js` is a reference implementation.

## Modes

| Id | Meaning |
| --- | --- |
| `subway` | underground (U-Bahn) |
| `tram` | tram |
| `bus` | bus |
| `suburban` | suburban train (S-Bahn) |
| `regional` | regional train |
| `longdistance` | long-distance train |
| `other` | anything else, for example ferries and cable cars |

The mode comes from the GTFS `route_type` of the line. All trains share one
route type, so the three kinds of train are told apart by the name of the
line, see
[Other feeds and other countries](configuration.md#other-feeds-and-other-countries).

## Stability and licence

There is no version in the path. The project follows semantic versioning:
removing or renaming an endpoint or a field counts as a breaking change, and
every change to the API is listed in the [changelog](../CHANGELOG.md).

Netnou is still at version 0.x, where the API is not settled: a breaking
change can come with any new minor version (0.3 to 0.4) and is marked as
breaking in the changelog. Patch versions (0.3.1 to 0.3.2) do not break.

What the API returns is derived from the timetable and realtime feeds and
from OpenStreetMap and stays under their terms; with the default sources
those are CC BY-SA 4.0 and ODbL 1.0
(see [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)).
