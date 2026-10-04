# Areas

## vgn.geojson

The default area of Netnou: the VGN (Verkehrsverbund Großraum Nürnberg), the
transit network around Nürnberg, as the outlines of its 11 cities and 23
districts. The districts of Eichstätt, Kelheim and Regensburg belong to the
network only in part and are left out; lines running there are still shown as
far as they also serve the area.

The file is a GeoJSON `FeatureCollection` with two things in it:

- `features`: one polygon or multi-polygon per member, with the properties
  `name` and `osm_relation` (the id of the OpenStreetMap relation it comes
  from). The server uses these to decide what is inside the area.
- `outline`: the outer boundary of all members together, as rings of
  `[longitude, latitude]`. It is not part of the GeoJSON standard; the map
  draws it as the edge of the area, so that the borders between the members do
  not show.

### Licence

© OpenStreetMap contributors. The file is derived from OpenStreetMap data,
obtained through Nominatim, and is made available under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/);
see <https://www.openstreetmap.org/copyright>. It is not covered by the MIT
License of the code, and changed versions of it stay under the ODbL.

### Regenerating

```sh
npm run build:area
```

`tools/build-vgn-area.mjs` holds the list of members and fetches their
boundaries from Nominatim, about 40 requests at one per second, as its usage
policy asks. It overwrites this file.

Regenerate only when the network gains or loses a member. Boundaries in
OpenStreetMap change slightly all the time, and any change in the polygons
gives the area a new id: every running instance then imports the timetable
again and downloads the OpenStreetMap extracts again after its next update.

## Other areas

Other areas do not belong in this folder. They are supplied at run time
through `AREA_FILE` or `BBOX`, see
[docs/configuration.md](../../docs/configuration.md#choosing-an-area).
