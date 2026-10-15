// Visits of the page, reported to an analytics service of the operator's
// choice (#114). The server tells the service of each visit itself, with what
// the browser sent along with its request anyway; the page loads nothing from
// elsewhere for it. The service and the shape of its request are the
// operator's: NETNOU_VISITS_URL, NETNOU_VISITS_BODY and NETNOU_VISITS_HEADERS
// are patterns whose placeholders are filled in here. No service is known by
// name, and nothing of a visit is kept.

import net from 'node:net';

/** What a pattern may have filled in, as {name}. */
export const PLACEHOLDERS = ['address', 'host', 'path', 'source', 'language', 'browser', 'ip', 'ip-short', 'title'];

// The parameters of the page's query that are passed on. All others are left
// out, among them the map position that the address of a display holds (view).
const KEPT_QUERY = ['lang', 'display', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
// One attempt each, this long at the most; a visit that cannot be reported is lost.
const TIMEOUT_MS = 5000;
// More than this many under way, a visit is dropped: a service that hangs cannot hold up the server.
const MOST_UNDER_WAY = 20;
// Of an answer that is not 2xx, this much is logged.
const ANSWER_CHARS = 200;

const PLACEHOLDER = /\{([a-z-]+)\}/g;
// (a text that is a placeholder and nothing else: left out where there is nothing to fill in)
const ALONE = /^\{([a-z-]+)\}$/;

/**
 * The patterns as the settings give them, checked: { url, body, headers },
 * the body a JSON value and the headers an object of names and texts, either
 * null; or null without NETNOU_VISITS_URL. Throws an Error that names the
 * setting at fault.
 * @param texts the three settings, trimmed, empty where not set
 */
export function visitsPattern({ url, body, headers }) {
  if (!url) {
    for (const [name, value] of [['NETNOU_VISITS_BODY', body], ['NETNOU_VISITS_HEADERS', headers]]) {
      if (value) throw new Error(`${name} needs NETNOU_VISITS_URL, the address visits are reported to`);
    }
    return null;
  }
  const known = (name, text) => {
    for (const [, placeholder] of text.matchAll(PLACEHOLDER)) {
      if (!PLACEHOLDERS.includes(placeholder)) throw new Error(`${name}: {${placeholder}} is no placeholder; there are ${PLACEHOLDERS.map((p) => `{${p}}`).join(', ')}`);
    }
  };
  let address;
  try {
    address = new URL(url);
  } catch {
    address = null;
  }
  if (!address || !/^https?:$/.test(address.protocol)) throw new Error(`NETNOU_VISITS_URL must be an http(s) URL, the address visits are reported to (got "${url}")`);
  // (placeholders are filled in in the values of its query only; elsewhere they would stand as they are)
  if (/\{[a-z-]+\}/.test(url.replace(/\?.*$/, ''))) throw new Error('NETNOU_VISITS_URL: placeholders may stand in the values of its query only');
  known('NETNOU_VISITS_URL', url);
  let json = null;
  if (body) {
    try {
      json = JSON.parse(body);
    } catch (err) {
      throw new Error(`NETNOU_VISITS_BODY must be JSON (${err.message})`, { cause: err });
    }
    texts(json, (text) => known('NETNOU_VISITS_BODY', text));
  }
  let fields = null;
  if (headers) {
    try {
      fields = JSON.parse(headers);
    } catch {
      fields = undefined;
    }
    const valid = fields && typeof fields === 'object' && !Array.isArray(fields) && Object.entries(fields).every(([name, value]) => /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) && typeof value === 'string');
    if (!valid) throw new Error(`NETNOU_VISITS_HEADERS must be a JSON object of header names and texts, e.g. {"Authorization": "Bearer …"} (got "${headers}")`);
    for (const value of Object.values(fields)) known('NETNOU_VISITS_HEADERS', value);
  }
  return { url, body: json, headers: fields };
}

/** Calls `visit` with every text of a JSON value. */
function texts(value, visit) {
  if (typeof value === 'string') visit(value);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) texts(item, visit);
}

/**
 * Whether a request for the page is a visit: a browser opening it, not a
 * script fetching it, a prefetch, or a browser that asks not to be tracked.
 * Which browsers are bots is left to the service, which is told the name of
 * the browser.
 */
export function isVisit(req) {
  const header = (name) => req.headers[name] ?? '';
  if (req.method !== 'GET') return false;
  if (/prefetch/i.test(header('sec-purpose')) || /prefetch/i.test(header('purpose'))) return false;
  if (header('dnt') === '1' || header('sec-gpc') === '1') return false;
  // (Sec-Fetch-Dest is "empty" for a page opened through the service worker)
  if (req.headers['sec-fetch-mode'] !== undefined || req.headers['sec-fetch-dest'] !== undefined) {
    return header('sec-fetch-mode') === 'navigate' && ['document', 'empty'].includes(header('sec-fetch-dest'));
  }
  return /\btext\/html\b/.test(header('accept'));
}

/** An IP address without its end: an IPv4 address with its last number 0, of an IPv6 address the first 48 bits. */
export function shortIp(ip) {
  if (net.isIPv4(ip)) return ip.replace(/\d+$/, '0');
  if (!net.isIPv6(ip)) return '';
  const [head, tail] = ip.split('::');
  const groups = (part) => (part ? part.split(':').flatMap((group) => (group.includes('.') ? ['0', '0'] : [group])) : []);
  const before = groups(head);
  const all = tail === undefined ? before : [...before, ...Array(8 - before.length - groups(tail).length).fill('0'), ...groups(tail)];
  // (written as such an address is written, shortest: the same visitor, the same text)
  return new URL(`http://[${[...all.slice(0, 3), 0, 0, 0, 0, 0].join(':')}]/`).hostname.slice(1, -1);
}

/**
 * The facts of a visit, by the names of the placeholders; those there is
 * nothing for are null.
 * @param req the request for the page
 * @param pathname the path the page was asked for by, from where the server is (/, /stop/…)
 * @param query its query (URLSearchParams)
 * @param title the title of the page as it was sent
 * @param publicUrl NETNOU_PUBLIC_URL, or null
 */
export function factsOf(req, { pathname, query, title, publicUrl }) {
  const header = (name) => (req.headers[name] ?? '').trim();
  // Where the page is: as visitors reach it, or as the request says
  let base = publicUrl;
  if (!base) {
    const https = header('x-forwarded-proto').split(',')[0].trim() === 'https';
    base = header('host') ? `${https ? 'https' : 'http'}://${header('host')}/` : null;
  }
  let address = null;
  if (base) {
    const kept = new URLSearchParams([...query].filter(([name]) => KEPT_QUERY.includes(name)));
    try {
      address = new URL(`${pathname.replace(/^\//, '')}${kept.size ? `?${kept}` : ''}`, base);
    } catch {
      address = null;
    }
  }
  // (from another site only: moving about the page itself is no source)
  let source = header('referer') || null;
  try {
    if (source && address && new URL(source).host === address.host) source = null;
  } catch {
    source = null;
  }
  // (the last of X-Forwarded-For is what the reverse proxy in front wrote)
  const forwarded = header('x-forwarded-for').split(',').map((part) => part.trim()).filter(Boolean);
  const ip = (forwarded.at(-1) ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '') || null;
  return {
    address: address?.href ?? null,
    host: address?.host ?? null,
    path: address ? `${address.pathname}${address.search}` : null,
    source,
    language: header('accept-language').split(',')[0].split(';')[0].trim() || null,
    browser: header('user-agent') || null,
    ip,
    'ip-short': ip ? shortIp(ip) || null : null,
    title: title || null,
  };
}

/** A pattern's text with the facts filled in; undefined where it is a placeholder alone and there is nothing for it. */
function filled(text, facts) {
  const alone = ALONE.exec(text);
  if (alone && (facts[alone[1]] ?? null) === null) return undefined;
  return text.replace(PLACEHOLDER, (_, name) => facts[name] ?? '');
}

/** A JSON value of the pattern with the facts filled in, inside its texts. */
function fillJson(value, facts) {
  if (typeof value === 'string') return filled(value, facts);
  if (Array.isArray(value)) return value.map((item) => fillJson(item, facts)).filter((item) => item !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fillJson(item, facts)]).filter(([, item]) => item !== undefined));
  }
  return value;
}

/**
 * The request that reports a visit: { url, init } for fetch.
 * @param pattern from visitsPattern
 * @param facts from factsOf
 */
export function reportOf(pattern, facts) {
  const url = new URL(pattern.url);
  const query = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    const text = filled(value, facts);
    if (text !== undefined) query.append(name, text);
  }
  url.search = query.size ? `?${query}` : '';
  const headers = new Headers();
  for (const [name, value] of Object.entries(pattern.headers ?? {})) {
    const text = filled(value, facts);
    if (text === undefined) continue;
    // (what a header cannot carry is left out)
    try {
      headers.set(name, text);
    } catch {
      // nothing
    }
  }
  if (pattern.body === null) return { url: url.href, init: { method: 'GET', headers } };
  headers.set('Content-Type', 'application/json');
  return { url: url.href, init: { method: 'POST', headers, body: JSON.stringify(fillJson(pattern.body, facts)) } };
}

/**
 * Reports visits as they come, one request each, after the answer to the
 * visitor has been written; logs when reports begin to fail and when they get
 * through again, nothing for a single visit.
 */
export class Visits {
  /**
   * @param pattern from visitsPattern
   * @param options.publicUrl NETNOU_PUBLIC_URL, or null
   * @param options.userAgent what the server calls itself, where the pattern does not say what to send as User-Agent
   * @param options.log for the lines of the log
   * @param options.fetch (for the tests)
   */
  constructor(pattern, { publicUrl, userAgent, log, fetch = globalThis.fetch }) {
    this.pattern = pattern;
    this.publicUrl = publicUrl;
    this.userAgent = userAgent;
    this.log = log;
    this.fetch = fetch;
    // (the host alone: the whole address may hold a key)
    this.host = new URL(pattern.url).host;
    this.underWay = 0;
    this.failing = false;
    log(`Visits: reported to ${this.host}`);
  }

  /**
   * Reports the visit of a request for the page, if it is one, once the
   * answer to it has been written.
   * @param page { pathname, query, title } of the page as it was sent
   */
  seen(req, res, page) {
    if (!isVisit(req)) return;
    // (taken now: the connection may be gone once the answer is out)
    const facts = factsOf(req, { ...page, publicUrl: this.publicUrl });
    res.once('finish', () => this.report(facts));
  }

  /** Sends one report; one attempt, and dropped where too many are under way. */
  async report(facts) {
    if (this.underWay >= MOST_UNDER_WAY) return;
    this.underWay++;
    try {
      const { url, init } = reportOf(this.pattern, facts);
      if (this.userAgent && !init.headers.has('User-Agent')) init.headers.set('User-Agent', this.userAgent);
      const res = await this.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const answer = await res.text().catch(() => '');
      if (!res.ok) return this.failed(`HTTP ${res.status}${answer.trim() ? `: ${answer.trim().replace(/\s+/g, ' ').slice(0, ANSWER_CHARS)}` : ''}`);
      if (this.failing) this.log(`Visits: reported to ${this.host} again`);
      this.failing = false;
    } catch (err) {
      this.failed(err.name === 'TimeoutError' ? `no answer within ${TIMEOUT_MS / 1000} s` : (err.cause?.code ?? err.cause?.message ?? err.message));
    } finally {
      this.underWay--;
    }
  }

  failed(why) {
    if (!this.failing) this.log(`Visits: cannot report to ${this.host}: ${why}`);
    this.failing = true;
  }
}
