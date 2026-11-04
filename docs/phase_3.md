# Phase 3: Drawing Features

Status: **Implemented** (2026-11-03). See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §2.4 (engine layer), §3 (data frames to GeoJSON), §3.4 (layer binding), §5.3 (Phase 3 row).

## Goal

Draw query results on the map. A GeoFlow panel whose query returns GeoJSON geometry shows every row as a feature on the basemap. All six geometry types are supported: Point, MultiPoint, LineString, MultiLineString, Polygon and MultiPolygon. Each frame is drawn with a default style.

This phase connects the Phase 1 adapter to the Phase 2 engine. It adds:
- `setLayers` to the engine contract
- pure style builders
- keeping features through basemap and theme changes and through the off-screen release from Phase 2

Users can't change styles until Phase 5, and there's no layer editor until Phase 6. Phase 3 only gets the drawing pipeline right.

## Exit criteria

1. A panel whose query returns GeoJSON geometry draws its features on the basemap:
   - polygons filled, with an outline
   - lines as lines
   - points as circles

   Multi* geometries look the same as their single forms.
2. Each frame with geometry is drawn as its own layer, with a default color from the Grafana theme's palette, in query order (later queries on top). See decision 1.
3. Switching the basemap (including to a style URL) or the theme keeps the features. A theme change updates their colors without recreating the map.
4. New data from a dashboard refresh or a query edit replaces the features in place: the map isn't recreated and the view doesn't move.
5. A map that is released off screen and created again draws the same features.
6. Problem rows don't break drawing: no uncaught errors and no MapLibre errors in the console with the `edge_cases` fixtures. When data arrives but no frame has a geometry column, the panel says so instead of showing an empty map.
7. `src/engine/` still has no Grafana, React or Emotion imports, and the style builders and the `setLayers` diff are covered by unit tests.
8. E2E tests show that each of the six geometry types is drawn, and still drawn after a basemap switch. They check the features the map reports as drawn and compare one screenshot (Design §6). They pass locally and in CI.
9. `module.js` stays under 25 KiB; the new drawing code goes in the lazily loaded engine chunk.

## Out of scope

- Popups and hover (Phase 4).
- Style options in the panel editor (Phase 5). Phase 3's `LayerStyle` already has every field that Phase 5 will expose, filled with defaults.
- Layer editor, the `LayerBinding` option, reordering and hiding layers (Phase 6).
- Fit-to-data, skipping unchanged data on refresh, keeping the view through a refresh (Phase 7). Phase 3 replaces the data on every new frame and keeps the configured view.
- Panel notices for conversion warnings, and the performance benchmark (Phase 8). Phase 3 records a rough timing at 100k points only to find any problem early.

---

## Starting point

| Already in place | From |
|---|---|
| `framesToFeatureCollections` turns frames into `FeatureCollection`s with numeric feature ids, plus warning counts and a `noGeometry` reason per frame. | Phase 1 |
| `MapEngine` with `mount`, `setBasemap`, `setTheme`, `setView`, `resize`, events, and `destroy`. The panel creates it when on screen and passes the latest options at mount. | Phase 2 |
| The `01-adapter` dashboard: mixed geometries (`network_assets`: 9 polygons and 1 multipolygon, 14 lines and 1 multiline, 17 points and 1 multipoint), Feature and jsonb input, edge cases, and a State Plane table. | Phases 1–2 |

Two MapLibre facts shape the design:

| Finding | Consequence |
|---|---|
| `setStyle` replaces the whole style, so it drops sources and layers added by the engine. Phase 2 calls it on every basemap change. | The engine passes `transformStyle` to `setStyle` and appends its own sources and layers to the next style (Design §3). This works for inline styles and style URLs. |
| In MapLibre 6, `['geometry-type']` reports `MultiPolygon` as `Polygon`, and likewise for the other Multi* types (checked in the style spec shipped with 6.16.0). Older versions reported Multi* types separately. | Filters use the list form `['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]`, which is correct either way, as the architecture planned. |

---

## Design

### 1. Engine contract (`src/engine/types.ts`)

```ts
interface LayerSpec {
  id: string;                       // stable across refreshes; the frame's refId in Phase 3
  data: FeatureCollection<SupportedGeometry>;
  style: LayerStyle;
}

interface LayerStyle {
  color: string;                    // CSS color, already resolved from the theme
  fillOpacity: number;              // polygons
  lineWidth: number;                // lines and polygon outlines, px
  pointRadius: number;              // px
  outlineColor: string;             // point stroke, for contrast with the basemap
}

interface EngineOptions { view; basemap; theme; layers: LayerSpec[] }   // `layers` is new

interface MapEngine {
  // ...Phase 2 methods...
  setLayers(layers: LayerSpec[]): void;   // array order is drawing order, last on top
  // Test hook: e2e tests read drawn features through MapPanel's inspect event (Design §5).
  /** Waits until the map has finished drawing, then counts the distinct features drawn per layer id. */
  renderedFeatureCounts(): Promise<Record<string, number>>;
}
```

`renderedFeatureCounts` waits for MapLibre's `idle` event if the map is still loading or drawing. It then calls `queryRenderedFeatures` on the engine's own style layers and counts distinct feature ids. A feature that crosses tile boundaries comes back once per tile, so counting ids instead of results avoids double counting. It only reports what is in the current view. Nothing calls it during normal use; Design §5 describes how tests reach it.

`name`, `visible` and `popup` from the architecture's `LayerSpec` are added in the phases that need them (Phases 4 and 6). `LayerSpec` imports GeoJSON types from `src/model`, which the boundary rule allows.

### 2. Style builders (`src/engine/layerStyle.ts`, pure)

`styleLayers(spec) → LayerSpecification[]` builds four MapLibre layers per `LayerSpec`, all from one GeoJSON source:

| Layer | Type | Filter | Paint |
|---|---|---|---|
| `…:fill` | `fill` | Polygon, MultiPolygon | `fill-color` = color, `fill-opacity` = fillOpacity (default 0.35) |
| `…:outline` | `line` | Polygon, MultiPolygon | `line-color` = color, `line-width` = 1 |
| `…:line` | `line` | LineString, MultiLineString | `line-color` = color, `line-width` = lineWidth (default 2), round joins and caps |
| `…:circle` | `circle` | Point, MultiPoint | `circle-color` = color, `circle-radius` = pointRadius (default 5), `circle-stroke-color` = outlineColor, `circle-stroke-width` = 1 |

- **Ids:**
  - source: `geoflow-layer:<id>`
  - style layers: `geoflow-layer:<id>:fill`, `:outline`, `:line`, `:circle`

  The `geoflow-layer:` prefix keeps them apart from the basemap ids and from any layer in a user's style URL. A refId can contain any character, so ids are built only by string concatenation and never parsed back.
- **Order inside a layer:** fill, outline, line, circle, so points sit on lines and lines on areas.
- **Order between layers:** all four style layers of the first spec, then the next spec's, and so on.
- **Fixed for now:** the four style layers always exist, even when a frame has no geometry of that kind. Empty filters cost nothing, and a refresh that adds a new geometry type needs no structural change.
- `paintFor(spec)` returns just the paint properties, so the engine can compare styles and call `setPaintProperty` for the ones that changed.

### 3. `MapLibreEngine.setLayers`

The engine keeps the current `LayerSpec[]` and compares each new array with it by `id`:

| Change | Action |
|---|---|
| New id | `addSource` (GeoJSON) and add its four style layers |
| Id no longer present | remove its style layers and its source |
| Same id, `data` is a different object | `getSource(...).setData(data)` |
| Same id, `style` changed | `setPaintProperty` for each changed property |
| Order changed | `moveLayer` so the style layers follow the new order |
| Nothing changed | nothing |

Data is compared by reference, not by content. The panel only hands over a new object when a frame changed (Design §5); skipping identical data after a refresh is Phase 7.

**Basemap changes.** `setBasemap` calls `setStyle(style, { transformStyle })`, where `transformStyle` appends the engine's current sources and style layers to the next style. The user's data therefore always draws on top of the basemap, including above the labels in a style URL (decision 3). The same function runs for the initial style at mount, so `mount` with `options.layers` draws them as soon as the style loads.

**Before the style has loaded.** `addSource` throws until the style is loaded. A `setLayers` call that arrives before then only updates the stored array, and the `style.load` handler applies it. Phase 2 already re-applies the theme there.

**Errors.** GeoJSON parsing and tiling happen in MapLibre's worker. A feature it can't process surfaces as a map `error` event with the source id. The Phase 2 error throttle forwards those. Step 3.6 checks what the edge-case fixtures actually trigger.

### 4. Adapter: `buildLayerSpecs` (`src/adapter/buildLayerSpecs.ts`)

```ts
buildLayerSpecs(results: ConversionResult[], defaults: LayerDefaults) → LayerSpec[]

interface LayerDefaults {
  colors: string[];   // the theme palette, already resolved to CSS colors
  outlineColor: string;
}
```

- Each `ConversionResult` with a geometry field becomes one `LayerSpec`, with id = `refId` (the `perFrame` binding, decision 1).
- **Frames without a geometry field** produce no layer.
- **Frames whose features were all skipped** still get a layer. The layer is empty, so its id stays stable when a refresh brings valid rows.
- **Colors** go by position among the frames that have geometry: `colors[i % colors.length]`.
- The function is pure; the panel resolves the theme into `LayerDefaults`. That keeps Grafana's theme object out of the adapter's tests.

This is the first piece of the binding strategy in architecture §3.4. Phase 6 renames it `bindPerFrame` and adds the layer settings.

### 5. Panel (`MapPanel.tsx`)

- **Conversion:** always, not only when the summary is shown. Memoized per frame by object identity, so a frame that didn't change keeps its `FeatureCollection` object and the engine skips it.
- **Defaults from the theme:**
  - colors: Grafana's classic palette, `theme.visualization.palette`, resolved with `theme.visualization.getColorByName`
  - outline color: `theme.colors.background.primary`

  A theme change gives new colors, so `setLayers` calls `setPaintProperty`; the data isn't touched.
- **Engine calls:**
  - a new effect calls `engine.setLayers(layers)` when the layers change
  - `latest.current` includes `layers`, so a map that is created again after scrolling back draws the current data straight away
- **No geometry:** when frames arrive but none has a geometry column, show a notice over the map with the first frame's `noGeometry.detail`. For hex WKB, that detail is the existing "wrap it in ST_AsGeoJSON" hint. The map stays visible.
- **No data at all** (no queries): the basemap alone, as in Phase 2.
- **Test hook:**
  1. The map container listens for a `geoflow:inspect` DOM event.
  2. On that event, it calls `engine.renderedFeatureCounts()`.
  3. It writes the result as JSON to a `data-rendered-features` attribute on the container.

  The hook costs nothing unless something sends the event, and it adds no global variables and no build-time switch. It's the only test-specific code in the panel.
- **Marking test-only code.** Every piece of code that ships in the plugin but exists only for tests starts with a `// Test hook:` comment. The comment says which tests use it and why it's needed: drawn features aren't visible in the DOM. This applies to:
  - the event listener in `MapPanel`
  - the event name and attribute name constants
  - `renderedFeatureCounts` in the engine contract and in `MapLibreEngine`

  `grep -rn "Test hook:" src/` then lists all of it. Review in step 3.8 checks that nothing test-only is unmarked.

### 6. Testing approach

| Level | What | How |
|---|---|---|
| Unit | `styleLayers`, `paintFor` | Pure: filters, ids, order, paint values from a `LayerStyle`. |
| Unit | `buildLayerSpecs` | Frames with and without geometry, all rows skipped, color cycling, stable ids. |
| Unit | `MapLibreEngine.setLayers` | The Phase 2 `FakeMap` gains `addSource`, `getSource` (with a `setData` spy), `addLayer`, `removeLayer`, `removeSource`, `moveLayer` and `isStyleLoaded`. Covers add, remove, data change, style change, reorder, the no-op case, calls before the style loads, and `transformStyle` keeping the layers through `setBasemap`. |
| Unit | `MapLibreEngine.renderedFeatureCounts` | `FakeMap` gains `queryRenderedFeatures`, `loaded` and `once('idle')`. Covers waiting for idle, counting each id once when it appears in several tiles, and grouping by layer id. |
| Component | `MapPanel` | Fake engine: `setLayers` on new data; no call when an unrelated option changes; layers passed at mount after an off-screen release; the no-geometry notice; colors change with the theme; the `geoflow:inspect` event writes `data-rendered-features`. |
| E2E | New `04-geometry` dashboard | See below. |

**Proving that features are drawn.** Features are pixels on a WebGL canvas, so the DOM can't show them. The e2e tests use the two established ways of testing a map on a canvas:

1. **Drawn-feature counts, for most tests.** A test sends `geoflow:inspect` to a panel's map and waits for `data-rendered-features`. Then it compares the counts with the fixture: for example, the MultiPolygon panel's layer drew 1 feature, and the Point panel's drew 17. This checks what MapLibre actually drew, and the results are exact, so no tolerance is needed. A shared helper in `tests/fixtures/` wraps it as `renderedFeatures(panel)`.
2. **One screenshot comparison, for how it looks.** `toHaveScreenshot` captures the canvas of the mixed-geometry panel on the `none` basemap. That covers colors, fill opacity, outlines and drawing order, which counts can't see.
   - **Kept stable:**
     - only the canvas is captured, so neither Grafana's interface nor the map's controls are in the image
     - the blank basemap has no tiles or labels
     - a small tolerance (`maxDiffPixelRatio: 0.01`) absorbs antialiasing differences
   - **Same image for all Grafana versions:** the canvas doesn't depend on Grafana's version, so the CI runs on all three Grafana versions compare against one stored image.

   The stored image lives next to the spec (`tests/geometry.spec.ts-snapshots/`). When drawing changes on purpose, as it will in Phase 5, it's regenerated with `npx playwright test --update-snapshots` and the change shows up in review as an image diff.

Both are checked in CI first (step 3.6), with the fallbacks in Risks.

---

## Steps

Work happens on a `phase-3` branch cut from `main` after PR #20 merges, with one commit per step.

### 3.1 Engine contract

Add `LayerSpec`, `LayerStyle`, `EngineOptions.layers` and `setLayers` to `src/engine/types.ts`. Add `DEFAULT_LAYER_STYLE` (fill opacity 0.35, line width 2, point radius 5) in the engine, where Phase 5 will also read it.

**Done when:** typecheck and lint pass. Until step 3.3, `MapLibreEngine.setLayers` only stores its argument.

### 3.2 Style builders

`src/engine/layerStyle.ts` with unit tests (Design §2).

**Done when:** the tests pass and the boundary rule passes.

### 3.3 `setLayers` in `MapLibreEngine`

Implement Design §3 with the extended `FakeMap` tests, including `transformStyle` for basemap changes and calls before the style loads.

**Done when:** the unit tests pass.

### 3.4 `buildLayerSpecs`

`src/adapter/buildLayerSpecs.ts` with unit tests (Design §4).

**Done when:** the tests pass.

### 3.5 Panel wiring

Implement Design §5 with component tests: per-frame memoized conversion, theme defaults, `setLayers`, layers at mount, and the no-geometry notice.

**Done when:** the component tests pass and the `01-adapter` dashboard draws its data in the dev stack in both themes.

### 3.6 Real-browser check and the two test methods

- **Problem shapes:** render every fixture in the dev stack and watch the console. Phase 1 passes degenerate shapes, such as a polygon with an empty ring, through as valid. If MapLibre rejects any of them, `parseGeometry` gets a rule that skips them as `invalid`, with an adapter test.
- **Large data:** open a panel on `service_locations_large` (100k points) and record the conversion time and the `setData` time. The formal benchmark is Phase 8; this step just records the numbers.
- **Test methods:**
  - write the `renderedFeatures` helper and one count test
  - write the screenshot test and generate its image locally
  - run both locally and in CI on the PR before writing the rest

  For the screenshot, this shows whether an image made on your machine passes in CI's environment. If it doesn't, the image is generated from CI instead (Risks).

> **Checkpoint:** if MapLibre rejects shapes the adapter accepts, or either test method isn't stable in CI, I'll stop and bring options before going on.

### 3.7 Dashboards and e2e tests

- **New dashboard `04-geometry.json`**, centered on Cary:
  - one panel per geometry type, each on the `none` basemap, with a query filtered by `GeometryType(geom)` on `network_assets`
  - one mixed panel with all types on OSM, for looking at
  - one panel with two queries (buildings and fiber cables), to check two colors and query order
- **E2E tests:**
  - each geometry type's panel reports the expected number of drawn features
  - the two-query panel reports both layers with their counts
  - switching that panel's basemap to OSM and back in the editor keeps the same counts
  - the mixed-geometry panel matches its stored screenshot
  - the edge-case panel draws its valid rows, with no MapLibre errors in the console
  - a panel without a geometry column shows the notice
- The existing summary tests on `00-smoke` and `01-adapter` stay as they are.

**Done when:** all e2e tests pass locally and in CI.

### 3.8 Docs

- **README:**
  - a "Writing queries" section: Table format, `ST_AsGeoJSON(ST_Transform(geom, 4326), 6) AS geometry`, the accepted geometry inputs, and what's skipped and why
  - the new dashboard
- **Architecture doc:**
  - the `geometry-type` finding
  - the `transformStyle` approach
  - the `LayerSpec` fields as built
- **This file:** fill in the outcome section.
- **Test-only code check:** run `grep -rn "Test hook:" src/` and compare it with the diff, so every piece of test-only code in the plugin is marked (Design §5).

---

## Risks

| Risk | Handling |
|---|---|
| The screenshot made on your machine doesn't match CI's rendering. | Step 3.6 checks this first. Fallback 1: generate the image in CI (a one-off workflow run with `--update-snapshots`, image downloaded from the run's artifacts) so it matches CI's environment, and skip the screenshot test locally. Fallback 2: drop the screenshot test. The count tests still prove that features are drawn; only the look goes unchecked until a later phase. |
| Drawn-feature counts are affected by timing, for example counting before tiles finish loading. | `renderedFeatureCounts` waits for MapLibre's `idle` event, which fires only after all tiles are loaded and drawn. The test dashboards use a view that holds every fixture feature, so none is outside the view. |
| `transformStyle` doesn't carry layers across a style URL that loads slowly or fails to load. | Unit-tested with the fake map; the e2e basemap-switch test covers the real browser. If a style URL fails, the basemap error notice from Phase 2 shows, and the features are put back by the next successful `setStyle`. |
| MapLibre rejects geometry the adapter accepts. | Found in step 3.6 against all fixtures, and fixed in the adapter, which already reports skipped rows. |
| Converting large frames on every refresh blocks the main thread. | Memoizing per frame avoids converting unchanged frames. Step 3.6 records times at 100k points; the fix, if needed (a web worker), is Phase 8 as planned. |
| Data on top of a style URL's labels hides place names. | Accepted for now (decision 3). Phase 5 or 6 can add a "below labels" option if users want it. |

## Decisions

Confirmed 2026-11-03, as proposed.

| # | Topic | Decision | Alternative considered |
|---|---|---|---|
| 1 | Which frames are drawn | **Every frame with geometry, one layer each**, colored from the palette in query order. This is `perFrame` binding without the editor, so Phase 6 adds settings to layers that already exist instead of changing what's drawn. | Only the first frame with geometry, as a literal "single layer". Simpler now, but dashboards like `01-adapter` would draw half their data until Phase 6. |
| 2 | Default colors | **One color per layer** from Grafana's classic palette (green, yellow, blue, ...), the same for all geometry types in that layer. | One color per geometry type. This would make the layers in decision 1 indistinguishable. |
| 3 | Where data is drawn | **On top of the whole basemap**, including a style URL's labels. | Below the first symbol layer of a style URL. This keeps labels readable but depends on how each style is built. |
| 4 | Initial view | **Keep Phase 2's configured view.** Fit-to-data stays in Phase 7. | Bring a one-time fit-to-data forward. New panels start at the whole world (zoom 1), where Cary's features are a dot; the dev dashboards set their view, but new users have to set it themselves until Phase 7. |
| 5 | How e2e tests prove drawing | **Drawn-feature counts from MapLibre for most tests, plus one screenshot comparison** for how it looks (Design §6). These are the established methods: MapLibre tests its own rendering against expected images, and Playwright recommends screenshot comparison for canvas content. | Screenshots only: every test would need a stored image to update whenever styles change. Or counting pixels of a color: no stored images and no test hook, but a weak check that no project uses as a standard method. |

## Outcome

All exit criteria were met locally against Grafana 13.2.4:
- 243 unit and component tests and 26 e2e tests pass
- typecheck, lint, `check:dist` and the license check pass
- the step 3.6 CI run on draft PR #21 passed, with the e2e tests (count tests and the screenshot) on Grafana 13.2.5, 13.3.0 and nightly

| # | Criterion | Result |
|---|---|---|
| 1 | Polygons filled with an outline, lines, points as circles; Multi* like their single forms | Met. One e2e count test per geometry type, plus the screenshot of the mixed panel. |
| 2 | One layer per frame with geometry, palette colors, query order | Met. The two-query e2e test reports both layers; `buildLayerSpecs` and `MapLibreEngine` unit tests cover colors and order. |
| 3 | Features survive basemap and theme changes; theme recolors without recreating the map | Met. The e2e basemap-switch test was checked to fail when the data layers are dropped from the new style. |
| 4 | New data replaces features in place, without recreating the map or moving the view | Met: `setData` for changed frames only (component and engine tests). |
| 5 | A map recreated after an off-screen release draws the same features | Met: the current layers are passed to `mount` (component test). |
| 6 | Problem rows don't break drawing; no-geometry data explains itself | Met. The edge-case e2e test feeds in degenerate shapes and checks for no errors; the no-geometry notice has an e2e test. |
| 7 | Engine boundary intact; style builders and the `setLayers` diff unit-tested | Met. |
| 8 | E2E tests: each geometry type drawn and still drawn after a basemap switch, by counts and one screenshot | Met locally and in CI. |
| 9 | `module.js` under 25 KiB | Met: 23.5 KiB (sizes below). |

### Bundle sizes (production build)

| File | Size | gzip | Change from Phase 2 |
|---|---|---|---|
| `module.js` | 23.5 KiB | 8.1 KiB | +4.3 KiB: frame conversion now always runs, plus the layer building and the style defaults |
| `maplibre.js` (engine and MapLibre CSS) | 36.9 KiB | 10.1 KiB | +2.6 KiB: drawing and the layer diff |
| `36.js` (MapLibre) | 1131 KiB | 293 KiB | none |
| Worker (`*.mjs`) | 502 KiB | 142 KiB | none |

### Differences from the plan

| Plan | Actual | Why |
|---|---|---|
| `04-geometry` dashboard in step 3.7 | Built in step 3.6 | The real-browser check of problem shapes needed it. |
| Dashboard view centered on Cary at the default zoom | Every `04-geometry` panel at zoom 13.5 | At zoom 14 the Cary fixtures span about 380 px, so smaller panels cut features off and the counts came up short. |
| Screenshot of the mixed panel's canvas | A fixed 320 × 300 px area at the canvas's center | Grafana versions can size the panel differently, and a whole-canvas screenshot then fails on size alone. The map is anchored at its center, so the central area stays the same. |
| Map errors shown as Phase 2's basemap notice | Errors from a data layer carry `EngineError.layerId` and show as "Query A: …" | Otherwise a data problem would be blamed on the basemap. |
| Edge-case test checks that the valid rows are drawn | Checks query A exactly, and that query B (degenerate shapes) drew at least its valid point | MapLibre decides which degenerate shapes it draws; the test shouldn't pin that down. |
| `renderedFeatures(panel)` sends the event and reads the result | It also scrolls the panel into view, and tests poll it with a 30 s timeout (`DRAWN`) | Grafana renders panels below the fold only when scrolled to, and the map only exists on screen. |
| Not planned | The `01-adapter` dashboard opens on the Cary fixtures | It draws data now, and at zoom 1 its features were a dot. |
| Not planned | Fixed the webpack cache's `webpack/` build dependency | Found in the CI log: without a trailing slash, webpack couldn't resolve the directory and skipped its build cache. |

### Findings for later phases

- **Degenerate shapes.** The adapter passes empty rings, two-point and unclosed rings, one-point lines and empty Multi* parts. MapLibre draws none of them except the unclosed ring, which it closes into a triangle, and reports no error. No adapter rule was needed.
- **100k points** (`service_locations_large`, measured in the dev stack): about 2.5 s from the query response until the map reports all 100,000 points drawn, with main-thread tasks of up to about 0.5 s. Usable; Phase 8 measures it properly.
- **Basemap switches copy the data.** MapLibre applies inline style changes in place, but it deep-copies the whole next style, including every GeoJSON source the `transformStyle` adds. On large data this makes a basemap switch slower. Worth measuring in Phase 8.
- **Map scale.** MapLibre's zoom levels use 512 px: at zoom *z*, one degree of longitude is 512 · 2^*z* / 360 px. Plan dashboard views with that.
- **Counting drawn features.** `queryRenderedFeatures` returns a feature once per tile it touches and once per style layer it's drawn in (a polygon's fill and outline), so counts use distinct feature ids.
- **Test-only code** is limited to `src/panel/testHook.ts`, one effect in `MapPanel` and `renderedFeatureCounts` in the engine, all marked `// Test hook:`.
