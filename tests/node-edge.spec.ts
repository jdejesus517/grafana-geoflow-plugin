import path from 'node:path';
import { DRAWN, expect, renderedFeatures, test } from './fixtures';

// Panels of docker/grafana/provisioning/dashboards/14-node-edge.json (docs/node-edge/phase_1.md).
// Sites and trunks come from docker/postgres/init/06_seed_network.sql: 8 sites, and 14 trunks
// over 6 pairs. The basemap is None, so screenshots show only the network.
const FILE = { fileName: '14-node-edge.json' };

test('draws one line per pair of sites, below the sites', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Network').locator;

  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 8, B: 6 });
  await expect(panel.getByTestId('geoflow-warnings')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await expect(panel.locator('canvas.maplibregl-canvas')).toHaveScreenshot('network.png', {
    stylePath: path.join(__dirname, 'fixtures', 'hide-legend.css'),
    maxDiffPixelRatio: 0.01,
  });
});

test('draws edges from from and to columns set in the layer settings', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Named columns').locator;

  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 8, B: 6 });
  await expect(panel.getByTestId('geoflow-warnings')).toHaveCount(0);
});

test("counts the rows it can't draw, and the Edges layer it doesn't use", async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Problems').locator;

  // The duplicate and the non-point node still draw as nodes: 10 features. The second Edges
  // layer draws nothing.
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual({ A: 10, B: 6, C: 0 });
  const warning = panel.getByTestId('geoflow-warnings');
  await expect(warning).toHaveAccessibleName('2 warnings');
  await warning.hover();
  const details = page.getByTestId('geoflow-warnings-details');
  await expect(details).toContainText(
    'Trunks: 6 rows skipped: unknown node 2, self-loop 1, empty end 1, duplicate node id 1, node not a point 1'
  );
  await expect(details).toContainText('Nodes row 2: node id 1 is already used by an earlier node');
  await expect(details).toContainText('Microwave trunks: Not part of the network, which uses Trunks');
});
