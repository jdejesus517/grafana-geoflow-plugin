# Node-edge Phase 4: Click list

Status: **Implemented** (2026-11-08). Decisions 1–8 accepted as proposed. See [Outcome](#outcome).
Architecture reference: [architecture.md](architecture.md) §6.2 (click list), §7 (options), §9.3 (Phase 4 row); decisions 2, 7, 9, 15.

## Goal

Click an edge line to see every edge between its two nodes: one row each, with its direction, its columns and its data links, which can be searched, sorted and scrolled. The hover's totals stay at the top.

## Exit criteria

1. **The list.** A pinned edge line shows its header and totals, as in Phase 3, then a list of the pair's edges: one row each, in query order.
2. **Columns.** A direction column ("1 → 6" or "6 → 1", the row's own) first, then the edge query's columns in query order, less those hidden from tooltips, formatted as the columns show them (architecture decision 9).
3. **Show direction.** A switch in the edge layer's settings in the Layers list, on by default, hides the direction column.
4. **Search.** A search box filters the rows, ignoring case, over the shown values; while it filters, a count reads "1 of 4 items".
5. **Sort.** A column header sorts by it, ascending, then descending, then back to query order. Numbers and times sort by value, text alphabetically; empty values go last.
6. **Size.** The list draws at most 500 rows of the result ("Showing 500 of 2,340 items", with the search box suggesting "Search to narrow"), keeps its headers visible while it scrolls, and fits within the map, up to 800 px wide (architecture decision 7).
7. **Data links.** Each row's data links, gathered as a feature's are and filled in with that row's values: a link icon when the query has one link, a menu when it has several (architecture decision 15).
8. **The map stays put.** Typing in the search box, using the menu, and scrolling the list don't pan or zoom the map.
9. **Tests.** Unit tests on the rows, search, sort and cap; component tests on the list, its links and the Show direction switch; e2e tests on the list's rows, search, sort, direction and a row's link.
10. **Wording.** What viewers read says items, not links, in the list and in the hover ("Items 4", Phase 3's "Links 4"): no graph terms, which a dashboard's viewers needn't know, nor a domain's, and nothing to confuse with data links (decision 8). Nodes and Edges stay in the settings, for whoever sets the map up.
11. **Docs.** The README's Edge totals section describes the list, in the same words.

## Out of scope

- **Choosing the list's columns:** architecture §12. **Hide in tooltip** drops a column.
- **Node names in the header and direction column:** architecture §12; ids are shown.
- **Styling edges by a pair value:** Phase 5.
- **Virtual scrolling:** kept for later if the 500-row cap proves too small (decision 7 of the architecture).

---

## Starting point

| Already in place | From |
|---|---|
| Edge results with `pairs`: each pair's node ids and its rows, in query order | Node-edge Phase 1 |
| `pairDetails`: a pair's header items and totals; `featureDetails`' formatting (`fieldValue`), Hide in tooltip, and data link gathering (`field.getLinks({ valueRowIndex })`, deduplicated) | Node-edge Phase 3, Phase 4 |
| Pinned tooltips with a pager, mixing node and pair entries, sized when they open (`tooltipSpace`), at most 400 px wide | Phase 4, node-edge Phase 3 |
| `withoutDefaults`, which keeps every non-default layer setting | Node-edge Phase 2 |
| `@grafana/ui`'s `FilterInput`, `Dropdown`, `Menu` and `Menu.Item` | Grafana 13.2 |

### Changes to the architecture

- **§6.1, §6.2:** counts say items, not links (decision 8). **§12:** naming them in the domain's words, a setting for later. The sort's third click returns to query order (decision 2); links show as an icon or a menu depending on how many link settings the query has, not on each row's links (decision 4).

---

## Design

### 1. Rows (`pairRows.ts`, new, adapter)

`pairRows(frame, result, featureId, { showDirection })` returns the list's content, independent of React:

```ts
interface PairTable {
  columns: Array<{ key: string; label: string; field?: Field }>; // field unset for direction
  rows: Array<{
    row: number;            // the edge frame's row
    cells: string[];        // shown text, one per column
    values: unknown[];      // sort keys: raw values; the direction's text
  }>;
}
```

- **Direction:** "from → to", the row's own ids as text. First, unless Show direction is off.
- **Columns:** the edge query's, in query order, less Hide in tooltip ones, labeled with their display names. The from and to columns follow the normal rule, so either the direction column, the raw ids or both can show (architecture decision 9).
- **Cells:** `fieldValue`, as in feature tooltips.

### 2. Search, sort and cap (`edgeList.ts`, new, panel)

`listRows(table, { query, sort })` returns the rows to draw and how many matched, as pure functions, so they're unit-tested without React:
- **Search:** a row matches when any of its cells contains the query, ignoring case. An empty query matches every row.
- **Sort** (decision 2): by a column's values, ascending or descending. Numbers and times compare as numbers, everything else as text with `localeCompare` and numeric collation ("TRK-2" before "TRK-10"). Empty values go last either way. Ties keep query order.
- **Cap:** the first 500 of the sorted matches.

### 3. The list (`EdgeList.tsx`, new)

- **Search box:** `FilterInput`, placeholder "Search items". Escape in a non-empty box clears it; in an empty one, it closes the tooltip as before (decision 5).
- **Count:** beside the search box, "4 items", or while searching "1 of 4 items"; past the cap, "Showing 500 of 2,340 items", and the search box's placeholder becomes "Search to narrow" (decision 8).
- **Table:** a header row of buttons, each with `aria-sort` and an arrow for the sorted column; body rows in a scrolling area under a sticky header. Cells don't wrap; long values end with an ellipsis and show in full on hover (`title`).
- **Links column** (decision 4), last, when any column of the edge query has data links:
  - one link setting in the whole query: a link icon per row, an `<a>` with the link's href, target and `rel="noopener noreferrer"` for new tabs, built for the drawn rows (at most 500 interpolations);
  - several: an icon button per row that opens a `Dropdown` `Menu` of the row's links, built when it opens, deduplicated by title and href as in feature tooltips.
- **Keeping the map still:** the list stops keydown and wheel events from reaching the map, so typing `+` or `-`, using the arrow keys and scrolling the list don't zoom or pan it. Step 4.1 checks what reaches MapLibre today.

### 4. Tooltips (`FeatureTooltip.tsx`, `useFeatureTooltip.tsx`)

- **`TooltipFeature`** gains an optional `list` (the pair's table, its frame for links, and Show direction), set for pair entries of a pinned tooltip only. Hovering stays as in Phase 3.
- **`FeatureTooltip`** shows the totals, then `EdgeList`, for an entry with a list. The pager works as before, so a click near a node pages between the node and the pairs under it.
- **Width:** a pinned tooltip showing a list may be up to 800 px wide, within the room `tooltipSpace` gives; other tooltips keep 400 px. Its height is the room above or below the point, as now; the list scrolls within it.

### 5. Show direction (`LayersEditor.tsx`, `bindLayers.ts`)

`LayerConfig.showDirection` (default `true`) and `BoundLayer.showDirection`. The Layers list shows a **Show direction** switch for edge layers, described "The list of a clicked edge line starts with each link's direction." `withoutDefaults` leaves out `showDirection: true`, and drops the setting off layers that aren't edges, as it does from and to columns.

### 6. Dashboard and tests

- **`14-node-edge.json`'s Hover panel** gains a data link on `trunk_id` (`/d/geoflow-14-node-edge?var-trunk=${__data.fields.trunk_id}`), so its rows each have one link.
- **Unit:** `pairRows` (direction on and off, hidden columns, formatting); `listRows` (search over every cell including direction, sort by numbers, times, text with numbers and empty values, ties, the cap); `withoutDefaults` with `showDirection`.
- **Component:** `EdgeList`: the count line in each state, sorting by header clicks, Escape in the search box, the links column with one link (an anchor per row with the row's href) and several (a menu); the Layers list's Show direction switch; a pinned pair's tooltip showing the list and its width.
- **E2E:** click the CARY-CORE to RALEIGH-CORE line: 4 rows, each with its direction; search "microwave": 1 of 4 items; sort by capacity_gbps, descending: 100 Gb/s first; a row's link carries its trunk id; typing in the search box doesn't zoom the map; Show direction off: no direction column.

---

## Steps

Each step is one commit, tested before the next.

### 4.1 Checks on Grafana 13.2 and MapLibre

- Which keydown and wheel events from a tooltip reach MapLibre's handlers now
- `Dropdown` and `Menu` opened from inside the MapLibre popup: where they render, and that choosing an item doesn't unpin the tooltip
- `FilterInput` and a sticky table header inside the popup's scrolling area

### 4.2 Adapter: rows, and the Show direction setting

Design §1 and §5's settings, with unit tests.

### 4.3 The list in the tooltip

Design §2–5, with unit and component tests, and the hover's count renamed Items (decision 8).

### 4.4 Dashboard and e2e tests

Design §6. No new seed data, so no database reset.

### 4.5 Docs

- README: the click list, in the Edge totals section; counts in items
- node-edge architecture.md: status, §6.2
- This document's Outcome

---

## Risks

| Risk | Mitigation |
|---|---|
| Keys typed in the search box zoom or pan the map | The list stops keydown events (Design §3), checked in step 4.1 and by an e2e test |
| The menu renders outside the popup and a click there unpins the tooltip | Unpinning comes from the engine's map click, not from clicks elsewhere; checked in step 4.1 |
| A wide table in a small panel | The list takes the room it has, cells end with an ellipsis, and the table scrolls sideways when its columns need more |
| Sorting thousands of rows on each keystroke | Search and sort run over one pair's rows; a pair of thousands sorts in milliseconds, and the draw stays at 500 |
| Link icons that differ in kind per row (a link that resolves to nothing) | Grafana builds every link setting for every row, so the count per row is the setting count; deduplication only merges identical links |

---

## Decisions

| # | Decision | Proposal | Alternatives |
|---|---|---|---|
| 1 | What a pinned pair shows | **The header and totals, then the list,** so the totals stay in view above the rows. | The list alone, losing the totals; the totals as a list footer. |
| 2 | Sort cycle | **Ascending, descending, then query order,** so the query's order can be had back without reopening the tooltip. | Ascending and descending only (architecture decision 7), with query order lost after the first click. |
| 3 | What search matches | **The shown text of every shown column,** direction included ("6 → 1" finds that direction), so what you see is what you can find. | Raw values, which miss formatted text ("100 Gb/s"); every column, hidden ones included, which matches rows for reasons not on screen. |
| 4 | Links per row | **By the query's link settings:** one setting gives a link icon per row, built for the drawn rows; several give a menu per row, built when opened. | Always a menu, an extra click for the common single link; always icons, which can't hold several links. |
| 5 | Escape in the search box | **Clears a non-empty search; otherwise closes the tooltip.** | Always closing, losing the search. |
| 6 | Show direction | **Saved only when off,** dropped off non-edge layers. | |
| 7 | Plugin version | **Unchanged.** No `plugin.json` change, so no Grafana restart. | |
| 8 | What counts are counted in | **Items,** in everything a viewer reads: "Items 4" in the hover (renaming Phase 3's "Links"), "4 items" in the list, "Search items". Deliberately vague: viewers see locations and lines, not nodes and edges, and GeoFlow doesn't know the domain's word ("trunks", "flights"); a setting to name them is for later (architecture §12). "Nodes" and "Edges" stay in the settings, for whoever sets the map up. | "Links", telecom-flavored and confusable with data links; "edges", graph terms viewers needn't know; "connections", which fits some networks better than others; "rows", the query's word, odd in a hover. |

---

## Outcome

Implemented on branch `node-edge-phase-4` in five commits, steps 4.2 to 4.5, plus a fix to step 4.3 (below). Step 4.1 was checks only, recorded below.
- 653 unit and component tests pass (18 new), and 76 e2e tests (2 new, plus the login setup). No seed data changed, so the stack wasn't reset.
- CI: to be filled in from the pull request.

### Exit criteria

| # | Criterion | Result |
|---|---|---|
| 1 | The list | Met. A pinned edge line shows its header and totals, then its rows in query order. |
| 2 | Columns | Met. Each row's own direction, then the edge query's columns less hidden ones, formatted as tooltips are. |
| 3 | Show direction | Met. A switch for edge layers in the Layers list (component and e2e tests). |
| 4 | Search | Met. "1 of 4 items" for "microwave" (e2e); every shown cell, the direction included. |
| 5 | Sort | Met. Ascending, descending, then query order; numbers by value, text with its numbers in order, empty values last. |
| 6 | Size | Met. At most 500 rows drawn, with the count of the rest; sticky headers; up to 800 px wide. |
| 7 | Data links | Met. One link setting: an icon per row with the row's values (e2e: TRK-002's link). Several: a menu per row, built when opened (component test, and checked by hand). |
| 8 | The map stays put | Met, without code: keys and the wheel in a tooltip never reach MapLibre (step 4.1). An e2e test types "+" and "-" in the search box and compares the map before and after. |
| 9 | Tests | Met. |
| 10 | Wording | Met. "Items 4" in the hover, "4 items" in the list, "Search items". |
| 11 | Docs | Met. The README's list section. |

### Checks on Grafana 13.2 and MapLibre (step 4.1)

- **Keys and the wheel:** MapLibre listens for them on its canvas container (`map.getCanvasContainer()`), and its popup is a sibling of that, not inside it. Checked in Grafana with an input placed in a pinned tooltip: typing `+`, `-`, `e`, `v`, `d` and the arrow keys moves the map not at all and fires none of Grafana's shortcuts, and the wheel over the tooltip doesn't zoom. So the list stops no events (Design §3 planned to): nothing reaches the map to stop.
- **The menu:** `Dropdown` renders it outside the popup (a portal); the tooltip stays pinned while it's open, and Escape closes only the menu.
- **Escape in an input** reached the panel's own handler and closed the tooltip, as decision 5 expected; the list now clears a search first.

### Differences from the plan

- **No event stopping** in the list (above).
- **The count sits beside the search box,** not on a line of its own, found in review: it saves that line for rows. The cap's "Search to narrow" moved into the search box's placeholder to keep the count short, and the room the totals leave the list went from 170 to 150 px.
- **Layout, adjusted by eye** in a short and a tall panel: the totals first overlapped the search box when the tooltip was short, then took all its height. Then, found in review, a minimum height on the list (160 px) pushed its last rows out of a short tooltip, below its bottom edge, where no scrolling reached them: in the Hover panel's e2e layout, and with a 164 px tooltip, 32 px of list. Now the list has no minimum and shrinks with the tooltip, and the totals make room for it: they take what's left after 170 px for the list, keeping at least a line and scrolling on their own (`totalsMaxHeight`). Measured at tooltip heights of 164 to 403 px, the last row scrolls into view; the e2e test scrolls the list to its end and checks the last row is inside the tooltip, which fails on the previous layout.
- **A fix to step 4.3:** wrapping the totals for the list wrapped every tooltip's fields, which stopped ordinary pinned tooltips scrolling in a short panel. `tooltips.spec.ts` caught it in the full e2e run; the fix wraps the totals only with a list. Its commit is separate, after step 4.4's: the check before step 4.4's commit read the exit status of a pipeline's last command, not of the test run, so the commit went in with the failure. Such checks now read the test run's own status.

### Findings for later phases

- **In a short panel, a pinned list has little room:** the tooltip gets the larger side of the clicked point, and a panel a few hundred pixels tall leaves the list a row or two. Below about 150 px of tooltip (a 123 px tooltip, with a 440 px window), there's no room for rows at all. Larger panels, or View panel, show more; opening the list in a dialog when the tooltip is too short is an option for later.
