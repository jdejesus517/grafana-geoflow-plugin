# Node-edge Phase 1: Edges drawn

Status: **Plan accepted** (2026-11-08). Decisions 1–8 accepted as proposed.
Architecture reference: [architecture.md](architecture.md) §4 (data and query shape), §5 (fit with the existing architecture), §6.3 (styling), §9.3 (Phase 1 row); decisions 1, 2, 4, 6, 8, 12, 13, 14.

## Goal

Draw a network from two queries: a node layer of points, and an edge layer whose rows name two nodes. Every edge between the same two nodes becomes one straight line between their points. Bad rows are counted and explained on the map, as skipped geometry rows are today.

The Layers editor comes in Phase 2: in this phase, roles and from/to columns are set in the dashboard's JSON, which is enough to build and test the whole data path.

## Exit criteria

1. **Roles.** A layer's settings take a role (`geometry`, `nodes` or `edges`) and, for edges, `fromField` and `toField`. Without a role, a layer is a geometry layer, so saved dashboards draw as before and the stored screenshots match.
2. **Detection.** An edge layer without `fromField` and `toField` finds them by name (Design §2).
3. **Edges drawn.** One straight line per pair of nodes, whatever the number or direction of the rows between them, between the nodes' points. Node and edge ids match as text (decision 13).
4. **Style.** Edge lines take Map style (color, opacity, width, line style) set per query, as other layers do (decision 12), and the layer's palette color by default.
5. **Order.** The edge layer draws where it sits in the Layers list (decision 14).
6. **Warnings.** Rows not drawn are counted on the map's warning and in the data summary, with a sample: unknown node, self-loop, empty end, duplicate node id, node that isn't a point. Setting problems are warnings too: no node layer, from or to column not found, a second Nodes or Edges layer, and a node or edge query split into several frames.
7. **Refresh.** A refresh with the same node and edge data reuses the edge result; a change to either rebuilds it. A refresh that moves nodes moves their edges.
8. **Tests.** Unit tests on detection, the join, pairing, binding and warnings. E2E tests on a new dashboard: edges between the right nodes (feature counts and a screenshot), and the warnings.
9. **A fresh stack loads it.** `docker compose down -v` then `docker compose up` creates the new tables from the init files, and every dashboard, old and new, draws as intended: what a reviewer or a fork gets.

## Out of scope

- **The Layers editor** for roles and edge settings: Phase 2.
- **Hover and click** on edges: Phase 3 and 4. Edge layers aren't interactive in this phase (Design §5).
- **Color by and Size by** on edges: Phase 5. Set on an edge layer, they're ignored, and the data summary says so.
- **The large network and benchmark:** Phase 6.
- **Show direction**, aggregates, ratios: Phases 3 and 4.

---

## Starting point

| Already in place | From |
|---|---|
| `LayerConfig` (settings per layer id: name, visibility, tooltips, geometry and ID columns) and `bindPerFrame`, which turns frames and settings into `BoundLayer`s, top first | Phase 7 |
| `convertFrames`: a `ConversionResult` per frame, reused when the same arrays or the same values come back | Phases 5, 8 |
| Feature keys from the ID column, set when every feature has a unique one | Phase 4 |
| Map style read from the geometry column's field config (`geometryFieldOf`), reached per query through overrides | Phase 5 |
| `panelProblems` (the warning on the map) and `conversionSummary` (the data summary): skipped rows by `WarningKind`, with a sample | Phase 9 |
| The test hook counting drawn features per layer, and screenshot comparisons with no basemap | Phases 3, 7 |
| Read access to every table in the `geoflow` schema, including new ones (`ALTER DEFAULT PRIVILEGES`) | Phase 0 |

### Changes to the architecture

Planning against the code refines four points of architecture.md:
- **§5.1:** the join runs inside `convertFrames`, as a second pass after the other frames are converted, rather than as a separate step. Results stay one per frame, in frame order, which everything downstream (layer specs, warnings, the data summary, tooltips) already expects (decision 1).
- **§5.2:** all join warnings are counted on the edge result, including duplicate and non-point nodes, rather than on the node result, which is shared and cached (decision 2).
- **§5.2:** `ConversionResult` gains `styleField`, the column Map style is read from: the geometry column, or an edge layer's from column (decision 3).
- **§6:** edges aren't interactive until Phase 3, when they get their own tooltip (decision 4).

---

## Design

### 1. Settings and binding (`bindLayers.ts`)

```ts
type LayerRole = 'geometry' | 'nodes' | 'edges';

interface LayerConfig {
  // ...as today...
  role?: LayerRole;        // default 'geometry'
  fromField?: string;      // edges only; default detected
  toField?: string;        // edges only; default detected
}

interface BoundLayer {
  // ...as today...
  role: LayerRole;
  fromField?: string;
  toField?: string;
}
```

`networkLayers(bound)` (new) picks the network: the first Nodes layer and the first Edges layer in the Layers list's order (top first), among layers with a frame. Others with those roles are extras (decision 6):
- An extra **Nodes** layer draws as an ordinary geometry layer: its points are still useful.
- An extra **Edges** layer isn't drawn: it has no geometry.
- Both get a warning naming the layer the network uses.

**Split queries.** Settings are keyed by layer id, and a query split by Partition by values has an id per frame (`B:fiber`, `B:microwave`), so a role saved for `B` finds no frame. When settings with a Nodes or Edges role have no frame but frames from that query exist, the warning says the query returns several frames and a network layer needs one (architecture.md decision 8).

### 2. Detecting from and to (`detectEdgeFields.ts`, new)

`detectEdgeFields(frame, fromField?, toField?)` returns the two columns, or why not. A named column must exist. Otherwise, the first match, comparing names case-insensitively:

1. Name pairs, in this order: `source`/`target`, `from`/`to`, `src`/`dst`, `start`/`end`, `a_end`/`z_end`, `a`/`z`, and each of those with `_id` or `_node` added (`source_id`/`target_id`, `from_node`/`to_node`).
2. Prefix pairs with the same rest: `a_`/`z_` (`a_site`/`z_site`), `from_`/`to_`, `source_`/`target_`.
3. Suffix pairs with the same rest: `_a`/`_z` (`site_a`/`site_z`), `_from`/`_to`, `_source`/`_target`.

Exactly one setting given (from but not to, say) detects the other only from the same pair. Neither found: the layer isn't drawn, and the warning says which column is missing and which names are detected.

### 3. The join (`joinEdges.ts`, new)

```ts
function joinEdges(
  edgeFrame: DataFrame,
  edges: { layerId: string; refId: string; fromField: string; toField: string },
  nodeFrame: DataFrame,
  nodeResult: ConversionResult,
  nodeIdField: string
): ConversionResult;
```

1. **Node positions:** for each node feature, its row (`featureRows`), the id column's value at that row as text, and its geometry. A Point is a position. Anything else (MultiPoint, a line, a polygon) is counted as `notAPoint`, as are rows whose geometry the node conversion skipped. A second node with an id already seen is counted as `duplicateId`; the first wins.
2. **Edges:** for each edge row, the from and to values as text (`String(value)`; `1` and `"1"` match, `1.0` and `"1"` don't). Empty (null, undefined or `''`) is `missingEnd`; equal is `selfLoop`; an id with no position is `unknownNode`. Each is counted, with a sample row naming the id.
3. **Pairs:** the rest are grouped by key, the two ids sorted and joined with `\u0000`, in order of first row. Each pair becomes a LineString from its first node to its second, in key order.

The result is a `ConversionResult` (architecture.md §5.2):

| Field | Value |
|---|---|
| `layerId`, `refId`, `rowCount` | The edge layer's, and the edge frame's row count |
| `featureCollection` | One LineString per pair; feature id = index |
| `featureRows` | Each pair's first row |
| `pairs` | `{ key, nodes, rows }` per pair, in feature order |
| `featureKeys` | The pair keys, so a pinned pair can be found again (from Phase 3) |
| `styleField` | The from column (decision 3) |
| `bounds` | Around the lines |
| `warnings` | The counts and samples above |

`geometryField` stays unset: edge frames have none.

### 4. Conversion (`convertFrames.ts`)

`convertFrames` gains the node and edge layers from `networkLayers`, and converts in two passes:
1. **Every frame but the network's edge frame,** as today. An edge frame (the network's, or an extra) isn't converted, so it never gets the "no geometry column" notice or geometry warnings.
2. **The edge frame,** with `joinEdges`, from its frame and the node layer's result. Without a node layer, or without from and to columns, it gets an empty result carrying the reason, which `networkProblems` reports.

Reuse follows the same two paths as other frames:
- **Same arrays** (a field config change): the cached edge result, if the node result is the same object and the from and to columns are the same.
- **Same values** (a refresh bringing the same data): the history's edge result, under the same conditions. Since a refresh with the same node data reuses the node result, the edge result is reused too.

A change to the node result (new positions, other ids) rebuilds the edge result, even when the edge data is unchanged.

### 5. Layer specs and style (`buildLayerSpecs.ts`, `layerStyle.ts`, `featureStyles.ts`)

- **Style column:** `geometryFieldOf` becomes `styleFieldOf`, reading `result.styleField ?? result.geometryField`. `frameToFeatureCollection` sets `styleField` to the geometry column; `joinEdges` to the from column. Map style, the palette color and By name colors then work for edges unchanged.
- **Palette:** edge layers take a palette position like other layers with features, so adding a network doesn't recolor existing layers' defaults beyond what adding any layer does.
- **No per-feature styles:** `buildLayerSpecs` skips `featureStyles` for edge layers until Phase 5, and `layerSettingProblems` says "Color by and Size by on edges come in a later version" when either is set.
- **Not interactive:** edge layer specs have `interactive: false` until Phase 3. Without it, hovering would show the first row of the pair as if it were the whole pair.
- **Order:** the Layers list's, as for any layer (decision 14). The dashboard places edges below nodes.

### 6. Warnings (`parseGeometry.ts`, `conversionSummary.ts`, `panelProblems.ts`)

- **`WarningKind`** gains `unknownNode`, `selfLoop`, `missingEnd`, `duplicateId` and `notAPoint`, labeled "unknown node", "self-loop", "empty end", "duplicate node id" and "node not a point". All are skipped-row kinds, so they appear in the map's warning ("4 rows skipped: unknown node 2, self-loop 1, empty end 1") with the first sample ("Row 7: no node with id 99").
- **`networkProblems`** (new, called by `panelProblems`) adds setting problems, per layer: no Nodes layer for an edge layer; from or to column not found; a second Nodes or Edges layer; a split node or edge query; the node layer's ID column not found.
- **Data summary:** edge results read "B: 9 rows → 4 pairs (source → target) · self-loop 1".

### 7. Seed data and dashboard

**`docker/postgres/init/06_seed_network.sql`** (new), in the area of the existing fixtures:
- `geoflow.sites`: `site_id integer primary key`, `name`, `geom geometry(Point, 4326)`; 8 sites.
- `geoflow.trunks`: `trunk_id text primary key`, `a_site text`, `z_site text`, `capacity_gbps numeric`, `utilization_gbps numeric`; 14 trunks over 6 pairs, including three trunks between one pair in both directions, and single-trunk pairs.

Text trunk ends against integer site ids exercise decision 13. Problem rows (unknown node, self-loop, empty end, duplicate id, a non-point node) are added in the problems panel's SQL with `UNION ALL`, so the tables stay realistic. An existing database volume doesn't run new init files, so step 1.4 resets it with `docker compose down -v` and starts the stack fresh, which checks the init files load as a reviewer or a fork would get them. The README tells existing users to do the same.

**`docker/grafana/provisioning/dashboards/14-node-edge.json`** (new), basemap None, roles set in each panel's `options.layers`:

| Panel | Shows |
|---|---|
| Network | Sites (Nodes, query A) and trunks (Edges, query B, ends detected from `a_site`/`z_site`), edges below nodes |
| Problems | The same, with the problem rows, plus a second Edges layer (query C) |
| Named columns | Trunks with renamed ends (`from_site`, `to_site`) and `fromField`/`toField` set |

### 8. Tests

- **Unit:** `detectEdgeFields` (each rule, case, a missing or half-set pair); `joinEdges` (text matching, both directions in one pair, pair order, each warning, non-point and skipped nodes, an empty edge frame); `bindLayers` roles and `networkLayers` extras; `convertFrames` reuse and rebuild with node changes; `styleFieldOf`; `networkProblems`; `conversionSummary` for edges.
- **E2E** (`tests/node-edge.spec.ts`): the Network panel draws 8 nodes and 6 edges (feature counts), and matches a stored screenshot; the Problems panel's warning lists each kind; the Named columns panel draws its edges; a geometry-only dashboard still matches its screenshots (the existing specs).

---

## Steps

Each step is one commit, tested before the next.

### 1.1 Checks on Grafana 13.2

- How the PostgreSQL data source returns integer, `numeric` and `text` columns (numbers or strings), for text matching
- Partition by values on a query whose layer has a role: the frames' ids, for the split-query warning
- The from and to field names after an alias, and with **As frame name** and **As label** splitting

### 1.2 Adapter: binding, detection and the join

Design §1–3 and the `WarningKind` additions, with unit tests.

### 1.3 Panel: conversion, style and warnings

Design §4–6, with unit and component tests.

### 1.4 Seed data, dashboard and e2e tests

Design §7–8. The database is reset (`docker compose down -v`, then `docker compose up`), not patched with `psql`, so the init files are tested as a fresh clone runs them; `verify.sql` and the full e2e suite then run against that stack.

### 1.5 Docs

- README: networks in the features list and a short section with the two-query example, noting that the Layers editor support comes later; the reseed note; the dashboard list
- architecture.md (node-edge): the changes above (§5.1, §5.2, §6)
- docs/architecture.md: §2.1 (new files), and a pointer to the node-edge document
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| The data source returns ids in shapes text matching doesn't cover (`numeric` as `"1.0"`) | Step 1.1 checks; `unknownNode` samples name the unmatched id, and the README shows a cast (`::text`) |
| A role on a layer id that changes (renamed query, Partition by values) stops applying silently | The split-query warning; a role whose layer has no frame shows in the editor's gone layers (Phase 7) |
| The palette or By name colors of existing layers shift when a network is added | Edge layers take palette positions like any layer; the existing screenshots must match |
| Edge frames that do have a geometry column (an edge query returning one by habit) | Ignored for edge layers: edges are always drawn from nodes |
| A node result without keys (duplicate ids) | The join reads the id column itself and counts duplicates; node keys aren't needed |

---

## Decisions

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Where the join runs | **Inside `convertFrames`**, as a second pass, so results stay one per frame in frame order and reuse works as for other frames. | A separate step after conversion (architecture.md §5.1), which would need its own results list or an index mapping. |
| 2 | Where join warnings are counted | **On the edge result**, all of them, including duplicate and non-point nodes. The node result is shared and cached, and the problems only matter to the network. | Duplicate and non-point counts on the node result (architecture.md §5.2), which would mean copying it. |
| 3 | The style column | **`ConversionResult.styleField`**, read by `styleFieldOf`: the geometry column, or the from column for edges. | Setting `geometryField` to the from column, which tooltips and the data summary read as a geometry column. |
| 4 | Edges and the pointer | **Not interactive until Phase 3.** | The feature tooltip, which would show the pair's first row as if it were the pair. |
| 5 | From and to detection | **Name pairs, then prefix and suffix pairs** (Design §2), case-insensitive. Covers the common `a_site`/`z_site` style. | Name pairs only, so `a_site`/`z_site` would need settings. |
| 6 | Extra Nodes and Edges layers | **The first of each in the Layers list makes the network.** An extra Nodes layer draws as geometry; an extra Edges layer isn't drawn. Both warn. | Drawing nothing for the network until there's only one of each. |
| 7 | Problem rows in seed data | **Added in the problems panel's SQL**, so the tables stay realistic and reusable. | Problem rows in the tables, which every other query would then filter out. |
| 8 | Plugin version | **Unchanged.** No `plugin.json` change, so no Grafana restart. | |
