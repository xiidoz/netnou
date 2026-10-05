# Deployment

- [Requirements](#requirements)
- [Docker](#docker)
- [Without Docker](#without-docker)
- [Reverse proxy, HTTPS and sub-paths](#reverse-proxy-https-and-sub-paths)
- [Monitoring](#monitoring)
- [Running a public instance](#running-a-public-instance)
- [Troubleshooting](#troubleshooting)

## Requirements

- Docker with Compose, or Node.js 22 or newer. Nothing else: no database, no
  npm packages.
- Outbound HTTPS from the server to the feeds: with the defaults
  `download.gtfs.de`, `realtime.gtfs.de` and `download.geofabrik.de`.
- Memory: about 1.5 GB for a minute or two while a timetable is imported, a
  few hundred MB otherwise.
- Disk: less than 1 GB in the data directory during an import, about 35 MB
  afterwards.

The figures are approximate and were measured for the default area in October
2026; a smaller area needs less.

Visitors' browsers load the map behind the vehicles themselves, by default
from `tiles.openfreemap.org` (see [The map](configuration.md#the-map)), and
need WebGL 2 to draw it.

## Docker

`compose.yaml` in the repository runs the published image
`ghcr.io/xiidoz/netnou` on any Docker host:

```sh
docker compose up -d
```

Then open <http://localhost:8080>. The first start takes a few minutes, see
[What the first start does](../README.md#what-the-first-start-does).

The file needs nothing else from the repository. You can download it on its
own, or paste its content into Portainer (Stacks → Add stack → Web editor) or
a similar tool; there the settings go into the `environment:` block of the
pasted file.

To run an image built from a checkout instead, add `compose.build.yaml`:

```sh
docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

What the container looks like:

- It runs as the unprivileged user `node` with a read-only root file system
  and all capabilities dropped.
- The only thing it writes is the cache in the volume `data`, mounted at
  `/data`. The volume can be deleted at any time; the caches are rebuilt on
  the next start. A bind mount instead of the volume has to be writable for
  uid 1000.
- A health check asks `/api/status` once a minute. It reports "healthy" as
  soon as the server answers, also while the first import is still running.
- The image is built for `linux/amd64` and `linux/arm64` and published under
  these tags:

  | Tag | What it is |
  | --- | --- |
  | `latest` | the newest release; what `compose.yaml` uses |
  | `0.3.1` | exactly that release |
  | `0.3` | the newest patch release of 0.3 |
  | `edge` | the main branch, rebuilt with every commit; not a release |

  Below version 1.0 a new minor version can change settings or the API, so
  `latest` can bring such a change with an update; a tag like `0.3` cannot.
  The [changelog](../CHANGELOG.md) marks these changes as breaking.

Settings go into the `environment:` block (see
[configuration.md](configuration.md)). Leave `HOST` unset in the container:
the health check talks to `127.0.0.1` inside it.

Settings that belong to your host, such as a container name or the network of
a reverse proxy, go into a `compose.override.yaml` next to `compose.yaml`.
Compose merges it in automatically and git ignores it:

```yaml
services:
  netnou:
    ports: !reset []        # no published port, the proxy reaches the container
    networks:
      - "proxy"
    environment:
      AREA_NAME: "My town"

networks:
  proxy:
    external: true
```

To update:

```sh
# published image
docker compose pull && docker compose up -d
# built from the checkout
git pull && docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Do not give the container a memory limit below about 2 GB. If it is killed
during an import it restarts and downloads the timetable again. On a host with
little memory, tell Node how much it may use, for example
`NODE_OPTIONS: "--max-old-space-size=2048"`.

## Without Docker

```sh
git clone https://github.com/xiidoz/netnou.git
cd netnou
npm start
```

There is nothing to install or build. The caches go to `./data` unless
`DATA_DIR` says otherwise.

As a systemd service on Linux, with a user of its own and the checkout in
`/opt/netnou`:

```ini
# /etc/systemd/system/netnou.service
[Unit]
Description=Netnou live public-transport map
After=network-online.target
Wants=network-online.target

[Service]
User=netnou
WorkingDirectory=/opt/netnou
ExecStart=/usr/bin/node server/index.js
Environment=HOST=127.0.0.1
Environment=PORT=8080
Environment=DATA_DIR=/var/lib/netnou
StateDirectory=netnou
Restart=on-failure
RestartSec=30
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```sh
sudo useradd --system --home-dir /opt/netnou --shell /usr/sbin/nologin netnou
sudo systemctl daemon-reload
sudo systemctl enable --now netnou
journalctl -u netnou -f
```

The server writes its log to standard output, one line per event with a UTC
timestamp, and stops cleanly on `SIGTERM`.

## Reverse proxy, HTTPS and sub-paths

The server speaks plain HTTP. Put it behind a reverse proxy for HTTPS and set
`HOST=127.0.0.1` (or do not publish the container port) so that it is only
reachable through the proxy.

- **HTTPS** is needed for installing the page as an app and for its offline
  start. The map itself also works over plain HTTP.
- **Sub-paths** work because the page uses relative URLs only. The proxy has
  to strip the prefix, and the address has to end in a slash:

  ```nginx
  location = /netnou { return 301 /netnou/; }
  location /netnou/ {
      proxy_pass http://127.0.0.1:8080/;
  }
  ```

- **Compression and caching** need no configuration: the server compresses
  its answers and sets cache headers itself.
- **Embedding** the page in a frame on another site is not possible: the
  Content-Security-Policy says `frame-ancestors 'none'`.

## Monitoring

`GET /api/status` describes the state of the server as JSON (all fields:
[api.md](api.md#get-apistatus)). It always answers 200 while the process
runs, and asking it does not start the fetching of the realtime feed, so it
is safe to poll.

Worth watching:

| Field | Healthy | Otherwise |
| --- | --- | --- |
| `timetable.state` | `ready` | `starting`, `loading`: first import under way. `error`: no timetable could be loaded, see `timetable.error` |
| `timetable.error` | `null` | text of the last failed update; with state `ready` the server keeps running on the previous timetable |
| `timetable.validUntil` | a date in the future | the timetable has run out; the feed has not been updated for weeks |
| `routes.segments` | greater than 0 | no route geometry: vehicles move in straight lines |
| `realtime.error` | `null` | the last fetch of the realtime feed failed (only meaningful while `realtime.polling` is `true`) |

## Running a public instance

- **Attribution.** The credits for the map and for the timetable data in the
  corner of the map are required by the licences of the data. Keep them
  visible and adjust them when you change the sources
  ([Attribution](configuration.md#attribution),
  [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md)).
- **The map.** The default map comes from OpenFreeMap, which allows public
  and commercial use without a limit on requests but promises no
  availability. While it is down, the vehicles move on an empty background.
  For an instance that has to be dependable, use a provider with a service
  agreement or your own tile server ([The map](configuration.md#the-map)).
- **Load.** The API has no rate limiting of its own. Limit requests to
  `/api/` at the reverse proxy if the instance is exposed to the internet.
  Every client that asks for vehicles also keeps the server fetching the
  realtime feed, about 20 MB every 30 seconds with the defaults
  ([Realtime polling and traffic](configuration.md#realtime-polling-and-traffic)).
- **What is stored and logged.** The server sets no cookies, has no accounts
  and writes no access log; it logs a request only when handling it failed
  with an error. The page stores four settings in the browser's
  `localStorage` (`netnou.lang`, `netnou.hiddenModes`, `netnou.colorBy`,
  `netnou.view`) and its own files in the browser cache `netnou-shell-v2`
  for the offline start. The only requests a visitor's browser makes to a
  third party are those for the map: its style, tiles, fonts and icons. With
  the defaults they go to `tiles.openfreemap.org`, which is served through
  Cloudflare; both see the visitor's IP address and the address of your
  site. A reverse proxy in front may log more.
- **Legal notices.** An imprint or a privacy notice, where the law requires
  one, is your responsibility. The page has no dedicated place for such
  links. `TILE_ATTRIBUTION` and `DATA_ATTRIBUTION` accept HTML, so a link can
  be appended there.

## Troubleshooting

The log lines below are quoted without their timestamp.

| Symptom or log line | Meaning | What to do |
| --- | --- | --- |
| `Configuration error: …`, exit code 1 | A setting has a value that is not acceptable. | The message names the variable; see [Settings](configuration.md#settings). |
| `Cannot listen on … port …`, exit code 1 | The port is in use or may not be opened, or `HOST` is not an address of this machine. | Set another `PORT` or correct `HOST`. |
| `Timetable: cannot start: the data directory … cannot be created or written`, exit code 1 | `DATA_DIR` is not writable for the user the server runs as. | Fix the ownership; in Docker a bind mount must be writable for uid 1000. |
| Page: "The timetable data could not be loaded." Log: `Timetable: update failed: fetch failed (…)` | The feed server cannot be reached. | Check outbound HTTPS and DNS. The next attempt follows after `FEED_CHECK_MINUTES`. |
| `Timetable: update failed: the feed has no stops in the area; check BBOX or AREA_FILE …` | The area lies outside the feed, or latitude and longitude are swapped. | `BBOX` is `south,west,north,east`; GeoJSON positions are `[longitude, latitude]`. |
| `… this feed version will be tried again in 60 min` | A download broke off or an import failed. That version of the feed is left alone for an hour, then two, doubling up to a day; a new version is tried at once. | Fix the cause named in the line and restart to try again immediately. |
| `Timetable: update failed: import worker stopped (exit code …)` | The import ran out of memory or crashed. | Give the process more memory, see [Docker](#docker). |
| `Timetable: stored dataset unusable (written by another version), importing again` | Normal after an update of Netnou that changed the cache format, or after changing the area (`made for another area`). | Nothing; the import runs again. |
| `Routes: OSM data could not be updated (…), keeping straight lines` | The OpenStreetMap extracts could not be downloaded or do not cover the area. | Check `OSM_PBF_URLS`. The next attempt follows after an hour, then with doubling waits up to a day. |
| Vehicles move in straight lines although extracts are set | The route geometry is still being computed, or the step above failed. | Look at `routes.segments` in `/api/status` and at the log. |
| Page: "timetable data only", pale vehicles | No realtime data: none in the feed for these trips, or the fetch fails. | `realtime.error` in `/api/status`; log line `Realtime: update failed: …`. |
| `Realtime: update failed: GET …: no answer after 90 s and … attempts (connect timeout)` | The feed server did not accept a connection in a minute and a half. If `curl` from the same host gets through, compare the times: the server of gtfs.de is hard to reach at rush hour. | Nothing, if it passes: fetching goes on. `realtime.failures` against `realtime.fetches` in `/api/status` shows how often it happens. |
| `Realtime: update failed: GET …: incomplete after 90 s (… of … MB)` | The feed arrived too slowly, from a busy server or over a slow line. | As above. The feed is over 20 MB per fetch. |
| Page: "No connection to the server" | The browser cannot reach the API. | Check the proxy configuration, in particular the trailing slash and the stripped prefix for a sub-path. |
| The vehicles move on an empty background | The browser could not load the map: its server is down or blocked on the visitor's network, or the style takes tiles, fonts or icons from a server the page may not load from. | The console of the browser names the request. For a blocked server see `MAP_ORIGINS` in [The map](configuration.md#the-map). |
| Page: "This browser cannot draw the map." | The browser has no WebGL 2: it is old, or hardware acceleration is switched off or unavailable, as in some remote sessions. | Nothing on the server. Another browser or device shows the map. |
| The container restarts during the first minutes | Killed for exceeding a memory limit during the import. | Raise the limit to 2 GB or more, or set `NODE_OPTIONS`. |

To force a clean import, stop the server, delete the contents of the data
directory (`docker compose down -v` removes the volume) and start it again.
