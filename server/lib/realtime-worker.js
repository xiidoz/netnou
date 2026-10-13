// Worker thread entry: reads the realtime feed for the server. It fetches the
// feed, decodes it, matches it against the timetable and hands on what comes
// of that, in columns (snapshot.js). For a large instance that takes more than
// a second each time and leaves hundreds of megabytes of short-lived objects:
// here it neither stops the thread that answers requests nor grows its memory.
//
// The timetable is not copied. The main thread has the bytes of the dataset in
// memory that threads share, and this thread lays a schedule of its own over
// them (Schedule in timetable.js) – without the lists of texts but for the
// days, as it needs no other.
//
// The thread fetches when it is told to and answers every time, with one of
//   { columns, etag, timestamp }   what the feed says now
//   { unchanged: true }            the feed is the one fetched before
//   { error }                      why it could not be fetched or read
// When to fetch, and what a failure means for the delays in use, is for
// RealtimePoller in realtime.js to say.

import { parentPort, workerData } from 'node:worker_threads';
import { datasetFrom } from './dataset.js';
import { publicUrl, reason } from './files.js';
import { get } from './http.js';
import { decodeFeed } from './pb.js';
import { buildRealtime, takeTripUpdate } from './realtime.js';
import { Gathering, memoryOf } from './snapshot.js';
import { setTimeZone } from './time.js';
import { Schedule } from './timetable.js';

// One fetch may take this long, from the first attempt to connect to the last
// byte. When the provider's server is busy it is slow to pick up and slow to
// deliver, and a client that gives up early gets nothing and adds to the load
// by starting over.
const FETCH_LIMIT_MS = 90_000;

const { shared, timeZone, url, userAgent } = workerData;
// (the zone is module state and so of each thread: service days begin by it)
setTimeZone(timeZone);
const schedule = new Schedule(datasetFrom(shared, { lists: ['dates'] }));

parentPort.on('message', async ({ etag }) => {
  try {
    const headers = {};
    if (userAgent) headers['User-Agent'] = userAgent;
    if (etag) headers['If-None-Match'] = etag;
    const res = await get(url, { headers, timeoutMs: FETCH_LIMIT_MS });
    if (res.status === 304) {
      parentPort.postMessage({ unchanged: true });
      return;
    }
    if (res.status < 200 || res.status > 299) throw new Error(`GET ${publicUrl(url)}: HTTP ${res.status}`);
    // The trip updates are taken one by one as they are read, and none is
    // kept: of a feed for a whole country they are most of what there is.
    const taken = { gathered: new Gathering(), matched: 0 };
    const feed = decodeFeed(res.body, {
      wantTrip: (trip) => schedule.tripIndex.has(trip.tripId),
      wantAlert: (alert) => alert.informed.some((e) => schedule.tripIndex.has(e.tripId) || schedule.stopIndex.has(e.stopId)),
      onTripUpdate: (update) => {
        if (takeTripUpdate(schedule, taken.gathered, update)) taken.matched++;
      },
    });
    const { columns } = buildRealtime(schedule, feed, undefined, taken);
    // (the memory of the columns changes hands: nothing is copied)
    parentPort.postMessage({ columns, etag: res.headers.etag ?? null, timestamp: feed.timestamp || null }, memoryOf(columns));
  } catch (err) {
    parentPort.postMessage({ error: reason(err) });
  }
});
