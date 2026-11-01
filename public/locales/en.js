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
  'delays.label': 'Delay on the vehicles',
  'delays.number': 'Number',
  'delays.color': 'Colour',
  'delays.off': 'Off',
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
  // What is live is the delays, not the positions: the status line says so.
  'status.live': 'delays as of {seconds} s ago',
  // Without any realtime data: while it may still be on its way, and once it is clear that there is none.
  'status.waiting': 'loading delays …',
  'status.outage': 'no delay data right now, all by timetable',
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
  'search.nearby': 'Nearby',
  'search.favourite': 'Favourite',
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


  // the button with the eye next to the settings: it takes the controls of the page away, and brings them back
  'display.wall': 'As a wall screen',
  'controls.fold': 'Fold or unfold the controls',
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
  'about.fact': 'Positions are calculated, not tracked by GPS.',
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
  // What a visitor can do, in the dialog after the positions (#226): what to do, then what it does and what it is good for.
  // With a mouse, the four that say "tap" say "click" (…Mouse).
  'about.use': 'What the map can do',
  'about.useVehicle': 'Tap a vehicle:',
  'about.useVehicleMouse': 'Click a vehicle:',
  'about.useVehicleText': 'its trip with every stop, time and delay, to see when it gets where.',
  'about.useStop': 'Zoom in, tap a stop:',
  'about.useStopMouse': 'Zoom in, click a stop:',
  'about.useStopText': 'its next departures with delays, to see whether you will still make it.',
  'about.useDeparture': 'Tap a departure:',
  'about.useDepartureMouse': 'Click a departure:',
  'about.useDepartureText': 'straight to its vehicle on the map, to see where it is now.',
  'about.useSearch': 'Search:',
  'about.useSearchText': 'a town, a stop or a line. A line then shows only its own vehicles.',
  'about.useFavourite': 'Tap the heart:',
  'about.useFavouriteMouse': 'Click the heart:',
  'about.useFavouriteText': 'makes a stop or a line a favourite. Favourites come first in the search, even before anything is typed.',
  // (the chips with the kinds of transport and their numbers)
  'about.useModes': 'Tap a kind of transport:',
  'about.useModesMouse': 'Click a kind of transport:',
  'about.useModesText': 'hides it or shows it again, for example to see only trains.',
  'about.useColor': 'Colour by delay:',
  'about.useColorText': 'in the settings. Every vehicle in the colour of its delay, to see at a glance where things run late.',
  'about.useShare': 'Share:',
  'about.useShareText': 'a link to a stop, a line or a trip, for example to show someone where the bus is right now.',
  'about.useBoard': 'Show as a board:',
  'about.useBoardText': 'departures in large type, for example on a screen on the wall, for up to four stops.',
  // The one tip, once, on landing at the address of a stop, above its departures; with a mouse the second.
  'tip.departure': 'Tap a row to go straight to its vehicle on the map',
  'tip.departureMouse': 'Click a row to go straight to its vehicle on the map',

  'panel.label': 'Details',
  'panel.close': 'Close',
  // on the bar at the top of the details where they are a sheet from the bottom: a tap makes it one step higher, and lower again from the highest
  'panel.resize': 'Make the details larger or smaller',
  'panel.loading': 'Loading …',
  'panel.noData': 'There is no data on this right now.',
  'panel.loadFailed': 'The data could not be loaded.',
  'panel.share': 'Share',
  'panel.copied': 'Address copied',
  'panel.favourite': 'Add to favourites',
  'panel.unfavourite': 'Remove from favourites',
  'panel.favourited': 'Favourited: at the top of the search',
  // the button that enlarges the details of a stop into a board of its departures, and the one that makes the board the details again
  'panel.enlarge': 'Enlarge',
  'panel.board': 'Board',
  // a board of several stops (#163): the button at its foot that adds a stop as a block of its own, and what the search says while it adds one
  'board.another': 'Another stop',
  'board.addTitle': 'Add to the board',
  // the button at the heading of a block that adds a stop to its list (heard, not seen), and what the search says while it does
  'board.own': 'As a list of its own',
  'board.mergeTitle': 'Show together with {stop}',
  // the minus after the name of a stop on a board of several (heard, not seen)
  'board.remove': 'Take {stop} off the board',
  // under each departure of a list of several stops: the stop it leaves from
  'board.from': 'from {stop}',
  // in place of a stop of the board the timetable does not have
  'board.gone': '{stop} is not in the timetable.',

  'trip.realtime': 'with delay data',
  'trip.scheduleOnly': 'timetable only',
  // {source} is the operator the delay data of the trip comes from (not who caused the delay)
  'trip.source': 'Delay data from {source}',
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

  // The view of a line (#256): how many of its vehicles are under way, and its stops in one direction with its vehicles
  // along them; where it goes two ways, a switch between them after "to", each named by its destination. {destination}
  // is where a vehicle goes, for a screen reader. Below a station: that some of its trips start or end there.
  'line.vehicles': { one: '{count} vehicle under way', other: '{count} vehicles under way' },
  'line.to': 'to {destination}',
  'line.toward': 'to',
  // what a screen reader calls the switch
  'line.ways': 'Direction',
  'line.starts': 'Some trips start here',
  'line.ends': 'Some trips end here',
  'line.turns': 'Some trips start and end here',
  // the name of the badge at the top of a trip, which leads to its line
  'line.open': 'To line {line}',

  'stop.platform': 'Plat. {platform}',
  'stop.skipped': 'skipped',

  // what a stop on a screen on a wall shows, which has nothing to choose
  'departures.title': 'Departures',
  // the switch below the name of a stop (#255): its departures in the order they leave, and every line that leaves there
  // with when it next leaves each way; the label is what a screen reader calls the switch
  'view.label': 'View',
  'view.departures': 'Next departures',
  'view.lines': 'All lines',
  // in the list of all lines, a way with no departure in the next 24 hours: in short where the time stands, and in full
  // under a mouse and for a screen reader
  'lines.later': 'not in 24 h',
  'lines.laterLong': 'Not in the next 24 hours',
  // the chip beside the switch that opens the sheet to choose which lines the departures are of, while all are shown
  'choice.filter': 'Filter',
  // the button in that sheet that shows all of them again
  'choice.all': 'All lines',
  'choice.only': 'Only',
  'choice.more': '+{count}',
  'choice.clear': 'Show all lines',
  'choice.title': 'Which departures?',
  'choice.hint': 'Tap a direction to show only it. Tap again to take it out.',
  'choice.via': '{to} via {stop}',
  'choice.direction': '{line} to {to}',
  'departures.none': 'No departures in the next 24 hours.',
  'departures.cancelled': 'cancelled',
  // how long until a departure leaves: under a minute, and in whole minutes
  'departures.now': 'now',
  'departures.planned': 'planned {time}',
  'departures.minutes': '{count} min',
  // the line in a list of departures where the next day begins
  'departures.tomorrow': 'tomorrow',

  // the page of an address of a stop or a line (#37), for search engines and previews
  'address.stopTitle': '{stop} departures live',
  'address.stopWithTown': '{stop}, {town}',
  'address.stopInTown': '{stop} in {town}',
  'address.stopDescription': 'Departures at {stop} in real time: {lines}, live on the map.',
  'address.stopDescriptionNone': 'Departures at {stop} in real time, live on the map.',
  'address.more': '{lines}, plus {kinds}',
  'address.lineTitle': '{line} {route} live',
  'address.lineDescription': '{line} ({agency}) live on the map, every trip with its delay.',
  'address.stopGone': 'This stop is not in the timetable.',
  'address.lineGone': 'This line is not in the timetable.',
  // a trip (#178): its line and where it goes, where and when it starts (the time and the day as the language writes them)
  'address.tripTitle': '{line} to {to} live',
  'address.tripDescription': '{line} to {to}, from {from} at {time} on {day}: live on the map, with its delay at every stop.',
  'address.tripGone': 'This trip is not in the timetable.',
  'address.gone': 'This page does not exist.',
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
