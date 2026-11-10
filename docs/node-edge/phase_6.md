# Node-edge Phase 6: Hardening and the 1.0.0 release materials

Status: **Implemented** (2026-11-09). Decisions 1–7 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §8 (performance and risks), §9.1 (the large network), §9.3 (Phase 6 row); [../phase_9.md](../phase_9.md) (the benchmark and its budgets).

## Goal

Show that networks are fast enough at the sizes GeoFlow claims for other layers, fix what isn't, and finish the documents that ship with 1.0.0, now that they include networks: someone reading the README or the catalog page learns that GeoFlow draws networks, how to set one up, and how large one can be.

## Exit criteria

1. **Benchmark.** `npm run bench:map -- --kinds network,styled-network` measures networks of 1,000, 10,000 and 100,000 edge rows with the existing columns (drawn, load, pan, hover, refresh, hide, show, basemap), plus three for the click list: pinning a line of 2,000 rows, searching it and sorting it.
2. **Dashboard.** 11 Performance gains a **Network** panel and a **Styled network** panel (colored by a ratio, sized by a sum), both generated from the Rows variable, with no new seed data.
3. **Budgets.** At 100,000 edge rows, Phase 9's budgets hold: 200 ms for interactions, unchanged refreshes and the click list, 500 ms for new data. What misses one is fixed, or recorded with the reason it wasn't (decision 3).
4. **Correct at scale.** The drawn-feature counts match the generated network: one line per pair and one point per node, with no warnings.
5. **README.** The Networks section is no longer a preview and opens with a walkthrough from two queries to a styled network. Sizing gives the network figures. The dev dashboards table describes 11 Performance and 14 Node-edge as they are.
6. **Release materials.** The README's status line describes 1.0.0, not a phase. `CHANGELOG.md`'s 1.0.0 entry lists networks, linked to their pull requests. The catalog README (`src/README.md`) has networks in its features, setup notes and limitations. `plugin.json` gains a network screenshot and keyword (decision 6).
7. **Validator.** Grafana's plugin validator passes, as in #36, apart from the expected unsigned-plugin warning.
8. **Architecture docs.** The node-edge architecture is marked implemented, with §8 and §9.1 as built; [../architecture.md](../architecture.md)'s status names node-edge maps as implemented.
9. **Tests.** The existing unit and e2e tests pass, with screenshots unchanged unless a fix changes the drawing.

## Out of scope

- **The release itself:** `npm version 1.0.0`, the tag, signing and the catalog submission, on release day after this phase merges, as #36 set out (decision 7).
- **Features for later** in architecture §12: aggregates split by direction, highlighting a node's edges, node names in titles and the rest.
- **Benchmarks in CI:** runners have no GPU, as in Phase 9.
- **Networks without a GPU:** Sizing's existing advice applies; not measured separately.

---

## Starting point

| Already in place | From |
|---|---|
| `bench-map.mjs` on 11 Performance: drawn, load, pan, hover, refresh, hide, show, basemap, median of runs, at the Rows variable's sizes | Phase 9 |
| Budgets at 100k points: 200 ms for interactions and unchanged refreshes, 500 ms for new data; met by points (249 ms load, 425 ms new data) | Phase 9 |
| Unchanged refreshes reuse the edge result; edges are rebuilt only when nodes or edges change | Node-edge Phase 1 |
| The click list's 500-row cap; formatted values computed once per open list | Node-edge Phase 4 |
| Edge values cached per edge result, column and Edge value | Node-edge Phase 5 |
| `CHANGELOG.md`'s 1.0.0 entry, catalog screenshots and README, validator passing; "replace (Unreleased) and run `npm version 1.0.0`" on release day | #36 |
| Release materials held back for networks | Node-edge architecture §9.3, Phase 6 row |

Nothing has measured a network larger than the 14-trunk fixture. Architecture §8 names the risk (20,000 edges in 5,000 pairs) and leaves it to this phase.

### Changes to the architecture

- **§9.1:** the large network is generated in the benchmark's SQL, not seeded (decision 2).
- **§9.3, Phase 6 row:** the release itself is out of this phase (decision 7).

---

## Design

### 1. The large network (dashboard 11 Performance)

Two queries per panel, generated with `generate_series` from `$rows`, the number of **edge rows**:
- **Nodes:** `$rows / 8` points on a square grid over the Cary box the large points use, ids `1…N`, text names.
- **Edges:** each node joins its right and lower neighbor (none past the last column or row), so about two pairs per node and no long lines across the grid. Each pair has **4 rows**, two in each direction, with the trunks' columns: `trunk_id`, `a_site`, `z_site` (text), `medium`, `capacity_gbps` (1, 10, 40 or 100), `utilization_gbps` and `utilization` (their ratio), all from deterministic functions of the row number, so runs are repeatable.
- **The heavy line:** two more nodes below the grid joined by **2,000 rows**, one long horizontal line on its own, at a fixed place on screen for the click-list measurements.

At 100,000 rows: 12,502 nodes and about 25,000 lines. Both panels use a **fixed view** framing the grid and the heavy line, so screen positions are known; the heavy line is clicked at a fixed fraction of the map, as the e2e tests do.

- **Network (panel 7):** Nodes and Edges, plain Map style.
- **Styled network (panel 8):** the same queries, Color by `utilization` (a ratio, with thresholds) and Size by `capacity_gbps` (sum), so edge values are computed for two columns.

### 2. Benchmark (`scripts/bench-map.mjs`)

- **Kinds** `network` and `styled-network`, mapped to panels 7 and 8. Rows means edge rows.
- **Existing columns** run unchanged. For networks, hover moves across edge lines, and refresh brings unchanged data, so it measures the edge result's reuse.
- **List columns,** for network kinds only, on a fresh page:
  - **pin:** click the heavy line; longest task until the list shows its first rows.
  - **search:** type three characters into the search box; longest task until the count updates.
  - **sort:** click a header; longest task until the rows reorder.

  Other kinds show `–` in these columns.
- **Drawn** waits for the drawn-feature counts as before, then checks them against the expected lines and nodes, and fails the run if they differ (exit criterion 4).

### 3. Fixes (only if needed)

In the order of Phase 9's decision 3, stopping when the budgets are met:
1. **Profile** the task that misses, in the adapter first: `npm run bench:adapter` gains a `joinEdges.bench.ts`, 100,000 edge rows and 12,500 nodes, with the same time budget as conversion's bench.
2. **Cheap fixes** in what the profile shows: the join's pair keys and lookups, edge values, the list's formatting and search.
3. **Anything larger** (a lower list cap, a worker) is proposed for review, not built in this phase.

### 4. README

- **Networks:** the heading loses "(preview)". It opens with a **walkthrough**: the two queries, setting the roles, then an override with Color by on a ratio column and Size by on a capacity, ending with what hover and click show. Each step links to the subsection that has the details; the subsections stay as reference.
- **Sizing:** a row or sentence for networks: what 100,000 edge rows cost to draw and refresh, and what the click list costs, from the results.
- **Dev dashboards:** 11 Performance with its network panels; 14 Node-edge with the Styled and By count panels.

### 5. Release materials

- **Status line:** replaces "pre-MVP … Phase 9 is complete" with what 1.0.0 is: geometry layers and networks from PostGIS, styled with Grafana's field options, with measured limits. No phase numbers, so it stays true after the release (decision 5).
- **CHANGELOG:** the 1.0.0 entry gains network features, in its format, linked to their pull requests:
  - drawing networks from a node query and an edge query, set up in the Layers list [#37](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/37) [#38](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/38)
  - edge summaries with totals and ratios, and the list of a line's edges with search, sort and data links [#39](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/39) [#40](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/40)
  - coloring and sizing edge lines by their edges' values [#49](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/49)
  - this phase's PR, if it fixes anything a user would notice
- **Catalog README (`src/README.md`):** a Networks feature bullet; a short "Networks" section after Styling with the two queries and the Role setting, linking to the full documentation; Sizing with the network figure; Limitations: straight lines, one network per panel, and no Partition by values on node or edge queries.
- **`plugin.json`:** a fifth screenshot, 1600×900 on OpenFreeMap like the others: the Styled panel's network with its legend and a pinned list. The keyword `network`, and the description extended to networks (decision 6). A Grafana restart is needed after pulling.

### 6. Architecture docs

- **node-edge/architecture.md:** status "Implemented"; §8's large-network row with the results; §9.1's generated network; §9.3's Phase 6 row.
- **../architecture.md:** the status's node-edge sentence; §4.2 a line for networks' numbers.
- **node-edge/phase_4.md:** its Outcome still says CI is "to be filled in"; filled from #40's checks.

---

## Steps

Each step is one commit, tested before the next.

### 6.1 Benchmark panels and script

Design §1 and §2. The panels are checked in the browser at each size: counts, the heavy line's place, no warnings. No seed data, so no database reset.

### 6.2 Measurements and fixes

Run `npm run build && npm run bench:map -- --kinds network,styled-network`, then Design §3 for whatever misses a budget. The results table goes in the Outcome. If nothing misses, this step is the results only, committed with 6.5.

### 6.3 README

Design §4.

### 6.4 Release materials

Design §5: status line, CHANGELOG, catalog README, `plugin.json` and its screenshot. Then the build, `check:dist` and the plugin validator.

### 6.5 Architecture docs and Outcome

Design §6, and this document's Outcome.

---

## Risks

| Risk | Mitigation |
|---|---|
| Large networks miss a budget in ways a cheap fix doesn't reach | Recorded with the reason, and the README's Sizing gives the size that does meet it (decision 3) |
| Generated data unlike real networks: a regular grid, 4 rows per pair | The heavy line covers the long tail; pair counts and rows per pair match architecture §8's example. The README states what was measured |
| Clicking the heavy line hits a grid line instead | It sits below the grid, alone, in a fixed view |
| The status line or CHANGELOG goes stale on release day | No phase numbers in the status line; the CHANGELOG keeps "(Unreleased)" until `npm version 1.0.0`, as #36 set out |
| A `plugin.json` change goes unnoticed in the dev stack | Restart Grafana after pulling, said in the PR |

---

## Decisions

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Benchmark size and budgets | **Phase 9's budgets at 100,000 edge rows** (about 25,000 lines), also measured at 1,000 and 10,000. The README says up to 100,000 features per panel, and an edge row is what a query returns, so networks are held to the same number. | 20,000 edge rows in 5,000 pairs, architecture §8's example: easier to meet, but leaves Sizing's 100k unclear for networks. |
| 2 | Where the large network comes from | **Generated in the dashboard's SQL** with `generate_series`, like the Many layers panel: any size from the Rows variable, no seed tables, no database reset. | Seed tables in `06_seed_network.sql`, as §9.1 planned: fixed sizes, and every developer resets their database. |
| 3 | What misses a budget | **Fixed with cheap changes, or recorded with the reason,** as Phase 9's decision 3. Larger changes, such as a lower list cap or a worker, come back as a proposal. | Fixing whatever it takes in this phase, which could hold up 1.0.0 for an edge case. |
| 4 | Click list measurements | **Pin, search and sort on a line of 2,000 rows,** the click list's hard case: search and sort cover all 2,000 rows, while drawing stops at 500. | Leaving the list out: the hover and the list are where a network's cost is, beyond drawing. |
| 5 | The README's status line | **What 1.0.0 is, without phase numbers,** so it's true before and after the tag. | No status line at all; one naming 1.0.0 as a release candidate, rewritten on release day. |
| 6 | Networks in the catalog listing | **A network screenshot, the keyword `network`, and the description extended**, for example "Render PostGIS geometries and networks from the Grafana PostgreSQL data source on an interactive MapLibre map." It's how catalog visitors find the feature. Needs a Grafana restart. | Only the catalog README; `plugin.json` untouched and no restart. |
| 7 | The release | **Not in this phase:** the version bump, tag, signing and submission follow on release day, after this merges. Plugin version unchanged. | Bumping to 1.0.0 here, so the tag is the only step left: the CHANGELOG would then date a release that hasn't happened. |

---

## Outcome

Implemented on branch `node-edge-phase-6`, branched from `node-edge-phase-5`, in three commits: steps 6.1, 6.3 and 6.4, with step 6.2's results and step 6.5's docs in a fourth. Every budget was met, so step 6.2 changed no code.

| # | Criterion | Result |
|---|---|---|
| 1 | Benchmark | Met. `network` and `styled-network` kinds, with **pin**, **search** and **sort** columns for the line of 2,000 rows. |
| 2 | Dashboard | Met. Network (panel 7) and Styled network (panel 8) on 11 Performance, generated from Rows, with a fixed view framing the grid and the line below it. |
| 3 | Budgets | Met at 100,000 edge rows, with room to spare (below). No fixes were needed. |
| 4 | Correct at scale | Met. Each run checks the drawn lines and points against the generated network: 12,502 nodes and 24,777 lines at 100,000 rows. |
| 5 | README | Met. Networks without "(preview)", opening with a seven-step walkthrough; Sizing with network figures; the dev dashboards table. |
| 6 | Release materials | Met. The status line, three CHANGELOG entries linked to #37–#40 and #49, the catalog README's Networks feature, section, sizing and limitations, and in `plugin.json` a fifth screenshot (`img/screenshot-network.png`), the `network` keyword and the description. |
| 7 | Validator | Met. `@grafana/plugin-validator`: no analyzer failed; the only finding is the expected unsigned-plugin warning. |
| 8 | Architecture docs | Met. node-edge architecture status, §8, §9.1, §9.2 and §9.3; ../architecture.md's status and a §4.2 row for networks. |
| 9 | Tests | Met. 686 unit tests and 79 e2e tests pass, unchanged. |

### Results

`npm run bench:map -- --kinds network,styled-network,points --rows 1000,10000,100000 --runs 3`, with the GPU, on the same machine as Phase 9. Medians of three runs; tasks in ms, "<50" when no task went over 50 ms.

| Kind | Rows | drawn | load | pan | hover | refresh | hide | show | basemap | pin | search | sort |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| network | 1,000 | 0.3 s | <50 | <50 | <50 | <50 | <50 | <50 | <50 | <50 | <50 | <50 |
| network | 10,000 | 0.4 s | <50 | <50 | <50 | <50 | <50 | <50 | <50 | 94 | <50 | 62 |
| network | 100,000 | 1.3 s | 164 | <50 | <50 | 62 | <50 | <50 | 55 | 96 | <50 | 69 |
| styled-network | 1,000 | 0.3 s | <50 | <50 | <50 | <50 | 53 | <50 | 62 | <50 | <50 | <50 |
| styled-network | 10,000 | 0.4 s | <50 | <50 | <50 | <50 | 54 | <50 | <50 | 92 | <50 | 62 |
| styled-network | 100,000 | 1.4 s | 195 | <50 | <50 | 61 | 54 | <50 | 75 | 93 | <50 | 71 |
| points | 1,000 | 0.3 s | 50 | <50 | <50 | <50 | <50 | <50 | <50 | – | – | – |
| points | 10,000 | 0.5 s | 53 | <50 | <50 | <50 | <50 | <50 | <50 | – | – | – |
| points | 100,000 | 2.2 s | 212 | <50 | <50 | <50 | <50 | <50 | 105 | – | – | – |

- **Load** (new data, budget 500 ms): 164 ms, and 195 ms with edge values for two columns. A network of 100,000 edge rows draws faster than 100,000 points: its rows carry no geometry to parse, and it draws about 25,000 lines.
- **Unchanged refresh** (200 ms): 62 ms. The edge result is reused, as designed in Phase 1.
- **The list** (200 ms): pinning a line of 2,000 rows formats them all once, up to 96 ms; sorting takes up to 71 ms, and searching stays under 50 ms per keystroke. The 500-row drawing cap keeps these flat between 10,000 and 100,000 rows: the heavy line has 1,000 rows at 10,000 and 2,000 at 100,000.
- Points match Phase 9's figures (212 ms against 215 ms to load), so the machine compares.

### Differences from the plan

- **The heavy line** has a tenth as many rows as the network, up to 2,000, not always 2,000: at 1,000 rows, 2,000 more would have tripled the network.
- **No adapter benchmark:** `joinEdges.bench.ts` was to profile a missed budget, and none was missed.
- **The search box** says "Search to narrow" above 500 rows, so the benchmark finds it by a placeholder starting with "Search".
- **Phase 4's Outcome** had the same "to be filled in" CI line; it's filled in from #40's checks.
- **The validator's zip** (`jdejesusio-geoflow-panel-<timestamp>.zip`) is left in the working tree, uncommitted.

### Checks

- Typecheck, lint, 686 unit tests and 79 e2e tests (after restarting Grafana for `plugin.json`), locally.
- `check:dist`: 21 files, all expected (the new screenshot).
- No seed data changed.
- CI: passed on [#50](https://github.com/jdejesus517/grafana-geoflow-plugin/pull/50): build, lint and unit tests, the compatibility check, the bundle size comparison, and e2e on Grafana 13.2.5, 13.3.0 and nightly.
