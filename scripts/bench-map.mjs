#!/usr/bin/env node
// Measures the panel in a real browser, on the dashboard 11 Performance (docs/phase_9.md, Design
// §4), and prints a Markdown table. Not part of CI: runners have no GPU, and software rendering
// would swamp the numbers. Needs the dev stack running, with a production build.
//
//   npm run build && npm run bench:map
//   npm run bench:map -- --rows 100000 --kinds points,lines --runs 1
//   npm run bench:map -- --kinds layers --rows 50,200,1000
//
// For the `layers` kind, rows is the number of layers: one point each (docs/phase_11.md). For the
// `network` and `styled-network` kinds, rows is about the number of edge rows, with an eighth as
// many nodes, and three more columns measure a line's list of 2,000 rows (docs/node-edge/phase_6.md).
// Each cell is the median of the runs. "Task" columns are the longest main-thread task in
// milliseconds; tasks under 50 ms aren't reported by the browser, so they show as "<50".

import { chromium } from '@playwright/test';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000' },
    rows: { type: 'string', default: '1000,10000,100000' },
    kinds: { type: 'string', default: 'points,lines,polygons,colored,changing' },
    runs: { type: 'string', default: '3' },
  },
});

const DASHBOARD = 'd/geoflow-11-performance';
const PANELS = {
  points: 1,
  lines: 2,
  polygons: 3,
  colored: 4,
  changing: 5,
  layers: 6,
  network: 7,
  'styled-network': 8,
};
const INSPECT_EVENT = 'geoflow:inspect';
const RENDERED_FEATURES_ATTRIBUTE = 'data-rendered-features';
// Long enough for a redraw to finish after a change, at 100k features.
const SETTLE_MS = 3000;
const LIST_COLUMNS = ['pin', 'search', 'sort'];
const NETWORKS = new Set(['network', 'styled-network']);
const kinds = args.kinds.split(',');
const COLUMNS = [
  'drawn',
  'load',
  'pan',
  'hover',
  'refresh',
  'hide',
  'show',
  'basemap',
  ...(kinds.some((kind) => NETWORKS.has(kind)) ? LIST_COLUMNS : []),
];
// The network panels' fixed view, and the middle of the line below the grid.
const NETWORK_VIEW = { lon: -78.82, lat: 35.76, zoom: 11 };
const HEAVY_LINE = [-78.82, 35.68];

const browser = await chromium.launch({ args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=gl'] });

/** A page that records main-thread tasks over 50 ms, and answers tile requests without the network. */
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ path: 'tests/fixtures/tile.png', contentType: 'image/png' })
  );
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__tasks = [];
    new PerformanceObserver((list) => {
      list.getEntries().forEach(({ startTime, duration }) => window.__tasks.push({ startTime, duration }));
    }).observe({ type: 'longtask', buffered: true });
  });
  return page;
}

const now = (page) => page.evaluate(() => performance.now());

/** The longest main-thread task that started after `since`; 0 when none went over 50 ms. */
const longestTask = (page, since) =>
  page.evaluate(
    (from) => Math.max(0, ...window.__tasks.filter((task) => task.startTime >= from).map((task) => task.duration)),
    since
  );

/** When the panel's query response finished arriving. */
const responseEnd = (page) =>
  page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .filter((e) => e.name.includes('/api/ds/query'))
        .at(-1).responseEnd
  );

const queryResponse = (page) =>
  page.waitForResponse((response) => response.url().includes('/api/ds/query'), { timeout: 120_000 });

/** Seconds from the query response to every feature drawn. The count itself adds about 0.3 s at 100k. */
async function timeToDrawn(kind, rows) {
  const page = await newPage();
  const query = queryResponse(page);
  await page.goto(`${args.url}/${DASHBOARD}?viewPanel=${PANELS[kind]}&var-rows=${rows}`);
  await query;
  const start = Date.now();
  const map = page.getByTestId('geoflow-map');
  await map.locator('canvas').waitFor({ timeout: 120_000 });
  await map.evaluate((element, event) => element.dispatchEvent(new Event(event)), INSPECT_EVENT);
  await page.waitForFunction(
    (attribute) => document.querySelector('[data-testid="geoflow-map"]')?.getAttribute(attribute),
    RENDERED_FEATURES_ATTRIBUTE,
    { timeout: 120_000 }
  );
  const seconds = (Date.now() - start) / 1000;
  if (NETWORKS.has(kind)) {
    const drawn = JSON.parse(await map.getAttribute(RENDERED_FEATURES_ATTRIBUTE));
    const expected = network(Number(rows));
    if (drawn.A !== expected.nodes || drawn.B !== expected.lines) {
      throw new Error(`${kind} at ${rows} rows drew ${JSON.stringify(drawn)}, not ${JSON.stringify(expected)}`);
    }
  }
  await page.context().close();
  return seconds;
}

/** The nodes and lines the network panels' SQL generates for `rows`: a grid and one line below it. */
function network(rows) {
  const n = Math.floor(rows / 8);
  const w = Math.ceil(Math.sqrt(n));
  let lines = 0;
  for (let g = 1; g <= n; g++) {
    lines += (g % w !== 0 && g + 1 <= n ? 1 : 0) + (g + w <= n ? 1 : 0);
  }
  const heavy = Math.min(2000, Math.floor(rows / 10)) > 0 ? 1 : 0;
  return { nodes: n + 2, lines: lines + heavy };
}

/** Where a point is drawn in the map's fixed view, as tests/fixtures' mapPoint works it out. */
function mapPoint(box, [lon, lat], view) {
  const size = 512 * 2 ** view.zoom;
  const project = (lo, la) => {
    const sin = Math.sin((la * Math.PI) / 180);
    return [((lo + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
  };
  const [x, y] = project(lon, lat);
  const [cx, cy] = project(view.lon, view.lat);
  return [box.x + box.width / 2 + x - cx, box.y + box.height / 2 + y - cy];
}

/** Longest tasks while pinning the line below the grid, then searching and sorting its list. */
async function listTasks(kind, rows) {
  const page = await newPage();
  const query = queryResponse(page);
  await page.goto(`${args.url}/${DASHBOARD}?viewPanel=${PANELS[kind]}&var-rows=${rows}`);
  await query;
  const map = page.getByTestId('geoflow-map');
  await map.locator('canvas').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(SETTLE_MS);
  const box = await map.locator('canvas.maplibregl-canvas').boundingBox();
  const list = page.getByTestId('geoflow-edge-list');

  const measure = async (action) => {
    const since = await now(page);
    await action();
    await page.waitForTimeout(1000);
    return longestTask(page, since);
  };
  const pin = await measure(async () => {
    await page.mouse.click(...mapPoint(box, HEAVY_LINE, NETWORK_VIEW));
    await list.getByTestId('geoflow-edge-list-row').first().waitFor();
  });
  const search = await measure(async () => {
    await list.getByPlaceholder(/^Search/).click();
    await page.keyboard.type('999');
    await list.getByTestId('geoflow-edge-list-count').filter({ hasText: ' of ' }).waitFor();
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const sort = await measure(() => list.getByRole('button', { name: 'capacity_gbps' }).click());
  await page.context().close();
  return { pin, search, sort };
}

/** Longest tasks while loading, panning, hovering and refreshing, without the drawn-feature count. */
async function viewerTasks(kind, rows) {
  const page = await newPage();
  const query = queryResponse(page);
  await page.goto(`${args.url}/${DASHBOARD}?viewPanel=${PANELS[kind]}&var-rows=${rows}`);
  await query;
  const map = page.getByTestId('geoflow-map');
  await map.locator('canvas').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(SETTLE_MS);
  const load = await longestTask(page, await responseEnd(page));

  const box = await map.boundingBox();
  const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];

  let since = await now(page);
  await page.mouse.move(...at(0.5, 0.5));
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(...at(0.5 + i / 150, 0.5 + i / 300));
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(1000);
  const pan = await longestTask(page, since);

  since = await now(page);
  for (let i = 0; i <= 60; i++) {
    await page.mouse.move(...at(0.3 + i / 150, 0.4 + i / 300));
    await page.waitForTimeout(16);
  }
  const hover = await longestTask(page, since);

  // Unchanged data, except on the Changing points panel, where every refresh is new data.
  since = await now(page);
  const refreshed = queryResponse(page);
  await page.keyboard.press('d');
  await page.keyboard.press('r');
  await refreshed;
  await page.waitForTimeout(SETTLE_MS);
  const refresh = await longestTask(page, since);

  await page.context().close();
  return { load, pan, hover, refresh };
}

/** Longest tasks for changes made in the panel editor. */
async function editorTasks(kind, rows) {
  const page = await newPage();
  const query = queryResponse(page);
  await page.goto(`${args.url}/${DASHBOARD}?editPanel=${PANELS[kind]}&var-rows=${rows}`);
  await query;
  await page.getByTestId('geoflow-map').locator('canvas').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(SETTLE_MS);

  const measure = async (action) => {
    const since = await now(page);
    await action();
    await page.waitForTimeout(SETTLE_MS);
    return longestTask(page, since);
  };
  // The top layer: Query A, or on the Many layers panel, the last value.
  const layers = page.getByTestId('geoflow-layers-editor');
  const hide = await measure(() =>
    layers
      .getByRole('button', { name: /^Hide / })
      .first()
      .click()
  );
  const show = await measure(() =>
    layers
      .getByRole('button', { name: /^Show / })
      .first()
      .click()
  );
  const basemap = await measure(async () => {
    await page.getByTestId('data-testid Options group Basemap').getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'OpenStreetMap' }).click();
  });
  await page.context().close();
  return { hide, show, basemap };
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const format = (column, value) =>
  value === undefined
    ? '–'
    : column === 'drawn'
      ? `${value.toFixed(1)} s`
      : value === 0
        ? '<50'
        : `${Math.round(value)}`;

const lines = [`| Kind | Rows | ${COLUMNS.join(' | ')} |`, `|---|---|${COLUMNS.map(() => '---').join('|')}|`];
try {
  for (const kind of kinds) {
    for (const rows of args.rows.split(',')) {
      const runs = [];
      for (let run = 0; run < Number(args.runs); run++) {
        runs.push({
          drawn: await timeToDrawn(kind, rows),
          ...(await viewerTasks(kind, rows)),
          ...(await editorTasks(kind, rows)),
          ...(NETWORKS.has(kind) ? await listTasks(kind, rows) : {}),
        });
      }
      const cells = COLUMNS.map((column) =>
        format(column, runs[0][column] === undefined ? undefined : median(runs.map((run) => run[column])))
      );
      const line = `| ${kind} | ${Number(rows).toLocaleString('en-US')} | ${cells.join(' | ')} |`;
      lines.push(line);
      console.error(line);
    }
  }
} finally {
  await browser.close();
}
console.log(lines.join('\n'));
