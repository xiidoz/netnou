# Configuration

Netnou is configured with environment variables. All of them are optional:
without any, it shows the VGN (the transit network around Nürnberg) from the
gtfs.de feeds on port 8080.

- [Settings](#settings)
- [Choosing an area](#choosing-an-area)
- [No area, and single operators](#no-area-and-single-operators)
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
| `NETNOU_AREA` | – | `all` | no area: everything the feed has, see [No area, and single operators](#no-area-and-single-operators) |
| `NETNOU_AGENCIES` | all operators | names separated by commas, or a JSON array | only the trips of these operators, named as `agency.txt` of the feed names them |
| `NETNOU_SITE_NAME` | `Netnou` | text | what the instance calls itself: in the heading and the title of the page, in previews of links and as the installed app. The credits on the map name Netnou and its version whatever is set here |
| `NETNOU_SITE_TITLE` | the page's own, in each of its languages | text, or texts by language | the title of the page as the tab of a browser and a search result show it, in words of your own, see [Being found](#being-found) |
| `NETNOU_SITE_DESCRIPTION` | the page's own, in each of its languages | text, or texts by language | what the page says about itself in a search result and in a preview of a link, in words of your own |
| `NETNOU_AREA_NAME` | `Großraum Nürnberg (VGN)`; empty for a custom area | text | shown next to the title of the page, and what search engines find the instance by, see [Being found](#being-found) |
| `NETNOU_BRAND_DIR` | – (`/brand` in the image) | path | a folder with icons and a preview picture of your own, see [Icons of your own](#icons-of-your-own) |
| `NETNOU_LINKS` | – | `Text=address`, separated by commas | links of the operator at the foot of the header card, see [Links of your own](#links-of-your-own) |
| `NETNOU_LANGUAGE` | `de` | a language of the page: `de`, `en` | the main language of the instance: the page is sent in it to whoever asks without naming a language, as search engines do. Visitors get the language of their browser, see [Being found](#being-found) |
| `NETNOU_PUBLIC_URL` | – | http(s) URL | the address under which visitors reach the instance, e.g. `https://transit.example.org/`, see [Being found](#being-found) |
| `NETNOU_SEARCH_ENGINES` | `on` if `NETNOU_PUBLIC_URL` is set, otherwise `off` | `on` or `off` | whether search engines may list the instance, see [Being found](#being-found) |
| `NETNOU_VIEW` | Nürnberg, Fürth and Erlangen; the whole area for a custom one | `south,west,north,east` | map section on a visitor's first visit; afterwards the browser remembers the last one |
| `NETNOU_TIMEZONE` | `Europe/Berlin` | IANA time zone | the zone the times of the feed are in; times in the page are shown in it |
| `NETNOU_FEED_URL` | `https://download.gtfs.de/germany/free/latest.zip` | http(s) URL | the GTFS timetable (zip) |
| `NETNOU_FEED_CHECK_MINUTES` | `15` | 1–1440 | how often to look for a new version of the timetable |
| `NETNOU_REALTIME_URL` | `https://realtime.gtfs.de/realtime-free.pb` | http(s) URL | the GTFS-Realtime feed |
| `NETNOU_REALTIME_INTERVAL_SECONDS` | `60` | 10–3600 | how often the realtime feed is fetched while the map is in use |
| `NETNOU_REALTIME_IDLE_SECONDS` | `120` | 30–86400 | fetching stops this long after the last request from a browser |
| `NETNOU_OSM_PBF_URLS` | five Geofabrik extracts of Bavaria; none for a custom area | comma-separated http(s) URLs | OpenStreetMap extracts (`.osm.pbf`) that together cover the area: the roads and tracks for the route geometry, and the borders of the towns the search finds a stop by; empty means neither |
| `NETNOU_OSM_MAX_AGE_DAYS` | `30` | 1–3650 | how long the OpenStreetMap data is used before it is downloaded again |
| `NETNOU_DOWNLOAD_TIMEOUT_MINUTES` | `30` | 1–1440 | limit for one download of the timetable or of an extract |
| `NETNOU_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/bright` | http(s) URL | the style of the map behind the vehicles, see [The map](#the-map) |
| `NETNOU_MAP_ORIGINS` | – | comma-separated http(s) URLs | further servers the map is loaded from, if the style does not take everything from its own |
| `NETNOU_TILE_URL` | – | http(s) URL template with `{z}`, `{x}`, `{y}` | raster tiles as the map, instead of `NETNOU_MAP_STYLE_URL` |
| `NETNOU_TILE_ATTRIBUTION` | `© OpenStreetMap` with a link if `NETNOU_TILE_URL` is set, otherwise nothing | HTML | credit shown for the map, besides what a style names itself |
| `NETNOU_UPDATE_CHECK` | `on` | `on` or `off` | whether the server asks GitHub once a day for a newer release, see [Version and updates](#version-and-updates) |
| `NETNOU_DATA_ATTRIBUTION` | `GTFS.DE / DELFI e.V. (CC BY-SA 4.0)` with links | HTML | credit shown on the map for the timetable and realtime data |

Rules that apply to all of them:

- An empty value counts as not set. The two exceptions are `NETNOU_AREA_NAME` (empty
  means "no name") and `NETNOU_OSM_PBF_URLS` (empty means "no route geometry and no
  towns", also for the built-in area).
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

There are three ways to define it:

- **Nothing set:** the VGN, from `server/areas/vgn.geojson` (the outlines of
  its 11 cities and 23 districts).
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

## No area, and single operators

An instance need not have an area, and it need not show every operator.
There are two limits, each optional, and a trip has to pass both:

| Instance | Area | Operators |
| --- | --- | --- |
| A transit network | its outline (the VGN is built in) | all |
| A state | its outline, as `NETNOU_AREA_FILE` | all |
| Everything the feed has | `NETNOU_AREA=all` | all |
| One operator, wherever it runs | `NETNOU_AREA=all` | `NETNOU_AGENCIES` |
| One operator in a network | the outline of the network | `NETNOU_AGENCIES` |

- **`NETNOU_AREA=all`** takes every trip of the feed. There is then nothing
  that would be outside: every stop is listed, has a departure board and is
  found by the search, no edge is drawn on the map, and the first view is the
  rectangle around all stops unless `NETNOU_VIEW` says otherwise. For the feed
  of a whole country set `NETNOU_VIEW`: a few lines that run abroad make that
  rectangle much larger than the country.
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
  the error says so. Give it its own area, or `NETNOU_AREA=all`.

Without an area the instance still needs to know where its vehicles follow
roads and tracks and which OpenStreetMap data to keep. It takes that from its
trips: where their stops are, and the straight lines from each stop to the
next. That is its extent. `NETNOU_OSM_PBF_URLS` works as for an area; the
extracts have to cover the extent. The OpenStreetMap data kept for one
timetable is used for the next as long as that one stays within it, so a new
timetable alone does not fetch the extracts again.

The feed of all of Germany can be shown this way. For its route geometry
take the extract of Germany,
`https://download.geofabrik.de/europe/germany-latest.osm.pbf` (4.9 GB): its
roads are routed in tiles ([architecture.md](architecture.md#route-geometry)).
The first import then takes the test machine about eight minutes and at
most 3.2 GB of memory, and so does one with new OpenStreetMap data; the data
directory needs 6 GB while the extract is read, 1.1 GB afterwards. A new
timetable on the same data keeps the routes it can and routes only the hops
that are new: with nearly all of them kept it is imported in about a minute.

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
   borders of the municipalities in them: a stop beyond them is found by its
   name alone.

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
  `/sitemap.xml`. Without it all of that is left out, because each needs a
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
| Suburban, regional and long-distance trains are told apart by German line names (`S 1`, `ICE 123`, …); only the basic GTFS route types 0–3 are known, everything else is "other" and gets no route geometry | `routeMode` in `server/lib/timetable.js` |
| Of an alert in several languages the German text is shown | `server/lib/pb.js` |
| The operator behind the realtime data is recognised from the note gtfs.de attaches to each trip | `SOURCE_NOTE` in `server/lib/realtime.js` |
| The grid that describes the area has cells of about 1.1 km at 49–50° north; far from that latitude the cells and all "about a kilometre" distances are stretched or squeezed east–west | `CELL_LON` in `server/lib/area.js` |
| A feed's own `shapes.txt` is not used; route geometry always comes from OpenStreetMap | `server/lib/shapes.js` |
| The town of a stop is the municipality that OpenStreetMap has at `admin_level` 8, or an area at level 6 or 4 with no municipality in it, as a city that is a district of its own and Berlin are. Where municipalities have another level, a stop has no town, or the name of a larger area | `BORDER_LEVELS` in `server/lib/towns.js` |
| The labels "U-Bahn" and "S-Bahn" in the English texts | `public/locales/en.js` |
| The departure board covers two hours and 40 entries | `departures` in `server/lib/timetable.js` |

The user interface language is independent of all this, see
[translating.md](translating.md).
