import { DRAWN, editedPanel, expect, test } from './fixtures';

// Panels of docker/grafana/provisioning/dashboards/13-basemap-presets.json (docs/phase_12.md).
// The fixtures answer every request to the providers with stubs, so the keys are made up.
const FILE = { fileName: '13-basemap-presets.json' };

const OPENFREEMAP = 'tiles.openfreemap.org';
const STADIA = 'tiles.stadiamaps.com';
const MAPTILER = 'api.maptiler.com';
const THUNDERFOREST = 'tile.thunderforest.com';

/** The stubbed requests to one host. */
function requestsTo(tileRequests: string[], host: string): URL[] {
  return tileRequests.map((url) => new URL(url)).filter((url) => url.host === host);
}

/** Waits until the host has been asked for something whose path contains `part`. */
async function requested(tileRequests: string[], host: string, part: string) {
  await expect.poll(() => requestsTo(tileRequests, host).some((url) => url.pathname.includes(part)), DRAWN).toBe(true);
}

test('each preset loads its style, with the key on every request to its host', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  tileRequests,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  // Grafana's default theme is dark; the light styles are the ones the dashboard names.
  await gotoDashboardPage({ ...dashboard, queryParams: new URLSearchParams({ theme: 'light' }) });

  // Fonts come last: they're asked for once the style's label is drawn.
  await requested(tileRequests, OPENFREEMAP, '/styles/positron');
  await requested(tileRequests, STADIA, '/stub/fonts/');
  await requested(tileRequests, MAPTILER, '/stub/fonts/');
  await requested(tileRequests, THUNDERFOREST, '/transport/');

  expect(requestsTo(tileRequests, OPENFREEMAP).every((url) => url.search === '')).toBe(true);
  expect(requestsTo(tileRequests, STADIA).map((url) => url.pathname)).toEqual(
    expect.arrayContaining(['/styles/stamen_toner.json', '/stub/sprite.json'])
  );
  // The style, its tiles, fonts and sprite: Stadia's own styles leave the key off all but the first.
  for (const url of requestsTo(tileRequests, STADIA)) {
    expect(url.searchParams.get('api_key')).toBe('stadia-test-key');
  }
  expect(requestsTo(tileRequests, MAPTILER).map((url) => url.pathname)).toContain('/maps/dataviz-v4/style.json');
  // The logo is an image in the page, not a map request.
  for (const url of requestsTo(tileRequests, MAPTILER).filter((url) => !url.pathname.endsWith('.svg'))) {
    expect(url.searchParams.get('key')).toBe('maptiler-test-key');
  }
  for (const url of requestsTo(tileRequests, THUNDERFOREST)) {
    expect(url.searchParams.get('apikey')).toBe('thunderforest-test-key');
  }
});

test("shows Thunderforest's linked attribution, and MapTiler's logo on its panel only", async ({
  readProvisionedDashboard,
  gotoDashboardPage,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const dashboardPage = await gotoDashboardPage(dashboard);
  const thunderforest = dashboardPage.getPanelByTitle('Thunderforest').locator;
  const maptiler = dashboardPage.getPanelByTitle('MapTiler').locator;
  const openfreemap = dashboardPage.getPanelByTitle('OpenFreeMap').locator;

  const attribution = thunderforest.locator('.maplibregl-ctrl-attrib');
  await expect(attribution.getByRole('link', { name: 'Thunderforest' })).toHaveAttribute(
    'href',
    'https://www.thunderforest.com/',
    DRAWN
  );
  await expect(attribution.getByRole('link', { name: 'OpenStreetMap contributors' })).toHaveAttribute(
    'href',
    'https://www.openstreetmap.org/copyright'
  );

  await expect(maptiler.getByTestId('geoflow-basemap-logo')).toHaveAttribute(
    'href',
    'https://www.maptiler.com/',
    DRAWN
  );
  await expect(maptiler.getByRole('img', { name: 'MapTiler' })).toBeAttached();
  await expect(openfreemap.locator('canvas.maplibregl-canvas')).toBeVisible(DRAWN);
  await expect(openfreemap.getByTestId('geoflow-basemap-logo')).toHaveCount(0);
});

test("uses each style's dark pair in dark theme", async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  tileRequests,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  await gotoDashboardPage({ ...dashboard, queryParams: new URLSearchParams({ theme: 'dark' }) });

  await requested(tileRequests, OPENFREEMAP, '/styles/dark');
  await requested(tileRequests, STADIA, '/styles/stamen_toner_dark.json');
  await requested(tileRequests, MAPTILER, '/maps/dataviz-v4-dark/style.json');
  await requested(tileRequests, THUNDERFOREST, '/transport-dark/');
  expect(requestsTo(tileRequests, OPENFREEMAP).some((url) => url.pathname === '/styles/positron')).toBe(false);
});

test('asks for a required key in the editor, then picks a style on the same map', async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  tileRequests,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '5' });
  const panel = await editedPanel(panelEditPage);
  const canvas = panel.locator('canvas.maplibregl-canvas');
  await expect(canvas).toBeVisible(DRAWN);
  await canvas.evaluate((el) => (el.dataset.e2eOriginal = 'true'));
  const basemap = panelEditPage.getCustomOptions('Basemap');

  // Without a key, no basemap: the default style, Streets (or Streets Dark), isn't asked for.
  await expect(basemap.element.getByText('Enter your MapTiler API key')).toBeVisible();
  expect(requestsTo(tileRequests, MAPTILER).some((url) => url.pathname.includes('/maps/streets-v4'))).toBe(false);

  const key = basemap.getTextInput('API key');
  await key.fill('maptiler-test-key');
  await key.blur();
  await expect(basemap.element.getByText('Enter your MapTiler API key')).not.toBeVisible();
  await requested(tileRequests, MAPTILER, '/maps/streets-v4');

  await page.getByRole('combobox', { name: 'Style', exact: true }).click();
  await page.getByRole('option', { name: 'Topo', exact: true }).click();
  await requested(tileRequests, MAPTILER, '/maps/topo-v4');
  await expect(page.getByRole('combobox', { name: /Dark theme style/ })).toHaveValue('Topo Dark');
  await expect(canvas).toHaveAttribute('data-e2e-original', 'true');
});
