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
  // The settings, behind the gear in the title row: the language, and whether the page is light or dark.
  'settings.title': 'Settings',
  'language.label': 'Language',
  'theme.label': 'Appearance',
  // as the device has it
  'theme.auto': 'Automatic',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  // the small flag on a vehicle on the map that says how many minutes it is early or late
  'flags.label': 'Delay on the vehicles',
  'flags.on': 'Show',
  'flags.off': 'Hide',
  // how the departures of a stop give their times: the time of day, the minutes until they leave, or both
  'times.label': 'Departure times',
  'times.time': 'Time',
  'times.minutes': 'Minutes',
  'times.both': 'Both',
  // the time of day at the top of the board of a stop, which a screen with a clock of its own can do without
  'clock.label': 'Clock on the board',
  'clock.on': 'Show',
  'clock.off': 'Hide',

  'map.label': 'Map with the current positions of the vehicles',
  'map.zoomIn': 'Zoom in',
  'map.zoomOut': 'Zoom out',
  // the button that folds the credits in the corner of the map away, on narrow screens
  'map.credits': 'Show or hide the credits',
  // the button above the zoom buttons: it shows where the visitor is, and has the map follow them
  'map.locate': 'Show my location',
  'map.fullscreen': 'Full screen',
  'map.fullscreenExit': 'Leave full screen',
  // on the marker next to the version in the credits; it leads to the release notes
  'update.available': 'Version {version} is available: release notes',
  'map.unsupported': 'This browser cannot draw the map. It needs WebGL 2, which is switched off or not available here.',
  // followed by the names of those who publish the data (NETNOU_DATA_ATTRIBUTION of the server)
  'attribution.data': 'Timetable and realtime data, processed:',

  'status.connecting': 'Connecting …',
  'status.vehicles': { one: '{count} vehicle', other: '{count} vehicles' },
  'status.live': 'realtime {seconds} s ago',
  // Without any realtime data: while it may still be on its way, and once it is clear that there is none.
  'status.waiting': 'loading realtime …',
  'status.outage': 'no realtime data right now, all by timetable',
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
  'search.label': 'Search for a town, a stop or a line',
  // the button with the lens that opens the search on a narrow screen, and the one that shuts it again
  'search.open': 'Search',
  'search.close': 'Close the search',
  'search.results': 'Towns, stops and lines found',
  // the headings in the list of what was found, where it is both
  'search.towns': 'Towns',
  'search.lines': 'Lines',
  'search.stops': 'Stops',
  'search.none': 'No town, stop or line of that name.',
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
  'mode.ferry': 'Ferry',
  'mode.cable': 'Cable car & monorail',
  'mode.other': 'Other',

  'colorBy.label': 'Colour of the vehicles',
  'colorBy.title': 'Colour by',
  'colorBy.mode': 'Mode',
  'colorBy.delay': 'Delay',

  // the button with the eye next to the settings: it takes the controls of the page away, and brings them back
  'display.enter': 'Hide the controls',
  'display.leave': 'Show the controls',

  'delay.early': 'early',
  'delay.onTime': 'on time',
  'delay.from': 'from {minutes} min',
  // {delay} is a signed number of minutes such as +3
  'delay.minutes': '{delay} min',
  'delay.none': 'timetable only',

  // the operator's own links at the foot of the card: who runs the instance, how it treats personal data and the like
  'links.label': 'About this service',

  // The line at the foot of the card: what everybody should know about the markers …
  'about.fact': 'Positions are estimated, not measured.',
  // … and, on the button after it and as the heading of the dialog it opens, the way to how the page comes by them.
  'about.title': 'How it works',
  'about.positions': 'Positions',
  'about.positionsText': 'No vehicle reports its position to this map. Each one is drawn where the timetable says it should be right now, moved by the delay reported for it. So a vehicle can be somewhat ahead of or behind its marker. Vehicles without a reported delay carry a question mark and run by the timetable here.',
  'about.routes': 'Routes',
  'about.routesText': 'The route between two stops is computed too: the shortest plausible way along the roads and tracks of OpenStreetMap, not the official one of the operator. Between stops close to each other it is almost always the same. Where it differs, a vehicle takes another way on the map than in reality; where none is found, it moves in a straight line.',
  // Only shown where the instance has more vehicles than a zoomed-out map can show
  'about.thinned': 'Zoomed out',
  'about.thinnedText': 'Where very many vehicles are under way, the zoomed-out map shows only some of them: a phone could not draw that many at once, and loading them would take long. It shows the same share of every kind of transport, picked by chance, so a city stays much busier on the map than the country around it. A kind with only a few vehicles is shown whole, and a single vehicle far from all others always stays. Zoom in, and all of them are there.',
  'about.outside': 'Outside the area',
  // next to a sample of the grey that lies over the map there
  'about.outsideText': 'Grey: only lines that stop inside the area are shown there, on a straight line between their stops.',
  // {software} is the name of the software, as a link to where it comes from
  'about.source': 'The full details are in the open source code of {software}, the software behind this map.',

  'panel.label': 'Details',
  'panel.close': 'Close',
  // on the bar at the top of the details where they are a sheet from the bottom: a tap makes it one step higher, and lower again from the highest
  'panel.resize': 'Make the details larger or smaller',
  'panel.loading': 'Loading …',
  'panel.noData': 'There is no data on this right now.',
  'panel.loadFailed': 'The data could not be loaded.',
  'panel.share': 'Share',
  'panel.copied': 'Address copied',
  // the button that enlarges the details of a stop into a board of its departures, and the one that makes the board the details again
  'panel.enlarge': 'Enlarge',
  'panel.shrink': 'Make smaller',

  'trip.realtime': 'realtime data',
  'trip.scheduleOnly': 'timetable data only',
  // {source} is the operator the realtime data of the trip comes from
  'trip.source': 'Realtime data: {source}',
  'trip.cancelled': 'Trip cancelled',

  // The notes of the operator about a trip or a stop, in the head of the details. Past the first few, a button
  // names the rest by their number and opens them; it is also the heading of the dialog they open in.
  'notes.more': { one: '{count} more notice', other: '{count} more notices' },
  // the heading of the dialog for a single note that has no headline of its own
  'notes.title': 'Notice',
  // what a screen reader says for the sign of a note that warns, of the reason for a delay for example
  'notes.warning': 'Warning',
  // the same where the sign stands alone, in a list of departures: {text} is what the warning says
  'notes.warningOf': 'Warning: {text}',

  // The view of a line: its vehicles that are under way, under where they go ({destination}), each with the stop ahead of it.
  'line.vehicles': { one: '{count} vehicle under way', other: '{count} vehicles under way' },
  'line.none': 'No vehicle of this line is under way right now.',
  'line.to': 'to {destination}',
  'line.next': 'next: {stop}',
  // the name of the badge at the top of a trip, which leads to its line
  'line.open': 'To line {line}',

  'stop.platform': 'Plat. {platform}',
  'stop.skipped': 'skipped',

  'departures.title': 'Departures',
  'departures.none': 'No departures in the next 24 hours.',
  'departures.cancelled': 'cancelled',
  // how long until a departure leaves: under a minute, and in whole minutes
  'departures.now': 'now',
  'departures.minutes': '{count} min',
  // the line in a list of departures where the next day begins
  'departures.tomorrow': 'tomorrow',

  // the page of an address of a stop or a line (#37), for search engines and previews
  'address.stopTitle': '{stop} departures live',
  'address.stopDescription': 'Departures at {stop} in real time: {lines}, live on the map.',
  'address.stopDescriptionNone': 'Departures at {stop} in real time, live on the map.',
  'address.more': '{lines}, plus {kinds}',
  'address.lineTitle': '{line} {route} live',
  'address.lineDescription': '{line} ({agency}) live on the map, every trip with its delay.',
  'address.stopGone': 'This stop is not in the timetable.',
  'address.lineGone': 'This line is not in the timetable.',
  // (the kinds of transport within a sentence)
  'address.kind.subway': 'U-Bahn',
  'address.kind.tram': 'tram',
  'address.kind.bus': 'bus',
  'address.kind.suburban': 'S-Bahn',
  'address.kind.regional': 'regional train',
  'address.kind.longdistance': 'long-distance train',
  'address.kind.ferry': 'ferry',
  'address.kind.cable': 'cable car and monorail',
  'address.kind.other': 'line',
};
