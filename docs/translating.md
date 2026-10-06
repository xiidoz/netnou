# Translating

The page is available in German and English. Each language is one file in
`public/locales/`, and adding a language needs no build step and no change to
the server.

## How a visitor gets a language

1. The language they chose in the page, if any. The choice is stored in the
   browser (`localStorage`, key `netnou.lang`).
2. Otherwise the first of the browser's preferred languages that exists. A
   browser asking for `de-AT` gets `de`.
3. Otherwise English.

Changing the language in the page reloads it.

## Adding a language

Three steps, here for Dutch (`nl`):

1. Copy `public/locales/en.js` to `public/locales/nl.js` and translate the
   values. Keep the keys as they are.
2. Add the language to `LANGUAGES` in `public/i18n.js`, with its own name for
   itself:

   ```js
   export const LANGUAGES = [
     ['de', 'Deutsch'],
     ['en', 'English'],
     ['nl', 'Nederlands'],
   ];
   ```

3. Add `'locales/nl.js'` to `SHELL` in `public/sw.js`, so that the installed
   app can start offline in that language.

Then run `npm test`. `test/frontend.test.js` fails if one of the steps was
forgotten or if the new file does not fit the English one, and says what is
wrong.

## Rules for a locale file

English is the reference. A locale file has exactly the keys of `en.js`.

- **Placeholders** in braces are filled in by the page and must be kept:
  `'realtime {seconds} s ago'` → `'Echtzeit vor {seconds} s'`. They may move
  within the sentence.
- **Plural forms.** Where the wording depends on a number, the value is an
  object with one text per plural category of the language:

  ```js
  'status.vehicles': { one: '{count} vehicle', other: '{count} vehicles' },
  ```

  The categories are those of
  [`Intl.PluralRules`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)
  for the language. English and German have `one` and `other`; Polish, for
  example, has `one`, `few`, `many` and `other`, and its file has to give all
  four. The test checks this.
- **Comments** in `en.js` explain where a text appears and what a placeholder
  stands for. Translating them is optional.
- Numbers and times of day are formatted by the browser for the language;
  there is nothing to translate. Times are always those of the area's time
  zone, not the visitor's.

## Adding or changing a text

A new text for the page needs a key in every locale file; the test fails
otherwise. Use it in `public/app.js` through `t('some.key', { … })`, or in
`public/index.html` through an attribute:

```html
<span data-i18n="colorBy.title">Colour by</span>
<button data-i18n-aria-label="panel.close" aria-label="Close">×</button>
```

`data-i18n` sets the text of the element, `data-i18n-aria-label`,
`data-i18n-title`, `data-i18n-content` and `data-i18n-placeholder` set the
attribute of that name. The English text in the HTML is what shows until the
script has run, and the test keeps it equal to `en.js`.

The test also fails when a key is no longer used anywhere, and when `app.js`
contains text for visitors that does not go through `t()`.

## What is not translated

- **Data from the feeds:** names of stops, lines and operators, and the notes
  and alerts of the feed. They appear as the feed provides them.
- **The installed app's name and description** in
  `public/manifest.webmanifest`. That file is static and in English.
- **Log lines, error messages and API texts of the server.** They are for
  operators and are in English.

Right-to-left languages are not prepared: the page sets no text direction.

## Trying it locally

`npm start` runs the server against the real feeds, which downloads several
hundred MB on the first start. To look at a translation, pick the language in
the page, or start a browser in that language.
