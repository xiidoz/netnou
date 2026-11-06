# Product

<!-- impeccable:product-schema 1 -->

What Netnou is for, for whom, and the principles its page is held to. It
records product decisions, not the look: design work on the page (reviews,
new views) starts from here. See README.md for what it does and
docs/ for how it is run.

## Platform

web

## Users

- **Riders** of the region an instance covers, most of them on a phone: on
  the way to a stop, waiting at one, sitting in a bus or train. They know
  their town and their lines, not how a timetable feed works, and they read
  the page at a glance.
- **Riders at home or at work** on a wide screen, looking up a line, a stop
  or a trip before they leave.
- **The curious,** who watch the traffic of their region for its own sake:
  what moves where, how busy the city gets at rush hour, which night buses
  are out after midnight, as others watch planes on a flight tracker. They
  come for the map, not for a trip.
- **People passing a screen on a wall** (a board of departures in a
  hallway, a shop, an office), who read it from a distance and touch
  nothing.
- **Operators** who run an instance for a region, with Docker or Node.js,
  and set it up with `NETNOU_` settings.

## Product Purpose

Netnou shows buses and trains where they are right now, with their delays
and the next departures at every stop, for a region as small as a town or
as large as all of Germany. It serves two wants, on one page and without
an app of the operator:

- **Will I make it?** A rider in a hurry is answered by the departures at
  their stop: the time, the delay, the minutes left. Where exactly the bus
  is helps them less. A calculated position is good to a few hundred
  metres, for a fast train to a kilometre, and a run for the bus would
  need tens of metres.
- **What is happening out there?** Everything under way, moving on one
  map, is interesting in itself. It is what catches the eye and draws
  people to the page, and it shows roughly where a bus is and how a line
  runs.

Success: a rider who has never seen the page finds their bus and knows
whether to run, without reading an explanation; and someone who opened it
out of curiosity stays to watch.

## Positioning

- **Positions are calculated, not tracked by GPS.** The feeds have
  timetables and delays but no positions, so each vehicle is drawn where its
  timetable and its reported delay put it, along its real route from
  OpenStreetMap. The page says so in one sentence, and how in "So
  funktioniert's".
- **Everything that moves, on one map:** every operator and every kind of
  transport of the region, from the tram to the long-distance train,
  instead of one operator's network.
- **Open source and open data:** one program that anyone can run for their
  region from public feeds, without accounts, tracking or extra services.

## Operating Context

- **On the move:** one hand, outdoors, a small screen in sun or at night
  (light and dark scheme), a slow or patchy connection. The page installs
  as an app.
- **Shared links:** a stop, a line or a trip is sent to someone ("where is
  the bus now?"); the address opens exactly that, in the visitor's
  language.
- **Found by search engines:** the pages of stops and lines are read and
  listed, so the server writes what a page says (names, lines, how often
  they run) into it, not only the script.
- **On a wall:** a board of up to four stops, in large type, that looks
  after itself all day (display mode).

## Capabilities and Constraints

- The map of the region with every vehicle under way, coloured by its kind
  of transport or by its delay; the stops and their next departures; all
  lines of a stop; a line with its stops and vehicles and its timetable of
  the coming week; a trip with every stop, time and delay; a search for
  towns, stops and lines; favourites; filters by line and direction; a
  board of departures; sharing; German and English.
- **Data:** a GTFS timetable and GTFS-RT delays (in Germany from gtfs.de),
  routes and towns from OpenStreetMap extracts, the base map from a tile
  service the operator chooses. Times, delays and the operators' texts are
  shown as they come; Netnou does not correct them.
- **One process:** one Node.js program, without a database and without
  runtime dependencies; the timetable of all of Germany fits in it.
- **What stays in the browser:** the visitor's location, what they type in
  the search, their settings and favourites.
- **Terms:** Linie (line), Fahrt (trip), Haltestelle (stop), Richtung
  (direction), Abfahrten (departures), Tafel (board), Verspätung (delay);
  "unterwegs" for vehicles under way.

## Brand Commitments

- **Name:** Netnou is the software. A public instance has its own name and
  icon; the repository carries none of them.
- **Voice:** plain, spoken German and English, as a rider would say it: "So
  funktioniert's" rather than "So funktioniert die Karte". One main message
  in sight, the workings behind a link.
- **The map's colours:** each kind of transport its own colour, each delay
  its own; white letters on all of them.
- **Icons** show what the page does, in a simplified form (a vehicle on its
  route, a delay), rather than letters or borrowed symbols.

## Evidence on Hand

- The pictures in the READMEs (`docs/pictures/`) are made by
  `npm run build:pictures` from a saved day of a real timetable around
  Nürnberg (`tools/pictures/`); their delays are made up for the picture.
- There are no user numbers, testimonials or comparisons in the repository,
  and none are to be invented.

## Product Principles

1. **Self-explanatory for everyday riders.** Someone who uses the page for
   the first time understands it and finds their way without instructions.
   Controls say what they do; texts are short and spoken; the main message
   is in sight and the details are one tap away.
2. **Consistent across the page.** A pattern used in one place is used
   wherever the same thing appears: the same control, the same words, the
   same place on the screen. Recognition is what makes the second view
   easy.
3. **Phone first.** Most riders are on a phone. Where a phone and a wide
   screen pull apart, the phone in portrait is made right and the cost
   elsewhere is said; the wide screen is never left broken.
4. **The map shows what is happening.** The moving map is what catches the
   eye, so it shows the traffic as it is: a bustling city looks busy and
   the countryside quiet. Vehicles are only thinned where speed needs it,
   never for tidiness, and one kind never makes room for another.
5. **Honest, and private.** What is drawn or said must be so: calculated
   positions say they are, figures hold for every departure they name,
   operators' data is shown as provided. What a visitor does stays in their
   browser, and no service is added that has nothing to do with public
   transport.

## Accessibility & Inclusion

- Every control can be reached and used with a keyboard, in the order of
  the page (the details first, then the card, then the map), and its focus
  ring is always on top of everything else.
- On a touch screen every control takes a finger over 44 by 44 px, and
  controls side by side never share it.
- Text on the map's colours keeps a contrast of at least 4.5:1; meaning is
  carried by signs and words, never by a shade alone.
- Controls and the vehicles of a line have names for screen readers; long
  content opens as a dialog that keeps the keyboard inside it.
- With the setting for reduced motion, sheets, dialogs and scrolling come to
  rest at once; the vehicles keep moving, as that is what the map shows.
