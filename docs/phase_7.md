# Phase 7: Multiple layers

Status: **Implemented** (2026-11-06). Decisions 1–11 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §2.2 (`LayersEditor`), §2.4 (`LayerSpec`), §3.2 (geometry field resolution), §3.4 (layer binding modes), §5.3 (Phase 7 row).

## Goal

Make a panel with several queries work as a map of layers: buildings at the bottom, cables over them, patch panels on top. Each layer has a name and can be hidden or moved up or down. Its geometry and id columns can be chosen when detection picks the wrong ones.

Since Phase 3, every query has been a layer, named "Query A", drawn in query order, with its columns detected. Since Phase 5, each layer's style comes from field config. This phase adds:
- a **Layers** list in the panel options, one row per query, for the settings that aren't style
- layer **names**, used in tooltips, the legend and the data summary
- drawing **order** and **visibility**, applied without reloading data
- a **Tooltips** switch per layer, for background layers such as building footprints
- the **geometry column** and **id column** of each layer
- a layer for **each frame** of a query that returns several, such as one split by Grafana's **Partition by values** transformation
- the `layerBinding` option, saved as `perFrame` (§3.4), so Phase 11 can add `byColumn` without a migration. Layer settings are keyed by layer id, which Phase 11's per-value layers will share

## Exit criteria

1. **Layers list.** A **Layers** group in the panel options lists one row per query, top row drawn on top. Each row shows the layer's name and query, and whether the query returned geometry.
2. **Names.** A layer's name appears in its tooltips, its legend entry and the data summary. Without one, it's the frame's name or "Query A", as now.
3. **Order.** Moving a layer up or down restacks the map without reloading data. Tooltips for overlapping features still list the topmost first.
4. **Visibility.** A hidden layer isn't drawn, can't be hovered or clicked, and has no legend entry. A tooltip pinned on it closes. Showing it again doesn't reload its data. On 100k points with the GPU, showing or hiding a layer causes no main-thread task over 200 ms.
5. **Tooltips per layer.** With **Tooltips** off, a layer is drawn but its features can't be hovered or clicked. Features of layers below it can.
6. **Geometry column.** A layer's **Geometry column** picks one of its query's columns. Without one, it's detected as now (§3.2). A named column that the query no longer returns is reported in the panel, not replaced by detection.
7. **Id column.** A layer's **ID column** picks the column its feature ids and keys come from, by the rules of §3.3. Without one, it's a column named `id`, as now.
8. **Saved dashboards unchanged.** A dashboard saved before Phase 7 draws exactly as in Phase 6: the Phase 3, 5 and 6 screenshots don't change. Moving or hiding a layer doesn't change other layers' palette colors.
9. **Several frames per query.** When a query returns several frames, each becomes its own layer with its own id, named after its frame. Today they share the query's refId as their id, so they clash. A query with one frame keeps its refId as its layer id.
10. **Layer binding.** Panels save `layerBinding: { mode: 'perFrame' }`, and layer settings are keyed by layer id, not refId. The editor doesn't show the binding yet (decision 8).
11. **Engine boundary.** The engine gets names, visibility and order in `LayerSpec`s, never Grafana objects.
12. **Tests.** Unit, component and e2e tests pass locally and in CI.

## Out of scope

- **`byColumn` layers** (Phase 11).
- **A layer switcher on the map**, for viewers to show and hide layers without editing the panel (decision 5). Proposed for [architecture.md §7](architecture.md#7-features-considered-for-later).
- **Style in the layer list.** Style stays in field config, per query through overrides (Phase 5, decision 1). The list doesn't repeat it.
- **Per-layer tooltip fields** beyond what's there: **Hide in tooltip** in a **Fields returned by query** override already chooses them per layer (Phase 4).
- **Zoom ranges per layer** (show a layer only from zoom 14): see [architecture.md §7](architecture.md#7-features-considered-for-later).
- **Layer groups.**
- **Refresh behavior** (keeping the view and pinned tooltips across a refresh): Phase 8.

---

## Starting point

| Already in place | From |
|---|---|
| One layer per frame with geometry, id = refId, in query order: later queries on top (`buildLayerSpecs`). Two frames from one query get the same id. | Phase 3 |
| `setLayers` restacks the map when the specs' order changes, with `moveLayer`, without touching sources. | Phase 3 |
| `frameToFeatureCollection(frame, { geometryField, idField })` takes explicit columns, and reports a named geometry column that's missing (`fieldNotFound`) rather than detecting another. Nothing passes them yet. | Phase 1 |
| `LayerSpec.interactive` turns hit testing on or off per layer; today the Tooltip option sets it for all. | Phase 4 |
| Tooltip titles, legend titles and the data summary name a layer by its frame name or "Query A", each in its own code. | Phases 4, 6 |
| The conversion is cached on the frame's `values` arrays (`convertFrames`). | Phase 5 |
| Classic palette colors go by position among the layers with geometry; By name hashes the frame name or refId. | Phase 5 |

**What Grafana offers** (to confirm in step 7.1):

| Need | Available |
|---|---|
| A custom option editor that knows the panel's queries | `addCustomEditor`; its `context.data` holds the panel's current frames, with their refIds and fields. |
| Inputs and lists | `@grafana/ui`: `Input`, `Combobox`, `IconButton`, `Switch`, `Stack`. Grafana's own drag-and-drop layer list (Geomap) isn't exported (decision 4). |
| Hiding a MapLibre layer without removing its source | The `visibility` layout property. |
| One query split into frames | The **Partition by values** transformation gives a frame per value of a column. Whether the frames keep the query's refId, and how they're named, is checked in step 7.1. |

### Changes to the architecture

- **The list follows the queries** (decision 2). §2.2 describes `LayersEditor` as a list to add to and remove from. In `perFrame` mode, every query is a layer, so the list has no Add button. Settings for a query that has gone stay until removed (decision 9).
- **`LayerSpec`** gains `name` and `visible`, as sketched in §2.4. `interactive` becomes per layer.
- **Layer ids in `perFrame`** (§3.4): the refId when a query returns one frame, as now; `${refId}:${frame name}` for each frame when it returns several (decision 11). Layer settings are keyed by layer id, so `byColumn`'s `${refId}:${value}` layers use the same settings in Phase 11.
- **Per-layer tooltip fields**, which §2.4 left for Phase 7, are already covered by field overrides (Phase 4). The §2.4 comment is updated.
- **A viewer's layer switcher** goes to §7 (decision 5).

---

## Design

### 1. Options (`src/panel/options.ts`)

```ts
interface LayerConfig {
  /** The layer's id: the refId in perFrame, unless the query returns several frames (§2). */
  id: string;
  /** Shown in tooltips, the legend and the data summary; default: the frame's name or "Query A". */
  name?: string;
  /** Default true. */
  visible?: boolean;
  /** Hover and click tooltips; default true. The panel's Tooltip option still applies. */
  tooltips?: boolean;
  /** Default: detected (§3.2). */
  geometryField?: string;
  /** Default: a column named "id". */
  idField?: string;
}

type LayerBinding = { mode: 'perFrame' }; // Phase 11 adds byColumn (§3.4)

interface GeoFlowOptions {
  // ...Phase 6 options...
  /** Drawing order, top layer first. */
  layers: LayerConfig[];
  layerBinding: LayerBinding;
}
```

Defaults: `layers: []`, `layerBinding: { mode: 'perFrame' }`. Unset fields keep today's behavior, so dashboards saved before Phase 7 need no migration (exit criterion 8).

### 2. Binding (`src/adapter/bindPerFrame.ts`, new)

```ts
interface BoundLayer {
  id: string;
  refId: string;
  config: LayerConfig;   // with defaults filled in
  name: string;
  /** Index into the frames; undefined when the query returned nothing. */
  frameIndex?: number;
}

function bindPerFrame(frames: DataFrame[], configs: LayerConfig[]): BoundLayer[];
```

- **Ids:** a query's refId when it returns one frame. When it returns several, each frame's id is `${refId}:${frame name}`, or `${refId}:${position}` for frames without a unique name (decision 11).
- **Order:** layers with a saved config, in the saved order; layers without one on top of them, later frames higher, as new layers go on top today (decision 3). With no saved configs, the result is today's order: A at the bottom.
- **Names:** `config.name`, else the frame's name, else `Query ${refId}` (with the frame's position when the query has several).
- **Gone layers:** configs whose id matches no frame are returned without `frameIndex`, so the editor can show them. They don't become layers.

`buildLayerSpecs` takes the binding instead of looping over frames. It switches on `layerBinding.mode`, so `bindByColumn` slots in beside it in Phase 11 (§3.4). For each bound layer with geometry, it returns a `LayerSpec` with its id, `name`, `visible`, and `interactive` (the panel's Tooltip option and the layer's **Tooltips**). Layers are returned bottom first, the order `setLayers` draws in.

- **Palette colors** stay by frame position among the layers with geometry, as in Phase 5, not by drawing order or visibility (decision 7). Moving or hiding a layer doesn't recolor others.
- **By name** hashes the layer's name, so renaming a layer changes its By name color, as renaming a series does in Grafana.

### 3. Conversion (`src/panel/convertFrames.ts`)

`convertFrames(frames, mappings)` gives each result its layer id (`ConversionResult.refId` becomes `layerId`, with `refId` kept for the query) and passes each layer's `geometryField` and `idField` to `frameToFeatureCollection`. The cache also compares the mapping, so changing a column converts again; changing a name, the order or visibility doesn't. Hidden layers are still converted, so the data summary covers them and showing them is instant.

### 4. Layers editor (`src/panel/LayersEditor.tsx`, new)

A custom panel option editor, in a **Layers** group, the first in the panel options:

```
Layers
┌──────────────────────────────────────────┐
│ 👁  Patch panels          C      ↑ ↓      │  ← selected
│ 👁  Fiber cables          B      ↑ ↓      │
│ ⦸  Buildings             A      ↑ ↓      │  hidden
│ ⚠  Query D               D      no geometry│
│     Old query             E  No data   🗑  │
└──────────────────────────────────────────┘
Patch panels
  Name            [Patch panels      ]
  Geometry column [Auto: geom       ▾]
  ID column       [Auto: id         ▾]
  Tooltips        [on]
```

- **Rows** come from `bindPerFrame(context.data, value)`, top first. Each shows a visibility toggle, the name (placeholder: the default name), the layer id, and the move up and down buttons. A query without geometry shows a warning, so its Geometry column can be picked. A gone query shows "No data" and a remove button.
- **Settings** for the selected row show below the list. The column pickers list that query's columns: string and other columns for Geometry column, all columns for ID column. Their placeholder names the column that detection picks, or "Row number" for the id.
- **Saving:** any change writes the whole list, every query in the current order, so the order is explicit from then on. A config holds only the fields that differ from the defaults.
- **No data yet** (a new panel, a query that failed): the rows come from the saved configs only.

### 5. Engine (`LayerSpec`, `MapLibreEngine`)

```ts
interface LayerSpec {
  // ...Phase 6 fields...
  name: string;
  visible: boolean;
}
```

- **Visibility** is the `visibility` layout property of the layer's style layers. The source and its feature-state stay, so showing the layer again doesn't reload data (decision 5). A hidden layer's features aren't hit-tested.
- **Name:** not used by the engine; it travels with the spec so the panel reads every layer's name from one place.
- **Order:** the Phase 3 restacking, unchanged; unit tests cover moving a layer down and up.

### 6. Panel

- **Tooltips** and the **legend** take the layer's name from its spec. The legend lists entries top layer first, and leaves out hidden layers.
- A **pinned or hovered tooltip** closes when its layer is hidden, or its **Tooltips** is turned off: derived from the specs, like the Phase 4 basemap case.
- The **data summary** names each layer, notes hidden ones, and reports a missing Geometry column: "Geometry column: no column named footprint".

### 7. Testing approach

**Unit tests:**
- `bindPerFrame`: ids for one and several frames per query (named, unnamed, duplicate names), order with and without saved configs, new layers on top, gone layers, names, defaults
- `buildLayerSpecs`: order, `visible`, `interactive` from both options, palette colors unchanged by moving and hiding, By name from the layer name
- `convertFrames`: the mapping in the cache, layer ids for several frames per query
- engine: visibility through layout, no `setData` on show and hide or on moving, hit testing skips hidden layers

**Component tests:** the editor's rows (gone queries, no geometry), moving, hiding, renaming, picking columns, what it saves; tooltips and legend with names; a pinned tooltip closing when its layer is hidden.

**E2E (`08-layers.json`, `tests/layers.spec.ts`):**
- buildings (footprint and centroid columns, Tooltips off), cables and patch panels, with names and a saved order: stored screenshot, legend titles, tooltip title
- in the panel editor: moving a layer down (screenshot), hiding one (rendered feature counts and screenshot), renaming one (legend), switching buildings' Geometry column to the centroid (rendered as points)
- hovering a building with Tooltips off shows nothing; hovering a cable over it shows the cable
- a query split by **Partition by values** (cables by `placement`): one layer per value, each with its own legend and tooltip name

---

## Steps

Each step is one commit, tested before the next.

### 7.1 Checks on Grafana 13.2 and MapLibre

- `context.data` in a custom panel option editor: present in the panel editor, and updated when a query is added, removed or renamed.
- What Grafana does to **Fields returned by query** overrides when a query's refId is renamed, since layer ids come from refIds (Risks).
- **Partition by values:** whether its frames keep the query's refId, how they're named, and whether a **Fields returned by query** or **Fields with name** override can style one of them. This shows what Phase 11 can lean on: if the transformation already gives usable per-value layers, `byColumn` may mostly add the cap, "Other" and per-value colors.
- `Combobox` and `IconButton` in the options pane: width, and keyboard use.
- **Visibility cost** on 100k points with the GPU: hiding and showing through `visibility`, against removing and adding the layer. Whether feature-state survives a hide and show.

### 7.2 Engine: names and visibility

`LayerSpec.name` and `visible`, the visibility layout, hit testing, order tests. Unit tests.

### 7.3 Adapter: binding and columns

`LayerConfig`, `LayerBinding`, `bindPerFrame` with its layer ids, `buildLayerSpecs`, and the layer ids and mappings in `convertFrames`. Unit tests.

### 7.4 Layers editor

`LayersEditor`, the `layers` and `layerBinding` options in `module.ts`. Component tests; check the options pane on 13.2.

### 7.5 Panel: names, hidden layers, summary

Tooltips, legend and data summary from the specs. Component tests.

### 7.6 Dashboard and e2e tests

`08-layers.json` from the fixture tables, with a Partition by values panel, and `tests/layers.spec.ts`.

### 7.7 Docs

- README: a **Layers** section; the dashboard
- architecture.md: §2.2 `LayersEditor`, §2.4 `LayerSpec`, §3.4 (`perFrame` as built, layer ids, what step 7.1 found about Partition by values for Phase 11), §7 (layer switcher)
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| Renaming a query's refId leaves its layer config behind. | Its settings show as a gone query, and the query shows as a new layer on top. Step 7.1 checks what Grafana does to overrides on a rename; if Grafana follows renames there, the editor gets a way to move settings to another query. |
| `context.data` is empty until the queries have run, or after one fails. | The editor shows the saved configs, and keeps them (decision 9). |
| Showing a hidden 100k-point layer is slow, since MapLibre doesn't build tiles for hidden layers. | Measured in step 7.1. If it's slow, the layer keeps its tiles with zero opacity instead. |
| Moving layers with buttons is slow for long lists. | Panels rarely have more than a handful of queries. Drag and drop can follow if needed (decision 4). |
| A config without a name saves nothing, so the name changes when the frame's name does. | That's today's behavior. A typed name stays fixed. |
| A query that starts returning a second frame changes its first layer's id from `A` to `A:name`, leaving its settings behind. | Rare outside transformations like Partition by values, where the frames per query are the point. The settings show as a gone layer and can be removed. |
| Frame names from a split change with the data (a new value appears). | Each value keeps its id and settings while it's returned; new values go on top with defaults. Phase 11's `byColumn` adds the cap and "Other" for many values. |

---

## Decisions

Accepted as proposed (2026-11-05):

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Where layer settings live | **A `layers` panel option keyed by layer id, edited in a Layers list** (§2.2). In `perFrame` the id is usually the refId; keying by layer id lets Phase 11's per-value layers reuse the settings. The geometry column can't be a field option on the geometry field, and order and visibility aren't field settings. | Field options on the geometry field through overrides, with a separate order list: settings split in two places. |
| 2 | Which queries are layers | **Every query, automatically.** The list follows the queries: no Add or Remove, except for settings of queries that have gone. | An Add button per layer, as in Geomap: an extra step for the usual case, and queries that aren't layers would need explaining. |
| 3 | List order | **Top row drawn on top**, as in Geomap and GIS tools. Queries without saved settings go on top, so saved dashboards draw as now (A at the bottom). | Bottom layer first, in query order: matches the query editor, but not other layer lists. |
| 4 | Reordering | **Move up and move down buttons.** No new dependency. | Drag and drop with `@hello-pangea/dnd`, as Grafana does internally: it isn't exported, so it would be bundled (tens of KiB and a license review). |
| 5 | Visibility | **A saved setting in the editor.** Hidden layers stay loaded, through MapLibre's `visibility`. | A layer switcher on the map as well, for viewers: needs its own design (where it sits beside the legend, whether a choice survives a refresh), proposed for §7. |
| 6 | Tooltips per layer | **A Tooltips switch per layer**, default on, under the panel's Tooltip option. Background polygons otherwise catch every hover. | Only the panel's Tooltip option. |
| 7 | Palette colors | **By query position, as in Phase 5**, unaffected by order and visibility; By name uses the layer's name. | By drawing position: moving a layer would recolor it and its neighbors. |
| 8 | Layer binding option | **Saved, not shown**, until Phase 11 adds a second mode. | A select with one entry, `Per query`. |
| 9 | Settings of gone queries | **Kept and shown as "No data"**, with a remove button. A query that fails for a moment keeps its settings. | Dropped when the query is gone: a failing query would lose its name and order. |
| 10 | E2E checks | **Stored screenshots for order and visibility, DOM checks for names, rendered feature counts for hidden layers**, as in Phases 5 and 6. | Screenshots only. |
| 11 | Layer ids for several frames per query | **The refId for a query's only frame; `${refId}:${frame name}` for each frame when there are several**, by position when names are missing or repeat. Saved dashboards keep their ids, and a Partition by values split gets ids like Phase 11's `${refId}:${value}`. | Always `${refId}:${index}`: simpler, but a frame's settings move to another value when the values change. Or `${refId}:${frame name}` even for one frame: consistent, but changes every saved layer id. |

---

## Outcome

Implemented on branch `phase-7` in eight commits: one per step, and one that gives the adapter e2e tests time for query results (see Findings):
- 444 unit and component tests pass, and 47 e2e tests (plus the login setup). In full-suite runs, `basemap.spec.ts` failed now and then: the known zoom control test, and a few times a check that the map's canvas shows within 5 s (see Findings).
- the new layers e2e tests compare three stored screenshots. The Phase 3 geometry, Phase 5 style and Phase 6 data-driven screenshots still match, so saved dashboards draw as before.
- CI on PR #27 passes build, lint, 444 unit tests and the e2e tests on Grafana 13.2.5, 13.3.0 and nightly, 47 e2e tests each (plus the login setup), on the first run. The layers screenshots match on all three, and `basemap.spec.ts` passed on each. The API compatibility check reports only the known `useFieldConfig` false positive (Phase 4).

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Layers list | Met. A **Layers** group, the first of GeoFlow's options (after Grafana's own panel options), with one row per layer, top first; rows flag a missing geometry column and gone layers. |
| 2 | Names | Met. Tooltips, the legend and the data summary use the layer's name; the default is the frame's name or "Query A" (component and e2e tests). |
| 3 | Order | Met. Moving a layer restacks the map without `setData` (unit tests); the e2e screenshots show a patch panel above and below its building, and the pinned tooltip lists the cable above it first. |
| 4 | Visibility | Met. Hidden layers keep their source and feature-state, aren't hit-tested, and have no legend entry; their tooltips close. On 100k points with the GPU, hiding caused no main-thread task over 50 ms, and showing none over 132 ms. |
| 5 | Tooltips per layer | Met. With Tooltips off, the building under the pointer shows no tooltip (e2e). |
| 6 | Geometry column | Met. Picked from the query's text and JSON columns; a missing one empties the layer and says so in its row and the data summary, without falling back to detection. |
| 7 | ID column | Met, with a data summary line when the column is missing. |
| 8 | Saved dashboards unchanged | Met. The Phase 3, 5 and 6 screenshots match. Palette colors go by frame position, so moving or hiding a layer recolors nothing (unit test). |
| 9 | Several frames per query | Met. Each frame gets its own layer; a Partition by values split draws three layers (e2e). |
| 10 | Layer binding | Met. `layerBinding: { mode: 'perFrame' }` is saved, not shown; settings are keyed by layer id. |
| 11 | Engine boundary | Met. The engine gets `name` and `visible` in `LayerSpec`s. |
| 12 | Tests | Met, locally and in CI on Grafana 13.2.5, 13.3.0 and nightly. |

### Bundle sizes (production build)

| File | Size | gzip | Change from Phase 6 |
|---|---|---|---|
| `module.js` | 58.7 KiB | 17.4 KiB | +10.3 KiB: the Layers editor and the binding. `@grafana/ui`'s Combobox stays external. |
| `maplibre.js` (engine and MapLibre CSS) | 41.7 KiB | 11.7 KiB | +0.1 KiB: visibility |
| `36.js` (MapLibre) | 1139 KiB | 294 KiB | none |

### Differences from the plan

| Plan | Actual | Why |
|---|---|---|
| Frames without a unique name: `${refId}:${position}` | Their labels first (`A-undefined:placement=aerial`), then `#n` by position (`A:#2`) | Step 7.1: Partition by values' default naming leaves frames unnamed, with the value as a label on every field. The `#` keeps a position from looking like a frame name. |
| `buildLayerSpecs` switches on the binding mode | `bindLayers` does, before the conversion; `buildLayerSpecs` takes its layers | The conversion needs each layer's id and columns, so binding has to come first. |
| By name hashes the layer's name | A typed name, else what Phase 5 hashed: the frame's name or refId | The default name, "Query A", would have changed the By name colors of saved dashboards (exit criterion 8). |
| If Grafana follows refId renames, a way to move settings to another layer | None | Step 7.1: Grafana doesn't follow renames in overrides either, so settings left behind behave like Grafana's own. |
| A missing geometry column reported as "Geometry column: no column named footprint" | The conversion's own message, "No column named "footprint"", in the row, the settings and the data summary | It was already there for explicit columns (Phase 1); the row says "No geometry" and the settings name the column. |
| — | The data summary reports a missing ID column | Without it, a missing ID column silently falls back to row numbers. |
| — | A pinned tooltip that closed because its layer was hidden stays closed when the layer is shown again | Coming back with the layer, after the user had moved on, would be a surprise. |
| Component tests for picking columns | Covered by the e2e test | Grafana's Combobox virtualizes its list, which renders no options in jsdom. |
| — | The adapter e2e tests wait up to 30 s for query results | They failed now and then in full-suite runs, locally and on Grafana 13.3.0 in Phase 6's CI. |

### Findings for later phases

- **Partition by values gives per-value layers today** (step 7.1): with **As frame name**, each value is its own query name for overrides, line style included. Phase 11 should start from what it adds beyond that: the cap, "Other", "(none)" and palette colors per value. See [architecture.md §3.4](architecture.md#34-layer-binding-modes).
- **The Layers list follows the data**, through the editor context's frames: a renamed or new query shows once the queries have run, and a query that returns nothing has no row.
- **Showing a hidden 100k-point layer** costs tasks of up to about 130 ms while MapLibre rebuilds its buckets, against none for hiding. Phase 9's benchmark should include it.
- **Grafana's Combobox can't be driven in jsdom:** its options are virtualized. Pick options in e2e tests.
- **e2e under load:** the full suite's parallel workers slow Grafana down. Checks that wait for query results or the map's canvas need more than Playwright's 5 s default; `basemap.spec.ts` still uses the default and fails now and then (Phase 9, hardening).
- **React's lint rules forbid setting state in an effect.** State that follows other state (closing a pinned tooltip) is adjusted during render instead, as React's docs suggest.

### Step 7.1 findings

Checked on Grafana 13.2.4, in a dashboard created through the API and read through the data summary, and in Grafana's source. The visibility cost was measured with MapLibre 6.16 in a page of its own: 100k points, one circle layer, Playwright's Chromium on this machine's GPU, as in Phase 6.

| Check | Result |
|---|---|
| `context.data` in a custom editor | Typed as the panel's `DataFrame[]` (`StandardEditorContext.data`). In the options pane (step 7.4), it follows the data, after transformations: renaming B to `cables` changed nothing until the queries ran, then `cables` showed as a new layer and B's settings as gone. A new query that returns nothing has no frame, so no row. |
| Renaming a query's refId | **Grafana doesn't follow it either.** After renaming B to `cables` and running the queries, a **Fields returned by query** override still holds `B`, and its picker shows "Select query refId". GeoFlow's layer settings behave the same way: they show as a gone layer. No way to move settings to another layer is added (Risks). |
| Partition by values: refIds | Each split frame gets the refId `${refId}-${frame name}`. With the default naming, **As label**, the frame keeps the query's frame name, which PostgreSQL frames don't have: all three cable frames came back as `A-undefined`. Today they'd share one layer id. With **As frame name**, the refIds are `A-underground`, `A-aerial` and `A-mixed`, and the names the values. |
| Partition by values: names | With **As label**, every field of a split frame carries the value as a label (`placement: aerial`). So frames without a name are named and identified by their labels, before falling back to their position (Design §2, a difference from the plan). |
| Partition by values: overrides | A **Fields returned by query** override matches the exact refId (`byFrameRefID`), so an override on `A` doesn't reach split frames, and one on `A-aerial` styles that value's frames alone. For Phase 11: per-value styling through overrides already works on a split with **As frame name**. |
| Visibility cost | Hiding or showing through `visibility`: **no main-thread task over 50 ms**, and the layer is back in about 350 ms, while the worker rebuilds its tiles. Removing and adding the layer, and opacity 0, take the same. |
| Feature-state across hide and show | Kept: a feature's `color` state is still there after hiding and showing its layer. |
