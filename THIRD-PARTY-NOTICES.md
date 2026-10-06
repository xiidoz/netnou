# Third-party notices

Netnou's own code is under the [MIT License](LICENSE). This file lists what
is not: material from others that is part of the repository, and data that a
running instance fetches and passes on.

## In the repository

### MapLibre GL JS

- Where: `public/vendor/maplibre-gl/` (`maplibre-gl.mjs`,
  `maplibre-gl-shared.mjs`, `maplibre-gl-worker.mjs`, `maplibre-gl.css`),
  version 6.12.0, unmodified.
- Licence: BSD 3-Clause. Copyright (c) 2023, MapLibre contributors. It
  contains code from mapbox-gl-js 1.13 and earlier (BSD 3-Clause, copyright
  (c) 2020, Mapbox), from glfx.js (MIT, copyright (C) 2011 by Evan Wallace)
  and a portion of d3-color (BSD 3-Clause, copyright 2010-2016 Mike Bostock).
  The full texts are in
  [public/vendor/maplibre-gl/LICENSE.txt](public/vendor/maplibre-gl/LICENSE.txt).
- Source: <https://github.com/maplibre/maplibre-gl-js>

### Material Design Icons

- Where: `public/vendor/material-design-icons/icons.js`, the shapes of the
  icons on the page's own buttons (close, chevron-left, chevron-right,
  magnify), from version 7.4.47 of the npm package `@mdi/js`, unmodified.
- Licence: the icons are under the Apache License 2.0, as the Pictogrammers
  Free License of the collection says. Both texts are next to the file:
  [LICENSE](public/vendor/material-design-icons/LICENSE) and
  [LICENSE-APACHE-2.0.txt](public/vendor/material-design-icons/LICENSE-APACHE-2.0.txt).
- Source: <https://pictogrammers.com/library/mdi/>,
  <https://github.com/Templarian/MaterialDesign>

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

`docs/screenshot.png` and `docs/social-preview.png`, which is made from it,
show a map of OpenFreeMap (© OpenMapTiles, data from OpenStreetMap) and
timetable data from gtfs.de / DELFI e.V., credited in the images.

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
| The map behind the vehicles (style, vector tiles, fonts and icons), loaded by the visitor's browser | [OpenFreeMap](https://openfreemap.org) | tiles in the [OpenMapTiles](https://www.openmaptiles.org/) scheme, © OpenMapTiles, data © OpenStreetMap contributors ([ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)); [terms of service](https://openfreemap.org/tos/) of OpenFreeMap |

What follows for an operator:

- **Attribution.** The page credits the sources of the map (OpenFreeMap,
  OpenMapTiles and OpenStreetMap, as named by the style) and the provider of
  the timetable data in the corner of the map, with links and the name of
  the licence, and says that the timetable data was processed. Keep that
  credit visible. If you change the sources, see to it that the credit
  changes with them: a style brings its own, `TILE_ATTRIBUTION` and
  `DATA_ATTRIBUTION` set the rest
  (see [docs/configuration.md](docs/configuration.md#attribution)).
- **Derived data.** What an instance publishes through its API (vehicle
  positions, trips, departures, route geometry) and keeps in its data
  directory is derived from these sources. It stays under their terms,
  including the share-alike conditions of CC BY-SA and the ODbL, and is not
  placed under the MIT License by passing through Netnou.
- **The map.** OpenFreeMap is financed by donations. Its terms allow public
  and commercial use and set no limit on requests, but it is provided as it
  is and may change or end without notice. Another map is a matter of
  `MAP_STYLE_URL` (see [docs/configuration.md](docs/configuration.md#the-map)).

## Development tools

ESLint and its dependencies are installed for development only (`npm ci`).
They are not distributed with Netnou and are not part of the container image.
