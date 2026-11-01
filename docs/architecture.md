# Target Architecture: Grafana PostGIS Map Panel

Status: **Proposal, awaiting approval.** Nothing here is implemented yet.

This document responds to the five pre-implementation items in [project_overview.md](project_overview.md):

1. Application architecture
2. Major components and responsibilities
3. Data frame → GeoJSON conversion
4. Compatibility and performance risks
5. Development and testing strategy

---

## 1. Architectural overview

The plugin is a **frontend-only Grafana panel plugin**. It has no backend component and opens no database connection of its own. All data reaches it through Grafana's built-in PostgreSQL data source, as `DataFrame`s in `PanelProps.data`.

```
┌──────────────────────────── Grafana ─────────────────────────────┐
│                                                                  │
│  PostgreSQL data source ──(SQL with ST_AsGeoJSON)──► PostGIS DB   │
│          │                                                       │
│          ▼ DataFrame[] (one per query / refId)                   │
│  ┌─────────────────── Panel plugin ───────────────────────────┐  │
│  │                                                            │  │
│  │  [Grafana layer]  src/panel/                               │  │
│  │    module.ts ─ PanelPlugin + options builder               │  │
│  │    MapPanel.tsx ─ React glue: props → engine calls         │  │
│  │          │                                                 │  │
│  │          ▼                                                 │  │
│  │  [Adapter layer]  src/adapter/                             │  │
│  │    frameToGeoJSON ─ DataFrame → FeatureCollection          │  │
│  │    buildLayerSpecs ─ panel options + frames → LayerSpec[]  │  │
│  │          │   (plain TS objects, no Grafana types beyond)   │  │
│  │          ▼                                                 │  │
│  │  [Engine layer]  src/engine/   ← no @grafana/* imports     │  │
│  │    MapEngine interface + MapLibreEngine implementation     │  │
│  │    style builders (LayerSpec → MapLibre layer specs)       │  │
│  │    popup rendering                                         │  │
│  │          │                                                 │  │
│  │          ▼                                                 │  │
│  │       MapLibre GL JS  ──►  basemap tiles (style URL)       │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Key decisions

| Decision | Rationale |
|---|---|
| Panel plugin only, no backend | Requirement 1 and 2. Grafana's PostgreSQL data source already handles auth, connection pooling, macros, template variables and caching. |
| SQL returns GeoJSON text via `ST_AsGeoJSON(...)` | GeoJSON is what MapLibre consumes natively. Parsing WKB in the browser would add a dependency and CPU cost for no MVP benefit. |
| Three layers: panel / adapter / engine | Requirement 7. The engine can be tested, reused or replaced (for example by OpenLayers or deck.gl) without touching Grafana code. |
| Engine boundary enforced by lint, not convention | An ESLint `no-restricted-imports` rule on `src/engine/**` forbids `@grafana/*`, `react` and `../panel`/`../adapter` imports. |
| One Grafana query (refId) = one spatial layer by default | This maps onto Grafana's existing query editor UX, where users already add queries A, B, C. Layer config can override which frame and fields it uses. |
| Map instance is created once and updated in place | Re-creating a WebGL context on every refresh is slow and leaks contexts. Data updates go through `GeoJSONSource.setData()`. |

---

## 2. Components and responsibilities

### 2.1 Directory layout

Scaffolded with `npx @grafana/create-plugin@latest` (panel type). The repository then follows the standard layout plus three source subfolders:

```
src/
  module.ts                    # PanelPlugin registration + options
  plugin.json
  panel/                       # Grafana-aware layer
    MapPanel.tsx
    options.ts                 # PanelOptions types + builder
    editors/LayersEditor.tsx   # custom option editor for the layer list
  adapter/                     # Grafana DataFrame ⇄ neutral model
    frameToGeoJSON.ts
    detectGeometryField.ts
    buildLayerSpecs.ts
    __tests__/
  engine/                      # framework-neutral rendering
    types.ts                   # LayerSpec, LayerStyle, ViewState, MapEngine
    MapLibreEngine.ts
    styleBuilders.ts           # pure: LayerSpec → maplibre LayerSpecification[]
    popup.ts
    __tests__/
  model/                       # shared plain types (GeoJSON helpers, errors)
provisioning/                  # datasources + dashboards for local dev / e2e
docker/postgis/init/*.sql      # seed data
tests/                         # Playwright e2e (@grafana/plugin-e2e)
```

### 2.2 Panel layer (`src/panel`, Grafana-aware)

- **`module.ts`**: `new PanelPlugin<MapOptions>(MapPanel).setPanelOptions(...)`. It declares basemap, view and layer options. `useFieldConfig()` is enabled so per-field unit and decimals settings work in popups.
- **`MapPanel.tsx`**: A thin React component.
  - On mount: create a `div`, call `engine.mount(div, initialView, basemap)`.
  - On `data` / `options` change: call the adapter to build `LayerSpec[]`, then call `engine.setLayers(specs)`.
  - On `width` / `height` change: call `engine.resize()`.
  - On theme change (`useTheme2()`): call `engine.setBasemap()` if a light/dark style pair is configured.
  - On unmount: call `engine.destroy()`.
  - Shows conversion warnings (for example "12 rows had invalid geometry") through Grafana's panel notice mechanism. Shows "No data" or a configuration hint when no geometry field is found.
- **`LayersEditor.tsx`**: A custom option editor for the ordered list of spatial layers (add, remove, reorder, per-layer settings).

### 2.3 Adapter layer (`src/adapter`)

This is the only place that knows about both `DataFrame` and GeoJSON. Its functions are pure, deterministic and unit-testable.

- `detectGeometryField(frame)`: picks the geometry column (see §3).
- `frameToFeatureCollection(frame, mapping) → { fc, warnings }`.
- `buildLayerSpecs(frames, options, theme) → LayerSpec[]`: joins the layer configuration with frames by `refId` and resolves style defaults from the Grafana theme. Popup display values are pre-formatted with Grafana's field display processor, so the engine never needs Grafana formatting code.

### 2.4 Engine layer (`src/engine`, Grafana-independent)

A neutral contract:

```ts
interface MapEngine {
  mount(container: HTMLElement, view: ViewState, basemap: BasemapSpec): void;
  setBasemap(basemap: BasemapSpec): void;
  setLayers(layers: LayerSpec[]): void;      // diffed: add/update/remove
  fitToData(padding?: number): void;
  setView(view: ViewState): void;
  resize(): void;
  on(event: 'featureClick' | 'viewChange', cb: (...) => void): () => void;
  destroy(): void;
}

interface LayerSpec {
  id: string;                  // stable across refreshes
  name: string;
  visible: boolean;
  data: FeatureCollection;
  style: LayerStyle;           // color, opacity, radius, lineWidth, fillOpacity…
  popup: { enabled: boolean; fields: string[] | 'all' };
}
```

- **`MapLibreEngine`** implements the contract. Each `LayerSpec` maps to one GeoJSON source and up to four MapLibre style layers:
  - `fill` and a `line` outline for Polygon and MultiPolygon
  - `line` for LineString and MultiLineString
  - `circle` for Point and MultiPoint

  Each style layer is filtered by geometry type: `['match', ['geometry-type'], ['Polygon','MultiPolygon'], true, false]`. The list form keeps the filter correct across MapLibre versions, which differ on whether Multi* types are reported separately.
- **`setLayers`** diffs against current state by `id`:
  - Unchanged layer: no-op.
  - Changed data: `setData()`.
  - Changed style: `setPaintProperty()`.
  - Add or remove: add or remove the source and its layers.
  - Re-adds everything after a basemap `setStyle()`, which drops user layers. Alternatively, uses `setStyle(..., { transformStyle })` to carry the layers over.
- **`styleBuilders.ts`** is pure: `LayerSpec → LayerSpecification[]`. Most styling logic can therefore be tested without WebGL.
- **Popups**: on click, query rendered features across this plugin's layers, then show a `maplibregl.Popup` built from the pre-formatted properties. The popup is built as DOM text nodes, never `innerHTML` (attribute values are untrusted data).

---

## 3. Converting Grafana data frames to GeoJSON

### 3.1 Expected query shape

Users write queries in **Table** format, not Time series format, which would pivot the columns:

```sql
SELECT
  id,
  name,
  status,
  ST_AsGeoJSON(ST_Transform(geom, 4326), 6) AS geometry
FROM assets
WHERE $__timeFilter(updated_at)   -- optional; any Grafana macro works
```

- `ST_Transform(..., 4326)` is required unless the data is already in WGS84. GeoJSON (RFC 7946) and MapLibre assume lon/lat.
- The precision argument (`6` ≈ 0.1 m) roughly halves payload size compared with the default of 9 decimals.

Also accepted:

- A column containing a full **GeoJSON Feature**, e.g. `ST_AsGeoJSON(t.*)`. Its `properties` are merged with the other columns.
- A `json` / `jsonb` geometry column. Depending on the Grafana version, this arrives as a string or as an already-parsed object; both are handled.

### 3.2 Geometry field resolution

Resolution runs in this order:

1. An explicit field name from the layer config.
2. A field named `geometry`, `geom`, `geojson`, `the_geom` or `wkb_geometry` (case-insensitive).
3. The first string or other field whose first non-null value parses as GeoJSON geometry or Feature.

If nothing matches, the panel shows a hint with an example query instead of failing silently.

### 3.3 Row conversion algorithm

```
for each row i in 0..frame.length:
  raw = geomField.values[i]
  if raw is null/empty            → skip (count as "empty")
  obj = typeof raw === 'string' ? JSON.parse(raw) : raw      (try/catch → "invalid")
  if obj.type === 'Feature'       → geometry = obj.geometry, baseProps = obj.properties
  else                            → geometry = obj, baseProps = {}
  validate geometry.type ∈ {Point, MultiPoint, LineString, MultiLineString,
                            Polygon, MultiPolygon}           (else "unsupported")
  properties = baseProps ∪ { other field name → field.values[i] }
  id = idField ? idField.values[i] : i
  push { type:'Feature', id, geometry, properties }
return { FeatureCollection, warnings: {empty, invalid, unsupported} }
```

Notes:

- The adapter iterates `field.values` arrays directly instead of using `DataFrameView`. This avoids creating a proxy object per row on large frames.
- **Feature ids**: MapLibre's feature-state (hover highlighting) needs numeric ids or `promoteId`. If the `id` column is non-numeric, the adapter assigns the row index as `id` and keeps the original value in `properties`.
- **Nested property values** (objects or arrays) are JSON-stringified, because MapLibre flattens them anyway.
- **Display values** for popups are computed with `field.display(value)` and stored in a separate map per layer keyed by feature id. This keeps feature properties raw for data-driven styling later.
- **Not supported in MVP**:
  - `GeometryCollection`: counted as "unsupported" and reported.
  - Z/M coordinates: passed through; MapLibre ignores them.
  - Raw WKB / EWKB hex: left for a later phase if requested.

---

## 4. Compatibility and performance risks

### 4.1 Compatibility

| Risk | Mitigation |
|---|---|
| **Grafana version range.** Plugin APIs and the data source id changed over time (`postgres` → `grafana-postgresql-datasource`). | Set `grafanaDependency` in `plugin.json` to a current supported range (to be confirmed against the latest docs at scaffold time). Do not depend on the data source id; read only `DataFrame`s. Run e2e tests against the minimum and latest supported versions. |
| **Content Security Policy.** MapLibre spawns web workers from `blob:` URLs, and Grafana's optional CSP can block them. | Document the required `worker-src blob:` CSP directive. Evaluate `maplibregl.setWorkerUrl()` with a worker file shipped in the plugin bundle as a fallback. |
| **WebGL availability.** MapLibre v5 requires WebGL2. Headless renderers, old GPUs and VDI environments may lack it. | Detect support on mount and show a clear message instead of a blank panel. Document the image renderer limitation. |
| **Basemap tiles and air-gapped installs.** Public tile servers have usage policies and need internet access. | The basemap style URL is configurable. Default to a free, permissive style. Allow a "no basemap" (blank background) option. Document self-hosting. |
| **MapLibre CSS.** Without it, controls and popups render broken. | Import `maplibre-gl/dist/maplibre-gl.css` in the panel module, and scope overrides with Emotion (`useStyles2`) to avoid leaking into Grafana. |
| **Panel lifecycle.** Grafana unmounts panels when they scroll out of view, open in panel edit, or appear in repeated rows. Browsers cap WebGL contexts at about 16. | Always call `map.remove()` on unmount. Avoid re-creating the map on option changes. Test dashboards with many map panels. |
| **Theme switching** (light/dark). | Use an optional pair of light and dark basemap styles. Derive default layer colors from `theme.visualization`. |
| **Coordinate systems.** Data not in EPSG:4326 renders in the wrong place or not at all. | Document `ST_Transform` usage. The adapter warns when coordinates fall outside ±180/±90. |
| **Antimeridian-crossing geometries.** | These are known MapLibre/GeoJSON edge cases. Document the issue rather than solve it in the MVP. |

### 4.2 Performance

| Concern | Approach |
|---|---|
| **Payload size.** GeoJSON text is verbose. | Recommend `ST_AsGeoJSON(geom, 6)`. For detailed polygons, recommend `ST_SimplifyPreserveTopology`. Mention the data source row limit (`row_limit` in Grafana config). |
| **Main-thread parsing.** `JSON.parse` per row plus FeatureCollection construction blocks the UI on large results. | Benchmark at 1k, 10k, 100k features in Phase 8. If 100k blocks too long, move conversion to a web worker. MapLibre's own `geojson-vt` tiling already runs in its worker. |
| **Redundant work on refresh.** | Memoize conversion per frame and skip `setData` when the frame has not changed (same frame reference / structural hash). Keep the viewport across refreshes unless "fit to data on refresh" is on. |
| **Re-renders from React.** | Hold the engine in a `useRef`. Effects depend on narrow inputs (`data.series`, `options.layers`, `width`, `height`), never on the whole props object. |
| **Bundle size.** MapLibre is about 800 KB minified. | This is acceptable for a panel plugin, and Grafana loads plugin bundles lazily. Check the size in CI to catch regressions. |
| **Beyond about 100k features.** | Out of scope for the MVP. The future path is vector tiles from PostGIS (`ST_AsMVT` via Martin or pg_tileserv). This would be a deliberate exception to "Grafana data source only" and needs separate approval. |

---

## 5. Development and testing strategy

### 5.1 Local environment

- Scaffold with `@grafana/create-plugin`. It provides webpack, Jest, Playwright, ESLint, the Docker Compose Grafana dev image and GitHub Actions CI.
- Extend `docker-compose.yaml` with a `postgis/postgis` service. Seed it from `docker/postgis/init/*.sql` with fixture tables covering every geometry type, a non-4326 table, invalid and empty rows, and a large table for performance tests.
- Provision the PostgreSQL data source and a set of dashboards in `provisioning/`. Each dashboard exercises one feature: points only, mixed types, multi-layer, refresh. Every dashboard doubles as an e2e fixture.

### 5.2 Test pyramid

| Level | Tooling | Covers |
|---|---|---|
| Unit | Jest | Adapter: `frameToFeatureCollection` across all geometry types, Feature input, string vs object values, null/invalid/unsupported rows, id handling, field detection. Engine: `styleBuilders` output and the `setLayers` diff logic with `maplibre-gl` mocked. jsdom has no WebGL, so the real map is not exercised here. |
| Component | Jest + React Testing Library | `MapPanel` calls the engine correctly on mount, data change, resize and unmount. Uses a fake `MapEngine`, which is another payoff of the interface. Covers the "no geometry field" hint. |
| End-to-end | Playwright + `@grafana/plugin-e2e` against the Docker stack | The panel loads in provisioned dashboards. The canvas renders. Clicking a known feature opens a popup with the expected attributes. Option changes take effect. Dashboard refresh updates features. Runs against minimum and latest Grafana versions. |
| Manual / perf | Provisioned "large" dashboard + browser profiler | Conversion and render timings at 1k, 10k and 100k features. |

CI runs lint (including the engine import boundary), typecheck, unit tests, build, `@grafana/plugin-validator` and e2e on every PR.

### 5.3 Incremental delivery plan

Each phase ends with something demonstrable and its own tests. I will stop for review after each phase.

| Phase | Deliverable | Verified by |
|---|---|---|
| 0 | Scaffold, Docker stack with PostGIS + seed data, provisioned data source, placeholder panel | Panel appears in Grafana; CI green |
| 1 | Adapter: `frameToFeatureCollection` + field detection (no UI) | Unit tests |
| 2 | Engine skeleton: `MapEngine`, `MapLibreEngine` with basemap only, mount/resize/destroy; panel shows interactive basemap | Component test + e2e "map canvas visible" |
| 3 | Single-layer rendering of all six geometry types with default style | Style-builder unit tests + e2e on mixed-geometry dashboard |
| 4 | Popups with feature attributes (formatted via field config) | e2e click → popup content |
| 5 | Basic styling options (color, opacity, point radius, line width, fill opacity) | Unit tests + e2e option change |
| 6 | Multiple layers: layer list editor, refId binding, ordering, visibility | Unit tests on `buildLayerSpecs` + e2e multi-layer dashboard |
| 7 | Refresh behavior: in-place `setData`, viewport preservation, fit-to-data option, theme switching | Component tests + e2e refresh |
| 8 | Hardening: warnings/notices, WebGL detection, CSP docs, performance benchmark and any resulting optimization | Perf dashboard results recorded in docs |

---

## 6. Decisions needed before implementation

1. **Plugin id / organization.** Grafana requires the form `<org>-<name>-panel`, for example `yourorg-postgismap-panel`. Which org slug should be used?
2. **Minimum Grafana version.** I propose the oldest version still under Grafana's support policy at scaffold time. Do you need to support anything older?
3. **Default basemap.** Which public style should be the default, or should the default be a blank background with the URL left to the user?
4. **Layer binding model.** I propose "one layer per query refId" with optional overrides. The alternative is splitting a single query's rows into layers by a column value.
5. **License.** Apache-2.0 (matches Grafana's plugin ecosystem) or MIT?
