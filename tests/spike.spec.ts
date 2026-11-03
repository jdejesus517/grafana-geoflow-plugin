// SPIKE (Phase 2 step 2.2): removed once the real map e2e tests exist.
import { test, expect } from '@grafana/plugin-e2e';
import { join } from 'node:path';

test('MapLibre renders in the plugin bundle', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ path: join(__dirname, 'fixtures', 'tile.png'), contentType: 'image/png' })
  );

  const dashboard = await readProvisionedDashboard({ fileName: '00-smoke.json' });
  const dashboardPage = await gotoDashboardPage(dashboard);
  const spike = dashboardPage.getPanelByTitle('GeoFlow smoke test').locator.getByTestId('geoflow-spike');

  await expect(spike).toHaveAttribute('data-idle', 'true', { timeout: 20000 });
  const attrs = await spike.evaluate((el) => ({ ...(el as HTMLElement).dataset }));
  console.log('SPIKE', JSON.stringify(attrs));
  console.log(
    'SPIKE requests',
    JSON.stringify(requests.filter((u) => /maplibre|\.mjs|tile\.openstreetmap|plugins\/jdejesusio/.test(u)))
  );
  console.log('SPIKE console errors', JSON.stringify(consoleErrors));
  expect(attrs.webgl2).toBe('true');
  expect(attrs.error).toBeUndefined();
  expect(attrs.features).toBe('1');
  await expect(spike.locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect(spike.getByText('© OpenStreetMap contributors')).toBeAttached();
});
