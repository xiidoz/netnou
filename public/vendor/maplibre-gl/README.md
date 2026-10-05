# MapLibre GL JS (vendored)

[MapLibre GL JS](https://maplibre.org) 6.12.0, the map library of the page.
It is kept in the repository so that the page loads nothing from other
servers except the map itself and works without a package manager or a build
step.

| File | Origin |
| --- | --- |
| `maplibre-gl.mjs` | `dist/maplibre-gl.mjs` of the npm package `maplibre-gl` |
| `maplibre-gl-shared.mjs` | `dist/maplibre-gl-shared.mjs`, code that the page and the worker have in common |
| `maplibre-gl-worker.mjs` | `dist/maplibre-gl-worker.mjs`, which reads the tiles in a web worker |
| `maplibre-gl.css` | `dist/maplibre-gl.css` |
| `LICENSE.txt` | `LICENSE.txt` of the package (BSD 3-Clause, with the notices of the code it contains) |

The files are unmodified. Do not edit them. `.gitattributes` excludes this
folder from line-ending conversion so that they stay byte-identical to the
release.

The three `.mjs` files belong together and have to stay next to each other
under these names: `public/app.js` imports the first, which imports the
second and starts the third as a worker by its address. That is also why the
page's Content-Security-Policy needs no `blob:` for workers.

SHA-256, in the form used for Subresource Integrity:

```text
maplibre-gl.mjs         sha256-jgVF0QQik8uMHgmUnza6gyN/abT7wICVjPOIKWFbz2k=
maplibre-gl-shared.mjs  sha256-3z0LS6ll66/S3q48VoUAMIvimC2H2t13G6gtxaSaRjE=
maplibre-gl-worker.mjs  sha256-HsynF48KSWt5gNx6PGqMNXXtpnPPPp+jMk3M5+84kMI=
maplibre-gl.css         sha256-hFYHKtwsvwT3uEW8g7kM7FcbKTvTeBaXDmVm80lGq4s=
```

To recompute them:

```sh
openssl dgst -sha256 -binary maplibre-gl.mjs | openssl base64
```

The project publishes no hashes of the single files. These were computed from
the package `maplibre-gl-6.12.0.tgz` of the npm registry after checking it
against the `integrity` value the registry gives for that version.

## Left out on purpose

- The `-dev` builds, the type declarations and the rest of the package.
- The source maps (`*.mjs.map`, 2.5 MB each). Developer tools report them as
  missing; that is harmless.

## Updating

1. Download the package and check it, for example with
   `npm pack maplibre-gl@<version>`, which verifies the integrity value of
   the registry. Replace the five files here with those from `package/dist/`
   and `package/LICENSE.txt`.
2. Update the hashes and the version in this file and the version in
   [THIRD-PARTY-NOTICES.md](../../../THIRD-PARTY-NOTICES.md), and compare
   `LICENSE.txt` with the notices there.
3. If a file was added, removed or renamed: adjust `SHELL` in
   [`public/sw.js`](../../sw.js) and bump its `CACHE`.
4. Read the [changelog](https://github.com/maplibre/maplibre-gl-js/blob/main/CHANGELOG.md)
   for breaking changes. `public/app.js` uses `MapLibreMap`,
   `NavigationControl` and `AttributionControl`, and `public/style.css`
   restyles the controls by their `maplibregl-` class names.
5. Check the page in a browser, in the light and in the dark theme, and look
   at its console: a request the Content-Security-Policy of
   `server/index.js` blocks shows up there.
