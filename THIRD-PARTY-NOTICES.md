# Third-party notices

Netnou's own code is under the [MIT License](LICENSE). This file lists what
is not: material from others that is part of the repository, and data that a
running instance fetches and passes on.

## In the repository

### Leaflet

- Where: `public/vendor/leaflet/` (`leaflet.js`, `leaflet.css`), version
  1.9.4, unmodified.
- Licence: BSD 2-Clause. Copyright (c) 2010-2023, Volodymyr Agafonkin;
  copyright (c) 2010-2011, CloudMade. The full text is in
  [public/vendor/leaflet/LICENSE](public/vendor/leaflet/LICENSE).
- Source: <https://leafletjs.com>

### Outline of the default area

- Where: `server/areas/vgn.geojson`, the boundaries of the cities and
  districts of the VGN.
- © OpenStreetMap contributors. Derived from OpenStreetMap data through
  Nominatim and available under the
  [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  See <https://www.openstreetmap.org/copyright> and
  [server/areas/README.md](server/areas/README.md).
- This file is not covered by the MIT License. Changed versions of it stay
  under the ODbL.

### Screenshot

`docs/screenshot.png` shows map tiles © OpenStreetMap contributors and
timetable data from gtfs.de / DELFI e.V., credited in the image.

## Data fetched at run time

None of the following is part of the repository or of the container image.
A running instance downloads it, and whoever operates the instance is the one
who uses it and has to meet its terms. The statements below are the project's
understanding of those terms in October 2026; check the providers' current
terms before you run a public instance.

| Data | Default source | Terms |
| --- | --- | --- |
| Timetable (GTFS) and realtime data (GTFS-Realtime) | [gtfs.de](https://gtfs.de), provided by DELFI e.V. | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| Roads and tracks for the route geometry | OpenStreetMap extracts from [Geofabrik](https://download.geofabrik.de/) | © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Map tiles, loaded by the visitor's browser | `tile.openstreetmap.org` | © OpenStreetMap contributors; [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) of the OpenStreetMap Foundation |

What follows for an operator:

- **Attribution.** The page credits OpenStreetMap and the provider of the
  timetable data in the corner of the map, with links and the name of the
  licence, and says that the timetable data was processed. Keep that credit
  visible. If you change the sources, change the credit with `TILE_ATTRIBUTION`
  and `DATA_ATTRIBUTION`
  (see [docs/configuration.md](docs/configuration.md#attribution)).
- **Derived data.** What an instance publishes through its API (vehicle
  positions, trips, departures, route geometry) and keeps in its data
  directory is derived from these sources. It stays under their terms,
  including the share-alike conditions of CC BY-SA and the ODbL, and is not
  placed under the MIT License by passing through Netnou.
- **Tile servers.** The default tile server is run by the OpenStreetMap
  Foundation on donated resources and is meant for light use. For an instance
  with real traffic, use another provider (`TILE_URL`).

## Development tools

ESLint and its dependencies are installed for development only (`npm ci`).
They are not distributed with Netnou and are not part of the container image.
