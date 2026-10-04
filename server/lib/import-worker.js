// Worker thread entry: builds the regional dataset from a downloaded feed, adds
// the route geometry and writes the result to disk. Runs off the main thread
// because parsing stop_times.txt and the OSM extracts keeps a core busy for a
// while. In mode "routes" only the geometry of the stored dataset is redone.
// Every time the dataset has been written the main thread is told to load it.
//
// The time zone set in the main thread (setTimeZone in time.js) does not reach
// this thread and is not needed here: nothing below turns a date into a point
// in time, the importer only counts calendar days (addDays, weekday).

import { parentPort, workerData } from 'node:worker_threads';
import { Area } from './area.js';
import { readGz, writeGz } from './files.js';
import { buildDataset } from './importer.js';
import { buildSegments, loadNetworks } from './shapes.js';

const { mode, interim, zipPath, outPath, dataDir, source, osm, downloadTimeoutMs } = workerData;
const area = new Area(workerData.area);
// What is going on, as shown in /api/status: 'import' while the feed is read,
// 'routes' while OSM data is loaded and routed.
let step = mode === 'routes' ? 'routes' : 'import';
const onProgress = (message) => parentPort.postMessage({ step, progress: message });

function save(data) {
  writeGz(outPath, data);
  parentPort.postMessage({ saved: true });
}

let data;
if (mode === 'routes') {
  data = readGz(outPath);
} else {
  data = await buildDataset({ zipPath, area, onProgress });
  data.source = { ...source, osm: null };
  // With nothing to show yet, do not make visitors wait for the OSM data:
  // start with straight lines between the stops. (Without OSM extracts that
  // is all there will be, and saving once below is enough.)
  if (interim && osm.urls.length) save({ ...data, segments: null });
}

step = 'routes';
const networks = await loadNetworks({ dataDir, urls: osm.urls, area, maxAgeMs: osm.maxAgeMs, timeoutMs: downloadTimeoutMs, onProgress });
data.segments = networks ? buildSegments(data, networks.nets, area, onProgress) : null;
data.source.osm = networks?.fetchedAt ?? null;
// In mode "routes" without networks nothing has changed: the stored dataset is
// left alone, and the main thread is not made to load the same timetable again.
if (networks || mode !== 'routes') save(data);
parentPort.postMessage({ done: true });
