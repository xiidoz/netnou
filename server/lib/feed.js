// Keeps the regional timetable in sync with the static GTFS feed, which
// gtfs.de republishes once a day.

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { download, publicUrl, readGz, reason } from './files.js';
import { DATASET_VERSION } from './importer.js';
import { Timetable } from './timetable.js';

const HEAD_TIMEOUT_MS = 30_000;

// After a feed version could not be downloaded completely or imported, or the
// OSM data for the route geometry could not be had, the next attempt waits: an
// hour at first, then twice as long every time, up to a day. (A new feed
// version is tried at once and starts with an hour again.) Each attempt
// downloads hundreds of MB, and a failure that is down to the settings or the
// machine (an area without stops, extracts that do not cover it, a full disk)
// does not go away by itself.
const RETRY_MIN_MS = 3600_000;
const RETRY_MAX_MS = 86_400_000;
const nextWait = (waitMs) => Math.min(waitMs ? waitMs * 2 : RETRY_MIN_MS, RETRY_MAX_MS);
const minutes = (ms) => `${Math.round(ms / 60_000)} min`;

export class FeedUpdater {
  constructor({ url, dataDir, area, checkMs, downloadTimeoutMs, osm, onTimetable, log }) {
    this.url = url;
    this.area = area;
    this.osm = osm; // { urls, maxAgeMs }
    this.checkMs = checkMs;
    this.downloadTimeoutMs = downloadTimeoutMs;
    this.onTimetable = onTimetable;
    this.log = log;
    this.datasetPath = path.join(dataDir, 'region.json.gz');
    this.zipPath = path.join(dataDir, 'feed.zip');
    this.dataDir = dataDir;
    this.current = null; // `source` of the loaded dataset
    // state: 'starting', 'loading' (first import), 'ready' or 'error' (nothing
    //   loaded and the last attempt failed).
    // step: what is being done right now – 'download' (the feed), 'import'
    //   (the worker reads it), 'routes' (OSM data is loaded and routed) – or null.
    // message and error are English texts for operators; the page picks its
    // own wording by state and step.
    this.status = { state: 'starting', step: null, message: 'starting', checkedAt: null, error: null };
    this.busy = false;
    this.failed = null; // { version, waitMs, until } once a feed version has failed, see RETRY_MIN_MS
    // The dataset has no route geometry although OSM extracts are configured.
    this.routesMissing = false;
    this.routesWaitMs = 0;
    this.routesRetryAt = 0;
  }

  /** Rejects only if the data directory cannot be used; a failed update is retried by the next check. */
  async start() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      // Better to find out now than after the download.
      const probe = path.join(this.dataDir, '.write-test');
      fs.writeFileSync(probe, '');
      fs.rmSync(probe);
    } catch (err) {
      throw new Error(`the data directory ${this.dataDir} cannot be created or written (${err.message})`, { cause: err });
    }
    // Left behind if the process was stopped in the middle of an import.
    fs.rmSync(this.zipPath, { force: true });
    if (fs.existsSync(this.datasetPath)) {
      try {
        this.load();
      } catch (err) {
        this.log(`Timetable: stored dataset unusable (${err.message}), importing again`);
      }
    }
    await this.check();
    setInterval(() => this.check(), this.checkMs).unref();
  }

  load() {
    const data = readGz(this.datasetPath);
    if (data.version !== DATASET_VERSION) throw new Error('written by another version');
    if (data.area !== this.area.id) throw new Error('made for another area');
    const timetable = new Timetable(data, this.area);
    this.current = data.source;
    this.routesMissing = this.osm.urls.length > 0 && !data.segments;
    this.status.state = 'ready';
    this.status.message = `${timetable.tripCount} trips, ${timetable.stations.length} stations, ${timetable.segPts.length} routed hops`;
    this.log(`Timetable loaded: ${this.status.message}, feed of ${data.source.lastModified ?? 'unknown date'}`);
    this.onTimetable(timetable);
  }

  async check() {
    if (this.busy) return;
    this.busy = true;
    try {
      const head = await fetch(this.url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
      if (!head.ok) throw new Error(`HEAD ${publicUrl(this.url)}: HTTP ${head.status}`);
      const version = head.headers.get('etag') ?? head.headers.get('last-modified');
      this.status.checkedAt = Math.floor(Date.now() / 1000);
      if (!this.current || this.current.etag !== version) {
        // Still waiting after a failed attempt at this version; its error stays in the status.
        if (this.failed?.version === version && Date.now() < this.failed.until) return;
        await this.update(version);
      } else if (this.routesMissing && Date.now() >= this.routesRetryAt) {
        // The timetable is current but there was no OSM data last time.
        await this.runImport('routes', this.current);
      }
      this.status.error = null;
    } catch (err) {
      this.status.error = reason(err);
      this.log(`Timetable: update failed: ${this.status.error}`);
      if (!this.current) {
        this.status.state = 'error';
        this.status.message = 'the timetable could not be loaded';
      }
    } finally {
      this.status.step = null;
      this.busy = false;
    }
  }

  /** Notes what is being done, for /api/status and the log. */
  progress(step, message) {
    this.status.step = step;
    // With a timetable loaded the message stays the summary of that one.
    if (!this.current) {
      this.status.state = 'loading';
      this.status.message = message;
    }
    this.log(`${step === 'routes' ? 'Routes' : 'Timetable'}: ${message}`);
  }

  async update(version) {
    let source = null;
    try {
      this.progress('download', `downloading ${publicUrl(this.url)}`);
      const { size, headers } = await download(this.url, this.zipPath, this.downloadTimeoutMs);
      source = {
        // What the HEAD request called this version, not the ETag of the
        // download: check() compares with the next HEAD, and a server that
        // names the file differently in the two answers would otherwise be
        // asked for it again at every check.
        etag: version,
        lastModified: headers.get('last-modified'),
        importedAt: new Date().toISOString(),
      };
      this.progress('import', `reading the feed (${Math.round(size / 1e6)} MB)`);
      await this.runImport('import', source);
      this.failed = null;
    } catch (err) {
      // Only the OSM step failed: the timetable is in use and check() retries that step.
      if (source && this.current?.etag === source.etag) throw err;
      // The download never began (no connection, an HTTP error). That cost
      // nothing, so the next check simply tries again.
      if (!source && !fs.existsSync(this.zipPath)) throw err;
      const waitMs = nextWait(this.failed?.version === version ? this.failed.waitMs : 0);
      this.failed = { version, waitMs, until: Date.now() + waitMs };
      throw new Error(`${reason(err)}; this feed version will be tried again in ${minutes(waitMs)}`, { cause: err });
    } finally {
      fs.rmSync(this.zipPath, { force: true });
    }
  }

  /** Runs the import worker and notes when the OSM step is due again, should it not have delivered. */
  async runImport(mode, source) {
    const before = this.current;
    try {
      await this.runWorker(mode, source);
    } finally {
      // An import that ended before its timetable was loaded never got to the OSM step.
      if (mode === 'routes' || this.current !== before) {
        this.routesWaitMs = this.routesMissing ? nextWait(this.routesWaitMs) : 0;
        this.routesRetryAt = Date.now() + this.routesWaitMs;
        if (this.routesMissing) this.log(`Routes: no route geometry, next attempt in ${minutes(this.routesWaitMs)}`);
      }
    }
  }

  runWorker(mode, source) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./import-worker.js', import.meta.url), {
        // The Area itself cannot be passed to a worker, its polygons can.
        workerData: {
          mode,
          interim: !this.current,
          zipPath: this.zipPath,
          area: this.area.polygons,
          outPath: this.datasetPath,
          dataDir: this.dataDir,
          source,
          osm: this.osm,
          downloadTimeoutMs: this.downloadTimeoutMs,
        },
      });
      let done = false;
      worker.on('message', (msg) => {
        if (msg.progress) this.progress(msg.step, msg.progress);
        if (msg.done) done = true;
        if (msg.saved) {
          try {
            this.load();
          } catch (err) {
            reject(err);
          }
        }
      });
      worker.on('error', reject);
      worker.on('exit', (code) => (done ? resolve() : reject(new Error(`import worker stopped (exit code ${code})`))));
    });
  }
}
