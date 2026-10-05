// English – the reference: every other language has exactly these keys, and
// what is not found in a language falls back to the text here.
//
// A value is a text, with {placeholders} for what the script puts in. Where the
// wording depends on a number it is an object with one text per plural form of
// the language (English: one, other; see Intl.PluralRules), chosen by {count}.
// Numbers are put in formatted for the language.
//
// test/frontend.test.js compares the languages and checks that every key is used.

export default {
  'page.description': 'Live map of public transport: buses, trams, metro, suburban and regional trains with their current delays.',
  'language.label': 'Language',

  'map.label': 'Map with the current positions of the vehicles',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  // the button that folds the credits in the corner of the map away, on narrow screens
  'map.credits': 'Show or hide the credits',
  // on the marker next to the version in the credits; it leads to the release notes
  'update.available': 'Version {version} is available: release notes',
  'map.unsupported': 'This browser cannot draw the map. It needs WebGL 2, which is switched off or not available here.',
  // followed by the names of those who publish the data (DATA_ATTRIBUTION of the server)
  'attribution.data': 'Timetable and realtime data, processed:',

  'status.connecting': 'Connecting …',
  'status.vehicles': { one: '{count} vehicle', other: '{count} vehicles' },
  'status.live': 'realtime {seconds} s ago',
  'status.scheduleOnly': 'timetable data only',
  'status.loading': 'Loading timetable data',
  'status.noTimetable': 'No timetable data',
  'status.noConnection': 'No connection to the server',

  // While the server has no timetable yet: what it is doing, by the state and step it reports.
  'loading.starting': 'The server is starting …',
  'loading.download': 'The server is downloading the timetable data …',
  'loading.import': 'The server is processing the timetable data …',
  'loading.routes': 'The server is working out the routes of the lines …',
  'loading.timetable': 'The timetable data is being loaded …',
  'loading.error': 'The timetable data could not be loaded.',
  'banner.offline': 'No internet connection – the live map needs one.',

  'modes.label': 'Show or hide modes of transport',
  // U-Bahn and S-Bahn are what the signs say
  'mode.subway': 'U-Bahn',
  'mode.tram': 'Tram',
  'mode.bus': 'Bus',
  'mode.suburban': 'S-Bahn',
  'mode.regional': 'Regional train',
  'mode.longdistance': 'Long-distance',
  'mode.other': 'Other',

  'colorBy.label': 'Colour of the vehicles',
  'colorBy.title': 'Colour by',
  'colorBy.mode': 'Mode',
  'colorBy.delay': 'Delay',

  'delay.onTime': 'on time',
  'delay.from': 'from {minutes} min',
  // {delay} is a signed number of minutes such as +3
  'delay.minutes': '{delay} min',
  'delay.none': 'timetable only',

  'area.hint': 'Grey: outside the area. Only lines that stop inside it are shown there, on a straight line between their stops.',

  'panel.label': 'Details',
  'panel.close': 'Close',
  'panel.loading': 'Loading …',
  'panel.noData': 'There is no data on this right now.',
  'panel.loadFailed': 'The data could not be loaded.',

  'trip.realtime': 'realtime data',
  'trip.scheduleOnly': 'timetable data only',
  // {source} is the operator the realtime data of the trip comes from
  'trip.source': 'Realtime data: {source}',
  'trip.cancelled': 'Trip cancelled',

  'stop.platform': 'Plat. {platform}',
  'stop.skipped': 'skipped',

  'departures.title': 'Departures',
  'departures.none': 'No departures in the next two hours.',
  'departures.cancelled': 'cancelled',
};
