# Changelog

All notable changes to Netnou, newest first. Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is written by
[release-please](https://github.com/googleapis/release-please) from the commit
messages when a release is made. Do not edit it by hand; see
[Releases](CONTRIBUTING.md#releases).

## [0.3.0](https://github.com/xiidoz/netnou/compare/v0.2.0...v0.3.0) (2026-10-06)


### Features

* **map:** show the visitor's own location on request ([#21](https://github.com/xiidoz/netnou/issues/21)) ([d50d062](https://github.com/xiidoz/netnou/commit/d50d0627933b8483f559d8ddffe09dfe39c6e0fc)), closes [#8](https://github.com/xiidoz/netnou/issues/8)
* **page:** find lines in the search and show their vehicles ([#27](https://github.com/xiidoz/netnou/issues/27)) ([7e5c58a](https://github.com/xiidoz/netnou/commit/7e5c58a1e9cd049bc12d949a231e79a718c58f75)), closes [#23](https://github.com/xiidoz/netnou/issues/23)
* **page:** find stops by name with a search field ([#25](https://github.com/xiidoz/netnou/issues/25)) ([a17e24d](https://github.com/xiidoz/netnou/commit/a17e24dbacba0ee784c8bcd27aced03702f01449)), closes [#9](https://github.com/xiidoz/netnou/issues/9)


### Bug Fixes

* **page:** centre the lens on the search button ([#26](https://github.com/xiidoz/netnou/issues/26)) ([a97d2ac](https://github.com/xiidoz/netnou/commit/a97d2acabb1728ac3100560f91e09db18fe49be6))
* **page:** keep the way back to a line in view ([#29](https://github.com/xiidoz/netnou/issues/29)) ([a80593c](https://github.com/xiidoz/netnou/commit/a80593cb7f4663aecf8c9d61894072c50a4c3814))
* **page:** take the buttons' icons from Material Design Icons ([#28](https://github.com/xiidoz/netnou/issues/28)) ([f2d936f](https://github.com/xiidoz/netnou/commit/f2d936fd8dbb2971fa3595d6453c534f8177b1a0))

## [0.2.0](https://github.com/xiidoz/netnou/compare/v0.1.0...v0.2.0) (2026-10-05)


### ⚠ BREAKING CHANGES

* **map:** Browsers now load the map from tiles.openfreemap.org instead of tile.openstreetmap.org and need WebGL 2. TILE_URL has no default any more and selects raster tiles instead of the default style; with it unset, TILE_ATTRIBUTION is shown in addition to the credits of the style. /api/area reports styleUrl next to tileUrl, one of them null. Zoom levels in the page are those of MapLibre, one less than before.

### Features

* **map:** draw the map from vector tiles with MapLibre GL JS ([#13](https://github.com/xiidoz/netnou/issues/13)) ([479e29c](https://github.com/xiidoz/netnou/commit/479e29cd13b2afc6b2c447e6e7b452f4ccf1beda)), closes [#10](https://github.com/xiidoz/netnou/issues/10)
* show the version in the page and point out a newer release ([#18](https://github.com/xiidoz/netnou/issues/18)) ([f1fce12](https://github.com/xiidoz/netnou/commit/f1fce124d16b4ed5dfa7e828ae3ed43309b68c22)), closes [#12](https://github.com/xiidoz/netnou/issues/12)


### Bug Fixes

* **page:** show on small screens that the row of filters goes on ([#20](https://github.com/xiidoz/netnou/issues/20)) ([a4fe5c9](https://github.com/xiidoz/netnou/commit/a4fe5c9880833dc2356b394bdaf4b6a088ffee82)), closes [#6](https://github.com/xiidoz/netnou/issues/6)
* **realtime:** wait for a busy feed server instead of giving up after 10 s ([#16](https://github.com/xiidoz/netnou/issues/16)) ([fb76406](https://github.com/xiidoz/netnou/commit/fb76406c1561bea922ed80cebe9feb470f3e410d)), closes [#5](https://github.com/xiidoz/netnou/issues/5)

## 0.1.0 (2026-10-04)


### Features

* **docker:** publish releases as latest and the main branch as edge ([#3](https://github.com/xiidoz/netnou/issues/3)) ([1f44fbe](https://github.com/xiidoz/netnou/commit/1f44fbe33a309616a6160929fba495f6608282e7))
* initial public release ([a131275](https://github.com/xiidoz/netnou/commit/a131275e0917e1ecd3b0c6b1bfb0436389d8e220))


### Bug Fixes

* **deps:** bump node from 24-alpine to 26-alpine ([#1](https://github.com/xiidoz/netnou/issues/1)) ([bc23827](https://github.com/xiidoz/netnou/commit/bc23827b2f759d3c0b3525355acaa68912b6ce2b))
* **docker:** make compose.yaml usable without a checkout ([#4](https://github.com/xiidoz/netnou/issues/4)) ([b4c67c1](https://github.com/xiidoz/netnou/commit/b4c67c17238707aa48b3e30c895bc67d6cc13073))

## 0.0.0

Development before the first release is not recorded here.
