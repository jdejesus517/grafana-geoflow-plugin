# GeoFlow

GeoFlow is an open-source Grafana panel plugin that renders geographic features stored in PostgreSQL/PostGIS. It reads data through Grafana's built-in PostgreSQL data source and draws it with [MapLibre GL JS](https://maplibre.org/).

> **Status: pre-MVP.** The panel draws each query as a named layer on an interactive basemap, styled per query and by value, with tooltips that show each feature's attributes. It fits the view to the data, keeps the view and tooltips through refreshes, and warns about problems on the map. Its limits are measured: see [Sizing](#sizing). Phase 9 is complete; the license review comes in Phase 10. See [docs/architecture.md](docs/architecture.md) for the target design and phase plan.

- Plugin id: `jdejesusio-geoflow-panel`
- Requires Grafana 13.2 or later
- Database: PostgreSQL 16+ with PostGIS 3.x

## Writing queries

Use Grafana's PostgreSQL data source with the query **Format** set to **Table**, and return the geometry as GeoJSON in WGS84 (EPSG:4326):

```sql
SELECT
  id,
  name,
  status,
  ST_AsGeoJSON(ST_Transform(geom, 4326), 6) AS geometry
FROM assets
WHERE $__timeFilter(updated_at)   -- optional; any Grafana macro works
ORDER BY id
```

- **Geometry types:** Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon. Points are drawn as circles, lines as lines, and polygons filled with an outline.
- **Geometry column:** GeoFlow finds it by name (`geometry`, `geom`, `geojson`, `the_geom`, `wkb_geometry` or `shape`) or by content. It accepts GeoJSON text, `json`/`jsonb` values, and whole GeoJSON Features such as `ST_AsGeoJSON(t.*)`, whose properties are kept.
- **`ST_Transform(geom, 4326)`:** needed unless the data is already in WGS84. Rows in another coordinate system are skipped.
- **Precision `6`:** about 0.1 m, which roughly halves the size of the result compared with the default.
- **Other columns:** are shown in the feature's tooltip.
- **An `id` column** (any column named `id`) identifies features. Keep it unique: a pinned tooltip then follows its feature when the dashboard refreshes. Text ids work too.
- **`ORDER BY`:** a refresh that returns the same rows in the same order costs almost nothing: GeoFlow reuses what it drew, and a tooltip under the pointer stays open. Without `ORDER BY`, PostgreSQL may return rows in another order each time, and the layer is redrawn. On 100k rows, that's a pause of about 0.4 s per refresh.
- **Other geometry or id columns:** pick them in the [Layers](#layers) list when detection chooses the wrong ones, or a query returns two geometry columns.

**Each query is a layer.** Queries A, B, C… are drawn in that order, later ones on top, each in its own color from the Grafana theme unless styled otherwise (see [Styling](#styling)). Queries without a geometry column are left out. The [Layers](#layers) list names, reorders and hides them.

**Rows that can't be drawn are skipped:** empty or invalid geometry, GeometryCollections, other coordinate systems, and coordinates outside ±180/±90. Rows skipped for any reason but empty geometry show a warning on the map (see [Warnings](#warnings)). Turn on **Show data summary** in the panel options to see how many rows each query lost, and why. If no query has a geometry column, the panel says what to select instead. For example, a raw PostGIS `geom` column needs `ST_AsGeoJSON(geom)`.

## Layers

**Layers**, at the top of the panel options, lists one row per query, top layer first:

- **Visibility** (the eye): a hidden layer isn't drawn, has no tooltips and no legend entry. Showing it again is quick: its data stays loaded.
- **Move up** and **Move down** change the drawing order.
- Click a row's name for its settings:
  - **Name:** shown in tooltips, the legend and the data summary, in place of "Query A" or the frame's name
  - **Geometry column** and **ID column:** override what GeoFlow detects. A named column the query no longer returns leaves the layer empty and says so in the row and the data summary.
  - **Tooltips:** off for background layers, such as building footprints under other features. The layer is drawn, but hovering it shows the features below instead.

The list follows the queries: a new query appears on top with default settings. Settings of a query that no longer returns data, or whose letter was renamed, stay in the list as **No data** until removed with the bin button, as Grafana does with field overrides. Moving or hiding a layer doesn't change the other layers' colors.

Style isn't in the list: it stays in the field options, per query through overrides (see [Styling](#styling)).

**A query that returns several frames** gets a layer for each, named after the frame. To split one query into a layer per value, see the next section.

## Splitting a query by value

To draw each value of a column as its own layer, such as cables by placement, split the query with Grafana's **Partition by values** transformation:

1. In the panel editor's **Transform** tab, add **Partition by values**, and pick the column to split by (`placement`).
2. Set **Naming** to **As frame name**. Each layer is then named by its value (`aerial`), and its frame by the query and value (`A-aerial`). With the default **As label**, layers are named `placement=aerial`, and they can't be styled one by one.
3. To style one value, add a **Fields returned by query** override on its frame, such as `A-aerial`, with a **Color scheme** or any **Map style** option.
4. Keep colors and order stable as the data changes. The transformation makes a frame per value in the order values first appear in the rows, so a value that moves up would recolor and restack the others. Sort by the split column first (`ORDER BY placement, id`), and set **Color scheme** to **Classic palette (by series name)**, which colors each layer by its name.
5. Name missing values in the query. A null value gets a layer of its own, named `placement=null`, or with **As frame name**, it shares the empty name with empty text and the two are told apart only by position. Give them a name instead:
   ```sql
   COALESCE(NULLIF(placement, ''), 'unknown') AS placement
   ```
6. Split on a column with a few dozen values at most. Each value is a layer, and over 50 layers the panel warns: at 1,000, panning and hovering pause for about half a second.

Layer settings, such as a value's visibility, are kept by layer id, so they stay with the value across refreshes.

## Networks (preview)

GeoFlow can draw a network from two queries: **nodes**, points with an id, and **edges**, rows naming the two nodes they join. Every edge between the same two nodes, in either direction, is drawn as one straight line between their points. For example, sites and the trunks between them:

```sql
-- Nodes (query A): point geometry and an id column.
SELECT site_id AS id, name, ST_AsGeoJSON(geom, 6) AS geometry FROM sites ORDER BY site_id;

-- Edges (query B): no geometry, only the ids of the nodes each row joins.
SELECT trunk_id, a_site, z_site, capacity_gbps FROM trunks ORDER BY trunk_id;
```

Hovering a line shows a summary of every edge between its two nodes, and clicking it lists them. Styling lines by their summary values is planned ([docs/node-edge/architecture.md](docs/node-edge/architecture.md)).

To set it up, in the panel editor's **Layers** list:

1. Select the node query's layer, and set its **Role** to **Nodes**.
2. Select the edge query's layer, and set its **Role** to **Edges**. If it was above the nodes, it moves just below them, so nodes stay on top.
3. Check the edge layer's **From column** and **To column**: unset, they show the columns GeoFlow found. Pick others if those are wrong.

- **From and to columns** are found by name: `source` and `target`, `from` and `to`, `src` and `dst`, `start` and `end`, `a_end` and `z_end`, or pairs like `a_site` and `z_site`, `site_a` and `site_z`, or `from_site` and `to_site`. Choosing one finds the other from the same pair.
- **Node ids** come from the node layer's **ID column**: a column named `id`, unless another is chosen. They're matched as text, so an integer site id joins a text trunk end. Keep them unique.
- **Style** edges like any layer, per query: **Map style** in a **Fields returned by query** override on the edge query sets their color, width and line style. Lines draw in the Layers list's order, so keep the node layer above the edge layer.
- **One network per panel:** the first Nodes and the first Edges layer in the Layers list. Others say **Not used** in the list and warn on the map; an extra Nodes layer still draws as points.
- **Warnings** count edges that can't be drawn: an id with no node, an edge from a node to itself, an empty end, a duplicate node id, or a node that isn't a single point.
- **Not with Partition by values:** a node or edge query split into several frames warns instead of drawing.

### Edge summary

Hovering an edge line shows its two nodes and how many edges run between them, in either direction, as **Items**: viewers see lines between locations, so what they read avoids graph terms. Click a line to pin it and list its edges (below); a pinned line stays through refreshes. Choose what else the hover shows per column, in the field options' **Edges** category, usually in an override on the column's name:

- **Aggregates:** any of **Sum**, **Average**, **Min**, **Max** and **Count**, on one line: `capacity_gbps: sum 211 Gb/s · max 100 Gb/s`. A sum shows the line's total, and min and max its outliers, such as one saturated trunk among idle ones. Sum and Average apply to numbers, Min and Max to numbers and times, Count to any column. Values use the column's unit and decimals; empty values are skipped.
- **Ratio numerator** and **Ratio denominator:** make a column a ratio, such as utilization over capacity. Add the column in SQL, give it a unit such as **Percent (0.0-1.0)**, and point it at its numerator and denominator:

  ```sql
  SELECT trunk_id, a_site, z_site, capacity_gbps, utilization_gbps,
    utilization_gbps / capacity_gbps AS utilization
  FROM trunks ORDER BY trunk_id;
  ```

  A hovered line shows the sum of the numerator over the sum of the denominator: trunks of 100 and 10 Gb/s carrying 10 and 9 Gb/s are 17% used, not the 50% their own percentages average to. Edges missing either value are left out.

Columns with **Hide in tooltip** are left out, and a line's **Tooltips** setting in the Layers list turns its tooltip off. Lines are named by their nodes' ids, so text ids such as site names read best.

### The list of a line's edges

A clicked line lists every edge between its two nodes, one row each. A **Summary | Items** switch in the pinned tooltip's header swaps the list for the line's summary, what its hover shows, and back; it opens on the items, and keeps your choice while the tooltip is pinned.

- **Columns:** each row's own direction (`1 → 6` or `6 → 1`), then the edge query's columns, formatted as in tooltips. **Hide in tooltip** leaves a column out; the edge layer's **Show direction** setting in the Layers list leaves out the direction.
- **Search** filters the rows by what they show, ignoring case: "1 of 4 items". Escape clears it.
- **Sort** by clicking a column's header: ascending, descending, then back to the query's order. Numbers and times sort by value; text sorts with its numbers in order, so `TRK-2` comes before `TRK-10`.
- **Data links** on the edge query's columns show on each row, filled in with that row's values: a link icon when there's one link, a menu when there are several.
- **Size:** the list draws up to 500 rows of what matches, and says so when there are more. It's as wide as the map allows, up to 800 px, and shows whole rows, at least one.
- **Scrolling** moves one row per wheel notch, and dragging the scrollbar stops on a row.

## Tooltips

Hover a feature to highlight it and see its attributes. Click to pin the tooltip:

- **Several features under the pointer:** a pinned tooltip pages through them with **1 of 3**, topmost first. Hover shows the topmost and how many more there are.
- **Data links** configured on the panel's fields appear at the bottom of the pinned tooltip.
- **Closing:** press Escape, click the close button, click empty map, or change the basemap. Hiding a layer, or turning its tooltips off, closes its tooltips. A pinned tooltip stays put while you pan and zoom.
- **Size:** a tooltip fits in the room beside its feature. When there are more fields than fit, the list scrolls in a pinned tooltip; pin a hover tooltip to scroll it.

**Tooltip** in the panel options chooses **Hover** (hover shows a tooltip, click pins it), **Click** (only clicking shows one, for busy maps) or **Off**.

Values are formatted with the panel's field options, as in Grafana's other panels:

- **Standard options:** unit, decimals, display name and the text for empty values.
- **Value mappings,** for example `in_service` shown as "In service".
- **Data links,** with `${__data.fields.name}` and dashboard variables filled in from the feature's row. Field values in links are formatted values: a **Decimals** setting on an id column changes the link too.
- **Hide in tooltip** (under **Tooltip**, usually set in a field override) leaves a column out of the tooltip. Its data links still show.

Times show in the dashboard's time zone. Properties that come inside a GeoJSON Feature (`ST_AsGeoJSON(t.*)`) are listed as plain text, because they aren't Grafana fields; select them as columns to format them.

When new data arrives, a pinned tooltip shows the feature's new values if its query has a unique `id` column. Without one, the tooltip closes, because a row position may now be a different feature.

## Styling

Style the map in the panel's field options, as in Grafana's other panels:

- **Standard options → Color scheme:**
  - **Classic palette** (default): each query in the next palette color, in query order
  - **Single color:** one color, alpha included
  - **Shades of a color**
  - **Classic palette (by series name):** a color from the layer's name: its name in the Layers list, else the frame name or the query's letter
  - The by-value schemes (From thresholds, gradients) are for columns that color features, under [Coloring by value](#coloring-by-value). On a layer's own color they act as Classic palette.
- **Map style:**
  - **Opacity:** the whole layer: lines, points, outlines and fills
  - **Fill opacity:** polygon interiors
  - **Line width:** lines; polygon outlines stay 1 px
  - **Line style:** Solid, Dashed, Dotted, or Custom with a **Dash pattern** of dash and gap lengths in pixels, such as `12, 4, 2, 4`. An odd number of lengths repeats, as in SVG. Polygon outlines stay solid.
  - **Point size:** point diameter

**Styling one query:** add a field override with **Fields returned by query**, pick the query, and add the properties to change. An override by field name, such as `geometry`, styles every query whose geometry column has that name. GeoFlow reads each query's style from its geometry column, so the style options do nothing on other columns.

Hovered and selected features stand out from whatever style is set. Changing a style only repaints the map: the data isn't converted or loaded again.

## Coloring by value

Color or size each feature by a column of its query: a patch panel red when it's over 80% full, a cable colored by placement, a splice case sized by how many splices it holds. Under **Map style**:

- **Color by** picks the column. Each feature is drawn in the color Grafana gives that column's value, the same color a table cell or stat would show. Set the colors on the column itself, usually with an override on its name:
  - **Thresholds,** with **Color scheme** set to **From thresholds**
  - a by-value **Color scheme,** such as Green-Yellow-Red, across the column's **Min** and **Max**
  - **Value mappings** with a color, which win over both. Text columns are colored this way.
- **Size by** picks a number column. Point diameters scale with its value, from **Min point size** at the column's Min to **Max point size** at its Max. Values outside the range get the nearest size.

Like the rest of Map style, both go on the geometry column, so the usual setup is a **Fields returned by query** override with **Color by** or **Size by**. A feature with no value keeps the layer's own color and size; a **Null** value mapping with a color still colors it.

**Range:** without Min and Max, a column's range is its own data's, from its smallest value to its largest. Grafana's other panels default to a range across every number column, which would let an `id` column squash the colors. Because the range comes from the data, a gradient's colors can shift when a refresh brings new extremes; set Min and Max to keep them fixed.

**Legend:** layers colored by a column get a legend in the bottom left corner: value mappings and threshold steps as a list, a gradient as a bar from Min to Max. **Legend** in the panel options turns it off. It's hidden on panels narrower than 200 px, and scrolls when it's taller than half the panel.

A tooltip's color marker shows the feature's own color. Changing a threshold, mapping or size range only repaints the map, as with other style options.

## Basemap

Pick the basemap in the panel options under **Basemap**:

| Option                  | What it shows                                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenStreetMap (default) | OpenStreetMap's standard raster tiles, with the "© OpenStreetMap contributors" attribution.                                                     |
| OpenFreeMap             | Vector styles with no key: Liberty, Bright, Positron, and Dark or Fiord for dark theme.                                                         |
| Stadia Maps             | Vector styles, such as Alidade Smooth and Stamen Toner. A key is optional (below).                                                              |
| MapTiler                | Vector styles, such as Streets, Dataviz and Topo, each with a dark variant. Needs your API key; shows MapTiler's logo.                          |
| Thunderforest           | Raster tiles, such as Atlas, Transport and OpenCycleMap. Needs your API key.                                                                    |
| Custom tiles            | Any XYZ raster tile server. Enter a URL template with `{z}`, `{x}` and `{y}`, and the attribution your provider requires (shown as plain text). |
| Style URL               | A [MapLibre style](https://maplibre.org/maplibre-style-spec/) JSON, for vector-tile basemaps. The style controls the whole look.                |
| None                    | A plain background. Use it for air-gapped installs.                                                                                             |

**Presets** (OpenFreeMap, Stadia Maps, MapTiler, Thunderforest) offer their styles by name under **Style**, and fill in the provider's attribution. **Dark theme style** is used while Grafana's theme is dark: by default, the style's dark counterpart, such as Positron's Dark. Pick another, or **Same as light**.

**API keys:** create a free account with the provider and paste its key under **API key**. GeoFlow adds it to every request to the provider: style, tiles, fonts and sprites. A key for map tiles always reaches the viewer's browser, and it's saved in the dashboard, so anyone who can view the dashboard can see it. Restrict it to your Grafana's domain in your provider account. Stadia Maps needs no key on `localhost` or on domains you register with it.

**Plans and terms are between you and the provider.** The free plans of Stadia Maps and MapTiler are for non-commercial use, and MapTiler's free plan requires its logo, which GeoFlow shows. OpenFreeMap needs no account and has no limits, but offers no guarantees. Check each provider's terms: [OpenFreeMap](https://openfreemap.org/tos/), [Stadia Maps](https://stadiamaps.com/terms-of-service/), [MapTiler](https://www.maptiler.com/cloud/terms/), [Thunderforest](https://www.thunderforest.com/terms/).

**Dark theme:** raster basemaps are dimmed to match a dark dashboard. For tiles or a style made for dark theme, enter a **Dark theme tile URL** or **Dark theme style URL**: GeoFlow uses it, undimmed, while Grafana's theme is dark, and switches back in light theme. A pinned tooltip closes when the basemap switches.

**OpenStreetMap's tile servers are for light use.** Their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids heavy use. For production dashboards with many viewers, use a preset, your own tile server, or a commercial provider through **Custom tiles** or **Style URL**.

**Requirements:**

- The browser needs WebGL2. Without it, the panel shows a message instead of the map.
- Grafana's image renderer may lack WebGL2, so map panels may not render in PNG exports and reports.
- Browsers cap live WebGL contexts per page (16 in Chromium). GeoFlow keeps a map only while its panel is on or near the screen, so long dashboards are fine. If the browser still takes a map's context away, the panel shows **Reload map**.

### Content Security Policy

If Grafana's [Content Security Policy](https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-security-hardening/#add-a-content-security-policy) is enabled (`content_security_policy = true`), add every tile server the basemap uses to `connect-src`, including those of a dark theme URL. MapLibre fetches tiles with `fetch()`, and Grafana's default template allows only `'self' grafana.com *.cartocdn.com`.

For the OpenStreetMap basemap, the `connect-src` part of `content_security_policy_template` becomes:

```
connect-src 'self' grafana.com *.cartocdn.com https://tile.openstreetmap.org ws://$ROOT_PATH wss://$ROOT_PATH;
```

For a preset, add its host. Each serves its styles, tiles, fonts and sprites from one host:

| Preset        | Host                             |
| ------------- | -------------------------------- |
| OpenFreeMap   | `https://tiles.openfreemap.org`  |
| Stadia Maps   | `https://tiles.stadiamaps.com`   |
| MapTiler      | `https://api.maptiler.com`       |
| Thunderforest | `https://tile.thunderforest.com` |

MapTiler's logo is an image, which Grafana's default template already allows (`img-src *`).

For a **Style URL**, also add the hosts of the style JSON and of the tiles, glyphs and sprites it references, including those of a dark theme style. Nothing else needs to change: the map's web worker is a same-origin file in the plugin, so `worker-src` and `blob:` aren't needed. When a tile server is blocked, the panel shows a "Basemap: … Failed to fetch" notice.

## View

Under **View** in the panel options, **View mode** sets where the map looks:

- **Fit to data** (the default for new panels) frames the visible layers when the panel loads. **Padding** leaves room around them, and **Max zoom** keeps a single feature from filling the map. Until there's data, it shows the fixed view below, the whole world by default.
- **Fixed** opens at a **Latitude**, **Longitude** and **Zoom**. Panels made before Phase 8 keep their fixed view.

Either way, once you pan or zoom, the map stays there through refreshes, option changes and scrolling. **Fit on refresh** fits the data again on every refresh instead, undoing any panning: use it on wall displays.

To set a fixed view, move the map in the panel editor, then click **Use current view**. It shows the map's view as it moves, saves it, and switches the mode to Fixed.

## Warnings

When something's wrong, a small warning shows on the map. Hover it, or focus it with the keyboard, to see the problems, layer by layer:

- rows skipped as invalid, unsupported, in another coordinate system or out of range, with the reason for the first one
- a Geometry, ID, Color by or Size by column the query doesn't return
- more than 100,000 features in the panel
- more than 50 layers in the panel, usually from [splitting a query](#splitting-a-query-by-value) on a column with many values

Rows with empty geometry don't count, since they're usually intended, such as an asset without a location. Viewers see the warning too. To turn it off for a panel, turn off **Show warnings**.

**Show data summary** lists every query result in full. It also says when a query's rows come back in another order, and when the browser draws the map without a GPU, which is the most common reason for a slow map.

**When a query fails,** Grafana shows its error icon on the panel, and the map keeps drawing that query's last data until a refresh succeeds. Grafana's own panels go blank instead.

## Sizing

GeoFlow draws every row a query returns, in the browser. Measured with an integrated GPU, on one query:

| Features        | Points or lines                                                      | Polygons                                        |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| 1,000 to 10,000 | Drawn in under a second                                              | Drawn in under a second                         |
| 100,000         | Drawn in 2 to 3 s, with a pause of about 0.3 s when new data arrives | Drawn in about 5 s, with a pause of about 0.6 s |

At these sizes, panning, hovering and refreshes that bring the same data don't noticeably pause the map. Simple polygons were measured; detailed ones take longer.

- **Up to 100,000 features per panel** works well with a GPU. Without one, panning large maps gets slow: **Show data summary** says when that's the case.
- **Beyond 100,000**, the panel still draws them, with a warning. Filter in the query, and simplify detailed polygons with `ST_SimplifyPreserveTopology`.
- **Refreshing often?** Add an `ORDER BY`, so a refresh with the same data costs almost nothing.
- **Grafana's row limit** (`row_limit` in its configuration) caps what a SQL query returns.

To measure your own machine, run `npm run bench:map`. [docs/phase_9.md](docs/phase_9.md#outcome) has the full results.

## Development

### Prerequisites

- Node.js 22.18 or later (`.nvmrc` pins the recommended version, which CI uses) and npm 10 or later
- Docker Engine with Docker Compose v2.24 or later

### Quick start

```bash
npm install
npm run dev        # build the plugin and rebuild on change (terminal 1)
npm run server     # start Grafana and PostGIS in Docker (terminal 2)
```

Open http://localhost:3000. The **GeoFlow** folder holds the dev dashboards:

| Dashboard          | Shows                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00 Smoke           | Data from the fixture database, through the provisioned **GeoFlow PostGIS** data source, with the data summary turned on.                                                                   |
| 01 Adapter         | How each kind of query result converts to GeoJSON.                                                                                                                                          |
| 02 Basemap         | The OpenStreetMap and None basemaps. Add `?theme=dark` to the URL to check dark theme.                                                                                                      |
| 03 Many panels     | 20 maps on one dashboard, for checking the WebGL context limit.                                                                                                                             |
| 04 Geometry        | Each geometry type drawn on its own, mixed types, two queries as two layers, rows that are hard to draw, and a query without a geometry column.                                             |
| 05 Tooltips        | Hover and click tooltips with field options and a data link, overlapping features, a tooltip followed through a refresh, and the Click and Off modes.                                       |
| 06 Style           | Each query styled with an override, every line style, and a panel whose default style the e2e tests change in the editor.                                                                   |
| 07 Data-driven     | Cables colored by a value mapping, patch panels by utilization thresholds and by a gradient, splice cases sized by splices used, with legends.                                              |
| 08 Layers          | Named layers in a saved order with building tooltips off, the same queries without settings for the editor tests, and cables split by Partition by values.                                  |
| 09 Refresh         | Fit to data with and without Fit on refresh, a hover tooltip kept through a refresh, and custom tiles with a dark theme URL on the e2e tests' stub host.                                    |
| 10 Hardening       | A panel with problems for the warning, rows with empty geometry, and panels for the failed query and no-WebGL2 tests.                                                                       |
| 11 Performance     | Points, lines, polygons and colored points at up to 100k rows, and up to 1,000 layers, picked with a variable. `npm run bench:map` measures these.                                          |
| 12 Partition       | Cables split by placement with Partition by values: one value styled with an override, null and empty values in both namings, and a panel with 60 layers.                                   |
| 13 Basemap presets | A panel per preset provider, and MapTiler without a key. Its keys are made up: enter your own in the panel editor to see the real services.                                                 |
| 14 Node-edge       | Sites and trunks as a network, the same with problem rows and a second Edges layer, edge columns set in the layer settings, a panel to set up in the editor, and hover totals with a ratio. |

### Docker environment

The stack is defined in [docker-compose.yaml](docker-compose.yaml), with each service's files in its own directory:

| Directory                            | Contents                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docker/grafana/](docker/grafana/)   | Provisioned data sources and dashboards, and `.env.example` with the data source connection settings. The Grafana image itself comes from the scaffold-managed `.config/`. |
| [docker/postgres/](docker/postgres/) | PostGIS image (`postgis/postgis:16-3.6`), init scripts that seed the fixtures, `verify.sql`, and `.env.example` with database credentials.                                 |

Defaults come from each directory's `.env.example`. To override them, copy it to `.env` in the same directory (git-ignored). The Grafana password `GEOFLOW_PG_PASSWORD` must match the Postgres `GEOFLOW_READER_PASSWORD`. All defaults are for local development only.

PostgreSQL is published on `127.0.0.1:5432` (override with `GEOFLOW_PG_PORT`).

**Fixture data** is a small, fictional fiber optic network in downtown Cary, NC (buildings, fiber cables, splice cases and patch panels), a fictional backbone of sites and trunks around Raleigh for networks, plus edge-case rows and 100k synthetic service locations for performance testing. Building footprints and cable routes are hand-drawn approximations and don't depict real infrastructure. Grafana connects as the read-only `grafana_reader` role.

New or renamed dashboard files under `docker/grafana/provisioning/dashboards/` are loaded when Grafana starts, so run `docker compose restart grafana` after adding one.

The init scripts run only when the data volume is empty, so after pulling new seed data (such as the network fixtures), reset the database to the seed state:

```bash
docker compose down -v && npm run server
```

To check the fixtures:

```bash
docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /verify.sql'
```

### Checks and tests

```bash
npm run typecheck
npm run lint
npm run test:ci          # unit tests (Jest)
npm run test:build       # tests of the build's license check (Node's test runner)
npm run build            # fails if a bundled package's license is outside the policy
npm run check:dist       # dist/ holds only expected files, including THIRD_PARTY_NOTICES.txt
npm run e2e              # Playwright end-to-end tests; needs `npm run server` running
npm run bench:adapter    # 100k-row conversion timing (not part of CI)
npm run bench:map        # the panel in a real browser with the GPU; needs a build and `npm run server` (not part of CI)
```

Before the first e2e run, install the browser with `npx playwright install chromium`.

E2E tests import `test` from [tests/fixtures/](tests/fixtures/), which answers every map tile request with a local PNG, and every request to the presets' providers with a small local style. Tests never contact `tile.openstreetmap.org` or the providers, and need no keys.

Features are drawn on a WebGL canvas, so e2e tests check them in two ways:

- **Drawn-feature counts.** `renderedFeatures(panel)` in `tests/fixtures/` asks the panel's map which features it drew. This goes through a small test hook in the plugin ([src/panel/testHook.ts](src/panel/testHook.ts)), which does nothing unless a test triggers it. All test-only code in `src/` is marked with a `// Test hook:` comment: `grep -rn "Test hook:" src/` lists it.
- **Screenshot comparisons** of the 04 Geometry dashboard's mixed panel and of the 06 Style, 07 Data-driven, 08 Layers, 09 Refresh, 12 Partition and 14 Node-edge dashboards, stored next to their specs (`tests/*.spec.ts-snapshots/`). After an intended change to how features look, regenerate them with `npx playwright test --update-snapshots` and review the image diff.

To hover or click a known feature, `mapPoint(panel, [lon, lat], view)` in `tests/fixtures/` works out where a coordinate is on screen from the panel's view in the dashboard JSON. It's plain Web Mercator math, so it needs no test hook.

Headless Chromium draws WebGL in software (SwiftShader), where redrawing a large layer is slow. For a realistic feel of performance on large data, launch it with the GPU: `--enable-gpu --ignore-gpu-blocklist --use-angle=gl`.

Adapter unit tests use real data frames captured from the dev stack in `src/adapter/__fixtures__/`. After changing the fixture data in `docker/postgres/` or the minimum Grafana version, recapture them with `npm run server` running:

```bash
node scripts/capture-frames.mjs
```

## Documentation

- [Project overview](docs/project_overview.md)
- [Architecture](docs/architecture.md)
- Phase plans: [0](docs/phase_0.md), [1](docs/phase_1.md), [2](docs/phase_2.md), [3](docs/phase_3.md), [4](docs/phase_4.md), [5](docs/phase_5.md), [6](docs/phase_6.md), [7](docs/phase_7.md), [8](docs/phase_8.md), [9](docs/phase_9.md), [10](docs/phase_10.md), [11](docs/phase_11.md), [12](docs/phase_12.md)
- Node-edge maps: [architecture](docs/node-edge/architecture.md), phase plans [1](docs/node-edge/phase_1.md), [2](docs/node-edge/phase_2.md), [3](docs/node-edge/phase_3.md), [4](docs/node-edge/phase_4.md)

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The plugin bundles MapLibre GL JS and the packages it uses, under MIT, ISC and BSD licenses. The packaged plugin includes their license texts in `THIRD_PARTY_NOTICES.txt`, and the build fails if a bundled package's license falls outside the project's policy. The review behind this is in [docs/licenses.md](docs/licenses.md).
