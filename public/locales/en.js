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
  // What the page is called, in the tab of the browser and in the results of a search engine. The name of the area follows it.
  'page.title': 'Live map of public transport',
  // What it says about itself there, without and with the name of the area ({area}).
  'page.description': 'Live map of public transport: buses, trams, metro, suburban and regional trains with their current delays.',
  'page.descriptionIn': '{area}: buses, trams, metro, suburban and regional trains live on a map, with their current delays and departures.',
  'language.label': 'Language',

  'map.label': 'Map with the current positions of the vehicles',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  // the button that folds the credits in the corner of the map away, on narrow screens
  'map.credits': 'Show or hide the credits',
  // the button above the zoom buttons: it shows where the visitor is, and has the map follow them
  'map.locate': 'Show my location',
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

  // Why the visitor's location is not shown after all; these go away by themselves.
  'locate.denied': 'This page may not see your location. The settings of the browser or of the device can change that.',
  'locate.failed': 'Your location could not be found.',
  'locate.outside': 'Your location is outside the area of this map.',

  // The search for stops and lines, in the card with the filters. The label is also what the empty field says.
  'search.label': 'Search for a stop or a line',
  // the button with the lens that opens the search on a narrow screen, and the one that shuts it again
  'search.open': 'Search',
  'search.close': 'Close the search',
  'search.results': 'Stops and lines found',
  // the headings in the list of what was found, where it is both
  'search.lines': 'Lines',
  'search.stops': 'Stops',
  'search.none': 'No stop or line of that name.',
  'search.loading': 'Loading stops and lines …',
  'search.failed': 'Stops and lines could not be loaded.',

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

  // The view of a line: its vehicles that are under way, under where they go ({destination}), each with the stop ahead of it.
  'line.vehicles': { one: '{count} vehicle under way', other: '{count} vehicles under way' },
  'line.none': 'No vehicle of this line is under way right now.',
  'line.to': 'to {destination}',
  'line.next': 'next: {stop}',
  // on the button that leads from a trip back to the line it was chosen from
  'line.back': 'Back to line {line}',

  'stop.platform': 'Plat. {platform}',
  'stop.skipped': 'skipped',

  'departures.title': 'Departures',
  'departures.none': 'No departures in the next two hours.',
  'departures.cancelled': 'cancelled',
};
