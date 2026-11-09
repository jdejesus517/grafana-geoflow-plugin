# Node-Edge Maps: Architecture

Status: **Design accepted (2026-11-08).** Phases 1–4 implemented: edges drawn ([phase_1.md](phase_1.md)), set up in the Layers list ([phase_2.md](phase_2.md)), hover totals ([phase_3.md](phase_3.md)), the click list ([phase_4.md](phase_4.md)). Implementation follows in phases (§9.3), each with its own `docs/node-edge/phase_N.md`.

This feature extends GeoFlow as built through Phase 12 ([../architecture.md](../architecture.md)). It keeps that document's rules unless a decision here says otherwise.

---

## 1. Vision

Draw a network on the map: **nodes** are locations from one query, and **edges** are links between them from another. The edge query returns no geometry. Each row names the two nodes it connects, and GeoFlow draws the line between their points.

Several links often run between the same two locations, for example multiple trunks between two sites. GeoFlow draws them as **one line** and treats them as a group:
- **Hover** shows the group's totals, such as total capacity and average utilization.
- **Click** opens a list of the group's rows, one per link, which can be searched, sorted and scrolled.
- A **ratio** of two columns (for example utilization ÷ capacity) shows next to the raw values, per link and for the group.

Example: three trunks between A and B. Hovering the A–B line shows a total capacity of 120G and 31% utilization. Clicking it lists the three trunks with each one's capacity, utilization and percentage.

## 2. Goals and non-goals

| Goals | Non-goals |
|---|---|
| A node layer from a point query, keyed by a unique ID column | Layouts computed by GeoFlow (schematic graphs): Grafana's Node graph panel covers those |
| An edge layer from a query without geometry, joined to nodes by from and to ID columns, detected or chosen | Edge geometry returned by the query (routes along streets or ducts): that's an ordinary line layer today |
| One line per pair of nodes, whatever the number or direction of the rows between them | Separate lines per direction or per row, fanned out or offset (decision 2) |
| Hover totals and click lists of a pair's rows, with search, sort and scrolling | |
| A numerator and denominator column giving a ratio per row and per pair | |
| Each row's data links in the click list | |

## 3. Concepts

- **Node layer:** an ordinary layer whose query returns point geometry and a unique ID column. It's drawn, styled and hovered like any point layer, and also supplies positions to edge layers.
- **Edge layer:** a layer whose query returns no geometry, only a **from** and a **to** column holding node IDs, plus any values. It joins to the panel's node layer (decision 8).
- **Edge (row):** one row of the edge query: one link, with its own direction (from → to) and values.
- **Pair:** the two nodes an edge joins, without order: A–B and B–A are the same pair. All of a pair's rows are drawn as one line.
- **Aggregates:** values computed over a pair's rows (for example sum and average), shown on hover and usable for styling.
- **Ratio:** numerator ÷ denominator. Per row, it's that row's ratio. Per pair, it's the sum of the numerators ÷ the sum of the denominators, never an average of the rows' ratios: trunks of 10G at 90% and 100G at 10% carry 19G of 110G (17%), not 50%.

## 4. Data and query shape

Two queries, for example:

```sql
-- Nodes (query A): point geometry and a unique id.
SELECT site_id AS id, name, ST_AsGeoJSON(geom) AS geometry FROM sites;

-- Edges (query B): no geometry; from and to name nodes by id.
SELECT trunk_id, a_site AS source, z_site AS target, capacity_gbps, utilization_gbps FROM trunks;
```

- **Node ID:** the node layer's ID column (the existing per-layer ID column setting, default `id`). Must be unique; duplicates are a warning.
- **From and to:** detected by name pairs (`source`/`target`, `from`/`to`, `a_end`/`z_end`, `start`/`end`, and similar), or chosen in the layer's settings.
- **Joining:** an edge whose from or to ID matches no node, or whose node has no point geometry, isn't drawn, and is counted in the map's warnings. A self-loop (from = to) is skipped with a warning.
- **Pair key:** the two node IDs in sorted order, so A→B and B→A share a key.

## 5. Fit with the existing architecture

GeoFlow has three layers, and the boundaries between them are enforced by lint (§1 and §2 of [../architecture.md](../architecture.md)). Most of the work is in the adapter; the engine gains one capability.

| Layer | Today | Node-edge work |
|---|---|---|
| Panel (`src/panel/`) | Options, editors, React glue, overlays | Layer roles and edge settings in the Layers editor; the Edges field options; running the edge join after conversion; the pair tooltip (hover aggregates) and the click list component; network warnings |
| Adapter (`src/adapter/`) | `DataFrame` → `FeatureCollection` → `LayerSpec[]` | Roles in `LayerConfig` and `BoundLayer`; detecting from and to columns; joining edges to nodes and grouping them into pairs; aggregates and ratios; pair values for styling; pair tooltip content |
| Engine (`src/engine/`) | `MapEngine` on MapLibre; no Grafana or React | Per-feature line widths (`FeatureStyles.widths`). Edges are otherwise ordinary LineString features in an ordinary layer. |

Constraints carried over:
- The engine stays free of Grafana, React and Emotion, and its input stays plain TypeScript objects.
- Data reaches the panel only through Grafana's data sources; the plugin has no backend.
- Refreshes update the map in place, and the map is created and destroyed with the panel's visibility.

### 5.1 The panel's pipeline

Today ([MapPanel.tsx](../../src/panel/MapPanel.tsx)):

```
data.series ─ holdSeries ─▶ frames ─ bindLayers ─▶ layers ─ convertFrames ─▶ results ─ buildLayerSpecs ─▶ LayerSpecs
```

With networks, conversion gains a second pass, and the other steps learn about roles (as built in Phase 1):

```
frames ─ bindLayers ─▶ layers (with roles)
       ─ convertFrames ─▶ results            1. geometry and node layers, as today; edge frames skip conversion
                                             2. joinEdges: the edge frame + the node layer's result → one LineString per pair
       ─ buildLayerSpecs ─▶ LayerSpecs        pair values style the edge layer
```

- **`bindLayers`** reads each layer's role from its settings. It doesn't enforce one Nodes and one Edges layer: `networkLayers` picks the first of each, in the Layers list's order, and `networkProblems` warns about the rest.
- **`convertFrames`** converts geometry and node layers as today. An edge layer's frame has no geometry, so it's left out of that pass, and of the "no geometry column" notice and warnings. A second pass then joins the network's edge layer with **`joinEdges`** (adapter), from its frame and the node layer's result: a `ConversionResult` whose features are one LineString per pair, plus the pairs' rows (§5.2). Results stay one per frame, in frame order, as everything downstream expects. An edge result is reused as other results are (the same arrays, or a refresh with the same values), as long as the node result is the same object and the same columns join them; other Edges layers, and a network that can't be joined, get an empty result.
- **`buildLayerSpecs`** gives the edge layer per-feature colors and widths from pair values (§6.3), and the others their styles as today.

Everything after `buildLayerSpecs` (legend, fit, warnings, tooltips) reads the edge result like any other, with the exceptions in §5.2.

### 5.2 The edge result

An edge result is a `ConversionResult` (so fit, warnings, the data summary and pinned tooltips work unchanged) with these additions:

```ts
interface EdgePair {
  key: string;            // the two node ids, as text, sorted and joined: "A\u0000B"
  nodes: [string, string]; // the node ids in key order: the line runs from nodes[0] to nodes[1]
  rows: number[];         // the edge frame's rows in this pair, in query order
}

interface ConversionResult {
  // ...as today...
  styleField?: string;    // the column Map style is read from: the geometry column, or an edge layer's from column
  pairs?: EdgePair[];     // edge results only: one per feature, in feature order
  edgeFields?: { from: string; to: string }; // edge results only: the columns joining them
}
```

- **Features:** one LineString per pair, between the two nodes' points, with feature id = its index, as for other layers.
- **Keys:** `featureKeys` holds the pair keys (`keyField` stays unset: the keys don't come from one column), so a pinned pair is found again after a refresh by its key, as pinned features are today ([useFeatureTooltip.tsx](../../src/panel/useFeatureTooltip.tsx), `resolvePinned`).
- **`featureRows`:** each pair's first row. Code that reads one row per feature (only feature tooltips and per-feature colors today) goes through `pairs` for edge results instead.
- **Warnings:** the edge result's `warnings` counts rows not drawn, with new warning kinds: `unknownNode` (from or to matches no node, or one without a point), `selfLoop` (from = to) and `missingEnd` (from or to empty). Node problems are counted here too, not on the node result, which is shared and cached: `duplicateId` and `notAPoint`, whose samples hold the node layer's row and read "Nodes row 2".
- **Bounds:** the box around the drawn lines, for Fit to data.

### 5.3 Joining

- **Node positions:** read from the node layer's result: each feature's point, under its ID column's value. A node whose geometry isn't a Point can't anchor edges; it's counted as `notAPoint` on the edge result. A node whose geometry the node layer skipped (empty or invalid) has no position, and edges to it say so. A MultiPoint isn't accepted, because it has no single position.
- **Matching ids as text** (decision 13): node and edge ids are compared as text, so a site id that is `integer` in one table and `text` in the other still joins. `1` and `"1"` match; `1.0` and `"1"` don't.
- **Duplicates:** the first node with an id wins; the rest are counted as `duplicateId`. The join reads the id column itself, so node feature keys, which need unique ids, aren't required.
- **Pairs:** grouped in one pass over the edge rows. Pairs are ordered by their first row, so the drawing order is stable across refreshes that bring the same data.

### 5.4 Panel components

- **Layers editor:** a **Role** select per layer (Geometry, Nodes, Edges). For an edge layer, **From column** and **To column** pickers (showing the detected columns until chosen), and **Show direction**; the geometry and ID column pickers are hidden for it. Edge rows need no ID: pairs are keyed by their node ids, pinned pairs are found again by that key, and the click list is rebuilt from the pair's rows. The node layer keeps the existing ID column picker, which becomes required in practice (it defaults to `id`).
- **Tooltips:** `tooltipFeatures` builds a pair entry for an edge feature: a hover entry with the pair's aggregates, or, pinned, the click list. The pager handles both kinds of entry (§6).
- **`EdgeList`** (new component): the click list, with search, sort, scrolling (decision 7) and each row's data links (decision 15).
- **`networkProblems`** (new, beside `panelProblems`): warnings for a second Nodes or Edges layer, an edge layer without a node layer, from or to columns not found, and an edge or node query split into several frames.

## 6. Rendering and interaction

- **Drawing:** one line per pair, between the two nodes' points. Straight lines (decision 6). The edge layer is drawn where it sits in the Layers list, like any layer (decision 14); placing it below the node layer keeps nodes on top and clickable, and is how a new edge layer is placed when its role is set.
- **Hover:** the pair's aggregates, for example total capacity, average utilization and the pair's ratio, formatted with each column's unit.
- **Click:** a pinned popup listing the pair's rows, one per edge, with a search field, sortable columns and scrolling. Each row shows its direction (A → B or B → A), its values and its ratio. It's a new component, since Grafana's tooltip shows one feature's fields, not a table.
- **Styling:** edges are colored or sized by a column's pair value (decision 11), for example the pair's ratio through the ratio column's thresholds (decision 10), extending data-driven styling (Phase 6) from feature values to pair values.
- **Direction:** see decision 2. Rows keep their direction; the line has none.
- **Hit testing:** edge layers aren't interactive until their own tooltip arrives (Phase 3): the feature tooltip would show a pair's first row as if it were the pair. From then, an edge layer is an ordinary line layer to the engine, so hover and click find it as they do any line: features within a few pixels of the pointer (`HIT_TOLERANCE_PX`), topmost first, with the hovered one highlighted through feature-state. Nodes draw above edges, so near a node the node comes first. A click near a node often catches the node and several edges, so the pinned tooltip's pager mixes node entries (the node's fields) and edge-pair entries (the pair's list); each entry renders its own kind of content.

### 6.1 Hover

The tooltip names the pair by its node ids ("Between SITE-04 and SITE-11") and counts its rows ("Items 3": viewers needn't know graph terms; node-edge Phase 4, decision 8). Then one line per chosen aggregate, per column, in query order: "capacity_gbps: sum 120 Gb/s, avg 40 Gb/s". Ratio columns show their pair value: "utilization: 31%". Aggregates are computed for the hovered pair only, and kept per pair until the data changes, so moving along a line costs nothing.

**From Phase 5 (agreed in Phase 4's review):** with Phase 4's Summary | Items switch, the pinned tooltip's Summary shows all of this, so the hover becomes a glance: Between, Items, and the pair values behind the edge layer's Color by and Size by, which say why the line looks as it does. A hover can't scroll, so a long summary there gets cut off. With no Color by or Size by, the hover keeps the full summary, so panels without styling lose nothing.

### 6.2 Click list

A pinned tooltip on a pair shows its header and a **Summary | Items** switch (node-edge Phase 4): Summary is the hover's content, Items the list, each with the tooltip's whole height. It opens on Items. The list:
- **Columns:** direction (unless Show direction is off), then the edge query's columns in query order, less those hidden from tooltips (decision 9). Values are formatted with each column's display processor, as in feature tooltips.
- **Search, sort, size:** decision 7, refined in Phase 4: a third header click returns to query order, and counts read "items", not links, since viewers needn't know graph terms (node-edge Phase 4, decisions 2 and 8). Formatted values are computed once per pair when the list opens, for searching and display; sorting uses the raw values.
- **Width:** a table needs more room than a tooltip's 400 px, so the list may use the map's full width (`tooltipSpace`), up to 800 px.
- **Rows:** numbered as listed, in a first column that stays in view scrolling either way. Every row is 24 px; the list shows the header and whole rows, at least one, above any horizontal scrollbar, and moves one row per wheel notch.
- **Data links:** per row (decision 15). A final column, shown when any column of the edge query has data links: a link icon on each row when the query has one link setting, or an icon button opening a menu (Grafana's `Dropdown` and `Menu`) when it has several (node-edge Phase 4, decision 4). A row's links are those of every column for that row, deduplicated, hidden columns included, as `featureDetails` gathers a feature's ([featureDetails.ts](../../src/adapter/featureDetails.ts)); variables such as `${__data.fields.trunk_id}` take that row's values. They're built when the row's button is used, not for every drawn row. The hover has no links: it covers the whole pair, not one row.

### 6.3 Styling

An edge layer is styled like any line layer: color, opacity, width and line style from Map style, set per query like any layer's (decision 12). Internally the style is read from the from column, which takes the place of the geometry column that styles other layers; only an override by column name has to target it.

Color by and Size by name a column, as today, and each pair gets one value from it (decision 11): a ratio column's ratio of sums, or the column's Pair value (sum by default). That value goes through the column's display processor for its color, as in Phase 6. Differences from Phase 6:
- **Ranges:** a gradient spans the pair values (for example the pairs' total capacities), not the column's row values, which sums exceed.
- **Size by sets line width** for an edge layer, between Min and Max size, where it sets point radius for points. The engine gains per-feature widths for it.
- **Legend:** the edge layer's entries come from its Color by column's field config, as for other layers; a gradient's ends show the pair values' range.

## 7. Options

New settings, all optional. Saved dashboards are unchanged: a layer without a role is a geometry layer, and a column without the new field options isn't aggregated. No `plugin.json` change.

**Layer settings** (`LayerConfig`, the Layers editor):

| Setting | Values | Default |
|---|---|---|
| `role` | `geometry`, `nodes`, `edges` | `geometry` |
| `fromField`, `toField` | column names | detected (§4) |
| `showDirection` | boolean | `true` |

**Field options** (`custom`, in a new **Edges** category, set per column through overrides):

| Option | Values | Default | Used for |
|---|---|---|---|
| `edgeAggregates` | any of sum, mean, min, max, count | none | Hover (decision 5) |
| `pairValue` | sum, mean, min, max, count | sum | Color by and Size by on edges (decision 11) |
| `ratioNumerator`, `ratioDenominator` | column names | unset | Makes the column a ratio (decision 10) |

Field options can't be shown only for edge layers' columns: Grafana decides what to show from the options, not from which layer a column belongs to. The **Edges** category therefore appears for every column, described as applying to edge layers, and is collapsed by default.

## 8. Compatibility, performance and risks

| Risk | Mitigation |
|---|---|
| Ids that look alike but don't match (`1` vs `"1 "`, `1.0` vs `"1"`) | Text matching (decision 13); `unknownNode` warnings with samples, in the data summary, naming the ids that didn't match |
| An edge frame has no geometry, which today means a "no geometry column" notice and conversion warnings | Edge layers skip conversion and those notices (§5.1) |
| Edges colored by a column's row range rather than the pairs' (for example total capacity past the row maximum) | Ranges from pair values (§6.3) |
| The Edges field options clutter every column's options | Their own category, collapsed, with descriptions (§7) |
| Large networks: 20,000 edges in 5,000 pairs | Grouping is one pass over the rows; aggregates are computed per hovered pair; pair values only for the Color by and Size by columns. To measure in the delivery's benchmark, with the Phase 9 budgets |
| Pairs with thousands of rows | The click list's 500-row cap (decision 7); formatted values computed once per open list |
| Nodes refreshing moves edges | Edges are rebuilt from the node result whenever it changes; a refresh with the same node data keeps the same result, so edges aren't rebuilt |
| A pinned pair whose rows change on refresh | Found again by its pair key, with the new rows; closed if the pair is gone |
| Partition by values on an edge or node query | Several frames: only the first is used, with a warning (decision 8) |

Grafana compatibility is unchanged: the feature uses the same APIs as Phases 4–6 (field config, display processors, the field name picker).

## 9. Testing and delivery plan

### 9.1 Test data and dashboard

- **Seed data:** `geoflow.sites` (points, integer ids) and `geoflow.trunks` (text `a_site`/`z_site`, capacity and utilization), in a new init file. It covers: several trunks per pair in both directions, a single-trunk pair, a self-loop, an unknown site, an empty end, a duplicate site id, a site with no geometry, and a generated large network for the benchmark.
- **Dashboard:** `14-node-edge.json`, one panel per behavior: a basic network, aggregates and a ratio, styling by ratio and by count, problems, and the large network. Every panel doubles as an e2e fixture, as before.

### 9.2 Tests

| Level | Covers |
|---|---|
| Unit (adapter) | Role binding; from/to detection; the join (text matching, duplicates, self-loops, unknown and empty ends, non-point nodes); pairing and keys; aggregates (nulls, counts, time columns); ratio of sums; pair values and their ranges; pair tooltip content |
| Unit (engine) | Per-feature widths through feature-state |
| Component | Layers editor role and edge settings; `EdgeList` search, sort, cap, direction column and row links (one link, a menu of several, none); the panel running the join and its warnings |
| End-to-end | Edges drawn between the right nodes; hover aggregates; the click list's search and sort; a row's data link carrying that row's values; a pinned pair through a refresh; styling by ratio; the warnings |
| Benchmark | The large network in `bench-map.mjs`: join time, drawing, hover and refresh |

### 9.3 Phases

Each phase ends with something usable and its own tests, as in the main plan. Phase 1 builds the data path on its own, with roles set in the provisioned dashboard's JSON, so the editor (Phase 2) has a working network to edit. Plan documents go in `docs/node-edge/phase_N.md`.

| Phase | Deliverable | Verified by |
|---|---|---|
| 1 | **Edges drawn:** roles and from/to columns in the layer settings (set in the dashboard's JSON until Phase 2), from/to detection, the join and pairing, edge frames left out of conversion and its notices, plain lines styled per query (decision 12), the warnings; seed data and the dashboard's basic and problems panels | Unit tests on detection, the join and pairing; e2e: edges between the right nodes, warnings |
| 2 | **Layers editor:** the Role select; From and To column pickers showing the detected columns; geometry and ID column pickers hidden for edge layers; a layer whose role becomes Edges moves below the node layer (decision 14) | Component tests on the editor; e2e: making a network from two geometry layers in the editor |
| 3 | **Hover:** the Edges field options for aggregates and ratios; the pair tooltip with row count, aggregates and ratios; pinned pairs following refreshes (showing the hover content until Phase 4) | Unit tests on aggregates and ratios; e2e hover |
| 4 | **Click list:** `EdgeList` with search, sort, scrolling and the cap; the direction column and its Show direction switch; row data links; the pager mixing node and pair entries | Component tests; e2e click, search, sort and a row's link |
| 5 | **Styling by pair values:** Pair value; Color by and Size by on edges; per-feature widths in the engine; legend; the hover shows the styled pair values (§6.1) | Unit tests on pair values and ranges; e2e styling |
| 6 | **Hardening and docs:** the large network benchmark and any optimization; README walkthrough; architecture updates | Benchmark against budgets; docs reviewed |

## 10. Decisions

All accepted 2026-11-08; 12–14 came with the components (§5–§9), and 15 brought data links into scope.

| # | Topic | Proposal | Alternatives |
|---|---|---|---|
| 1 | Where the feature lives | **In the GeoFlow panel, as layer roles.** Each layer in the Layers list gets a role: Geometry (today's), Nodes or Edges. Node and edge layers share the map, basemap, legend, tooltips and refresh with geometry layers. | A panel mode (Geometry or Network); a separate panel plugin, with its own ID, review and releases. |
| 2 | Direction | **Undirected lines, directed rows.** One line per pair, keyed by the sorted node IDs, so one hover or click captures every row between A and B. Each row keeps its from and to, shown as A → B or B → A in the click list. A per-direction split of the hover aggregates is a feature for later (§12). | Directed lines: two per pair, offset or fanned, with arrows; one hover would no longer capture both directions. |
| 3 | Ratio aggregation | **Ratio of sums** for a pair: sum(numerator) ÷ sum(denominator). Per row, that row's ratio. | Average of the rows' ratios, which misweights links of different sizes. |
| 4 | Choosing the node layer and columns | **In the edge layer's settings:** its from and to columns, detected by name and overridable. With one node layer per panel (decision 8), the edge layer needs no setting to name it. The node ID is the node layer's ID column. | A panel-wide "node query" option. |
| 5 | Aggregates | **Sum, average, min, max and count, chosen per column.** Chosen in field config (a GeoFlow field option, set per column through overrides, as styling is since Phase 5); none by default, so the hover shows only the pair's row count until columns are chosen; sum and average for numeric columns, min and max for numeric and time columns, count for any column; nulls are skipped, and count counts non-null values; values are formatted with the column's unit and decimals, counts as plain numbers; the from and to columns can only be counted, which is the natural way to count links. A link's own id column (such as `trunk_id`) is an ordinary column, aggregated only if chosen. | An aggregates list in the edge layer's settings; a default of sum for every numeric column, which would add up meaningless numbers such as VLAN IDs. |
| 6 | Edge shape | **Straight lines** between the two nodes' points, straight on the map as drawn (Web Mercator). Long edges therefore don't follow the great circle, and an edge between nodes either side of the 180° meridian runs the long way round; both are acceptable for networks within a region. | Great-circle curves; slight arcs to lift edges off the roads beneath. |
| 7 | Click list size | **Scrolling, with search and sort.** Search and sort cover all of the pair's rows, and the list draws the first 500 of the result, with "Showing 500 of 2,340 links. Search to narrow." when there are more. Search is case-insensitive over the displayed (formatted) values. A column header click sorts ascending, then descending; numbers and times sort by value, not as text; the default order is the query's. A count ("12 of 40 links") shows while searching. Headers stay visible while scrolling, and the list fits within the map, as tooltips do (Phase 4). | Drawing every row (slow past a few thousand); drawing only the visible rows (virtual scrolling: a dependency or more code, kept for later if the cap proves too small); paging. |
| 8 | Number of node and edge layers | **One Nodes layer and one Edges layer per panel**, beside any number of geometry layers. One edge layer keeps every link between two nodes in one line and one list; one node layer keeps node IDs unambiguous for the join. Several kinds of link or node go in one query (`UNION ALL` with a type column), colored by type with data-driven styling and filtered with a dashboard variable. A second Nodes or Edges layer, including one from Partition by values on a node or edge query, is a warning on the map and isn't drawn as a network. The adapter's model still records which node layer an edge layer joins, so the limit can be lifted later. | Several edge layers sharing a node layer (per-kind layer toggling and overrides, but one pair split across lines and lists); several node layers (IDs must then be unique across them, or qualified by layer). |
| 9 | Click list columns | **Every column of the edge query**, in query order, after a direction column (A → B or B → A). Columns hidden with GeoFlow's existing **Hide in tooltip** field option (`custom.hideInTooltip`, Phase 4) are left out, as in feature tooltips, so a column can already be dropped through an override. The direction column isn't a query column, so field options can't reach it: a **Show direction** switch in the edge layer's settings, on by default, hides it. The from and to columns are query columns and follow the normal rule, so either the direction column, the raw IDs or both can be shown. | A column chooser in the edge layer's settings, listed in §12 for if the list proves cluttered. |
| 10 | Ratios and styling by them | **A ratio is a real column that GeoFlow aggregates correctly.** The user adds it in SQL (`utilization_gbps / capacity_gbps AS utilization`) or with Grafana's Add field from calculation transformation, so its field config gives it a unit (for example Percent (0.0–1.0)), thresholds, a color scheme and a display name, and the legend follows. A GeoFlow field option on it, **Ratio of**, names its numerator and denominator columns; a pair's value is then sum(numerator) ÷ sum(denominator) (decision 3), while each row shows the column's own value. Color by works unchanged: the edge takes its pair's ratio through the column's thresholds (Phase 6). Any number of ratio columns; their unit decides how they read. | A ratio computed by GeoFlow from settings in the edge layer: no field config to give it a unit, thresholds or colors, so GeoFlow would rebuild Grafana's thresholds editor. |
| 11 | Pair values for styling | Coloring or sizing edges by a column uses one value per pair: a ratio column's ratio of sums (decision 10), otherwise the column's sum by default, changeable to average, min, max or count (sum for capacity, max for worst-case values such as error rates, count for the number of links: width by count makes a pair of eight trunks stand out from a single one). Count counts the column's non-null values, so a column that's never null, such as the link's name or ID, counts links. | Always the sum; the first aggregate chosen for the hover (decision 5), which ties styling to what the hover shows. |
| 12 | Where an edge layer's style is read from | **Set like any layer's: per query**, through field defaults or a "Fields returned by query" override, which is how layers are styled since Phase 5. Internally, Map style (color, width, line style, Color by, Size by) is read from the edge layer's **from** column, standing in for the geometry column other layers read it from: the one column an edge query must have. Only a "Fields with name" override has to name it. | Reading it from a required edge ID column: as arbitrary, and a requirement nothing else needs; a style section in the edge layer's settings, duplicating Map style; any column, ambiguous when overrides by name disagree. |
| 13 | Matching node and edge ids | **As text.** Integer site ids join to text trunk ends, a common mismatch between tables. | Exact values, which would need casts in SQL. |
| 14 | Edge layer drawing order | **The Layers list's order, as for any layer.** Setting a layer's role to Edges moves it just below the node layer, so nodes stay on top; it can be moved after. | Edges always drawn directly below nodes, whatever the list says. |
| 15 | Data links in the click list | **Each row's data links**, from a link icon (one link) or a menu (several) in a final column, gathered as feature tooltips gather a feature's, and built when used (§6.2). | Left for later; links in the pair's hover, which has no single row to take values from. |

## 11. Open questions

Answered by the vision: positions are geographic (PostGIS points); nodes and edges come from separate queries; edges carry values; several edges between two nodes are drawn as one line.

Still open:
1. ~~**Aggregates:**~~ answered: sum, average, min, max and count, chosen per column (decision 5).
2. ~~**Ratio:**~~ answered: ratio columns, any number, each with its own unit (decision 10).
3. ~~**Several edge layers:**~~ answered: one of each per panel (decision 8).
4. ~~**Edge shape:**~~ answered: straight lines (decision 6).
5. ~~**Hover target:**~~ answered: as for any line layer (§6). Highlighting a node's edges on hover is listed in §12.
6. ~~**Click list size:**~~ answered: scrolling with search and sort, drawing at most 500 rows (decision 7).
7. ~~**Columns in the click list:**~~ answered: all columns, less those hidden from tooltips (decision 9).
8. ~~**Direction in the hover:**~~ answered: later; listed in §12.

## 12. Features for later

Considered, and left out of the first version.

| Feature | What it adds | Why later |
|---|---|---|
| Aggregates split by direction | The hover shows a pair's aggregates for each direction (A→B and B→A) beside or instead of the totals, for values such as traffic that differ by direction: a trunk at 80% one way and 10% the other. Each row already keeps its from and to (decision 2), so the data is there. | The first version's totals cover capacity, which is usually the same both ways. A split needs choices about labeling (which node is "A"), styling (which direction colors the line) and the ratio per direction. |
| Highlight a node's edges | Hovering a node also highlights every edge that ends at it, showing what it connects to. | Not needed to read pairs; adds a lookup from node to pairs and a second highlight state. |
| Choosing the click list's columns | A setting for which columns the click list shows and in what order, separately from the hover. | Hide in tooltip already drops columns; add this if real use shows the list is cluttered or needs a different order. |
| Node names in pair titles | Pair titles use a node name column ("Raleigh – Durham") rather than ids. | Needs a name column setting on the node layer; ids identify pairs unambiguously meanwhile. |
| Naming what's counted | A setting on the edge layer for the word viewers see in counts, such as "trunks" or "flights" (with singular and plural), replacing the default "items" ("4 trunks", "Search trunks"). | Needs singular and plural forms, and the default reads fine meanwhile (node-edge Phase 4, decision 8). |
