# Configuration

Netnou is configured with environment variables. All of them are optional:
without any, it shows the VGN (the transit network around Nürnberg) from the
gtfs.de feeds on port 8080.

- [Settings](#settings)
- [Choosing an area](#choosing-an-area)
- [Example: another region in Germany](#example-another-region-in-germany)
- [Realtime polling and traffic](#realtime-polling-and-traffic)
- [Map tiles](#map-tiles)
- [Attribution](#attribution)
- [Other feeds and other countries](#other-feeds-and-other-countries)

## Settings

How to set a variable depends on how you run the server:

```sh
# POSIX shell
PORT=9000 AREA_NAME="My town" npm start
```

```powershell
# PowerShell
$env:PORT = '9000'; $env:AREA_NAME = 'My town'; npm start
```

```yaml
# compose.yaml or compose.override.yaml
services:
  netnou:
    environment:
      PORT: "9000"
      AREA_NAME: "My town"
```

| Variable | Default | Allowed | Meaning |
| --- | --- | --- | --- |
| `PORT` | `8080` | whole number, 0–65535 | HTTP port; `0` lets the system pick one |
| `HOST` | all interfaces | address | address to listen on, e.g. `127.0.0.1` behind a reverse proxy on the same machine |
| `DATA_DIR` | `data` in the project folder (`/data` in the image) | path | where the caches are kept; must be writable |
| `AREA_FILE` | the built-in VGN outline | path | GeoJSON file with the polygons of the area, see [Choosing an area](#choosing-an-area) |
| `BBOX` | – | `south,west,north,east` | a rectangle as the area, instead of `AREA_FILE` |
| `AREA_NAME` | `Großraum Nürnberg (VGN)`; empty for a custom area | text | shown next to the title of the page |
| `VIEW` | Nürnberg, Fürth and Erlangen; the whole area for a custom one | `south,west,north,east` | map section on a visitor's first visit; afterwards the browser remembers the last one |
| `TIMEZONE` | `Europe/Berlin` | IANA time zone | the zone the times of the feed are in; times in the page are shown in it |
| `FEED_URL` | `https://download.gtfs.de/germany/free/latest.zip` | http(s) URL | the GTFS timetable (zip) |
| `FEED_CHECK_MINUTES` | `15` | 1–1440 | how often to look for a new version of the timetable |
| `REALTIME_URL` | `https://realtime.gtfs.de/realtime-free.pb` | http(s) URL | the GTFS-Realtime feed |
| `REALTIME_INTERVAL_SECONDS` | `30` | 10–3600 | how often the realtime feed is fetched while the map is in use |
| `REALTIME_IDLE_SECONDS` | `120` | 30–86400 | fetching stops this long after the last request from a browser |
| `OSM_PBF_URLS` | five Geofabrik extracts of Bavaria; none for a custom area | comma-separated http(s) URLs | OpenStreetMap extracts (`.osm.pbf`) that together cover the area; empty means no route geometry |
| `OSM_MAX_AGE_DAYS` | `30` | 1–3650 | how long the OpenStreetMap data is used before it is downloaded again |
| `DOWNLOAD_TIMEOUT_MINUTES` | `30` | 1–1440 | limit for one download of the timetable or of an extract |
| `TILE_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | http(s) URL template with `{z}`, `{x}`, `{y}` | where browsers load the map tiles from, see [Map tiles](#map-tiles) |
| `TILE_ATTRIBUTION` | `© OpenStreetMap` with a link | HTML | credit shown on the map for the tiles |
| `DATA_ATTRIBUTION` | `GTFS.DE / DELFI e.V. (CC BY-SA 4.0)` with links | HTML | credit shown on the map for the timetable and realtime data |

Rules that apply to all of them:

- An empty value counts as not set. The two exceptions are `AREA_NAME` (empty
  means "no name") and `OSM_PBF_URLS` (empty means "no route geometry", also
  for the built-in area).
- Numbers are plain decimals (`30`, `0.5`); only `PORT` has to be a whole
  number.
- Relative paths in `DATA_DIR` and `AREA_FILE` are resolved against the
  working directory.
- `AREA_FILE` and `BBOX` exclude each other.
- A value that is not acceptable stops the server at start with exit code 1
  and one line that names the variable, for example:

  ```text
  Configuration error: REALTIME_INTERVAL_SECONDS must be a number from 10 to 3600 (got "5")
  ```

## Choosing an area

The area decides two things. A trip is imported if it serves at least one stop
inside the area (or within about a kilometre of it), and only inside the area
do vehicles follow roads and tracks. A trip that leaves the area is still
shown along its whole run, in straight lines between its stops out there.

There are three ways to define it:

- **Nothing set:** the VGN, from `server/areas/vgn.geojson` (the outlines of
  its 11 cities and 23 districts).
- **`BBOX`:** a rectangle, `south,west,north,east` in degrees, for example
  `49.30,10.82,49.68,11.30`. Note the order: latitude first.
- **`AREA_FILE`:** a GeoJSON file. Any mix of `FeatureCollection`, `Feature`,
  `GeometryCollection`, `Polygon` and `MultiPolygon` is read; everything else
  in the file is ignored. Positions are `[longitude, latitude]`, as GeoJSON
  prescribes. Holes in polygons are respected.

The map sets the area off by greying out its surroundings. With an
`AREA_FILE` made of adjacent polygons (districts, say) their inner borders
would show, so the file may carry an extra top-level member `outline`: an
array of rings of `[longitude, latitude]` that is drawn instead. The built-in
file has one; `tools/build-vgn-area.mjs` shows how it is derived.

Changing the area makes the server import the timetable again and rebuild the
route geometry on the next start.

## Example: another region in Germany

A custom area starts without a name, with the whole area as the first view,
and **without OpenStreetMap extracts**, which means straight lines between
stops. A complete setup therefore sets four things:

```sh
BBOX=48.06,11.36,48.25,11.72
AREA_NAME=München
VIEW=48.11,11.50,48.17,11.63
OSM_PBF_URLS=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf
```

1. `BBOX` (or `AREA_FILE`) for the area.
2. `AREA_NAME` for the title.
3. `VIEW` if the first view should be smaller than the whole area.
4. `OSM_PBF_URLS` with one or more extracts from
   [download.geofabrik.de](https://download.geofabrik.de/) that cover the area
   **and about 8 km around it**: routes to stops outside the area follow the
   network a few kilometres beyond its edge. Several extracts are separated by
   commas. Prefer the smallest extracts that do the job; each is downloaded in
   full and read once.

If the extracts do not cover the area, the map keeps using straight lines and
the log says:

```text
Routes: OSM data could not be updated (no roads or tracks found in the area; do the extracts in OSM_PBF_URLS cover it?), keeping straight lines
```

## Realtime polling and traffic

Three intervals are involved, and they are independent:

| Who | Interval | Setting |
| --- | --- | --- |
| The provider republishes the realtime feed | about every 30 s (gtfs.de, observed) | – |
| The server fetches the realtime feed | 30 s | `REALTIME_INTERVAL_SECONDS` |
| The page asks the server for vehicles | 10 s | fixed (`POLL_MS` in `public/app.js`) |

The gtfs.de realtime feed is about 20 MB per fetch and is served
uncompressed, so fetching it around the clock would transfer roughly 60 GB a
day. The server therefore fetches it only while somebody uses the map: the
first request for vehicles, a trip or a departure board starts the fetching,
and it stops `REALTIME_IDLE_SECONDS` after the last such request. A tab in the
background stops asking, and `/api/status` does not count, so monitoring does
not keep the fetching alive.

The timetable itself (about 300 MB) is only downloaded when the provider
publishes a new version, which gtfs.de does once a day. The check every
`FEED_CHECK_MINUTES` is a single `HEAD` request.

## Map tiles

The map background is loaded by the visitor's browser straight from the tile
server in `TILE_URL`. The default is the server of the OpenStreetMap
project, which is run on donated resources and whose
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
allows light use only. For an instance with real traffic, switch to a
commercial provider or your own tile server:

```sh
TILE_URL=https://{s}.tiles.example.org/{z}/{x}/{y}.png
TILE_ATTRIBUTION='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, tiles: Example'
```

`{z}`, `{x}` and `{y}` are required. `{s}`, Leaflet's placeholder for a
subdomain, is allowed in the first label of the host name only. The page's
Content-Security-Policy follows the setting: images may be loaded from the
origin of `TILE_URL` and from nowhere else.

## Attribution

`TILE_ATTRIBUTION` and `DATA_ATTRIBUTION` are shown in the corner of the map,
in this form (the words in between are in the visitor's language):

```text
<TILE_ATTRIBUTION> · Timetable and realtime data, processed: <DATA_ATTRIBUTION>
```

Both values are inserted into the page **as HTML**, so that they can contain
links. Only put text there that you control. If you change the feeds or the
tile provider, change the credit with them; the licences of the default
sources require it to be visible (see
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)).

## Other feeds and other countries

`FEED_URL`, `REALTIME_URL`, `TIMEZONE`, `OSM_PBF_URLS`, `TILE_URL` and the
attribution settings are enough to point Netnou at a mirror of the gtfs.de
feeds or at their paid variants. A feed URL may contain an access key in its
query string: status texts that are publicly visible show URLs without query
string and credentials. A key in the path would be shown.

For feeds of another provider or country, the following has to hold.

What the timetable feed must provide:

- A zip with `stops.txt`, `stop_times.txt`, `trips.txt` and `routes.txt`, and
  `calendar.txt` or `calendar_dates.txt` or both. `agency.txt` is used for
  operator names if present.
- An `ETag` or `Last-Modified` header on the zip. This is how a new version is
  recognised; a server that sends neither is downloaded once and never again.
- The rows of one trip next to each other in `stop_times.txt`. A trip whose
  rows are scattered is only partly recognised.
- All times in one time zone, which you name in `TIMEZONE`.
  `agency_timezone` is not read.

What the realtime feed must provide:

- `TripUpdate` entities with the `trip_id` and `start_date` of the timetable
  and `stop_sequence` in their stop time updates. Vehicle positions are not
  used.
- Alerts are shown for trips and stops; alerts addressed to a whole agency or
  route are not.

What is fixed in the code and written for Germany. Each item names the place
to change:

| Assumption | Where |
| --- | --- |
| Suburban, regional and long-distance trains are told apart by German line names (`S 1`, `ICE 123`, …); only the basic GTFS route types 0–3 are known, everything else is "other" and gets no route geometry | `routeMode` in `server/lib/timetable.js` |
| Of an alert in several languages the German text is shown | `server/lib/pb.js` |
| The operator behind the realtime data is recognised from the note gtfs.de attaches to each trip | `SOURCE_NOTE` in `server/lib/realtime.js` |
| The grid that describes the area has cells of about 1.1 km at 49–50° north; far from that latitude the cells and all "about a kilometre" distances are stretched or squeezed east–west | `CELL_LON` in `server/lib/area.js` |
| A feed's own `shapes.txt` is not used; route geometry always comes from OpenStreetMap | `server/lib/shapes.js` |
| The labels "U-Bahn" and "S-Bahn" in the English texts | `public/locales/en.js` |
| The departure board covers two hours and 40 entries | `departures` in `server/lib/timetable.js` |

The user interface language is independent of all this, see
[translating.md](translating.md).
