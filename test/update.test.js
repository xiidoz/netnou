// What the server calls itself, and the look-out for a newer release, against
// a local server standing in for GitHub.

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, test } from 'node:test';
import { UpdateChecker, describeBuild, githubReleases, isNewer, versionNumbers } from '../server/lib/update.js';

test('a build is a release, "edge" or a development build', () => {
  const pkg = { version: '0.2.0' };
  // the image of a release
  assert.deepEqual(describeBuild(pkg, { NETNOU_COMMIT: '479e29cd13b2', NETNOU_RELEASE: 'true' }), { version: '0.2.0', commit: '479e29cd13b2' });
  // the image of any other commit: the number in package.json is not its own
  assert.deepEqual(describeBuild(pkg, { NETNOU_COMMIT: '479e29cd13b2', NETNOU_RELEASE: 'false' }), { version: 'edge', commit: '479e29cd13b2' });
  assert.deepEqual(describeBuild(pkg, { NETNOU_COMMIT: ' 479e29cd13b2 ' }), { version: 'edge', commit: '479e29cd13b2' });
  // a checkout, or an image built by hand
  assert.deepEqual(describeBuild(pkg, {}), { version: '0.2.0+dev', commit: null });
  assert.deepEqual(describeBuild(pkg, { NETNOU_COMMIT: '', NETNOU_RELEASE: '' }), { version: '0.2.0+dev', commit: null });
});

test('version numbers are read and compared as numbers', () => {
  assert.deepEqual(versionNumbers('0.2.0'), [0, 2, 0]);
  assert.deepEqual(versionNumbers('v10.20.30'), [10, 20, 30]);
  assert.deepEqual(versionNumbers('0.2.0+dev'), [0, 2, 0]);
  for (const text of ['edge', '1.2', '0.2.0.1', 'version 1.2.3', '', undefined]) assert.equal(versionNumbers(text), null, String(text));

  assert.ok(isNewer('0.3.0', '0.2.0'));
  assert.ok(isNewer('0.10.0', '0.9.9'));
  assert.ok(isNewer('1.0.0', '0.99.99'));
  assert.ok(isNewer('v0.2.1', '0.2.0+dev'));
  assert.ok(!isNewer('0.2.0', '0.2.0'));
  assert.ok(!isNewer('0.2.0', '0.2.0+dev'));
  assert.ok(!isNewer('0.1.9', '0.2.0'));
  // nothing is newer than what has no number, and what has no number is not newer
  assert.ok(!isNewer('9.9.9', 'edge'));
  assert.ok(!isNewer('nightly', '0.2.0'));
});

test('the releases are asked for where package.json says the repository is', () => {
  const expected = { page: 'https://github.com/xiidoz/netnou', latest: 'https://api.github.com/repos/xiidoz/netnou/releases/latest' };
  assert.deepEqual(githubReleases({ type: 'git', url: 'git+https://github.com/xiidoz/netnou.git' }), expected);
  assert.deepEqual(githubReleases('https://github.com/xiidoz/netnou'), expected);
  assert.deepEqual(githubReleases('https://github.com/some-one/my.fork.git/'), { page: 'https://github.com/some-one/my.fork', latest: 'https://api.github.com/repos/some-one/my.fork/releases/latest' });
  // elsewhere, or nowhere: nothing to ask
  for (const repository of ['https://gitlab.com/xiidoz/netnou.git', 'git://github.com/xiidoz/netnou.git', 'https://github.com/xiidoz', { type: 'git' }, undefined]) {
    assert.equal(githubReleases(repository), null, JSON.stringify(repository));
  }
});

// GitHub, as far as the checker is concerned: one address that names the latest release.
const github = { answer: { tag_name: 'v0.3.0' }, status: 200, requests: [] };
const server = http.createServer((req, res) => {
  github.requests.push({ url: req.url, agent: req.headers['user-agent'], accept: req.headers.accept });
  res.writeHead(github.status, { 'Content-Type': 'application/json' });
  res.end(typeof github.answer === 'string' ? github.answer : JSON.stringify(github.answer));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
after(() => {
  server.close();
  server.closeAllConnections();
});
const releases = { page: 'https://github.com/xiidoz/netnou', latest: `http://127.0.0.1:${server.address().port}/repos/xiidoz/netnou/releases/latest` };

function checker(current, where = releases) {
  Object.assign(github, { answer: { tag_name: 'v0.3.0' }, status: 200, requests: [] });
  const lines = [];
  return { lines, instance: new UpdateChecker({ current, releases: where, userAgent: 'Netnou/test', log: (line) => lines.push(line) }) };
}

test('a newer release is found, said once, and gone when it is no longer newer', async () => {
  const { instance, lines } = checker('0.2.0');
  assert.equal(instance.update, null);
  await instance.check();
  assert.deepEqual(instance.update, { version: '0.3.0', url: 'https://github.com/xiidoz/netnou/releases/tag/v0.3.0' });
  assert.deepEqual(github.requests, [{ url: '/repos/xiidoz/netnou/releases/latest', agent: 'Netnou/test', accept: 'application/vnd.github+json' }]);
  assert.deepEqual(lines, ['Update: version 0.3.0 is available, this is 0.2.0: https://github.com/xiidoz/netnou/releases/tag/v0.3.0']);

  // the day after: still there, not said again
  await instance.check();
  assert.equal(instance.update.version, '0.3.0');
  assert.equal(lines.length, 1);

  // a newer one still is said
  github.answer = { tag_name: '0.3.1' };
  await instance.check();
  assert.deepEqual(instance.update, { version: '0.3.1', url: 'https://github.com/xiidoz/netnou/releases/tag/0.3.1' });
  assert.equal(lines.length, 2);

  // the release was withdrawn: the latest is the running one again
  github.answer = { tag_name: 'v0.2.0' };
  await instance.check();
  assert.equal(instance.update, null);
});

test('a development build is told of a release that is ahead of it, "edge" does not ask', async () => {
  const dev = checker('0.2.0+dev');
  await dev.instance.check();
  assert.equal(dev.instance.update.version, '0.3.0');
  github.answer = { tag_name: 'v0.2.0' };
  await dev.instance.check();
  assert.equal(dev.instance.update, null);

  for (const { instance } of [checker('edge'), checker('0.2.0', null)]) {
    assert.equal(instance.enabled, false);
    instance.start();
    assert.equal(instance.timer, null);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(github.requests, []);
  }
});

test('start asks at once and then at intervals, stop ends it', async () => {
  const { instance } = checker('0.2.0');
  instance.intervalMs = 40;
  instance.start();
  instance.start(); // (a second start changes nothing)
  for (let waited = 0; github.requests.length < 3; waited += 5) {
    assert.ok(waited < 10_000, 'timed out waiting for three checks');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  instance.stop();
  assert.equal(instance.update.version, '0.3.0');
  const asked = github.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok(github.requests.length <= asked + 1, 'no further checks after stop');
});

test('an answer that makes no sense changes nothing and is no error', async () => {
  const { instance, lines } = checker('0.2.0');
  await instance.check();
  const known = { ...instance.update };

  const senseless = [
    [404, { message: 'Not Found' }],
    [403, { message: 'API rate limit exceeded' }],
    [200, 'not JSON'],
    [200, {}],
    [200, { tag_name: 'nightly' }],
    // nothing but a version number gets through to the page
    [200, { tag_name: 'v9.9.9<img src=x onerror=alert(1)>' }],
    [200, { tag_name: 'v9.9.9/../../evil' }],
    [200, { tag_name: ['v9.9.9'] }],
  ];
  for (const [status, answer] of senseless) {
    Object.assign(github, { status, answer });
    await instance.check();
    assert.deepEqual(instance.update, known, JSON.stringify(answer));
  }
  assert.equal(lines.length, 1);
});
