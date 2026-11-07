# Phase 8: Refresh, view and theme

Status: **Approved** (2026-11-06). Decisions 1–10 accepted as proposed.
Architecture reference: [architecture.md](architecture.md) §2.2 (panel), §2.4 (engine contract, `fitToData`), §4.2 (redundant work on refresh), §5.3 (Phase 8 row).

## Goal

Make a dashboard that refreshes every 30 seconds feel steady, and make the map's view easy to set.

Some of the Phase 8 row is already in place. Phase 3 updates layers in place with `setData`, and Phase 5 skips frames whose data arrays Grafana didn't replace. The panel already keeps the user's view across refreshes, since only a change to the configured view moves the map. Phase 4 follows a pinned feature through a refresh by its key, and Phase 2 dims raster tiles in dark theme.

What's left, and what this phase adds:
- **Unchanged refreshes cost nothing.** A refresh brings new data arrays even when nothing changed, so today every layer is converted again, its `setData` reloads its tiles, and a hover tooltip closes. With 100k points, that's about 2.5 s of work every refresh (§4.2).
- **Fit to data.** A **View** mode that frames the data, once when the panel loads or again on every refresh. New panels start there, rather than on the whole world, where a town's features are a dot (Phase 3, decision 4).
- **Use current view.** A button that saves the map's current view as the panel's view. Today, setting a view means typing a latitude, longitude and zoom.
- **A dark basemap.** An optional dark theme URL for raster and style basemaps, used while Grafana's theme is dark. Phase 12's presets build on it.

## Exit criteria

1. **Unchanged refresh.** A refresh that returns the same data as before neither converts it again nor calls `setData`, for every layer. A hover tooltip stays open, and the highlights stay. On 100k points with the GPU, such a refresh causes no main-thread task over 200 ms.
2. **Changed refresh.** A refresh with changed data updates only the layers whose data changed. A pinned tooltip follows its feature by key, as in Phase 4.
3. **View kept.** After the user pans or zooms, a refresh, an option change and scrolling the panel off screen and back don't move the map, unless the view mode says to (criterion 5).
4. **Fit to data.** With **View mode: Fit to data**, the map frames every visible layer's features when the panel loads, with the padding and the maximum zoom set in the options. Without data, it shows the fixed view.
5. **Fit on refresh.** With **Fit on refresh** on, every query response frames the data again. With it off, only loading the panel or changing a fit setting does.
6. **New and saved panels.** A new panel starts in **Fit to data**. A panel saved before Phase 8 keeps its fixed view: the earlier screenshots don't change.
7. **Use current view.** In the panel editor, **Use current view** sets the latitude, longitude and zoom to the map's view, and switches the mode to Fixed.
8. **Dark basemap.** A raster or style basemap with a **Dark theme URL** uses it while Grafana's theme is dark, without dimming, and switches back in light theme. Data layers and the view survive the switch. Without a dark URL, behavior is as now.
9. **Engine boundary.** The engine gets bounds and fit settings, never Grafana objects.
10. **Tests.** Unit, component and e2e tests pass locally and in CI.

## Out of scope

- **Basemap presets** (Phase 12): this phase adds the dark URL they'll use.
- **Sharing a view between panels**, as Geomap's **Share view** does: a cross-panel channel of its own.
- **Saving a viewer's view** in the URL or the dashboard without editing the panel.
- **Fit to one layer**, as Geomap allows: all visible layers for now (decision 4).
- **A layer switcher on the map** ([architecture.md §7](architecture.md#7-features-considered-for-later)).
- **Moving conversion to a web worker** (Phase 9, if its benchmark calls for it).

---

## Starting point

| Already in place | From |
|---|---|
| `setLayers` diffs by layer id and calls `setData` only when the spec's `data` object changes. | Phase 3 |
| `convertFrames` caches conversions by the frame's `values` arrays, so style changes reuse them. A refresh brings new arrays, so it converts again. | Phase 5 |
| The map keeps its view until the configured view changes. A map recreated after scrolling starts from the user's last view. | Phases 2, 3 |
| A pinned tooltip follows its feature through new data by its key (the `id` column); a hover tooltip closes on any new results. | Phase 4 |
| In dark theme, raster basemaps are dimmed with paint properties; style basemaps are left as they are. | Phase 2 |
| A basemap change keeps the camera and the data layers (`transformStyle`), and closes a pinned tooltip. | Phases 3, 4 |

**What Grafana offers** (to confirm in step 8.1):

| Need | Available |
|---|---|
| Telling a query response from an option change | `PanelData.request.requestId` changes with each query run; field config changes reuse it. |
| An option editor reaching the panel's map | `StandardEditorContext.eventBus`, if it's the panel's own `PanelProps.eventBus`. Grafana's Geomap uses an internal instance state that isn't in the public `PanelProps`. |
| Saving options from the editor | The editor's `onChange` for its own value; `context.options` to read the others. |
| Keeping saved panels on a fixed view while new ones fit | `setMigrationHandler`, which runs when a panel's saved `pluginVersion` differs from the plugin's. |
| Framing bounds in MapLibre | `map.fitBounds(bounds, { padding, maxZoom, animate: false })`, usable right after the map is created. |

### Changes to the architecture

- **§2.4:** `fitToData(padding?)` becomes `fitBounds(bounds, { padding, maxZoom })`. The panel computes the bounds from the conversions it already has, and the engine doesn't keep data bounds of its own. This lets the panel choose which layers count (decision 4).
- **§2.2:** a theme change switches to the dark basemap URL when one is set, as described there. The new view options and **Use current view** are added.
- **§4.2:** unchanged refreshes are detected by comparing values with the previous data for the same layer, not by a hash (decision 1).

---

## Design

### 1. Unchanged refreshes (`src/panel/convertFrames.ts`)

A refresh gives every frame new `values` arrays. Phase 5's cache misses, so the frame is converted again, and the new FeatureCollection makes the engine call `setData`.

The cache gets a second lookup, by layer id. It keeps the last conversion for each layer, with the arrays it came from. When the `values` lookup misses, the frame is compared with that layer's last data:
- same field names, types and lengths
- the same values, compared element by element

If they match, the old result is returned. Its FeatureCollection is the same object, so `setLayers` skips `setData`, and the result is re-keyed on the new arrays.

Comparing 100k rows of text is fast next to `JSON.parse` on them: it touches each value once and allocates nothing. It's measured in step 8.1 (decision 1).

The cache keeps at most one previous conversion per layer id, so memory doesn't grow with refreshes. Results for layers that are gone are dropped on the next call.

**Hover across a refresh:** the hover tooltip closes when `results` is a new array (Phase 4). It's compared by element instead, so an unchanged refresh keeps it.

### 2. View options (`src/panel/options.ts`, `module.ts`)

```ts
interface GeoFlowOptions {
  // ...Phase 7 options...
  view: {
    /** Default 'fit' for new panels; panels saved before Phase 8 are migrated to 'fixed'. */
    mode: 'fixed' | 'fit';
    lat: number;
    lon: number;
    zoom: number;
    /** Fit only: fit again on every query response. Default false. */
    fitOnRefresh?: boolean;
    /** Fit only: px around the data. Default 40. */
    padding?: number;
    /** Fit only: the closest a fit zooms in, so a single point doesn't fill the map. Default 17. */
    maxZoom?: number;
  };
}
```

The **View** group:
- **View mode** (Fixed / Fit to data)
- for Fixed: **Latitude**, **Longitude** and **Zoom**
- for Fit to data: **Fit on refresh**, **Padding** and **Max zoom**. The fixed view is still saved, and used when there's no data to fit.
- **Use current view** (§4), in both modes

**Migration** (decision 6): `setMigrationHandler` sets `view.mode: 'fixed'` on panels saved without a mode. The plugin version goes from 0.1.0 to 0.2.0, so Grafana runs the handler on panels saved before. Step 8.1 checks the order in which Grafana applies the handler and option defaults.

### 3. Fitting (`src/adapter`, `MapPanel`, engine)

- **Bounds:** `frameToFeatureCollection` records each result's `bounds`, `[west, south, east, north]`, while it reads the coordinates. It costs no extra pass, and is cached with the result. Geometries crossing the antimeridian aren't unwrapped (§4.1).
- **Which layers:** `fitBounds` of the layers drawn, the visible ones with geometry (decision 4).
- **When the panel fits:**
  - **On load:** the first data with geometry after the panel mounts. In the panel editor, that's when the editor opens.
  - **On refresh**, when **Fit on refresh** is on: every new `requestId` with geometry.
  - **When a fit setting changes:** the mode, padding or max zoom.

  Hiding a layer, changing a style or scrolling back on screen doesn't refit (decision 3).
- **Engine:** `fitBounds(bounds, { padding, maxZoom })` calls MapLibre's `fitBounds` without animation. A map recreated after scrolling starts at the user's last view, as now. The fit is done when the engine is ready, not before, so a panel that scrolls on screen later still fits on its first data.
- **Single point:** zero-size bounds give `maxZoom`, centered on it.

### 4. Use current view (`src/panel/ViewEditor.tsx`, new)

A custom editor in the View group, with a button and a line showing the map's current view: "35.7835, −78.7845 · zoom 16.5".

On click, it saves the map's view as **Latitude**, **Longitude** and **Zoom**, rounded to 5 decimals and 1 decimal, and sets **View mode** to Fixed (decision 7).

**Reaching the map** (decision 8):
- The panel publishes its current view on its `eventBus` as it changes, as a GeoFlow event.
- The editor subscribes through `context.eventBus` and saves through `onChange`.

Step 8.1 checks that the editor's `eventBus` is the panel's own. If it isn't, the fallback is a module-level map of the views of mounted panels, keyed by panel id. Grafana's panel editor renders one panel at a time.

### 5. Dark basemap (`options.ts`, `basemapFromOptions`, engine)

- **Dark theme tile URL** (raster) and **Dark theme style URL** (style): optional, validated like the light ones.
- `basemapFromOptions(basemap, dark)` returns the dark spec while the theme is dark and a dark URL is set. The panel passes `theme.isDark`.
- The engine's existing `setBasemap` switches styles and keeps the camera and the data layers.
- `BasemapSpec` for raster gains `dimInDark?: boolean`. It's false for a dark URL, which is already dark, and true for the light one and OSM, as now.
- **A pinned tooltip** closes on the switch, as on any basemap change (Phase 4). A style reload drops feature-state, and with it the highlight. Theme changes are rare (decision 9).

### 6. Testing approach

**Unit tests:**
- `convertFrames`: same data in new arrays returns the same result. Changes in one value, a type, a field name or the length convert again. One previous conversion is kept per layer, and gone layers are dropped.
- bounds: points, lines, polygons, multi-geometries, skipped rows, empty layers.
- `fitBounds` in the engine: padding, max zoom, zero-size bounds.
- `basemapFromOptions` with a dark URL; the migration handler.

**Component tests (`MapPanel`):**
- an unchanged refresh keeps the hover and doesn't call `setData`
- fit on load, on a new `requestId` with Fit on refresh on, and not on a style change or a hidden layer
- the dark basemap follows the theme
- the view editor saves the published view

**E2E (`09-refresh.json`, `tests/refresh.spec.ts`):**
- **Fit to data:** a panel in Fit to data frames all its features (rendered feature counts, stored screenshot).
- **Moving data:** a "vehicle" query whose point moves with `now()`. With Fit on refresh, it stays framed after a refresh. Without it, a refresh keeps the user's panned view.
- **Unchanged refresh:** a hovered feature's tooltip stays open through a refresh.
- **Use current view:** in the panel editor, after zooming in, the button fills in the view, and the saved options show it.
- **Dark basemap:** a dark tile URL on the stub tile host is requested with `?theme=dark` and not in light theme.
- **Saved panels:** the Phase 3, 5, 6 and 7 screenshots still match.

---

## Steps

Each step is one commit, tested before the next.

### 8.1 Checks on Grafana 13.2 and MapLibre

- **`requestId`:** whether it changes on a refresh and a time range change, and stays the same on field config and option changes.
- **Option editors:** whether `context.eventBus` in an option editor is the panel's `eventBus`, in the panel editor of Grafana 13.2 and 13.3.
- **Migration:** whether `setMigrationHandler` runs before option defaults are applied, on a provisioned dashboard saved with `pluginVersion` 0.1.0.
- **Refresh data:** whether a refresh with unchanged data brings new `values` arrays for every field.
- **Cost:** comparing 100k rows against converting them, on this machine.
- **MapLibre `fitBounds`:** before the style loads, and right after mount.

### 8.2 Unchanged refreshes

The layer-id cache in `convertFrames` and the hover comparison. Unit and component tests.

### 8.3 Fit to data

Bounds in the conversion, the engine's `fitBounds`, the view options, the migration, and when the panel fits. Unit and component tests.

### 8.4 Use current view

`ViewEditor` and the view events. Component tests; check the options pane on 13.2.

### 8.5 Dark basemap

The dark URL options, `basemapFromOptions` and `dimInDark`. Unit and component tests.

### 8.6 Dashboard and e2e tests

`09-refresh.json` with the moving vehicle query, and `tests/refresh.spec.ts`.

### 8.7 Docs

- README: **View** and the dark basemap; the dashboard
- architecture.md: §2.2, §2.4 (`fitBounds`), §4.2 (unchanged refreshes as built)
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| Comparing values is slower than expected for wide frames or long geometry strings. | Measured in step 8.1. A string is compared only when the two strings' lengths match, and the first difference ends the comparison. If it's still too slow, a hash computed while converting replaces it. |
| The migration handler doesn't run, or runs after defaults are applied, so saved panels would start fitting. | Checked in step 8.1. The fallback is no default mode: a missing mode means Fixed, and new panels get Fit to data from the panel's default options. |
| The editor's `eventBus` isn't the panel's. | The module-level fallback (Design §4). |
| Fit on refresh fights the user: every refresh undoes their panning. | It's off by default, and its description says so. That's the point of it on a wall display. |
| A fit on load in the panel editor moves the map while someone is choosing a view. | Only the first data with geometry and changes to fit settings fit. Use current view switches the mode to Fixed. |
| A dark style URL from another host needs CORS and CSP like the light one. | Same as the light URL; Phase 9's CSP docs cover both. |

---

## Decisions

Accepted as proposed (2026-11-06):

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Detecting unchanged data | **Compare values with the layer's previous data**, element by element. It's exact, needs no hashing step, and stops at the first difference. | A content hash per frame: one more full pass on every refresh, and a collision is possible. |
| 2 | View modes | **Fixed and Fit to data**, with the fixed view kept as the fallback. | Geomap's longer list (fit, coordinates, a named region, share view): only the two common ones for now. |
| 3 | When a fit happens | **On load, on fit settings changes, and on every query response when Fit on refresh is on.** Style changes, hiding a layer and scrolling don't refit. | Fit when the data's bounds change: a moving vehicle refits, but a panned map with static data never comes back. |
| 4 | Which layers count | **The visible layers with geometry.** | A layer picker, as in Geomap: rarely needed, and it can be added later. |
| 5 | Fit settings | **Padding (default 40 px) and Max zoom (default 17).** | No max zoom: a single point would fit at zoom 22. |
| 6 | Default for new panels | **Fit to data for new panels, Fixed for saved ones**, through a migration handler and a version bump to 0.2.0. | Fixed for all: new panels keep starting on the whole world. |
| 7 | Use current view | **Saves the latitude, longitude and zoom, and switches to Fixed.** | Saves the view and leaves the mode: a Fit to data panel would ignore the view it just saved. |
| 8 | How the editor reaches the map | **Events on the panel's `eventBus`**, if step 8.1 confirms it's shared; a module-level map otherwise. | Grafana's internal instance state, as Geomap uses: not in the public API. |
| 9 | Dark basemap | **A dark URL for raster and style basemaps**, without dimming. A pinned tooltip closes on the switch, as on any basemap change. | Dimming only, as now: a dark style can't be configured. Or keeping the pinned tooltip: needs feature-state restored after a style reload. |
| 10 | E2E checks | **A moving point from `now()`, stored screenshots for fits, and the stub tile host's requests for the dark URL**, as in Phases 2 and 7. | Reading the map's view through a new test hook: one more test-only path in `src/`. |
