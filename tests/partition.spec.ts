import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DRAWN, expect, renderedFeatures, test } from './fixtures';

// Panels of docker/grafana/provisioning/dashboards/12-partition.json: fiber cables split by
// placement with Partition by values (docs/phase_11.md). The basemap is None, so the screenshot
// shows only the data.
const FILE = { fileName: '12-partition.json' };

/** Compares a fixed area around the map's center with a stored screenshot, as in layers.spec.ts. */
async function expectMap(page: Page, panel: Locator, name: string) {
  await page.mouse.move(0, 0);
  await renderedFeatures(panel);
  const box = (await panel.locator('canvas.maplibregl-canvas').boundingBox())!;
  const clip = { width: 300, height: 240 };
  await expect(page).toHaveScreenshot(name, {
    clip: {
      x: Math.round(box.x + box.width / 2 - clip.width / 2),
      y: Math.round(box.y + box.height / 2 - clip.height / 2),
      ...clip,
    },
    stylePath: path.join(__dirname, 'fixtures', 'hide-legend.css'),
    maxDiffPixelRatio: 0.01,
  });
}

/** The layer name the data summary shows under each layer id. */
async function layerNames(panel: Locator, ids: string[]) {
  return Promise.all(ids.map((id) => panel.getByTestId(`geoflow-summary-layer-${id}`).textContent()));
}

test('styles one value with an override on its frame, named as frame name', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Per-value style').locator;

  // Each frame's refId is the query's and its value: what a Fields returned by query override matches.
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ 'A-aerial': 5, 'A-mixed': 1, 'A-underground': 9 });
  // The aerial cables are dashed and orange; the others keep their palette colors.
  await expectMap(page, panel, 'partition-per-value-style.png');
});

test('draws null and empty values as layers of their own, as label', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Nulls, as label').locator;
  // Every frame shares the refId A-undefined (the query's frame has no name); labels tell them apart.
  const layers = {
    'A-undefined:placement=': 4,
    'A-undefined:placement=underground': 7,
    'A-undefined:placement=aerial': 1,
    'A-undefined:placement=null': 3,
  };

  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(layers);
  expect(await layerNames(panel, ['A-undefined:placement=null', 'A-undefined:placement='])).toEqual([
    'placement=null',
    'placement=',
  ]);

  await dashboardPage.refreshDashboard();
  expect(await renderedFeatures(panel)).toEqual(layers);
});

test('draws null and empty values as layers of their own, as frame name', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Nulls, as frame name').locator;
  // Grafana names both the null and the empty frame '', so they share the refId A- and are told
  // apart by position: empty first (cable 1), then null (cable 4).
  const layers = { 'A-:#1': 4, 'A-underground': 7, 'A-aerial': 1, 'A-:#2': 3 };

  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(layers);
  expect(await layerNames(panel, ['A-:#1', 'A-:#2'])).toEqual(['Query A- (1)', 'Query A- (2)']);

  await dashboardPage.refreshDashboard();
  expect(await renderedFeatures(panel)).toEqual(layers);
});

test('warns about more than 50 layers, and draws them all', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Many layers').locator;

  await expect.poll(async () => Object.keys(await renderedFeatures(panel)).length, DRAWN).toBe(60);
  expect(Object.values(await renderedFeatures(panel)).every((count) => count === 1)).toBe(true);

  const warning = panel.getByTestId('geoflow-warnings');
  await expect(warning).toHaveAccessibleName('1 warning');
  await warning.hover();
  await expect(page.getByTestId('geoflow-warnings-details')).toContainText('60 layers may draw slowly');
});
