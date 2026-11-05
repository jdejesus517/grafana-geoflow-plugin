import { DRAWN, expect, renderedFeatures, test } from './fixtures';

// Row counts from docker/postgres/init/03_seed_fixtures.sql.
const BUILDING_COUNT = 9;
const FIBER_CABLE_COUNT = 15;

// Rows per geometry type in geoflow.network_assets.
const GEOMETRY_COUNTS = {
  Point: 17,
  MultiPoint: 1,
  LineString: 14,
  MultiLineString: 1,
  Polygon: 8,
  MultiPolygon: 1,
};

for (const [title, count] of Object.entries(GEOMETRY_COUNTS)) {
  test(`draws every ${title}`, async ({ readProvisionedDashboard, gotoDashboardPage }) => {
    const dashboard = await readProvisionedDashboard({ fileName: '04-geometry.json' });
    const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle(title).locator;

    await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: count });
  });
}

test('mixed geometry types look right', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '04-geometry.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Mixed geometry types').locator;
  // Counting waits until the map has finished drawing.
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 42 });

  // A fixed area around the map's center, which holds every feature: the map is anchored at its
  // center, so this area doesn't change when a Grafana version sizes the panel differently. It
  // also leaves out the map's controls.
  const box = (await panel.locator('canvas.maplibregl-canvas').boundingBox())!;
  const clip = { width: 320, height: 300 };
  await expect(page).toHaveScreenshot('mixed-geometry.png', {
    clip: {
      x: Math.round(box.x + box.width / 2 - clip.width / 2),
      y: Math.round(box.y + box.height / 2 - clip.height / 2),
      ...clip,
    },
    maxDiffPixelRatio: 0.01,
  });
});

test('two queries draw as two layers', async ({ readProvisionedDashboard, gotoDashboardPage }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '04-geometry.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Two queries').locator;

  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: BUILDING_COUNT, B: FIBER_CABLE_COUNT });
});

test('switching the basemap keeps the features', async ({ readProvisionedDashboard, gotoPanelEditPage }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '04-geometry.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '8' });
  const panel = panelEditPage.panel.locator;
  const drawn = { A: BUILDING_COUNT, B: FIBER_CABLE_COUNT };
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(drawn);
  const basemap = panelEditPage.getCustomOptions('Basemap').getSelect('Basemap');

  await basemap.selectOption('None');
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(drawn);
  await basemap.selectOption('OpenStreetMap');
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(drawn);
});

test('rows that are hard to draw cause no errors', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
  // Errors from MapLibre, its worker, or the plugin; Grafana's own console noise is ignored.
  const problems: string[] = [];
  const ours = /maplibre|geojson|geoflow/i;
  page.on('console', (message) => {
    if (message.type() === 'error' && ours.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    if (ours.test(`${error.message} ${error.stack}`)) {
      problems.push(error.message);
    }
  });
  const dashboard = await readProvisionedDashboard({ fileName: '04-geometry.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Edge cases').locator;

  // A: the one edge_cases row with a usable geometry. B: degenerate shapes plus one valid point;
  // MapLibre draws some degenerate shapes (an unclosed ring) and skips others.
  await expect.poll(() => renderedFeatures(panel), DRAWN).toMatchObject({ A: 1 });
  expect((await renderedFeatures(panel)).B).toBeGreaterThanOrEqual(1);
  await expect(panel.getByTestId('geoflow-layer-error')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a query without a geometry column explains what to select', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '04-geometry.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('No geometry column').locator;
  await panel.scrollIntoViewIfNeeded();

  await expect(panel.getByTestId('geoflow-no-geometry')).toContainText('ST_AsGeoJSON(geom)');
});
