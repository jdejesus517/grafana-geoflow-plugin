# Node-edge Phase 3: Hover

Status: **Implemented** (2026-11-08). Decisions 1–7 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §6.1 (hover), §7 (field options), §9.3 (Phase 3 row); decisions 3, 5, 9, 10.

## Goal

Hover an edge line to read its totals: how many links run between the two nodes, the aggregates chosen for each column (sum, average, min, max, count), and each ratio column as a ratio of sums. Click it to pin the same, which then follows the pair through refreshes. The click list of each link comes in Phase 4.

Also in this phase: the flaky data-summary checks in `tests/adapter.spec.ts` (Phase 2's findings).

## Exit criteria

1. **Edges are interactive.** Hovering an edge line highlights it and shows its tooltip; clicking pins it. An edge layer's **Tooltips** setting is back in the Layers list, and turns this off.
2. **Hover content.** The tooltip names the layer and the pair's two nodes, counts its links, and lists each column's chosen aggregates and each ratio column's ratio, formatted with the column's unit and decimals (Design §1).
3. **Aggregates option.** A field option, **Aggregates**, in a new **Edges** category, picks any of Sum, Average, Min, Max and Count per column, through overrides (decision 5 of the architecture).
4. **Ratio option.** Field options **Ratio numerator** and **Ratio denominator** make a column a ratio: its pair value is the sum of the numerators over the sum of the denominators (architecture decisions 3 and 10).
5. **Pinned pairs.** A pinned pair shows the same content, pages with the other features under the click, and follows its pair through a refresh by its key; it closes when the pair is gone.
6. **Flaky check fixed.** The cause of the `adapter.spec.ts` flake is found and fixed, and CI keeps the Playwright report of a run with a retried test.
7. **Tests.** Unit tests on aggregates, ratios and the pair content; component tests on the editor and the pair tooltip; e2e tests on hover values, the pinned pair through a refresh, and Tooltips off.
8. **Docs.** The README's Networks section describes the hover, the options and the ratio.

## Out of scope

- **The click list of a pair's links:** Phase 4. Until then, a pinned pair shows the hover content.
- **Styling edges by a pair value:** Phase 5.
- **Node names in pair titles:** the architecture's §12. Pairs are named by their node ids.
- **Aggregates split by direction:** §12.

---

## Starting point

| Already in place | From |
|---|---|
| Edge results: one LineString per pair, `pairs` (each pair's rows), `featureKeys` (pair keys) | Node-edge Phase 1 |
| Edge layers not interactive, and no Tooltips setting for them in the Layers list | Node-edge Phases 1, 2 |
| `useFeatureTooltip`: hover and pinned tooltips, the pager, pinned features found again by key after a refresh | Phase 4 |
| `FeatureTooltip`: Grafana's tooltip components, with a header, a list of label/value items and a footer of links | Phase 4 |
| `featureDetails`: a feature's items, formatted with each field's display processor, leaving out Hide in tooltip columns | Phase 4 |
| Field options (`custom`) in categories, with field name pickers and generic editors (Dash pattern) | Phases 5, 6 |
| `@grafana/ui`'s `MultiCombobox` | Grafana 13.2 |

**The flake** (Phase 2's findings): `tests/adapter.spec.ts` flaked twice in about a dozen CI runs, a different panel each time ("jsonb and Feature input" on 13.2.5 in PR #38, "State Plane without ST_Transform" in PR #36). The first attempt found no `geoflow-summary-A` within 30 seconds; the retry passed. The jsonb panel is at the top of the dashboard, so it isn't simply off screen. CI doesn't upload the Playwright report at all (only the built plugin), so neither failed attempt can be inspected.

### Changes to the architecture

- **§7:** the field options are `edgeAggregates` (`sum`, `mean`, `min`, `max`, `count`, Grafana's reducer ids), `ratioNumerator` and `ratioDenominator`, as planned; `pairValue` comes in Phase 5.

---

## Design

### 1. Pair content (`pairDetails.ts`, new, adapter)

`pairDetails(frame, result, featureId)` returns a `FeatureDetails`, like `featureDetails`, so `FeatureTooltip` shows it unchanged:

| Item | Value |
|---|---|
| **Between** | The two node ids: "1 and 6" |
| **Links** | The pair's row count: "4" |
| A column with aggregates | Its display name, then each chosen aggregate in the order Sum, Average, Min, Max, Count: "sum 211 Gb/s · avg 52.8 Gb/s" |
| A ratio column | Its display name, then its ratio of sums: "68%" |

- **Order:** Between and Links, then columns in query order.
- **Which aggregates apply:** Sum and Average to number columns, Min and Max to number and time columns, Count to any. Others chosen for a column are skipped (the option's description says which apply).
- **Nulls** are skipped; Count counts non-null values. A column whose values are all null shows its No value text, or "—".
- **Formatting:** values through the column's display processor (unit, decimals, value mappings), as `featureDetails` does; counts as plain numbers.
- **Ratios:** rows where both the numerator and the denominator have a value count; the ratio is their sums' quotient, formatted with the ratio column's display processor. A zero denominator sum shows "—". A ratio column shows its ratio whatever its Aggregates option says.
- **Hidden columns:** columns with **Hide in tooltip** are left out, as in feature tooltips.
- **Links:** none: a pair has no single row for a link's values (architecture decision 15).

It's computed for the pairs under the pointer only, and kept until the hovered pair or the data changes (the tooltip's existing memoization), so moving along a line recomputes nothing.

### 2. Tooltips (`useFeatureTooltip.tsx`, `buildLayerSpecs.ts`, `LayersEditor.tsx`)

- **`tooltipFeatures`** calls `pairDetails` for features of an edge result (`result.pairs`), and `featureDetails` for the rest. The header's title is the layer's name and its color the layer's color.
- **`buildLayerSpecs`** makes edge layers interactive like any layer: `interactive && layer.tooltips`.
- **Layers list:** the Tooltips switch shows for edge layers again (node-edge Phase 2, decision 2).
- **Pinned pairs:** `resolvePinned` finds a pinned pair again by its key in the new result, so the pinned tooltip follows a refresh that keeps the pair, and closes when it's gone. No change is needed: edge results already carry `featureKeys`.

### 3. Field options (`module.ts`, `options.ts`, `AggregatesEditor.tsx`, new)

In a new **Edges** category, after Tooltip:

| Option | Editor | Description |
|---|---|---|
| **Aggregates** (`edgeAggregates`) | `AggregatesEditor`: a `MultiCombobox` of Sum, Average, Min, Max, Count | "Totals shown when an edge line is hovered, over the links between its two nodes. Sum and Average apply to numbers, Min and Max to numbers and times, Count to any column." |
| **Ratio numerator** (`ratioNumerator`) | Field name picker, numbers only | "With a denominator, makes this column a ratio: a hovered edge shows the sum of this column over the sum of the denominator." |
| **Ratio denominator** (`ratioDenominator`) | Field name picker, numbers only | Shown when a numerator is set. |

Field options can't be shown for edge layers' columns only: Grafana decides from the options, not the layer (architecture §7). The category's descriptions say they apply to edge layers. Whether Grafana lets a field option category start collapsed is checked in step 3.1.

### 4. The flaky checks (`tests/adapter.spec.ts`, `.github/workflows/ci.yml`)

1. **Reproduce:** run the spec repeatedly against the dev stack with CI's parallelism (`--repeat-each=30 --workers=4`), keeping the failure's page snapshot, to see what the panel shows when the summary is missing: still loading, an error, an empty panel, or no panel.
2. **Fix by cause.** The likely ones: the checks start before Grafana has loaded the panel or its queries (Grafana loads panels lazily, and only those on screen), which waiting for the panel's map or scrolling it into view fixes; or a slow cold start in CI, which the longer data timeout of the other specs covers. The fix goes in the spec, or in a fixture if other specs share the cause.
3. **Keep the evidence:** CI uploads the Playwright report (`playwright-report/`, a few days' retention) when a test fails or is retried, so a recurrence can be inspected (decision 6).

If it doesn't reproduce locally, step 3.4 makes the checks wait for the panel's map first, which removes the most likely race, and the CI report catches any recurrence.

### 5. Dashboard and tests

**`14-node-edge.json`** gains a **Hover** panel: the Network panel's queries with a ratio column (`utilization_gbps / capacity_gbps AS utilization`), a fixed view so tests can point at a line (`mapPoint`), and overrides on query B: `capacity_gbps` with Aggregates Sum and Average and unit Gbit/s, `utilization_gbps` with Sum, `utilization` with the ratio options and unit Percent (0.0–1.0).

| Level | Covers |
|---|---|
| Unit | `pairDetails`: Between and Links; each aggregate on numbers, times and text; inapplicable aggregates skipped; nulls; all-null columns; ratio of sums, skipped rows, a zero denominator; hidden columns; order |
| Component | `AggregatesEditor` saves and clears; `useFeatureTooltip` with a pair (MapPanel tests): hover content, pinned with the pager, followed through a refresh; the Layers list's Tooltips switch on edge layers |
| E2E | Hover the CARY-CORE to RALEIGH-CORE line: Between, 4 links, the capacity sum and average, the utilization ratio. Click to pin, refresh, and the pinned tooltip stays. Tooltips off: nothing on hover. |

---

## Steps

Each step is one commit, tested before the next.

### 3.1 Checks on Grafana 13.2

- `MultiCombobox` in a field option editor: saving, clearing, and inside an override
- Whether a field option category can start collapsed
- The Gbit/s unit's id and how it formats (`211 Gb/s`)

### 3.2 Adapter: pair content

Design §1, with unit tests.

### 3.3 Tooltips and field options

Design §2–3, with unit and component tests.

### 3.4 The flaky checks

Design §4.

### 3.5 Dashboard and e2e tests

Design §5. No new seed data, so no database reset.

### 3.6 Docs

- README: the hover, the Edges options and a ratio example, in the Networks section
- node-edge architecture.md: status, §7
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| The Edges options clutter every column's options | Their own category, with descriptions; the ratio denominator shows only once a numerator is set |
| Node ids make poor pair names ("1 and 6") | The README suggests text ids where names matter; node names are a §12 feature |
| Hovering near a node shows the node rather than the edge | Nodes draw above edges, by design (architecture §6); the pinned tooltip pages to the edges under the click |
| The flake doesn't reproduce | The checks wait for the panel's map regardless, and CI keeps the report of a retried run |
| A ratio's numerator and denominator in different units | The user's choice of columns; the ratio column's unit decides how it reads |

---

## Decisions

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Pair tooltip content | **Between, Links, then each column's aggregates on one line and each ratio** (Design §1), in `FeatureTooltip` unchanged. | A line per aggregate ("capacity_gbps sum", "capacity_gbps avg"), longer; a table, which is Phase 4's click list. |
| 2 | Aggregates editor | **A multi-select of the five** (`MultiCombobox`), saved as Grafana's reducer ids. | Five switches, taller; Grafana's stats picker, which lists dozens of reducers. |
| 3 | Aggregates that don't apply to a column | **Skipped,** with the option's description saying which apply. The editor can't know the column's type in an override. | Shown as "—", which reads like missing data. |
| 4 | Ratio rows | **Rows with both values;** a zero denominator sum shows "—". | Treating a missing value as zero, which makes a missing denominator inflate the ratio. |
| 5 | Pinned pairs until Phase 4 | **The hover content, pinned,** with the pager and close button. | Not pinnable until the click list exists. |
| 6 | CI evidence for flaky tests | **Upload the Playwright report when a test fails or is retried,** kept for a few days. The repository is public, so the report is too: it holds screenshots of the dev dashboards and their fictional data, nothing else. | Uploading only on failure, which loses flakes; no upload, as now. |
| 7 | Plugin version | **Unchanged.** No `plugin.json` change, so no Grafana restart. | |

---

## Outcome

Implemented on branch `node-edge-phase-3` in five commits, steps 3.2 to 3.6. Step 3.1 was checks only, recorded below.
- 630 unit and component tests pass (13 new), and 74 e2e tests (3 new, plus the login setup). No seed data changed, so the stack wasn't reset.
- CI: to be filled in from the pull request.

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Edges are interactive | Met. Hover highlights and shows the pair, click pins; the Tooltips switch is back for edge layers and turns it off (e2e). |
| 2 | Hover content | Met. The Hover panel's CARY-CORE to RALEIGH-CORE line reads: Trunks; Between 1 and 6; Links 4; capacity_gbps sum 211 Gb/s · avg 52.8 Gb/s; utilization_gbps sum 143 Gb/s; utilization 68%. |
| 3 | Aggregates option | Met. A multi-select in the Edges category, saved in the tooltip's order. |
| 4 | Ratio option | Met. Ratio numerator and denominator; the denominator shows once a numerator is set. 68% is the ratio of sums, not the trunks' average of 66%. |
| 5 | Pinned pairs | Met. Found again by key after new data (component test) and through a dashboard refresh (e2e); closed when the pair is gone. |
| 6 | Flaky check fixed | Partly: the flake didn't reproduce locally (below), so its cause isn't confirmed. The checks now wait in two stages, failed attempts keep a screenshot, and CI keeps the report of a failed or retried run, so a recurrence can be inspected. |
| 7 | Tests | Met. |
| 8 | Docs | Met. The README's Edge totals section, with a ratio example. |

### Checks on Grafana 13.2 (step 3.1)

- **`MultiCombobox` in a field option:** saves and shows its values as chips (Sum, Max), checked in the panel's defaults. Overrides render the same editor; the Hover panel sets aggregates through overrides, and the e2e hover test reads them.
- **Collapsed categories:** a plugin can't choose whether a field option category starts collapsed (`@grafana/data` has no setting for it); the Edges category opens expanded, like the others. Its descriptions start with "Edge layers:".
- **Units:** Gbit/s is `Gbits`, formatting 211 as "211 Gb/s"; Percent (0.0–1.0) with 0 decimals formats 0.676 as "68%".

### The flaky checks (step 3.4)

- **Not reproduced:** 150 runs of `adapter.spec.ts` with 4 workers, and 3 runs of the full suite with 4 workers (210 tests), all passed.
- **So the fix removes the likeliest race and keeps evidence:** the checks scroll the panel into view and wait for it to load, then for its summary, each with its own message ("the panel loads", "the queries return"); Playwright keeps a screenshot of a failed attempt; CI uploads the Playwright report when it has attachments, which a failed or retried test leaves (checked: a failing test leaves three files in `playwright-report/data/`, a clean run none).

### Differences from the plan

- **The Aggregates editor's unit tests** cover its saving rule (`savedAggregates`) rather than picking from the list: `MultiCombobox` virtualizes its list, which renders no options in jsdom, as the project's other Combobox tests note. Picking is covered by the step 3.1 check.
- **Hover e2e tests wait for edges to draw** rather than for exact feature counts: the Hover panel's fixed view shows part of the network, and how much depends on the panel's size.

### Findings for later phases

- **Pair names are node ids** ("1 and 6"); with integer ids they say little. Node names in pair titles (architecture §12) would help the click list's header too.
