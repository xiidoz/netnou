# Contributing

Thank you for considering a contribution. This document says how the project
is set up and what a change is expected to look like.

## Ground rules

- **No runtime dependencies.** `package.json` has no `dependencies` and that
  is meant to stay so. The server runs on Node.js alone and the page loads
  nothing but its own files, the vendored map library and the map.
- **No build step.** What is in `public/` is what the browser gets.
- **Node.js 22 or newer** to run the server and the tests. The linter needs
  22.13 or newer; `.node-version` names the version used in CI and in the
  container image.
- **Language.** Code, comments, log lines, error messages, API texts and
  documentation are in English. Text that a visitor of the page reads lives
  only in `public/locales/`, in every language (see
  [docs/translating.md](docs/translating.md)).

## Getting started

```sh
git clone https://github.com/xiidoz/netnou.git
cd netnou
npm test          # works right away, nothing to install
npm ci            # development tools: the linter and the commit message check
npm run lint
```

`npm start` runs the server against the real feeds. The first start downloads
about 800 MB and takes a few minutes; later starts use the cache in `./data`.
`npm run dev` restarts the server when a file changes. Changes in `public/`
show on reload without a restart.

How the parts fit together is described in
[docs/architecture.md](docs/architecture.md).

## Project layout

```text
server/
  index.js            HTTP server and API
  config.js           settings
  lib/                import, route geometry, realtime, readers for the data formats
  areas/vgn.geojson   outline of the default area (generated)
public/
  index.html, app.js, style.css   the page
  search.js           finding stops and lines by name
  i18n.js, locales/   texts per language
  sw.js, manifest.webmanifest, icons/   installable app
  vendor/maplibre-gl/ vendored map library
  vendor/material-design-icons/   the icons of the buttons
test/                 tests and their fixtures (helpers.js)
tools/                scripts run by hand: default area, app icons
docs/                 documentation
```

## Tests

```sh
npm test
npm run test:coverage
```

The tests use Node's built-in test runner and need no network beyond
`127.0.0.1` and no files other than those in the repository:
`test/helpers.js` builds GTFS zips, GTFS-Realtime messages and OpenStreetMap
extracts in memory and provides a local web server that stands in for the
feed provider. `test/server.test.js` starts the real server against it and
exercises the API end to end; `test/frontend.test.js` checks what has to agree
between the page's files without running a browser.

A change in behaviour comes with a test. A bug fix comes with a test that
fails without the fix.

## Code style

The linter (`eslint.config.js`) only looks for mistakes; formatting follows
`.editorconfig` and the code around your change:

- ES modules, two spaces, single quotes, semicolons, LF line endings.
- Long lines are fine where breaking them would not make the code clearer.
  There is no automatic formatter; do not reformat code you are not changing.
- Comments say why, not what, and are worth reading: explain the reason for
  a number, a special case or an order of steps. Keep them true when the code
  changes.
- Small, direct code over abstractions for cases that do not exist yet.

## Commit messages

Commit messages follow
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). This
is not a matter of taste: the next version number, the changelog and the
release are worked out from them (see [Releases](#releases)).

```text
<type>(<scope>)[!]: <summary>

[body: what changes and why, where the summary does not say it all]

[footers, for example "BREAKING CHANGE: …" or "Refs: #12"]
```

For example:

```text
feat(api): add the platform to departures
```

```text
fix(realtime): keep the delays of a trip whose update lacks a stop sequence
```

```text
feat(api)!: rename the mode ids

BREAKING CHANGE: /api/vehicles reports "suburban" instead of "sbahn".
```

The type says what kind of change it is, and with that what it does to the
version:

| Type | Use it for | Release |
| --- | --- | --- |
| `feat` | something new for visitors, operators or API clients | minor version |
| `fix` | a bug fix | patch version |
| `perf` | faster or leaner, same behaviour | patch version |
| `revert` | taking back an earlier commit | patch version |
| `docs` | documentation only | none |
| `test` | tests only | none |
| `refactor` | restructuring without a change in behaviour | none |
| `style` | formatting, no change in meaning | none |
| `build` | container image, packaging, development dependencies | none |
| `ci` | workflows in `.github/` | none |
| `chore` | anything else that changes neither the code nor its tests | none |

- **Summary:** imperative ("add", not "added"), lower case, no full stop,
  the whole first line at most 100 characters. Write it for someone reading
  the changelog: say what changes for them, not which file was touched.
  For the title of a pull request the 100 include what GitHub puts behind
  it on `main`, a space and the number as in `(#123)`: that leaves 93 for
  the title.
- **Scope:** required. It names the part the change is about, in one word,
  and stands in front of the line in the changelog. Take the one a reader
  would look under:
  - `page` for what visitors see and do, or the part of it: `map`, `search`;
  - `settings` for what operators set, `api` for what clients of the API get;
  - `realtime`, `timetable`, `server` for the inner workings;
  - `i18n`, `docker`, `deps`, `release`;
  - for documentation the document: `readme`, `contributing`, `api`.

  A new part may get a new scope; the list is not closed.
- **Breaking changes** get a `!` before the colon and a `BREAKING CHANGE:`
  footer that says what to do. While Netnou is at 0.x they lead to a new
  minor version (0.3.2 to 0.4.0), from 1.0.0 on to a new major version. Mark
  them all the same: the changelog lists them under their own heading. A
  change is breaking when operators or API clients have to act: an endpoint, field or
  mode id is removed or renamed, a setting is removed, renamed or changes its
  meaning, the minimum Node.js version is raised. New settings and fields are
  not breaking, and neither is a new cache format (the caches rebuild
  themselves).

The convention is checked twice, the scope included. `npm ci` installs a git
hook that rejects a commit with a malformed message right away, and CI checks every commit of a
pull request and its title, as it will stand on `main` (`.github/workflows/commits.yml`). To correct a
message, use `git commit --amend` for the last commit and `git rebase -i` for
earlier ones.

## Generated and vendored files

- **`server/areas/vgn.geojson`** is written by `npm run build:area`, which
  asks OpenStreetMap's Nominatim service for the outlines of the cities and
  districts of the VGN. Regenerate it only when the network area changes:
  different polygons give the area a different id, and every running instance
  then imports the timetable again and downloads the OpenStreetMap extracts
  again. See [server/areas/README.md](server/areas/README.md).
- **`public/icons/*.png`** are rendered from `public/favicon.svg` by
  `npm run build:icons`, which needs Chrome, Chromium or Edge (set `CHROME`
  to its path if it is not found). Run it after changing the favicon and
  commit the result.
- **`docs/social-preview.png`**, the image shown where the repository is
  linked in chats and on social media, is put together from
  `docs/screenshot.png` and the favicon by `npm run build:social`, with the
  same browser. Run it after renewing the screenshot and commit the result.
  GitHub does not take the image from the repository: a maintainer uploads it
  under Settings → General → Social preview.
- **`public/vendor/maplibre-gl/`** holds unmodified files of the MapLibre GL
  JS release. Do not edit them; see
  [public/vendor/maplibre-gl/README.md](public/vendor/maplibre-gl/README.md)
  for updating.
- **`public/vendor/material-design-icons/`** holds the shapes of the icons
  on the page's own buttons, taken from Material Design Icons. An icon is
  never a character or drawn by hand: where a character sits depends on the
  device's font. Its
  [README](public/vendor/material-design-icons/README.md) says how to add
  one.

## Cache formats

The server keeps derived data on disk and the browser keeps files for the
offline start. When you change what is stored, bump the matching constant, or
running instances will load data written by older code:

| Constant | Bump when |
| --- | --- |
| `DATASET_VERSION` in `server/lib/importer.js` | the layout or meaning of anything in the dataset changes, including the route geometry |
| `NETWORKS_VERSION` in `server/lib/shapes.js` | the classification of ways, the cost factors or the stored form of the networks change |
| `CACHE` in `public/sw.js` | a file is removed from `SHELL` or renamed. Changed files need no bump |

## Pull requests

- One topic per pull request, with a description of what changes and why.
- A change that shows in the page comes with pictures of it in the
  description: what it looks like now, on a wide screen and on a phone, and
  what it looked like before where that makes the difference clear. They
  let somebody judge the change without running it.
- The title of the pull request and its commits follow
  [the commit message convention](#commit-messages). The title becomes the
  commit message when the pull request is squashed.
- `npm test` and `npm run lint` pass. CI runs both on Linux and Windows.
- No new runtime dependency.
- The documentation is updated when a setting or an API answer changes
  ([docs/configuration.md](docs/configuration.md),
  [docs/api.md](docs/api.md)). `CHANGELOG.md` is not edited: it is written
  from the commit messages.
- A cache format version is bumped where needed (see above).
- New text in the page is added to every locale file.

`main` only takes pull requests, and only those that contain its latest
commit and have passed the checks "CI passed" and "Conventional Commits". A
pull request that was opened before another one was merged has to be brought
up to date first, with "Update branch" or by rebasing it; its checks then
run again.

## Releases

Releases are made by
[release-please](https://github.com/googleapis/release-please)
(`.github/workflows/release.yml`); nobody sets a version or writes the
changelog by hand.

1. After every push to `main`, release-please updates a pull request named
   `chore(main): release X.Y.Z`. It contains the next version in
   `package.json` and the new section of [CHANGELOG.md](CHANGELOG.md), both
   worked out from the commit messages since the last release. As long as
   there are only commits that lead to no release (see the table above),
   there is no such pull request.
2. Merging that pull request is the release. The commit is tagged `vX.Y.Z`,
   a GitHub release with the same notes is published, and the container image
   is pushed as `latest`, `X.Y.Z` and `X.Y`. (Every commit on `main` is
   pushed as `edge`, released or not.)

The workflow tells each image what it is, through the build arguments
`COMMIT` and `RELEASE` of the `Dockerfile`: the image of a release reports
its number as its version, any other reports `edge` and its commit. Without
them, as in a checkout, the server reports the number in `package.json` with
`+dev` (`describeBuild` in `server/lib/update.js`).

Netnou stays at 0.x while much is still changing: features and breaking
changes raise the minor version, fixes the patch version
(`bump-minor-pre-major` in `release-please-config.json`). Nothing moves it to
1.0.0 by itself. That step is a decision, taken by adding the footer
`Release-As: 1.0.0` to a commit message; the release pull request then
proposes that version. The same footer works for any other version you want
to choose yourself.

The rule for `main` (see [Pull requests](#pull-requests)) holds for the
release pull request too, and there it matters most: it cannot be merged
while `main` has a commit that it does not contain. Release 0.3.0 went out
without one of its fixes in the notes because GitHub had started no workflow
for a merge, and nothing kept the release pull request from being merged as
it was.

The workflow sees to it that the release pull request contains the latest
commit of `main` after every push, whatever was pushed. release-please
writes it anew when a merge adds something to the notes; after a merge that
adds nothing to them (docs, tests, CI) it leaves the pull request as it is,
and a second step of the workflow moves it on top of `main`, with the
version and the changelog as release-please made them.

Should the release pull request be behind `main` all the same:

1. See under Actions that the workflow "Release" has run for the latest
   commit of `main`. If it has not, start it by hand for `main` (Actions →
   Release → Run workflow) and wait for it.
2. If the pull request is still behind after that, the run says so in a
   warning, and what the pull request lacks adds nothing to the notes: bring
   it up to date with "Update branch".

Not the other way round: "Update branch" brings in the commits but not their
lines in the changelog, so it must not stand in for a run of the workflow
that did not happen.

For maintainers, three things outside the repository files:

- Under Settings → Actions → General, "Allow GitHub Actions to create and
  approve pull requests" has to be switched on, or release-please cannot open
  its pull request.
- GitHub does not start workflows for what a workflow does with its own
  token, so the checks of the release pull request do not run by themselves.
  They are needed for merging it: start them by hand each time the workflow
  has written or moved it, or store a personal access token (or an app
  token) with write access to contents, pull requests and issues as the
  secret `RELEASE_PLEASE_TOKEN`, with which they start by themselves.
- The rule for `main` is a ruleset under Settings → Rules: a pull request is
  required, and so are the status checks "CI passed" and "Conventional
  Commits" together with "Require branches to be up to date before merging".
  Nobody is exempt from it.

### Deploying what was built

The workflow can tell a server to fetch the image it has just pushed, and
then wait until an instance there runs it. Nothing in the repository says
where that is: the addresses are settings of the repository on GitHub
(Settings, Secrets and variables, Actions). A fork has none, and the job
`deploy` then has nothing to do.

| Setting | Kind | Meaning |
| --- | --- | --- |
| `DEPLOY_HOOK` | secret | an address that is called with `POST` once the image is pushed. Whatever answers there fetches the image and starts the containers that use it anew: the HTTP API of Watchtower for example, `https://…/v1/update?image=ghcr.io/xiidoz/netnou` |
| `DEPLOY_HOOK_TOKEN` | secret | sent with that call as a bearer token, if set |
| `DEPLOY_STATUS_EDGE` | variable | the address of `/api/status` of an instance that follows `edge` |
| `DEPLOY_STATUS_RELEASE` | variable | the same of an instance that follows `latest`; looked at after a release only |

After the call the job asks each instance named for its status until it
reports the commit that was built, for ten minutes at most. A run that fails
there has still published the image: it says that the instance does not run
it. Write a host name with letters outside ASCII in its `xn--` form.

## Reporting bugs

Use the bug report form. The most useful things to include are the output of
`/api/status` of the instance and the log lines around the problem.

Two kinds of problem cannot be fixed here:

- **Wrong times, delays, stops or notes** come from the feed. Report them to
  the feed provider ([gtfs.de](https://gtfs.de) for the default feeds).
- **Wrong routes between stops** come from OpenStreetMap, or from the
  shortest path not being the real one. A missing or wrong road or track is
  [fixed in OpenStreetMap](https://www.openstreetmap.org/fixthemap) and
  reaches Netnou with the next update of the extracts.

Security problems are not reported in public issues, see
[SECURITY.md](SECURITY.md).

## Licence of contributions

Netnou is under the [MIT License](LICENSE). By contributing you agree that
your contribution is licensed under the same terms. There is no contributor
licence agreement.

Everyone taking part is expected to follow the
[code of conduct](CODE_OF_CONDUCT.md).
