# Translating

The page is available in 54 languages, those of `LANGUAGES` in
`public/i18n.js`. Each language is one file in
`public/locales/`, and adding a language needs no build step and no change to
the server.

## How a visitor gets a language

1. The language they chose in the page, if any. The choice is stored in the
   browser (`localStorage`, key `netnou.lang`).
2. Otherwise the language the address asks for, if it names one the page
   has: `?lang=de`.
3. Otherwise the first of the browser's preferred languages that exists. A
   browser asking for `de-AT` gets `de`, and one asking for Norwegian by
   `no` gets Norwegian Bokmål (`nb`).
4. Otherwise English.

A visitor changes the language behind the gear: the first row of the
settings names the language in use by its own name (and, where the browser
asks for no language like it, by its name in the browser's too) and opens
the list of all. The list puts the visitor's languages first and the others
in the order of `LANGUAGES`, each with its name in the page's language below
(from the browser's `Intl.DisplayNames`, so nothing to translate; see
[Languages a browser has no formats for](#languages-a-browser-has-no-formats-for)), and its
search finds a language by its own name, its name in the page's language, in
the browser's languages or in English, its code, or a spelling of
`ALIASES` in `public/languages.js`.

A choice loads the language's texts first, then the page again in it, from
the address without `?lang=…`. Choosing the language the browser would get
anyway forgets the choice, so that the page follows the browser again. Where
the browser asks for no language like the one chosen, the page then offers
the way back in a bubble, in the language it leads back to.

The server sends the page in that language from the start. A browser names
the languages of its user with every request (`Accept-Language`), and the
server picks among them by steps 2 to 4, as the page does. So the page
arrives as the visitor gets it, and its header card shows as soon as it is
there. Step 1 the server cannot take: a language chosen in the page stays
in the browser. For such a visitor the card shows once the script has put
their language in, a moment later. Whoever names no language at all, as
search engines do as a rule, gets the main language of the instance
(`NETNOU_LANGUAGE`).

The address with a language is there for search engines, whose browser
speaks English and chooses nothing: it is how they get to read the page in
each language. What they read before any script runs is written into the
page by the server, in the main language of the instance (`NETNOU_LANGUAGE`) or
the one the address asks for; see
[Being found](configuration.md#being-found). A new language is one of these
addresses by itself.

Where the address asks for one language and the browser for another the page
has (by step 3), as when someone opens a link that was shared from the
English page, the page offers the browser's language in a bubble, written in
that language. Switching is choosing it in the page (step 1). "Don't ask
again" ends the offer in that browser (`localStorage`, key
`netnou.offerLanguage`); its ✕, a tap elsewhere or Escape put it away until
the next visit.

## Adding a language

Two steps, here for Dutch (`nl`):

1. Copy `public/locales/en.js` to `public/locales/nl.js` and translate the
   values. Keep the keys as they are. The three `offer.` texts offer the
   language itself, so they name Dutch, not English.
2. Add the language to `LANGUAGES` in `public/i18n.js`, with its own name for
   itself:

   ```js
   export const LANGUAGES = [
     ['de', 'Deutsch'],
     ['en', 'English'],
     ['nl', 'Nederlands'],
   ];
   ```

Then run `npm test`. `test/frontend.test.js` fails if one of the steps was
forgotten or if the new file does not fit the English one, and says what is
wrong.

### Languages a browser has no formats for

Times, days, months, lists, numbers and the names of languages come from the
browser (`Intl`). Chrome leaves out the formats of a few languages (Belarusian,
Hausa, Icelandic, Irish, Kurdish, Macedonian, Maltese, Albanian) and would write
them in another language: "6 PM" and "Monday" on a page in Icelandic. The
files of these languages therefore end in `export const formats`, which the
page uses only where the browser has no formats of its own. It is taken from
the Unicode data in Node and not translated by hand:

```sh
node tools/build-locale-formats.mjs
```

Run it after adding a language, since each of these files names all the
languages; `npm test` says so where it is due. A new language that Chrome
lacks too goes into `WITHOUT_FORMATS` in that tool and in
`test/frontend.test.js`.

## Rules for a locale file

English is the reference. A locale file has exactly the keys of `en.js`.

- **Placeholders** in braces are filled in by the page and must be kept:
  `'delays as of {seconds} s ago'` → `'Verspätungen: Stand vor {seconds} s'`. They may move
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
<span data-i18n="about.title">How it works</span>
<button data-i18n-aria-label="panel.close" aria-label="Close">×</button>
```

`data-i18n` sets the text of the element, `data-i18n-aria-label`,
`data-i18n-title`, `data-i18n-content` and `data-i18n-placeholder` set the
attribute of that name. The text in the HTML is the English one, and the
test keeps it equal to `en.js`. The server puts the text of the page's
language in its place when it sends the page, and the script that of the
visitor's where that is another.

The test also fails when a key is no longer used anywhere, and when `app.js`
contains text for visitors that does not go through `t()`.

### A language written right to left

Arabic, Hebrew, Persian and Urdu are read right to left. One more step for such
a language: add its code to `RIGHT_TO_LEFT` in `public/i18n.js`, and to
`ARABIC_COMMA` there where it writes the comma as "،". The server then writes
`dir="rtl"` on the page and tells `first.js` which languages read that way, so
that a language chosen in the page has its direction before the first paint.

The texts are written as they are read, with **no marks of direction** in them
(`npm test` refuses them). `t()` isolates every value it fills in (U+2068 …
U+2069), so that a Latin stop name with brackets, a time or a number stays
whole in the sentence; it does so by the language of the texts, and not at all
in a left-to-right language.

What the page does with it:

- **Everything that reads is mirrored**, by the logical rules of `style.css`
  (`margin-inline-start`, `inset-inline-end`, `text-align: start`). A new rule
  for something that reads should be written that way, and with `--safe-start`
  and `--safe-end` for the edges of the screen. What logical rules cannot say
  is in the block "right to left" at the end of the file.
- **The map is not.** North stays north: `#map` is `dir="ltr"`, its canvas, its
  controls and its credits are as in any other language, and its buttons stay
  bottom right. So the details lie on the left on a wide screen, the header
  card on the right, and what the script places by measuring knows that
  (`rightToLeft()` in `public/i18n.js`).
- **Numbers read left to right**: a delay is `+2`, a sum `13:39+2`, a range of
  times `05:13–23:40`. A range with the language's own letters in it, as Arabic
  has for AM and PM, is read from the right, each end whole (`timeRange`).
- **Signs that point are mirrored** (chevrons, the way back, the arrow towards
  a direction); those that do not (gear, lens, heart, share, ✕, 文A) stay.

## What is not translated

- **Data from the feeds:** names of stops, lines and operators, and the notes
  and alerts of the feed. They appear as the feed provides them.
- **What the operator sets:** the name of the instance and its links
  (`NETNOU_SITE_NAME`, `NETNOU_LINKS`) are shown as they are, in one language. A title
  and a description of their own (`NETNOU_SITE_TITLE`, `NETNOU_SITE_DESCRIPTION`) are
  one text for every language, or texts by language where the operator
  gives them so.
- **The installed app's name and description.** The server writes them into
  `manifest.webmanifest` once, in the main language of the instance
  (`NETNOU_LANGUAGE`), for everybody who installs it.
- **Log lines, error messages and API texts of the server.** They are for
  operators and are in English.

## Trying it locally

`npm start` runs the server against the real feeds, which downloads several
hundred MB on the first start. To look at a translation, pick the language in
the page, or start a browser in that language.
