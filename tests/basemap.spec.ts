import { DRAWN, STUB_TILE_HOST, editedPanel, expect, test } from './fixtures';

const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/** Highest tile zoom requested from the OSM tile server so far, or -1 before any request. */
function maxOsmTileZoom(tileRequests: string[]): number {
  const zooms = tileRequests.map((url) => /tile\.openstreetmap\.org\/(\d+)\//.exec(url)?.[1]).filter(Boolean);
  return Math.max(-1, ...zooms.map(Number));
}

test('OpenStreetMap panel shows the map, controls and attribution', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  tileRequests,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '02-basemap.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('OpenStreetMap').locator;

  await expect(panel.locator('canvas.maplibregl-canvas')).toBeVisible(DRAWN);
  await expect(panel.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(panel.getByText(OSM_ATTRIBUTION)).toBeAttached();
  await expect.poll(() => maxOsmTileZoom(tileRequests), DRAWN).toBeGreaterThan(0);
});

test('zoom control zooms the map', async ({ readProvisionedDashboard, gotoDashboardPage, tileRequests }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '02-basemap.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('OpenStreetMap').locator;
  await expect.poll(() => maxOsmTileZoom(tileRequests), DRAWN).toBeGreaterThan(0);
  const before = maxOsmTileZoom(tileRequests);

  await panel.getByRole('button', { name: 'Zoom in' }).click();

  // The map's zoom level isn't readable from outside, but it fetches tiles for the new one.
  await expect.poll(() => maxOsmTileZoom(tileRequests), DRAWN).toBe(before + 1);
});

test('None basemap shows a map without tiles or attribution', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '02-basemap.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('No basemap').locator;

  await expect(panel.locator('canvas.maplibregl-canvas')).toBeVisible(DRAWN);
  await expect(panel.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(panel.getByText(OSM_ATTRIBUTION)).not.toBeAttached();
});

test('dark theme shows the map with themed controls', async ({ readProvisionedDashboard, gotoDashboardPage }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '02-basemap.json' });
  const dashboardPage = await gotoDashboardPage({ ...dashboard, queryParams: new URLSearchParams({ theme: 'dark' }) });
  const panel = dashboardPage.getPanelByTitle('OpenStreetMap').locator;

  await expect(panel.locator('canvas.maplibregl-canvas')).toBeVisible(DRAWN);
  // MapLibre's controls are white by default; the panel restyles them with the theme's background.
  const background = await panel
    .locator('.maplibregl-ctrl-group')
    .evaluate((el) => getComputedStyle(el).backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number));
  expect(Math.max(...background)).toBeLessThan(80);
});

test('switching the basemap in the panel editor keeps the same map', async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  tileRequests,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '02-basemap.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  const panel = await editedPanel(panelEditPage);
  const canvas = panel.locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible(DRAWN);
  // Tag the canvas: if the map were recreated, the tag would be gone.
  await canvas.evaluate((el) => (el.dataset.e2eOriginal = 'true'));
  const basemap = panelEditPage.getCustomOptions('Basemap');

  // MapLibre keeps the attribution element and hides it with a class when no source has one.
  const attribution = panel.locator('.maplibregl-ctrl-attrib');
  await basemap.getSelect('Basemap').selectOption('None');
  await expect(attribution).toHaveClass(/maplibregl-attrib-empty/);

  await basemap.getSelect('Basemap').selectOption('Custom tiles');
  const tileUrl = basemap.getTextInput('Tile URL template');
  await expect(basemap.element.getByText('Enter a tile URL template')).toBeVisible();
  await tileUrl.fill(`https://${STUB_TILE_HOST}/{z}/{x}/{y}.png`);
  await tileUrl.blur();
  await expect(basemap.element.getByText('Enter a tile URL template')).not.toBeVisible();
  await expect.poll(() => tileRequests.some((url) => url.includes(STUB_TILE_HOST))).toBe(true);

  await basemap.getSelect('Basemap').selectOption('OpenStreetMap');
  await expect(attribution).not.toHaveClass(/maplibregl-attrib-empty/);
  await expect(attribution).toContainText(OSM_ATTRIBUTION);
  await expect(canvas).toHaveAttribute('data-e2e-original', 'true');
});

test('a dashboard with 20 maps loads, scrolls and closes without WebGL errors', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  // WebGL errors, Chromium's context-limit warning and lost contexts. Software GL also logs
  // performance notes ("GPU stall due to ReadPixels"), which aren't failures.
  const webglProblems: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (
      (message.type() === 'error' && /webgl/i.test(text)) ||
      /too many active webgl contexts|context lost|CONTEXT_LOST_WEBGL/i.test(text)
    ) {
      webglProblems.push(`${message.type()}: ${text}`);
    }
  });
  const dashboard = await readProvisionedDashboard({ fileName: '03-many-panels.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const panel = (i: number) => dashboardPage.getPanelByTitle(`Map ${i}`).locator;
  // A map exists only while its panel is on or near the screen, so scroll to the panel, not the map.
  const showsMap = async (i: number) => {
    await panel(i).scrollIntoViewIfNeeded();
    await expect(panel(i).locator('canvas.maplibregl-canvas')).toBeVisible(DRAWN);
  };

  for (let i = 1; i <= 20; i++) {
    await showsMap(i);
  }
  // Chromium allows 16 live WebGL contexts per page; maps scrolled out of view are released.
  await expect.poll(() => page.locator('canvas.maplibregl-canvas').count(), { timeout: 10_000 }).toBeLessThan(16);

  for (let i = 20; i >= 1; i--) {
    await showsMap(i);
  }
  await expect(page.getByTestId('geoflow-map-paused')).toHaveCount(0);
  await page.goto('/');

  expect(webglProblems).toEqual([]);
});
