# Node-edge Phase 2: Layers editor

Status: **Implemented** (2026-11-08). Decisions 1–5 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §5.4 (panel components), §7 (options), §9.3 (Phase 2 row); decisions 1, 4, 8, 14.

## Goal

Set up a network in the panel editor: give a layer the role Nodes or Edges in the Layers list, and see and change the columns an edge layer joins by, without editing the panel JSON.

Phase 1 also left the editor unsafe for networks, which this phase fixes first: any change in the Layers list drops every layer's role and from/to columns (Starting point).

## Exit criteria

1. **Settings survive editing.** Renaming, hiding, moving or changing any setting of any layer keeps every layer's role, from and to columns, and every other saved setting.
2. **Role.** The selected layer's settings start with a **Role** choice: Geometry, Nodes or Edges (decision 1).
3. **Settings by role.** A geometry layer's settings are as today. A node layer's ID column says edges find nodes by it. An edge layer has **From column** and **To column**, showing the detected columns until chosen, and no geometry, ID or tooltip settings (decision 2).
4. **Problems where they're set.** The From and To columns show why they can't be used (column not found, no pair detected). A node layer without an ID column says edges need one.
5. **Placement.** Giving a layer the Edges role moves it just below the node layer; giving it the Nodes role moves it just above the edge layer; nothing moves when the order is already right (decision 3).
6. **Rows.** Each row shows a network layer's role. An edge row doesn't say "No geometry". An extra Nodes or Edges layer says it isn't used.
7. **Tests.** Unit tests on saving. Component tests on the role, the settings by role, placement and rows. An e2e test builds a network from two plain layers in the editor, then renames a layer and checks the network still draws.
8. **Docs.** The README's Networks section describes the Layers list instead of the panel JSON.

## Out of scope

- **Show direction:** Phase 4, with the column it controls.
- **Tooltip settings for edges:** Phase 3, when edges get their tooltip.
- **Edges' Map style in the Layers list:** it stays in field config, per query (decision 12 of the architecture).
- **A role for every frame of a split query.** Partition by values still warns (architecture decision 8).

---

## Starting point

| Already in place | From |
|---|---|
| The Layers list: a row per layer with visibility, move buttons and an id, and the selected layer's settings (Name, Geometry column, ID column, Tooltips). Any change saves every layer, through `withoutDefaults`. | Phase 7 |
| `role`, `fromField` and `toField` in `LayerConfig`, read by `bindLayers`; `networkLayers` picks the network and lists extras | Node-edge Phase 1 |
| `detectEdgeFields(frame, from?, to?)`, with a detail when it finds nothing | Node-edge Phase 1 |
| `networkProblems`, for the map's warning and the data summary | Node-edge Phase 1 |

**Found while planning (a Phase 1 bug):** `withoutDefaults` copies the settings it lists, and those are the Phase 7 ones. So since Phase 1, any change in the Layers list saves every layer without `role`, `fromField` and `toField`, and the panel's network disappears. Phase 1's dashboards set roles in their JSON, and no test edited them in the Layers list.

### Changes to the architecture

None. §5.4 described these components; this phase builds them.

---

## Design

### 1. Saving (`LayersEditor.tsx`)

`withoutDefaults` becomes a rule rather than a list (decision 4): it keeps every setting except a known default (an empty name, `visible: true`, `tooltips: true`, `role: 'geometry'`, unset or empty columns). Settings added later (Phase 4's `showDirection`, say) are kept without changing it. One exception: `fromField` and `toField` are dropped when the role isn't Edges, so a layer that stops being one doesn't keep columns that no longer apply.

### 2. Role and settings by role (`LayersEditor.tsx`)

A **Role** radio group (`RadioButtonGroup`: Geometry, Nodes, Edges) heads the selected layer's settings, with the description "Nodes and Edges draw a network: edges join nodes by id."

| Setting | Geometry | Nodes | Edges |
|---|---|---|---|
| Name | ✓ | ✓ | ✓ |
| Geometry column | ✓ | ✓ | — |
| ID column | ✓ | ✓, described as "Edges find nodes by this column. Keep it unique." Without a column named `id`, the placeholder reads "None: choose one" and the field shows the problem. | — |
| From column, To column | — | — | ✓ |
| Tooltips | ✓ | ✓ | — (Phase 3) |

**From and To columns:** each a `Combobox` of the frame's columns, clearable. Unset, its placeholder is the detected column ("Auto: a_site") or "Auto: none found". Choosing one column re-detects the other from the same pair, as `detectEdgeFields` does, so its placeholder follows. A problem from `detectEdgeFields` shows on the field it's about ("To column: no column named far_end").

### 3. Placement (`LayersEditor.tsx`)

When the role changes, the editor saves the new role and, in the same change, fixes the order if the network would draw upside down (decision 3):
- **To Edges,** with a node layer above it already: nothing moves. With the node layer below it: the layer moves to just below the node layer.
- **To Nodes,** with an edge layer below it: nothing moves. With the edge layer above it: the layer moves to just above the edge layer.
- **Other changes,** and any move by the user later, keep the order as given (architecture decision 14).

### 4. Rows (`LayersEditor.tsx`)

- **Role:** "Nodes" or "Edges" beside the name, in secondary text, for network layers.
- **Edge rows** don't check for geometry, so they never say "No geometry".
- **Extras** (from `networkLayers`): "Not used", in warning text, with a tooltip saying which layer the network uses.

### 5. Dashboard and tests

- **`14-node-edge.json`** gains an **Editor** panel: sites and trunks, as in Network, with no layer settings, for the e2e test to set up.
- **Unit:** `withoutDefaults` keeps every setting of a full `LayerConfig` and drops each default; drops from and to columns off Edges.
- **Component** (`LayersEditor.test.tsx`): the Role group saves the role; settings by role; From/To placeholders, re-detection and errors; the node ID problem; placement both ways and no move when already right; row badges; renaming, hiding and moving keep roles and columns.
- **E2E** (`tests/node-edge.spec.ts`): in the Editor panel, make query A Nodes and query B Edges; the trunks move below the sites and the network draws (8 nodes, 6 edges); rename the trunks, and the network still draws; the saved panel options hold both roles.

---

## Steps

Each step is one commit, tested before the next.

### 2.1 Saving keeps every setting

Design §1, with unit and component tests. A fix for the Phase 1 bug on its own, so it can be picked out.

### 2.2 Role, settings by role, placement and rows

Design §2–4, with component tests. The Role group is checked by eye at the options pane's default width and at a narrow one; if it crowds, it becomes a select (decision 1's alternative).

### 2.3 Dashboard and e2e test

Design §5. No new seed data, so no database reset.

### 2.4 Docs

- README: the Networks section's setup in the Layers list, replacing the panel JSON steps
- node-edge architecture.md: status
- Phase 1's Outcome: the bug, under findings
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| Another setting is dropped by a future save | Saving keeps everything but known defaults (decision 4), and a unit test round-trips a full `LayerConfig` |
| Moving a layer on a role change surprises the user | Only when the network would draw upside down, and only the layer being changed; the user can move it back |
| From/To pickers disagree with what the panel draws | Both read `detectEdgeFields` with the same settings |
| The Role group crowds the settings | It replaces nothing; edge layers show fewer settings than today |

---

## Decisions

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | Role control | **A radio group** (Geometry, Nodes, Edges) at the top of the selected layer's settings: three choices, all visible. | A select; a role menu on the row. |
| 2 | Settings an edge layer shows | **Name, From column and To column.** No geometry or ID column, which edges don't have; no Tooltips until their tooltip exists (Phase 3). | Showing Tooltips now, with no effect until Phase 3. |
| 3 | Placement on a role change | **Fix the order only when it's upside down,** moving the changed layer next to its counterpart: an edge layer just below the nodes, a node layer just above the edges. | Always moving it; never moving it, leaving edges drawn over nodes. |
| 4 | Saving | **Keep every setting except known defaults,** dropping from/to columns off Edges. | Adding the three Phase 1 settings to the list, which is how they were missed. |
| 5 | Plugin version | **Unchanged.** No `plugin.json` change, so no Grafana restart. | |

---

## Outcome

Implemented on branch `node-edge-phase-2` in four commits, steps 2.1 to 2.4.
- 617 unit and component tests pass (14 new), and 71 e2e tests (1 new, plus the login setup). No seed data changed, so the stack wasn't reset.
- CI on PR #38 passes build, lint, 617 unit tests, the 8 build tool tests, `check:dist`, and the e2e tests on Grafana 13.2.5, 13.3.0 and nightly, 71 e2e tests each (plus the login setup). On 13.2.5 one test failed its first attempt and passed on retry (below). The API compatibility check reports only the known `useFieldConfig` false positive (Phase 4).

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Settings survive editing | Met. Saving keeps every setting but known defaults. Three of the new tests fail against `main`'s code, including renaming, hiding and moving a network's layers. |
| 2 | Role | Met. A Role radio group heads the selected layer's settings. |
| 3 | Settings by role | Met. Edge layers show Name, From column and To column, with the detected columns as placeholders; node layers describe their ID column. |
| 4 | Problems where they're set | Met. From/To problems on the column named, and a node layer without an ID column says edges need one. |
| 5 | Placement | Met. Both directions, and no move when the order is already right. |
| 6 | Rows | Met. Nodes and Edges labels, no "No geometry" on edge rows, "Not used" on extras. |
| 7 | Tests | Met. Unit tests on saving, component tests on roles, settings, placement and rows; the e2e test makes a network in the editor and renames a layer. |
| 8 | Docs | Met. The README's Networks section sets up a network in the Layers list. |

### Differences from the plan

- **The Role group is small** (`size="sm"`). Checked by eye in Grafana's options pane: at its default width (297 px of content) the default size fits, but the pane can be dragged to 244 px before it collapses, where the default size truncates its labels to "Geome…", "Nod…", "Edg…". The small size takes about 190 px and fits at both widths, so the radio group stays (decision 1), without falling back to a select.

### Findings for later phases

- **A flaky e2e check, not from this phase:** `tests/adapter.spec.ts`, "jsonb and Feature input" on 13.2.5, found no data summary text on its first attempt and passed on retry. The same spec flaked once before, in the `release-prep` run ("State Plane without ST_Transform"). It's fixed in Phase 3.
- **Grafana's radio inputs sit over their labels,** so e2e tests click the radio (`getByRole('radio', { name })`), not its text.
