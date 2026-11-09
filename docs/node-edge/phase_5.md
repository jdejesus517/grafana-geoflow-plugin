# Node-edge Phase 5: Styling by edge values

Status: **Plan accepted** (2026-11-09). Decisions 1–8 accepted as proposed.
Architecture reference: [architecture.md](architecture.md) §6.1 (hover, from Phase 5), §6.3 (styling), §7 (Edge value), §9.3 (Phase 5 row); decisions 3, 10, 11, 12.

## Goal

Color and size edge lines by their edge values: the CARY-CORE to RALEIGH-CORE line red because its four trunks together run at 68%, and wider than the others because they carry 211 Gb/s between them. Hovering a styled line says why it looks as it does.

## Exit criteria

1. **Edge value.** An **Edge value** field option in the Edges category (Sum, Average, Min, Max, Count; Sum by default) sets the one value each edge line takes from a column, over its rows. A ratio column's edge value is always its ratio of sums (architecture decision 10).
2. **Color by on edges.** Each edge line is drawn in the color Grafana gives its edge value, through the Color by column's thresholds, by-value scheme or value mappings, as Phase 6 colors features. A gradient spans the edge values, or the column's Min and Max when they're set.
3. **Size by on edges.** Each edge line's width scales linearly with its edge value, from **Min size** to **Max size**, across the edge values or the column's Min and Max. Values outside the range are clamped.
4. **Text columns.** An edge line takes a text column's value when all its rows share it ("fiber"), and has none when they differ, keeping the layer's color. With Edge value Count, it takes the column's count instead (decision 2).
5. **Missing values.** A pair without a value (no rows with one, a ratio whose denominators sum to zero, or mixed text) keeps the layer's color and Line width.
6. **Legend.** An edge layer colored by a column gets a legend entry, as other layers do. A gradient's ends are the edge values' range, and the column is named with its edge value ("capacity_gbps (sum)").
7. **Hover.** Hovering an edge line shows Between and Items, then the edge values behind Color by and Size by when the layer has them: at most four lines, so nothing is ever cut off where a hover can't scroll (decision 6). Aggregates and ratios move to the pinned Summary, which scrolls and shows everything, the styled values included.
8. **Highlights.** Hovered and selected edge lines get wider from their own width, keeping their own color.
9. **Responsive.** Changing a threshold, Edge value or the size range repaints the edges without joining them again or reloading their data.
10. **Engine.** Per-feature line widths through feature-state (`FeatureStyles.widths`). Layers without them draw exactly as before, and the existing screenshots don't change.
11. **Warnings.** The "Color by and Size by on edges come in a later version" notice is gone. A Color by or Size by column that isn't there, or a Edge value that doesn't apply to its column (Sum of a time column), shows in the data summary and on the map, as for other layers.
12. **Tests.** Unit tests on edge values, ranges, colors, widths and the hover; engine unit tests on widths; e2e screenshots of styled networks, legend DOM checks and the hover.
13. **Docs.** The README gains a section on styling edges.

## Out of scope

- **Line width by value on ordinary line layers:** the engine can do it after this phase, but Size by stays point-only there (decision 3); listed in [../architecture.md](../architecture.md) §7.
- **Styling by direction** (a pair colored by its busier direction): architecture §12, aggregates split by direction.
- **A size legend:** the legend shows colors only, as in Phase 6.
- **The large network benchmark:** Phase 6.

---

## Starting point

| Already in place | From |
|---|---|
| Color by and Size by field options, read from the style column's config; `featureStyles` with Grafana's display processor and a gradient cache; `columnRange` from Min and Max or the data | Phase 6 |
| Per-feature colors and radii in the engine through feature-state (`COLOR_STATE`, `RADIUS_STATE`), diffed by `featureStateChanges` | Phase 6 |
| Legend entries from the Color by column (`legendEntries`), with gradients and threshold items | Phases 6, 7 |
| Edge results with `pairs`; the from column as the style column (`styleField`), so Map style already reaches edge layers | Node-edge Phase 1 |
| `pairDetails` with aggregates and `ratioOfSums`; the Edges field options | Node-edge Phase 3 |
| The pinned Summary \| Items switch, so the hover no longer has to hold everything | Node-edge Phase 4 |
| `buildLayerSpecs` skips per-feature styles on edge layers, and `layerSettingProblems` warns that they come later | Node-edge Phase 1 |

### Changes to the architecture

- **§6.1:** the hover shows Between, Items and the styled edge values on every edge layer, styled or not; aggregates and ratios are in the pinned Summary only (decision 6).
- **§6.3:** text columns take the pair's shared value (decision 2); Size by is labeled Min size and Max size, for points and edge lines alike (decision 4); the legend names the edge value.
- **§6.3, §7, decision 11:** the option planned as Pair value (`pairValue`) is **Edge value** (`edgeValue`), named in the settings' own terms (decision 8). Its Count also applies to text columns, which is how lines are styled by their number of rows without a number column.

---

## Design

### 1. Edge values (`edgeValues.ts`, new, adapter)

`edgeValues(frame, result, field)` returns one value per pair, in feature order, cached per conversion, column and Edge value:
- **Ratio column** (both Ratio fields found): `ratioOfSums`, moved here from `pairDetails.ts` and shared.
- **Number column:** the column's Edge value over the pair's non-empty rows: sum, mean, min, max, or count. The arithmetic is `aggregateText`'s, split out as `aggregate(field, kind, rows)` returning a number, which `pairDetails` then formats.
- **Time column:** min and max as for numbers, count as for any column; sum and mean give no value, with a problem (§6).
- **Other columns (text, boolean):** count, or else the value all non-empty rows share, or none (decision 2).

`edgeValueRange(frame, result, field)`: the column's Min and Max when set in its config, otherwise the min and max of the edge values; undefined for non-number values. It takes the place of `columnRange` for edges (architecture §6.3: sums exceed every row's value).

### 2. Colors and widths (`featureStyles.ts`)

`featureStyles` reads values per feature through one function: `field.values[row]` over `featureRows` for other layers, `edgeValues` for edge layers. The rest is shared:
- **Colors:** `colorOf`, with the field's range set to `edgeValueRange`. Counts and other number edge values of a non-number column are colored as numbers: the field passed to `colorOf` has `type: number` (decision 2's Count of `trunk_id`).
- **Widths:** for an edge layer, Size by gives `widths`, not `radii`: Min size to Max size across `edgeValueRange`, as `featureRadii` maps values, without halving. A pair without a value keeps Line width.
- **Caching:** as today, by conversion and column, with the Edge value in `inputs`. A changed threshold or Edge value recomputes the values but keeps the edge result, so nothing is joined or loaded again.

`buildLayerSpecs` drops its edge exception: edge layers get `featureStyles` like any layer.

### 3. Engine: per-feature widths (`types.ts`, `layerStyle.ts`, `featureState.ts`)

- **`FeatureStyles.widths?: Array<number | undefined>`**, line widths in px; **`WIDTH_STATE = 'width'`**.
- **`perFeature`** gains `width`. The `line` style layer's `line-width` becomes `['coalesce', ['feature-state', 'width'], lineWidth]`, highlighted as `['+', …, HIGHLIGHT.width]`, as radii are. Polygon outlines keep 1 px.
- **`featureStateChanges`** diffs three keys instead of two.
- **Dash patterns** are in line widths, so dashed and dotted lines scale with each line's width. A custom pattern's pixel lengths hold at the layer's Line width and scale with wider lines. Step 5.1 checks that MapLibre scales dashes per feature when the width comes from feature-state.

### 4. Legend (`legend.ts`)

For an edge layer, the gradient's ends are `edgeValueRange`'s, formatted with the column's unit (a count as a plain number). Threshold and mapping items are built as now. The entry's `column` reads "capacity_gbps (sum)", or "trunk_id (count)"; a ratio column keeps its name alone, since its unit says what it is.

### 5. Hover and Summary (`pairDetails.ts`, `useFeatureTooltip.tsx`)

`pairDetails(frame, result, featureId, { view })`, with `view` `'hover'` or `'summary'`:
- **Styled values:** the Color by and Size by columns' edge values, formatted as the column shows them: "capacity_gbps: sum 211 Gb/s", "trunk_id: count 4", "utilization: 68%", "medium: fiber". One line when both options name the same column.
- **Hover:** Between, Items, then the styled values in column order, if any. No aggregates or ratios: they're in the Summary.
- **Summary:** the full summary, plus each styled value whose aggregate the column doesn't already show. So the Summary holds everything the hover does.
- **`tooltipFeatures`** passes `'summary'` when pinned, `'hover'` otherwise. The marker's color is already the pair's.
- **Aggregates option:** described "Edge layers: totals shown in a clicked edge line's Summary, over the links between its two nodes…", no longer "when an edge line is hovered"; Ratio numerator's description likewise.

### 6. Options and warnings (`module.ts`, `panelProblems.ts`)

- **Edge value:** a select in the Edges category, after Aggregates: "Edge layers: the value an edge line takes from this column when it's colored or sized by it, over the links between its two nodes. Ratio columns use their ratio of sums." Default `sum`, saved only when changed, as Grafana does for field options.
- **Size by:** described "Sizes points, or edge lines' widths, by this number column's value, across its Min and Max." Its sliders become **Min size** and **Max size**, "Point diameter or edge line width at Min (Max)". Same paths and defaults, so saved dashboards are unchanged (decision 4).
- **Warnings:** `layerSettingProblems` treats edge layers as others: `dataStyleFields` problems, plus "Color by: sum doesn't apply to time column last_seen" when a Edge value doesn't apply. The later-version notice is removed.

### 7. Dashboard and tests

- **`14-node-edge.json`** gains two panels on the same queries as Hover, which stays unstyled:
  - **Styled:** Color by `utilization` (a ratio, thresholds green, yellow from 50%, red from 65%) and Size by `capacity_gbps` (Sum), Min size 2, Max size 10. Pairs: CARY-CORE–RALEIGH-CORE 68% red at 10 px (211 Gb/s); RALEIGH-CORE–GARNER 63% and APEX–CARY-CORE 53% yellow; APEX–HOLLY-SPRINGS 30% green at 2 px (1 Gb/s).
  - **By count:** Color by `medium` (value mappings: fiber blue, microwave orange) and Size by `capacity_gbps` with Edge value Count, Min size 2, Max size 8. The mixed pairs (CARY-CORE–RALEIGH-CORE, CARY-CORE–APEX) keep the layer's color; widths go by the number of trunks.
- **Unit:** `edgeValues` (each Edge value, empty rows, ratio of sums with a zero denominator, time columns, shared and mixed text, Count of text); `edgeValueRange` with and without Min and Max; `featureStyles` for edges (colors through thresholds and a gradient over edge values, widths, caching through a threshold change); legend entries for edges; `pairDetails` hover and summary views; `layerSettingProblems` for edges.
- **Engine:** `paintFor` with widths (plain values without them), `featureStateChanges` with widths.
- **Component:** the hover on a styled and an unstyled edge in `MapPanel.test.tsx`.
- **Phase 3's hover e2e test** ("shows a hovered edge's summary") becomes two: hovering a Hover panel line shows Between and Items only; pinning it, its Summary shows the aggregates and the ratio of sums. It's the only e2e test reading aggregates on hover; the click list's test already reads them from the Summary. `pairDetails.test.ts` gains the hover view.
- **E2E:** stored screenshots of the Styled and By count panels' maps (the legend hidden, as in `data-driven.spec.ts`); the Styled legend's items and "utilization" column; the By count legend's "medium"; hovering the CARY-CORE–RALEIGH-CORE line in Styled: Between, Items 4, utilization 68%, capacity_gbps sum 211 Gb/s and nothing else; pinning it: its Summary includes them.

---

## Steps

Each step is one commit, tested before the next.

### 5.1 Checks on MapLibre and Grafana 13.2

- A line's `line-width` from feature-state with `line-dasharray`: whether dashes scale per feature, or with the layer's width
- `['+', ['coalesce', ['feature-state', …]], n]` inside the highlight `case` for `line-width`, as for `circle-radius`
- Renamed slider labels on existing dashboards: the saved `sizeMin` and `sizeMax` still show

### 5.2 Engine: per-feature widths

Design §3, with unit tests. Existing screenshots unchanged.

### 5.3 Adapter: edge values, colors, widths and the legend

Design §1, §2 and §4, with unit tests. `buildLayerSpecs` styles edges.

### 5.4 Hover, options and warnings

Design §5 and §6, with unit and component tests.

### 5.5 Dashboard and e2e tests

Design §7. No new seed data, so no database reset.

### 5.6 Docs

- README: styling edges, after Edge totals; the Edge totals section's hover and Summary (decision 6); Size by's new labels
- node-edge architecture.md: status, §6.1, §6.3, §7
- [../architecture.md](../architecture.md) §7: line width by value on ordinary lines, now that the engine has widths
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| Dashes don't scale with per-feature widths | Checked in step 5.1; if MapLibre uses the layer's width, dashed edge lines keep their pattern at Line width, which still reads as dashed |
| Edge values recomputed on every render | Cached per conversion, column and Edge value, as Phase 6's colors are; a threshold change recolors from cached values |
| A gradient squashed by one large pair | The column's Min and Max set the range when given, as in Phase 6 |
| Thick lines hide the nodes | Nodes draw above edges (architecture decision 14); Max size defaults to 20 px, and the dashboards use 8 to 10 |
| Viewers used to Phase 3's hover totals look for them there | The README's Edge totals section says a click shows them; the hover's Items count still says how many rows a click lists |
| Mixed-text pairs read as "no data" | The legend's colors and the hover's missing styled value show it; the README explains the rule |

---

## Decisions

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Where Edge value is read from | **The Color by or Size by column's own config,** like its thresholds and unit. One column has one Edge value, whether it colors or sizes. | An Edge value per option on the style column (one for Color by, one for Size by), more settings for a rarer case. |
| 2 | Edge values of text columns | **The rows' shared value, or none when they differ;** Count gives the count. Colors by category work for pairs of one kind ("fiber"), and a mixed pair stands out by keeping the layer's color. | The first row's value, which depends on query order; the most frequent value, which hides mixed pairs. |
| 3 | Size by on ordinary line layers | **Not in this phase:** Size by sizes points, and edge lines. Lines in geometry layers keep Line width, as Phase 6 decided (its decision 4). | Line widths for every line layer now, since the engine gains them: a small change, but outside the network work, with its own screenshots and docs. |
| 4 | Size range options | **The same Min size and Max size options for points and edge lines,** renamed from Min point size and Max point size, with the same paths and defaults (4 and 20 px). | Separate Min width and Max width for lines, with line defaults (1 to 10 px): two more options shown for every column. |
| 5 | Sizing by number of rows | **Edge value Count on any column,** text included, through Size by on a number column or, for text, Color by. Size by still lists number columns only. | Size by listing every column, which offers text columns to point layers that can't use them. |
| 6 | What an edge line's hover shows | **Between, Items and the styled edge values, if any, on every edge layer.** The hover stays short enough never to need scrolling, and the Summary, which scrolls, holds the aggregates and ratios. Replaces architecture §6.1's plan, agreed in Phase 4's review, of keeping the full summary on unstyled layers. | The full summary on unstyled layers (§6.1's plan): unchanged from Phase 3, but a long summary is cut off where a hover can't scroll. The full summary always, the same problem on every layer. |
| 7 | Plugin version | **Unchanged.** No `plugin.json` change, so no Grafana restart. | |
| 8 | The option's name | **Edge value** (`edgeValue`): the value an edge line takes from a column. Settings use network terms, as the Edges category does (node-edge Phase 4, decision 8). | Pair value, as planned in the architecture, which names an internal idea viewers and editors never see; Aggregate edge value, long beside the Aggregates option in the same category. |
