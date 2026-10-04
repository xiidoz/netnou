# Leaflet (vendored)

[Leaflet](https://leafletjs.com) 1.9.4, the map library of the page. It is
kept in the repository so that the page loads nothing from other servers
except map tiles and works without a package manager or a build step.

| File | Origin |
| --- | --- |
| `leaflet.js` | `dist/leaflet.js` of the release |
| `leaflet.css` | `dist/leaflet.css` of the release |
| `LICENSE` | `LICENSE` of the release (BSD 2-Clause) |

The files are unmodified. Do not edit them. `.gitattributes` excludes this
folder from line-ending conversion so that they stay byte-identical to the
release.

SHA-256, in the form used for Subresource Integrity, as published on
<https://leafletjs.com/download.html>:

```text
leaflet.js   sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=
leaflet.css  sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=
```

To recompute them:

```sh
openssl dgst -sha256 -binary leaflet.js | openssl base64
```

## Left out on purpose

- The `images/` folder of the release (marker icons, layers icon). The page
  draws its own markers on a canvas and has no layers control, so
  `leaflet.css` refers to images that are never requested. Add the folder if
  `L.marker` with the default icon or `L.control.layers` is ever used.
- `leaflet.js.map`. Developer tools report the source map as missing; that is
  harmless.

## Updating

1. Download the release files, for example from
   `https://unpkg.com/leaflet@<version>/dist/leaflet.js`,
   `…/dist/leaflet.css` and `…/LICENSE`, and replace the three files here.
2. Compare their hashes with the values on the Leaflet download page and
   update this file.
3. Update the version in [THIRD-PARTY-NOTICES.md](../../../THIRD-PARTY-NOTICES.md).
4. Check the page in a browser.

Leaflet 2 is a breaking upgrade: `public/app.js` relies on the global `L` and
on the factory functions (`L.map`, `L.tileLayer`, …).
