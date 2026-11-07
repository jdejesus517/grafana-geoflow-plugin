// Project test entry point: @grafana/plugin-e2e's test, plus tile stubbing for every test.
// Every GeoFlow panel shows a basemap, and OpenStreetMap's tile policy forbids automated
// traffic, so all tile requests are answered with a local PNG and never reach the network.
import { PanelEditPage, test as base, expect } from '@grafana/plugin-e2e';
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

/**
 * The panel open in the panel editor. `PanelEditPage.panel` matches every panel header on the
 * page, and Grafana nightly can show the whole dashboard for a moment before the editor opens,
 * so using it straight away may find all the dashboard's panels. This waits for the editor's
 * options pane, then for the one panel it edits.
 */
export async function editedPanel(panelEditPage: PanelEditPage): Promise<Locator> {
  await expect(panelEditPage.ctx.page.getByRole('button', { name: 'Search options' })).toBeVisible({
    timeout: 30_000,
  });
  const panel = panelEditPage.panel.locator;
  await expect(panel).toHaveCount(1, { timeout: 30_000 });
  return panel;
}

/**
 * For expect.poll around renderedFeatures: the first count waits for the map to be created. Also
 * for anything that waits for query results, the map's canvas or its tiles, which take longer
 * while other tests run.
 */
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

/** The center and zoom a panel's map opens at, as in the dashboard JSON (`options.view`). */
export interface PanelView {
  lat: number;
  lon: number;
  zoom: number;
}

/**
 * Where a coordinate is on screen in a panel's map, for pointing at known features. Plain Web
 * Mercator at MapLibre's 512 px tile scale, measured from the canvas center, which is the view's
 * center whatever the panel's size. Scrolls the panel into view first, since the map only exists
 * on screen. Only valid while the map is still at `view` (no panning or zooming).
 */
export async function mapPoint(panel: Locator, [lon, lat]: [number, number], view: PanelView) {
  await panel.scrollIntoViewIfNeeded();
  const box = await panel.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) {
    throw new Error('The panel has no map canvas');
  }
  const project = (lon: number, lat: number) => {
    const size = 512 * 2 ** view.zoom;
    const sin = Math.sin((lat * Math.PI) / 180);
    return [((lon + 180) / 360) * size, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size];
  };
  const [x, y] = project(lon, lat);
  const [cx, cy] = project(view.lon, view.lat);
  return { x: box.x + box.width / 2 + x - cx, y: box.y + box.height / 2 + y - cy };
}
