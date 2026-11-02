# Phase 1: Data Frame → GeoJSON Adapter

Status: **Complete** (2026-11-01), pending review. See [Outcome](#outcome) for where the result differs from this plan.
Architecture reference: [architecture.md](architecture.md) §2.3 (adapter layer), §3 (conversion), §5.3 (Phase 1 row).

## Goal

Turn Grafana `DataFrame`s from the PostgreSQL data source into GeoJSON `FeatureCollection`s, with a clear record of every row that couldn't be converted and why. This is pure TypeScript in `src/adapter/`, with no map and no new panel options.

Everything later depends on this: the engine (Phase 2+) renders what the adapter produces, and popups and styling (Phases 4–5) read the properties it attaches. Phase 1 gets it right in isolation, with tests built from real Grafana 13.2 output captured from the Phase 0 database.

## Exit criteria

1. `frameToFeatureCollection` converts every geometry type in the fixture database (Point, MultiPoint, LineString, MultiLineString, Polygon with hole, MultiPolygon) from all three input shapes:
   - `ST_AsGeoJSON(geom)` text
   - `jsonb` (already-parsed objects)
   - `ST_AsGeoJSON(t.*)` Feature text
2. Every row in `geoflow.edge_cases` and `geoflow.fiber_cables_stateplane` is skipped with the correct warning kind. No exceptions escape the adapter for any input.
3. `detectGeometryField` finds the geometry column for all fixture queries, and returns nothing (with a reason) for a frame that has no geometry.
4. Unit tests cover the cases in step 1.6. The adapter's statement and branch coverage is at least 95%.
5. Converting 100k Point rows takes under 1 s on a developer machine (step 1.7). This is a sanity check, not a CI gate.
6. The placeholder panel shows feature counts and warning counts per frame (step 1.8), and the e2e smoke test asserts them.
7. The `src/engine/` boundary rule still passes, and the new `src/model/` types import nothing from Grafana.
8. All existing checks pass locally and in CI.

## Out of scope

- Rendering anything on a map (Phase 2–3).
- Panel options for choosing the geometry or id field. The adapter accepts a `mapping` argument now; the UI for it comes with layer configuration in Phase 6. Until then, auto-detection is used.
- Display formatting for popups (`field.display`), Phase 4.
- Parsing WKB/EWKB hex. It is detected and reported with a hint, not converted.
- Moving conversion into a web worker (Phase 8, only if benchmarks call for it).

---

## Design

### 1. Public API (`src/adapter/index.ts`)

```ts
interface GeometryMapping {
  geometryField?: string; // explicit column name; auto-detect when omitted
  idField?: string;       // column to use as feature id; default: a field named "id", else row index
}

interface ConversionResult {
  featureCollection: FeatureCollection;
  geometryField?: string;          // the column actually used
  noGeometryReason?: NoGeometryReason; // set when no geometry column was found
  warnings: ConversionWarnings;
}

interface ConversionWarnings {
  counts: Record<WarningKind, number>;
  samples: Array<{ row: number; kind: WarningKind; detail: string }>; // first 5 only
}

type WarningKind = 'empty' | 'invalid' | 'unsupported' | 'projected' | 'outOfRange';

function detectGeometryField(frame: DataFrame, preferred?: string): GeometryFieldMatch | NoGeometry;
function frameToFeatureCollection(frame: DataFrame, mapping?: GeometryMapping): ConversionResult;
```

GeoJSON types come from `@types/geojson`, a types-only dev dependency that adds nothing to the bundle. They're re-exported from `src/model/` so the engine can use them without depending on the adapter.

### 2. Geometry field detection

This follows architecture §3.2, refined with what Phase 0 showed about real frames.

1. **Explicit name.** If `mapping.geometryField` is set and that field exists, use it. If it doesn't exist, report `noGeometryReason: 'fieldNotFound'` instead of falling back silently.
2. **Conventional names**, case-insensitive: `geometry`, `geom`, `geojson`, `the_geom`, `wkb_geometry`, `shape`. The field must be `string` or `other` and its first non-null value must look like GeoJSON. Otherwise detection moves on to step 3.
3. **Content sniffing:** the first `string` or `other` field whose first non-null value is GeoJSON.
   - A value counts as GeoJSON if it's an object (or JSON text) whose `type` is a geometry type or `Feature`.
   - For text, only values that start with `{` are parsed, so long non-JSON strings don't cost a `JSON.parse` attempt.
4. **No match:** report a `NoGeometryReason`:
   - `wkbDetected` when a column holds hex that looks like WKB/EWKB, e.g. a raw `geom` column (the Phase 0 finding). The hint says to wrap it in `ST_AsGeoJSON(...)`.
   - `none` otherwise.

### 3. Row conversion

This follows the algorithm in architecture §3.3, with these refinements:

| Input | Result |
|---|---|
| `null`, `undefined`, `''` | skip, `empty` |
| Geometry with empty `coordinates` (`[]`), as PostGIS emits for `POINT EMPTY` | skip, `empty` |
| Text that isn't valid JSON (truncated, WKT) | skip, `invalid` |
| Object without a recognizable geometry `type`, or coordinates of the wrong nesting depth | skip, `invalid` |
| `GeometryCollection` or any other unsupported type | skip, `unsupported` |
| Geometry with a `crs` member other than EPSG:4326 / CRS84 (PostGIS adds this for other SRIDs) | skip, `projected`; the detail names the CRS (e.g. `EPSG:2264`) |
| Any coordinate outside lon ±180 / lat ±90 | skip, `outOfRange` |
| `Feature` | use its `geometry`, merge its `properties` (see below) |

- **Validation is structural only.** It checks that `coordinates` is nested to the right depth for the type and that the leaves are finite numbers. It does not check ring closure or self-intersection, which is PostGIS's job and is expensive to check.
- **Skipping projected and out-of-range rows** (rather than drawing them) is deliberate. Coordinates like `[2063467, 741797]` would draw as garbage or not at all, and a named warning is more useful than a broken map. See decision 1.
- **Properties:**
  - Every other field in the row becomes a property, keyed by field name.
  - For `Feature` input, the Feature's own `properties` come first, and column values override them on a name clash.
  - `time` fields stay as epoch milliseconds.
  - Objects and arrays are JSON-stringified, matching what MapLibre does anyway.
  - `null` stays `null`.
- **Ids:**
  - With `mapping.idField`, or a field named `id`, a finite numeric value becomes the feature `id`.
  - Otherwise, or if the value isn't numeric, the row index becomes the `id` and the original value stays in `properties`.
  - Duplicate numeric ids fall back to the row index for the later duplicates, which keeps MapLibre feature-state lookups unambiguous.
- **Performance:**
  - Fields are resolved once per frame, and rows are read from `field.values` by index.
  - There are no per-row closures and no `DataFrameView`.
  - Text that doesn't start with `{` isn't parsed.

### 4. Multiple frames

`framesToFeatureCollections(frames, mapping?)` maps each frame by `refId` to a `ConversionResult`. That covers the placeholder panel now, and `buildLayerSpecs` builds on it in Phase 6.

---

## Steps

Work happens on a `phase-1` branch, cut from `main` after PR #1 is merged. If PR #1 is still open when this starts, the branch goes on top of `phase-0` and is rebased later. One commit per step.

### 1.1 Model types

- Add `@types/geojson` as a dev dependency.
- `src/model/geojson.ts`: re-export the GeoJSON types, plus `SUPPORTED_GEOMETRY_TYPES` and a type guard for them.

**Done when:** the boundary rule and typecheck pass, and `src/model/` has no Grafana imports.

### 1.2 Capture real frame fixtures

Grafana's own output beats hand-written frames. With the Phase 0 stack running, `scripts/capture-frames.mjs` queries `/api/ds/query` and saves the response frames as JSON under `src/adapter/__fixtures__/`.

| Fixture | Query |
|---|---|
| `buildings.json` | buildings with `ST_AsGeoJSON(geom, 6)` text (Polygon with hole, MultiPolygon) |
| `fiber_cables.json` | cables as text (LineString, MultiLineString) |
| `patch_panels_jsonb.json` | patch panels as `ST_AsGeoJSON(geom, 6)::jsonb` (Point, MultiPoint; `other` field type) |
| `splice_cases_feature.json` | splice cases as `ST_AsGeoJSON(t.*)` Feature text |
| `network_assets.json` | the mixed view, all six types |
| `edge_cases.json` | edge cases: both the `geom` column as GeoJSON and the raw `geojson_text` column |
| `stateplane.json` | `fiber_cables_stateplane` without `ST_Transform` (`crs` member present) |
| `raw_wkb.json` | `SELECT id, geom FROM geoflow.splice_cases`, with geometry as hex EWKB |
| `no_geometry.json` | `SELECT id, name FROM geoflow.buildings` |

- Tests load these with `dataFrameFromJSON`.
- The script is rerun only when the fixture data or the Grafana version changes. The README documents how to run it.

**Done when:** the fixtures are committed and each one loads into a `DataFrame` in a smoke test.

### 1.3 `detectGeometryField`

Implement the field detection described in Design §2.

**Done when:** tests cover every fixture, a renamed geometry column (detected by content sniffing), the explicit-name and missing-name cases, `wkbDetected` and `none`.

### 1.4 Geometry parsing and validation

`src/adapter/parseGeometry.ts` handles a single value, returning a geometry or a warning kind with detail. It covers the parse and validation rules in Design §3.

**Done when:** table-driven tests cover every row of the §3 table, plus coordinate-depth errors for each type, non-finite numbers, Z coordinates passed through, and both `EPSG:4326` and `CRS84` `crs` members accepted.

### 1.5 `frameToFeatureCollection`

Assemble rows into features: properties, ids, warning counts and samples. Add `framesToFeatureCollections` for multiple frames.

**Done when:** the step 1.6 tests pass.

### 1.6 Tests

Fixture-based tests:
- Feature counts per fixture equal the seed row counts:
  - 9 buildings
  - 15 cables
  - 11 patch panels
  - 7 splice cases
  - 42 network assets
- The `edge_cases` `geom` column gives 1 feature (row 4), 4 × `empty` (3 NULL plus `POINT EMPTY`) and 1 × `unsupported` (the GeometryCollection).
- Its `geojson_text` column gives:
  - 1 `invalid` (truncated)
  - 1 `invalid` (WKT)
  - 1 `outOfRange` (Web Mercator metres)
  - 3 × `empty` (the NULL rows)
- `stateplane` gives 15 × `projected`, with detail `EPSG:2264`.
- Polygon with a hole keeps both rings, and MultiPoint keeps 3 positions.
- Feature input merges properties, and column values win on a name clash.
- Ids are numeric `id` values, and the fallbacks work.

Synthetic tests built with `toDataFrame` for cases the database can't easily produce:
- A frame with zero rows
- Duplicate ids
- Nested object properties
- `time` fields
- Mixed string and object values in one column

**Done when:** `npm run test:ci` passes, and the coverage for `src/adapter/` is at least 95%. Coverage is measured with `jest --coverage` but not made a CI gate in this phase.

### 1.7 Benchmark sanity check

`scripts/bench-adapter.mjs` builds a 100k-row frame, half Points and half 5-vertex LineStrings, converts it, and prints the time. Results go in the Phase 1 outcome section. It isn't run in CI, because timings on shared runners are noisy. Phase 8 does the real performance work.

**Done when:** the run completes in under 1 s locally and the number is recorded.

### 1.8 Placeholder panel uses the adapter

`MapPanel` keeps its frame listing and adds the adapter's view of each frame:
- the geometry column it chose
- the feature count
- any non-zero warning counts, e.g. `A: 9 rows → 9 features (geometry)` or `A: 6 rows → 1 feature (geom) · empty 4, unsupported 1`

This makes the adapter visible in Grafana before any map exists, at little cost.
- Add a second provisioned dashboard, `01-adapter.json`, with panels for the mixed view, the `jsonb` and Feature inputs, the edge cases and the state plane table.
- Extend the e2e tests to assert its counts.

**Done when:** unit and e2e tests pass, and the dashboard shows the expected counts.

### 1.9 Docs

- Record the outcome in this file.
- Update architecture §3 wherever the implementation settled a detail differently, e.g. the `projected` warning kind and the `shape` field name.

> **Checkpoint:** review the adapter API and fixture tests at the end of step 1.6. Steps 1.7–1.9 are small and follow directly.

---

## Risks

| Risk | Handling |
|---|---|
| Captured fixtures tie tests to Grafana 13.2's frame format. | That is the format we support. When the minimum Grafana version changes, rerun the capture script and let the tests show any difference. |
| Structural validation misses something MapLibre rejects. | Phase 3 renders every fixture. Any gap found there becomes a new adapter test case. |
| Skipping out-of-range rows hides data a user expected to see. | The warning counts plus the first five samples are visible in the panel, and the detail tells the user how to fix the query. |
| `jsonb` arrives differently in a future Grafana version. | Both string and object values are handled, and the jsonb fixture catches a change on recapture. |

## Decisions

Confirmed 2026-11-01.

| Topic | Decision |
|---|---|
| Projected and out-of-range geometries | Skipped and reported as `projected` / `outOfRange` warnings, not passed to the map. |
| Placeholder panel | Shows the adapter's results per frame (step 1.8), with the `01-adapter` dashboard and e2e assertions. |
| Feature `properties` vs. columns | Column values override Feature `properties` on a name clash. |

---

## Outcome

All exit criteria were met locally:
- 137 unit tests, with adapter coverage at 100% of statements and 99.3% of branches
- 9 e2e tests against Grafana 13.2.4
- typecheck, lint and the license check pass

CI runs on the pull request.

### Benchmark (step 1.7)

`npm run bench:adapter`: 100k rows, half Points and half 5-vertex LineStrings, median of 5 runs after a warm-up. Measured on an AMD Ryzen 7 5700U with Node 26.13.0.

| Input | Median | Target |
|---|---|---|
| GeoJSON text (`ST_AsGeoJSON`) | 294 ms | < 1 s |
| Parsed objects (`jsonb`) | 144 ms | < 1 s |

About half the time for text input is `JSON.parse`. Moving conversion into a web worker isn't needed at this size; Phase 8 revisits it with rendering included.

### Differences from the plan

| Plan | Actual | Why |
|---|---|---|
| Detection reads each column's first non-null value | Reads up to the first ten non-null values | Found by a test: one malformed first row hid an entire geometry column. |
| Duplicate ids fall back to the row index for the later duplicates | All-or-nothing: id column values are used only if all are unique finite numbers, otherwise every feature uses its row index | A per-row fallback index could collide with another row's real id. |
| `noGeometryReason` field | `noGeometry: { reason, detail }` | The detail (e.g. the `ST_AsGeoJSON` hint) is shown to the user as-is. |
| `scripts/bench-adapter.mjs` | `src/adapter/__bench__/*.bench.ts`, run with `npm run bench:adapter` | The TypeScript adapter runs through Jest's transform without a separate build; `test:ci` doesn't match `*.bench.ts`. |
| Step order 1.3 then 1.4 | 1.4 (parsing) before 1.3 (detection) | Detection reuses the parser's GeoJSON check. |
| Boundary rule covers `src/engine/` | Covers `src/engine/` and `src/model/` | Exit criterion 7: model types must not import Grafana. |

### Findings for later phases

- **Provisioning reload.** Grafana 13.2 didn't pick up a new provisioned dashboard file while running; `docker compose restart grafana` did. Now documented in the README.
- **Frame types (captured fixtures).**
  - `timestamptz` and `date` columns arrive as `time` fields (epoch ms).
  - `numeric` columns arrive as `number`.
  - PostgreSQL enums arrive as `string`.
  - All of these pass through as properties unchanged, ready for display formatting in Phase 4.
- **Structural validation only.** Degenerate shapes, such as a Polygon with an empty ring, pass the adapter. Phase 3 renders every fixture and adds adapter tests for anything MapLibre rejects.

