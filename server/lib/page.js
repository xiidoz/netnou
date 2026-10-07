// What a search engine reads, and what a chat shows of a link, is the page as
// the server sends it: no script has run yet. So the server writes into
// index.html what the instance is – the name of its area in the title, the
// description and the heading, in its main language – and where it is to be
// found. The same texts are put in by the script for whoever looks at the page
// (pageTexts in public/i18n.js).
//
// The page picks its language in the browser, which a search engine never
// gets to see in another language than that of its own browser. Hence an
// address per language, ?lang=de, which the page names as its other versions.

import fs from 'node:fs';
import path from 'node:path';
import { LANGUAGES, pageTexts } from '../../public/i18n.js';

export const LANGUAGE_CODES = LANGUAGES.map(([code]) => code);
// The picture of a link's preview: the icon, unless the operator has one of
// their own, wide as chats show it.
const PREVIEW_ICON = { path: 'icons/icon-512.png', size: 512 };

// What an operator may bring files of their own for, in a folder outside the
// repository: by the name of the file there, the address it is served under.
// The icons take the place of the built-in ones; the preview is theirs alone.
const OWN_ICONS = {
  'favicon.svg': 'favicon.svg',
  'icon-192.png': 'icons/icon-192.png',
  'icon-512.png': 'icons/icon-512.png',
  'icon-maskable-512.png': 'icons/icon-maskable-512.png',
  'apple-touch-icon.png': 'icons/apple-touch-icon.png',
};
const OWN_PREVIEWS = ['preview.png', 'preview.jpg'];

/**
 * The operator's own files in `dir`, as far as they are there.
 * @param dir the folder, or null; one that does not exist is one without files
 * @returns { files, preview }: the files by the address they are served
 *   under, and the address of the picture for previews, null without one
 */
export function ownFiles(dir) {
  const files = new Map();
  const isFile = (name) => fs.statSync(path.join(dir, name), { throwIfNoEntry: false })?.isFile() ?? false;
  if (!dir) return { files, preview: null };
  for (const [name, address] of Object.entries(OWN_ICONS)) if (isFile(name)) files.set(address, path.join(dir, name));
  const preview = OWN_PREVIEWS.find(isFile) ?? null;
  if (preview) files.set(preview, path.join(dir, preview));
  return { files, preview };
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The address of the page in one language, or without one in that of the visitor's browser. */
const addressIn = (publicUrl, language) => (language ? `${publicUrl}?lang=${language}` : publicUrl);

/** The versions of the page in each language and the one that follows the browser, as [hreflang, address]. */
const versions = (publicUrl) => [...LANGUAGE_CODES.map((code) => [code, addressIn(publicUrl, code)]), ['x-default', publicUrl]];

/**
 * index.html as it is sent.
 * @param html the file
 * @param language what its texts are to be in
 * @param asked the language the address asked for, null if it named none
 * @param texts the texts of that language (a module of public/locales)
 * @param siteName what the instance calls itself
 * @param areaName may be empty
 * @param links the operator's own, [{ text, href }], at the foot of the header card
 * @param preview the address of the operator's picture for previews of
 *   links (ownFiles), null to show the icon
 * @param publicUrl the address of the instance with a slash at its end, or
 *   null: then all that needs a full address is left out
 * @param listed whether search engines may list the page; if not, it asks
 *   them not to and leaves out what is there for them alone
 */
export function renderPage(html, { language, asked, texts, siteName, areaName, links = [], preview = null, publicUrl, listed }) {
  const { title, description } = pageTexts(areaName, texts, siteName);
  let page = html;
  const put = (pattern, replacement) => {
    // (index.html has changed and this file has not: better no page than one that says the wrong thing)
    if (!pattern.test(page)) throw new Error(`index.html: nothing matches ${pattern}`);
    page = page.replace(pattern, replacement);
  };
  put(/<html lang="[^"]*">/, () => `<html lang="${language}">`);
  put(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  put(/(<meta name="description" content=")[^"]*"/, (_, start) => `${start}${escapeHtml(description)}"`);
  put(/(<meta name="apple-mobile-web-app-title" content=")[^"]*"/, (_, start) => `${start}${escapeHtml(siteName)}"`);
  put(/(<h1>)[^<]*/, (_, start) => `${start}${escapeHtml(siteName)}`);
  put(/(<p id="area-name">)[^<]*/, (_, start) => `${start}${escapeHtml(areaName)}`);
  // (in a new tab, like the links of the credits: the map stays where it is)
  const anchors = links.map(({ text, href }) => `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(text)}</a>`).join('');
  put(/(<nav class="links"[^>]*?) hidden><\/nav>/, (whole, start) => (links.length ? `${start}>${anchors}</nav>` : whole));

  // For previews of a link (Open Graph, which the others read as well).
  const tags = [
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${escapeHtml(siteName)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    // (a picture of the operator's own is a wide one and shown large; the icon is not)
    `<meta name="twitter:card" content="${preview && publicUrl ? 'summary_large_image' : 'summary'}">`,
  ];
  // (also said with every answer of the server, see NOT_LISTED in index.js)
  if (!listed) tags.push('<meta name="robots" content="noindex">');
  if (publicUrl) {
    const address = escapeHtml(addressIn(publicUrl, asked));
    if (listed) {
      tags.push(
        `<link rel="canonical" href="${address}">`,
        ...versions(publicUrl).map(([code, href]) => `<link rel="alternate" hreflang="${code}" href="${escapeHtml(href)}">`),
      );
    }
    tags.push(`<meta property="og:url" content="${address}">`);
    if (preview) {
      tags.push(`<meta property="og:image" content="${escapeHtml(publicUrl + preview)}">`);
    } else {
      tags.push(
        `<meta property="og:image" content="${escapeHtml(publicUrl + PREVIEW_ICON.path)}">`,
        `<meta property="og:image:width" content="${PREVIEW_ICON.size}">`,
        `<meta property="og:image:height" content="${PREVIEW_ICON.size}">`,
      );
    }
  }
  put(/\n<\/head>/, () => `\n${tags.map((tag) => `  ${tag}`).join('\n')}\n</head>`);
  return page;
}

/**
 * The manifest of the installed app as it is sent: the file, with the name of
 * the instance, and its language and description in place of the English ones.
 * @param json the file
 */
export function renderManifest(json, { language, texts, siteName, areaName }) {
  const manifest = JSON.parse(json);
  return JSON.stringify({ ...manifest, name: siteName, short_name: siteName, description: pageTexts(areaName, texts, siteName).description, lang: language }, null, 2);
}

/**
 * Search engines may read everything, also on an instance that is not to be
 * listed: what is not to be listed says so itself, in a header of the answer,
 * and a search engine that may not read it would never get to see that.
 * @param sitemapAt the address of the instance if it has a sitemap, else null
 */
export function robotsTxt(sitemapAt) {
  return `User-agent: *\nAllow: /\n${sitemapAt ? `\nSitemap: ${sitemapAt}sitemap.xml\n` : ''}`;
}

/** The addresses of the page, each with the others as its versions in other languages. */
export function sitemapXml(publicUrl) {
  const escapeXml = (text) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  const all = versions(publicUrl);
  const links = all.map(([code, href]) => `    <xhtml:link rel="alternate" hreflang="${code}" href="${escapeXml(href)}"/>`).join('\n');
  // (the one that follows the browser first: it is the address people pass on)
  const urls = [all.at(-1), ...all.slice(0, -1)].map(([, href]) => `  <url>\n    <loc>${escapeXml(href)}</loc>\n${links}\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}
