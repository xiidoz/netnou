# Material Design Icons (excerpt, vendored)

The icons on the page's own buttons are from
[Material Design Icons](https://pictogrammers.com/library/mdi/) by
Pictogrammers, version 7.4.47. Only the shapes the page uses are kept here,
so that it loads nothing from other servers and works without a package
manager or a build step.

| File | Origin |
| --- | --- |
| `icons.js` | one line per icon from `mdi.js` of the npm package `@mdi/js`, unchanged |
| `LICENSE` | `LICENSE` of that package (Pictogrammers Free License: the icons are under the Apache License 2.0) |
| `LICENSE-APACHE-2.0.txt` | the licence it names, from <https://www.apache.org/licenses/LICENSE-2.0.txt> |

Each line of `icons.js` is the shape of one icon as a path for a box of 24
by 24. `ICONS` in [`public/app.js`](../../app.js) gives each the name by
which `data-icon` asks for it in `index.html`, and `.icon` in
[`public/style.css`](../../style.css) gives it its size and its colour.

The icons of the zoom buttons, the location button and the credits are not
these: they are MapLibre's own and come with its style sheet.

## Adding an icon

1. Find it in the [library](https://pictogrammers.com/library/mdi/) and note
   its name, for example `mdiTrain`.
2. Download the package, for example with `npm pack @mdi/js@7.4.47`, which
   verifies the integrity value of the registry, and copy the line
   `export var mdiTrain = "…";` from `package/mdi.js` into `icons.js`,
   keeping the lines in the order of the alphabet.
3. Import it in `public/app.js` and give it a name in `ICONS`.

## Updating

Take the lines from the newer package and replace the two licence files if
they have changed. Then update the version here and in
[THIRD-PARTY-NOTICES.md](../../../THIRD-PARTY-NOTICES.md), and look at every
icon in a browser: a shape may have been redrawn.
