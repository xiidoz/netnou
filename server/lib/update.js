// Which build is running, and whether there is a newer release of it.

import { get } from './http.js';

const DAY_MS = 86_400_000;
const CHECK_LIMIT_MS = 30_000;

/**
 * What the server calls itself. The image built by the release workflow
 * knows the commit it was built from and whether that is a release (see the
 * Dockerfile):
 *   a release   its number, "0.2.0"
 *   any other   "edge": the number in package.json is that of the last
 *               release, which this build is not
 *   neither     a checkout or an image built by hand: the number with "+dev"
 * @param {{version: string}} pkg package.json
 * @returns {{version: string, commit: string | null}}
 */
export function describeBuild(pkg, env = process.env) {
  const commit = (env.NETNOU_COMMIT ?? '').trim() || null;
  if ((env.NETNOU_RELEASE ?? '').trim() === 'true') return { version: pkg.version, commit };
  if (commit) return { version: 'edge', commit };
  return { version: `${pkg.version}+dev`, commit: null };
}

/** [major, minor, patch] of "0.2.0", "v0.2.0" or "0.2.0+dev"; null for anything that does not begin like that. */
export function versionNumbers(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?![\d.])/.exec(text ?? '');
  return match && match.slice(1).map(Number);
}

export function isNewer(candidate, current) {
  const a = versionNumbers(candidate);
  const b = versionNumbers(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * Where the releases of a project on GitHub are, from the "repository" of its
 * package.json; null for a repository elsewhere, whose releases cannot be
 * asked for in this way.
 * @returns {{page: string, latest: string} | null} the repository's page and the address that names its latest release
 */
export function githubReleases(repository) {
  const url = typeof repository === 'string' ? repository : repository?.url;
  const match = /^(?:git\+)?https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '');
  if (!match) return null;
  const [, owner, name] = match;
  return { page: `https://github.com/${owner}/${name}`, latest: `https://api.github.com/repos/${owner}/${name}/releases/latest` };
}

/**
 * Asks about once a day whether a release newer than the running one exists.
 * `update` is that release, or null: there is none, the answer made no sense
 * or nothing was to be had. An operator learns of a new release from the log
 * and from /api/status, a visitor from a marker in the page.
 */
export class UpdateChecker {
  /**
   * @param current the running version, as describeBuild() names it
   * @param releases see githubReleases()
   * @param userAgent GitHub answers nobody who does not name himself
   */
  constructor({ current, releases, userAgent, log, intervalMs = DAY_MS }) {
    this.current = current;
    this.releases = releases;
    this.userAgent = userAgent;
    this.log = log;
    this.intervalMs = intervalMs;
    /** @type {{version: string, url: string} | null} */
    this.update = null;
    this.timer = null;
  }

  /** Whether there is anything to ask: not for "edge", which is ahead of every release, and not without a place to ask. */
  get enabled() {
    return Boolean(this.releases && versionNumbers(this.current));
  }

  start() {
    if (!this.enabled || this.timer) return;
    this.timer = setInterval(() => this.check(), this.intervalMs);
    // (the check is no reason to keep the process running)
    this.timer.unref();
    this.check();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async check() {
    try {
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': this.userAgent };
      const res = await get(this.releases.latest, { headers, timeoutMs: CHECK_LIMIT_MS });
      if (res.status !== 200) return;
      // What comes back ends up in the page: nothing of it is passed on but
      // the tag of the release, and that only if it is a version number.
      const tag = JSON.parse(res.body.toString('utf8')).tag_name;
      if (typeof tag !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(tag)) return;
      const version = tag.replace(/^v/, '');
      if (!isNewer(version, this.current)) {
        this.update = null;
      } else if (this.update?.version !== version) {
        this.update = { version, url: `${this.releases.page}/releases/tag/${tag}` };
        this.log(`Update: version ${version} is available, this is ${this.current}: ${this.update.url}`);
      }
    } catch {
      // No connection, no answer, not JSON: asked again tomorrow, and what was known stays.
    }
  }
}
