import { DRAWN, expect, renderedFeatures, test } from './fixtures';

// Rows per geometry type in geoflow.network_assets (docker/postgres/init/03_seed_fixtures.sql).
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
