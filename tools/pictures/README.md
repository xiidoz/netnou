# The data of the pictures

`npm run build:pictures` takes the pictures of the page in the READMEs
(`docs/pictures/`) from the files here. It starts a server of the checkout on
them and holds its clock at one moment: Monday, 16 November 2026, 13:37 in
Nürnberg. So the pictures come out the same at whatever hour they are taken,
and change only where the page does, or the map behind the vehicles, which
comes from OpenFreeMap.

| File | What it is | Made from |
| --- | --- | --- |
| `feed.zip` | the timetable: all the trips of that day that call around Nürnberg and Fürth, with their stops, lines and operators as the feed has them; their service runs on that day alone. Always the whole day, never some hours of it: what the page says of a day, such as the first and last departure of a stop, is then true in the pictures as well | the GTFS feed of Germany of [gtfs.de](https://gtfs.de), provided by DELFI e.V., as published on 31 October 2026 |
| `osm.pbf` | the roads and tracks of that area and a little around it, and the borders of its towns and districts | the extract of Middle Franconia of [Geofabrik](https://download.geofabrik.de/europe/germany/bayern/mittelfranken.html), OpenStreetMap data of 2 November 2026 |
| `realtime.pb` | delays for the trips under way between 12:30 and 15:45, as a GTFS-Realtime feed like that of gtfs.de, with its notes on who provides the delay data of each operator | made up: each trip's delay comes from its id. Bus 36, which leaves Nürnberg Hallertor at 13:35, is 1 min 40 s late, so that at 13:37 it has just left it |
| `moment.json` | the moment, the stop and the bus that the pictures follow, and what the data was made from | |

## Licences

These files are not under the MIT License of the code:

- `feed.zip` and `realtime.pb`, which names its trips and operators, are under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), as the feed
  of gtfs.de is. Changed: only the trips of the area are kept, and their
  service runs on 16 November 2026 alone.
- `osm.pbf` is © OpenStreetMap contributors, under the
  [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
  See <https://www.openstreetmap.org/copyright>.

## Making it again

Only when the pictures need something this data does not have, such as
another moment or another place:

```sh
node tools/build-picture-data.mjs <the feed of gtfs.de> <mittelfranken-latest.osm.pbf>
```

The feed has to run on the day of the moment, which is set at the top of
`tools/build-picture-data.mjs` with the area, the stop and how late the bus
is. It reads all of the feed of Germany, which takes a minute or two. Then
take the pictures again and check them.
