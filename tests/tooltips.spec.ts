import type { Locator, Page } from '@playwright/test';
import { DRAWN, PanelView, expect, mapPoint, renderedFeatures, test } from './fixtures';

// Panels, views and fixture rows of docker/grafana/provisioning/dashboards/05-tooltips.json.
const BUILDING: PanelView = { lat: 35.7885, lon: -78.7815, zoom: 16 }; // Academy Square Offices
const PATCH_PANEL: PanelView = { lat: 35.78805, lon: -78.7881, zoom: 16 }; // CO-PP-01
const SPLICE_CASE: PanelView = { lat: 35.788, lon: -78.786, zoom: 16 }; // SC-01, on three cables
const TEXT_KEY: PanelView = { lat: 35.78845, lon: -78.7815, zoom: 16 }; // ACAD-PP-01, id 'patch_panel:3'
// Offsets [lon, lat] from a target to where nothing is drawn.
/** About 90 m south: for hovering. A pinned tooltip may open below its feature and cover it. */
const EMPTY_SOUTH: [number, number] = [0, -0.0008];

/**
 * Clicks empty map just inside the canvas's left edge, halfway down: beside a tooltip anchored at
 * the center, and still on the map however wide the panel is (about 200 m west of the target).
 */
async function clickEmptyMap(page: Page, panel: Locator) {
  const box = (await panel.locator('canvas.maplibregl-canvas').boundingBox())!;
  await page.mouse.click(box.x + 12, box.y + box.height / 2);
}

async function openPanel(
  { readProvisionedDashboard, gotoDashboardPage }: Pick<Fixtures, 'readProvisionedDashboard' | 'gotoDashboardPage'>,
  title: string
) {
  const dashboard = await readProvisionedDashboard({ fileName: '05-tooltips.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle(title).locator;
  // Counting waits until the map has drawn its data.
  await expect.poll(async () => Object.values(await renderedFeatures(panel)).every((n) => n > 0), DRAWN).toBe(true);
  return { panel, dashboardPage };
}
type Fixtures = Parameters<Parameters<typeof test>[2]>[0];

async function pointAt(
  page: Page,
  panel: Locator,
  view: PanelView,
  action: 'move' | 'click',
  [dLon, dLat]: [number, number] = [0, 0]
) {
  const { x, y } = await mapPoint(panel, [view.lon + dLon, view.lat + dLat], view);
  await (action === 'move' ? page.mouse.move(x, y) : page.mouse.click(x, y));
}

test.describe('hover', () => {
  test('shows the feature formatted with the field options, without hidden fields', async ({
    page,
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Buildings');
    await pointAt(page, panel, BUILDING, 'move');
    const tooltip = panel.getByTestId('geoflow-tooltip');

    await expect(tooltip).toContainText('Query A');
    await expect(tooltip).toContainText('Academy Square Offices');
    await expect(tooltip).toContainText('4 floors');
    await expect(tooltip).toContainText('2019-06-17');
    await expect(tooltip).toContainText('In service');
    await expect(tooltip).not.toContainText('address');
    await expect(tooltip).not.toContainText('210 Academy Sq');
    // Links are only in the pinned tooltip.
    await expect(tooltip.getByRole('link')).toHaveCount(0);
  });

  test('hides the tooltip over empty map', async ({ page, readProvisionedDashboard, gotoDashboardPage }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Buildings');
    await pointAt(page, panel, BUILDING, 'move');
    await expect(panel.getByTestId('geoflow-tooltip')).toBeVisible();

    await pointAt(page, panel, BUILDING, 'move', EMPTY_SOUTH);
    await expect(panel.getByTestId('geoflow-tooltip')).toHaveCount(0);
  });

  test('shows the topmost feature and how many more are under the pointer', async ({
    page,
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Overlap');
    await pointAt(page, panel, SPLICE_CASE, 'move');
    const tooltip = panel.getByTestId('geoflow-tooltip');

    // Query B (splice cases) draws above query A (cables).
    await expect(tooltip).toContainText('Query B');
    await expect(tooltip).toContainText('SC-01');
    await expect(tooltip.getByTestId('geoflow-tooltip-more')).toHaveText('+3 more');
  });
});

test.describe('click', () => {
  test('pins a tooltip that pages through every feature under the click', async ({
    page,
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Overlap');
    await pointAt(page, panel, SPLICE_CASE, 'click');
    const tooltip = panel.getByTestId('geoflow-tooltip');
    const pager = tooltip.getByTestId('geoflow-tooltip-pager');

    await expect(pager).toHaveText('1 of 4');
    await expect(tooltip).toContainText('SC-01');
    await tooltip.getByRole('button', { name: 'Next feature' }).click();
    await expect(pager).toHaveText('2 of 4');
    await expect(tooltip).toContainText('Query A');
  });

  test("has the feature's data links, with its row's values", async ({
    page,
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Buildings');
    await pointAt(page, panel, BUILDING, 'click');
    const link = panel.getByTestId('geoflow-tooltip').getByRole('link', { name: /Show Academy Square Offices/ });

    await expect(link).toHaveAttribute('href', /\/d\/geoflow-04-geometry\?var-building=2$/);
  });

  test('fits on the map, scrolling its fields, when pinned in the middle of a short panel', async ({
    page,
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Buildings');
    await pointAt(page, panel, BUILDING, 'click');
    const tooltip = panel.getByTestId('geoflow-tooltip');
    const link = tooltip.getByRole('link', { name: /Show Academy Square Offices/ });
    await expect(link).toBeVisible();

    // The panel is too short for every field above or below the building, which is at its center.
    const map = (await panel.locator('canvas.maplibregl-canvas').boundingBox())!;
    const box = (await tooltip.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(map.y);
    expect(box.y + box.height).toBeLessThanOrEqual(map.y + map.height);
    expect(box.x).toBeGreaterThanOrEqual(map.x);
    expect(box.x + box.width).toBeLessThanOrEqual(map.x + map.width);
    // The header and the data links stay in view; the fields between them scroll.
    const linkBox = (await link.boundingBox())!;
    expect(linkBox.y + linkBox.height).toBeLessThanOrEqual(box.y + box.height);
    const fields = tooltip.locator('[style*="overflow-y"]');
    expect(await fields.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  });

  test('stays pinned while the pointer moves on', async ({ page, readProvisionedDashboard, gotoDashboardPage }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Buildings');
    await pointAt(page, panel, BUILDING, 'click');
    await pointAt(page, panel, BUILDING, 'move', EMPTY_SOUTH);

    await expect(panel.getByTestId('geoflow-tooltip')).toContainText('Academy Square Offices');
  });

  test('unpins on Escape, the close button, and a click on empty map', async ({
    page,
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Buildings');
    const tooltip = panel.getByTestId('geoflow-tooltip');
    // Only a pinned tooltip has a close button. Once unpinned, the pointer may still be over the
    // building, which brings back the hover tooltip.
    const close = tooltip.getByRole('button', { name: 'Close' });

    await pointAt(page, panel, BUILDING, 'click');
    await expect(close).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(close).toHaveCount(0);

    await pointAt(page, panel, BUILDING, 'click');
    await close.click();
    await expect(close).toHaveCount(0);

    await pointAt(page, panel, BUILDING, 'click');
    await clickEmptyMap(page, panel);
    await expect(tooltip).toHaveCount(0);
  });

  test('closes when the basemap changes', async ({ page, readProvisionedDashboard, gotoPanelEditPage }) => {
    const dashboard = await readProvisionedDashboard({ fileName: '05-tooltips.json' });
    const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
    const panel = panelEditPage.panel.locator;
    await expect.poll(async () => (await renderedFeatures(panel)).A > 0, DRAWN).toBe(true);
    await pointAt(page, panel, BUILDING, 'click');
    await expect(panel.getByTestId('geoflow-tooltip')).toBeVisible();

    await panelEditPage.getCustomOptions('Basemap').getRadioGroup('Basemap').check('OpenStreetMap');
    await expect(panel.getByTestId('geoflow-tooltip')).toHaveCount(0);
  });

  test('follows a pinned feature with a text key through a refresh', async ({
    page,
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const { panel, dashboardPage } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Text keys');
    await pointAt(page, panel, TEXT_KEY, 'click');
    const tooltip = panel.getByTestId('geoflow-tooltip');
    await expect(tooltip).toContainText('ACAD-PP-01');

    // The query orders rows randomly, so the feature's row, and with it its MapLibre id, changes.
    const query = page.waitForResponse((response) => response.url().includes('/api/ds/query'));
    await dashboardPage.refreshDashboard();
    await query;

    await expect(tooltip).toContainText('ACAD-PP-01');
    await expect(tooltip).toContainText('patch_panel:3');
  });
});

test.describe('Tooltip option', () => {
  test('Click only shows nothing on hover, and pins on click', async ({
    page,
    readProvisionedDashboard,
    gotoDashboardPage,
  }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Patch panels (click only)');
    await pointAt(page, panel, PATCH_PANEL, 'move');
    // Give a hover tooltip the chance to appear.
    await page.waitForTimeout(300);
    await expect(panel.getByTestId('geoflow-tooltip')).toHaveCount(0);

    await pointAt(page, panel, PATCH_PANEL, 'click');
    const tooltip = panel.getByTestId('geoflow-tooltip');
    await expect(tooltip).toContainText('CO-PP-01');
    await expect(tooltip).toContainText('66.7%');
  });

  test('Off shows nothing on hover or click', async ({ page, readProvisionedDashboard, gotoDashboardPage }) => {
    const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, 'Tooltip off');
    await pointAt(page, panel, BUILDING, 'move');
    await pointAt(page, panel, BUILDING, 'click');
    await page.waitForTimeout(300);

    await expect(panel.getByTestId('geoflow-tooltip')).toHaveCount(0);
  });
});
