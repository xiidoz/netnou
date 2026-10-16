import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { factsOf, isOpened, isVisit, reportOf, shortIp, Visits, visitsPattern } from '../server/lib/visits.js';

const UMAMI = '{"type":"event","payload":{"website":"7f3c","hostname":"{host}","url":"{path}","referrer":"{source}","language":"{language}","title":"{title}","ip":"{ip}","userAgent":"{browser}"}}';
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

/** A request as the server gets it: method, headers in small letters, the address of the connection. */
const requestOf = (headers, { method = 'GET', from = '127.0.0.1' } = {}) => ({ method, headers: Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])), socket: { remoteAddress: from } });

test('the patterns are checked at the start, and an error names the setting', () => {
  assert.equal(visitsPattern({ url: '', body: '', headers: '' }), null);
  assert.deepEqual(visitsPattern({ url: 'http://umami:3000/api/send', body: UMAMI, headers: '' }), { url: 'http://umami:3000/api/send', body: JSON.parse(UMAMI), headers: null });
  assert.deepEqual(visitsPattern({ url: 'https://stats.example.org/matomo.php?idsite=1&url={address}', body: '', headers: '{"X-Key":"k"}' }).headers, { 'X-Key': 'k' });
  for (const [settings, message] of [
    [{ url: '', body: UMAMI, headers: '' }, /^NETNOU_VISITS_BODY needs NETNOU_VISITS_URL/],
    [{ url: '', body: '', headers: '{}' }, /^NETNOU_VISITS_HEADERS needs NETNOU_VISITS_URL/],
    [{ url: 'umami:3000/api/send', body: '', headers: '' }, /^NETNOU_VISITS_URL must be an http\(s\) URL/],
    [{ url: 'ftp://stats.example.org/', body: '', headers: '' }, /^NETNOU_VISITS_URL must be an http\(s\) URL/],
    [{ url: 'https://{host}.example.org/count', body: '', headers: '' }, /^NETNOU_VISITS_URL: placeholders may stand in the values of its query only/],
    [{ url: 'https://stats.example.org/count?ip={ipaddress}', body: '', headers: '' }, /^NETNOU_VISITS_URL: \{ipaddress\} is no placeholder; there are \{address\}, \{host\}, \{path\}, \{source\}, \{language\}, \{browser\}, \{ip\}, \{ip-short\}, \{title\}$/],
    [{ url: 'https://stats.example.org/', body: '{"url": "{path}"', headers: '' }, /^NETNOU_VISITS_BODY must be JSON/],
    [{ url: 'https://stats.example.org/', body: '{"hits": [{"agent": "{user-agent}"}]}', headers: '' }, /^NETNOU_VISITS_BODY: \{user-agent\} is no placeholder/],
    [{ url: 'https://stats.example.org/', body: '', headers: '["Authorization", "Bearer k"]' }, /^NETNOU_VISITS_HEADERS must be a JSON object of header names and texts/],
    [{ url: 'https://stats.example.org/', body: '', headers: '{"X-Count": 1}' }, /^NETNOU_VISITS_HEADERS must be a JSON object/],
    [{ url: 'https://stats.example.org/', body: '', headers: '{"Bad Name": "x"}' }, /^NETNOU_VISITS_HEADERS must be a JSON object/],
    [{ url: 'https://stats.example.org/', body: '', headers: '{"X-From": "{referer}"}' }, /^NETNOU_VISITS_HEADERS: \{referer\} is no placeholder/],
  ]) assert.throws(() => visitsPattern(settings), { message }, JSON.stringify(settings));
});

test('a visit is a browser opening the page, not a script fetching it, a prefetch or a browser that asks not to be tracked', () => {
  const opened = { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', Accept: 'text/html,application/xhtml+xml' };
  // opened, through the service worker, and by an older browser that sends no Sec-Fetch headers
  for (const headers of [opened, { ...opened, 'Sec-Fetch-Dest': 'empty' }, { Accept: 'text/html,*/*;q=0.8' }]) assert.ok(isVisit(requestOf(headers)), JSON.stringify(headers));
  for (const [headers, method] of [
    [opened, 'HEAD'],
    // the service worker filling its cache, a fetch() of a script
    [{ 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', Accept: '*/*' }],
    // a prefetch, by Sec-Purpose or by the older Purpose
    [{ 'Sec-Fetch-Mode': 'no-cors', 'Sec-Fetch-Dest': 'empty', Accept: '*/*', 'Sec-Purpose': 'prefetch' }],
    [{ ...opened, 'Sec-Purpose': 'prefetch;prerender' }],
    [{ Accept: 'text/html', Purpose: 'prefetch' }],
    // in a frame of another page
    [{ ...opened, 'Sec-Fetch-Dest': 'iframe' }],
    // Do Not Track, Global Privacy Control
    [{ ...opened, DNT: '1' }],
    [{ ...opened, 'Sec-GPC': '1' }],
    // neither header, nor a page asked for
    [{ Accept: '*/*' }],
  ]) assert.ok(!isVisit(requestOf(headers, { method })), JSON.stringify(headers));
});

test('a stop or a line the page opens counts where the request is the page\'s own, not a prefetch, and not from a browser that asks not to be tracked (#158)', () => {
  const asked = { 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'same-origin', Accept: '*/*' };
  // the page's request, and one of a browser that does not say whose a request is
  for (const headers of [asked, { Accept: '*/*' }]) assert.ok(isOpened(requestOf(headers)), JSON.stringify(headers));
  for (const [headers, method] of [
    [asked, 'HEAD'],
    // another site's page sending the same request, and the address typed in
    [{ ...asked, 'Sec-Fetch-Site': 'cross-site' }],
    [{ ...asked, 'Sec-Fetch-Site': 'same-site' }],
    [{ 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none', Accept: 'text/html' }],
    [{ ...asked, 'Sec-Purpose': 'prefetch' }],
    [{ ...asked, DNT: '1' }],
    [{ ...asked, 'Sec-GPC': '1' }],
  ]) assert.ok(!isOpened(requestOf(headers, { method })), JSON.stringify(headers));
});

test('an IP address without its end: the last number of IPv4, all but the first 48 bits of IPv6', () => {
  assert.equal(shortIp('203.0.113.47'), '203.0.113.0');
  assert.equal(shortIp('2001:db8:85a3:8d3:1319:8a2e:370:7348'), '2001:db8:85a3::');
  assert.equal(shortIp('2001:db8::1'), '2001:db8::');
  assert.equal(shortIp('2a02:810d:4b40:bf00::17'), '2a02:810d:4b40::');
  assert.equal(shortIp('::1'), '::');
  assert.equal(shortIp('not an address'), '');
});

test('the facts of a visit are what the browser sent with its request, and where the page is', () => {
  const req = requestOf({ Host: '127.0.0.1:8080', 'User-Agent': BROWSER, 'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8', Referer: 'https://www.google.com/', 'X-Forwarded-For': '198.51.100.7, 203.0.113.47' }, { from: '::ffff:172.18.0.4' });
  const query = new URLSearchParams('display=fixed&view=49.45,11.08,12&lang=en&utm_campaign=plakat&id=1');
  // where the page is as visitors reach it: its address with a path, and of the query only what is passed on
  assert.deepEqual(factsOf(req, { pathname: '/', query, title: 'Netnou – Großraum Nürnberg', publicUrl: 'https://karte.example.org/live/' }), {
    address: 'https://karte.example.org/live/?display=fixed&lang=en&utm_campaign=plakat',
    host: 'karte.example.org',
    path: '/live/?display=fixed&lang=en&utm_campaign=plakat',
    source: 'https://www.google.com/',
    language: 'de-DE',
    browser: BROWSER,
    ip: '203.0.113.47',
    'ip-short': '203.0.113.0',
    title: 'Netnou – Großraum Nürnberg',
  });
  // without NETNOU_PUBLIC_URL by the request, https where the proxy says so; the address of the connection
  // without X-Forwarded-For; a page of the instance itself is no source; nothing where nothing was sent
  const bare = requestOf({ Host: 'transit.example.org', 'X-Forwarded-Proto': 'https', Referer: 'https://transit.example.org/' }, { from: '::ffff:172.18.0.4' });
  assert.deepEqual(factsOf(bare, { pathname: '/stop/alpha@49.4000,11.0000', query: new URLSearchParams(), title: '', publicUrl: null }), {
    address: 'https://transit.example.org/stop/alpha@49.4000,11.0000',
    host: 'transit.example.org',
    path: '/stop/alpha@49.4000,11.0000',
    source: null,
    language: null,
    browser: null,
    ip: '172.18.0.4',
    'ip-short': '172.18.0.0',
    title: null,
  });
});

test('the request fills the facts in: inside the texts of the body, the values of the query and the headers', () => {
  const facts = { address: 'https://karte.example.org/?lang=en', host: 'karte.example.org', path: '/?lang=en', source: null, language: 'de-DE', browser: BROWSER, ip: '203.0.113.47', 'ip-short': '203.0.113.0', title: 'Netnou – Großraum Nürnberg' };
  // the body as JSON, whatever is filled in; a field that is one placeholder for which there is nothing is left out
  const umami = reportOf(visitsPattern({ url: 'http://umami:3000/api/send', body: UMAMI, headers: '' }), facts);
  assert.equal(umami.url, 'http://umami:3000/api/send');
  assert.equal(umami.init.method, 'POST');
  assert.equal(umami.init.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(umami.init.body).payload, { website: '7f3c', hostname: 'karte.example.org', url: '/?lang=en', language: 'de-DE', title: 'Netnou – Großraum Nürnberg', ip: '203.0.113.47', userAgent: BROWSER });
  // a placeholder within a text, and in a list
  const hits = reportOf(visitsPattern({ url: 'https://count.example.org/', body: '{"hits":[{"path":"{path}","ref":"{source}","note":"from {source}"}],"list":["{source}","{language}"]}', headers: '' }), facts);
  assert.deepEqual(JSON.parse(hits.init.body), { hits: [{ path: '/?lang=en', note: 'from ' }], list: ['de-DE'] });
  // in the address, encoded; a parameter that is one placeholder for which there is nothing is left out; a GET without a body
  const matomo = reportOf(visitsPattern({ url: 'https://stats.example.org/matomo.php?idsite=1&rec=1&url={address}&urlref={source}&action_name={title}&cip={ip}', body: '', headers: '' }), facts);
  assert.equal(matomo.url, 'https://stats.example.org/matomo.php?idsite=1&rec=1&url=https%3A%2F%2Fkarte.example.org%2F%3Flang%3Den&action_name=Netnou+%E2%80%93+Gro%C3%9Fraum+N%C3%BCrnberg&cip=203.0.113.47');
  assert.equal(matomo.init.method, 'GET');
  assert.equal(matomo.init.body, undefined);
  // in the headers; what a header cannot carry is left out, as is one for which there is nothing
  const plausible = reportOf(visitsPattern({ url: 'https://plausible.io/api/event', body: '{"name":"pageview","url":"{address}","domain":"karte.example.org"}', headers: '{"User-Agent":"{browser}","X-Forwarded-For":"{ip}","X-Title":"{title}","X-From":"{source}"}' }), facts);
  assert.deepEqual([...plausible.init.headers].sort(), [['content-type', 'application/json'], ['user-agent', BROWSER], ['x-forwarded-for', '203.0.113.47']]);
});

test('a stop or a line the page opens is reported as a visit of its address, once the answer is out, and without a source (#158)', async () => {
  const calls = [];
  const visits = new Visits(visitsPattern({ url: 'https://stats.example.org/api/send', body: UMAMI, headers: '' }), { publicUrl: 'https://karte.example.org/live/', log: () => {}, fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve(new Response('', { status: 200 })); } });
  const asked = { 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty', 'Sec-Fetch-Site': 'same-origin', 'User-Agent': BROWSER, 'Accept-Language': 'en-GB,en;q=0.9', 'X-Forwarded-For': '203.0.113.47' };
  const opened = async (headers) => {
    const res = new EventEmitter();
    visits.opened(requestOf(headers), res, { pathname: '/stop/alpha@49.4000,11.0000', title: 'Departures Alpha live – Netnou' });
    await new Promise((resolve) => setImmediate(resolve));
    const before = calls.length;
    res.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));
    return { before, after: calls.length };
  };
  // (the page reached under another name than its public address: still no source, the visitor came from the page)
  assert.deepEqual(await opened({ ...asked, Referer: 'https://www.karte.example.org/live/?lang=en' }), { before: 0, after: 1 });
  assert.deepEqual(JSON.parse(calls[0].init.body).payload, {
    website: '7f3c',
    hostname: 'karte.example.org',
    url: '/live/stop/alpha@49.4000,11.0000',
    language: 'en-GB',
    title: 'Departures Alpha live – Netnou',
    ip: '203.0.113.47',
    userAgent: BROWSER,
  });
  // not from another site's page, nor with Do Not Track
  for (const headers of [{ ...asked, 'Sec-Fetch-Site': 'cross-site' }, { ...asked, DNT: '1' }]) assert.deepEqual(await opened(headers), { before: 1, after: 1 }, JSON.stringify(headers));
});

test('reports go out one each, are dropped where too many are under way, and a failure is logged when it begins and ends', async () => {
  const lines = [];
  const calls = [];
  let answer = () => new Promise(() => {});
  const visits = new Visits(visitsPattern({ url: 'https://stats.example.org/count?key=secret', body: '', headers: '' }), { publicUrl: 'https://karte.example.org/', userAgent: 'Netnou/1.0', log: (line) => lines.push(line), fetch: (url, init) => { calls.push({ url, init }); return answer(); } });
  // (the host alone: the address may hold a key)
  assert.deepEqual(lines, ['Visits: reported to stats.example.org']);
  const facts = { address: null, host: null, path: null, source: null, language: null, browser: null, ip: null, 'ip-short': null, title: null };
  // a service that hangs: twenty under way, what comes on top is dropped
  for (let i = 0; i < 25; i++) visits.report(facts);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 20);
  assert.equal(calls[0].init.headers.get('user-agent'), 'Netnou/1.0');
  assert.ok(calls[0].init.signal instanceof AbortSignal);

  const fresh = () => new Visits(visitsPattern({ url: 'https://stats.example.org/count', body: '', headers: '' }), { publicUrl: null, log: (line) => lines.push(line), fetch: () => answer() });
  lines.length = 0;
  const other = fresh();
  answer = () => Promise.resolve(new Response('no such site', { status: 400 }));
  for (let i = 0; i < 3; i++) await other.report(facts);
  answer = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
  await other.report(facts);
  answer = () => Promise.resolve(new Response('', { status: 202 }));
  await other.report(facts);
  await other.report(facts);
  answer = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  await other.report(facts);
  assert.deepEqual(lines, [
    'Visits: reported to stats.example.org',
    'Visits: cannot report to stats.example.org: HTTP 400: no such site',
    'Visits: reported to stats.example.org again',
    'Visits: cannot report to stats.example.org: no answer within 5 s',
  ]);
});
