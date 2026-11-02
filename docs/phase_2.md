# Phase 2: Map Engine Skeleton and Basemap

Status: **Approved** (2026-11-02).
Architecture reference: [architecture.md](architecture.md) §1 (key decisions), §2.4 (engine layer), §4.1 (compatibility risks), §5.3 (Phase 2 row).

## Goal

Replace the placeholder panel with a real, interactive map: an OpenStreetMap basemap rendered by MapLibre GL JS that you can pan and zoom. The map runs behind the framework-neutral `MapEngine` interface in `src/engine/`.

No data is drawn yet; features arrive in Phase 3. This phase gets the hard plumbing right:
- bundling MapLibre into a Grafana plugin
- the map's lifecycle inside a Grafana panel
- theming
- failure modes
- testing a WebGL map in CI

## Exit criteria

1. A new GeoFlow panel shows an interactive OSM basemap with zoom controls and the "© OpenStreetMap contributors" attribution. It pans, zooms, resizes with the panel, and dims in dark theme.
2. The basemap can be switched in panel options between OpenStreetMap, a custom XYZ raster tile URL, a custom MapLibre style URL, and none. Changing it doesn't recreate the map.
3. The map is created once per panel, updated in place, and destroyed on unmount. A dashboard with 20 GeoFlow panels loads, scrolls and closes without WebGL context errors.
4. A browser without WebGL2 shows a clear message in the panel, not a blank panel or an uncaught error.
5. `src/engine/` has no `@grafana/*`, React or Emotion imports; the lint boundary rule passes.
6. MapLibre loads lazily: it isn't part of the initial `module.js` chunk.
7. `dist/` contains only expected files: no test fixtures. A `check:dist` script fails the build on anything unexpected.
8. `dist/` includes the third-party license notices that MapLibre's BSD-3-Clause license requires.
9. Unit, component and e2e tests pass locally and in CI. The e2e tests make no requests to `tile.openstreetmap.org`.
10. The panel works with Grafana's Content Security Policy enabled, and the required directives are documented.

## Out of scope

- Drawing features (Phase 3), popups (Phase 4), styling options (Phase 5), multiple layers (Phase 6).
- Fit-to-data and saving the map view (Phase 7). Phase 2 uses a configured initial view only.
- Vector-tile basemaps beyond accepting a style URL: no bundled vector style, glyphs or sprites.

---

## What Phase 2 has to work around

Inspecting `maplibre-gl@6.16.0` (BSD-3-Clause, released 2026-10-25) found three things that shape this plan:

| Finding | Consequence |
|---|---|
| MapLibre 6 is ESM-only: `"type": "module"`, `import`-only `exports`, no CommonJS build. | Webpack bundles it fine. Jest can't load it without extra transform config, so unit and component tests mock it instead (Design §6). |
| The worker is a separate file, `dist/maplibre-gl-worker.mjs` (0.5 MB, no imports). MapLibre finds it relative to its own `import.meta.url`, or at the URL given to `setWorkerUrl()`. A same-origin worker starts as a module worker; a cross-origin one falls back to a `blob:` URL. | Webpack rewrites `import.meta.url` at build time, so the default lookup fails inside a plugin bundle. The plugin must ship the worker file and call `setWorkerUrl()` with its served URL (`public/plugins/jdejesusio-geoflow-panel/…`). Since that URL is same-origin, no `blob:` worker is needed, which matters for CSP. |
| The minified build carries only a one-line license banner that links to the BSD-3 text. | BSD-3 requires the copyright notice and license text in binary distributions. The plugin ships a `THIRD_PARTY_NOTICES.txt` in `dist/` (step 2.7). |

Phase 0's scaffold also copies every `src/**/*.json` into `dist/`. That means the Phase 1 test fixtures (`src/adapter/__fixtures__/*.json`) currently ship in the plugin. Step 2.1 fixes that.

---

## Design

### 1. Engine contract (`src/engine/types.ts`)

This is the Phase 2 subset of architecture §2.4. `setLayers`, `fitToData` and `featureClick` arrive with the phases that need them.

```ts
interface MapEngine {
  mount(container: HTMLElement, options: EngineOptions): Promise<void>; // rejects with WebGLUnavailableError
  setBasemap(basemap: BasemapSpec): void;
  setTheme(theme: EngineTheme): void;
  setView(view: ViewState): void;
  resize(): void;
  on(event: 'viewChange', listener: (view: ViewState) => void): () => void;
  on(event: 'error', listener: (error: EngineError) => void): () => void;
  destroy(): void;
}

type BasemapSpec =
  | { kind: 'osm' }
  | { kind: 'raster'; tiles: string[]; attribution: string; maxZoom?: number }
  | { kind: 'style'; url: string }
  | { kind: 'none' };

interface ViewState { center: [lon: number, lat: number]; zoom: number }
interface EngineTheme { dark: boolean; background: string } // plain values, never a Grafana theme object
```

`mount` is async because MapLibre is loaded with a dynamic `import()` (Design §4).

### 2. Basemap styles (`src/engine/basemapStyle.ts`, pure)

`basemapStyle(spec, theme) → StyleSpecification`:

| Kind | Style |
|---|---|
| `osm` | Inline style. A `raster` source with `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `tileSize: 256`, `maxzoom: 19` and attribution `© OpenStreetMap contributors` (linked to the OSM copyright page), plus a `background` layer and a `raster` layer. |
| `raster` | Same shape with the user's tile URLs, attribution and max zoom. |
| `style` | Passed to MapLibre as the URL. The user's style controls everything, and theme dimming doesn't apply. |
| `none` | A single `background` layer in the theme's background color. |

**Dark theme**, for raster kinds only, sets the raster layer's paint properties: `raster-brightness-max: 0.75`, `raster-saturation: -0.4`, `raster-contrast: 0.1`. The exact values are tuned by eye in step 2.4. Switching themes calls `setPaintProperty`, which doesn't reload the style.

### 3. `MapLibreEngine` (`src/engine/maplibre/MapLibreEngine.ts`)

- **On first mount:**
  - `setWorkerUrl(workerUrl)` is called once per page.
  - The worker URL comes from `new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url)`, which makes webpack emit the worker as an asset and resolve its served URL.
  - The step 2.2 spike confirms this; the fallback is copying the file with a root webpack config extension and building the URL from webpack's public path.
- **Creating the map:**
  - `new Map({ container, style, center, zoom, attributionControl: { compact: true } })`
  - a `NavigationControl` (zoom buttons and compass)
  - `dragRotate` and `pitchWithRotate` turned off, since a 2D asset map doesn't need rotation
- **WebGL2:** before creating the map, probe `canvas.getContext('webgl2')`. If it fails, reject with `WebGLUnavailableError` instead of letting MapLibre throw from inside its constructor.
- **Methods:**
  - `setBasemap` calls `setStyle` and keeps the camera. In Phase 3, user layers are carried across with `transformStyle`.
  - `setView` calls `jumpTo`.
  - `resize` calls `map.resize()`.
  - `destroy` calls `map.remove()` and drops the listeners.
- **Events:**
  - `viewChange` fires on `moveend` with `{ center, zoom }`.
  - `error` forwards MapLibre `error` events, such as tile load failures, at most once per source per 10 s, so a flaky tile server can't flood the panel.
- **CSS:** MapLibre's CSS is imported by the engine's lazily loaded module, so it is only injected once a map exists. Any overrides are scoped under the panel's container class.

### 4. Lazy loading

`src/engine/index.ts` exports `createMapEngine(): Promise<MapEngine>`, which does `await import('./maplibre/MapLibreEngine')`.
- Webpack splits MapLibre, its CSS and the engine into a separate chunk.
- Opening the panel picker or a dashboard without GeoFlow panels doesn't download MapLibre.
- Only `createMapEngine` and the types are imported eagerly.

The scaffold's webpack output already sets the plugin `publicPath`, so chunks load from `public/plugins/jdejesusio-geoflow-panel/`. The spike checks this.

### 5. Panel (`src/panel/`)

**Options** (`options.ts`, built in `module.ts`):

| Option | Type | Default |
|---|---|---|
| Basemap | radio: OpenStreetMap / Custom tiles / Style URL / None | OpenStreetMap |
| Tile URL template | text, shown for Custom tiles | — |
| Tile attribution | text, shown for Custom tiles | — |
| Style URL | text, shown for Style URL | — |
| Initial view: latitude, longitude, zoom | numbers | 20, 0, 1 (whole world) |
| Show data summary | switch | off |

**`MapPanel`:**
- A container `div` with a `ref`.
- **One-time setup:** `createMapEngine()` and `mount()` run once in a `useEffect`, with cleanup that calls `destroy()`. If the panel unmounts before the async mount finishes, the cleanup still destroys the engine.
- **Updates:** separate effects call `setBasemap` (basemap options), `setTheme` (`useTheme2().isDark`), `resize` (width and height) and `setView` (initial view options).
- **Panel options never recreate the map.**
- **WebGL error:** shows a short message ("This panel needs WebGL2, which isn't available in this browser") instead of the map.
- **Data summary:** the Phase 1 adapter summary moves into a small overlay in the top-left corner, shown when "Show data summary" is on. The existing smoke and adapter dashboards turn it on, so their e2e tests keep working. It also becomes a useful debugging view.
- **Option mapping:** `basemapFromOptions(options) → BasemapSpec` is a pure function. Invalid input, such as an empty tile URL or a URL missing `{z}/{x}/{y}`, falls back to `none` with a hint in the options pane, never a broken style.

### 6. Testing approach

| Level | What | How |
|---|---|---|
| Unit | `basemapStyle`, `basemapFromOptions` | Pure functions, no WebGL. |
| Unit | `MapLibreEngine` | `jest.mock('maplibre-gl')` with a fake `Map` that records calls: mount options, `setWorkerUrl` called once across two engines, `setStyle` on basemap change, `setPaintProperty` on theme change, `remove` on destroy, the WebGL2 probe failure path, error throttling. |
| Component | `MapPanel` | `createMapEngine` mocked to return a fake engine. Checks mount once, resize on size change, `setBasemap` without remount on option change, destroy on unmount, destroy when unmounted before mount resolves, the WebGL message, and the summary overlay toggle. |
| E2E | `02-basemap` dashboard plus existing dashboards | Map canvas visible, OSM attribution shown, zoom control changes the zoom, basemap switch in the panel editor, the existing summary tests via the overlay. Tile requests are intercepted with `page.route` and answered with a local PNG, so CI never contacts OSM (their tile policy forbids automated traffic). |

Headless Chromium needs WebGL2 for the e2e tests. Playwright's Chromium usually provides it through SwiftShader, but that isn't guaranteed on CI runners. The spike (step 2.2) checks both locally and in CI, and adds `--use-angle=swiftshader` launch arguments in `playwright.config.ts` if needed.

---

## Steps

Work happens on a `phase-2` branch cut from `main`, with one commit per step.

### 2.1 Stop shipping test fixtures

- Change `scripts/capture-frames.mjs` to write each fixture as a TypeScript module (`buildings.ts` with `export default { … }`) instead of `.json`. The scaffold copies `src/**/*.json` into `dist/`, but not `.ts` files that aren't imported.
- Regenerate the fixtures and update the loader. Tests stay as they are.
- Add `scripts/check-dist.mjs`, which compares `dist/` against an allowlist (`module.js`, chunks, the worker, `plugin.json`, docs, images, license files) and fails on anything else. Add it as `npm run check:dist` and to CI after the build.

**Done when:** `dist/` has no `adapter/` directory, `check:dist` passes, and it fails if a stray JSON file is put back.

### 2.2 Spike: MapLibre in the plugin bundle

This step is a time-boxed check of the risky assumptions before building on them:
- `npm install maplibre-gl` (6.x).
- A throwaway panel renders a bare OSM map via a dynamic `import()`.
- Confirm:
  1. webpack bundles the ESM build into a separate chunk
  2. the CSS loads
  3. the worker is emitted, `setWorkerUrl` points at its served URL, and tiles render (the worker is doing its job)
  4. headless Chromium renders WebGL2 locally
  5. the same in GitHub Actions, via a draft PR
  6. the license check passes with MapLibre's dependency tree
- Record `module.js` and chunk sizes.

> **Checkpoint:** review the spike findings before step 2.3. If an assumption fails, for example no WebGL2 in CI, I'll bring options rather than work around it silently.

### 2.3 Engine contract and basemap styles

`src/engine/types.ts`, `basemapStyle.ts` and `WebGLUnavailableError`, with unit tests.

**Done when:** the tests pass and the boundary rule passes.

### 2.4 `MapLibreEngine`

Implement Design §3 with the mocked-MapLibre unit tests, then tune the dark-theme raster values by eye in Grafana.

**Done when:** the unit tests pass and a manual check in both themes looks right.

### 2.5 Lazy engine factory

`createMapEngine()` and the chunk split.

**Done when:** the build shows MapLibre in a separate chunk and the initial `module.js` stays small. I'll record the sizes.

### 2.6 Panel options and `MapPanel`

Implement Design §5, including the summary overlay and the WebGL message, with component tests.

**Done when:** the component tests pass and the panel works in the dev stack in both themes.

### 2.7 Third-party notices

- Add a root `webpack.config.ts` that extends the scaffold config with webpack-merge (Grafana's documented extension mechanism), and point the `build` and `dev` scripts at it.
- Use it to copy `THIRD_PARTY_NOTICES.txt` into `dist/`. The file holds the MapLibre BSD-3-Clause license text and the licenses of any bundled MapLibre dependencies that require attribution (generated with the license checker, filtered to bundled packages).
- If step 2.2 shows the worker needs copying, the same extension handles that.
- Update `NOTICE` with MapLibre and the OpenStreetMap attribution.

**Done when:** `dist/THIRD_PARTY_NOTICES.txt` exists with the MapLibre license, and `check:dist` allows it.

### 2.8 E2E tests and dashboards

- **New dashboard:** `02-basemap.json`, with an OSM panel centered on the Cary fixture area, a "None" basemap panel, and a dark-theme check via the `theme` URL parameter.
- **Existing dashboards:** `00-smoke` and `01-adapter` turn on "Show data summary".
- **Tile stubbing:** `tests/fixtures/tile.png`, plus a shared helper that routes `tile.openstreetmap.org` to it.
- **Lifecycle test:** a dashboard with 20 GeoFlow panels (`03-many-panels.json`) scrolled top to bottom, checking for no `WebGL` errors in the console.

**Done when:** all e2e tests pass locally and in CI, and a request log shows no OSM traffic.

### 2.9 CSP and docs

- Run the stack with `GF_SECURITY_CONTENT_SECURITY_POLICY=true` and Grafana's default CSP template, and confirm the map and its worker load. Record any directive that has to be added; the expectation is none, given a same-origin module worker.
- Update the README (basemap options, OSM tile policy, CSP), the architecture doc (MapLibre 6 worker and packaging; ESM-only), and this file's outcome section.

---

## Risks

| Risk | Handling |
|---|---|
| No WebGL2 in headless Chromium on CI runners. | Checked in the spike, first locally and then in CI. Fallbacks: SwiftShader launch flags, or a non-headless Chromium under `xvfb-run`. |
| Webpack mishandles MapLibre 6's ESM or worker URL. | The spike tests it before any engine code is written. The fallback is copying the worker via the root webpack extension (step 2.7). |
| Async mount races with fast unmounts (panel edit, scrolling dashboards). | The engine tracks a `destroyed` flag; cleanup always runs. A component test covers it, and the many-panels e2e test covers the real browser. |
| OSM tile policy (heavy use, automated traffic). | Normal interactive use is within policy. E2E tests stub tiles. The README tells production users to configure their own tile server. |
| Bundle size grows by about 1.6 MB (main chunk plus worker). | Lazy loading keeps it out of the initial plugin load. The sizes are recorded, and the Bundle Stats workflow reports changes on every PR. |
| A future `create-plugin update` changes the webpack config the root extension merges into. | The extension stays minimal (copying notices and possibly the worker), and `check:dist` catches packaging regressions. |

## Decisions

Confirmed 2026-11-02.

| Topic | Decision |
|---|---|
| Loading MapLibre | Lazy-loaded with a dynamic `import()`, keeping about 1.6 MB out of the plugin's initial load; `mount` is async. |
| Default initial view | The whole world at zoom 1 (lat 20, lon 0). The dev dashboards set their view to Cary. |
| Phase 1 data summary | Kept as an optional overlay, off by default. The existing dashboards turn it on for e2e coverage. |
| Basemap kinds | All four now: OSM, custom XYZ tiles, style URL, none. |
| Rotation and pitch | Turned off; maps stay north-up. Can become options later. |
