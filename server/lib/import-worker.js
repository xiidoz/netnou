// Worker thread entry: builds the regional dataset from a downloaded feed, adds
// the route geometry and the towns of the stops and writes the result to disk.
// Runs off the main thread because parsing stop_times.txt and the OSM extracts
// keeps a core busy for a while. In mode "routes" only what comes from the OSM
// extracts is redone for the stored dataset.
// Every time the dataset has been written the main thread is told to load it.
//
// The time zone set in the main thread (setTimeZone in time.js) does not reach
// this thread and is not needed here: nothing below turns a date into a point
// in time, the importer only counts calendar days (addDays, weekday).

import { parentPort, workerData } from 'node:worker_threads';
import { Area } from './area.js';
import { readDataset, writeDataset } from './dataset.js';
import { buildDataset } from './importer.js';
import { KeptRoutes } from './kept-routes.js';
import { NETWORKS_VERSION } from './network.js';
import { buildSegments, loadNetworks } from './shapes.js';
import { townsOf } from './towns.js';

const { mode, interim, zipPath, outPath, dataDir, source, osm, downloadTimeoutMs, agencies, scope } = workerData;
// (an instance may have no area: what it covers is then seen from its trips)
const area = workerData.area ? new Area(workerData.area) : null;
// What is going on, as shown in /api/status: 'import' while the feed is read,
// 'routes' while OSM data is loaded and routed.
let step = mode === 'routes' ? 'routes' : 'import';
const onProgress = (message) => parentPort.postMessage({ step, progress: message });

function save(data) {
  writeDataset(outPath, data);
  parentPort.postMessage({ saved: true });
}

let data;
if (mode === 'routes') {
  data = readDataset(outPath);
} else {
  data = await buildDataset({ zipPath, area, agencies, onProgress });
  data.source = { ...source, osm: null };
  // With nothing to show yet, do not make visitors wait for the OSM data:
  // start with straight lines between the stops. (Without OSM extracts that
  // is all there will be, and saving once below is enough.)
  if (interim && osm.urls.length) save({ ...data, segments: null });
}

step = 'routes';
let networks = null;
if (osm.urls.length) {
  // Without an area the stops of the trips, and the straight lines between
  // them, say where OpenStreetMap data is kept and routes are looked for.
  const { stops, patterns } = data;
  const region = area ?? Area.covering(stops.lat, stops.lon, (hop) => {
    for (let pattern = 0; pattern + 1 < patterns.start.length; pattern++) {
      for (let k = patterns.start[pattern] + 1; k < patterns.start[pattern + 1]; k++) hop(patterns.stops[k - 1], patterns.stops[k]);
    }
  });
  networks = await loadNetworks({ dataDir, urls: osm.urls, area: region, scope, maxAgeMs: osm.maxAgeMs, timeoutMs: downloadTimeoutMs, onProgress });
  if (networks) {
    // (with the routes of the imports before, as far as they were found on these networks)
    const kept = new KeptRoutes(dataDir, { fetchedAt: networks.fetchedAt, scope });
    data.segments = buildSegments(data, networks.nets, region, onProgress, { kept });
    kept.save();
    // (the towns of the stations, by the borders in the same extracts)
    const { names, of } = townsOf(data.stops, networks.towns);
    Object.assign(data, { towns: names, stops: { ...data.stops, town: of } });
  }
}
if (!networks) data.segments = null;
data.source.osm = networks?.fetchedAt ?? null;
// (and the kind of networks they were found on: routes found on older ones are found anew, see feed.js)
data.source.networks = networks ? NETWORKS_VERSION : null;
// In mode "routes" without networks nothing has changed: the stored dataset is
// left alone, and the main thread is not made to load the same timetable again.
if (networks || mode !== 'routes') save(data);
parentPort.postMessage({ done: true });
