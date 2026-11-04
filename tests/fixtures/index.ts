// Project test entry point: @grafana/plugin-e2e's test, plus tile stubbing for every test.
// Every GeoFlow panel shows a basemap, and OpenStreetMap's tile policy forbids automated
// traffic, so all tile requests are answered with a local PNG and never reach the network.
import { test as base, expect } from '@grafana/plugin-e2e';
import type { Locator } from '@playwright/test';
import { join } from 'node:path';
import { INSPECT_EVENT, RENDERED_FEATURES_ATTRIBUTE } from '../../src/panel/testHook';

/** Host for custom-tile tests; it doesn't exist, so a request that escapes the stub fails. */
export const STUB_TILE_HOST = 'tiles.geoflow.test';

const TILE = join(__dirname, 'tile.png');
const TILE_URLS = ['https://tile.openstreetmap.org/**', `https://${STUB_TILE_HOST}/**`];

export const test = base.extend<{ tileRequests: string[] }>({
  /** URLs of the tile requests the stub answered, in order. */
  tileRequests: [
    async ({ context }, use) => {
      const requests: string[] = [];
      for (const url of TILE_URLS) {
        await context.route(url, (route) => {
          requests.push(route.request().url());
          return route.fulfill({ path: TILE, contentType: 'image/png' });
        });
      }
      await use(requests);
    },
    { auto: true },
  ],
});

/** For expect.poll around renderedFeatures: the first count waits for the map to be created. */
export const DRAWN = { timeout: 30_000 };

/**
 * Features the panel's map has drawn in its current view, per layer id (query refId). Uses the
 * panel's test hook (src/panel/testHook.ts): features are pixels on a WebGL canvas, so the DOM
 * can't show them. Scrolls the panel into view, since the map only exists on screen. The map
 * counts once it has finished drawing; until the map exists, the event goes unanswered and the
 * request is sent again. Wrap in expect.poll(..., DRAWN) to wait for the data.
 */
export async function renderedFeatures(panel: Locator): Promise<Record<string, number>> {
  await panel.scrollIntoViewIfNeeded();
  const map = panel.getByTestId('geoflow-map');
  await expect(async () => {
    await map.evaluate((element, event) => element.dispatchEvent(new Event(event)), INSPECT_EVENT);
    await expect(map).toHaveAttribute(RENDERED_FEATURES_ATTRIBUTE, /.+/, { timeout: 5_000 });
  }).toPass({ timeout: 30_000 });
  return JSON.parse((await map.getAttribute(RENDERED_FEATURES_ATTRIBUTE))!);
}

export { expect };
