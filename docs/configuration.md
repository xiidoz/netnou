# Configuration

Netnou is configured with environment variables. All of them are optional:
without any, it shows the VGN (the transit network around Nürnberg) from the
gtfs.de feeds on port 8080. `NETNOU_AREA=Germany` alone shows all of Germany.

- [Settings](#settings)
- [Choosing an area](#choosing-an-area)
- [All of Germany, and single operators](#all-of-germany-and-single-operators)
- [Example: another region in Germany](#example-another-region-in-germany)
- [Realtime polling and traffic](#realtime-polling-and-traffic)
- [The map](#the-map)
- [Attribution](#attribution)
- [Version and updates](#version-and-updates)
- [Other feeds and other countries](#other-feeds-and-other-countries)

## Settings

How to set a variable depends on how you run the server:

```sh
# POSIX shell
NETNOU_PORT=9000 NETNOU_AREA_NAME="My town" npm start
```

```powershell
# PowerShell
$env:NETNOU_PORT = '9000'; $env:NETNOU_AREA_NAME = 'My town'; npm start
```

```yaml
# compose.yaml or compose.override.yaml
services:
  netnou:
    environment:
      NETNOU_AREA_NAME: "My town"
      NETNOU_REALTIME_INTERVAL_SECONDS: "30"
```

Every setting begins with `NETNOU_`, so that it is plain whose it is among
the variables of a host or a stack. A variable of another name is not read.

In `compose.yaml` the port has two names. `NETNOU_PORT` is the setting: the
port the server listens on inside the container. `PORT` is no setting of the
server but a variable of that file: the port the host publishes.

```yaml
    ports:
      - "${PORT:-8080}:${NETNOU_PORT:-8080}"
```

Both are 8080 unless they are set where Compose reads its variables: in a
file `.env` next to `compose.yaml`, in the shell, or among the values of a
stack. A platform that sets `PORT` and expects the server to listen there
needs `NETNOU_PORT` set to the same number.

| Variable | Default | Allowed | Meaning |
| --- | --- | --- | --- |
| `NETNOU_PORT` | `8080` | whole number, 0–65535 | HTTP port; `0` lets the system pick one |
| `NETNOU_HOST` | all interfaces | address | address to listen on, e.g. `127.0.0.1` behind a reverse proxy on the same machine |
| `NETNOU_DATA_DIR` | `data` in the project folder (`/data` in the image) | path | where the caches are kept; must be writable |
| `NETNOU_AREA_FILE` | the built-in VGN outline | path | GeoJSON file with the polygons of the area, see [Choosing an area](#choosing-an-area) |
| `NETNOU_BBOX` | – | `south,west,north,east` | a rectangle as the area, instead of `NETNOU_AREA_FILE` |
| `NETNOU_AREA` | `VGN` | `VGN`, `Germany` | a built-in area, with its name, first view and OpenStreetMap extracts: the VGN, or all of Germany, which is everything the feed has, see [All of Germany, and single operators](#all-of-germany-and-single-operators) |
| `NETNOU_AGENCIES` | all operators | names separated by commas, or a JSON array | only the trips of these operators, named as `agency.txt` of the feed names them |
| `NETNOU_SITE_NAME` | `Netnou` | text | what the instance calls itself: in the heading and the title of the page, in previews of links and as the installed app. The credits on the map name Netnou and its version whatever is set here |
| `NETNOU_SITE_TITLE` | the page's own, in each of its languages | text, or texts by language | the title of the page as the tab of a browser and a search result show it, in words of your own, see [Being found](#being-found) |
| `NETNOU_SITE_DESCRIPTION` | the page's own, in each of its languages | text, or texts by language | what the page says about itself in a search result and in a preview of a link, in words of your own |
| `NETNOU_AREA_NAME` | `Großraum Nürnberg (VGN)`, for Germany `Deutschland`; empty for a custom area | text | shown next to the title of the page, and what search engines find the instance by, see [Being found](#being-found) |
| `NETNOU_BRAND_DIR` | – (`/brand` in the image) | path | a folder with icons and a preview picture of your own, see [Icons of your own](#icons-of-your-own) |
| `NETNOU_LINKS` | – | `Text=address`, separated by commas | links of the operator at the foot of the header card, see [Links of your own](#links-of-your-own) |
| `NETNOU_LANGUAGE` | `de` | a language of the page: `de`, `en` | the main language of the instance: the page is sent in it to whoever asks without naming a language, as search engines do. Visitors get the language of their browser, see [Being found](#being-found) |
| `NETNOU_PUBLIC_URL` | – | http(s) URL | the address under which visitors reach the instance, e.g. `https://transit.example.org/`, see [Being found](#being-found) |
| `NETNOU_SEARCH_ENGINES` | `on` if `NETNOU_PUBLIC_URL` is set, otherwise `off` | `on` or `off` | whether search engines may list the instance, see [Being found](#being-found) |
| `NETNOU_VIEW` | Nürnberg, Fürth and Erlangen, for Germany the whole country; the whole area for a custom one | `south,west,north,east` | map section on a visitor's first visit; afterwards the browser remembers the last one |
| `NETNOU_TIMEZONE` | `Europe/Berlin` | IANA time zone | the zone the times of the feed are in; times in the page are shown in it |
| `NETNOU_FEED_URL` | `https://download.gtfs.de/germany/free/latest.zip` | http(s) URL | the GTFS timetable (zip) |
| `NETNOU_FEED_CHECK_MINUTES` | `15` | 1–1440 | how often to look for a new version of the timetable |
| `NETNOU_REALTIME_URL` | `https://realtime.gtfs.de/realtime-free.pb` | http(s) URL | the GTFS-Realtime feed |
| `NETNOU_REALTIME_INTERVAL_SECONDS` | `60` | 10–3600 | how often the realtime feed is fetched while the map is in use |
| `NETNOU_REALTIME_IDLE_SECONDS` | `120` | 30–86400 | fetching stops this long after the last request from a browser |
| `NETNOU_OSM_PBF_URLS` | five Geofabrik extracts of Bavaria, for Germany the extract of Germany; none for a custom area | comma-separated http(s) URLs | OpenStreetMap extracts (`.osm.pbf`) that together cover the area: the roads and tracks for the route geometry, and the borders of the towns the search finds a stop by; empty means neither |
| `NETNOU_OSM_MAX_AGE_DAYS` | `30` | 1–3650 | how long the OpenStreetMap data is used before it is downloaded again |
| `NETNOU_DOWNLOAD_TIMEOUT_MINUTES` | `30` | 1–1440 | limit for one download of the timetable or of an extract |
| `NETNOU_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/bright` | http(s) URL | the style of the map behind the vehicles, see [The map](#the-map) |
| `NETNOU_MAP_ORIGINS` | – | comma-separated http(s) URLs | further servers the map is loaded from, if the style does not take everything from its own |
| `NETNOU_TILE_URL` | – | http(s) URL template with `{z}`, `{x}`, `{y}` | raster tiles as the map, instead of `NETNOU_MAP_STYLE_URL` |
| `NETNOU_TILE_ATTRIBUTION` | `© OpenStreetMap` with a link if `NETNOU_TILE_URL` is set, otherwise nothing | HTML | credit shown for the map, besides what a style names itself |
| `NETNOU_UPDATE_CHECK` | `on` | `on` or `off` | whether the server asks GitHub once a day for a newer release, see [Version and updates](#version-and-updates) |
| `NETNOU_DATA_ATTRIBUTION` | `GTFS.DE / DELFI e.V. (CC BY-SA 4.0)` with links | HTML | credit shown on the map for the timetable and realtime data |
| `NETNOU_VISITS_URL` | – | http(s) URL, with placeholders in the values of its query | where the server reports each visit of the page; nothing is reported without it, see [Counting visits](#counting-visits) |
| `NETNOU_VISITS_BODY` | – | JSON, with placeholders in its texts | what the report carries; with it the report is a `POST` of JSON, without it a `GET` |
| `NETNOU_VISITS_HEADERS` | – | JSON object of header names and texts, with placeholders | headers of the report, e.g. a key |

Rules that apply to all of them:

- An empty value counts as not set. The two exceptions are `NETNOU_AREA_NAME` (empty
  means "no name") and `NETNOU_OSM_PBF_URLS` (empty means "no route geometry and no
  towns", also for a built-in area).
- Numbers are plain decimals (`30`, `0.5`); only `NETNOU_PORT` has to be a whole
  number.
- Relative paths in `NETNOU_DATA_DIR` and `NETNOU_AREA_FILE` are resolved against the
  working directory.
- `NETNOU_AREA_FILE`, `NETNOU_BBOX` and `NETNOU_AREA` exclude each other.
- A value that is not acceptable stops the server at start with exit code 1
  and one line that names the variable, for example:

  ```text
  Configuration error: NETNOU_REALTIME_INTERVAL_SECONDS must be a number from 10 to 3600 (got "5")
  ```

## Choosing an area

The area decides two things. A trip is imported if it serves at least one stop
inside the area (or within about a kilometre of it), and only inside the area
do vehicles follow roads and tracks. A trip that leaves the area is still
shown along its whole run, in straight lines between its stops out there.

There are four ways to define it:

- **Nothing set,** or `NETNOU_AREA=VGN`: the VGN, from
  `server/areas/vgn.geojson` (the outlines of its 11 cities and 23 districts).
- **`NETNOU_AREA=Germany`:** all of Germany. It has no outline: every trip of
  the feed is imported, see
  [All of Germany, and single operators](#all-of-germany-and-single-operators).
- **`NETNOU_BBOX`:** a rectangle, `south,west,north,east` in degrees, for example
  `49.30,10.82,49.68,11.30`. Note the order: latitude first.
- **`NETNOU_AREA_FILE`:** a GeoJSON file. Any mix of `FeatureCollection`, `Feature`,
  `GeometryCollection`, `Polygon` and `MultiPolygon` is read; everything else
  in the file is ignored. Positions are `[longitude, latitude]`, as GeoJSON
  prescribes. Holes in polygons are respected.

The map sets the area off by greying out its surroundings. With an
`NETNOU_AREA_FILE` made of adjacent polygons (districts, say) their inner borders
would show, so the file may carry an extra top-level member `outline`: an
array of rings of `[longitude, latitude]` that is drawn instead. The built-in
file has one; `tools/build-vgn-area.mjs` shows how it is derived.

Changing the area makes the server import the timetable again and rebuild the
route geometry on the next start.

## All of Germany, and single operators

Germany is an area without an outline, and an instance need not show every
operator. There are two limits, each optional, and a trip has to pass both:

| Instance | Area | Operators |
| --- | --- | --- |
| A transit network | its outline (the VGN is built in) | all |
| A state | its outline, as `NETNOU_AREA_FILE` | all |
| All of Germany | `NETNOU_AREA=Germany` | all |
| One operator, wherever it runs | `NETNOU_AREA=Germany` | `NETNOU_AGENCIES` |
| One operator in a network | the outline of the network | `NETNOU_AGENCIES` |

- **`NETNOU_AREA=Germany`** takes every trip of the feed, which is the feed
  of Germany unless `NETNOU_FEED_URL` names another. There is then nothing
  that would be outside: every stop is listed, has a departure board and is
  found by the search, and no edge is drawn on the map. It is called
  `Deutschland`, shows the whole country on a first visit
  (`47.27,5.87,55.06,15.04`) and takes its roads, tracks and towns from the
  extract of Germany, `https://download.geofabrik.de/europe/germany-latest.osm.pbf`;
  `NETNOU_AREA_NAME`, `NETNOU_VIEW` and `NETNOU_OSM_PBF_URLS` set each of
  them otherwise.
- **`NETNOU_AGENCIES`** keeps the trips of the operators named and drops all
  others. The names are those of `agency.txt` in the feed (`agency_name`),
  taken without regard to capitals and to spaces at their ends:

  ```sh
  NETNOU_AGENCIES="VerkehrsAG Nürnberg, infra fürth verkehr gmbh"
  # a name with a comma in it needs the list as a JSON array
  NETNOU_AGENCIES='["Stadtwerke, Verkehr", "VerkehrsAG Nürnberg"]'
  ```

  A name the feed does not have ends the import with an error that names it
  and what the feed has that is like it; `/api/status` shows the error.
- **Both limits count.** With `NETNOU_AGENCIES` and nothing else, the area is
  still the built-in VGN: an operator from elsewhere then has no trips, and
  the error says so. Give it its own area, or `NETNOU_AREA=Germany`.

Without an outline the instance still needs to know where its vehicles
follow roads and tracks and which OpenStreetMap data to keep. It takes that
from its trips: where their stops are, and the straight lines from each stop
to the next. That is its extent. Extracts of your own in
`NETNOU_OSM_PBF_URLS` have to cover it. The OpenStreetMap data kept for one
timetable is used for the next as long as that one stays within it, so a new
timetable alone does not fetch the extracts again.

The extract of Germany is 4.9 GB, about seven minutes to download at
100 Mbit/s, and its roads are routed in tiles
([architecture.md](architecture.md#route-geometry)). After the download the
first import takes about ten minutes and at most 3.3 GB of memory, and so does
one with new OpenStreetMap data, which is downloaded every 30 days
(`NETNOU_OSM_MAX_AGE_DAYS`); the data directory needs 6 GB while the extract
is read, 1.1 GB afterwards. A new timetable on the same data keeps the routes
it can and routes only the hops that are new: with nearly all of them kept it
is imported in about a minute.

Changing the area or the operators makes the server import the timetable
again on the next start.

## Example: another region in Germany

A custom area starts without a name, with the whole area as the first view,
and **without OpenStreetMap extracts**, which means straight lines between
stops. A complete setup therefore sets four things:

```sh
NETNOU_BBOX=48.06,11.36,48.25,11.72
NETNOU_AREA_NAME=München
NETNOU_VIEW=48.11,11.50,48.17,11.63
NETNOU_OSM_PBF_URLS=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf
```

1. `NETNOU_BBOX` (or `NETNOU_AREA_FILE`) for the area.
2. `NETNOU_AREA_NAME` for the title.
3. `NETNOU_VIEW` if the first view should be smaller than the whole area.
4. `NETNOU_OSM_PBF_URLS` with one or more extracts from
   [download.geofabrik.de](https://download.geofabrik.de/) that cover the area
   **and about 8 km around it**: routes to stops outside the area follow the
   network a few kilometres beyond its edge. Several extracts are separated by
   commas. Prefer the smallest extracts that do the job; each is downloaded in
   full and read once. The extracts also say which town a stop is in, by the
   borders of the municipalities in them, and so which towns the search
   finds: a stop beyond them is found by its name alone.

If the extracts do not cover the area, the map keeps using straight lines and
the log says:

```text
Routes: OSM data could not be updated (no roads or tracks found in the area; do the extracts in NETNOU_OSM_PBF_URLS cover it?), keeping straight lines
```

## Being found

What a search engine reads, and what a chat shows of a link, is the page as
the server sends it, before any script has run. The server therefore writes
into it what the instance is:

- **`NETNOU_SITE_NAME`** is what the instance is called, if it is to be called
  something else than "Netnou": a service for the people of a region may
  want a name in their language. It stands in the heading and at the end of
  the title.
- **`NETNOU_AREA_NAME`** goes into the title, the description and the heading of
  the page. It is what people look for, so name the area as they would:
  "Großraum Nürnberg (VGN)" rather than "Area 1".
- **`NETNOU_SITE_TITLE`** and **`NETNOU_SITE_DESCRIPTION`** put words of your own in the
  place of the title and the description: the line a search result is
  headed by and the lines below it, and what a preview of a link says. The
  page has both in each of its languages, made of what it is and the names
  above: "ÖPNV-Live-Karte: Großraum Nürnberg (VGN) – Netnou". Yours are
  shown as they are. There are three ways to give them, here for the title:

  ```sh
  # one text, for every language
  NETNOU_SITE_TITLE="Bus & Bahn live – die Karte für den Großraum Nürnberg"
  # texts by language, as a JSON object
  NETNOU_SITE_TITLE='{"de": "Bus & Bahn live – die Karte", "en": "Buses and trains live – the map"}'
  # a setting for one language alone, with the language at its end
  NETNOU_SITE_TITLE_EN="Buses and trains live – the map"
  ```

  For each language the setting of its own counts first, then the object,
  then the one text; a language that is given none keeps the page's own
  words. A search engine shows about 60 characters of a title and 150 of a
  description. Title and description can be set without each other.
- **`NETNOU_LANGUAGE`** is the language these texts are in for whoever asks
  without naming a language: search engines, as a rule. A browser names the
  languages of its user with every request, and gets the page in the first
  of them the page has, in English if it has none of them. A preview of a
  link is in the main language where the service that fetches the page for
  it names no language, and in the one it names where it does.
- **`NETNOU_PUBLIC_URL`** is the address of the instance as visitors type it, with
  the path if it lives under one (`https://example.org/netnou/`). With it
  the page names its canonical address, its versions in the other languages
  and the picture for previews of links, and the server answers
  `/sitemap.xml`, with the addresses of all the stops and lines of the
  timetable. Without it all of that is left out, because each needs a
  full address; the texts are there all the same.

The page chooses its language in the browser, and the browser of a search
engine speaks English. So there is an address per language, `?lang=de`,
which shows the page in that language to whoever has not chosen one in the
page themselves. The page names these addresses as its versions in other
languages, and the sitemap lists them. At the plain address a search engine
therefore gets to read the title and the description for English, whatever
`NETNOU_LANGUAGE` is: yours for English, else yours for every language, else the
page's own.

Whether search engines may list the instance at all is `NETNOU_SEARCH_ENGINES`.
If nothing is set, an instance that knows its address is listed and any
other is not: most instances are private or for trying things out, and one
that is reachable under several names cannot say which of them it is. Set
`NETNOU_SEARCH_ENGINES=off` for an instance that has an address and is not meant
to be found, such as a test instance next to the real one; without it the
two compete in the results, with the same content. An instance that is not
listed asks for that with every answer (`X-Robots-Tag: noindex`) and in
the page, has no sitemap, and leaves out what is in the page for search
engines alone. A link to it still shows a preview.

`/robots.txt` lets search engines read everything, also on an instance that
is not listed: one that may not read a page never sees that it is asked not
to list it. Where there is a sitemap, `/robots.txt` names it.
The answers of the API tell them not to list data as pages
(`X-Robots-Tag: noindex`). The API is deliberately not closed to them: a
search engine that runs the page asks for data as a browser does, and a page
it cannot load data for tells it that there is no connection. The price is
that such a visit keeps the realtime feed being fetched for a while, like
any other (see [Realtime polling and traffic](#realtime-polling-and-traffic)).
An instance under a path has no say in the `robots.txt` of its host: that
one is read at the root of the host only.

## Icons of your own

An instance with a name of its own (`NETNOU_SITE_NAME`) can have its own icons
too. Put them into a folder outside the repository and tell the server where
it is with `NETNOU_BRAND_DIR`. In the container the folder is `/brand`, so
mounting one there is all it takes:

```yaml
    volumes:
      - "./brand:/brand:ro"
```

A file in the folder takes the place of the built-in one of the same name:

| File | What it is | Size |
| --- | --- | --- |
| `favicon.svg` | the icon in the tab of the browser | any, it is a drawing |
| `icon-192.png` | the icon of the installed app | 192 × 192 |
| `icon-512.png` | the same, large; also the picture of a link's preview if there is no other | 512 × 512 |
| `icon-maskable-512.png` | the icon for home screens that cut it to their own shape: the drawing in the middle, with room around it | 512 × 512 |
| `apple-touch-icon.png` | the icon on the home screen of Apple devices | 180 × 180 |
| `preview.png` or `preview.jpg` | the picture a link to the instance shows in a chat or on social media, shown large; needs `NETNOU_PUBLIC_URL` | 1200 × 630 |

Any of them may be missing; the built-in one is used then, and without a
preview picture a link shows the icon.

Keep the preview picture small as a file, 300 kB at most: a chat fetches it
for every preview, and some show a larger file small or not at all. A
screenshot of the map is several times smaller as a JPEG than as a PNG. The
page tells previews how large the picture is; the server reads that from the
file. No other file of the page can be
replaced this way. The server looks into the folder when it starts and names
what it found in its log, so restart it after changing the files. Browsers
and chats keep icons and previews for a long time; a change may take a
while to show.

The colours of the page are not yours to set: they stay as they are.

## Links of your own

Who runs the instance, how it treats personal data, what it is about, how to
support it: these are the operator's to say, on pages of the operator's own.
`NETNOU_LINKS` puts links to them at the foot of the header card, where they are in
view without opening anything, on a phone as well.

```sh
NETNOU_LINKS="Über=/ueber, Impressum=/impressum, Datenschutz=https://example.org/datenschutz"
```

- Each link is a text, an equals sign and an address; links are separated
  by commas. So neither a text nor an address can contain a comma.
- An address is a full `http(s)` address, or a path on the same host that
  starts with a slash. The second is for pages that live next to the
  instance, for example on a site of your own at the root of the host while
  the instance is under a path.
- The texts are shown as they are, in one language.
- A link with a full address opens in a new tab, so that the map stays where
  it is. A link to a path on the same host opens in the same tab: such a page
  belongs to the same site, and a link from it back to the map leads to the
  map as the visitor left it, not to a second one.

The pages themselves are not part of Netnou. Without `NETNOU_LINKS` nothing is
shown.

## Realtime polling and traffic

Three intervals are involved, and they are independent:

| Who | Interval | Setting |
| --- | --- | --- |
| The provider republishes the realtime feed | about every 30 s (gtfs.de, observed) | – |
| The server fetches the realtime feed | 60 s | `NETNOU_REALTIME_INTERVAL_SECONDS` |
| The page asks the server for vehicles | 10 s | fixed (`POLL_MS` in `public/app.js`) |

The gtfs.de realtime feed is 10 to 15 MB per fetch as it comes compressed
(18 to 50 MB unpacked, by the hour), which around the clock adds up to tens
of GB a day. It covers the whole country whatever the instance covers. The
server therefore fetches it only while somebody uses the map: the first
request for vehicles, a trip or a departure board starts the fetching, and
it stops `NETNOU_REALTIME_IDLE_SECONDS` after the last such request. A tab
in the background stops asking, and `/api/status` does not count, so
monitoring does not keep the fetching alive.

The interval is the pace when all is well. At busy times the server of gtfs.de
takes long to accept a connection and delivers slowly. A fetch is therefore
given up to 90 seconds, and the next one starts with the first turn of the
interval after it has ended. Until then the vehicles keep the delays of the
last fetch, for at most three minutes. How often fetching fails is counted in
`realtime.fetches` and `realtime.failures` of `/api/status`.

The server fetches once a minute, half as often as the provider republishes,
because of the traffic: an instance that is looked at around the clock
transfers 15 to 20 GB a day that way. A delay shows up to a minute after it
is reported, and the last delays outlive two failed fetches in a row. With
`NETNOU_REALTIME_INTERVAL_SECONDS=30` a delay shows half a minute sooner and
the last delays outlive five failed fetches, for twice the traffic.

The timetable itself (about 300 MB) is only downloaded when the provider
publishes a new version, which gtfs.de does once a day. The check every
`NETNOU_FEED_CHECK_MINUTES` is a single `HEAD` request.

## The map

The map behind the vehicles is drawn in the visitor's browser, by
[MapLibre GL JS](https://maplibre.org) from vector tiles. What it shows and
how is laid down in a *style*: a JSON document that names the tiles, the
fonts and the icons and says how to draw them. `NETNOU_MAP_STYLE_URL` is the address
of that document. The browser loads it, and everything it names, straight
from the servers concerned.

The default is the `bright` style of [OpenFreeMap](https://openfreemap.org).
OpenFreeMap is financed by donations, needs no key or registration and sets
no limit on the number of requests, so it also suits an instance with many
visitors. It promises no availability. Its other styles are `positron`,
`liberty`, `dark` and `fiord`:

```sh
NETNOU_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/positron
```

Any [style for MapLibre](https://maplibre.org/maplibre-style-spec/) can be
used, for example one of a commercial provider or of your own tile server.
What to know when choosing one:

- **Other servers.** The page's Content-Security-Policy lets the map be
  loaded from the server of `NETNOU_MAP_STYLE_URL` and from nowhere else. A style
  that takes its tiles, fonts or icons from other servers needs them listed
  in `NETNOU_MAP_ORIGINS`; only scheme, host and port of each URL count. What the
  policy blocks is reported in the console of the browser.

  ```sh
  NETNOU_MAP_STYLE_URL=https://maps.example.org/styles/day.json
  NETNOU_MAP_ORIGINS=https://tiles.example.org,https://fonts.example.org
  ```

- **A light style.** For visitors whose device is set to a dark theme the
  page turns the lightness of the map round, and for all others it tones the
  colours down a little so that the vehicles stand out. A style that is dark
  already would come out light in the dark theme.
- **Names.** Styles for tiles in the OpenMapTiles scheme, which OpenFreeMap
  and most other providers use, prefer the English name of a place. The page
  replaces it by the name in the visitor's language where OpenStreetMap knows
  one, and by the local name otherwise. Other styles are shown as they are.
- **A key in the URL** is sent to every visitor's browser, like the style
  itself. Providers let you restrict such a key to your domain.

Browsers need WebGL 2 for the map, which all current ones have. A visitor
without it gets a notice instead of the map.

### Raster tiles

A tile server that delivers images can be used as well. `NETNOU_TILE_URL` then takes
the place of `NETNOU_MAP_STYLE_URL`; the two cannot be combined.

```sh
NETNOU_TILE_URL=https://{s}.tiles.example.org/{z}/{x}/{y}.png
NETNOU_TILE_ATTRIBUTION='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, tiles: Example'
```

`{z}`, `{x}` and `{y}` are required. `{s}` stands for the subdomains `a`, `b`
and `c` and is allowed in the first label of the host name only; `{r}`
becomes `@2x` on screens with a high pixel density and nothing on others.
The servers of the OpenStreetMap project (`tile.openstreetmap.org`) are run
on donated resources and their
[usage policy](https://operations.osmfoundation.org/policies/tiles/) allows
light use only, so they are no choice for an instance with real traffic.

## Attribution

The credits are shown in the corner of the map, on a narrow screen behind an
ⓘ button. There are up to three of them:

- what the style names as the sources of its tiles, for the default style
  OpenFreeMap, OpenMapTiles and OpenStreetMap;
- `NETNOU_DATA_ATTRIBUTION`, after the words "Timetable and realtime data,
  processed:" in the visitor's language;
- `NETNOU_TILE_ATTRIBUTION`. Raster tiles cannot name their source themselves, so
  with `NETNOU_TILE_URL` it is needed and defaults to OpenStreetMap. With a style it
  is empty unless the style lacks a credit that its data requires.

Both settings are inserted into the page **as HTML**, so that they can
contain links; MapLibre keeps links and simple formatting and removes the
rest. Only put text there that you control. If you change the feeds or the
map, change the credit with them; the licences of the default sources
require it to be visible (see
[THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)).

## Counting visits

The server keeps no access log and the page loads no script from elsewhere,
so on its own an instance cannot tell how much it is used. The server can
tell an analytics service of each visit, though, with what the browser sent
with its request anyway: nothing is stored in the visitor's browser and
nothing read from it. Which service that is, and the shape of its request,
is yours: the three settings are a pattern of the request, whose
placeholders the server fills in. It knows no service by name. Without
`NETNOU_VISITS_URL` nothing is reported. What only a script in the page
could learn, a screen's size or how long the page took to load, is not
known so; and a program that fetches the page as a browser would, without
saying that it is one, is counted.

```sh
NETNOU_VISITS_URL='http://umami:3000/api/send'
NETNOU_VISITS_BODY='{"type":"event","payload":{"website":"<id>","hostname":"{host}","url":"{path}","referrer":"{source}","language":"{language}","title":"{title}","ip":"{ip}","userAgent":"{browser}"}}'
```

With `NETNOU_VISITS_BODY` the report is a `POST` with `Content-Type:
application/json`, without it a `GET`. `NETNOU_VISITS_HEADERS` adds headers,
for a service that wants a key or a fact there. A pattern that is not
understood, or a placeholder that does not exist, stops the server at start
with a line that names the setting.

| Placeholder | Stands for |
| --- | --- |
| `{address}` | the address of the page as the visitor opened it: `https://transit.example.org/?lang=en` |
| `{host}` | its host: `transit.example.org` |
| `{path}` | its path and query: `/?lang=en`, or `/stop/nuernberg-plaerrer@49.4481,11.0648` for the page of a stop |
| `{source}` | where the visitor came from: the `Referer` of the request, where it names another host than the instance |
| `{language}` | the language the browser names first, as it sends it: `de-DE` |
| `{browser}` | the `User-Agent` of the request, as it is sent |
| `{ip}` | the IP address of the visitor |
| `{ip-short}` | the same without its end: of an IPv4 address the last number 0, of an IPv6 address the first 48 bits |
| `{title}` | the title of the page, in the language it was sent in |

- **Host and path** are those of `NETNOU_PUBLIC_URL` where it is set. Without
  it they come from the request: its `Host` header, `https` where
  `X-Forwarded-Proto` says so.
- **Of the query** only `lang`, `display` and the five `utm_…` parameters are
  passed on. Everything else is left out, among it the map position that the
  address of a display holds (`view`).
- **The IP address** is the last entry of `X-Forwarded-For`, the one the
  reverse proxy in front has written; without that header it is the
  address of the connection. Where two proxies stand in front, the nearer
  one has to pass the visitor's address on.
- **Filled in** are the texts of the body, so that what is sent is always
  JSON; the values of the query, encoded; and the values of the headers. A
  header that cannot carry what is filled in is left out.
- **Nothing to fill in:** a field of the body, a parameter of the query or a
  header that is one placeholder and nothing else is left out where there
  is nothing for it, such as `{source}` for a visitor who typed the address.
- Without a `User-Agent` of its own the report names the server, as its
  other requests do: `Netnou/<version>`.

What counts as a visit:

- **A `GET` of the page,** at its address or at that of a stop or a line,
  whether it is answered with the page or with "not modified".
- **Opened by a browser:** `Sec-Fetch-Mode` is `navigate`, and
  `Sec-Fetch-Dest` is `document`, or `empty` where the page's service worker
  passes the request on. A browser that sends neither header counts where
  its `Accept` names `text/html`. A script fetching the page is no visit,
  nor is the worker filling its cache.
- **Not a prefetch** (`Sec-Purpose` or `Purpose` names `prefetch`), and not a
  browser that asks not to be tracked (`DNT: 1` or `Sec-GPC: 1`).
- **Which browsers are bots** is left to the service, which is told their
  names. A display counts like any other visit; `display` in its path tells
  it apart.

A visit is reported once the answer to the visitor has been written, with
one attempt of at most 5 seconds; with 20 reports under way, more are
dropped, so that a service that hangs cannot hold up the server. A visit
that cannot be reported is lost: the server keeps nothing of it. The log
says at the start where visits are reported, by the host alone, as the
address may hold a key; once when reports begin to fail, with the status
and the beginning of the answer; and once when they get through again.
Nothing is logged for a single visit.

### Patterns for some services

Written from what each service documents, in October 2026; not yet tried
against a running one. What is in angle brackets is yours.

**Umami**, from its source at version 3.4.0 (`POST /api/send`). It tells
visitors apart by a hash of the IP address and the browser it is given, and
keeps no IP address:

```sh
NETNOU_VISITS_URL='http://umami:3000/api/send'
NETNOU_VISITS_BODY='{"type":"event","payload":{"website":"<the ID Umami gives the site>","hostname":"{host}","url":"{path}","referrer":"{source}","language":"{language}","title":"{title}","ip":"{ip}","userAgent":"{browser}"}}'
```

**Plausible**, its Events API (`POST /api/event`). The browser and the IP
address go in headers:

```sh
NETNOU_VISITS_URL='https://plausible.io/api/event'
NETNOU_VISITS_BODY='{"name":"pageview","url":"{address}","domain":"<the domain of the site in Plausible>","referrer":"{source}"}'
NETNOU_VISITS_HEADERS='{"User-Agent":"{browser}","X-Forwarded-For":"{ip}"}'
```

**Matomo**, its Tracking HTTP API (`matomo.php`). The IP address of the
visitor, `cip`, is taken only with a `token_auth` that may write to the
site:

```sh
NETNOU_VISITS_URL='https://<matomo>/matomo.php?idsite=<1>&rec=1&apiv=1&send_image=0&url={address}&urlref={source}&action_name={title}&ua={browser}&lang={language}&cip={ip}&token_auth=<token>'
```

**GoatCounter**, its API (`POST /api/v0/count`, with a key):

```sh
NETNOU_VISITS_URL='https://<code>.goatcounter.com/api/v0/count'
NETNOU_VISITS_BODY='{"hits":[{"path":"{path}","title":"{title}","ref":"{source}","user_agent":"{browser}","ip":"{ip}"}]}'
NETNOU_VISITS_HEADERS='{"Authorization":"Bearer <key>"}'
```

A service that is to have less than the whole IP address gets `{ip-short}`
in place of `{ip}`, and tells visitors of one network apart the less well.

Telling visitors about it, what is passed on to which service and how long
that keeps it, is your responsibility, as the legal notices are
([Running a public instance](deployment.md#running-a-public-instance)).

## Version and updates

The page names the version it runs at the end of the credits in the corner
of the map, and `/api/status` reports it as `version`:

| Shown | What runs |
| --- | --- |
| `0.2.0` | the image of a release |
| `edge · 479e29c` | an image of the main branch between two releases, with the commit it was built from |
| `0.2.0+dev` | a checkout or an image built by hand: release 0.2.0 or anything after it |

Once a day, and when it starts, the server asks `api.github.com` for the
latest release of the repository named in `package.json`. If that release is
newer than what runs, the page shows a small marker next to the version, to
every visitor, which leads to the release notes. The server also says so once
in its log (`Update: version … is available`) and in `update` of
`/api/status`. Below 1.0 a new minor version may change settings; the release
notes say what.

`NETNOU_UPDATE_CHECK=off` switches this off: no request, no marker. GitHub learns
nothing from the request but the address of the server and the name and
version of the software. A check that fails is silent and repeated the next
day. An `edge` build does not ask at all, since it is ahead of every release.

## Other feeds and other countries

`NETNOU_FEED_URL`, `NETNOU_REALTIME_URL`, `NETNOU_TIMEZONE`, `NETNOU_OSM_PBF_URLS` and the attribution
settings are enough to point Netnou at a mirror of the gtfs.de
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
- All times in one time zone, which you name in `NETNOU_TIMEZONE`.
  `agency_timezone` is not read.

What the realtime feed must provide:

- `TripUpdate` entities with the `trip_id` and `start_date` of the timetable
  and `stop_sequence` in their stop time updates. Vehicle positions are not
  used.
- Alerts are shown for trips and stops; alerts addressed to a whole agency or
  route are not. Where an alert says how serious it is (`severity_level`),
  warnings are shown first and with a sign of their own.

What is fixed in the code and written for Germany. Each item names the place
to change:

| Assumption | Where |
| --- | --- |
| Suburban, regional and long-distance trains are told apart by German line names (`S 1`, `ICE 123`, …); besides them only ferries (route type 4), cable cars and monorails (5, 6, 7 and 12) and trolleybuses (11, as buses) are known, with the extended route types of the same things; everything else is "other". Ferries follow the ways of their routes in OpenStreetMap (`route=ferry`), cable cars and monorails those of monorails, funiculars, narrow gauge, tracks with a rack and aerial lifts; "other" gets no route geometry | `routeMode` in `server/lib/timetable.js` |
| Of an alert in several languages the German text is shown | `server/lib/pb.js` |
| The operator behind the realtime data is recognised from the note gtfs.de attaches to each trip | `SOURCE_NOTE` in `server/lib/realtime.js` |
| The grid that describes the area has cells of about 1.1 km at 49–50° north; far from that latitude the cells and all "about a kilometre" distances are stretched or squeezed east–west | `CELL_LON` in `server/lib/area.js` |
| A feed's own `shapes.txt` is not used; route geometry always comes from OpenStreetMap | `server/lib/shapes.js` |
| The town of a stop is the municipality that OpenStreetMap has at `admin_level` 8, or an area at level 6 or 4 with no municipality in it, as a city that is a district of its own and Berlin are. Where municipalities have another level, a stop has no town, or the name of a larger area | `BORDER_LEVELS` in `server/lib/towns.js` |
| The labels "U-Bahn" and "S-Bahn" in the English texts | `public/locales/en.js` |
| The departure board covers two hours and 40 entries | `departures` in `server/lib/timetable.js` |

The user interface language is independent of all this, see
[translating.md](translating.md).
