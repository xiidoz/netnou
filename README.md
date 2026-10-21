<h1 align="center">
  <img src="public/favicon.svg" alt="" width="40" height="40" align="top">&nbsp;Netnou<br>
  <sub>A live map of buses and trains</sub>
</h1>

<p align="center">
  English • <a href="README.de.md">Deutsch</a>
</p>

Netnou shows buses and trains where they are right now, with their delays and
the next departures at every stop.

**Try it:** [öpnv.live](https://xn--pnv-rna.live) runs Netnou for all of
Germany.

**The positions are calculated, not tracked by GPS.** The data has delays but
no positions, so each vehicle is drawn where the timetable and its reported
delay put it. It can be a little ahead of or behind its marker.

![Three phones: the departures of Nürnberg Plärrer, the trip of a bus from there with the bus on the map in the old town, and the search finding Fürth](docs/pictures/phone.webp)

![A wide screen as the page usually looks: the trip of a bus from Nürnberg Plärrer beside the map of the city](docs/pictures/wide.webp)

## What you can do

- **Tap a vehicle** to see its trip with every stop, time and delay, and when
  it gets where.
- **Zoom in and tap a stop** for its next departures with their delays: will
  you still make it?
- **Tap a departure** for its whole trip, with its vehicle marked on the map.
- **Search** for a town, a stop or a line. A line then shows only its own
  vehicles, all of them at a glance.
- **Tap the heart** to make a stop or a line a favourite. Favourites come
  first in the search, even before anything is typed.
- **Tap a kind of transport** in the row of chips to hide it or show it again,
  for example to see only the trains.
- **Share** a stop, a line or a trip, for example to show someone where the
  bus is right now.
- **Show the departures as a board**, in large type for a screen on the wall,
  with up to four stops.
- **Choose the lines and directions** of a stop with the chip beside its
  departures, for example only the trains into town: the board keeps them in
  its address, and a favourite stop opens with them.

![The departures of Nürnberg Hauptbahnhof as a board beside the map, on a wide screen](docs/pictures/board.webp)

The vehicles can also be coloured by their delay, the map can show your own
location (it stays in your browser), and the page speaks German and
English and installs as an app.

## Something wrong?

- **A time, a delay or a cancellation is wrong?** It comes from the timetable
  data. If the operator's own app shows the same, tell the operator; the data
  reaches Netnou from them through [gtfs.de](https://gtfs.de).
- **A vehicle takes a road or a track it never uses?** The routes come from
  OpenStreetMap, where they can be [corrected](https://www.openstreetmap.org/fixthemap).
- **A bug, or an idea for the map?** [Open an issue](https://github.com/xiidoz/netnou/issues/new/choose),
  in English or German.
- **A question about one public instance?** Whoever runs it is usually named
  in its imprint, linked at the foot of its card.

## Run your own

With Docker:

```sh
docker compose up -d
```

This pulls the published image `ghcr.io/xiidoz/netnou`. `compose.yaml` needs
nothing else from the repository, so it can also be downloaded on its own or
pasted into Portainer as it is.

With Node.js 22 or newer, with nothing to install:

```sh
npm start
```

Then open <http://localhost:8080>. Out of the box Netnou shows the VGN, the
network around Nürnberg, from the nationwide feeds of [gtfs.de](https://gtfs.de).
Another region is a matter of settings, for example München (in a POSIX
shell; for PowerShell and Docker see the configuration guide):

```sh
NETNOU_BBOX=48.06,11.36,48.25,11.72 \
NETNOU_AREA_NAME=München \
NETNOU_OSM_PBF_URLS=https://download.geofabrik.de/europe/germany/bayern/oberbayern-latest.osm.pbf \
npm start
```

`NETNOU_AREA=Germany` shows all of Germany. Every setting, how to describe an
area, and what feeds of another country need:
[docs/configuration.md](docs/configuration.md). Docker, reverse proxies,
monitoring and a public instance: [docs/deployment.md](docs/deployment.md).

**Status: early development (0.x).** Settings and the API can still change
from one minor version to the next; the [changelog](CHANGELOG.md) marks such
changes as breaking.

### What the first start does

The server downloads the timetable of all of Germany (about 300 MB) and cuts
it down to the area, then OpenStreetMap extracts (about 500 MB for the default
area) to work out the roads and tracks between stops. On a fast connection
that takes two to five minutes. Until the timetable is read the page shows a
notice; then vehicles move in straight lines; a minute or two later they
follow roads and tracks. Afterwards the server runs with 150 to 600 MB of
memory and starts from its cache in less than a second. The figures for all
of Germany are in [docs/deployment.md](docs/deployment.md#requirements).

## What an operator gets

- One Node.js process: no database, no npm dependencies at run time, no build
  step. The realtime feed is fetched only while somebody is looking.
- A name, a description, icons and links of its own, such as an imprint and a
  privacy notice ([Being found](docs/configuration.md#being-found),
  [Icons](docs/configuration.md#icons-of-your-own),
  [Links](docs/configuration.md#links-of-your-own)).
- An address for every stop, line and trip to share, and a sitemap of the
  stops and lines for search engines.
- A display for a screen on the wall, with boards of up to four stops
  ([A screen on a wall](docs/deployment.md#a-screen-on-a-wall)).
- Visits counted by an analytics service of your choice, which the server
  tells of each one: no script in the page, no cookie
  ([Counting visits](docs/configuration.md#counting-visits)).
- An open JSON API for other clients ([docs/api.md](docs/api.md)).
- German and English, chosen per visitor; a further language is one file
  ([docs/translating.md](docs/translating.md)).

## Take part

[![CI](https://github.com/xiidoz/netnou/actions/workflows/ci.yml/badge.svg)](https://github.com/xiidoz/netnou/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

`npm test` needs no installation and no network. How to work on Netnou, the
commit messages and the pull requests: [CONTRIBUTING.md](CONTRIBUTING.md). How
it works inside, from the import to the positions:
[docs/architecture.md](docs/architecture.md).

## Data sources, licences and attribution

The code is under the [MIT License](LICENSE). Four things in the repository
are not: the vendored map library MapLibre GL JS
(`public/vendor/maplibre-gl`, BSD-3-Clause), the icons taken from Material
Design Icons (`public/vendor/material-design-icons`, Apache-2.0), the
outlines of the built-in areas (`server/areas/vgn.geojson` and
`server/areas/germany.geojson`, © OpenStreetMap contributors, ODbL 1.0) and
the data the pictures above are taken from (`tools/pictures`, a part of the
timetable of gtfs.de under CC BY-SA 4.0 and of OpenStreetMap under ODbL 1.0).

A running instance works with data that it fetches itself and that has its own
terms:

- Timetable and realtime data: [gtfs.de](https://gtfs.de), provided by DELFI
  e.V., CC BY-SA 4.0.
- Roads and tracks for the routes, and the borders of the towns the search
  knows: © OpenStreetMap contributors, ODbL 1.0, as extracts from
  [Geofabrik](https://download.geofabrik.de/).
- The map behind the vehicles: vector tiles of
  [OpenFreeMap](https://openfreemap.org) in the OpenMapTiles scheme, made
  from OpenStreetMap data and loaded by the visitor's browser. OpenFreeMap
  needs no key and sets no limit on requests.

The credits are shown on the map and have to stay visible. Details and what
follows for operators: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Disclaimer

Netnou is not affiliated with or endorsed by VGN, VAG, DELFI e.V., gtfs.de or
any transport operator. Positions are estimates computed from the timetable
and the reported delays. Do not rely on them.

The name is Afrikaans: *net nou* means "just now", which in South Africa
notoriously means "later, eventually". That suits German public transport, the
*ÖPNV*, rather well.
