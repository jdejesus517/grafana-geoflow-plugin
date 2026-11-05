import type { Locator, Page } from '@playwright/test';
import { DRAWN, editedPanel, expect, renderedFeatures, test } from './fixtures';

// Panels of docker/grafana/provisioning/dashboards/06-style.json. The basemap is None, so the
// screenshots show only the data.
const STYLE_EDITOR_PANEL = '3';

/**
 * Compares a fixed area around the map's center with a stored screenshot. The map is anchored at
 * its center, so the area doesn't change when a Grafana version sizes the panel differently. It
 * fits the panel editor's smaller map and leaves out the map's controls. The pointer is moved away
 * first, so no feature is highlighted.
 */
async function expectMap(page: Page, panel: Locator, name: string) {
  await page.mouse.move(0, 0);
  // An option change reaches the map on Grafana's next render; then wait for the map to draw it.
  await page.waitForTimeout(300);
  await renderedFeatures(panel);
  const box = (await panel.locator('canvas.maplibregl-canvas').boundingBox())!;
  const clip = { width: 300, height: 200 };
  await expect(page).toHaveScreenshot(name, {
    clip: {
      x: Math.round(box.x + box.width / 2 - clip.width / 2),
      y: Math.round(box.y + box.height / 2 - clip.height / 2),
      ...clip,
    },
    maxDiffPixelRatio: 0.01,
  });
}

/** Waits until every query's layer has drawn something; returns the counts. */
async function drawn(panel: Locator, layers: number) {
  await expect
    .poll(async () => Object.values(await renderedFeatures(panel)).filter((n) => n > 0).length, DRAWN)
    .toBe(layers);
  return renderedFeatures(panel);
}

test('styles each query with its overrides', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '06-style.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Per query').locator;
  await drawn(panel, 3);

  await expectMap(page, panel, 'per-query.png');
});

test('draws solid, dashed, dotted and custom lines', async ({ readProvisionedDashboard, gotoDashboardPage, page }) => {
  const dashboard = await readProvisionedDashboard({ fileName: '06-style.json' });
  const panel = (await gotoDashboardPage(dashboard)).getPanelByTitle('Line styles').locator;
  await drawn(panel, 4);

  await expectMap(page, panel, 'line-styles.png');
});

test('restyles the map as options change in the panel editor', async ({
  readProvisionedDashboard,
  gotoPanelEditPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: '06-style.json' });
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: STYLE_EDITOR_PANEL });
  const panel = await editedPanel(panelEditPage);
  const counts = await drawn(panel, 3);
  const mapStyle = panelEditPage.getCustomOptions('Map style');
  const setSlider = async (label: string, value: string) => {
    const input = mapStyle.getSliderInput(label);
    await input.fill(value);
    await input.blur();
  };

  await panelEditPage.getStandardOptions().getSelect('Color scheme').selectOption('Single color');
  await setSlider('Line width', '6');
  await setSlider('Point size', '16');
  await mapStyle.getSelect('Line style').selectOption('Dashed');
  await expectMap(page, panel, 'editor-dashed.png');

  await mapStyle.getSelect('Line style').selectOption('Custom');
  const pattern = mapStyle.getTextInput('Dash pattern');
  await pattern.fill('12, 4, 2, 4');
  await pattern.blur();
  await expectMap(page, panel, 'editor-custom.png');

  // A pattern that can't be used says why, and the lines draw solid.
  await pattern.fill('12, x');
  await pattern.blur();
  await expect(mapStyle.element.getByText(/Use numbers of 0 or more/)).toBeVisible();
  await expectMap(page, panel, 'editor-solid.png');

  // Fully transparent: the features are still there, but nothing shows.
  await setSlider('Opacity', '0');
  await expect.poll(() => renderedFeatures(panel), DRAWN).toEqual(counts);
  await expectMap(page, panel, 'editor-transparent.png');
});
