import { DRAWN, expect, renderedFeatures, test } from './fixtures';

// Panels of docker/grafana/provisioning/dashboards/10-hardening.json.
const FILE = { fileName: '10-hardening.json' };

test('lists what is wrong with a panel in a warning on the map', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Problems').locator;
  const warning = panel.getByTestId('geoflow-warnings');

  await expect(warning).toHaveAccessibleName('2 warnings', DRAWN);
  await warning.hover();
  const details = page.getByTestId('geoflow-warnings-details');
  await expect(details).toContainText('Query A: 3 rows skipped: invalid 3');
  await expect(details).toContainText('gone');
});

test('shows no warning for rows without geometry', async ({ readProvisionedDashboard, gotoDashboardPage }) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Empty geometry').locator;

  await expect.poll(async () => (await renderedFeatures(panel)).A, DRAWN).toBeGreaterThan(0);
  await expect(panel.getByTestId('geoflow-warnings')).toHaveCount(0);
});

test('keeps drawing the last data when a refresh fails, and recovers', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('Two queries').locator;
  const all = { A: 9, B: 15 };
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(all);

  await page.route('**/api/ds/query**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"The database is down"}' })
  );
  await dashboardPage.refreshDashboard();
  // Grafana's own error icon appears in the panel's header.
  await expect(panel.getByTestId(/Panel status error/)).toBeVisible(DRAWN);
  expect(await renderedFeatures(panel)).toEqual(all);

  await page.unroute('**/api/ds/query**');
  await dashboardPage.refreshDashboard();
  await expect(panel.getByTestId(/Panel status error/)).toHaveCount(0, DRAWN);
  expect(await renderedFeatures(panel)).toEqual(all);
});
