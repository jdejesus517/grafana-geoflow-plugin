// Project test entry point: @grafana/plugin-e2e's test, plus tile stubbing for every test.
// Every GeoFlow panel shows a basemap, and OpenStreetMap's tile policy forbids automated
// traffic, so all tile requests are answered with a local PNG and never reach the network.
import { test as base, expect } from '@grafana/plugin-e2e';
import { join } from 'node:path';

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

export { expect };
