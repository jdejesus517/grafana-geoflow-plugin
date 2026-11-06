import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DRAWN, PanelView, editedPanel, expect, mapPoint, renderedFeatures, test } from './fixtures';

// Panels and view of docker/grafana/provisioning/dashboards/08-layers.json. The basemap is None,
// so the screenshots show only the data.
const VIEW: PanelView = { lat: 35.7835, lon: -78.7845, zoom: 16.5 };
const EDITOR_PANEL = '2';
/** WALN-PP-01, in Walnut Commons, with a cable running through it. */
const PATCH_PANEL: [number, number] = [-78.7845, 35.7836];
/** Inside Walnut Commons, away from its patch panel and the cable. */
const BUILDING: [number, number] = [-78.7847, 35.7834];

/**
 * Compares a fixed area around the map's center with a stored screenshot, as in style.spec.ts.
 * The legend is hidden: the DOM checks cover it, and it would cover features.
 */
async function expectMap(page: Page, panel: Locator, name: string) {
  await page.mouse.move(0, 0);
  // An option change reaches the map on Grafana's next render; then wait for the map to draw it.
  await page.waitForTimeout(300);
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

/** Waits until `layers` layers have drawn something. */
async function drawn(panel: Locator, layers: number) {
  await expect
    .poll(async () => Object.values(await renderedFeatures(panel)).filter((n) => n > 0).length, DRAWN)
    .toBe(layers);
}

async function pointAt(page: Page, panel: Locator, at: [number, number], action: 'move' | 'click') {
  const { x, y } = await mapPoint(panel, at, VIEW);
  await page.mouse.move(x, y);
  if (action === 'click') {
    await page.mouse.click(x, y);
  }
}

test('draws named layers in their saved order, with building tooltips off', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '08-layers.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Layers').locator;
  await drawn(panel, 3);

  await expect(panel.getByTestId('geoflow-legend-C')).toContainText('Patch panels · utilization_pct');
  // Cables on top: the cable crosses the patch panel.
  await expectMap(page, panel, 'layers.png');

  // Buildings have tooltips off: nothing over the building.
  const tooltip = panel.getByTestId('geoflow-tooltip');
  await pointAt(page, panel, BUILDING, 'move');
  await page.waitForTimeout(300);
  await expect(tooltip).toHaveCount(0);

  // Over the patch panel, the cable above it comes first.
  await pointAt(page, panel, PATCH_PANEL, 'click');
  await expect(tooltip.getByTestId('geoflow-tooltip-pager')).toHaveText('1 of 2');
  await expect(tooltip).toContainText('Fiber cables');
  await tooltip.getByRole('button', { name: 'Next feature' }).click();
  await expect(tooltip).toContainText('Patch panels');
  await expect(tooltip).toContainText('WALN-PP-01');
});

test('moves, hides, renames and redraws layers from the Layers list in the panel editor', async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '08-layers.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: EDITOR_PANEL });
  const panel = await editedPanel(panelEditPage);
  await drawn(panel, 3);
  const editor = page.getByTestId('geoflow-layers-editor');
  const rows = () =>
    editor.getByTestId(/^geoflow-layer-row-/).evaluateAll((els) => els.map((el) => el.dataset.testid!.slice(18)));
  await expect.poll(rows).toEqual(['C', 'B', 'A']);

  // Patch panels to the bottom: the building's fill covers its patch panel.
  await editor.getByRole('button', { name: 'Move Query C down' }).click();
  await editor.getByRole('button', { name: 'Move Query C down' }).click();
  await expect.poll(rows).toEqual(['B', 'A', 'C']);
  await expectMap(page, panel, 'editor-order.png');

  // Hide the cables: nothing of them is drawn.
  await editor.getByRole('button', { name: 'Hide Query B' }).click();
  await expect.poll(async () => (await renderedFeatures(panel)).B, DRAWN).toBe(0);
  expect((await renderedFeatures(panel)).A).toBeGreaterThan(0);

  // Rename the buildings: their tooltip says so.
  await editor.getByRole('button', { name: 'Query A', exact: true }).click();
  const name = editor.locator('#geoflow-layer-A-name');
  await name.fill('Buildings');
  await name.press('Tab');
  await pointAt(page, panel, BUILDING, 'move');
  await expect(panel.getByTestId('geoflow-tooltip')).toContainText('Buildings');

  // Draw the buildings from their centroid column: points instead of footprints.
  await editor.locator('#geoflow-layer-A-geometry').click();
  await page.getByRole('option', { name: 'centroid', exact: true }).click();
  await expectMap(page, panel, 'editor-centroid.png');
});

test('makes a layer for each frame of a query split by Partition by values', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '08-layers.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Partition by values').locator;
  await drawn(panel, 3);

  // With Partition by values' default naming, the frames share a refId; their labels tell them apart.
  expect(Object.keys(await renderedFeatures(panel)).sort()).toEqual([
    'A-undefined:placement=aerial',
    'A-undefined:placement=mixed',
    'A-undefined:placement=underground',
  ]);
  await expect(panel.getByTestId('geoflow-summary-layer-A-undefined:placement=aerial')).toHaveText('placement=aerial');
});
