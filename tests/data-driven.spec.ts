import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DRAWN, PanelView, editedPanel, expect, mapPoint, renderedFeatures, test } from './fixtures';

// Panels and view of docker/grafana/provisioning/dashboards/07-data-driven.json. The basemap is
// None, so the screenshots show only the data.
const VIEW: PanelView = { lat: 35.7868, lon: -78.7823, zoom: 13.2 };
const EDITOR_PANEL = '3';
const WALNUT_PATCH_PANEL: [number, number] = [-78.7845, 35.7836]; // WALN-PP-01, 91.7% used
/** Grafana's red, the top threshold step in the dashboard. */
const RED = 'rgb(242, 73, 92)';

/**
 * Compares a fixed area around the map's center with a stored screenshot, as in style.spec.ts.
 * 300 × 240 px holds every feature at the dashboard's view, and fits the panel editor's map.
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

/** Waits until every query's layer has drawn something. */
async function drawn(panel: Locator, layers: number) {
  await expect
    .poll(async () => Object.values(await renderedFeatures(panel)).filter((n) => n > 0).length, DRAWN)
    .toBe(layers);
}

async function openPanel(
  { readProvisionedDashboard, gotoDashboardPage }: Pick<Fixtures, 'readProvisionedDashboard' | 'gotoDashboardPage'>,
  title: string,
  layers: number
) {
  const dashboard = await readProvisionedDashboard({ fileName: '07-data-driven.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle(title).locator;
  await drawn(panel, layers);
  return panel;
}
type Fixtures = Parameters<Parameters<typeof test>[2]>[0];

test('colors and sizes features by value, with a legend of the colors', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const panel = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'By value', 3);

  // Cables by a value mapping on placement, patch panels by utilization thresholds.
  const cables = panel.getByTestId('geoflow-legend-A');
  await expect(cables).toContainText('Query A · placement');
  await expect(cables).toContainText('Underground');
  await expect(cables).toContainText('Aerial');
  await expect(cables).toContainText('Mixed');
  const patchPanels = panel.getByTestId('geoflow-legend-B');
  await expect(patchPanels).toContainText('Query B · utilization_pct');
  for (const label of ['< 60%', '60%+', '80%+']) {
    await expect(patchPanels).toContainText(label);
  }
  // Splice cases are only sized, so they have no colors to show.
  await expect(panel.getByTestId('geoflow-legend-C')).toHaveCount(0);

  await expectMap(page, panel, 'by-value.png');
});

test('shows a by-value color scheme as a gradient from Min to Max', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const panel = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Gradient', 1);

  await expect(panel.getByTestId('geoflow-legend-gradient')).toHaveText(/^0%.*100%$/);
  await expectMap(page, panel, 'gradient.png');
});

test("marks a tooltip with the feature's own color", async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
  const panel = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'By value', 3);
  const { x, y } = await mapPoint(panel, WALNUT_PATCH_PANEL, VIEW);
  await page.mouse.move(x, y);
  const tooltip = panel.getByTestId('geoflow-tooltip');

  await expect(tooltip).toContainText('WALN-PP-01');
  const marker = tooltip.locator('[style*="background-color"]').first();
  await expect.poll(() => marker.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(RED);
});

test('recolors and resizes the map as options change in the panel editor', async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '07-data-driven.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: EDITOR_PANEL });
  const panel = await editedPanel(panelEditPage);
  await drawn(panel, 1);
  const legend = panel.getByTestId('geoflow-legend-A');
  await expect(legend).toContainText('80+');

  // Lower the red threshold from 80 to 30: more patch panels turn red.
  const threshold = panelEditPage.getCustomOptions('Thresholds').element.locator('input[value="80"]');
  await threshold.fill('30');
  await threshold.blur();
  await expect(legend).toContainText('30+');
  await expectMap(page, panel, 'editor-threshold.png');

  // Size the patch panels by the same column. The field picker is a Combobox, whose menu isn't
  // the Select menu getSelect() looks in.
  await panelEditPage
    .getCustomOptions('Map style')
    .element.getByRole('combobox', { name: /^Size by/ })
    .click();
  await page.getByRole('option', { name: 'utilization_pct', exact: true }).click();
  await expectMap(page, panel, 'editor-size.png');
});
