# Phase 11: Splitting by value with Partition by values

Status: **Implemented** (2026-11-08). Decisions 1–8 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §3.4 (layer binding modes, the gaps Phase 11 fills), §5.3 (Phase 11 row), §4.2 (performance), §7 (`byColumn`).

## Goal

Make one query split into a layer per value work well and be easy to set up, using Grafana's **Partition by values** transformation.

GeoFlow already draws a layer for each frame the transformation makes (Phase 7). After Phase 9, splitting in the adapter with a `byColumn` mode was dropped in favor of the transformation (§3.4), which leaves three gaps:
- **Many layers.** Splitting on a column with many values (an id, say) makes a layer per value. Each layer is a MapLibre source with four style layers, so the panel slows down with no explanation.
- **Null and empty values.** How the transformation names them, and what layer GeoFlow makes of them, hasn't been checked.
- **Setting it up.** The split lives in the Transform tab, and styling one value needs **As frame name** naming, which isn't the default. Nothing in the README says so.

## Exit criteria

1. **Many layers warning.** A panel drawing more than 50 layers from data (decision 1) shows a warning on the map, the same way as other problems (Phase 9), giving the count and what to do. **Show warnings** off hides it. Every layer is still drawn (decision 2).
2. **Cost measured.** The time to draw 50, 200 and 1,000 one-feature layers, and the longest main-thread task, are recorded in this document, with the GPU.
3. **Null and empty values.** A split column with nulls draws the null rows as a layer of their own, in both namings, with stable ids across a refresh. What the layers are called is recorded, and the README says how to name them (decision 3).
4. **Per-value styling.** With **As frame name**, a **Fields returned by query** override on one value's frame restyles that value's layer alone. An e2e screenshot test shows it.
5. **README walk-through.** The root README has a section on splitting a query by a column: the transformation, its naming, per-value overrides, stable colors and order, nulls, and the layer limit. The catalog README mentions it in a line.
6. **Nothing else changes.** Panels with 50 layers or fewer draw as before. The stored screenshots still match. Unit and e2e tests pass locally and in CI.

## Out of scope

- **A `byColumn` mode** (§7): an "Other" layer beyond a cap, a "(none)" layer, one value-mapping table for every value.
- **Changing layer ids** made from the transformation's refIds, such as `A-undefined:placement=aerial` (decision 5).
- **A collapsed Layers list** for panels with many layers (decision 7).
- **Choosing palette colors** for split layers in GeoFlow (decision 6).

---

## Starting point

| Already in place | From |
|---|---|
| A layer per frame, including the frames of a split query. Ids: the refId when a query returns one frame, else `${refId}:${key}`, the key being the frame's name, else its labels, else `#n`. | Phase 7 |
| `08-layers.json` has a Partition by values panel (fiber cables by `placement`, default naming), and `tests/layers.spec.ts` checks its three layers. | Phase 7 |
| Panel warnings (`panelProblems`), including a whole-panel one over 100k features. | Phase 9 |
| Palette colors by a layer's position among layers with geometry. **Classic palette (by series name)** hashes the layer's name instead. | Phases 5, 7 |

**Checked while planning,** from Grafana's source (`public/app/features/transformers/partitionByValues/`, `main`). Step 11.1 confirms it on 13.2.5.

- **Frames per value.** Rows are grouped in a `Map` keyed by the raw value, so `null`, `undefined` and `''` are each a group of their own, separate from every other value.
- **Default naming (As label).** Every frame keeps the query's frame name, and gets the label `placement=<value>`, with the value through `String()`: a null value becomes `placement=null`. Every frame's refId is `` `${refId}-${frame name}` ``. A PostgreSQL frame has no name, so they all share `A-undefined`, which is why the Phase 7 test's ids are `A-undefined:placement=aerial`.
- **As frame name.** The frame is named by the value through a template string, so null becomes `null` and its refId is `A-null`. An empty string gives the name `''` and the refId `A-`, which GeoFlow names "Query A-".
- **Frame order** is the order in which each value first appears in the rows. With `ORDER BY id`, a new row whose value used to come later moves that value's frame earlier. Palette colors by position and the stacking of layers without saved settings shift with it.
- **A value of the text `null`** can't be told apart from a null in either naming.

### Changes to the architecture

- **§3.4:** the gaps become what was built. The warning applies to any panel, whatever produced its frames. Nulls need no handling in the adapter (decision 3).
- **§4.2:** the cost of many layers, from step 11.1.
- **§5.3:** the Phase 11 row says what was delivered.

---

## Design

### 1. The many layers warning (`panelProblems.ts`)

A whole-panel problem, beside the one over 100k features:

- **Count:** the results with a geometry column, which are the layers drawn from data, hidden ones included: a hidden layer keeps its source (Phase 7).
- **Threshold:** `MANY_LAYERS = 50` (decision 1).
- **Text:** "120 layers may draw slowly". **Detail:** "Each layer is a frame. Partition by values on a column with many values makes one per value: split on a column with fewer values, or filter the query."

Unit tests: no warning at 50, a warning at 51, gone layers and queries without geometry not counted, hidden layers counted.

### 2. Null and empty values

No change to the adapter (decision 3). A null value draws as a layer like any other value:

| Naming | Layer id | Layer name |
|---|---|---|
| As label (default) | `A-undefined:placement=null` | `placement=null` |
| As frame name | `A-null` | `null` |

The README suggests naming them in SQL, which works for nulls and empty text alike: `COALESCE(NULLIF(placement, ''), 'unknown') AS placement`.

### 3. Dashboard and e2e tests (`12-partition.json`, `tests/partition.spec.ts`)

From the fixture tables, with no new seed data:

- **Per-value style:** fiber cables split by `placement` with **As frame name**, and a **Fields returned by query** override on `A-aerial` (dashed, orange). A screenshot.
- **Nulls:** the same query with `CASE WHEN id % 4 = 0 THEN NULL ELSE placement END AS placement`, once per naming. The null rows' layer is drawn with the expected id and name, and keeps its id across a refresh.
- **Many layers:** 60 points from `generate_series`, split by their id. All 60 layers are drawn, and the warning shows the count.

### 4. README

A "Splitting a query by value" section after Layers:

1. Add **Partition by values** in the Transform tab, on the column to split by.
2. Set **Naming** to **As frame name**, so each layer is named by its value, and overrides can find it.
3. Style a value with a **Fields returned by query** override on its frame (`A-aerial`).
4. Keep colors stable with **Classic palette (by series name)**, and order with `ORDER BY placement, id`. Without these, a value appearing earlier in the rows recolors and restacks the others.
5. Name null and empty values in SQL (Design §2).
6. Split on columns with a few dozen values at most: over 50 layers, the panel warns.

---

## Steps

Each step is one commit, tested before the next.

### 11.1 Checks on Grafana 13.2.5

- The naming, refIds and frame order found in Grafana's source, for null, empty and text values, in both namings.
- The cost of many layers with the GPU: first draw, the longest main-thread task, and memory, for 50, 200 and 1,000 one-feature layers (a variant of `scripts/bench-map.mjs`). If 1,000 layers stall the tab for seconds, decision 2 comes back for review before step 11.2.

### 11.2 The warning

Design §1 and its unit tests.

### 11.3 Dashboard and e2e tests

Design §3.

### 11.4 Docs

- README: the section in Design §4; the dashboard list
- `src/README.md`: a line under Features
- architecture.md: §3.4, §4.2, §5.3
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| Grafana 13.2.5 behaves differently from its `main` source. | Step 11.1 checks it, and the e2e tests pin it on 13.2.5, 13.3.0 and nightly. |
| 1,000 layers hang the tab, so warning alone isn't enough. | Step 11.1 measures it before the warning is built, and decision 2 is reviewed again if so. |
| Grafana changes the transformation's refIds, renaming layers and orphaning their settings. | The e2e tests assert the ids, so CI on nightly catches it. Settings for gone layers are kept and shown (Phase 7). |
| 50 is the wrong threshold. | It's a constant, set from step 11.1's numbers. |

---

## Decisions

Accepted as proposed (2026-11-08):

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Warning threshold | **50 layers drawn from data**, hidden ones included, whatever produced the frames. A few dozen values is what a legend and a Layers list can still show. | 20: warns on reasonable splits. An option: one more setting for a rare case. |
| 2 | Layers beyond it | **Draw them all, and warn.** Nothing is lost without the user knowing. | Draw the first 50: which ones depends on the order values first appear in the rows, so it's arbitrary, and data disappears. |
| 3 | Null and empty values | **No handling in the adapter.** They're drawn as their own layer, named as Grafana names them (`placement=null`, `null`), as in Grafana's other panels. The README shows how to name them in SQL. | Rename them "(no value)": in either naming, a null can't be told from the text `null`, so a real value could be renamed. |
| 4 | Where the walk-through lives | **The root README**, with a line in the catalog README pointing to it. | A separate docs page: the README is where every other option is documented. |
| 5 | `A-undefined` in layer ids | **Leave it.** It's Grafana's refId, and changing it would orphan saved layer settings. It shows only in the Layers list's id column. | Strip it: GeoFlow would have to guess at Grafana's refIds, and existing settings would be lost. |
| 6 | Stable colors for split layers | **Document Classic palette (by series name) and `ORDER BY`.** Both already work. | Hash split layers' names by default: changes the colors of existing dashboards. |
| 7 | Layers list with many rows | **Unchanged.** Over 50 layers, the warning is the answer. | Collapse rows beyond a count: work for a case the warning steers away from. |
| 8 | Plugin version | **Unchanged (0.2.0).** The next release sets it. No `plugin.json` change, so no Grafana restart. | 0.3.0 for the new warning. |

---

## Outcome

Implemented on branch `phase-11` in four commits, one per step:
- 529 unit and component tests pass, and 62 e2e tests (plus the login setup), in two full-suite runs in a row. The stored screenshots still match.
- CI on PR #32 passes build, lint, 529 unit tests, the 8 build tool tests, `check:dist`, and the e2e tests on Grafana 13.2.5, 13.3.0 and nightly, 62 e2e tests each (plus the login setup), on the first run. So the null and empty naming found on 13.2.4 holds on all three. The API compatibility check reports only the known `useFieldConfig` false positive (Phase 4).

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Many layers warning | Met. Over 50 layers, the warning reads "60 layers may draw slowly", with what to do. Hidden layers count; queries without geometry and gone layers don't. Unit tests, and the 12 Partition dashboard's 60-layer panel in e2e. Every layer is still drawn. |
| 2 | Cost measured | Met. Below. |
| 3 | Null and empty values | Met, with names that differ from the plan (below). Each is a layer of its own in both namings, with the same ids after a refresh. The README shows naming them in SQL. |
| 4 | Per-value styling | Met. A **Fields returned by query** override on `A-aerial` makes those cables dashed and orange, and nothing else (screenshot). |
| 5 | README walk-through | Met. "Splitting a query by value" in the root README, a line under Features in the catalog README, and the new warning under Warnings. |
| 6 | Nothing else changes | Met. Only the warning is new in the plugin; the stored screenshots match. |

### Cost of many layers

`npm run bench:map -- --kinds layers --rows 50,200,1000`: one point per layer, split by id with Partition by values, on the 11 Performance dashboard's new Many layers panel. Median of 3 runs, with the GPU, on Grafana 13.2.4. "Task" columns are the longest main-thread task in milliseconds; tasks under 50 ms aren't reported.

| Layers | Drawn | Load | Pan | Hover | Refresh | Hide | Show | Basemap |
|---|---|---|---|---|---|---|---|---|
| 50 | 0.4 s | 52 | <50 | <50 | <50 | 50 | <50 | <50 |
| 200 | 0.8 s | 107 | <50 | <50 | <50 | 93 | 81 | 111 |
| 1,000 | 4.6 s | 497 | 402 | 496 | 51 | 445 | 463 | 504 |

1,000 layers are slow, but nothing stalls for seconds, so decision 2 stands. 50 layers cost about what one does, and the threshold stays at 50: past 200, panning and hovering start to pause.

### Differences from the plan

- **Grafana names a null `''`, not `null`, with As frame name.** The plan read Grafana's `main` source; 13.2.4 behaves otherwise. A null and empty text then share the name `''` and the refId `A-`, so GeoFlow tells them apart only by position: `A-:#1` and `A-:#2`, named "Query A- (1)" and "(2)", in the order they first appear in the rows. A text `null` stays its own layer (`A-null`). With **As label**, as planned, nulls are `placement=null` and empty text `placement=`, and a text `null` collides with a real null. Decision 3 stands: naming them in SQL avoids all of these, and the README says so.
- **Checks ran on Grafana 13.2.4,** the local dev stack, rather than 13.2.5. The e2e tests pin the behavior on 13.2.5, 13.3.0 and nightly in CI.
- **The Many layers panel went into the 11 Performance dashboard,** whose Rows variable gains 50 and 200, so `bench:map` measures it like the other kinds. The benchmark's hide and show now use the top layer, whatever its name.
- **The 60-layer e2e panel fits the view to the data,** so every point is in view for the drawn-feature count.

