# Phase 4: Tooltips

Status: **Implemented** (2026-11-03). See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §2.2 (panel layer), §2.4 (engine layer, tooltips), §3.3 (display values), §5.3 (Phase 4 row), §7 (features considered for later).

## Goal

Show a feature's attributes the way Grafana's own panels do. Hovering a feature highlights it and shows a tooltip. Clicking pins the tooltip, so you can page through overlapping features and follow its data links.

Values are formatted the way Grafana formats them everywhere else: the unit, decimals, value mappings and display names a user sets in the panel's field options, and dates in the dashboard's time zone.

This phase adds:
- hover and click events, a tooltip anchor, and highlights to the engine
- Grafana field config to the panel, including data links
- a way to look up each drawn feature's row in its data frame, and a key to follow it through a refresh
- the tooltip content, built from Grafana's own tooltip components

## Exit criteria

1. **Hover.** Hovering a feature highlights it and shows a tooltip near the pointer:
   - the topmost feature's attributes
   - "+2 more" when other features are under the pointer

   The pointer turns into a hand. Moving off the features hides the tooltip and the highlight.
2. **Click pins.** Clicking a feature pins the tooltip at the clicked point and keeps that feature highlighted. The pinned tooltip has:
   - every feature under the click, one at a time, with a "1 of 3" pager, topmost first
   - a close button
   - the feature's data links

   It stays anchored while the map pans and zooms. While it's pinned, hovering still highlights other features, but doesn't open another tooltip.
3. **Content.** A tooltip lists the feature's columns, except the geometry column, in query order, with Grafana's display names and formatted values. Properties that came inside a GeoJSON Feature (`ST_AsGeoJSON(t.*)`) are listed too.
4. **Field options.** The panel's **Standard options** (unit, decimals, display name, no-value text), **Value mappings** and **Data links** apply, as defaults and as field overrides. Time columns show in the dashboard's time zone.
5. **Hiding fields.** A field override **Hide in tooltip** leaves a column out of the tooltip.
6. **Data links** in the pinned tooltip open their targets, with `${__data.fields.…}` and dashboard variables filled in from the feature's row.
7. **Closing.** The pinned tooltip closes when you:
   - click empty map
   - press Escape
   - click its close button
   - change the basemap
8. **Thin lines.** Thin lines can be hovered and clicked: the map looks a few pixels around the pointer.
9. **Refresh.** When new data arrives, a pinned tooltip shows the feature's new values if its layer has an `id` column with unique values, numbers or strings. Otherwise, row positions may now point to other features, so the tooltip closes.
10. **Tooltip option.** A panel option **Tooltip** chooses **Hover and click** (default), **Click only** or **Off**. On touch screens, which have no hover, a tap pins the tooltip.
11. **Safe feature ids.** Feature ids MapLibre can't keep exactly, such as negative or decimal numbers, are never passed to it as feature ids. Those layers fall back to row indexes, as layers with non-numeric ids already do.
12. **Engine boundary.** The engine stays free of Grafana, React and Emotion; tooltip content reaches it as a plain DOM element. Values never go through `innerHTML`.
13. **Tests.** Unit, component and e2e tests pass locally and in CI. E2E tests hover and click real features and check the tooltip's content, formatting and links.

## Out of scope

- **Actions** (Grafana's buttons that send an HTTP request) in tooltips. Plugins have no supported way to build them yet. See [architecture.md §7](architecture.md#7-features-considered-for-later).
- **Per-layer tooltip settings,** such as fields per layer or tooltips off for one layer. These come with the layer editor in Phase 6. Phase 4's option covers the whole panel, and **Hide in tooltip** works per field.
- **Keyboard selection** of features on the map. See [architecture.md §7](architecture.md#7-features-considered-for-later).
- **Data links in the hover tooltip.** The hover tooltip lets the pointer through and moves with it, so its links couldn't be clicked. Links are in the pinned tooltip (exit criterion 2).
- **One-click data links.** Grafana's link editor has an **Open with one click** setting, which in Grafana's own panels makes a click open the link instead of the tooltip. In Phase 4 a click always pins the tooltip, and the link is in its footer. Where this would fit is in [architecture.md §7](architecture.md#7-features-considered-for-later).
- **Field options for properties inside a GeoJSON Feature.** Properties that come inside a Feature (`ST_AsGeoJSON(t.*)`) have no Grafana field, so unit, value mappings and **Hide in tooltip** can't apply to them. They're listed as plain text (Design §3). Selecting them as separate columns gives them field options.

---

## Starting point

| Already in place | From |
|---|---|
| Each feature has a numeric id: the `id` column's value when every one is a unique finite number, otherwise its row index. Design §2 separates this id from the key a tooltip follows, and tightens the rule. | Phase 1 |
| One layer per frame, with layer id = refId, drawn through `setLayers`. Style layers are named `geoflow-layer:<id>:<kind>`. | Phase 3 |
| `queryRenderedFeatures` returns a feature once per tile and per style layer, so results need de-duplicating by layer and feature id. | Phase 3 finding |
| The test hook (`src/panel/testHook.ts`) and the `renderedFeatures` e2e helper. | Phase 3 |
| MapLibre's 512 px zoom scale: a test can work out where a known coordinate is on screen from the panel's view. | Phase 3 finding |

**What Grafana 13 offers plugins** (checked in `@grafana/data` and `@grafana/ui` 13.2.5):

| Need | Available |
|---|---|
| Formatted values | With `useFieldConfig()`, Grafana applies field config to `data.series` and gives each field a `display` function. `getFieldDisplayName` and `formattedValueToString` are exported. |
| Data links | Fields with links configured get a `getLinks` function, with variables filled in for a row. `getFieldDisplayLinks(field, rowIndex)` and `DataLinkButton` are exported. |
| Tooltip layout | Grafana's own tooltip building blocks are exported: `VizTooltipHeader`, `VizTooltipContent`, `VizTooltipFooter` (which takes `dataLinks`) and `VizTooltipColorIndicator`. They're marked `@alpha`, so they may change between Grafana versions. |
| Actions | `VizTooltipFooter` accepts ready-made actions, but the code that builds them from a panel's action settings is internal to Grafana. Hence actions are out of scope. |

### Changes to the architecture

The architecture (§2.4, §3.3) planned some things differently:
- **Tooltips, not popups.** The architecture had click popups only. Phase 4 follows Grafana's own pattern instead: hovering shows a tooltip, and clicking pins it. That's how the time series and Geomap panels work.
- **Who builds the tooltip.** The architecture had the engine build the popup from text nodes. Instead, the engine anchors a MapLibre `Popup` and accepts its content as a plain DOM element. The panel renders that content with React and Grafana's tooltip components into the element.
  - The engine still knows nothing about Grafana.
  - React escapes every value, so the "no `innerHTML`" rule holds.
  - The tooltip looks like every other Grafana tooltip, and data links come with it.
- **When values are formatted.** The architecture formatted every row's values up front and kept them per layer. Instead, values are formatted when a feature is hovered or clicked, from the row in the data frame. Formatting 100k rows that nobody looks at would cost about as much as converting them. The raw feature properties stay untouched, as planned.

---

## Design

### 1. Field config and the Tooltip option (`module.ts`)

`useFieldConfig()` with:
- **Shown:** Unit, Decimals, Display name and No value under **Standard options**, plus **Value mappings** and **Data links**.
- **Hidden:** Min, Max, Color, Thresholds and Actions. They would do nothing yet; Phase 5 may bring Color back for data-driven styling.
- **Custom field option:** `hideInTooltip` (boolean, default off, shown as **Hide in tooltip**), usable as a default or in a field override.

With field config on, Grafana applies these settings to `data.series` before the panel gets it. Step 4.1 confirms that on Grafana 13.2 before anything relies on it.

**Panel option:** `tooltip: 'hover' | 'click' | 'off'`, shown as **Tooltip** with **Hover and click** (default), **Click only** and **Off**.

### 2. Feature ids and keys (adapter)

Phase 1 uses one id for two different jobs. Phase 4 separates them:

| | MapLibre feature id | Feature key |
|---|---|---|
| Used for | Hover and click results (`queryRenderedFeatures`) and the highlights (feature-state) | Following a feature through a refresh (exit criterion 9), and later Phase 7's refresh handling |
| Must be | A number MapLibre keeps exactly | Unique within the layer; numbers or strings |
| Comes from | The `id` column when its values qualify (below); otherwise the row index | The `id` column's value, whatever its type, when every value is present and unique; otherwise no key |

**Why MapLibre's id has to be a number.** MapLibre keeps a GeoJSON feature's `id` only as a number. Its GeoJSON wrapper runs string ids through `parseInt`, so `"building:1"` is dropped. When a tile goes to the main thread, ids are encoded as unsigned whole numbers, which is how query results get them. MapLibre's `promoteId` option can use a string property as the id instead. It isn't needed here, because the row index always works as MapLibre's id, and the key carries any string identity.

**Tightened id rule.** Phase 1 uses the `id` column as MapLibre's id when every value is a unique *finite* number. Given the unsigned encoding, negative and decimal ids probably come back wrong from a query, and very large ones may collide. Step 4.1 checks this in a real browser. If confirmed, the rule becomes: unique, non-negative, whole numbers up to `Number.MAX_SAFE_INTEGER`, with any other column falling back to row indexes (exit criterion 11). The column's values still become the key whenever they're unique.

**What the adapter adds to `ConversionResult`:**
- `featureRows: number[]`: the row index of each feature, in feature order. Features skip invalid rows, so feature *i* isn't always row *i*.
- `keyField?: string`: the column the keys come from, when it qualifies. The id column is the one named `id` (case-insensitive), as in Phase 1; Phase 6 lets a layer pick another.
- `featureRow(result, featureId) → number | undefined`: finds the row for a feature's MapLibre id.
- `featureKey(result, featureId)` and `featureByKey(result, key)`: go between MapLibre ids and keys.

The lookups build their `Map`s the first time they're needed for a result, and keep them.

### 3. Tooltip content (`src/adapter/featureDetails.ts`)

`featureDetails(frame, result, row) → { items: Array<{ label: string; value: string }>; links: LinkModel[] }`:
1. **Columns:** every field except the geometry field and fields whose config has `custom.hideInTooltip`, in frame order.
   - label: `getFieldDisplayName(field, frame)`
   - value: `formattedValueToString(field.display(value))`
   - fallback: if a field has no `display` function (no field config applied), the raw value as a string
2. **Feature properties:** properties from a GeoJSON Feature input that no column already covers, in their own order. Each is shown as a string, or as JSON for an object. These have no Grafana field, so no field config applies.
3. **Empty values:** null and empty values show the field's **No value** text when it's set. Otherwise they show "—".
4. **Links:** `getFieldDisplayLinks(field, row)` for every field, hidden fields included (a link can sit on a field that isn't listed). Duplicates with the same title and URL are dropped.

It's pure: given the frame Grafana passed in, the result is fixed. That makes the formatting rules unit-testable with real `toDataFrame` frames and field config applied.

### 4. Engine (`MapEngine` additions)

```ts
interface FeatureRef { layerId: string; featureId: number }

/** Features under the pointer, topmost first, de-duplicated. Empty over empty map. */
interface PointerHit { lngLat: [lon: number, lat: number]; features: FeatureRef[] }

interface EngineEvents {
  // ...Phase 2 and 3 events...
  /** The features under the pointer changed, or the pointer left the map (empty features). */
  hover: PointerHit;
  click: PointerHit;
}

interface LayerSpec {
  // ...Phase 3 fields...
  /** Hover and click report this layer's features, and the pointer turns into a hand over them. */
  interactive: boolean;
}

interface MapEngine {
  // ...
  /**
   * Shows `content` in the tooltip anchored at lngLat, replacing what was there. A tooltip that
   * isn't interactive lets the pointer through, so it never blocks hovering the map.
   */
  openTooltip(lngLat: [number, number], content: HTMLElement, options: { interactive: boolean }): void;
  closeTooltip(): void;
  /** The largest tooltip that fits inside the map when anchored at lngLat in the current view. */
  tooltipSpace(lngLat: [number, number]): { width: number; height: number };
  /** Highlights; undefined clears them. Hovered and selected can both be set. */
  setHovered(feature: FeatureRef | undefined): void;
  setSelected(feature: FeatureRef | undefined): void;
}
```

- **Hit testing:** hover and click query the rendered features of interactive layers in a box of ±4 px around the pointer, so lines 2 px wide can be hit. Results are de-duplicated by layer and id, and ordered as MapLibre returns them, topmost first.
- **Hover:** `mousemove`, throttled to one query per animation frame. The engine emits `hover` only when the features under the pointer change, and once with no features on `mouseout`. Over interactive features, the canvas cursor becomes `pointer`.
- **Tooltip:** one `maplibregl.Popup` with:
  - `closeButton: false`, because the panel renders its own
  - `closeOnClick: false`, because the panel decides when it closes
  - `padding` of 8 px, so it stays clear of the map's edges
  - `setDOMContent(content)`

  MapLibre moves it with the map, and picks the side of the point it opens on: above the point if it fits there, otherwise below; centered across the point if it fits, otherwise beside it, away from the nearer edge. MapLibre doesn't shrink a tooltip that fits on no side, so `tooltipSpace` reports the room that rule leaves: the larger of the space above and below the point, and the larger of the space beside it or centered across it, less the margin and the 12 px offset. The panel sizes the tooltip to that. A non-interactive tooltip gets `pointer-events: none`. `setBasemap` closes it, and so does `destroy`.
- **Highlights:** MapLibre feature-state `{ hovered }` and `{ selected }` on the feature's source. `paintFor` gains highlighted variants as `['case', ['any', selected, hovered], highlightedValue, normalValue]`:
  - wider outline and line
  - larger point with a thicker stroke
  - higher fill opacity

  `repaint` compares paint values as JSON, since they can now be expressions.
- **Events inside the tooltip:** the tooltip's own DOM doesn't pass events to the map, so clicks inside a pinned tooltip don't count as map clicks.

### 5. Panel (`MapPanel.tsx`, new `FeatureTooltip.tsx`)

**Tooltip content.** `FeatureTooltip` renders with Grafana's tooltip components:
- `VizTooltipHeader`: the layer's color as a `VizTooltipColorIndicator`. When pinned, it also has the pager ("1 of 3", previous and next buttons) and a close button.
- `VizTooltipContent`: the `featureDetails` items.
- `VizTooltipFooter` (pinned only): the data links.
- "+2 more" (hover only): shown when more features are under the pointer.

It renders into a `div` that the panel owns, through a React portal, and the panel hands that `div` to `openTooltip`.

**Tooltip size.** When a tooltip opens, the panel asks the engine for `tooltipSpace` at its anchor and uses that as the tooltip's maximum height, and as its maximum width up to 400 px. Its minimum width is 180 px, or less on a map that has less room. The header and the data links keep their height, and the field list between them shrinks and scrolls. A pinned tooltip keeps the size it opened with while the map pans, so panning can carry it past an edge, as it carries the feature. A hover tooltip lets the pointer through, so it can't be scrolled; pinning it can.

If step 4.1 finds the `@alpha` tooltip components behave differently between Grafana 13.2 and nightly, the panel uses its own small components with the same layout instead (decision 8).

**State:**
- `hover: { lngLat, features } | undefined`
- `pinned: { lngLat, features: Array<FeatureRef & { key? }>, index } | undefined`

**Hover** (`tooltip` is `'hover'`, and nothing is pinned):
- with features: `setHovered(topmost)`, and `openTooltip` at the pointer with the compact content, not interactive
- without features: `setHovered(undefined)` and `closeTooltip`

When something is pinned, hover only moves the hover highlight.

**Click** (`tooltip` is `'hover'` or `'click'`):
- with features: pin them, `setSelected` the current one, and `openTooltip` at the click point with the full content, interactive
- on empty map: unpin, `setSelected(undefined)` and `closeTooltip`

**Escape** closes the pinned tooltip.

**New data:**
- the pinned state stores each feature's key, not only its MapLibre id
- if every pinned feature's layer has a `keyField`, each is found again with `featureByKey`, which gives its new MapLibre id and row; features that are gone are dropped, and the tooltip closes if none are left
- otherwise the tooltip closes
- the hover state is dropped; the next pointer move rebuilds it

**Tooltip off:** layers are built with `interactive: false`, so there's no hit testing, no hand pointer and no events.

**Engine recreated after scrolling off screen:** hover and pinned state are cleared, since the tooltip belonged to the old map.

**Tooltip CSS:** MapLibre's popup is styled for a light page. The panel's scoped CSS removes its padding and tip, and lets Grafana's tooltip container provide the background, border and shadow.

### 6. Testing approach

| Level | What | How |
|---|---|---|
| Unit | `featureRows`, `featureRow`, keys | Skipped rows, id-column ids, row-index ids, the cached maps. Keys from numeric and string id columns, duplicate or missing keys giving no `keyField`, and the tightened id rule (negative, decimal and very large ids fall back to row indexes). |
| Unit | `featureDetails` | Frames from `toDataFrame` with field config applied through Grafana's `applyFieldOverrides`: units, decimals, display names, value mappings, no-value text, time fields, `hideInTooltip`, Feature properties, null values. Links with `${__data.fields.…}` filled in for the row, and duplicates dropped. |
| Unit | `paintFor` | Highlighted-state expressions. |
| Unit | `MapLibreEngine` | `FakeMap` gains `queryRenderedFeatures` with a box, `setFeatureState`, `getCanvas().style`, and a mocked `Popup`. Covers: hover and click results, ordering and de-duplication; hover emitted only on change and on `mouseout`; non-interactive layers; the tooltip lifecycle (open, replace, interactive or not, closed on basemap change and destroy); both highlights; the pointer. |
| Component | `MapPanel`, `FeatureTooltip` | Fake engine. Covers: hover opens a compact, non-interactive tooltip and highlights; click pins it with the pager and links; hover while pinned only highlights; Escape and empty clicks unpin; each Tooltip mode; data refresh with and without keys; state cleared on recreate. |
| E2E | New `05-tooltips` dashboard | Hover and click known features and check the tooltip (below). |

**Pointing at a known feature in e2e.** A test helper, `mapPoint(panel, [lon, lat], view)`, works out a coordinate's screen position. It uses:
- the panel's view from the dashboard JSON
- Web Mercator at MapLibre's 512 px scale
- the canvas's center as the origin, since it's the view's center

It's plain math, so there's no new test hook. The dashboard uses zoom 16, where buildings are tens of pixels wide, so the pointer lands well inside them.

**Dashboard `05-tooltips`:**
- **Buildings panel** with field overrides:
  - `floors` with a unit
  - `installed_on` as a date
  - `address` hidden in the tooltip
  - `status` with value mappings (`in_service` → "In service")
  - a data link on `name` to the `04 Geometry` dashboard, with `${__data.fields.id}` in its URL
- **Patch panels panel** with a percent unit on `utilization_pct`, and **Tooltip: Click only**.
- **Overlap panel:** cables and splice cases, where a splice case sits on a cable, to give several features under one pointer.
- **Text keys panel:** `network_assets`, with its text `asset_id` aliased as `id` (`'building:1'` and so on), so a pinned tooltip is followed through a refresh by a string key.
- **Tooltip off panel.**

**E2E tests:**
- **Hover:** a tooltip appears with the expected labels and formatted values; it disappears over empty map; the hidden field isn't listed; the overlap shows "+1 more".
- **Click:**
  - the tooltip pins, with the pager on the overlap ("1 of 2", Next shows the other feature)
  - the data link's URL has the building's id in it
  - pinned in the middle of the short Buildings panel, the tooltip stays inside the map, its data link stays in view, and its fields scroll (added with the follow-up)
- **While pinned:** hovering another feature doesn't replace the pinned tooltip.
- **Closing:** Escape, an empty-map click and a basemap change each close the pinned tooltip.
- **Modes:** on the Click only panel, hovering shows nothing and clicking pins; on the Tooltip off panel, neither does anything.
- **Refresh:** after a dashboard refresh, a pinned tooltip on the text keys panel still shows the same feature.

The highlights are only visible on the canvas, so the e2e tests don't check them; unit and component tests cover the feature-state calls.

---

## Steps

Work happens on a `phase-4` branch cut from `main` after PR #21 merges, with one commit per step.

### 4.1 Checks on Grafana 13.2 and MapLibre

- **Field config:**
  - Turn on `useFieldConfig()` with no other changes.
  - In the dev stack, confirm that `data.series` fields arrive with a `display` function, and that defaults and overrides change its output.
  - Check time fields (Phase 1 found `date` and `timestamptz` arrive as `time`) in the dashboard time zone, and value mappings on PostgreSQL enum strings.
- **Data links:** configure one with `${__data.fields.id}` and a dashboard variable, and confirm `getFieldDisplayLinks` fills both in for a given row.
- **Tooltip components:** render a throwaway tooltip with `VizTooltipHeader`, `VizTooltipContent` and `VizTooltipFooter` on Grafana 13.2 and nightly (CI runs both), and compare.
- **Feature ids in MapLibre:** draw points whose `id` column holds:
  - negative numbers
  - decimals
  - numbers above 2³² and above 2⁵³
  - duplicates of each other after rounding

  Read back the ids MapLibre reports from `queryRenderedFeatures`. This shows which ids survive exactly, and settles the tightened rule in Design §2.

> **Checkpoint (only if needed):** if Grafana doesn't apply field config or data links for this panel type as documented, I'll bring options before building the tooltip on them. The other two checks don't need a checkpoint. The tooltip components have a fallback (decision 8), and MapLibre's id findings only decide when to fall back to row indexes.

**Done when:** the findings are recorded and the existing tests still pass.

### 4.2 Field config and the Tooltip option

Implement Design §1: the standard options shown and hidden, the `hideInTooltip` custom option, and the `tooltip` panel option.

**Done when:** the options appear in the panel editor and the unit tests for `options.ts` pass.

### 4.3 Adapter: ids, keys, rows and details

`featureRows`, `keyField`, the lookups, the tightened id rule from step 4.1, and `featureDetails` with links (Design §2, §3), with unit tests.

**Done when:** the tests pass.

### 4.4 Engine: hover, click, tooltip, highlights and pointer

Implement Design §4 with the extended `FakeMap` tests.

**Done when:** the tests pass and the boundary rule passes.

### 4.5 Panel: pinned tooltip on click

`FeatureTooltip` in its pinned form, the click handling, Escape, refresh by key, recreate, and the tooltip CSS (Design §5), with component tests.

**Done when:** the component tests pass, and in the dev stack the pinned tooltip looks right in both themes.

### 4.6 Panel: hover tooltip and highlight

The compact hover form, the hover handling (including while pinned), and the three Tooltip modes, with component tests.

**Done when:** the component tests pass, and in the dev stack hovering feels immediate on the `01-adapter` and 100k-point data.

### 4.7 Panel: data links

The `VizTooltipFooter` with the feature's links in the pinned tooltip, with component tests.

**Done when:** the tests pass, and a link configured in the dev stack opens with the row's values filled in.

### 4.8 Dashboard and e2e tests

Add `05-tooltips.json`, the `mapPoint` helper and the e2e tests (Design §6). Run them locally and in CI on the PR.

**Done when:** all e2e tests pass locally and in CI.

### 4.9 Docs

- **README:** tooltips, the Tooltip option, the field options that affect them, **Hide in tooltip**, and data links.
- **Architecture doc:**
  - MapLibre ids versus feature keys, and the tightened id rule (replacing the "Feature ids" note in §3.3)
  - formatting on hover and click (replacing the "Display values" note in §3.3)
  - `FeatureRef`, `hover`, `click`, `openTooltip`, `tooltipSpace`, `setHovered`, `setSelected` and `interactive` in the engine contract
- **This file:** fill in the outcome section.
- **Test-only code check:** run `grep -rn "Test hook:" src/` and compare it with the diff. The plan adds no test-only code.

---

## Risks

| Risk | Handling |
|---|---|
| Grafana doesn't apply field config or data links to this panel's `data.series` as expected, or a time field's `display` ignores the dashboard time zone. | Step 4.1 checks it first, with a checkpoint. Fallback: build the display processors and link suppliers in the panel with `applyFieldOverrides` and `getLinksSupplier`, as Grafana's own panels do in some cases. |
| Grafana's `@alpha` tooltip components change between 13.2 and later versions. | Step 4.1 compares them on 13.2 and nightly, and CI keeps running e2e tests on both. Fallback: the panel's own components with the same layout (decision 8). |
| Hover hit testing makes the pointer lag on large data. | One query per animation frame, only over interactive layers, using MapLibre's spatial index. Step 4.6 checks it on 100k points; if it lags, hover hit testing is limited to a smaller box or turned off above a feature count, which goes in the outcome. |
| Hover tooltips get in the way on dense maps. | **Click only** mode. The hover tooltip doesn't take the pointer, so it never blocks the feature under it. |
| Pointing at features by coordinates misses in CI, for example from a 1 px panel size difference or a different device pixel ratio. | Zoom 16 makes the targets tens of pixels wide, and the helper measures from the canvas center, which doesn't depend on panel size. If it still misses, the test hook can report a feature's screen position from MapLibre's `project()`, marked `// Test hook:`. |
| React portal content inside a MapLibre popup gets out of step with React's tree, for example after the engine is destroyed. | The panel owns the content element and unmounts the portal before `closeTooltip` and on engine cleanup. Component tests cover recreate and unmount. |
| Tooltips with many columns overflow small panels. | The tooltip is sized to the room beside its anchor (`tooltipSpace`), the side MapLibre's automatic anchoring opens it on, and its field list scrolls. |
| The id-column rule changes which ids a layer uses, and with them feature-state and query results. | Only layers whose ids MapLibre couldn't keep exactly change, and those were already wrong. Unit tests pin the rule. Keys are unaffected. |
| Feature-state highlights are lost when `setData` replaces a source. | MapLibre keeps feature-state across `setData` for the same ids. If the pinned feature is gone after a refresh, the panel clears it anyway (Design §5). |

## Decisions

Confirmed 2026-11-03, as proposed.

| # | Topic | Decision | Alternative considered |
|---|---|---|---|
| 1 | How the tooltip is built | **The engine anchors a MapLibre `Popup`; the panel renders the content with React and Grafana's tooltip components into a DOM element it hands over.** The tooltip stays anchored while panning, the engine stays Grafana-free, values are escaped by React, and data links come with Grafana's footer. | The architecture's plan: the engine builds the popup from text nodes. Simpler engine, but no Grafana components, no data links, and theme styling is all CSS. Or a React overlay positioned by the panel, which must then follow every map movement itself. |
| 2 | Hover and click | **Grafana's pattern: hover shows a compact tooltip, click pins the full one.** | Click popups only, with hover added later. The interaction model and tooltip code would then be built twice. |
| 3 | Several features under the pointer | **Hover shows the topmost and "+2 more"; the pinned tooltip pages through all of them, topmost first.** Points sit on cable ends throughout the fixture data, so this is common. | Only the topmost, even when pinned. Simpler, but a feature under another can't be reached. |
| 4 | Choosing tooltip fields | **Every column, with a Grafana field override "Hide in tooltip".** It works per field, including through regex and type matchers, which is how Grafana users already work. | A field list in the panel options. It's per panel rather than per field, and Phase 6 brings per-layer settings anyway. |
| 5 | Standard field options | **Unit, Decimals, Display name, No value, Value mappings and Data links.** Min, Max, Color, Thresholds and Actions are hidden until something uses them. | Also show Actions. Plugins can't build them with Grafana's supported API yet ([architecture.md §7](architecture.md#7-features-considered-for-later)). |
| 6 | Highlights | **Highlight the hovered and the pinned feature**, plus a hand pointer over features that can be hovered. | Only the pinned feature. Hover then has no visual link to the tooltip on dense data. |
| 7 | Tooltip option | **Hover and click (default), Click only, Off**, panel-wide. Per-layer settings come in Phase 6. | An on/off switch only. Dense maps then can't keep click tooltips without hover ones. |
| 8 | Tooltip components | **Grafana's `VizTooltip*` components**, so tooltips look like every other Grafana tooltip, with the panel's own components as the fallback if step 4.1 or CI finds differences between versions. | The panel's own components from the start. No dependency on `@alpha` APIs, but more styling work and a look that drifts from Grafana's. |
| 9 | Following a feature through a refresh | **By a key from the `id` column, numbers or strings**, kept apart from MapLibre's numeric id. Text keys such as `asset_id` work. | Use MapLibre's id, which is only stable when the `id` column is numeric; tooltips on layers with text keys would close on every refresh. Or MapLibre's `promoteId` with a string property as the id, which makes following a feature depend on how MapLibre stores and encodes ids. |

## Outcome

All exit criteria were met locally against Grafana 13.2.4:
- 305 unit and component tests and 37 e2e tests pass
- typecheck, lint, `check:dist` and the license check pass
- CI on draft PR #22 passes build, lint, unit tests and e2e tests on Grafana 13.2.5, 13.3.0 and nightly. The e2e runs also show Grafana's `@alpha` tooltip components behave the same across those versions. The **Latest Grafana API compatibility check** reported a false positive, and now reports instead of failing; see Findings.

| # | Criterion | Result |
|---|---|---|
| 1 | Hover highlights, shows a tooltip near the pointer with "+N more", and a hand pointer | Met. E2E tests hover a building and the splice case on three cables ("+3 more"). |
| 2 | Click pins: pager, close button, data links; anchored while panning; hover doesn't replace it | Met. The overlap pages "1 of 4"; the pinned tooltip stays while the pointer moves on. |
| 3 | Columns in query order with display names and formatted values; Feature properties too | Met (adapter, component and e2e tests). |
| 4 | Standard options, value mappings and data links apply; dashboard time zone | Met. Checked in the dev stack in step 4.1 and by the e2e tests (unit suffix, date format, value mapping). |
| 5 | **Hide in tooltip** | Met. The hidden `address` doesn't show in the e2e test. |
| 6 | Data links with field values and variables filled in | Met. The e2e link points at `var-building=2`. |
| 7 | Closing on empty-map click, Escape, the close button and a basemap change | Met (component and e2e tests). |
| 8 | Thin lines can be hit | Met: hit testing looks 4 px around the pointer. |
| 9 | A pinned tooltip follows its feature through a refresh by key; closes without keys | Met. The e2e test follows a text key through a refresh that reorders every row. |
| 10 | Tooltip option: Hover, Click, Off; tap pins on touch screens | Met. Labels shortened (see differences). A tap is a click to MapLibre, so it pins; there's no touch-specific test. |
| 11 | No ids MapLibre can't keep exactly | Met: the tightened rule, confirmed in step 4.1. |
| 12 | Engine free of Grafana, React and Emotion; content as a DOM element; no `innerHTML` | Met. |
| 13 | Tests pass locally and in CI, hovering and clicking real features | Met locally and in CI (e2e on 13.2.5, 13.3.0 and nightly). |

### Bundle sizes (production build)

| File | Size | gzip | Change from Phase 3 |
|---|---|---|---|
| `module.js` | 32.4 KiB | 10.8 KiB | +8.9 KiB: the tooltip component and hook, feature details and lookups. Grafana's UI components aren't bundled. |
| `maplibre.js` (engine and MapLibre CSS) | 39.7 KiB | 11.0 KiB | +2.8 KiB: hit testing, the tooltip anchor and highlights |
| `36.js` (MapLibre) | 1139 KiB | 295 KiB | +8 KiB: MapLibre's `Popup` is now used |
| Worker (`*.mjs`) | 502 KiB | 142 KiB | none |

### Differences from the plan

| Plan | Actual | Why |
|---|---|---|
| The engine emits `hover` only when the features under the pointer change | It emits once per animation frame while the pointer is over features, and once when it leaves them | So the hover tooltip follows the pointer, as Grafana's tooltips do. Passing the same content element only moves the popup, and the panel keeps the same feature list while the features don't change, so the content isn't rebuilt. |
| `setBasemap` closes the tooltip in the engine | The panel closes it: a pinned tooltip remembers the basemap it was pinned on | Closing it in the engine would leave the panel thinking it was still pinned. |
| Tooltip option labels **Hover and click**, **Click only**, **Off** | **Hover**, **Click**, **Off**, with the meaning in the description; **Hide in tooltip** sits in the same Tooltip group | The longer labels were cut off in the options pane. |
| In Click mode, hover shows nothing | Hover still highlights the feature and shows the hand pointer, but no tooltip | The highlight shows what a click would pin (decision 6). |
| Hidden standard options: Min, Max, Color, Thresholds, Actions | Also Field min/max and Filterable | They do nothing in a map panel either. |
| `featureDetails(frame, result, row)` | `featureDetails(frame, result, featureId)` | It needs the feature too, for the properties of GeoJSON Feature input. |
| The tooltip title | The frame's name, or "Query A" | Grafana's name for an unnamed frame is its field list ("id, name, geometry"). |
| Steps 4.5 and 4.6 as separate commits | One commit | Hover and pinned tooltips share one tooltip element and one set of highlights. Step 4.7 then only added the data link tests, since `FeatureTooltip` renders the footer. |
| The overlap e2e test shows "1 of 2" | "1 of 4" | SC-01 sits on three cables. |
| Tooltip maximum size tied to the panel size (width − 32 px, height − 40 px), the field list `maxHeight − 80` | Sized to `tooltipSpace` at its anchor; the field list fills what the header and links leave (follow-up, PR #23) | MapLibre only picks the side the tooltip opens on. Sized to the panel, a tooltip near the middle of a short panel fit on neither side and was cut off. |

### Findings for later phases

- **API compatibility check (Levitate).** It reports `PanelPlugin.useFieldConfig` as changed between `@grafana/data` 13.2.0 and 13.3.0. 13.3 adds a second type parameter, `SetFieldConfigOptionsArgs<TFieldConfigOptions, TContextOptions = unknown>`. With its default, code written for 13.2 compiles unchanged, nothing changes at runtime, and the e2e tests pass on 13.3.0 and nightly. Levitate flags any change to an API a plugin calls, between the minimum (`plugin.json`) and latest Grafana. Upgrading the Grafana packages wouldn't clear it, and they're pinned to the minimum on purpose. The check now reports instead of failing, as in Grafana's own examples and the action's defaults: it keeps one comment on the PR up to date with its report (`fail-if-incompatible: 'no'`, `comment-pr: 'yes'`). Commenting only when something is found isn't possible: in `is-compatible/v1.1.0`, `skip-comment-if-compatible: 'yes'` never comments, because the comment steps read an output the action doesn't set. The e2e tests on 13.2, 13.3 and nightly remain the gate. A `create-plugin update` may restore the scaffold's stricter setting; that would show in its PR.

- **Software rendering in headless Chromium.** By default, Playwright's Chromium draws WebGL with SwiftShader on the CPU, where redrawing 100k points takes 100 ms or more. Panning that layer took about 340 ms per move. On this machine's GPU (`--enable-gpu --ignore-gpu-blocklist --use-angle=gl`), panning and hovering 100k points both ran with no main-thread task over 50 ms. Phase 8's performance work has to use the GPU; e2e timings in CI say nothing about real performance.
- **Highlight method.** Because of the slow software rendering, hover at first looked slow with feature-state highlights. An overlay source for highlighted features was built and measured, then dropped: on the GPU, feature-state and the overlay performed the same, and feature-state is simpler and is what the plan specified.
- **Tooltip placement.** MapLibre anchors a pinned tooltip below its feature when there's no room above, so the tooltip can cover the map just south of the feature. The e2e tests click empty map at the canvas's edge for that reason.
- **Tooltips overflowing the map** (found after Phase 4). MapLibre only picks the side a popup opens on; a tooltip taller or wider than the room on either side was cut off by the panel. Fixed in the follow-up (see Differences from the plan, and Design §4 and §5).
- **Unpinning while over a feature** brings back its hover tooltip straight away. That's intended, and the e2e tests check the pinned tooltip's close button rather than the absence of any tooltip.
- **Grafana's `suffix:` units** keep the space after the colon, so `suffix: floors` formats as "4  floors". HTML collapses it on screen.
- **`module.js` is 32.4 KiB.** The tooltip code is only needed once a map exists, so it could move into the lazily loaded chunk if size becomes a concern (Phase 8).
- **Basemap option labels** ("OpenStreetMap", "Custom tiles", "Style URL") are cut off in the options pane, as the Tooltip labels were. Phase 5, which adds more options, should switch them to shorter labels or a select.

### Step 4.1 findings

Checked in the dev stack (Grafana 13.2.4) with a temporary dashboard and temporary inspection code, both removed afterwards.

- **Field config** works as documented once `useFieldConfig()` is on:
  - every field in `data.series` has a `display` function
  - defaults and overrides change its output: a unit suffix on `floors`, and a value mapping turning `in_service` into "In service"
- **Time zone:** time columns follow the dashboard's time zone. With the dashboard set to Pacific/Honolulu, a `date` of 2015-03-01 (midnight UTC) shows as "2015-03-01 14:00:00" the day before. Date-only columns show a time unless the user picks a date unit.
- **Data links:** fields with links get `getLinks`, and `${__data.fields.…}` and dashboard variables (`${site}`) are filled in for the requested row.
  - Field values in links are the *formatted* values: with **Decimals** set to 1 on all fields, `${__data.fields.id}` became `2.0`. Users who format an id column need to keep that in mind; the README will say so.
- **MapLibre feature ids** (read back from `queryRenderedFeatures`):

  | `id` column value | Id MapLibre reports |
  |---|---|
  | 42 | 42 |
  | 4294967297 (above 2³²) | 4294967297 |
  | 9007199254740993 (above 2⁵³) | 9007199254740992: already rounded by JavaScript when the frame arrived, and kept as is |
  | −3 | 18446744073709552000: read back as an unsigned 64-bit number |
  | 1.5, 2.5 | 1, 2: cut to whole numbers |
  | 7.2 and 7.7 | 7 and 7: they collide |

  The tightened rule in Design §2 is confirmed: unique, non-negative, whole numbers up to `Number.MAX_SAFE_INTEGER`. Step 4.3 implements it.
- **Grafana's tooltip components** come from the running Grafana: `@grafana/ui` is provided by Grafana at runtime, not bundled. They can't be compared across versions locally, so the e2e tests in CI (Grafana 13.2.5, 13.3.0 and nightly) do the comparison from step 4.8 on.

No checkpoint was needed.
