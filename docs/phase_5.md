# Phase 5: Style options

Status: **Implemented** (2026-11-04). Decisions 1–8 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §2.2 (panel layer), §2.3 (adapter), §2.4 (engine layer, drawing data), §3.4 (layer binding), §5.3 (Phase 5 and 6 rows), §7 (features considered for later).

## Goal

Let users style what the map draws: the color, opacity, point size, line width, line style and fill opacity of each query's features.

Styles are set the way Grafana's own panels set them: in the panel's field options, as defaults for every query and as overrides for one query. Someone who has styled a time series panel already knows where to look.

This phase adds:
- style options in the field config: Grafana's standard **Color scheme**, and GeoFlow's **Opacity**, **Fill opacity**, **Line width**, **Line style** and **Point size**
- the adapter reading each layer's style from its geometry field's config
- layer opacity and dash patterns in the engine
- conversion that isn't repeated when only options change
- a basemap select in place of the radio buttons whose labels are cut off

## Exit criteria

1. **Defaults look the same.** A panel saved before Phase 5 draws exactly as it did in Phase 4: each query in the next color of Grafana's classic palette, 35% fill, 2 px lines, 10 px points. The Phase 3 geometry screenshots don't change.
2. **Color.** **Standard options → Color scheme** sets the color of all layers:
   - **Classic palette** (default): each query gets the next palette color, in query order, as now
   - **Single color**: one color for every layer, alpha included
   - **Shades of a color** and **Classic palette (by series name)** behave as in Grafana's other panels

   By-value schemes (thresholds, gradients) aren't offered, since the color doesn't come from a value (see Out of scope).
3. **Style options.** A **Map style** group in the field options has:
   - **Opacity** (0–100%, default 100%): the whole layer, fills included
   - **Fill opacity** (0–100%, default 35%): polygon interiors
   - **Line width** (1–10 px, default 2): lines
   - **Line style** (Solid, Dashed, Dotted, Custom; default Solid): lines, as in the time series panel
   - **Dash pattern** (Custom only): dash and gap lengths in pixels, separated by commas, for example `8, 4, 2, 4`
   - **Point size** (2–40 px, default 10): point diameter, as in the time series panel
4. **Per query.** An override with **Fields returned by query** styles one query's layer. An override by field name (for example `geometry`) works too.
5. **Highlights follow the style.** Hovered and selected features stand out from whatever style is set: wider, larger and with a stronger fill, as in Phase 4.
6. **Tooltip color.** The color marker in a tooltip's header is the layer's color.
7. **No redraw of data.** Changing a style option updates the map's paint only. It doesn't convert the data again or send it to MapLibre again, so a slider on a 100k-feature layer stays responsive.
8. **Basemap option.** The basemap is a select, so its options aren't cut off.
9. **Bad values are safe.** Out-of-range or missing values (an old dashboard, hand-edited JSON) fall back to the defaults or are clamped, never breaking the map. A dash pattern that can't be used shows why under the field, and the line is drawn solid.
10. **Engine boundary.** The engine stays free of Grafana; it receives resolved colors and numbers.
11. **Tests.** Unit, component and e2e tests pass locally and in CI. E2E tests change style options in the panel editor and check the drawn result.

## Out of scope

- **Data-driven styling**, such as color or size from a column's value (thresholds, gradients, value mappings): Phase 6, which builds on this phase's field config. Phase 5 keeps it in mind (Design §4).
- **The layer editor** (names, visibility, order, per-layer geometry column): Phase 7. Per-layer styling is already possible with overrides (exit criterion 4).
- **Per-value colors** for `byColumn` layers: Phase 11.
- **Point symbols** (icons, shapes other than circles). Points stay circles. See [architecture.md §7](architecture.md#7-features-considered-for-later).
- **Dashed polygon outlines.** Line style applies to lines (decision 8).
- **Polygon outline width.** Outlines stay at 1 px, so dense buildings don't turn into solid color (Phase 3); see decision 5.
- **Data drawn below a style URL's labels.** See [architecture.md §7](architecture.md#7-features-considered-for-later).

---

## Starting point

| Already in place | From |
|---|---|
| `LayerStyle` has `color`, `fillOpacity`, `lineWidth`, `pointRadius` and `outlineColor`, all resolved values. `buildLayerSpecs` fills them from `DEFAULT_LAYER_STYLE` and the theme's classic palette, by layer position. | Phase 3 |
| `setLayers` applies a changed style with `setPaintProperty`, without touching the data. `paintFor` builds paint values, compared as JSON. | Phase 3, 4 |
| Highlight paint: `['case', highlighted, value, normal]` expressions on line width, point radius and stroke, and fill opacity. | Phase 4 |
| `useFieldConfig()` with the standard options for tooltips; **Color** and **Thresholds** are hidden. | Phase 4 |
| Conversion is cached per frame object. | Phase 3 |
| Screenshot comparisons of the geometry dashboard, with tiles stubbed. | Phase 3 |

**What Grafana offers** (to confirm in step 5.1 on Grafana 13.2 and nightly):

| Need | Available |
|---|---|
| A color option with palette and fixed modes | The standard **Color scheme** option. Its settings `byValueSupport: false` and `bySeriesSupport: true` leave out the by-value modes. |
| A color for a field | `getFieldColorModeForField(field).getCalculator(field, theme)`. For palette modes it reads `field.state.seriesIndex`, which Grafana counts across every non-time field of every frame. |
| Style options with defaults and overrides | Custom field config (`useCustomConfig`), as the time series panel does for line width, fill opacity and point size. Overrides match with **Fields returned by query** or by name. |

**The cost of field config.** Grafana applies field config by building new frame objects (`applyFieldOverrides`). Any change to a field option, including a style slider, hands the panel new frames. The conversion cache is keyed by frame object, so today every such change converts the data again and sends it to MapLibre again. On 100k features that's hundreds of milliseconds per slider step. Design §3 keys the cache on the column data instead. Grafana keeps the same `values` arrays in the new frames; step 5.1 confirms this.

### Changes to the architecture

- **Styles in field config, not in the layer list.** Architecture §3.4 has per-layer style in the layer configuration (Phase 7). This plan puts style in field config instead (decision 1). Each frame's geometry field carries its layer's style, and per-query style is an override. The Phase 7 layer editor then covers names, visibility, order and the geometry column, not style. §3.4, §2.2 and the Phase 7 row say so (updated on approval).
- **Conversion cache keyed on data, not frames.** A small step toward Phase 8's "skip frames with the same content": only the part that field config changes forced.

---

## Design

### 1. Options (`module.ts`, `options.ts`)

Field config:
- **Color scheme** comes back from the hidden standard options, with:
  - `defaultValue: { mode: FieldColorModeId.PaletteClassic }`
  - `settings: { byValueSupport: false, bySeriesSupport: true, preferThresholdsMode: false }`
- **Thresholds** stay hidden.
- Custom options in a **Map style** category, next to **Hide in tooltip** under **Tooltip**:

| Path | Editor | Range | Default |
|---|---|---|---|
| `opacity` | slider, % | 0–100 | 100 |
| `fillOpacity` | slider, % | 0–100 | 35 |
| `lineWidth` | slider, px | 1–10 | 2 |
| `pointSize` | slider, px | 2–40 | 10 |
| `lineStyle` | radio | `solid`, `dash`, `dot`, `custom` | `solid` |
| `dashPattern` | text, with validation (like `UrlEditor`); shown when Line style is Custom | see below | empty |

**Dash pattern.** `parseDashPattern(text)` (in the adapter, so the editor and `layerStyle` share it) returns the lengths in pixels, or why they can't be used:
- Numbers separated by commas or spaces: dash, gap, dash, gap…
- Each number finite and 0 or more, at least one above 0, at most 16 numbers.
- An odd count is repeated, as in SVG and the browser canvas: `5, 3, 2` means `5, 3, 2, 5, 3, 2`. MapLibre would instead join the last number to the first dash, so the list is always doubled before it reaches the engine.

The editor shows the problem under the field ("Use numbers separated by commas, for example 8, 4"), and the layer draws solid until it's fixed.

`GeoFlowFieldConfig` gains these four. The sliders follow the time series panel's style (`addSliderInput`, step 1).

Panel options: **Basemap** becomes a select (`addSelect`) with the same values and labels, so a saved dashboard needs no migration.

### 2. Layer style (`src/adapter/layerStyle.ts`, new; `buildLayerSpecs`)

```ts
/** The style of the layer drawn from `frame`, from its geometry field's config. */
function layerStyle(
  frame: DataFrame,
  result: ConversionResult,
  layerIndex: number,
  theme: GrafanaTheme2
): LayerStyle;
```

- Reads the geometry field's `config.custom` and `config.color`. A Feature column (`ST_AsGeoJSON(t.*)`) is the geometry field too.
- Each number is clamped to its range. A missing or non-numeric value takes the default, so pre-Phase 5 dashboards draw as before. An unknown line style, or Custom with a pattern that doesn't parse, is solid.
- **Color** (decision 2):
  - Classic palette: the theme palette color at `layerIndex`, the layer's position among layers, as in Phase 3. Grafana's series index counts every column, so it would change the colors of existing dashboards and depend on column count.
  - Every other mode: Grafana's own calculator for the field, so Single color, Shades and By-name behave exactly as in other panels.
- Percentages become 0–1. Point size becomes `pointRadius = size / 2`.
- `outlineColor` stays the theme background, for contrast.

`buildLayerSpecs(results, frames, theme, { interactive })` calls it for each layer. `LayerDefaults` goes away; the theme is passed in, which keeps the function pure. The panel no longer resolves the palette.

### 3. Conversion cache (`convertFrames.ts`)

The cache moves from the frame object to the frame's data:
- Key: the geometry field's `values` array, in a `WeakMap`.
- Kept when: `refId`, the field names and every field's `values` array are the same objects as when it was converted.

A frame that only has new field config then reuses its `ConversionResult`, and the same `FeatureCollection` object goes to the engine, which skips `setData`. `featureDetails` already reads display values from the current frame, so tooltips show new units at once. Frames with new values (a refresh) are converted as before.

### 4. Engine (`LayerStyle`, `paintFor`)

```ts
interface LayerStyle {
  // ...Phase 3 fields...
  /** The whole layer's opacity, 0–1: lines, points, outlines and fills. */
  opacity: number;
  /** The pattern of lines (not polygon outlines). */
  lineStyle: LineStyle;
}

type LineStyle =
  | { kind: 'solid' | 'dash' | 'dot' }
  /** Dash and gap lengths in pixels, an even number of them. */
  | { kind: 'custom'; pattern: number[] };
```

`paintFor` adds:
- `line-opacity` on lines and outlines, `circle-opacity` and `circle-stroke-opacity` on points: `opacity`
- `fill-opacity`: `fillOpacity × opacity`, and for highlights `min(1, fillOpacity + 0.25) × opacity`
- `line-dasharray` on lines, for dashed and dotted styles. Lengths are in line widths, and the round line caps add half a width to each end of every dash, so the arrays allow for them:
  - Dashed: `[3, 3]`, drawn as dashes of 4 widths with gaps of 2
  - Dotted: `[0, 2]`, drawn as round dots one width across, 2 widths apart
  - Solid: no dash array
  - Custom: the pattern divided by the line width, drawn with **flat line ends** (`line-cap: butt`), so dashes and gaps come out at the lengths typed. Round ends would add a width to every dash. `8, 4` on a 2 px line becomes `[4, 2]`.

  Line ends are a layout property, not paint. `setLayers` today only diffs paint, so a `layoutFor` next to `paintFor` gives the line layer's `line-cap`, and a style change calls `setLayoutProperty` when it differs.

  `line-dasharray` can't read feature-state, but highlights only change the width, and the pattern scales with it: a highlighted custom pattern is a little longer, in proportion. Step 5.1 checks the dotted pattern draws as dots.

Highlights keep their Phase 4 increments on top of the set style. `DEFAULT_LAYER_STYLE` gains `opacity: 1` and stays the engine's fallback. No other engine change: `setLayers` already repaints when a style changes.

**Room for Phase 6.** Data-driven styling gives each feature its own color, size or line style (`line-dasharray` accepts per-feature values in MapLibre 6). `LayerStyle.color` and `pointRadius` stay single values in Phase 5, but `paintFor` builds every paint value in one place, so Phase 6 can swap a value for a per-feature expression there without touching the rest of the engine. Nothing in Phase 5 assumes a layer has one color, apart from the tooltip's color marker, which Phase 6 gives the feature's color.

### 5. Panel (`MapPanel.tsx`, `useFeatureTooltip.tsx`)

- `buildLayerSpecs` gets `data.series` and the theme.
- The tooltip's color marker already reads the layer's color.

### 6. Testing approach

**Unit tests:**
- `layerStyle`:
  - defaults on a field with no config
  - each option, clamping and bad values
  - every color mode, and palette by layer position
  - overrides that apply to one frame
- `paintFor`: opacity on each paint property, highlights with opacity, and the dash array for each line style, including custom patterns in line widths
- `layoutFor`: flat ends for Custom, round otherwise; `setLayers` applies a changed `line-cap`
- `parseDashPattern`: separators, decimals, zeros, odd counts, and each kind of bad input
- `convertFrames`: reused for a frame with new config and the same values; converted again for new values, a new field or a new refId
- `buildLayerSpecs`: styles per frame

**Component tests (`MapPanel`):** a field config change reaches `setLayers` with a new style and the same data object.

**E2E (`06-style.json`, `tests/style.spec.ts`):**
- **Defaults:** the existing geometry screenshots still match.
- **Per query:** a panel with two queries and overrides (Single color, wider lines, larger points) matches a stored screenshot.
- **Option change:** in the panel editor, change **Color scheme** to Single color, **Line width**, **Line style** (Dashed) and **Point size**; the panel matches its stored screenshot. Then Custom with `12, 4, 2, 4`: the panel matches another screenshot; and `12, x`: the field shows its message and the line draws solid. Then **Opacity** 0: the drawn feature counts stay, and the screenshot matches the basemap alone.
- **Basemap select** still switches basemaps (update `basemap.spec.ts` for the select).

Screenshots use the stubbed tiles, like the geometry tests, so they don't depend on OpenStreetMap.

---

## Steps

Each step is one commit, tested before the next.

### 5.1 Checks on Grafana 13.2 and nightly

- The Color scheme option with `byValueSupport: false` offers only the expected modes, on a string field.
- Custom field config defaults reach a string geometry field, and **Fields returned by query** overrides apply to it.
- After a field config change, the new frames keep the same `values` arrays.
- `getFieldColorModeForField` gives the same colors in 13.2 and nightly.
- MapLibre draws `[0, 2]` with round caps as dots, and `[3, 3]` as even dashes, at line widths 1 to 10. A custom pattern with flat ends comes out at the typed pixel lengths.
- `showIf` on a custom field option hides **Dash pattern** unless Line style is Custom, in defaults and in overrides.

Findings go in the Outcome. If `values` aren't kept, Design §3 falls back to keying on a cheap content check of the geometry column, and the plan is revisited before going on.

### 5.2 Engine: layer opacity and line style

`LayerStyle.opacity` and `lineStyle`, `paintFor`, `layoutFor` and the layout diff in `setLayers`, `DEFAULT_LAYER_STYLE`. Unit tests.

### 5.3 Conversion cache keyed on data

`convertFrames`. Unit tests.

### 5.4 Adapter: layer style from field config

`layerStyle`, the new `buildLayerSpecs` signature, the panel passing frames and the theme. Unit and component tests.

### 5.5 Options

Color scheme, the Map style options with the Dash pattern editor and `parseDashPattern`, the basemap select. Check in the panel editor on 13.2 that the labels fit.

### 5.6 Dashboard and e2e tests

`06-style.json` and `tests/style.spec.ts`; `basemap.spec.ts` for the select.

### 5.7 Docs

- README: a **Styling** section (options, per-query overrides), the `06 Style` dashboard
- architecture.md:
  - §2.4 Drawing data: `opacity`, styles from field config
  - §3.4: style in field config, not layer config
  - §5.3: the Phase 5 row (as built) and the Phase 7 row (the layer editor without style)
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| Field config changes convert and redraw the data on every slider step. | Design §3, confirmed in step 5.1. Exit criterion 7 is checked with the `large` dashboard. |
| Classic palette by layer position differs from Grafana's by-series index, so a GeoFlow layer and a time series panel on the same query may get different colors. | Accepted for unchanged defaults (decision 2). Single color or By-name gives the same color everywhere. |
| By-name colors hash the field's display name. Every query's geometry field may be called `geometry`, so every layer gets the same color. | Step 5.1 checks the display name Grafana gives when several frames share a field name. If they collide, By-name hashes the layer's name (`refId` or frame name) instead, and the README says so. |
| The Color scheme option may appear for every field in the editor, though only the geometry field's matters. | Its description says so. The same holds for the Map style options. |
| Screenshots differ between local GPU and CI's software rendering. | The Phase 3 geometry snapshots already pass in both; the same settings and tile stub are used. |

---

## Decisions

Accepted as proposed (2026-11-04):

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Where style options live | **Field config: Grafana's Color scheme and custom options, per query with overrides.** Grafana's own pattern (time series), per-query styling now, and the Phase 7 layer editor gets simpler. Phase 6 then picks the column that drives a style the same way, per query, without the layer editor. Costs the conversion cache change (Design §3). | Panel options, one style for every layer, with per-layer styles in the Phase 7 layer editor (the architecture's plan). No per-query style until Phase 7, and a style UI of our own. |
| 2 | Classic palette colors | **By layer position**, as in Phase 3, so existing dashboards keep their colors. | Grafana's series index: matches other panels on the same query only when frames have the same columns, and changes today's colors. |
| 3 | Opacity | **A layer Opacity that multiplies everything, fills included**, plus Fill opacity for interiors. Matches Geomap's layer opacity. | Only the color's alpha (the color picker supports it), which doesn't work with palette colors. Or opacity for lines and points only, separate from fills. |
| 4 | Point size | **Diameter in px, named Point size,** as in the time series panel. | Radius, as MapLibre takes it. |
| 5 | Polygon outlines | **Stay 1 px.** Line width applies to lines. | Follow Line width (thick outlines merge dense polygons), or a separate Outline width option. |
| 6 | Basemap option | **A select**, same values. | Shorter radio labels ("OSM", "Tiles", "Style", "None"). |
| 7 | E2E style checks | **Stored screenshots** with stubbed tiles, as for geometry. | A test hook reporting each layer's paint values: tests the wiring, not the drawing. |
| 8 | Line style | **Solid, Dashed, Dotted and Custom, for lines only.** Custom takes dash and gap lengths in pixels, comma-separated; odd counts repeat, as in SVG. Outlines stay solid, so a polygon's edge doesn't look like a line. | Presets only (simpler, but no way to tell apart several dashed line types). Custom lengths in line widths, as MapLibre takes them (less intuitive). Or dashed outlines as well. |

---

## Outcome

Implemented on branch `phase-5` in seven commits, one per step:
- 346 unit and component tests pass, and 40 e2e tests (plus the login setup)
- the new style e2e tests compare six stored screenshots, and the Phase 3 geometry screenshot still matches, so the defaults draw as before
- CI on PR #25 passes build, lint, unit tests and e2e tests on Grafana 13.2.5, 13.3.0 and nightly. The style screenshots match on all three, so Grafana's color schemes give the same colors on each (the nightly part of step 5.1).

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Defaults look the same | Met. The geometry screenshot is unchanged, and `layerStyle` with no config gives Phase 4's style (unit test). |
| 2 | Color scheme: classic palette, single color, shades, by name; no by-value modes | Met (step 5.1). By name hashes the layer's name (see Findings). |
| 3 | Map style options | Met: Opacity, Fill opacity, Line width, Line style (with Dash pattern) and Point size. |
| 4 | Per query, with overrides | Met. The `06 Style` dashboard's Per query and Line styles panels use **Fields returned by query** overrides. |
| 5 | Highlights follow the style | Met. Highlights add Phase 4's increments to the set style, and opacity applies to them too (unit tests). |
| 6 | Tooltip color marker is the layer's color | Met, unchanged code: the marker reads the layer's style. |
| 7 | No redraw of data on a style change | Met. On 100k points with the GPU, three Point size changes caused no main-thread task over 50 ms; a refresh, which converts the data, caused one of 351 ms. |
| 8 | Basemap select | Met. Line style is a select too (see Differences). |
| 9 | Bad values are safe | Met. Out-of-range numbers are clamped, other values take the default, and an unusable dash pattern says why under the field and draws solid (unit and e2e tests). |
| 10 | Engine boundary | Met. The engine gets resolved colors, numbers and a `LineStyle`. |
| 11 | Tests | Met locally and in CI (e2e on 13.2.5, 13.3.0 and nightly). |

### Bundle sizes (production build)

| File | Size | gzip | Change from Phase 4 |
|---|---|---|---|
| `module.js` | 37.1 KiB | 12.1 KiB | +4.7 KiB: the style options, `layerStyle`, the dash pattern parser |
| `maplibre.js` (engine and MapLibre CSS) | 40.2 KiB | 11.2 KiB | +0.5 KiB: opacity, dash arrays and the layout diff |
| `36.js` (MapLibre) | 1139 KiB | 295 KiB | none |

### Differences from the plan

| Plan | Actual | Why |
|---|---|---|
| Line style as radio buttons | A select | Four radio buttons don't fit the options pane: the labels were cut to "S…", "Das…" (found in step 5.5). |
| By name: Grafana's calculator, with a fallback if colors collide | The layer's name is always hashed | Step 5.1 found every layer got the same color: each query's geometry column is called `geometry`. |
| The conversion cache keyed on the geometry field's `values` | Keyed on the first field's `values`, still checking every field's name and `values` | The same result, without detecting the geometry column before looking in the cache. |
| A text editor "like `UrlEditor`" for the dash pattern | `UrlEditor` became `CheckedTextEditor`, used by the basemap URLs and the dash pattern | One editor that shows why a value can't be used, for panel and field options. |
| The paint diff in `setLayers` | Also resets paint properties a new style no longer sets, and diffs layout | Going back to a solid line must clear the dash array; custom patterns change `line-cap`. |

### Findings for later phases

- **Field config builds new frames.** Grafana's `applyFieldOverrides` copies frames and fields on every field option change, around the same `values` arrays. Anything cached by frame object misses after a style change. Phase 8's structural check for refreshes can build on the `values` key.
- **Shades use Grafana's series index,** which counts every non-time column of every query. The shade of a layer depends on how many columns the queries before it have. Acceptable for a scheme meant to tell layers apart, not to fix a color.
- **Dotted lines at 1 px** are single-pixel dots, which read as a faint dotted line. Thicker lines show round dots.
- **The panel editor's map is wider and shorter** (580 × 246 px at the test viewport) than the dashboard's (409 × 322). Screenshots around the map's center use 300 × 200 px, which fits both.
- **Grafana nightly shows the dashboard before the panel editor.** With nightly 13.3.0-34793047961, opening `?editPanel=8` showed the whole dashboard for a moment. `PanelEditPage.panel` from `@grafana/plugin-e2e` matches every panel header, so a test that used it straight away found all ten panels and failed (3 times in 8 locally, every attempt in CI). The e2e tests now open the edited panel through `editedPanel()` in `tests/fixtures/`, which waits for the editor's options pane and then for a single panel.
- **Local e2e flakiness.** Some basemap and adapter tests occasionally don't see the map canvas within the default 5 s on this machine. The same tests fail the same way on `main`, so it isn't from Phase 5; CI has been green. Worth a look in Phase 9 (hardening).

### Step 5.1 findings

Checked on Grafana 13.2.4 with a temporary dashboard of three queries (buildings, cables, splice cases) and a debug hook that was removed afterwards. Nightly is covered by CI, where the style screenshots run on every Grafana version: they matched on 13.2.5, 13.3.0 and nightly.

| Check | Result |
|---|---|
| Color scheme modes | With `byValueSupport: false`, the editor offers exactly **Single color**, **Shades of a color**, **Classic palette** and **Classic palette (by series name)**, on the text geometry column. |
| Field config on the geometry column | The Map style defaults reach the string geometry field's `config.custom`, with every default filled in. A **Fields returned by query** override (query B: Custom line style, `8, 4`, Single color red) applies to that query's geometry field only. |
| Data arrays after an option change | Changing **Fill opacity** hands the panel new frame objects, but every field's `values` array is the same object as before. `applyFieldOverrides` copies fields with `...originalField`. Design §3's cache key works as planned. |
| By-name colors | **Risk confirmed.** Grafana hashes the field's display name, or its name when there's none. Every layer's geometry column was called `geometry`, so all three layers got the same color. `layerStyle` hashes the layer's name (the frame name, or its refId) instead. The three layers then got three colors. |
| Shades | Uses Grafana's series index, which counts every column: three layers got three different shades. |
| Dash patterns | At 1 px and 10 px, **Dashed** (`[3, 3]`, round ends) draws even dashes, and **Dotted** (`[0, 2]`) round dots. At 1 px the dots are a single pixel, so a dotted line reads as a faint dotted line. **Custom** `12, 4, 2, 4` with flat ends comes out at the typed pixel lengths. |
| Dash pattern visibility | `showIf` hides **Dash pattern** in the defaults while Line style is Solid. In an override, it shows once added as a property, whatever the line style. That's how Grafana lists override properties, and harmless: the pattern is ignored unless the line style is Custom. |
| Field option editor types | `FieldConfigEditorBuilder.addGenericEditor` types the editor's props with the settings type as the value type. The Dash pattern editor is passed with a cast, commented in `module.ts`. |
