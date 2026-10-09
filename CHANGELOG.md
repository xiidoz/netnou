# Changelog

All notable changes to Netnou, newest first. Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is written by
[release-please](https://github.com/googleapis/release-please) from the commit
messages when a release is made. Do not edit it by hand; see
[Releases](CONTRIBUTING.md#releases).

## [0.6.2](https://github.com/xiidoz/netnou/compare/v0.6.1...v0.6.2) (2026-10-09)


### Bug Fixes

* **page:** tell previews of links how large the operator's picture is ([#84](https://github.com/xiidoz/netnou/issues/84)) ([074ebcc](https://github.com/xiidoz/netnou/commit/074ebcc2792c48246fd4cf43ffd43140eb9ae6db))

## [0.6.1](https://github.com/xiidoz/netnou/compare/v0.6.0...v0.6.1) (2026-10-09)


### Bug Fixes

* **page:** open the operator's links to pages on the same host in the same tab ([#82](https://github.com/xiidoz/netnou/issues/82)) ([5a2cb81](https://github.com/xiidoz/netnou/commit/5a2cb818c27798c205e8e3e89bc2c6627e0bbbca))

## [0.6.0](https://github.com/xiidoz/netnou/compare/v0.5.1...v0.6.0) (2026-10-08)


### Features

* **page:** hide the controls, go full screen, or run as a display on a wall ([#80](https://github.com/xiidoz/netnou/issues/80)) ([c64dbb3](https://github.com/xiidoz/netnou/commit/c64dbb3198e47ec92f3cc516ba0f01b1aaaaf7c8)), closes [#70](https://github.com/xiidoz/netnou/issues/70)
* **settings:** let a visitor hide the delay flags on the vehicles ([#78](https://github.com/xiidoz/netnou/issues/78)) ([fbb55a9](https://github.com/xiidoz/netnou/commit/fbb55a9507adabcc8f020198ebe0efd0b388324c)), closes [#74](https://github.com/xiidoz/netnou/issues/74)

## [0.5.1](https://github.com/xiidoz/netnou/compare/v0.5.0...v0.5.1) (2026-10-08)


### Bug Fixes

* **routes:** no long way round to a stop where the map data ends at the border ([#76](https://github.com/xiidoz/netnou/issues/76)) ([e29b0e3](https://github.com/xiidoz/netnou/commit/e29b0e3842575abba47f922700803e47837fb052)), closes [#75](https://github.com/xiidoz/netnou/issues/75)

## [0.5.0](https://github.com/xiidoz/netnou/compare/v0.4.1...v0.5.0) (2026-10-07)


### Features

* **map:** flag every vehicle that is early or late, from a single minute ([#72](https://github.com/xiidoz/netnou/issues/72)) ([366ea61](https://github.com/xiidoz/netnou/commit/366ea61380b4e7787591d592407dee2c11ea8cf0)), closes [#71](https://github.com/xiidoz/netnou/issues/71)

## [0.4.1](https://github.com/xiidoz/netnou/compare/v0.4.0...v0.4.1) (2026-10-07)


### Bug Fixes

* **realtime:** keep the portions of a coupled train together when their delays differ ([#67](https://github.com/xiidoz/netnou/issues/67)) ([cdbc638](https://github.com/xiidoz/netnou/commit/cdbc638b019578b29131049047cecfaef05add90)), closes [#66](https://github.com/xiidoz/netnou/issues/66)

## [0.4.0](https://github.com/xiidoz/netnou/compare/v0.3.0...v0.4.0) (2026-10-07)


### Features

* let an instance have a name of its own ([#47](https://github.com/xiidoz/netnou/issues/47)) ([ba565f4](https://github.com/xiidoz/netnou/commit/ba565f40c450b5c51db1fa3b89358ca386399c4e)), closes [#42](https://github.com/xiidoz/netnou/issues/42)
* let an operator bring icons and a preview picture of their own ([#49](https://github.com/xiidoz/netnou/issues/49)) ([9704de9](https://github.com/xiidoz/netnou/commit/9704de993c9212bfbd02f9872e8d99479e379be6)), closes [#44](https://github.com/xiidoz/netnou/issues/44)
* let an operator keep an instance out of search engines ([#41](https://github.com/xiidoz/netnou/issues/41)) ([b9ae576](https://github.com/xiidoz/netnou/commit/b9ae5764d38d346406d373e6623d653f0d130206)), closes [#40](https://github.com/xiidoz/netnou/issues/40)
* **map:** mark vehicles without a reported delay with a question mark, not a paler colour ([#54](https://github.com/xiidoz/netnou/issues/54)) ([5ea6f63](https://github.com/xiidoz/netnou/commit/5ea6f630887078d270668eee95b66f94f4a33245)), closes [#52](https://github.com/xiidoz/netnou/issues/52)
* **map:** show coupled trains as one marker and other vehicles at one place in a bubble ([#58](https://github.com/xiidoz/netnou/issues/58)) ([0b77d52](https://github.com/xiidoz/netnou/commit/0b77d5265fb5309935e2773fb6ab3ec39c73cf1b)), closes [#56](https://github.com/xiidoz/netnou/issues/56)
* **page:** keep the head of the details in sight and let the sheet on a phone be dragged ([#63](https://github.com/xiidoz/netnou/issues/63)) ([fa09e1f](https://github.com/xiidoz/netnou/commit/fa09e1f3be40b3fda19f5f4a5e4f37100d60102f)), closes [#46](https://github.com/xiidoz/netnou/issues/46)
* **page:** let visitors choose light or dark, in settings that also hold the language ([#55](https://github.com/xiidoz/netnou/issues/55)) ([42456c4](https://github.com/xiidoz/netnou/commit/42456c4aa3144c6a9f8b03e60dbce25c385d0677)), closes [#53](https://github.com/xiidoz/netnou/issues/53)
* **page:** say that the positions are estimated, and behind a link how it works ([#51](https://github.com/xiidoz/netnou/issues/51)) ([9a4e457](https://github.com/xiidoz/netnou/commit/9a4e457f3b1a7b3dd267df41a14a887063e37192)), closes [#45](https://github.com/xiidoz/netnou/issues/45)
* **page:** show links of the operator at the foot of the header card ([#48](https://github.com/xiidoz/netnou/issues/48)) ([2623d91](https://github.com/xiidoz/netnou/commit/2623d9139e1daf5cd084b5a5425356a7b2dc79cf)), closes [#43](https://github.com/xiidoz/netnou/issues/43)
* tell search engines and link previews what an instance shows ([#38](https://github.com/xiidoz/netnou/issues/38)) ([3196836](https://github.com/xiidoz/netnou/commit/3196836a663ce830d6f1676d1f3c0442d583a938)), closes [#35](https://github.com/xiidoz/netnou/issues/35)


### Bug Fixes

* **map:** draw the ring of the chosen vehicle in its colour, under its arrow and its flag ([#64](https://github.com/xiidoz/netnou/issues/64)) ([3c40dce](https://github.com/xiidoz/netnou/commit/3c40dce1138a0d31895d811becc421186f22f500))
* **map:** take the tooltip away once a vehicle is chosen or the map moves ([#62](https://github.com/xiidoz/netnou/issues/62)) ([00a1fd1](https://github.com/xiidoz/netnou/commit/00a1fd1b571c893b4f8cae099712a0457dc94423))
* **page:** show the settings as a small box at the gear and align the status line with the card ([#57](https://github.com/xiidoz/netnou/issues/57)) ([21f0505](https://github.com/xiidoz/netnou/commit/21f0505440972f460bc6aebcda79cf9452be19d3))

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
