# HTTP API

The page talks to the server through nine read-only JSON endpoints. They are
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
- [`GET /api/address`](#get-apiaddress)
- [Knots](#knots)
- [Modes](#modes)
- [Stability and licence](#stability-and-licence)

The examples are taken from an instance with the default settings and are
shortened where marked with `…`.

## Conventions

- Only `GET` and `HEAD`. There is no authentication and there are no CORS
  headers, so a page on another origin cannot call the API from a browser.
- Answers are JSON in UTF-8, compressed with gzip when the client accepts it
  and the body is larger than 1 kB. The list for the search, which is the
  same for everybody, comes with Brotli where the client accepts that.
- Answers carry `Cache-Control: no-store`, except `/api/area` and
  `/api/search`, which have an `ETag` and answer `304` to a matching
  `If-None-Match`.
- Answers carry `X-Robots-Tag: noindex`: search engines may fetch them, as
  the page does, but are asked not to list them.
- **Times** are Unix time in seconds. **Delays** are in seconds, positive when
  late. **Coordinates** are WGS 84 degrees. A **box** is
  `south,west,north,east`.
- A **service day** is a date `yyyymmdd` in the time zone of the feed
  (`NETNOU_TIMEZONE`). As in GTFS, a trip that starts after midnight can belong to
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
answers 503. An instance of all of Germany
([`NETNOU_AREA=Germany`](configuration.md#all-of-germany-and-single-operators))
does not know what it covers until it has a timetable: there `/api/area`
answers 503 as well.

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
  "area": { "name": "Großraum Nürnberg (VGN)", "bbox": [48.5842, 10.0399, 50.5232, 12.5939], "agencies": null },
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
| `timetable.trips` | integer | trips of the instance |
| `timetable.validFrom`, `validUntil` | service day or null | first and last day the timetable covers |
| `routes.segments` | integer | hops that have route geometry; 0 means straight lines everywhere |
| `routes.osmFetchedAt` | string or null | age of the OpenStreetMap data, ISO 8601 |
| `realtime.polling` | boolean | whether the realtime feed is being fetched right now |
| `realtime.fetchedAt` | time or null | last successful fetch |
| `realtime.feedTimestamp` | time or null | timestamp inside the realtime feed |
| `realtime.matchedTrips` | integer | trip updates that matched a trip of the timetable |
| `realtime.error` | string or null | why the last fetch failed |
| `realtime.fetches`, `realtime.failures` | integer | fetches begun and fetches failed since the server started |
| `area.name`, `area.bbox`, `view` | | as in `/api/area`; `bbox` is `null` for an instance of all of Germany until it has a timetable |
| `area.agencies` | array of strings or null | the operators whose trips the instance keeps, as they are set (`NETNOU_AGENCIES`); `null` for all |

## `GET /api/area`

What a client needs to know about the instance. With an area it does not
change while the server runs and is available while the timetable is still
loading. Without one, `bbox` and with it `view` follow the timetable: the
answer is there once a timetable is loaded and may be another with the next.

```json
{
  "siteName": "Netnou",
  "name": "Großraum Nürnberg (VGN)",
  "siteTitle": { "de": null, "en": null },
  "siteDescription": { "de": null, "en": null },
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
| `siteName` | string | what the instance calls itself (`NETNOU_SITE_NAME`); "Netnou" unless the operator chose another name |
| `name` | string | name of the area, `""` if it has none |
| `siteTitle` | object | the operator's own title of the page (`NETNOU_SITE_TITLE`), by the languages of the page: for each a text to be shown as it is, or `null` where they have none and the page words its own |
| `siteDescription` | object | the same for what the page says about itself (`NETNOU_SITE_DESCRIPTION`) |
| `bbox` | box | rectangle around the area; for all of Germany, around all stops of the instance |
| `view` | box | map section to show first |
| `outline` | array of rings | the edge of the area, each ring an array of `[latitude, longitude]`. Note the order: the GeoJSON file the area comes from has longitude first. Empty for all of Germany |
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
| `detail=minimal` | [the smallest form](#the-smallest-form): what a map needs to draw a dot for each vehicle |
| `zoom` | the zoom of the map the answer is for, as MapLibre counts it (the world is 512 px wide at zoom 0): where a screen cannot take every vehicle, the answer is [thinned out](#zoomed-out) |
| `modes` | the [modes](#modes) a map shows, separated by commas: the answer has no others, and where it is thinned out they take no room |
| `line`, `mode`, `agency`, `at` | a line as `/api/line` takes it (`line` for its `name`): its vehicles are in the answer whatever is left out |
| `vehicle` | the id of a vehicle: it is in the answer whatever is left out |

Without a valid `bbox`, all vehicles are returned, always in a reduced
form.

```json
{
  "now": 1791148705,
  "realtime": 1791148698,
  "counts": { "bus": 225, "tram": 17, "subway": 18, "regional": 75, "longdistance": 23, "suburban": 15 },
  "thinned": {},
  "kinds": ["subway", "tram", "bus", "suburban", "regional", "longdistance"],
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
| `counts` | object | vehicles per [mode](#modes) in the whole instance, whatever the `bbox` and the `zoom`; a mode without vehicles is absent |
| `thinned` | object | for each [mode](#modes) of which the answer leaves vehicles out, the share of them it holds, see [Zoomed out](#zoomed-out); empty where nothing is left out |
| `kinds` | array of strings | the [modes](#modes) the timetable has, in the order of that table: a mode of which at least one trip runs. The page shows a filter for each of them and for no other |
| `vehicles[].id` | trip id | for `/api/trip` |
| `vehicles[].line` | string | name of the line |
| `vehicles[].mode` | string | see [Modes](#modes) |
| `vehicles[].to` | string | destination |
| `vehicles[].delay` | delay or null | delay at the next stop; `null` if there is no realtime data for the trip. The portions of a coupled train have the same one on the way they share, whichever of them the feed reports it for |
| `vehicles[].unit` | string | only for a train that runs coupled with others right now: the same value for each of them, and no meaning beyond that. Such trains are a trip each and are at the same place |
| `vehicles[].knots` | array of numbers | where the vehicle is from now on, see [Knots](#knots) |

A vehicle appears 30 seconds before it leaves its first stop and disappears
15 seconds after it has reached its last one. The server computes the
vehicles at most once a second.

### Zoomed out

A large instance has more vehicles than a zoomed-out map can show: the feed
of all of Germany has 35,000 under way on a weekday morning. With `zoom`,
an answer leaves vehicles out where a screen at that zoom cannot take them
all.

- **Nothing is left out while it fits.** The measure is the busiest screen
  of a phone, which may hold 2,500 vehicles: about what an instance for one
  transit network has at its busiest. Such an instance is not thinned out
  at any zoom, and a large one from the zoom at which its busiest place
  fits, for all of Germany from zoom 9. From zoom 12 nothing is left out
  anywhere, and without `zoom` neither.
- **Where it does not fit, the same share of every mode is shown,** picked
  by chance, and the same vehicles from one moment to the next. Where there
  are twice as many buses as trams, the answer has twice as many, and a
  city with ten times the buses of the country around it has ten times as
  many. For all of Germany on a weekday morning the share is 7 % at zoom
  5, 11 % at zoom 6, 25 % at zoom 7 and 47 % at zoom 8.
- **What there is little of stays.** A mode with no more than 125 vehicles
  on a screen, a twentieth of what it may hold, is shown whole, and of a
  larger one at least about as many: three long-distance trains among a
  thousand buses are all there. For all of Germany that is every
  long-distance train from zoom 6 on, and at zoom 5 a quarter of the U-Bahn
  trains beside the 7 % of the buses.
- **A vehicle far from all others is always shown:** the map is cut into
  squares of 32 px, and the first vehicle of a mode in a square is in the
  answer whatever its chance.
- **Only the modes a map shows count.** With `modes` the answer has no
  others, and more of those it has fit: with the buses switched off, the
  room they took goes to the rest.
- **Zooming in adds vehicles and takes none away.** Quarters of a zoom
  count: the share grows from each whole zoom to the next.
- A line or a vehicle that the request names (`line`, `vehicle`) is in the
  answer whatever is left out: what somebody has picked stays on the map.

`thinned` says what share of which modes the answer holds, here for all of
Germany at zoom 7:

```json
"thinned": { "subway": 0.786, "tram": 0.252, "bus": 0.252, "suburban": 0.498, "regional": 0.442 }
```

The shares follow the number of vehicles under way and are worked out again
every minute: at night more is shown of fewer.

### The smallest form

Zoomed out, a map draws a dot for each vehicle, and thousands of them. With
`detail=minimal` an answer has no more than that takes: one column for each
property instead of one object for each vehicle, the two positions of the
reduced form as whole numbers, and not where a vehicle goes. That is about
half the size of the reduced form. The page asks for it while it is zoomed
out on a device without a pointer that could rest on a vehicle and ask where
it goes, and on any device while an answer holds thousands of vehicles.

```json
{
  "now": 1791148705,
  "realtime": 1791148698,
  "counts": { "bus": 29415, "regional": 1639, "longdistance": 201, "suburban": 781, "subway": 625, "tram": 1846 },
  "thinned": { "subway": 0.259, "tram": 0.088, "bus": 0.067, "suburban": 0.219, "regional": 0.102, "longdistance": 0.718 },
  "kinds": ["subway", "tram", "bus", "suburban", "regional", "longdistance", "ferry", "cable"],
  "ahead": 60,
  "vehicles": {
    "id": ["2713340_20261013", "1503271_20261013", …],
    "line": ["RE 19", "ICE 29", …],
    "mode": ["regional", "longdistance", …],
    "delay": [null, 120, …],
    "unit": [null, null, …],
    "at": [4945362, 1106960, -31, 12, 5212044, 1338517, 208, -377, …]
  }
}
```

`now`, `realtime`, `counts` and `thinned` are as in the other forms.

| Field | Type | Meaning |
| --- | --- | --- |
| `ahead` | seconds | how far ahead the second position of each vehicle is |
| `vehicles.id`, `line`, `mode`, `delay` | arrays | as in the other forms, one entry for each vehicle |
| `vehicles.unit` | array | as in the other forms; `null` for a vehicle that is on its own |
| `vehicles.at` | array of whole numbers | four for each vehicle: its latitude and longitude now in 1e-5 degrees, and how far north and east of there it is `ahead` seconds on. The two knots of the reduced form are made of them |

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
modes that call at the station. Like the ids of trips, those of stations
change when the feed is republished.

## `GET /api/search`

All stations and lines of the area at once, for the search of the page. The
search itself happens in the browser, so the endpoint takes no query: what
somebody types is nothing the server gets to see. Does not touch the
realtime feed.

```json
{
  "modes": ["subway", "tram", "bus", "suburban", "regional", "longdistance", "ferry", "cable", "other"],
  "stations": {
    "names": "Harra, Sportplatz\nProbstzella, Bahnhof\nProbstzella\n…",
    "lat": [5041383, 11499, -55, …],
    "lon": [1168584, -30253, 47, …],
    "modes": [4, 4, 16, …],
    "service": [15, 49, 54, …],
    "town": [-1, -1, -1, …, 0, 0, 1, …],
    "towns": ["Ludwigsstadt", "Steinbach am Wald", …],
    "districts": ["", "", …]
  },
  "lines": {
    "name": ["750 Anrufsammeltaxi Wüstenbruck", "750 Rufbus Wüstenbruck - AN Bf.", …],
    "mode": [2, 2, …],
    "agencies": ["Ansbacher Bäder und Verkehrs GmbH", "Arverio Bayern GmbH", …],
    "agency": [0, 0, …],
    "to": [["Ansbach Wüstenbruck", "Ansbach Bahnhof"], ["Ansbach Bahnhof", "Ansbach Wüstenbruck"], …],
    "lat": [4928809, 190, …],
    "lon": [1055474, -377, …],
    "service": [46, 54, …]
  }
}
```

Every visitor who searches loads this list, and for a whole country it is a
quarter of a million stations, so it is written to be small: one column for
each property, in which the n-th entries belong to one station or one line,
and numbers in place of what repeats. Compressed it is about 200 kB for the
default area with its 13,412 stations and 1,500 lines, and about 3 MB for
all of Germany.

`modes` names the [modes](#modes) once; a mode is its number in that list.

The stations:

| Field | Type | Meaning |
| --- | --- | --- |
| `names` | string | the names of all stations, one on each line |
| `lat`, `lon` | arrays of whole numbers | where a station is, in 1e-5 degrees, as the difference from the station before it; the first is as it is |
| `modes` | array of whole numbers | the modes that call at the station: the bit with the number of a mode is set if it does, so `6` is tram and bus |
| `service` | array of whole numbers | how often a trip stops at the station over the whole timetable; a measure of how much is going on there compared with other stations, not a number of departures per day |
| `town` | array of whole numbers | the town the station is in, as the number of it in `towns`; `-1` where none is known |
| `towns` | array of strings | the towns that have a station, each once; towns of one name are towns apart, unless they are in one district |
| `districts` | array of strings | for each town of `towns` the name of its district, where another town of the list has the name too; `""` for all others |

The stations are in an order in which each is near the one before it, which
keeps the differences small; it is not the order of `/api/stations`. They
have no ids. The departures of a station of this list are asked for by its
place, [`/api/departures?at=`](#get-apidepartures), and so every station has
a place of its own: where the feed has several at one place, all but one are
listed a metre further east each.

A town is the municipality whose border in OpenStreetMap is around the
station, under the name it has there. The feed does not name towns, so they
are known as far as the [OpenStreetMap extracts](configuration.md#settings)
of the instance reach: a station beyond them has none, and an instance
without extracts has an empty `towns`. The page finds a station by its town
as well as by its name and shows the town where the name does not say it.
It finds the towns themselves too, and shows one with all its stations in
view. The district of a town is the area of the next level of borders
around it, `admin_level` 6 in Germany: what tells apart the Neuenkirchen of
Kreis Steinfurt from that of Landkreis Osnabrück.

A line is the routes of the feed that have the same name, the same mode and
the same agency. The name alone does not say which line it is: agencies
number their lines independently, and a replacement bus runs under the name
of its train. Lines without a stop in the area are left out.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | array of strings | what the line is called, as `line` of a vehicle |
| `mode` | array of whole numbers | its mode, as the number of it in `modes` |
| `agencies` | array of strings | all who run lines, each once |
| `agency` | array of whole numbers | who runs the line, as the number of it in `agencies` |
| `to` | array of arrays | the one or two destinations most of its trips have; the feed has no other description of a line |
| `lat`, `lon` | arrays of whole numbers | the middle of its stops inside the area, written as the places of the stations are |
| `service` | array of whole numbers | the number of its trips in the whole timetable |

The answer only changes with the timetable. It carries an `ETag`, and a
request with a matching `If-None-Match` is answered with 304.

## `GET /api/line`

The vehicles of one line that are under way.

| Parameter | Meaning |
| --- | --- |
| `name`, `mode`, `agency` | the line, as [`/api/search`](#get-apisearch) lists it; all three are needed |
| `at` | `lat,lon`: of the lines of that name, mode and operator in places apart, the one whose place (`at` of the answer) is nearest; without it the busiest |
| `route` | `1`: with `route`, where the line runs today (below) |
| `open` | `1`: the page's first request for a line it opens, which counts as a visit of its address where [visits are counted](configuration.md#counting-visits) |

```json
{
  "now": 1791287110,
  "name": "U1",
  "mode": "subway",
  "agency": "VerkehrsAG Nürnberg",
  "at": [49.44391, 11.0599],
  "path": "line/verkehrsag-nuernberg/subway/u1",
  "vehicles": [
    { "id": "1441544_20261006", "to": "Eberhardshof", "next": "Nürnberg Plärrer", "delay": null, "lat": 49.44936, "lon": 11.06877, "warnings": [] },
    { "id": "1362834_20261006", "to": "Eberhardshof", "next": "Nürnberg Hasenbuck", "delay": null, "lat": 49.42065, "lon": 11.09807, "warnings": [] },
    …
  ]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `at` | `[lat, lon]` | the place of the line, the middle of its stations: what asks for it among those of its name |
| `path` | string | its address, see [`/api/address`](#get-apiaddress) |
| `vehicles[].id` | string | for `/api/trip` |
| `vehicles[].to` | string | where the vehicle goes |
| `vehicles[].next` | string | the name of the stop ahead of it |
| `vehicles[].delay` | integer or `null` | seconds at that stop; `null` without realtime data |
| `vehicles[].lat`, `lon` | numbers | where it is at `now` |
| `vehicles[].warnings` | array of notes | those of the notes of its trip that warn, as [`/api/departures`](#get-apidepartures) has them; empty for most |

The vehicles are sorted by destination and, among those with the same one,
by how many stops they have left. A line with no vehicle under way answers
with an empty list; a line that does not exist with 404. Asking keeps the
server fetching the realtime feed, like `/api/vehicles`.

With `route=1` the answer also says where the line runs: the routes of its
trips of the day, each stretch between two stops once. The page asks for it
once, when it opens the line, and draws it under the vehicles.

```json
"route": {
  "paths": [[49.48016, 10.98173, 49.47998, 10.98252, …], …],
  "stations": [49.48029, 10.98143, 49.47765, 10.98859, …],
  "bounds": [49.3985, 10.95678, 49.4824, 11.14132]
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `paths` | array of arrays of numbers | lines `lat, lon, lat, lon, …`: one goes on as long as the stretches of a trip are new, so branches and the ways of some trips are lines of their own |
| `stations` | array of numbers | the places of the stations the trips call at, `lat, lon, …` |
| `bounds` | array of numbers or `null` | `[south, west, north, east]` around those of the stations in the area, or around all where none is in it: what to show of the line |

For a line none of whose trips runs today, `paths` and `stations` are empty
and `bounds` is `null`.

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
  "lineAt": [49.45347, 11.07805],
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
| `lineAt` | `[lat, lon]` | the place of its line: `at` for [`/api/line`](#get-apiline), which tells it from lines of its name in places apart |
| `realtime` | boolean | whether there is realtime data for this run |
| `source` | string or null | who provides the realtime data of the trip, where the feed says so |
| `cancelled` | boolean | the whole run is cancelled |
| `notes` | array of objects | notes of the feed about the trip, in the language of the feed, see below |
| `path` | array of numbers | the whole route as a flat list `lat, lon, lat, lon, …` |
| `stops[].station` | string | id for `/api/departures` |
| `stops[].name`, `platform` | string | name of the stop; platform, `""` if unknown |
| `stops[].arr`, `dep` | time | arrival and departure according to the timetable |
| `stops[].arrDelay`, `depDelay` | delay or null | reported delays; `null` where nothing is known. Where the trip runs coupled with others, the delays all of them share (see `unit` of [`/api/vehicles`](#get-apivehicles)) |
| `stops[].skipped` | boolean | the run does not call here today |

The expected time is the timetable time plus the delay.

A note is what an alert of the realtime feed says:

```json
{ "title": "Stuttgart-Degerloch: Haltestelle Peregrinastraße stadteinwärts entfällt",
  "text": "Noch bis voraussichtlich Sonntag, 18. Oktober 2026, wird die Haltestelle Peregrinastraße …",
  "severity": "info" }
```

| Field | Type | Meaning |
| --- | --- | --- |
| `title` | string or null | the headline the feed gives the alert, in one line; `null` where it has none or it is the same as the text |
| `text` | string | what the alert says, in full: it can be a word (`"Niederflur"`) or several pages, with line breaks (`\n`) between its lines and paragraphs |
| `severity` | string or null | how serious the feed says the alert is: `"info"`, `"warning"` or `"severe"`; `null` where it does not say |

Notes that warn come first, the severe ones before the others; the rest
follows in the order of the feed. With the feed of gtfs.de a warning is what
is wrong with a trip right now, such as the reason for a delay; what a
vehicle offers and what an operator announces is information.

## `GET /api/departures`

The departure board of a station. Keeps the fetching of the realtime feed
going.

| Parameter | Meaning |
| --- | --- |
| `station` | the id of the station, as [`/api/stations`](#get-apistations) and the stops of [a trip](#get-apitrip) have it |
| `at` | in place of the id, where the station is: `latitude,longitude` as [`/api/search`](#get-apisearch) lists it, in degrees, for example `at=49.44561,11.08299`. It is the station at that very place, not the nearest one |
| `open` | `1`: the page's first request for a stop it opens, which counts as a visit of its address where [visits are counted](configuration.md#counting-visits) |

404 `{ "error": "station not found" }` for an unknown id and for a place
without a station.

```json
{
  "now": 1791148705,
  "id": "184578",
  "name": "Nürnberg Obere Turnstr.",
  "lat": 49.45108,
  "lon": 11.066786,
  "notes": [],
  "departures": [
    { "trip": "21032_20261004", "line": "4", "mode": "tram", "to": "Am Wegfeld", "platform": "", "planned": 1791148680, "delay": 0, "cancelled": false, "warnings": [] },
    { "trip": "671753_20261004", "line": "10", "mode": "tram", "to": "Dutzendteich", "platform": "", "planned": 1791148740, "delay": 41, "cancelled": false,
      "warnings": [{ "title": null, "text": "Technische Störung am Zug", "severity": "warning" }] },
    …
  ]
}
```

The board covers the next two hours with at most 40 departures from all
platforms of the station. Where those are fewer than ten, it goes on with
the next ones up to ten, from the next 24 hours: a quiet stop late in the
evening has its first departures of the morning. They are sorted by
expected time (`planned` + `delay`). A
departure stays on the board until 30 seconds after its expected time.
`cancelled` is true when the run is cancelled or skips this station. `notes`
are notes of the feed about the station, such as a lift out of order, each
with a `title`, a `text` and a `severity` as for [a trip](#get-apitrip).
`warnings` of a departure are those of the notes of its trip that warn, the
ones with the `severity` `"warning"` or `"severe"`: what is wrong with it
right now, such as the reason for a delay. For most departures there are
none.

## `GET /api/address`

What the address of a stop or a line names now. The page asks for it when
it is opened at such an address ([Addresses](architecture.md#the-page)):
the ids of a feed change with every timetable, so a stop is named by its
name and its place, and a line by its operator, its kind and its name, and
by its place where lines of that name are in places apart.

| Parameter | Meaning |
| --- | --- |
| `path` | the address from where the instance is: `stop/<name>@<latitude>,<longitude>` or `line/<operator>/<kind>/<name>`, with `@<latitude>,<longitude>` after it where lines of the name are in places apart |

```json
{ "type": "stop", "name": "Nürnberg Plärrer", "lat": 49.44809, "lon": 11.0648, "path": "stop/nuernberg-plaerrer@49.4481,11.0648" }
```

```json
{ "type": "line", "name": "U1", "mode": "subway", "agency": "VerkehrsAG Nürnberg", "at": [49.44391, 11.0599], "path": "line/verkehrsag-nuernberg/subway/u1" }
```

The stop is the one of that name nearest the place, up to 1 km away, else
one of any name within 10 m of it; `lat` and `lon` are its place as
`/api/departures` takes it with `at`. Of lines of a name in places apart
the line is the one whose address it is, else the one nearest the place in
it, and without a place the busiest; `at` is its place as `/api/line`
takes it. `path` is the address of what was
found as it is now, which may differ from the one asked for. A name in an
address is written in small letters, with ä as ae and the words joined by
hyphens; the kind of a line is one of the [modes](#modes). 404
`{ "error": "not found" }` for an address that names nothing.

## Knots

The realtime feed has no vehicle positions. The server works out where each
vehicle should be and sends that as knots: a flat array of triples

```text
[time, latitude, longitude, time, latitude, longitude, …]
```

A client finds the two knots around the current server time and interpolates
linearly between them. Two successive knots with the same position mean the
vehicle is standing at a stop.

- **Full form** (with `bbox`, without `detail`): the knots follow the
  route geometry. They start at or before `now` and reach at least 90 seconds
  ahead, or to the end of the trip. A client therefore has to ask again well
  within 90 seconds; the page does so every 10.
- **Reduced form** (`detail=lite`): exactly two knots, the position now and
  the position in 60 seconds. It is meant for zoomed-out views with many
  vehicles, where the route geometry is smaller than a pixel.
- [The smallest form](#the-smallest-form) (`detail=minimal`) has the same two
  positions, written as whole numbers and not as knots.

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
| `ferry` | ferry |
| `cable` | cable car and monorail: also funiculars, suspension railways such as the one of Wuppertal, and rack railways |
| `other` | anything else |

The mode comes from the GTFS `route_type` of the line. All trains share one
route type, so the three kinds of train are told apart by the name of the
line, see
[Other feeds and other countries](configuration.md#other-feeds-and-other-countries).
Ferries are route type 4, cable cars and monorails 5, 6, 7 and 12 (the feed of
Germany gives all of them the type of a funicular, 7), trolleybuses (11) are
buses, and the extended route types of the same things count likewise.

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
