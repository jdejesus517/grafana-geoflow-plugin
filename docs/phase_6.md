# Phase 6: Data-driven styling

Status: **Implemented** (2026-11-05). Decisions 1–9 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §2.3 (adapter), §2.4 (engine layer, styling), §5.3 (Phase 6 row), §7 (features considered for later).

## Goal

Color and size features by a column's value: a patch panel red when it's over 80% full, a cable colored by whether it's aerial or underground, a splice case sized by how many splices it holds.

The colors come from the column's own Grafana settings, as in Grafana's other panels:
- **Thresholds**, for "red above 80"
- **Color schemes by value**, such as a green-to-red gradient between the field's min and max
- **Value mappings with colors**, for categories ("underground" blue, "aerial" orange)

Someone who has colored a stat or table cell by value already knows how to set these up.

This phase adds:
- **Color by** and **Size by** field options, which pick the column that drives a layer's color or point size
- per-feature colors and sizes, worked out with Grafana's own display processor
- per-feature styles in the engine, applied without reloading the layer's data
- a legend for data-driven colors

## Exit criteria

1. **Color by.** A **Color by** field option, in the **Map style** group, picks a column of the same query. Each feature is then drawn in the color Grafana gives that column's value, the same color a table cell or stat panel would show:
   - the column's **Thresholds**, with **Color scheme** set to **From thresholds**
   - a by-value **Color scheme** (for example Green-Yellow-Red), across the column's **Min** and **Max**, or its data range when they're not set
   - **Value mappings** with a color, which win over both, as in Grafana
2. **Size by.** A **Size by** field option picks a numeric column. Each point's diameter then scales linearly with its value, from **Min point size** at the column's Min to **Max point size** at its Max. Values outside the range are clamped.
3. **Per query.** Both options work as defaults and in overrides. The usual setup is an override on one query: **Fields returned by query** → **Color by**.
4. **Missing values.** A feature whose value is empty, or can't be colored or sized, keeps the layer's own color and size (Phase 5). A value mapping for **Null** can still give it a color.
5. **Legend.** Each data-driven layer gets an entry in a legend over the map:
   - thresholds and colored value mappings as a list of colors and labels, formatted with the column's unit
   - a by-value color scheme as a gradient bar from Min to Max

   A **Legend** panel option shows or hides it. It's shown by default when any layer is data-driven.
6. **Tooltips.** A tooltip's color marker is the feature's own color.
7. **Highlights** still stand out: hovered and selected features get wider and larger, keeping their own color.
8. **Responsive.** Changing a threshold, a mapping or a size range repaints the map without reloading the layer's data. On 100k points, such a change causes no main-thread task over 200 ms on the GPU.
9. **Phase 5 unchanged.** A layer with no **Color by** or **Size by** draws exactly as in Phase 5. The Phase 3 and Phase 5 screenshots don't change.
10. **Engine boundary.** The engine gets resolved per-feature colors and sizes, never Grafana objects.
11. **Tests.** Unit, component and e2e tests pass locally and in CI.

## Out of scope

- **Line style by value** (dashed when `status = planned`). Grafana has no setting that maps values to line styles, so it would need a mapping editor of GeoFlow's own. Splitting a query into one layer per value, with each layer's line style set by an override, gives the same result: Phase 11 (`byColumn` layers) does that split automatically (decision 5).
- **Line width by value.** Size by applies to points. Lines keep **Line width** (decision 4); see [architecture.md §7](architecture.md#7-features-considered-for-later).
- **Opacity by value** and **fill opacity by value.**
- **A size legend.** The legend shows colors only.
- **Point symbols:** see [architecture.md §7](architecture.md#7-features-considered-for-later).

---

## Starting point

| Already in place | From |
|---|---|
| Each layer's style comes from its geometry field's config (`layerStyle`); per-query style is an override. | Phase 5 |
| The conversion is cached on the frame's `values` arrays, so a field config change keeps the FeatureCollection and the engine only repaints. | Phase 5 |
| `paintFor` builds every paint value in one place; highlights use feature-state (`hovered`, `selected`). | Phases 4, 5 |
| Each feature has a MapLibre id and a data frame row (`featureRows`). | Phases 1, 4 |
| Color scheme offers palette and single-color modes; Thresholds, Min and Max are hidden. | Phase 5 |

**What Grafana and MapLibre offer** (to confirm in step 6.1):

| Need | Available |
|---|---|
| A value's color, exactly as Grafana shows it | `field.display(value).color`, from the display processor Grafana sets up with field config. It applies value mappings, then thresholds or the by-value scheme, with the field's range (`field.state.range`: Min/Max, or the data's range). |
| Picking a column | `addFieldNamePicker` in the field config builder. |
| Per-feature paint values | MapLibre's `circle-color`, `line-color`, `fill-color`, `circle-radius` and `line-width` accept `['feature-state', …]`, so colors and sizes can change per feature without reloading data. `line-dasharray` doesn't, which is one reason line style by value is out of scope. |
| A legend | `VizLegend` from `@grafana/ui`, the list legend of Grafana's own panels. Grafana's color scale bar isn't exported. |

### Changes to the architecture

- **Line style by value moves to Phase 11.** The architecture's Phase 6 row lists line style by value. As above, `byColumn` layers give it without a mapping editor. The Phase 6 and Phase 11 rows were updated when this plan was approved.
- **Per-feature styles in the engine contract.** `LayerSpec` gains per-feature colors and sizes (Design §3). The engine stays Grafana-free: it gets CSS colors and numbers.

---

## Design

### 1. Options (`module.ts`)

Field config, in the **Map style** group (geometry field):

| Path | Editor | Default |
|---|---|---|
| `colorBy` | field name picker | none |
| `sizeBy` | field name picker, numeric fields | none |
| `sizeMin` | slider, px, 2–40 | 4 |
| `sizeMax` | slider, px, 2–40 | 20 |

`sizeMin` and `sizeMax` show only when **Size by** is set. **Point size** (Phase 5) stays the size of features without a value.

Standard options:
- **Color scheme:** `byValueSupport: true`, so the by-value schemes (From thresholds, gradients) come back. The default stays Classic palette. On the geometry field, a by-value scheme still falls back to the palette (Phase 5).
- **Thresholds**, **Min** and **Max** come back. They're what Color by and Size by read on the driving column.

Panel options: **Legend** (`legend.show`, a switch; default: on). It only shows when a layer is data-driven, so a panel without Color by shows nothing.

### 2. Per-feature styles (`src/adapter/featureStyles.ts`, new)

```ts
interface FeatureStyles {
  /** The feature's color, in feature order; undefined keeps the layer's color. */
  colors?: Array<string | undefined>;
  /** The point's radius, px, in feature order; undefined keeps the layer's. */
  radii?: Array<number | undefined>;
}

function featureStyles(frame: DataFrame, result: ConversionResult, theme: GrafanaTheme2): FeatureStyles;
```

- Finds the **Color by** and **Size by** columns in the same frame, by name. A name that isn't in the frame (a typo, or a column the query no longer returns) leaves the layer as in Phase 5, with a note in the data summary.
- **Colors:** for each feature, its row's value through the column's `display()` (`featureRows` gives the row). Empty values, and a display result without a color, give `undefined`. A **Null** value mapping that sets a color applies, since `display(null)` goes through the mappings.
- **Sizes:** for each feature, `(value − min) / (max − min)` clamped to 0–1, from the column's `state.range` (its Min and Max, or the data's range), mapped linearly onto `sizeMin`–`sizeMax` and halved for the radius. Non-numeric and empty values give `undefined`. When min equals max, every value gets the midpoint.
- **Cost:** one `display()` per feature. Results are cached on the column's `values` array and its config object, so a refresh with the same data or a change to another option doesn't redo them.

`buildLayerSpecs` adds them to each layer's spec.

### 3. Engine (`LayerSpec`, `paintFor`, `MapLibreEngine`)

```ts
interface LayerSpec {
  // ...Phase 5 fields...
  /** Per-feature overrides of the style, in feature order (data.features). */
  featureStyles?: { colors?: Array<string | undefined>; radii?: Array<number | undefined> };
}
```

- **Feature-state, not data** (decision 3). The engine sets `{ color, radius }` on each feature with `setFeatureState`, next to Phase 4's `hovered` and `selected`. Paint reads it with a fallback to the layer's style:
  - `circle-color`, `line-color`, `fill-color` (fill and outline): `['coalesce', ['feature-state', 'color'], color]`
  - `circle-radius`: `['coalesce', ['feature-state', 'radius'], radius]`, plus the highlight increment
- **Applying changes:** a new `featureStyles` object is compared with the last one feature by feature. Only features whose color or radius changed get a `setFeatureState` call, and features that lost their value get theirs removed. A refresh with the same colors costs a comparison, not 100k calls.
- **New data:** after `setData`, the features' states are set again for the new feature ids. MapLibre keeps feature-state by id across `setData`, so stale states for ids that are gone are removed.
- **Basemap changes:** a style rebuilt from scratch drops feature-state, so the engine sets the per-feature styles again on `style.load`, as it does for highlights.

### 4. Legend (`src/panel/MapLegend.tsx`, new)

Over the map, bottom left, above the notices, with the same look as the data summary box. One entry per data-driven layer, in drawing order, titled with the query (as in tooltips) and the column's display name:
- **Value mappings with colors:** one item each, with the mapping's text.
- **Thresholds** (Color scheme From thresholds): one item per step, labelled "< 80", "80+", formatted with the column's unit and decimals.
- **By-value gradients:** a bar with the scheme's colors from Min to Max, and the two formatted values at its ends.

Items use `VizLegend`'s list items, so they look like Grafana's legends. The legend scrolls when it's taller than a third of the map, and is hidden while the panel is narrower than 200 px.

### 5. Tooltips

`tooltipFeatures` takes the color marker from the feature's color when it has one, from the layer otherwise.

### 6. Testing approach

**Unit tests:**
- `featureStyles`: thresholds, a gradient, colored mappings (including Null), empty values, a missing column, sizes with Min/Max and with the data range, min equal to max, clamping, caching
- `paintFor`: the feature-state fallbacks, with and without highlights
- engine: `setFeatureState` only for changed features, removal, re-applying after `setData` and `style.load`
- `buildLayerSpecs`: per-feature styles on the right layers

**Component tests:** the legend for each kind of scheme; hidden without data-driven layers and when turned off; the tooltip marker's color.

**E2E (`07-data-driven.json`, `tests/data-driven.spec.ts`):**
- patch panels colored by `utilization_pct` thresholds, cables colored by a value mapping on `placement`, splice cases sized by `splices_used`: stored screenshots, and the legend's items
- in the panel editor, changing a threshold recolors the map (screenshot) without a new conversion
- a tooltip's marker has the feature's color

---

## Steps

Each step is one commit, tested before the next.

### 6.1 Checks on Grafana 13.2 and MapLibre

- `field.display(value).color` on Grafana 13.2 for thresholds, a gradient with and without Min/Max, colored and uncolored value mappings, and `null`. Nightly is covered by the e2e screenshots in CI.
- `addFieldNamePicker` in field config: which fields it lists, and that it works in a **Fields returned by query** override.
- What re-enabling Thresholds, Min and Max shows for a text geometry column.
- **Feature-state cost** on 100k points with the GPU: setting every feature's color, then changing a tenth of them, against `setData` with colors as properties. If feature-state is slower than `setData`, Design §3 switches to properties and the plan is revisited before going on.
- That feature-state survives `setData` for ids that stay, and that a basemap switch drops it.

### 6.2 Engine: per-feature styles

`LayerSpec.featureStyles`, the paint fallbacks, the diff and the re-applying. Unit tests.

### 6.3 Adapter: per-feature colors and sizes

`featureStyles`, its cache, and `buildLayerSpecs`. Unit tests.

### 6.4 Options

Color by, Size by and its range, Legend, and the standard options that come back. Check the options pane on 13.2.

### 6.5 Legend and tooltips

`MapLegend` and the tooltip marker. Component tests.

### 6.6 Dashboard and e2e tests

`07-data-driven.json`, from the existing fixture columns (`utilization_pct`, `placement`, `splices_used`), and `tests/data-driven.spec.ts`.

### 6.7 Docs

- README: a **Coloring by value** section, the legend, the dashboard
- architecture.md: §2.4 per-feature styles, §5.3 the Phase 6 and 11 rows
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| 100k `setFeatureState` calls are slow. | Measured in step 6.1 against `setData`; only changed features are updated afterwards. |
| `display()` for 100k values is slow. | One call per feature, cached on the values array and config. Measured in step 6.1. |
| Thresholds and Min/Max coming back clutter the editor for text columns. | They're Grafana's standard options and show in every panel that colors by value. The README explains which column they matter on. |
| A gradient's range comes from the data, so the same value changes color after a refresh that brings a new max. | That's Grafana's behavior everywhere; Min and Max fix the range. The README says so. |
| The legend covers features. | It's small, bottom left, scrolls past a third of the map, and can be turned off. |
| `VizLegend` is Grafana's internal-looking API and may change. | It's exported from `@grafana/ui` and used by plugins. If it changes, the legend falls back to its own list items. |

---

## Decisions

Accepted as proposed (2026-11-05):

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Where the driving column is chosen | **Color by and Size by field options on the geometry field**, picking a column by name, set per query with overrides like the rest of Map style. | A switch on the value column ("Color features by this field"): one fewer step, but unclear when two columns have it on. Or a panel option: one setting for all queries. |
| 2 | How a value's color is worked out | **Grafana's display processor (`field.display`)**, per feature, in the adapter. The colors match Grafana's tables and stats exactly, including regex and range mappings. | MapLibre expressions built from the thresholds and mappings: repaints without per-feature work, but regex mappings can't be expressed and gradients would have to copy Grafana's. |
| 3 | How per-feature styles reach MapLibre | **Feature-state**, so a style change doesn't reload the layer's data, as in Phase 5. Confirmed by measurement in step 6.1. | Feature properties and `setData`: simpler, but every threshold or size change reloads the data. |
| 4 | Size by value | **Point diameter, linear between Min and Max point size across the column's Min and Max** (or data range). | Scaling by area (square root), as some maps do for counts. Or line width by value too. |
| 5 | Line style by value | **Not in Phase 6.** It comes with `byColumn` layers (Phase 11), where each value is its own layer styled with an override. | A value-to-line-style mapping editor of GeoFlow's own. |
| 6 | Missing values | **The layer's own color and size**, unless a Null value mapping gives a color. | A fixed "no value" gray. |
| 7 | Legend | **A list legend from `VizLegend` items, with a gradient bar for by-value schemes, bottom left; Legend option on by default.** | No legend in Phase 6. Or a legend below the map, taking space from it. |
| 8 | Standard options | **Thresholds, Min and Max come back, and Color scheme gets its by-value modes.** They're what the driving column needs. | Custom threshold options of GeoFlow's own on the geometry field. |
| 9 | E2E checks | **Stored screenshots for the map, DOM checks for the legend**, as in Phase 5. | Screenshots only. |

---

## Outcome

Implemented on branch `phase-6` in eight commits: one per step, and one that keeps `@grafana/schema` out of the bundle (see Findings):
- 395 unit and component tests pass, and 44 e2e tests (plus the login setup). Locally, `basemap.spec.ts`'s zoom control test failed in some runs, as it did in Phase 5 (see Findings).
- the new data-driven e2e tests compare four stored screenshots. The Phase 3 geometry and Phase 5 style screenshots still match, so layers without Color by and Size by draw as before.
- CI: to be filled in from the pull request.

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Color by: thresholds, by-value schemes, value mappings | Met. Colors match Grafana's display processor (unit test across schemes), from the column's own range (see Differences). |
| 2 | Size by | Met: linear diameters between Min and Max point size, clamped, the middle size when every value is the same. |
| 3 | Per query, with overrides | Met. The `07 Data-driven` dashboard sets Color by and Size by with **Fields returned by query** overrides. |
| 4 | Missing values | Met. Empty values keep the layer's color and size; a Null mapping with a color colors them (unit tests). |
| 5 | Legend | Met. Mappings and threshold steps as `VizLegend` items, gradients as a bar between the formatted Min and Max; the Legend option turns it off. |
| 6 | Tooltips | Met. The marker is the feature's color (component and e2e tests). |
| 7 | Highlights | Met. Hovered and selected points grow from their own radius, and keep their own color (unit tests on the paint). |
| 8 | Responsive | Met. On 100k points with the GPU, threshold changes in the panel editor caused no task over 62 ms when recoloring 20% of the points, and 130 ms when recoloring 80%. The data isn't converted or loaded again. |
| 9 | Phase 5 unchanged | Met. Layers without per-feature styles keep plain paint values, and the Phase 3 and Phase 5 screenshots match. |
| 10 | Engine boundary | Met. The engine gets colors and numbers in `LayerSpec.featureStyles`. |
| 11 | Tests | Met locally; CI to be filled in. |

### Bundle sizes (production build)

| File | Size | gzip | Change from Phase 5 |
|---|---|---|---|
| `module.js` | 48.4 KiB | 14.7 KiB | +11.3 KiB: per-feature colors and sizes, the legend, the new options |
| `maplibre.js` (engine and MapLibre CSS) | 41.6 KiB | 11.7 KiB | +1.4 KiB: feature-state paint and the feature-state diff |
| `36.js` (MapLibre) | 1139 KiB | 295 KiB | none |

### Differences from the plan

| Plan | Actual | Why |
|---|---|---|
| Ranges from the column's `state.range` | The column's own range: its Min and Max, or its data's (`getMinMaxAndDelta`) | Without Min and Max, Grafana's `state.range` spans every number column of every query (step 6.3): an `id` column up to 5000 squashed a 0–100 gradient and every size. The plan's exit criteria asked for the column's own range. **Field min/max** stays hidden, since it has no effect. |
| `display(value).color` for every feature | The same colors, worked out faster: Grafana's scale calculator for number columns without mappings, gradients in 1024 steps, the display processor once per distinct value otherwise | `display()` formats each value's text too: 193 ms for thresholds and 346 ms for a gradient on 100k features. Now 67 and 71 ms. Gradient colors come as `rgb()` where Grafana's panels show hex; they're the same colors. |
| Empty values recognized by "a display result without a color" | Checked directly, and against the column's Special value mappings | `display(null)` gives the base threshold color (step 6.1). `getValueMappingResult` isn't exported from `@grafana/data`, so the Special value mappings, the only ones that match an empty value, are checked by GeoFlow. |
| Feature-state paint on every layer | Only on layers with per-feature styles | Plain values keep Phase 5's layers exactly as they were, and a style change on them stays a cheap uniform update. Getting or losing per-feature styles repaints the layer. |
| Legend scrolls past a third of the map | Past half of it | In the `By value` panel, a third showed only the first of two entries. |
| A missing column noted in the data summary | Also a number check: Size by on a text column says so | The picker only offers number columns, but a saved name can point at a column that changed type. |
| Screenshots like Phase 5's, 300 × 200 px | 300 × 240 px at zoom 13.2, with the legend hidden (`stylePath`) | Every feature of the fixture network fits, inside the panel editor's map too. Masking the legend hid a third of the features in the By value panel. |

### Findings for later phases

- **Grafana's default range is global.** Without Min and Max, `applyFieldOverrides` gives every number column one range across all number columns of all queries. Anything else that scales by a column's value (Phase 11's per-value colors, a future line width by value) should use the column's own range, as `featureStyles` does.
- **`@grafana/schema` is bundled,** not provided by Grafana. Importing its enums (such as `LegendDisplayMode`) adds them to `module.js`; prefer defaults or string literals.
- **The field name picker is a Combobox** in Grafana 13.2, and lists display names from every query. `@grafana/plugin-e2e`'s `getSelect` looks for the Select menu, so tests click its option by role.
- **The counting test hook is expensive at 100k points:** `renderedFeatureCounts` took one 323 ms task on its own. Performance measurements (Phase 9) shouldn't count features while measuring.
- **Local e2e flakiness** in `basemap.spec.ts` (real OpenStreetMap tile requests) continues from Phase 5.

### Step 6.1 findings

The display processor was checked with `applyFieldOverrides` and `@grafana/data` 13.2.5 in a throwaway Jest test, and feature-state with MapLibre 6.16 in a page of its own: 100k points, one circle layer, Playwright's Chromium on this machine's GPU (`--enable-gpu --ignore-gpu-blocklist --use-angle=gl`, as in Phase 4). The options pane checks (`addFieldNamePicker` in an override, Thresholds on the text geometry column) need the options, so they're done in step 6.4.

| Check | Result |
|---|---|
| Thresholds | `display(v).color` gives each value its step's color, with Color scheme **From thresholds** and also with no scheme set. GeoFlow's default scheme is Classic palette, so a column needs **From thresholds** set, as the plan has it. |
| By-value gradient | Green-Yellow-Red across the data's range without Min and Max (`state.range` 0–100: green, yellow, red), and across Min/Max when set (0–200: 100 is yellow). |
| Value mappings | A mapping with a color gives that color, and its text (`underground` → "UG", blue). A mapping without a color, and a value no mapping matches, get the scheme's color: the base threshold, or the column's palette color. That's what a table cell shows. |
| Empty values | **Differs from the plan.** `display(null)` doesn't come back without a color: it gives the base threshold color (or the gradient's first). Design §2 relies on "a display result without a color", so an empty value is checked against the column's mappings directly (`getValueMappingResult`): a matching Null mapping with a color gives that color, anything else keeps the layer's. |
| Text columns | Classic palette gives every value the column's one series color; thresholds don't apply to text. Coloring by a text column needs value mappings, as in Grafana's tables. |
| Feature-state cost | Setting color and radius on all 100k points: under 25 ms of calls, then one task of 228 ms the first time and 163–171 ms after. Changing half: one task of 86 ms. A quarter or fewer: no task over 50 ms. Removing all states: 172 ms. |
| `setData` with colors as properties | 231–239 ms, then two or three more tasks of 50–65 ms, every time. **Feature-state is cheaper,** and much cheaper for partial changes, so Design §3 stands. |
| Comparing 100k colors | 1 ms, so diffing against the last styles before calling MapLibre costs nothing. |
| Feature-state across `setData` | Kept for ids that stay, as the plan expected. |
| Feature-state across a basemap change | Dropped by a style loaded from scratch, so the engine sets it again on `style.load`, as planned. |

Exit criterion 8 (no task over 200 ms) holds for changes that recolor up to about half the features. A change that recolors every one of 100k points costs about 170 ms after the first, and 230 ms the first time, which comes with loading the layer anyway.

**Options pane checks** (step 6.4, Grafana 13.2.4):

| Check | Result |
|---|---|
| `addFieldNamePicker` | A Combobox listing the display names of every query's columns (`id`, `name`, `geometry`, `cable_type`, `mount` on the 06 Style dashboard). With a `filter` on number fields, Size by listed only `id`. Saved in **Fields returned by query** overrides, both apply to that query's layer (the `07 Data-driven` dashboard). |
| Thresholds, Min and Max on the text geometry column | Shown with Grafana's defaults (Base green, 80 red) on every field, as in Grafana's other panels. They have no effect on the geometry column. Min's help text is Grafana's ("Leave empty to calculate based on all values"); GeoFlow uses the column's own data instead, which the README explains. |
