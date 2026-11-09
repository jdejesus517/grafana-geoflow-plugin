# Node-edge Phase 6: Hardening and the 1.0.0 release materials

Status: **Plan accepted** (2026-11-09). Decisions 1–7 accepted as proposed.
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

To be written when the phase is implemented.
