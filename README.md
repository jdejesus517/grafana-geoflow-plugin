# GeoFlow

GeoFlow is an open-source Grafana panel plugin that renders geographic features stored in PostgreSQL/PostGIS. It reads data through Grafana's built-in PostgreSQL data source and draws it with [MapLibre GL JS](https://maplibre.org/).

> **Status: pre-MVP.** Phase 4 is complete: the panel draws query results on an interactive basemap, with tooltips that show each feature's attributes. Style options arrive in Phase 5. See [docs/architecture.md](docs/architecture.md) for the target design and phase plan.

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
```

- **Geometry types:** Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon. Points are drawn as circles, lines as lines, and polygons filled with an outline.
- **Geometry column:** GeoFlow finds it by name (`geometry`, `geom`, `geojson`, `the_geom`, `wkb_geometry` or `shape`) or by content. It accepts GeoJSON text, `json`/`jsonb` values, and whole GeoJSON Features such as `ST_AsGeoJSON(t.*)`, whose properties are kept.
- **`ST_Transform(geom, 4326)`:** needed unless the data is already in WGS84. Rows in another coordinate system are skipped.
- **Precision `6`:** about 0.1 m, which roughly halves the size of the result compared with the default.
- **Other columns:** become the feature's properties, shown in its tooltip.
- **An `id` column** (any column named `id`) identifies features. Keep it unique: a pinned tooltip then follows its feature when the dashboard refreshes. Text ids work too.

**Each query is a layer.** Queries A, B, C… are drawn in that order, later ones on top, each in its own color from the Grafana theme. Queries without a geometry column are left out.

**Rows that can't be drawn are skipped:** empty or invalid geometry, GeometryCollections, other coordinate systems, and coordinates outside ±180/±90. Turn on **Show data summary** in the panel options to see how many rows each query lost, and why. If no query has a geometry column, the panel says what to select instead. For example, a raw PostGIS `geom` column needs `ST_AsGeoJSON(geom)`.

## Tooltips

Hover a feature to highlight it and see its attributes. Click to pin the tooltip:

- **Several features under the pointer:** a pinned tooltip pages through them with **1 of 3**, topmost first. Hover shows the topmost and how many more there are.
- **Data links** configured on the panel's fields appear at the bottom of the pinned tooltip.
- **Closing:** press Escape, click the close button, click empty map, or change the basemap. A pinned tooltip stays put while you pan and zoom.
- **Size:** a tooltip fits in the room beside its feature. When there are more fields than fit, the list scrolls in a pinned tooltip; pin a hover tooltip to scroll it.

**Tooltip** in the panel options chooses **Hover** (hover shows a tooltip, click pins it), **Click** (only clicking shows one, for busy maps) or **Off**.

Values are formatted with the panel's field options, as in Grafana's other panels:

- **Standard options:** unit, decimals, display name and the text for empty values.
- **Value mappings,** for example `in_service` shown as "In service".
- **Data links,** with `${__data.fields.name}` and dashboard variables filled in from the feature's row. Field values in links are formatted values: a **Decimals** setting on an id column changes the link too.
- **Hide in tooltip** (under **Tooltip**, usually set in a field override) leaves a column out of the tooltip. Its data links still show.

Times show in the dashboard's time zone. Properties that come inside a GeoJSON Feature (`ST_AsGeoJSON(t.*)`) are listed as plain text, because they aren't Grafana fields; select them as columns to format them.

When new data arrives, a pinned tooltip shows the feature's new values if its query has a unique `id` column. Without one, the tooltip closes, because a row position may now be a different feature.

## Basemap

Pick the basemap in the panel options under **Basemap**:

| Option                  | What it shows                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenStreetMap (default) | OpenStreetMap's standard raster tiles, with the "© OpenStreetMap contributors" attribution.                                                               |
| Custom tiles            | Any XYZ raster tile server. Enter a URL template with `{z}`, `{x}` and `{y}`, and the attribution your provider requires (shown as plain text).           |
| Style URL               | A [MapLibre style](https://maplibre.org/maplibre-style-spec/) JSON, for vector-tile basemaps. The style controls the whole look, including in dark theme. |
| None                    | A plain background. Use it for air-gapped installs.                                                                                                       |

**Initial view** sets the latitude, longitude and zoom the map opens at. In dark theme, raster basemaps are dimmed to match the dashboard.

**OpenStreetMap's tile servers are for light use.** Their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) forbids heavy use. For production dashboards with many viewers, use your own tile server or a commercial provider through **Custom tiles** or **Style URL**.

**Requirements:**

- The browser needs WebGL2. Without it, the panel shows a message instead of the map.
- Grafana's image renderer may lack WebGL2, so map panels may not render in PNG exports and reports.
- Browsers cap live WebGL contexts per page (16 in Chromium). GeoFlow keeps a map only while its panel is on or near the screen, so long dashboards are fine. If the browser still takes a map's context away, the panel shows **Reload map**.

### Content Security Policy

If Grafana's [Content Security Policy](https://grafana.com/docs/grafana/latest/setup-grafana/configure-security/configure-security-hardening/#add-a-content-security-policy) is enabled (`content_security_policy = true`), add every tile server the basemap uses to `connect-src`. MapLibre fetches tiles with `fetch()`, and Grafana's default template allows only `'self' grafana.com *.cartocdn.com`.

For the OpenStreetMap basemap, the `connect-src` part of `content_security_policy_template` becomes:

```
connect-src 'self' grafana.com *.cartocdn.com https://tile.openstreetmap.org ws://$ROOT_PATH wss://$ROOT_PATH;
```

For a **Style URL**, also add the hosts of the style JSON and of the tiles, glyphs and sprites it references. Nothing else needs to change: the map's web worker is a same-origin file in the plugin, so `worker-src` and `blob:` aren't needed. When a tile server is blocked, the panel shows a "Basemap: … Failed to fetch" notice.

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

| Dashboard      | Shows                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00 Smoke       | Data from the fixture database, through the provisioned **GeoFlow PostGIS** data source, with the data summary turned on.                             |
| 01 Adapter     | How each kind of query result converts to GeoJSON.                                                                                                    |
| 02 Basemap     | The OpenStreetMap and None basemaps. Add `?theme=dark` to the URL to check dark theme.                                                                |
| 03 Many panels | 20 maps on one dashboard, for checking the WebGL context limit.                                                                                       |
| 04 Geometry    | Each geometry type drawn on its own, mixed types, two queries as two layers, rows that are hard to draw, and a query without a geometry column.       |
| 05 Tooltips    | Hover and click tooltips with field options and a data link, overlapping features, a tooltip followed through a refresh, and the Click and Off modes. |

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
npm run build
npm run check:dist       # dist/ holds only expected files, including THIRD_PARTY_NOTICES.txt
npm run license:check    # production dependency license gate
npm run e2e              # Playwright end-to-end tests; needs `npm run server` running
npm run bench:adapter    # 100k-row conversion timing (not part of CI)
```

Before the first e2e run, install the browser with `npx playwright install chromium`.

E2E tests import `test` from [tests/fixtures/](tests/fixtures/), which answers every map tile request with a local PNG. Tests never contact `tile.openstreetmap.org`.

Features are drawn on a WebGL canvas, so e2e tests check them in two ways:

- **Drawn-feature counts.** `renderedFeatures(panel)` in `tests/fixtures/` asks the panel's map which features it drew. This goes through a small test hook in the plugin ([src/panel/testHook.ts](src/panel/testHook.ts)), which does nothing unless a test triggers it. All test-only code in `src/` is marked with a `// Test hook:` comment: `grep -rn "Test hook:" src/` lists it.
- **One screenshot comparison** of the 04 Geometry dashboard's mixed panel, stored in `tests/geometry.spec.ts-snapshots/`. After an intended change to how features look, regenerate it with `npx playwright test tests/geometry.spec.ts --update-snapshots` and review the image diff.

To hover or click a known feature, `mapPoint(panel, [lon, lat], view)` in `tests/fixtures/` works out where a coordinate is on screen from the panel's view in the dashboard JSON. It's plain Web Mercator math, so it needs no test hook.

Headless Chromium draws WebGL in software (SwiftShader), where redrawing a large layer is slow. For a realistic feel of performance on large data, launch it with the GPU: `--enable-gpu --ignore-gpu-blocklist --use-angle=gl`.

Adapter unit tests use real data frames captured from the dev stack in `src/adapter/__fixtures__/`. After changing the fixture data in `docker/postgres/` or the minimum Grafana version, recapture them with `npm run server` running:

```bash
node scripts/capture-frames.mjs
```

## Documentation

- [Project overview](docs/project_overview.md)
- [Architecture](docs/architecture.md)
- Phase plans: [0](docs/phase_0.md), [1](docs/phase_1.md), [2](docs/phase_2.md), [3](docs/phase_3.md), [4](docs/phase_4.md)

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
