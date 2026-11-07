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

**A query that returns several frames** gets a layer for each, named after the frame. Grafana's **Partition by values** transformation splits one query this way, for example cables by placement: each value is then its own layer, named `placement=aerial` with the default **As label** naming, or `aerial` with **As frame name**. With **As frame name**, each value's frames can also be styled with a **Fields returned by query** override on its own query name, such as `A-aerial`.

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
| Custom tiles            | Any XYZ raster tile server. Enter a URL template with `{z}`, `{x}` and `{y}`, and the attribution your provider requires (shown as plain text). |
| Style URL               | A [MapLibre style](https://maplibre.org/maplibre-style-spec/) JSON, for vector-tile basemaps. The style controls the whole look.                |
| None                    | A plain background. Use it for air-gapped installs.                                                                                             |

**Dark theme:** raster basemaps are dimmed to match a dark dashboard. For tiles or a style made for dark theme, enter a **Dark theme tile URL** or **Dark theme style URL**: GeoFlow uses it, undimmed, while Grafana's theme is dark, and switches back in light theme. A pinned tooltip closes when the basemap switches.

**OpenStreetMap's tile servers are for light use.** Their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids heavy use. For production dashboards with many viewers, use your own tile server or a commercial provider through **Custom tiles** or **Style URL**.

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

- Node.js 22 or later (`.nvmrc` pins the recommended version) and npm 10 or later
- Docker Engine with Docker Compose v2.24 or later

### Quick start

```bash
npm install
npm run dev        # build the plugin and rebuild on change (terminal 1)
npm run server     # start Grafana and PostGIS in Docker (terminal 2)
```

Open http://localhost:3000. The **GeoFlow** folder holds the dev dashboards:

| Dashboard      | Shows                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00 Smoke       | Data from the fixture database, through the provisioned **GeoFlow PostGIS** data source, with the data summary turned on.                                  |
| 01 Adapter     | How each kind of query result converts to GeoJSON.                                                                                                         |
| 02 Basemap     | The OpenStreetMap and None basemaps. Add `?theme=dark` to the URL to check dark theme.                                                                     |
| 03 Many panels | 20 maps on one dashboard, for checking the WebGL context limit.                                                                                            |
| 04 Geometry    | Each geometry type drawn on its own, mixed types, two queries as two layers, rows that are hard to draw, and a query without a geometry column.            |
| 05 Tooltips    | Hover and click tooltips with field options and a data link, overlapping features, a tooltip followed through a refresh, and the Click and Off modes.      |
| 06 Style       | Each query styled with an override, every line style, and a panel whose default style the e2e tests change in the editor.                                  |
| 07 Data-driven | Cables colored by a value mapping, patch panels by utilization thresholds and by a gradient, splice cases sized by splices used, with legends.             |
| 08 Layers      | Named layers in a saved order with building tooltips off, the same queries without settings for the editor tests, and cables split by Partition by values. |
| 09 Refresh     | Fit to data with and without Fit on refresh, a hover tooltip kept through a refresh, and custom tiles with a dark theme URL on the e2e tests' stub host.   |
| 10 Hardening   | A panel with problems for the warning, rows with empty geometry, and panels for the failed query and no-WebGL2 tests.                                      |
| 11 Performance | Points, lines, polygons and colored points at up to 100k rows, picked with a variable. `npm run bench:map` measures these.                                 |

### Docker environment

The stack is defined in [docker-compose.yaml](docker-compose.yaml), with each service's files in its own directory:

| Directory                            | Contents                                                                                                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docker/grafana/](docker/grafana/)   | Provisioned data sources and dashboards, and `.env.example` with the data source connection settings. The Grafana image itself comes from the scaffold-managed `.config/`. |
| [docker/postgres/](docker/postgres/) | PostGIS image (`postgis/postgis:16-3.6`), init scripts that seed the fixtures, `verify.sql`, and `.env.example` with database credentials.                                 |

Defaults come from each directory's `.env.example`. To override them, copy it to `.env` in the same directory (git-ignored). The Grafana password `GEOFLOW_PG_PASSWORD` must match the Postgres `GEOFLOW_READER_PASSWORD`. All defaults are for local development only.

PostgreSQL is published on `127.0.0.1:5432` (override with `GEOFLOW_PG_PORT`).

**Fixture data** is a small, fictional fiber optic network in downtown Cary, NC (buildings, fiber cables, splice cases and patch panels), plus edge-case rows and 100k synthetic service locations for performance testing. Building footprints and cable routes are hand-drawn approximations and don't depict real infrastructure. Grafana connects as the read-only `grafana_reader` role.

New or renamed dashboard files under `docker/grafana/provisioning/dashboards/` are loaded when Grafana starts, so run `docker compose restart grafana` after adding one.

The init scripts run only when the data volume is empty. To reset the database to the seed state:

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

E2E tests import `test` from [tests/fixtures/](tests/fixtures/), which answers every map tile request with a local PNG. Tests never contact `tile.openstreetmap.org`.

Features are drawn on a WebGL canvas, so e2e tests check them in two ways:

- **Drawn-feature counts.** `renderedFeatures(panel)` in `tests/fixtures/` asks the panel's map which features it drew. This goes through a small test hook in the plugin ([src/panel/testHook.ts](src/panel/testHook.ts)), which does nothing unless a test triggers it. All test-only code in `src/` is marked with a `// Test hook:` comment: `grep -rn "Test hook:" src/` lists it.
- **Screenshot comparisons** of the 04 Geometry dashboard's mixed panel and of the 06 Style, 07 Data-driven, 08 Layers and 09 Refresh dashboards, stored next to their specs (`tests/*.spec.ts-snapshots/`). After an intended change to how features look, regenerate them with `npx playwright test --update-snapshots` and review the image diff.

To hover or click a known feature, `mapPoint(panel, [lon, lat], view)` in `tests/fixtures/` works out where a coordinate is on screen from the panel's view in the dashboard JSON. It's plain Web Mercator math, so it needs no test hook.

Headless Chromium draws WebGL in software (SwiftShader), where redrawing a large layer is slow. For a realistic feel of performance on large data, launch it with the GPU: `--enable-gpu --ignore-gpu-blocklist --use-angle=gl`.

Adapter unit tests use real data frames captured from the dev stack in `src/adapter/__fixtures__/`. After changing the fixture data in `docker/postgres/` or the minimum Grafana version, recapture them with `npm run server` running:

```bash
node scripts/capture-frames.mjs
```

## Documentation

- [Project overview](docs/project_overview.md)
- [Architecture](docs/architecture.md)
- Phase plans: [0](docs/phase_0.md), [1](docs/phase_1.md), [2](docs/phase_2.md), [3](docs/phase_3.md), [4](docs/phase_4.md), [5](docs/phase_5.md), [6](docs/phase_6.md), [7](docs/phase_7.md), [8](docs/phase_8.md), [9](docs/phase_9.md)

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
