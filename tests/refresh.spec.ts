import path from 'node:path';
import type { DashboardPage } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';
import { DRAWN, PanelView, editedPanel, expect, mapPoint, renderedFeatures, test } from './fixtures';

// Panels of docker/grafana/provisioning/dashboards/09-refresh.json, by id and title.
const PANELS = {
  fit: { id: '1', title: 'Fit to data' },
  fitOnRefresh: { id: '2', title: 'Fit on refresh' },
  hover: { id: '3', title: 'Hover' },
  darkTiles: { id: '4', title: 'Dark tiles' },
};
type PanelRef = (typeof PANELS)[keyof typeof PANELS];
/** The fixed view of the Hover panel: Walnut Commons, as in 08 Layers. */
const WALNUT: PanelView = { lat: 35.7835, lon: -78.7845, zoom: 16.5 };
/** Inside Walnut Commons. */
const BUILDING: [number, number] = [-78.7847, 35.7834];
/** Every feature: 9 buildings (A) and 15 cables (B). */
const ALL = { A: 9, B: 15 };

type Fixtures = Parameters<Parameters<typeof test>[2]>[0];

async function openPanel(
  { readProvisionedDashboard, gotoDashboardPage }: Pick<Fixtures, 'readProvisionedDashboard' | 'gotoDashboardPage'>,
  { title }: PanelRef,
  params: Record<string, string> = {}
): Promise<{ dashboardPage: DashboardPage; panel: Locator }> {
  const dashboard = await readProvisionedDashboard({ fileName: '09-refresh.json' });
  const dashboardPage = await gotoDashboardPage({ ...dashboard, queryParams: new URLSearchParams(params) });
  return { dashboardPage, panel: dashboardPage.getPanelByTitle(title).locator };
}

/**
 * Refreshes the dashboard and waits for the panel's query response. With `keyboard`, through
 * Grafana's d r shortcut, so the pointer stays where it is: clicking Refresh would move it off
 * the map.
 */
async function refresh(page: Page, dashboardPage: DashboardPage, { id }: PanelRef, keyboard = false) {
  const query = page.waitForResponse(
    (response) => response.url().includes('/api/ds/query') && response.request().headers()['x-panel-id'] === id
  );
  if (keyboard) {
    await page.keyboard.press('d');
    await page.keyboard.press('r');
  } else {
    await dashboardPage.refreshDashboard();
  }
  await query;
}

async function zoomIn(panel: Locator, times: number) {
  for (let i = 0; i < times; i++) {
    await panel.getByRole('button', { name: 'Zoom in' }).click();
  }
}

test('Fit to data frames every feature when the panel loads', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, PANELS.fit);

  // The panel's fixed view is the whole world, where the network would be a dot.
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(ALL);
  await page.mouse.move(0, 0);
  const box = (await panel.locator('canvas.maplibregl-canvas').boundingBox())!;
  await expect(page).toHaveScreenshot('fit.png', {
    clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
    stylePath: path.join(__dirname, 'fixtures', 'hide-legend.css'),
    maxDiffPixelRatio: 0.01,
  });
});

test('a refresh keeps the view the user zoomed to', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
  const { dashboardPage, panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, PANELS.fit);
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(ALL);
  await zoomIn(panel, 3);
  const zoomed = await renderedFeatures(panel);
  expect(zoomed.A).toBeLessThan(ALL.A);

  await refresh(page, dashboardPage, PANELS.fit);

  await page.waitForTimeout(500);
  expect(await renderedFeatures(panel)).toEqual(zoomed);
});

test('Fit on refresh fits the data again on a refresh', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const { dashboardPage, panel } = await openPanel(
    { readProvisionedDashboard, gotoDashboardPage },
    PANELS.fitOnRefresh
  );
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(ALL);
  await zoomIn(panel, 3);
  expect((await renderedFeatures(panel)).A).toBeLessThan(ALL.A);

  await refresh(page, dashboardPage, PANELS.fitOnRefresh);

  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(ALL);
});

test('a hover tooltip stays open through a refresh that brings the same data', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const { dashboardPage, panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, PANELS.hover);
  await expect.poll(async () => (await renderedFeatures(panel)).A, DRAWN).toBeGreaterThan(0);
  const { x, y } = await mapPoint(panel, BUILDING, WALNUT);
  await page.mouse.move(x, y);
  const tooltip = panel.getByTestId('geoflow-tooltip');
  await expect(tooltip).toContainText('Walnut Commons');

  await refresh(page, dashboardPage, PANELS.hover, true);

  // Without the reused conversion, new data drops the hover until the pointer moves again.
  await page.waitForTimeout(500);
  await expect(tooltip).toContainText('Walnut Commons');
});

test('Use current view saves the map’s view as the fixed view', async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '09-refresh.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: PANELS.fit.id });
  const panel = await editedPanel(panelEditPage);
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(ALL);
  const current = page.getByTestId('geoflow-current-view');
  // The fitted view, then one zoom level closer.
  await expect(current).toContainText(/^35\.\d{5}, -78\.\d{5} · zoom \d+\.\d$/);
  const fitted = Number((await current.innerText()).match(/zoom ([\d.]+)/)![1]);
  await zoomIn(panel, 1);
  await expect(current).toContainText(`zoom ${(fitted + 1).toFixed(1)}`);
  const [lat, lon] = (await current.innerText()).split(' · ')[0].split(', ');

  await page.getByRole('button', { name: 'Use current view' }).click();

  await expect(page.getByRole('radio', { name: 'Fixed' })).toBeChecked();
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue(String(Number(lat)));
  await expect(page.getByLabel('Longitude', { exact: true })).toHaveValue(String(Number(lon)));
  await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue(String(fitted + 1));
});

test.describe('Dark theme tile URL', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`is ${theme === 'dark' ? 'used' : 'not used'} in ${theme} theme`, async ({
      readProvisionedDashboard,
      gotoDashboardPage,
      tileRequests,
    }) => {
      const { panel } = await openPanel({ readProvisionedDashboard, gotoDashboardPage }, PANELS.darkTiles, { theme });
      // The map exists only on screen, and takes a while under the full suite's load.
      await panel.scrollIntoViewIfNeeded();
      await expect(panel.locator('canvas.maplibregl-canvas')).toBeVisible(DRAWN);

      await expect
        .poll(() => tileRequests.filter((url) => url.includes(`/${theme}/`)).length, DRAWN)
        .toBeGreaterThan(0);
      const other = theme === 'dark' ? 'light' : 'dark';
      expect(tileRequests.filter((url) => url.includes(`/${other}/`))).toEqual([]);
    });
  }
});
