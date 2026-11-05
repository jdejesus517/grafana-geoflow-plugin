# Phase 0: Scaffold and Development Environment

Status: **Complete** (2026-11-01), pending Checkpoint B review. See [Outcome](#outcome) for where the result differs from this plan.
Architecture reference: [architecture.md](architecture.md) §2.1, §5.1, §5.4, §5.3 (Phase 0 row).

## Goal

Get a working, empty GeoFlow plugin running in Grafana 13 against a seeded PostGIS database, entirely in Docker, with CI enforcing lint, tests, build, plugin validation and license checks. No map rendering yet.

The placeholder panel proves the full data path end to end: PostGIS → Grafana PostgreSQL data source → `DataFrame[]` → panel. Phase 1 can then start on the adapter with real query results already available.

## Exit criteria

Phase 0 is done when all of these hold:

1. `npm run server` (or `docker compose up --build`) starts Grafana 13.x and PostgreSQL 16 + PostGIS. Grafana waits for the database to be healthy.
2. The PostGIS database contains the seed fixtures described in step 0.5.
3. Grafana has the PostgreSQL data source provisioned. **Save & test** passes.
4. The provisioned "GeoFlow / 00 Smoke" dashboard shows the placeholder panel reporting the number of frames and rows it received, and the counts are greater than zero.
5. `npm run lint`, `npm run typecheck`, `npm run test:ci`, `npm run build`, `npm run license:check` and `npm run e2e` all pass locally.
6. CI runs the same checks plus `@grafana/plugin-validator`, and passes on the Phase 0 branch.
7. `LICENSE` (Apache-2.0), `NOTICE` and a README quick-start exist.

## Out of scope

- MapLibre, GeoJSON conversion, panel options beyond a placeholder. Those are Phases 1–5.
- Plugin signing and publishing.
- Production deployment. The Docker setup is for development and e2e only.

---

## Steps

Work happens on a `phase-0` branch, with one commit per step. I'll stop for your review at the two **checkpoints** marked below.

### 0.1 Prerequisites and branch

- Check the local toolchain:
  - Node.js at the LTS version the current `@grafana/create-plugin` requires (recorded in `.nvmrc` by the scaffold).
  - npm
  - Docker Engine with Compose v2
  - git
- Create the `phase-0` branch from `main`.
- **Repository remote.** The project repository is `https://github.com/jdejesus517/grafana-geoflow-plugin`. The local `origin` currently points at `jdejesus517/grafana-map-plugin`.
  - Once the GitHub repository is renamed or created, update the remote: `git remote set-url origin git@github.com:jdejesus517/grafana-geoflow-plugin.git`.
  - Confirm with you before the first push.

**Done when:** tool versions are confirmed, the branch exists, and `origin` points at `grafana-geoflow-plugin`.

### 0.2 Scaffold the plugin

`create-plugin` generates into a new subdirectory, and this repo already has `README.md`, `.gitignore` and `docs/`. So:

1. Run `npx @grafana/create-plugin@latest` in the scratch directory with these answers:

   | Prompt | Answer |
   |---|---|
   | Plugin type | panel |
   | Backend | no |
   | Plugin name | `geoflow` (display name GeoFlow) |
   | Organization | `jdejesusio` |
   | GitHub CI / workflows | yes |

2. Move the generated files into the repo root.
   - Merge the scaffold's `.gitignore` with the existing one, keeping both sets of entries.
   - Replace the stub `README.md` (rewritten in step 0.10).
   - Leave `docs/` untouched.
3. Run `npm install`, then `npm run build` and `npm run test:ci` to confirm the untouched scaffold works before any changes.

`.config/` is owned by create-plugin and gets overwritten on `create-plugin update`, so nothing under it is hand-edited. All customization lives in root-level files that extend it.

**Done when:** the unmodified scaffold builds and its sample tests pass.

> **Checkpoint A:** review the scaffold diff before it gets customized.

### 0.3 Plugin metadata and Grafana 13 targeting

- `src/plugin.json`:
  - `id: jdejesusio-geoflow-panel`, `name: GeoFlow`, `type: panel`
  - `dependencies.grafanaDependency: ">=13.0.0"`
  - `info`:
    - description
    - `author: { name: "Jose DeJesus" }`
    - keywords (`map`, `postgis`, `geojson`, `maplibre`)
    - links: "Source" and "Issues" pointing at `https://github.com/jdejesus517/grafana-geoflow-plugin`
    - version from `package.json`
- `package.json`: `author: "Jose DeJesus"` and `repository` / `bugs` / `homepage` set to the GitHub URL.
- `package.json`:
  - `"license": "Apache-2.0"`
  - Set `@grafana/data`, `@grafana/ui`, `@grafana/runtime`, `@grafana/schema` and `@grafana/plugin-e2e` to versions that match Grafana 13.x, and confirm the matching tags at implementation time.
- Remove the scaffold's sample panel code and options.

**Done when:** typecheck and build pass, and `dist/plugin.json` shows the new id and dependency.

### 0.4 Source skeleton and engine boundary rule

Create the three-layer layout from architecture §2.1, with only what Phase 0 needs:

```
src/
  module.ts                 # new PanelPlugin<GeoFlowOptions>(MapPanel)
  panel/
    MapPanel.tsx            # placeholder (below)
    options.ts              # GeoFlowOptions = {} for now
  adapter/index.ts          # empty barrel, filled in Phase 1
  engine/index.ts           # empty barrel, filled in Phase 2
  model/index.ts            # empty barrel
```

**Placeholder `MapPanel`:** renders "GeoFlow" plus a list of received frames:
- `refId`
- row count
- field names and types

This makes the data path visible and gives the e2e test something to assert on. The output is also useful in Phase 1 for seeing exactly what field types the PostgreSQL data source produces for `ST_AsGeoJSON` and `jsonb` columns.

**Engine boundary:** add an ESLint override in the root `eslint.config.mjs` (extending the scaffold config) for `src/engine/**`. It uses `no-restricted-imports` to forbid:
- `@grafana/*`
- `react`
- relative imports of `../panel` and `../adapter`

To verify the rule, temporarily add a forbidden import, confirm lint fails, then remove it.

**Done when:** lint, typecheck and build pass, and the boundary rule demonstrably fires.

### 0.5 `docker/postgres/`

```
docker/postgres/
  Dockerfile                # FROM postgis/postgis:16-3.x (pinned exact tag)
  .env.example              # POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD,
                            # GEOFLOW_READER_PASSWORD
  init/
    01_extensions.sql       # CREATE EXTENSION IF NOT EXISTS postgis;
    02_schema.sql           # schema `geoflow`; read-only role `grafana_reader`
    03_seed_fixtures.sql
    04_seed_large.sql
  verify.sql                # sanity queries for manual checks
```

- **Read-only role.** Grafana connects as `grafana_reader`, which has `USAGE` on schema `geoflow` and `SELECT` on its tables only. This follows Grafana's guidance for SQL data sources, since dashboard users can write arbitrary SQL. The password comes from the environment.
- **Fixtures** (`03_seed_fixtures.sql`) model a small **fictional fiber optic network in Cary, NC**.
  - The network centers on downtown Cary (about 35.788° N, 78.781° W) and stays inside a bounding box of roughly 2 × 2 km, so the whole network fits in one map view.
  - Building footprints and cable routes are hand-drawn approximations. They are not traced from real buildings and don't depict any real operator's infrastructure.
  - Ids are fixed so e2e tests can assert on exact features and counts.

  The network topology is meant to look plausible:
  - A central office feeds backbone cables to splice cases.
  - Splice cases branch into distribution and drop cables.
  - Cables terminate on patch panels inside buildings.
  - Cable endpoints coincide exactly with the splice case or patch panel coordinates they connect to.

  | Table | Geometry types | Contents (approx.) | Key attributes |
  |---|---|---|---|
  | `geoflow.buildings` | Polygon, MultiPolygon | 8 buildings: 1 central office, 4 commercial, 2 multi-family residential, 1 data center (one Polygon with an interior courtyard hole); 1 MultiPolygon campus of 2 detached buildings | `building_type`, `address` (fictional), `floors` |
  | `geoflow.fiber_cables` | LineString, MultiLineString | ~12 cables: backbone (144F), distribution (48F/24F), drops (12F). One MultiLineString cable whose route has an aerial span and an underground span that are recorded separately. | `fiber_count`, `cable_type` (backbone / distribution / drop), `placement` (aerial / underground), `length_m` (computed with `ST_Length(geom::geography)`), `from_asset`, `to_asset` |
  | `geoflow.splice_cases` | Point | ~6 enclosures at branch points along the backbone | `enclosure_type` (dome / inline), `mount` (pole / handhole / vault), `splice_capacity`, `splices_used` |
  | `geoflow.patch_panels` | Point, MultiPoint | ~10 panels, one or more per building. The data center's panel group spans several racks and is stored as one MultiPoint. | `building_id`, `rack`, `port_count`, `ports_used`, `utilization_pct` (computed) |
  | `geoflow.network_assets` (view) | All six types | `UNION ALL` of the four tables above, with an `asset_type` column | Mixed-geometry test (Phase 3). `asset_type` / `status` are the natural split columns for `byColumn` mode (Phase 11). |
  | `geoflow.fiber_cables_stateplane` | LineString | Copy of `fiber_cables` stored in **NAD83 / North Carolina (ftUS), EPSG:2264**, the coordinate system local NC GIS data commonly uses | `ST_Transform` documentation, out-of-range coordinate warning |
  | `geoflow.edge_cases` | mixed | A NULL geometry, `POINT EMPTY`, a GeometryCollection, and a `geojson_text` column containing malformed GeoJSON | Phase 1 / 8 warnings |

  Every table also has these columns:
  - `id`
  - `name`
  - `status` (`in_service` / `planned` / `retired`)
  - `installed_on` (date)
  - `updated_at` (timestamptz, for `$__timeFilter`)
  - `geom` (SRID 4326, except the state plane table)
  - a GiST index on `geom`
- **Large data** (`04_seed_large.sql`): `geoflow.service_locations_large` holds 100k Point "customer premises" generated with `generate_series` and `random()` inside a bounding box covering Cary. A fixed `setseed()` makes it reproducible. Attributes are `service_tier` and `status`. This is used for the Phase 9 benchmarks.
- **When scripts run:** init scripts run only on first start with an empty volume. `docker compose down -v` resets the database.

**Done when:** the container starts healthy and `verify.sql` returns the expected row counts per table.

### 0.6 `docker/grafana/`

```
docker/grafana/
  Dockerfile                # Grafana 13.x image (see note)
  grafana.ini               # dev settings
  provisioning/
    datasources/postgis.yaml
    dashboards/dashboards.yaml
  dashboards/
    00-smoke.json
```

- **Dockerfile.** Base it on the scaffold's `.config/Dockerfile` approach (the dev image with live reload), with the Grafana image and version pinned to 13.x through build args.
  - If extending `.config/Dockerfile` cleanly isn't possible, `docker/grafana/Dockerfile` will be a small standalone file on `grafana/grafana:13.x`.
  - I'll confirm which at Checkpoint A, based on what the current scaffold generates.
- **`grafana.ini`** (dev only):
  - `allow_loading_unsigned_plugins = jdejesusio-geoflow-panel`
  - development app mode
  - anonymous Admin access for local use
  - debug logging for the plugin
- **Plugin mount:** `dist/` → `/var/lib/grafana/plugins/jdejesusio-geoflow-panel`.
- **Data source provisioning** (`postgis.yaml`):
  - `type: grafana-postgresql-datasource`, fixed `uid: geoflow-postgis`
  - `url: postgres:5432`, database and user from env, `secureJsonData.password: $GEOFLOW_READER_PASSWORD`
  - `jsonData`: `sslmode: disable`, `postgresVersion` set for 16, `timescaledb: false`
- **Dashboard provisioning:**
  - `dashboards.yaml` points a file provider at the mounted `dashboards/` folder, in a "GeoFlow" folder.
  - `00-smoke.json` holds one GeoFlow panel with two Table-format queries:
    - A: `SELECT id, name, building_type, ST_AsGeoJSON(geom, 6) AS geometry FROM geoflow.buildings`
    - B: `SELECT id, name, fiber_count, placement, ST_AsGeoJSON(geom, 6) AS geometry FROM geoflow.fiber_cables`
  - The dashboard has a fixed `uid` so e2e tests can navigate to it directly.

**Done when:** Grafana starts, the data source test passes, and the smoke dashboard shows two frames with non-zero rows.

### 0.7 Root `docker-compose.yaml`

The compose file stays at the repo root so the scaffold's `npm run server` keeps working. It wires the two independent directories together:

- **`grafana`**
  - build context `docker/grafana`, ports `3000:3000`
  - mounts `dist/`, provisioning and dashboards
  - `depends_on: postgres: condition: service_healthy`
- **`postgres`**
  - build context `docker/postgres`
  - port `127.0.0.1:5432:5432`, bound to localhost only, for psql and DB tools
  - named volume `geoflow-pgdata`
  - init scripts mounted at `/docker-entrypoint-initdb.d`
  - healthcheck `pg_isready`
- **Environment:** both services read `docker/postgres/.env`, copied from `.env.example`. `.env` is git-ignored. For e2e and CI, the compose file falls back to `.env.example` defaults.

**Done when:** `docker compose down -v && npm run server` reaches a working smoke dashboard from a clean state.

### 0.8 Tests

- **Unit** (`src/panel/MapPanel.test.tsx`, Jest + React Testing Library): given a fake `PanelData` with two frames, the placeholder renders both refIds and row counts. It also renders an empty-state message when there are no frames.
- **E2E** (`tests/smoke.spec.ts`, `@grafana/plugin-e2e`):
  1. The data source health check passes (`readProvisionedDataSource` + `checkHealth`).
  2. The smoke dashboard loads by uid, and the GeoFlow panel shows refIds A and B with the exact fixture row counts for `buildings` and `fiber_cables`.
  3. The panel appears in the visualization picker when you add a new panel.

**Done when:** `npm run test:ci` and `npm run e2e` pass against the running stack.

### 0.9 License and compliance

- `LICENSE`: full Apache-2.0 text.
- `NOTICE`: `GeoFlow, Copyright 2026 Jose DeJesus`, plus a placeholder section for third-party attributions. The OSM attribution gets added when the basemap lands in Phase 2.
- **License check:**
  - Add `license-checker-rseidelsohn` as a dev dependency.
  - Add an npm script `license:check` that checks production dependencies only, with `--onlyAllow "Apache-2.0;MIT;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;CC0-1.0"`.
  - The project's own package is excluded.

**Done when:** `npm run license:check` passes, and adding a dependency with a disallowed license makes it fail (verified once, then reverted).

### 0.10 CI and README

- **CI workflow** (the scaffold's `.github/workflows/`):
  - Add a `license:check` step after install.
  - Restrict the e2e Grafana version matrix to 13.0 and the latest 13.x.
  - Make sure the e2e job brings up the full compose stack, including `postgres`.
  - Keep the scaffold's plugin-validator step.
- **README:**
  - Project summary
  - Prerequisites
  - Quick start (`cp docker/postgres/.env.example docker/postgres/.env && npm install && npm run dev` + `npm run server`)
  - Resetting the database
  - Running tests
  - Links to `docs/`
  - License

**Done when:** CI passes on the pushed `phase-0` branch.

> **Checkpoint B:** Phase 0 review against the exit criteria, then merge into `main`.

---

## Resulting top-level layout

```
.config/                     # create-plugin managed, do not edit
.github/workflows/
docker/
  grafana/
  postgres/
docs/
src/
  module.ts  plugin.json  panel/  adapter/  engine/  model/
tests/
docker-compose.yaml
eslint.config.mjs  jest.config.js  playwright.config.ts  tsconfig.json
package.json  LICENSE  NOTICE  README.md  .nvmrc
```

## Risks and how they're handled

| Risk | Handling |
|---|---|
| The current create-plugin layout (compose base file, Dockerfile, ESLint flat config) differs from what this plan assumes. | Checkpoint A is placed right after scaffolding, so steps 0.6/0.7 adapt to what was actually generated before anything is built on top. |
| The `@grafana/*` 13.x package versions and e2e matrix syntax are unconfirmed. | Look them up at implementation time from the npm registry and the scaffold's CI. Record the resolved versions in the Checkpoint B summary. |
| Init SQL silently doesn't run (existing volume). | Documented in the README. `verify.sql` and the e2e row-count assertion catch it. |
| Port 5432 or 3000 is already in use on the host. | Both ports can be overridden by environment variables in `docker-compose.yaml`. |

## Decisions

| Topic | Decision |
|---|---|
| Author / copyright holder | Jose DeJesus |
| Repository | https://github.com/jdejesus517/grafana-geoflow-plugin |
| Fixture data | Small fictional fiber optic network (buildings, fiber cables, splice cases, patch panel terminations) in Cary, NC |

No open decisions remain for Phase 0.

---

## Outcome

All exit criteria were verified locally from a clean state (`docker compose down -v`, rebuild, then typecheck, lint, unit tests, build, license check and e2e). CI hasn't run yet: the workflow triggers on pull requests to `main`.

### Differences from the plan

| Plan | Actual | Why |
|---|---|---|
| `grafanaDependency: ">=13.0.0"`, e2e on 13.0 and latest 13.x | `>=13.2.0`, `@grafana/*` 13.2.4; CI resolves the e2e matrix from `grafanaDependency` | Decided at Checkpoint A (scaffold default). |
| `docker/grafana/Dockerfile` and `grafana.ini` | No Dockerfile or `grafana.ini`. The root compose file extends the scaffold's Grafana service; `docker/grafana/` holds `provisioning/` and `.env.example`. | Decided at Checkpoint A. The scaffold image already sets dev mode, anonymous admin, the unsigned-plugin allow-list and debug logging, and keeps live reload and CI modes. |
| Dashboards in `docker/grafana/dashboards/` | `docker/grafana/provisioning/dashboards/` | `@grafana/plugin-e2e`'s `readProvisionedDashboard` reads from `<provisioningRootDir>/dashboards`. |
| Postgres init scripts mounted by compose | Copied into the image by `docker/postgres/Dockerfile` | Keeps `docker/postgres/` self-contained. |
| Reader role created in `02_schema.sql` | `05_reader_role.sh` | The role password comes from the environment, which SQL init files can't read. |
| Grafana and Postgres both read `docker/postgres/.env` | Each directory has its own `.env.example` / `.env` | Keeps the two directories independent. The reader password must match in both. |
| Fixture table shapes approximate | 9 buildings, 15 fiber cables, 7 splice cases (1 retired), 11 patch panels, 6 edge cases, 42 rows in `network_assets`, 100k service locations | Exact counts are asserted by `verify.sql` and e2e. |
| License allow-list: Apache-2.0, MIT, BSD-2/3, ISC, 0BSD, CC0-1.0 | Added Unlicense, BlueOak-1.0.0, Python-2.0, Public Domain and Zlib, all permissive and Apache-2.0-compatible. `get-document@1.0.0` is excluded by exact version. | All of these come through `@grafana/ui`, which Grafana provides at runtime and which isn't bundled. `get-document` declares no license at all. |
| Package version unspecified | `0.1.0`, `"private": true` | Pre-MVP; Grafana plugins aren't published to npm. |

### Findings for later phases

- **Field types on Grafana 13.2.4** (for Phase 1):
  - `ST_AsGeoJSON(...)` arrives as a `string` field.
  - `json`/`jsonb` columns arrive as type `other` with already-parsed object values.
  - A raw `geom` column arrives as a hex EWKB string.
- **Scaffold Jest hang.** create-plugin 7.17.0's Jest setup installs a global `MessageChannel` that React's scheduler leaves open, so Jest never exits. Worked around in the root `jest-setup.js`. Recheck after `create-plugin update`.
- **Local npm.** The system npm 9.2.0 (Debian package) fails installs with socket timeouts. npm 10 works; `packageManager` records `npm@10.9.9`.
- **Node version.** The scaffold shipped `.nvmrc` 24 with CI on 22, and Grafana's `build-plugin` action defaults to Node 20. Standardized on Node 26 (current LTS): `.nvmrc` is 26, the setup-node workflows read it, and the `build-plugin` / `bundle-size` actions pass `node-version: '26'` explicitly. Check these after any `create-plugin update`.
- **npm audit.**
  - 13 moderate findings in production dependencies, all inside `@grafana/*` runtime externals.
  - The 5 high findings are all in the dev-only `@grafana/sign-plugin` chain.
- **Plugin validator.** Errors: none. Warnings:
  - Repository links return 404 while the GitHub repository is private.
  - The plugin is unsigned.
  - No screenshots yet.

