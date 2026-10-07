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

import { LANGUAGES, pageTexts } from '../../public/i18n.js';

export const LANGUAGE_CODES = LANGUAGES.map(([code]) => code);
// The picture of a link's preview: the icon, which says nothing about a place.
const PREVIEW_IMAGE = { path: 'icons/icon-512.png', size: 512 };

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
 * @param publicUrl the address of the instance with a slash at its end, or
 *   null: then all that needs a full address is left out
 * @param listed whether search engines may list the page; if not, it asks
 *   them not to and leaves out what is there for them alone
 */
export function renderPage(html, { language, asked, texts, siteName, areaName, links = [], publicUrl, listed }) {
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
    '<meta name="twitter:card" content="summary">',
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
    tags.push(
      `<meta property="og:url" content="${address}">`,
      `<meta property="og:image" content="${escapeHtml(publicUrl + PREVIEW_IMAGE.path)}">`,
      `<meta property="og:image:width" content="${PREVIEW_IMAGE.size}">`,
      `<meta property="og:image:height" content="${PREVIEW_IMAGE.size}">`,
    );
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
