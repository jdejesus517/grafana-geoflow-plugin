import { test, expect } from '@grafana/plugin-e2e';

// Row counts of the seeded fixtures in docker/postgres/init/03_seed_fixtures.sql.
const BUILDING_COUNT = 9;
const FIBER_CABLE_COUNT = 15;

test('provisioned PostGIS data source is healthy', async ({ readProvisionedDataSource, request }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml', name: 'GeoFlow PostGIS' });
  const response = await request.get(`/api/datasources/uid/${ds.uid}/health`);

  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ status: 'OK' });
});

test('smoke dashboard shows frames from PostGIS', async ({ readProvisionedDashboard, gotoDashboardPage }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '00-smoke.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('GeoFlow smoke test');

  await expect(panel.locator.getByTestId('geoflow-frame-A')).toContainText(`A: ${BUILDING_COUNT} rows`);
  await expect(panel.locator.getByTestId('geoflow-frame-B')).toContainText(`B: ${FIBER_CABLE_COUNT} rows`);
  await expect(panel.locator.getByTestId('geoflow-frame-A')).toContainText('geometry (string)');
});

test('GeoFlow is available in the visualization picker', async ({ panelEditPage }) => {
  await panelEditPage.setVisualization('GeoFlow');

  await expect(panelEditPage.panel.locator).toBeVisible();
});
