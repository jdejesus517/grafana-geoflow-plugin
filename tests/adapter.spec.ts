import { DRAWN, test, expect } from './fixtures';

// Expected adapter results for the seeded fixtures (docker/postgres/init/03_seed_fixtures.sql).
const PANELS = [
  { title: 'Mixed geometry types', summaries: { A: 'A: 42 rows → 42 features (geometry)' } },
  {
    title: 'jsonb and Feature input',
    summaries: { A: 'A: 11 rows → 11 features (geom)', B: 'B: 7 rows → 7 features (feature)' },
  },
  {
    title: 'Edge cases',
    summaries: {
      A: 'A: 6 rows → 1 feature (geom) · empty 4, unsupported 1',
      B: 'B: 7 rows → no geometry: Column "geom" holds binary geometry; select ST_AsGeoJSON(geom) instead',
    },
  },
  { title: 'State Plane without ST_Transform', summaries: { A: 'A: 15 rows → 0 features (geometry) · projected 15' } },
];

for (const { title, summaries } of PANELS) {
  test(`adapter dashboard: ${title}`, async ({ readProvisionedDashboard, gotoDashboardPage }) => {
    const dashboard = await readProvisionedDashboard({ fileName: '01-adapter.json' });
    const dashboardPage = await gotoDashboardPage(dashboard);
    const panel = dashboardPage.getPanelByTitle(title);

    // Two stages, so a failure says which one stalled (docs/node-edge/phase_3.md, Design §4): the
    // panel loading (Grafana loads panels as they come on screen), then its queries returning,
    // which takes longer while other tests run.
    await panel.locator.scrollIntoViewIfNeeded();
    await expect(panel.locator.getByTestId('geoflow-panel'), 'the panel loads').toBeVisible(DRAWN);
    for (const [refId, summary] of Object.entries(summaries)) {
      await expect(panel.locator.getByTestId(`geoflow-summary-${refId}`), 'the queries return').toHaveText(
        summary,
        DRAWN
      );
    }
  });
}

test('adapter dashboard: projected rows name the fix', async ({ readProvisionedDashboard, gotoDashboardPage }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '01-adapter.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = dashboardPage.getPanelByTitle('State Plane without ST_Transform');

  await expect(panel.locator.getByTestId('geoflow-frame-A')).toContainText(
    'row 1: EPSG:2264; transform to EPSG:4326 with ST_Transform(geom, 4326)',
    DRAWN
  );
});
