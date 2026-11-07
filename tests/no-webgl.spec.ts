import { DRAWN, expect, test } from './fixtures';

// In a file of its own: launch options apply to a whole worker, so they can't be set per test.
test.use({ launchOptions: { args: ['--disable-webgl2'] } });

test('says WebGL2 is missing instead of drawing a map, and the rest of the dashboard works', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '10-hardening.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Two queries').locator;

  await expect(panel.getByTestId('geoflow-map-error')).toContainText('needs WebGL2', DRAWN);
  await expect(panel.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  await expect(dashboardPage.getPanelByTitle('Not a map').locator.getByText('Cary Central Office')).toBeVisible(DRAWN);
});
