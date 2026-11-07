# Phase 9: Hardening

Status: **Approved** (2026-11-07). Decisions 1–10 accepted as proposed.
Architecture reference: [architecture.md](architecture.md) §2.2 (panel warnings), §4.1 (compatibility risks), §4.2 (performance), §5.3 (Phase 9 row).

## Goal

Make problems visible to the people who can fix them, and know what GeoFlow can handle.

Some of the Phase 9 row is already in place. The panel detects missing WebGL2 and says so (Phase 2), the README documents Content Security Policy (Phase 2), and the data summary lists skipped rows (Phase 3). What's left:
- **Warnings without the data summary.** Rows skipped, a missing ID column or a Color by column that's gone are only reported while **Show data summary** is on, and it's off by default. A dashboard can lose rows without anyone noticing.
- **Failure paths proven in a real browser.** No e2e test runs without WebGL2, and nothing checks what the map does when a query fails.
- **CSP for vector styles.** The docs were checked with raster tiles only. A style URL also loads vector tiles, glyphs and sprites.
- **A real benchmark.** Numbers so far are one-off measurements from Phases 3, 4, 7 and 8. This phase adds a repeatable benchmark at 1k, 10k and 100k features, sets budgets, and fixes what misses them.
- **Sizing guidance**, so users know what to expect before they build a dashboard.

## Exit criteria

1. **Warnings.** A panel with a problem shows a small warning on the map, whose details list each problem by layer, with **Show data summary** off. **Show warnings** in the panel options turns it off. A panel without problems shows nothing.
2. **What counts.** Rows skipped as invalid, unsupported, projected or out of range; a missing ID column; a missing Color by or Size by column; and more than 100k features in the panel. Empty geometry doesn't count: it's usually intended, such as an asset without a location. The data summary still lists it.
3. **Query failure.** When a query fails, the map keeps drawing its last data, and a later successful refresh with the same data is still an unchanged refresh.
4. **No WebGL2.** In a browser without WebGL2, the panel shows its message instead of a map, and the rest of the dashboard works (e2e).
5. **Software rendering.** The data summary says when the browser draws the map without a GPU, the most common reason for a slow map.
6. **CSP.** The README's CSP settings are confirmed on Grafana 13.2 with `content_security_policy = true`, for raster tiles, dark theme URLs and a vector style with glyphs and sprites.
7. **Benchmark.** `npm run bench:map` measures loading, panning, hovering, refreshes, hiding and showing a layer, and switching basemap, for points, lines, polygons and points colored by value, at 1k, 10k and 100k features. The results are recorded in this document.
8. **Budgets.** On 100k points with the GPU, on this machine:
   - panning, hovering, an unchanged refresh, and hiding or showing a layer cause no main-thread task over 200 ms
   - new data, on load or on a refresh, causes no main-thread task over 500 ms

   What misses a budget is fixed, or recorded with the reason it wasn't (decision 3).
9. **Sizing.** The README says what GeoFlow handles well, from the benchmark, and what to do beyond it.
10. **Saved dashboards unchanged.** The earlier stored screenshots still match. Panels with problems gain the warning, which is the point of this phase.
11. **Tests.** Unit, component and e2e tests pass locally and in CI. The benchmark isn't part of CI (decision 6).

## Out of scope

- **Vector tiles for very large data** ([architecture.md §7](architecture.md#7-features-considered-for-later)).
- **Querying the visible area** (§7).
- **A hard cap on features.** The panel warns and still draws (decision 7).
- **Moving tooltip code out of `module.js`.** The panel needs it as soon as a map exists, so a split saves little (decision 10).
- **The license review** (Phase 10).

---

## Starting point

| Already in place | From |
|---|---|
| `WebGLUnavailableError` and a message in the panel, covered by unit and component tests. | Phase 2 |
| **Reload map** when the browser takes a map's WebGL context away. | Phase 2 |
| Notices on the map for no geometry, a data layer error and a basemap error. | Phases 2, 3 |
| The data summary: rows skipped by kind, the first skipped row, missing columns. | Phases 3, 6, 7 |
| The README's CSP section, checked with raster tiles. | Phase 2 |
| `npm run bench:adapter`, which times conversion alone. | Phase 1 |
| `service_locations_large`: 100k points, seeded reproducibly. | Phase 0 |

**Checked while planning:**
- **Attribution HTML from a style URL is safe.** MapLibre 6 passes every attribution through its own `DOM.sanitize` before adding it to the page, so no extra escaping is needed.
- **Feature properties aren't used for drawing.** Style layers read feature-state, never properties, and tooltips read the frames. Only a GeoJSON Feature's own properties are read back, by `featureDetails`. Yet every column is copied into every feature and sent to MapLibre's worker (decision 5).

**What Grafana offers** (to confirm in step 9.1):

| Need | Available |
|---|---|
| A warning in the panel header | Grafana shows `frame.meta.notices` there, but they come from the data source. A panel can't add to them. Its documented way to report a problem is to throw an error, which replaces the panel. |
| Details on hover | `@grafana/ui`: `Tooltip`, `Icon` or `IconButton`. |
| The state of a failed query | `PanelData.state` and `errors`. What `series` holds at that point is checked in step 9.1. |

### Changes to the architecture

- **§2.2:** conversion warnings appear in a warning on the map, not "through Grafana's panel notice mechanism", which panels can't add to (decision 1).
- **§4.2:** the budgets and benchmark results replace the one-off numbers. The web worker row records the outcome of decision 4.

---

## Design

### 1. Warnings (`src/panel/panelProblems.ts`, `src/panel/MapWarnings.tsx`, new)

```ts
interface PanelProblem {
  layerId?: string;
  /** The layer's name, as tooltips show it. */
  layerName?: string;
  /** For example "12 rows skipped: invalid 10, out of range 2". */
  text: string;
}

function panelProblems(results, bound, frames): PanelProblem[];
```

- `panelProblems` is the one place that works out what's wrong. The data summary's per-layer lines (`layerProblems`, `dataStyleFields(...).problems`) move into it, so the two can't disagree.
- `MapWarnings` shows a warning icon and a count in the bottom-left notices, above the legend. Hovering or focusing it lists the problems, with the first skipped row's reason for each layer.
- **Show warnings:** a panel option, default on (decision 2).
- The existing notices for no geometry, layer errors and basemap errors stay, since they mean nothing is drawn.

### 2. Query failures and WebGL (`MapPanel`, `convertFrames`)

- **Query failure:** depending on step 9.1, the panel holds its last `data.series` while `data.state` is `Error` and the new response has no frames, so the map and the conversion history survive. Grafana's own error indicator tells the user the query failed.
- **WebGL:** the panel code stays. An e2e test runs a browser with WebGL2 turned off.
- **Software rendering:** `MapEngine` gains `softwareRendering(): boolean`, from the `WEBGL_debug_renderer_info` renderer name (SwiftShader, llvmpipe and similar). The data summary adds a line when it's true (decision 8).

### 3. Hints for large and unordered data

- **More than 100k features** in the panel: a warning that suggests filtering in the query, or `ST_SimplifyPreserveTopology` for detailed polygons (decision 7).
- **Rows that change order:** Phase 8 found that a query without `ORDER BY` turns every refresh into changed data. When a refresh brings the same ids in another order, the data summary says to add one. It's checked only for layers with keys, only when the data changed and the row count didn't (decision 9).

### 4. Benchmark (`scripts/bench-map.mjs`, `11-performance.json`, new)

A provisioned dashboard with a `rows` variable (1000, 10000, 100000), and one panel per kind, each with `LIMIT $rows` and an `ORDER BY`:

| Panel | Query |
|---|---|
| Points | `service_locations_large` as it is |
| Lines | A short line from each point, made in the query |
| Polygons | A small square around each point, made in the query |
| Colored points | Points with Color by on `service_tier` |
| Changing points | Points with a `now()` column, so every refresh is new data |

`bench-map.mjs` drives Playwright's Chromium with the GPU flags from Phase 4 and prints a Markdown table.

| Measure | How |
|---|---|
| Load | Time from the query response to all features drawn, and the longest main-thread task |
| Pan, hover | Longest main-thread task over a scripted drag and pointer path |
| Unchanged and changed refresh | Longest main-thread task, from the refresh to 3 s later |
| Hide, show | Longest task, in the panel editor |
| Basemap switch | Longest task, in the panel editor: Phase 3 found that a switch deep-copies every GeoJSON source |

The drawn-feature hook costs about 300 ms at 100k features (Phase 6). So each case runs twice: once with the hook for the time to draw, and once without it for the main-thread tasks. Each number is the median of 3 runs. No new test hook is needed.

### 5. Optimization

In this order, stopping when the budgets are met (decisions 3 to 5):

1. **Lean features:** keep column values out of the FeatureCollection sent to MapLibre. Features carry their geometry and id, and only a GeoJSON Feature's own properties stay, for `featureDetails`, which moves to a separate list in `ConversionResult`. This saves copying in the conversion and serializing to the worker, both part of the 360 ms task on changed data (Phase 8). How much it saves is what the benchmark will show.
2. **Whatever the benchmark shows next**, such as basemap switches or per-feature colors.
3. **A web worker for conversion**, only if new data still misses its budget. Frames would be copied to the worker, which has a cost of its own, so this needs measuring first.

### 6. CSP

Grafana in the dev stack with `content_security_policy = true`, and a stub vector style on the stub tile host, with vector tiles, glyphs and sprites. The check records what each needs, and the README is corrected. It's a manual check, as in Phase 2, since the setting is server-wide and would apply to every e2e test.

### 7. Testing approach

**Unit tests:** `panelProblems` for each kind of problem, with empty rows left out; the reorder hint; the renderer names; lean features (`featureDetails` still lists a Feature's properties and every column).

**Component tests:** the warning's count and details, **Show warnings** off, no warning without problems; the summary and the warning agree; a failed query keeps the map's data.

**E2E (`10-hardening.json`, `tests/hardening.spec.ts`):**
- a panel with bad rows and a missing Color by column shows the warning and its details
- a panel with only empty geometry shows none
- a browser without WebGL2 shows the message, and other panels still load
- a query that fails on refresh keeps the features drawn

---

## Steps

Each step is one commit, tested before the next.

### 9.1 Checks on Grafana 13.2

- What `data.series`, `data.state` and `data.errors` hold when a query fails on a refresh.
- That a panel can't add to the header's notices.
- Which Chromium flags turn WebGL2 off in Playwright.
- Whether `WEBGL_debug_renderer_info` is available in Grafana's supported browsers, and what it says for software rendering.
- CSP for raster tiles, dark theme URLs and a vector style (Design §6).

### 9.2 Benchmark

`11-performance.json`, `bench-map.mjs`, `npm run bench:map`. Record the baseline in this document before optimizing.

### 9.3 Optimization

Design §5, one commit per optimization, re-running the benchmark after each.

### 9.4 Warnings

`panelProblems`, `MapWarnings`, **Show warnings**, the data summary on top of them. Unit and component tests.

### 9.5 Query failures, software rendering and hints

Design §2 and §3. Unit and component tests.

### 9.6 Dashboard and e2e tests

`10-hardening.json` and `tests/hardening.spec.ts`.

### 9.7 Docs

- README: warnings, the corrected CSP section, **Sizing**, `bench:map`, the dashboards
- architecture.md: §2.2, §4.2 with the budgets and results
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| Warnings annoy viewers on dashboards with known bad rows. | Empty geometry doesn't count, and **Show warnings** turns them off per panel. |
| The warning covers features or the legend. | It's one small icon in the existing notices, with the details on demand. |
| Lean features break something that reads properties. | Only `featureDetails` does, and unit tests cover it. The benchmark shows whether it's worth the change; if it saves little, it's dropped. |
| Budgets depend on this machine. | They're recorded with the machine's GPU and browser, and the benchmark can be run again anywhere. The results are for comparison, not a promise. |
| A web worker needs copying frames across, and webpack and Grafana's CSP have to allow it. | It's the last resort, measured before it's built. The worker would be same-origin, like MapLibre's. |
| Holding the last data after a failed query shows stale features. | Grafana's error indicator is on the panel, and it matches what time series panels do. Step 9.1 confirms what they do. |
| The reorder check adds work to changed refreshes. | It runs only when the row count is the same and the layer has keys. It's included in the benchmark. |

---

## Decisions

Accepted as proposed (2026-11-07):

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Where warnings show | **A small warning on the map, with details on hover.** Panels can't add to Grafana's header notices. | Throwing an error, Grafana's documented way: it replaces the whole panel, far too strong for 3 bad rows. Or the data summary only: nobody sees it. |
| 2 | Who sees them | **Everyone, with a Show warnings option, default on.** Panels don't know whether they're being viewed or edited, and Grafana's own notices show to everyone. | Only in the panel editor: viewers are often the first to notice missing assets, and it can't be detected reliably. |
| 3 | Budgets | **200 ms for interactions and unchanged refreshes, 500 ms for new data**, at 100k points. 200 ms carries on from Phases 4, 7 and 8. New data arrives rarely, and costs about 360 ms today. | One 200 ms budget for everything: likely forces a web worker for data that arrives once a minute. |
| 4 | Web worker | **Only if new data still misses its budget after cheaper fixes**, as Phases 1 and 3 planned. | Build it now: main-thread conversion goes away, but frames must be copied, and it adds a bundled worker to maintain. |
| 5 | Lean features | **Try it first:** keep column values out of the data sent to MapLibre. | Leave properties in: simplest, but pays to serialize data nothing reads. |
| 6 | Benchmark | **A local script with the GPU, not in CI.** CI runners have no GPU and noisy timings (Phase 1). The fixture table gives lines and polygons through SQL, so no new seed data. | Timings in CI as a regression gate: software rendering would swamp the numbers. |
| 7 | Very large results | **A warning above 100k features, no cap.** §4.2 sets 100k as the limit of the design, and some users will accept a slow map. | A hard cap with a setting: hides data, which is worse than being slow. |
| 8 | Software rendering | **A line in the data summary.** It explains slow maps without alarming viewers on maps that are small enough to be fine. | A warning for everyone: most small maps run well without a GPU. Or nothing: users can't tell why a map is slow. |
| 9 | Rows that change order | **A hint in the data summary**, for layers with keys. Not a warning: the map is correct, just slower. | The README only, as now: the people affected won't have read it. Or an order-insensitive comparison: tooltips read rows by position, so a reused conversion would point at the wrong rows. |
| 10 | Splitting `module.js` | **Leave it** (66.5 KiB, 19.5 KiB gzip). It only loads on dashboards with a GeoFlow panel, which then need nearly all of it. Phase 4 raised this as a possibility. | Moving tooltips into the lazy chunk: a few KiB, and more moving parts. |
