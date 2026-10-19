# Changelog

All notable changes to Netnou, newest first. Versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is written by
[release-please](https://github.com/googleapis/release-please) from the commit
messages when a release is made. Do not edit it by hand; see
[Releases](CONTRIBUTING.md#releases).

## [0.17.1](https://github.com/xiidoz/netnou/compare/v0.17.0...v0.17.1) (2026-10-19)


### Bug Fixes

* **page:** no tooltip on a stop whose name is on the map ([#239](https://github.com/xiidoz/netnou/issues/239)) ([6d05ea7](https://github.com/xiidoz/netnou/commit/6d05ea7f2f7c5927a8cfbee249dd96a551b0eab1))

## [0.17.0](https://github.com/xiidoz/netnou/compare/v0.16.1...v0.17.0) (2026-10-19)


### Features

* **page:** bring the vehicle of a tapped departure into view ([#228](https://github.com/xiidoz/netnou/issues/228)) ([7f7aa7c](https://github.com/xiidoz/netnou/commit/7f7aa7cf0826174ffedf51738ce0e981d13902bc))
* **page:** lead the links to the software to its README, in German for a German page ([#218](https://github.com/xiidoz/netnou/issues/218)) ([a6c281b](https://github.com/xiidoz/netnou/commit/a6c281b182bfacb4274f9fae4a909834425c03c0))
* **page:** name every stop on the map from zoom 15 ([#236](https://github.com/xiidoz/netnou/issues/236)) ([b326b24](https://github.com/xiidoz/netnou/commit/b326b245b3f07fd133735a6859a16d91ee2ac771))
* **page:** say what the map can do, and give one tip on landing at a stop ([#229](https://github.com/xiidoz/netnou/issues/229)) ([53bbf3f](https://github.com/xiidoz/netnou/commit/53bbf3fbe0fd0058f6ea4cf87bea584fd3af01e6)), closes [#226](https://github.com/xiidoz/netnou/issues/226)
* **page:** stops on the map as pills with the dots of their kinds, named, easier to tap ([#235](https://github.com/xiidoz/netnou/issues/235)) ([60e1d52](https://github.com/xiidoz/netnou/commit/60e1d52bf5ac7cd8272838126fc8cbc2841bfc87)), closes [#222](https://github.com/xiidoz/netnou/issues/222)
* **page:** the search in sight on a phone, and one setting for the delays on the map ([#233](https://github.com/xiidoz/netnou/issues/233)) ([04c287f](https://github.com/xiidoz/netnou/commit/04c287f0d1c06a6fa818f37afa0c39b5eb09d3f7)), closes [#220](https://github.com/xiidoz/netnou/issues/220)


### Bug Fixes

* **page:** every line's name at 4.5:1 to its badge, in the details and on the map ([#214](https://github.com/xiidoz/netnou/issues/214)) ([ed749b1](https://github.com/xiidoz/netnou/commit/ed749b1eec55114b8f2c33e25f703a7e51862b09)), closes [#203](https://github.com/xiidoz/netnou/issues/203)
* **page:** name every icon button in a tooltip as well ([#217](https://github.com/xiidoz/netnou/issues/217)) ([5b4c126](https://github.com/xiidoz/netnou/commit/5b4c12689be655051f32120e9b6964e467a5c7ef))
* **page:** say that the positions come without GPS, and that the delays are what is live ([#227](https://github.com/xiidoz/netnou/issues/227)) ([6978b61](https://github.com/xiidoz/netnou/commit/6978b6181f951d367371ba364620911a26d77e89))
* **page:** white letters on every colour of the map, each colour dark enough for them ([#230](https://github.com/xiidoz/netnou/issues/230)) ([59a552f](https://github.com/xiidoz/netnou/commit/59a552fe39a4aa5e589d57f7c1134c1c13b873da)), closes [#215](https://github.com/xiidoz/netnou/issues/215)
* **server:** send odd forms of an address on, and show a page where nothing is ([#213](https://github.com/xiidoz/netnou/issues/213)) ([b8ce283](https://github.com/xiidoz/netnou/commit/b8ce283a59f9f9f0cffcacf509f04edb1bf116d9)), closes [#198](https://github.com/xiidoz/netnou/issues/198)
* **timetable:** destinations and stop names without the line-break marks of signs ([#237](https://github.com/xiidoz/netnou/issues/237)) ([ee84626](https://github.com/xiidoz/netnou/commit/ee8462679545f8a499bcbd58473f076a9343308d)), closes [#223](https://github.com/xiidoz/netnou/issues/223)
* **timetable:** the destination of a trip as the operator gives it at each stop ([#231](https://github.com/xiidoz/netnou/issues/231)) ([f312dac](https://github.com/xiidoz/netnou/commit/f312dacfe9b8f0e7c39be1cae86adf3161695a5b)), closes [#225](https://github.com/xiidoz/netnou/issues/225)

## [0.16.1](https://github.com/xiidoz/netnou/compare/v0.16.0...v0.16.1) (2026-10-18)


### Bug Fixes

* **page:** "tomorrow" only before the next day's departures, not before a late train ([#207](https://github.com/xiidoz/netnou/issues/207)) ([5a6d514](https://github.com/xiidoz/netnou/commit/5a6d51486779776ad3eabb36111cbb354922a597)), closes [#193](https://github.com/xiidoz/netnou/issues/193)
* **page:** a board of several stops shows a departure in every block and keeps its lists ([#200](https://github.com/xiidoz/netnou/issues/200)) ([92a532d](https://github.com/xiidoz/netnou/commit/92a532de35ebb63261d4143147272adc19ea88e7)), closes [#191](https://github.com/xiidoz/netnou/issues/191) [#192](https://github.com/xiidoz/netnou/issues/192)
* **page:** draw the delays as text dark or light enough to read ([#202](https://github.com/xiidoz/netnou/issues/202)) ([27c3e33](https://github.com/xiidoz/netnou/commit/27c3e339f5445e3698de5c3eb711bee50badd45b)), closes [#196](https://github.com/xiidoz/netnou/issues/196)
* **page:** give the keyboard focus back when details close or the search is left ([#208](https://github.com/xiidoz/netnou/issues/208)) ([5a1d5d9](https://github.com/xiidoz/netnou/commit/5a1d5d9856baf30c126d147b3b38ab69d7e97097)), closes [#194](https://github.com/xiidoz/netnou/issues/194)
* **page:** give the map's zoom buttons and the board's button names of their own in German ([#201](https://github.com/xiidoz/netnou/issues/201)) ([3c14092](https://github.com/xiidoz/netnou/commit/3c140922ba6d8f57e2f3f45880d1b6277aecd2e7)), closes [#197](https://github.com/xiidoz/netnou/issues/197)
* **page:** go back to what was open in one step, a board with all its stops ([#209](https://github.com/xiidoz/netnou/issues/209)) ([101ab2d](https://github.com/xiidoz/netnou/commit/101ab2d6c4534aad541d2bac6bf1519ea5b5791a)), closes [#188](https://github.com/xiidoz/netnou/issues/188) [#190](https://github.com/xiidoz/netnou/issues/190)
* **page:** keep the map's buttons beside open details, and above the sheet on a phone ([#204](https://github.com/xiidoz/netnou/issues/204)) ([28a0152](https://github.com/xiidoz/netnou/commit/28a01525bfbddf45fb000a5d767121a4fea4f7f6)), closes [#187](https://github.com/xiidoz/netnou/issues/187)
* **page:** no ring around the sheet that a result opens on a phone ([#211](https://github.com/xiidoz/netnou/issues/211)) ([fd6be9f](https://github.com/xiidoz/netnou/commit/fd6be9f76bd1eef14131e4c2968a341bceb48ba6))
* **page:** title a stop, line or trip in the language chosen in the settings ([#212](https://github.com/xiidoz/netnou/issues/212)) ([2cc1d09](https://github.com/xiidoz/netnou/commit/2cc1d0995cddbebce0877cbf818d09042f7882c3)), closes [#195](https://github.com/xiidoz/netnou/issues/195)
* **server:** leave out a compression the client refuses with q=0 ([#206](https://github.com/xiidoz/netnou/issues/206)) ([1d4cb4e](https://github.com/xiidoz/netnou/commit/1d4cb4eaa7b64b70674dd55a36523002c27a8331)), closes [#199](https://github.com/xiidoz/netnou/issues/199)
* **timetable:** show where a night line runs after midnight as well ([#210](https://github.com/xiidoz/netnou/issues/210)) ([1ddd78e](https://github.com/xiidoz/netnou/commit/1ddd78e2dd47860899ff3c8efb07e92c52c42c69)), closes [#189](https://github.com/xiidoz/netnou/issues/189)

## [0.16.0](https://github.com/xiidoz/netnou/compare/v0.15.2...v0.16.0) (2026-10-18)


### Features

* **page:** up to four stops on one board, each in a block of its own or in one list ([#185](https://github.com/xiidoz/netnou/issues/185)) ([7e5210f](https://github.com/xiidoz/netnou/commit/7e5210f92e0212b8f430ca5d71e0f6342b0feb52)), closes [#163](https://github.com/xiidoz/netnou/issues/163)

## [0.15.2](https://github.com/xiidoz/netnou/compare/v0.15.1...v0.15.2) (2026-10-17)


### Bug Fixes

* **page:** name the icons by addresses that change with them, and answer /favicon.ico ([#183](https://github.com/xiidoz/netnou/issues/183)) ([8a09cc7](https://github.com/xiidoz/netnou/commit/8a09cc706f18e08c86700f82a44da5407209f400))

## [0.15.1](https://github.com/xiidoz/netnou/compare/v0.15.0...v0.15.1) (2026-10-17)


### Bug Fixes

* **page:** give the card's links and colour buttons the room Lighthouse asks of a target ([#180](https://github.com/xiidoz/netnou/issues/180)) ([d953e07](https://github.com/xiidoz/netnou/commit/d953e074e7e312a6c7b8970cf03379711ac53317))


### Performance Improvements

* **page:** stop asking for a frame at every refresh while nothing on the page changes ([#181](https://github.com/xiidoz/netnou/issues/181)) ([9e5fe3f](https://github.com/xiidoz/netnou/commit/9e5fe3f3c95388c994a8c74b393ea5177235d272))

## [0.15.0](https://github.com/xiidoz/netnou/compare/v0.14.0...v0.15.0) (2026-10-17)


### Features

* **map:** draw the border of Germany, and grey out beyond it, for NETNOU_AREA=Germany ([#177](https://github.com/xiidoz/netnou/issues/177)) ([24538a2](https://github.com/xiidoz/netnou/commit/24538a2ab6fdda42c0b0e2466de70b33c14501a3))
* **page:** give a trip an address of its own, to share it and follow it ([#179](https://github.com/xiidoz/netnou/issues/179)) ([389d405](https://github.com/xiidoz/netnou/commit/389d405fd56dc053536e84c251d2f372a0886bab)), closes [#178](https://github.com/xiidoz/netnou/issues/178)
* **page:** load a new version by itself while nobody is using the page ([#173](https://github.com/xiidoz/netnou/issues/173)) ([aacb794](https://github.com/xiidoz/netnou/commit/aacb7948a122cead3bd9baaabbb52416a603e8be))


### Bug Fixes

* **page:** keep the section of the map a display's address names at a stop ([#172](https://github.com/xiidoz/netnou/issues/172)) ([1923527](https://github.com/xiidoz/netnou/commit/19235277350621c90f1d7ece192a89eb90726d28))


### Performance Improvements

* **page:** draw the vehicles only as often as the zoom needs ([#175](https://github.com/xiidoz/netnou/issues/175)) ([50bae10](https://github.com/xiidoz/netnou/commit/50bae10a78b1bc93b012acd8766a8f196d7ca8d0))
* **page:** paint the header card before the scripts have arrived ([#176](https://github.com/xiidoz/netnou/issues/176)) ([1965a36](https://github.com/xiidoz/netnou/commit/1965a36fcbbf5a91962adcb17918abe14b0b563b))

## [0.14.0](https://github.com/xiidoz/netnou/compare/v0.13.0...v0.14.0) (2026-10-16)


### Features

* **departures:** go on with the next ones where two hours hold few ([#171](https://github.com/xiidoz/netnou/issues/171)) ([0a3af68](https://github.com/xiidoz/netnou/commit/0a3af68918ca73d856e78aeaa67515a216451046)), closes [#165](https://github.com/xiidoz/netnou/issues/165)
* **page:** enlarge the departures of a stop into a board, for a dashboard or a wall ([#167](https://github.com/xiidoz/netnou/issues/167)) ([df25cec](https://github.com/xiidoz/netnou/commit/df25cec6efafa17cb3f5e222ef6f09e10386681b)), closes [#81](https://github.com/xiidoz/netnou/issues/81)
* **page:** open the settings beside the header card on a wide screen ([#169](https://github.com/xiidoz/netnou/issues/169)) ([b000bbc](https://github.com/xiidoz/netnou/commit/b000bbc2b28ac08f178ff5e80f77888795031ffb))
* **search:** find a town by its name and show all its stations on the map ([#161](https://github.com/xiidoz/netnou/issues/161)) ([92a8344](https://github.com/xiidoz/netnou/commit/92a83443a469729c7ac5214963fa8b91df8206a2)), closes [#24](https://github.com/xiidoz/netnou/issues/24)
* **settings:** let named sites show the page in a frame, such as a dashboard ([#170](https://github.com/xiidoz/netnou/issues/170)) ([3222d71](https://github.com/xiidoz/netnou/commit/3222d7163fd6cb66326d0b186ff04d4f5d66388b))


### Bug Fixes

* **page:** keep the open stop or line in the address while the controls are hidden ([#166](https://github.com/xiidoz/netnou/issues/166)) ([6b35934](https://github.com/xiidoz/netnou/commit/6b35934c628cb29d5acd876dc286922b48824d04))

## [0.13.0](https://github.com/xiidoz/netnou/compare/v0.12.0...v0.13.0) (2026-10-16)


### Features

* **server:** count a stop or a line opened in the page as a visit of its address ([#159](https://github.com/xiidoz/netnou/issues/159)) ([d87a525](https://github.com/xiidoz/netnou/commit/d87a5256b2701ef5c9faca54108d5c56d27b9e2b)), closes [#158](https://github.com/xiidoz/netnou/issues/158)

## [0.12.0](https://github.com/xiidoz/netnou/compare/v0.11.0...v0.12.0) (2026-10-16)


### Features

* **server:** report visits to an analytics service the operator names ([#156](https://github.com/xiidoz/netnou/issues/156)) ([0d94780](https://github.com/xiidoz/netnou/commit/0d94780c6d8a6faa3668c7df2547df90d0795e90)), closes [#114](https://github.com/xiidoz/netnou/issues/114)

## [0.11.0](https://github.com/xiidoz/netnou/compare/v0.10.0...v0.11.0) (2026-10-15)


### Features

* **page:** draw where a line runs, under its vehicles ([#151](https://github.com/xiidoz/netnou/issues/151)) ([f056c3e](https://github.com/xiidoz/netnou/commit/f056c3ed378bb7c30d0d7afad468a1aafefca440)), closes [#148](https://github.com/xiidoz/netnou/issues/148)
* **page:** give every stop and line an address of its own ([#146](https://github.com/xiidoz/netnou/issues/146)) ([629fe8a](https://github.com/xiidoz/netnou/commit/629fe8aec7a30f8ed0e298e0775766c7b7fa6090)), closes [#37](https://github.com/xiidoz/netnou/issues/37)
* **page:** let the badge of a trip lead to its line ([#149](https://github.com/xiidoz/netnou/issues/149)) ([6bae293](https://github.com/xiidoz/netnou/commit/6bae293811700ea47e2298915ae989cdc31a2874)), closes [#147](https://github.com/xiidoz/netnou/issues/147)
* **routes:** route long hops on roads, as coaches have them, along the main roads ([#144](https://github.com/xiidoz/netnou/issues/144)) ([c4c2861](https://github.com/xiidoz/netnou/commit/c4c286130e77f18713c783ee4d005a35500b94c9)), closes [#131](https://github.com/xiidoz/netnou/issues/131)
* **search:** without the visitor's position, put what the map shows first ([#155](https://github.com/xiidoz/netnou/issues/155)) ([cc48ec5](https://github.com/xiidoz/netnou/commit/cc48ec5b443f96822933f203e6a7d8fbbc8a8c76)), closes [#154](https://github.com/xiidoz/netnou/issues/154)


### Bug Fixes

* **page:** fit a line opened on a phone between the card and the details ([#150](https://github.com/xiidoz/netnou/issues/150)) ([fb05523](https://github.com/xiidoz/netnou/commit/fb055235f56344c9f622fc8e913e866d33505423))
* **timetable:** make lines of one name in places apart lines of their own ([#153](https://github.com/xiidoz/netnou/issues/153)) ([0d5049f](https://github.com/xiidoz/netnou/commit/0d5049fef9690f6f25d320eb43b050d61198d493)), closes [#152](https://github.com/xiidoz/netnou/issues/152)

## [0.10.0](https://github.com/xiidoz/netnou/compare/v0.9.0...v0.10.0) (2026-10-14)


### Features

* **map:** fold chips of more than two rows to a row and a half on wide screens ([#140](https://github.com/xiidoz/netnou/issues/140)) ([61c4e26](https://github.com/xiidoz/netnou/commit/61c4e261b3a1fc3d749299278441a19018993963)), closes [#139](https://github.com/xiidoz/netnou/issues/139)
* **map:** give ferries and cable cars & monorails kinds of their own, with chips and colours ([#137](https://github.com/xiidoz/netnou/issues/137)) ([ac43d4d](https://github.com/xiidoz/netnou/commit/ac43d4d01d635db2fb45789723dcefa226df90fd)), closes [#113](https://github.com/xiidoz/netnou/issues/113)
* **routes:** route ferries and cable cars & monorails along ways of their own ([#141](https://github.com/xiidoz/netnou/issues/141)) ([4a1d565](https://github.com/xiidoz/netnou/commit/4a1d565b61d31daf4e36aaaf03636e12c90be8cb)), closes [#136](https://github.com/xiidoz/netnou/issues/136)


### Bug Fixes

* **map:** fade the half row of folded chips out down to where it is cut ([#142](https://github.com/xiidoz/netnou/issues/142)) ([a6d1808](https://github.com/xiidoz/netnou/commit/a6d1808f08012d284a5429a71749e6c4a68de742))
* **routes:** let the U-Bahn and trams run on each other's tracks and on the light rail ([#143](https://github.com/xiidoz/netnou/issues/143)) ([f113b6b](https://github.com/xiidoz/netnou/commit/f113b6b8cb68da62f54f5bd98ab0c1ec37def4af)), closes [#128](https://github.com/xiidoz/netnou/issues/128)

## [0.9.0](https://github.com/xiidoz/netnou/compare/v0.8.0...v0.9.0) (2026-10-14)


### ⚠ BREAKING CHANGES

* **search:** /api/search sends the stations and lines in another form, described in docs/api.md: the names of the stations as one text, places as whole numbers of 1e-5 degrees that are differences from the entry before, modes and operators as numbers, the stations in another order and without ids. To get the departures of a station of that list, ask /api/departures for its place (at=latitude,longitude). station=<id> works as before for the stations of /api/stations and of a trip.
* **page:** in the answers of `/api/trip` and `/api/departures` a note is an object `{ "title": …, "text": … }` where it was a text. `text` is what the note was before; `title` is the headline the feed gives the alert, or `null`.

### Features

* **map:** thin out a zoomed-out map where a screen cannot take every vehicle ([#115](https://github.com/xiidoz/netnou/issues/115)) ([e45b3f2](https://github.com/xiidoz/netnou/commit/e45b3f2823321f0707851178d1ae48e66f1b59c8))
* **page:** put warnings first among the notices and give them a sign ([#119](https://github.com/xiidoz/netnou/issues/119)) ([91e49b4](https://github.com/xiidoz/netnou/commit/91e49b45fc8b741f39f7b783e08ce345b0563a44))
* **page:** show the warning sign of a train in the lists of a station and of a line ([#120](https://github.com/xiidoz/netnou/issues/120)) ([5c0e69f](https://github.com/xiidoz/netnou/commit/5c0e69fd194d3fcf939ad9c4228e622817577dd4))
* **routes:** keep a point of route geometry in 6 bytes, not 16 ([#132](https://github.com/xiidoz/netnou/issues/132)) ([48cd674](https://github.com/xiidoz/netnou/commit/48cd674484254779d46bfc2ce9dd86ef56eb5093))
* **routes:** keep the routes from one import to the next ([#130](https://github.com/xiidoz/netnou/issues/130)) ([ba47284](https://github.com/xiidoz/netnou/commit/ba4728499f678913db9dbfc580b7832fb2a617f9))
* **routes:** route the roads of a whole country in tiles ([#129](https://github.com/xiidoz/netnou/issues/129)) ([86eafa3](https://github.com/xiidoz/netnou/commit/86eafa3d496d6a61af8c36e1e8c5a0c98a593b7f))
* **routes:** say at start when no OpenStreetMap extracts are set ([#133](https://github.com/xiidoz/netnou/issues/133)) ([704e132](https://github.com/xiidoz/netnou/commit/704e132f8827bd903ff5b6f37efbabb71c10a548))
* **search:** find a stop by its town and show the town where the name does not say it ([#126](https://github.com/xiidoz/netnou/issues/126)) ([d0bc9ef](https://github.com/xiidoz/netnou/commit/d0bc9ef640a4d7a13d74e592c5d9477e958441f4)), closes [#121](https://github.com/xiidoz/netnou/issues/121)
* **search:** let an abbreviation that is typed find the word it stands for ([#125](https://github.com/xiidoz/netnou/issues/125)) ([83b0903](https://github.com/xiidoz/netnou/commit/83b090386ba5cb1881ca40fa905239974bd3aa20))
* **settings:** fetch the realtime feed once a minute unless set otherwise ([#117](https://github.com/xiidoz/netnou/issues/117)) ([de0e1df](https://github.com/xiidoz/netnou/commit/de0e1df853a91c740b5754e42cd695d389515b48))
* **settings:** let an instance cover the whole feed or single operators ([#112](https://github.com/xiidoz/netnou/issues/112)) ([a524b91](https://github.com/xiidoz/netnou/commit/a524b9195db1cd42abd6f4359698ca7af7c64374)), closes [#102](https://github.com/xiidoz/netnou/issues/102)
* **settings:** let NETNOU_AREA=Germany show all of Germany with its extract, name and view ([#134](https://github.com/xiidoz/netnou/issues/134)) ([b03d5d5](https://github.com/xiidoz/netnou/commit/b03d5d58c84aedefba97c270420254bbbba221a7))


### Bug Fixes

* **page:** keep long notices from pushing the timetable out of the details ([#118](https://github.com/xiidoz/netnou/issues/118)) ([35932bd](https://github.com/xiidoz/netnou/commit/35932bd8baa045ca58b9114d65d4d67976aa3993))


### Performance Improvements

* **realtime:** read the realtime feed in a thread of its own ([#116](https://github.com/xiidoz/netnou/issues/116)) ([c3e5521](https://github.com/xiidoz/netnou/commit/c3e552147b21c0ceab813ec5b628510591136fa7))
* **search:** load a smaller list of stops and search it without holding up the page ([#122](https://github.com/xiidoz/netnou/issues/122)) ([27ffb1d](https://github.com/xiidoz/netnou/commit/27ffb1de07d29a40b961d9bbfd5ef25961694e55))
* **timetable:** store each stop sequence and each set of running times once ([#110](https://github.com/xiidoz/netnou/issues/110)) ([9a48ebf](https://github.com/xiidoz/netnou/commit/9a48ebfe30c90fc74b3d5b98fe29e5cf3da34bac)), closes [#101](https://github.com/xiidoz/netnou/issues/101)

## [0.8.0](https://github.com/xiidoz/netnou/compare/v0.7.0...v0.8.0) (2026-10-12)


### ⚠ BREAKING CHANGES

* **settings:** every setting has a new name, the old one with NETNOU_ in front of it (SITE_NAME is NETNOU_SITE_NAME, BBOX is NETNOU_BBOX). The names without the prefix are no longer read: rename them in your compose file, stack or service unit before you update, or the instance runs with its defaults. In compose.yaml, PORT is now the port the host publishes.

### Features

* **settings:** put NETNOU_ in front of every setting ([#107](https://github.com/xiidoz/netnou/issues/107)) ([3920068](https://github.com/xiidoz/netnou/commit/3920068cab95de42da67bbed2cb1e893bb99a0e5)), closes [#98](https://github.com/xiidoz/netnou/issues/98)

## [0.7.0](https://github.com/xiidoz/netnou/compare/v0.6.3...v0.7.0) (2026-10-11)


### Features

* **settings:** let an operator set the title and description of the page ([#99](https://github.com/xiidoz/netnou/issues/99)) ([28b7f19](https://github.com/xiidoz/netnou/commit/28b7f19ae7a1830d1aa4550dcca7268c1aac1dfe))

## [0.6.3](https://github.com/xiidoz/netnou/compare/v0.6.2...v0.6.3) (2026-10-11)


### Performance Improvements

* **map:** load the map in a few frames instead of dozens ([#91](https://github.com/xiidoz/netnou/issues/91)) ([5131081](https://github.com/xiidoz/netnou/commit/51310817fe4a25208ef813e4d424ff4d7b2f7b71)), closes [#87](https://github.com/xiidoz/netnou/issues/87)
* **page:** fetch the scripts, the area and the map style at once ([#93](https://github.com/xiidoz/netnou/issues/93)) ([595b26f](https://github.com/xiidoz/netnou/commit/595b26fd5c836a405e648d96b9050a7cc01d2f28)), closes [#88](https://github.com/xiidoz/netnou/issues/88)
* **page:** send the page in the language the browser asks for ([#97](https://github.com/xiidoz/netnou/issues/97)) ([6c9c1b8](https://github.com/xiidoz/netnou/commit/6c9c1b803d6d15df87243f565765340f8dfd3e5f)), closes [#95](https://github.com/xiidoz/netnou/issues/95)
* **page:** show the header card before the scripts have run ([#96](https://github.com/xiidoz/netnou/issues/96)) ([ce172b9](https://github.com/xiidoz/netnou/commit/ce172b916fe508eca7dc2541d6327096f86f386f)), closes [#90](https://github.com/xiidoz/netnou/issues/90)
* **server:** send the files of the page compressed with Brotli ([#94](https://github.com/xiidoz/netnou/issues/94)) ([7b1dd9a](https://github.com/xiidoz/netnou/commit/7b1dd9a7542099a335e28abf28e834d6aa523f66))

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
