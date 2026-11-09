import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DRAWN, PanelView, editedPanel, expect, mapPoint, renderedFeatures, test } from './fixtures';

// Panels of docker/grafana/provisioning/dashboards/14-node-edge.json (docs/node-edge/phase_1.md).
// Sites and trunks come from docker/postgres/init/06_seed_network.sql: 8 sites, and 14 trunks
// over 6 pairs. The basemap is None, so screenshots show only the network.
const FILE = { fileName: '14-node-edge.json' };

test('draws one line per pair of sites, below the sites', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Network').locator;

  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 8, B: 6 });
  await expect(panel.getByTestId('geoflow-warnings')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(panel.locator('canvas.maplibregl-canvas')).toHaveScreenshot('network.png', {
    stylePath: path.join(__dirname, 'fixtures', 'hide-legend.css'),
    maxDiffPixelRatio: 0.01,
  });
});

test('draws edges from from and to columns set in the layer settings', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Named columns').locator;

  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 8, B: 6 });
  await expect(panel.getByTestId('geoflow-warnings')).toHaveCount(0);
});

test("counts the rows it can't draw, and the Edges layer it doesn't use", async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Problems').locator;

  // The duplicate and the non-point node still draw as nodes: 10 features. The second Edges
  // layer draws nothing.
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 10, B: 6, C: 0 });
  const warning = panel.getByTestId('geoflow-warnings');
  await expect(warning).toHaveAccessibleName('2 warnings');
  await warning.hover();
  const details = page.getByTestId('geoflow-warnings-details');
  await expect(details).toContainText(
    'Trunks: 6 rows skipped: unknown node 2, self-loop 1, empty end 1, duplicate node id 1, node not a point 1'
  );
  await expect(details).toContainText('Nodes row 2: node id 1 is already used by an earlier node');
  await expect(details).toContainText('Microwave trunks: Not part of the network, which uses Trunks');
});

test('makes a network of two layers in the Layers list, and keeps it when a layer is renamed', async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '4' });
  const panel = await editedPanel(panelEditPage);
  const editor = page.getByTestId('geoflow-layers-editor');
  const settings = editor.getByTestId('geoflow-layer-settings');
  const rows = () =>
    editor.getByTestId(/^geoflow-layer-row-/).evaluateAll((els) => els.map((el) => el.dataset.testid!.slice(18)));
  // Without settings, the later query is on top, and the trunks query has no geometry to draw.
  await expect.poll(rows).toEqual(['B', 'A']);
  await expect(editor.getByTestId('geoflow-layer-row-B')).toContainText('No geometry');

  await editor.getByRole('button', { name: 'Query A', exact: true }).click();
  await settings.getByRole('radio', { name: 'Nodes' }).click();
  await editor.getByRole('button', { name: 'Query B', exact: true }).click();
  await settings.getByRole('radio', { name: 'Edges' }).click();

  // The trunks moved below the sites, and draw as 6 lines between them.
  await expect.poll(rows).toEqual(['A', 'B']);
  await expect(editor.getByTestId('geoflow-layer-row-B')).toContainText('Edges');
  await expect(editor.getByTestId('geoflow-layer-row-B')).not.toContainText('No geometry');
  await expect(settings.locator('#geoflow-layer-B-from')).toHaveAttribute('placeholder', 'Auto: a_site');
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 8, B: 6 });

  // Renaming saves every layer again: the roles must survive it.
  const name = settings.locator('#geoflow-layer-B-name');
  await name.fill('Trunks');
  await name.press('Tab');
  await expect(editor.getByTestId('geoflow-layer-row-B')).toContainText('Trunks');
  await expect(editor.getByTestId('geoflow-layer-row-A')).toContainText('Nodes');
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 8, B: 6 });
});

// The Hover panel's fixed view, and a point a quarter of the way along the CARY-CORE (1) to
// RALEIGH-CORE (6) line, away from other lines and the sites.
const HOVER_VIEW: PanelView = { lat: 35.785, lon: -78.72, zoom: 11 };
const ON_CORE_LINE: [number, number] = [-78.7454, 35.7885];

/** Waits for the Hover panel's edges to draw. Its fixed view shows only part of the network. */
async function edgesDrawn(panel: Locator) {
  await expect.poll(async () => (await renderedFeatures(panel)).B ?? 0, DRAWN).toBeGreaterThan(0);
}

async function pointAtCoreLine(page: Page, panel: Locator, action: 'move' | 'click') {
  const { x, y } = await mapPoint(panel, ON_CORE_LINE, HOVER_VIEW);
  await page.mouse.move(x, y);
  if (action === 'click') {
    await page.mouse.click(x, y);
  }
}

test("shows a hovered edge's totals: links, aggregates and the ratio of sums", async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Hover').locator;
  await edgesDrawn(panel);

  await pointAtCoreLine(page, panel, 'move');
  const tooltip = panel.getByTestId('geoflow-tooltip');
  await expect(tooltip).toContainText('Trunks');
  await expect(tooltip).toContainText('Between1 and 6');
  await expect(tooltip).toContainText('Items4');
  await expect(tooltip).toContainText('capacity_gbpssum 211 Gb/s · avg 52.8 Gb/s');
  await expect(tooltip).toContainText('utilization_gbpssum 143 Gb/s');
  // 142.6 of 211 Gb/s, not the trunks' average utilization of 66%.
  await expect(tooltip).toContainText('utilization68%');
});

test('keeps a pinned edge through a refresh', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Hover').locator;
  await edgesDrawn(panel);

  await pointAtCoreLine(page, panel, 'click');
  const tooltip = panel.getByTestId('geoflow-tooltip');
  await expect(tooltip.getByRole('button', { name: 'Close' })).toBeVisible();
  await dashboardPage.refreshDashboard();
  await page.mouse.move(0, 0);
  await tooltip.getByRole('radio', { name: 'Totals' }).click({ force: true });
  await expect(tooltip).toContainText('Between1 and 6');
  await expect(tooltip.getByRole('button', { name: 'Close' })).toBeVisible();
});

test("shows nothing on an edge whose layer's tooltips are off", async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = await editedPanel(await gotoPanelEditPage({ dashboard, id: '5' }));
  await edgesDrawn(panel);
  // First, the point is on the line: the tooltip shows.
  await pointAtCoreLine(page, panel, 'move');
  await expect(panel.getByTestId('geoflow-tooltip')).toContainText('Between1 and 6');

  const editor = page.getByTestId('geoflow-layers-editor');
  await editor.getByRole('button', { name: 'Trunks', exact: true }).click();
  await editor.getByTestId('geoflow-layer-settings').locator('#geoflow-layer-B-tooltips').click({ force: true });
  await page.mouse.move(0, 0);
  await pointAtCoreLine(page, panel, 'move');
  await page.waitForTimeout(500);
  await expect(panel.getByTestId('geoflow-tooltip')).toHaveCount(0);
});

test('lists the edges of a clicked line, to search, sort and follow', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Hover').locator;
  await edgesDrawn(panel);
  await pointAtCoreLine(page, panel, 'click');
  const list = panel.getByTestId('geoflow-edge-list');
  const rows = list.getByTestId('geoflow-edge-list-row');
  const column = (name: string) =>
    rows.evaluateAll((els, header) => {
      const headers = [...els[0].closest('table')!.querySelectorAll('th')].map((th) => th.textContent);
      const i = headers.indexOf(header);
      return els.map((row) => row.querySelectorAll('td')[i].textContent);
    }, name);

  // Pinning opens on the items; the totals are a click away, and back.
  const tooltip = panel.getByTestId('geoflow-tooltip');
  await tooltip.getByRole('radio', { name: 'Totals' }).click({ force: true });
  await expect(tooltip).toContainText('capacity_gbpssum 211 Gb/s · avg 52.8 Gb/s');
  await expect(list).toHaveCount(0);
  await tooltip.getByRole('radio', { name: 'Items' }).click({ force: true });

  // The four trunks between CARY-CORE (1) and RALEIGH-CORE (6), each with its own direction.
  await expect(rows).toHaveCount(4);
  // Scrolled to the end, the last row is inside the tooltip: a short tooltip once clipped it.
  const lastRowShown = await list.evaluate((el) => {
    const scroller = el.querySelector('table')!.parentElement!;
    scroller.scrollTop = scroller.scrollHeight;
    const tooltip = el.closest('[data-testid="geoflow-tooltip"]')!.getBoundingClientRect();
    const last = [...el.querySelectorAll('[data-testid="geoflow-edge-list-row"]')].at(-1)!.getBoundingClientRect();
    return (
      last.height > 0 &&
      last.bottom <= tooltip.bottom + 0.5 &&
      last.bottom <= scroller.getBoundingClientRect().bottom + 0.5
    );
  });
  expect(lastRowShown).toBe(true);

  // The scrolling area shows the header and whole rows, and a wheel notch moves one row.
  const scroller = list.locator('table').locator('..');
  const area = await scroller.evaluate((el) => {
    el.scrollTop = 0;
    return el.clientHeight;
  });
  expect(area % 24).toBe(0);
  expect(area).toBeGreaterThanOrEqual(48);
  if (area < 24 * 5) {
    const scrollerBox = (await scroller.boundingBox())!;
    await page.mouse.move(scrollerBox.x + 40, scrollerBox.y + scrollerBox.height / 2);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBe(24);
  }
  await expect(list.getByTestId('geoflow-edge-list-count')).toHaveText('4 items');
  expect(await column('Direction')).toEqual(['1 → 6', '6 → 1', '1 → 6', '6 → 1']);

  // Each row's link carries its trunk.
  await expect(rows.nth(1).getByRole('link', { name: 'Trunk details' })).toHaveAttribute('href', /var-trunk=TRK-002/);

  // Largest first.
  await list.getByRole('button', { name: 'capacity_gbps' }).click();
  await list.getByRole('button', { name: 'capacity_gbps' }).click();
  expect(await column('capacity_gbps')).toEqual(['100 Gb/s', '100 Gb/s', '10 Gb/s', '1 Gb/s']);

  // Typing in the search box filters the list, and doesn't zoom the map ("+" and "-" are its keys).
  // A strip of map the tooltip doesn't cover: above it, or below it when it's near the top.
  const canvas = (await panel.locator('canvas.maplibregl-canvas').boundingBox())!;
  const tip = (await panel.getByTestId('geoflow-tooltip').boundingBox())!;
  const above = tip.y - canvas.y > 40;
  const clip = {
    x: canvas.x + 10,
    y: above ? canvas.y + 5 : tip.y + tip.height + 5,
    width: canvas.width - 20,
    height: 30,
  };
  await list.getByPlaceholder('Search items').click();
  await page.waitForTimeout(300);
  const before = await page.screenshot({ clip });
  await page.keyboard.type('+-microwave');
  await expect(list.getByTestId('geoflow-edge-list-count')).toHaveText('0 of 4 items');
  await page.keyboard.press('Escape');
  await page.keyboard.type('microwave');
  await expect(list.getByTestId('geoflow-edge-list-count')).toHaveText('1 of 4 items');
  expect(await column('trunk_id')).toEqual(['TRK-004']);
  expect(Buffer.compare(before, await page.screenshot({ clip }))).toBe(0);
});

test("leaves the direction out of a line's list when Show direction is off", async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = await editedPanel(await gotoPanelEditPage({ dashboard, id: '5' }));
  await edgesDrawn(panel);
  const editor = page.getByTestId('geoflow-layers-editor');
  await editor.getByRole('button', { name: 'Trunks', exact: true }).click();
  await editor.getByTestId('geoflow-layer-settings').locator('#geoflow-layer-B-direction').click({ force: true });

  await pointAtCoreLine(page, panel, 'click');
  const list = panel.getByTestId('geoflow-edge-list');
  await expect(list.getByTestId('geoflow-edge-list-row')).toHaveCount(4);
  await expect(list.getByRole('columnheader', { name: 'Direction' })).toHaveCount(0);
  await expect(list.getByRole('columnheader', { name: 'trunk_id' })).toBeVisible();
});
