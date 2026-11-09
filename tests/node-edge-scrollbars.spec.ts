import { DRAWN, PanelView, expect, mapPoint, renderedFeatures, test } from './fixtures';

// The click list with real scrollbars. Playwright hides them by default (--hide-scrollbars), so
// they take no room, unlike in a browser; and in a narrow window the list's table is wider than
// its tooltip, so it gets a horizontal scrollbar, which must not cover the rows
// (docs/node-edge/phase_4.md, Outcome). A file of its own: scrollbars would change the layout,
// and so the stored screenshots, of other specs.
test.use({
  launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] },
  viewport: { width: 700, height: 620 },
});

const FILE = { fileName: '14-node-edge.json' };
const HOVER_VIEW: PanelView = { lat: 35.785, lon: -78.72, zoom: 11 };
const ON_CORE_LINE: [number, number] = [-78.7454, 35.7885];

test('shows whole rows above a horizontal scrollbar, and scrolls to the last one', async ({
  readProvisionedDashboard,
  gotoDashboardPage,
  page,
}) => {
  const dashboard = await readProvisionedDashboard(FILE);
  const dashboardPage = await gotoDashboardPage({
    ...dashboard,
    queryParams: new URLSearchParams({ viewPanel: 'panel-5' }),
  });
  const panel = dashboardPage.getPanelByTitle('Hover').locator;
  await expect.poll(async () => (await renderedFeatures(panel)).B ?? 0, DRAWN).toBeGreaterThan(0);
  const { x, y } = await mapPoint(panel, ON_CORE_LINE, HOVER_VIEW);
  await page.mouse.click(x, y);
  const list = panel.getByTestId('geoflow-edge-list');
  await expect(list.getByTestId('geoflow-edge-list-row')).toHaveCount(4);

  const measure = () =>
    list.evaluate((el) => {
      const scroller = el.querySelector('table')!.parentElement!;
      const visibleBottom = scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight;
      const head = scroller.querySelector('thead')!.getBoundingClientRect();
      const rows = [...el.querySelectorAll('[data-testid="geoflow-edge-list-row"]')].map((row) =>
        row.getBoundingClientRect()
      );
      return {
        scrollbar: scroller.offsetHeight - scroller.clientHeight,
        rowsRoom: scroller.clientHeight,
        fullRows: rows.filter((row) => row.top >= head.bottom - 0.5 && row.bottom <= visibleBottom + 0.5).length,
        lastRowFull: rows.at(-1)!.bottom <= visibleBottom + 0.5,
      };
    });

  const opened = await measure();
  expect(opened.scrollbar).toBeGreaterThan(0);
  expect(opened.rowsRoom % 24).toBe(0);
  expect(opened.fullRows).toBeGreaterThanOrEqual(1);

  await list.evaluate((el) => {
    const scroller = el.querySelector('table')!.parentElement!;
    scroller.scrollTop = scroller.scrollHeight;
  });
  expect((await measure()).lastRowFull).toBe(true);

  // Scrolled sideways to the end, the row numbers stay at the left edge, and still read 1 to 4.
  const numbers = await list.evaluate((el) => {
    const scroller = el.querySelector('table')!.parentElement!;
    scroller.scrollLeft = scroller.scrollWidth;
    const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
    const cells = [...el.querySelectorAll('tr')].map((row) => row.querySelector('th, td')!);
    return {
      scrolled: scroller.scrollLeft > 0,
      atLeftEdge: cells.every((cell) => Math.abs(cell.getBoundingClientRect().left - left) < 1),
      text: cells.map((cell) => cell.textContent),
    };
  });
  expect(numbers).toEqual({ scrolled: true, atLeftEdge: true, text: ['#', '1', '2', '3', '4'] });

  // Scrolled down a row too, row 1's number goes under the header's #, not over it.
  const top = await list.evaluate((el) => {
    const scroller = el.querySelector('table')!.parentElement!;
    scroller.scrollTop = 24;
    const corner = scroller.querySelector('th')!.getBoundingClientRect();
    const hit = document.elementFromPoint(corner.left + corner.width / 2, corner.top + corner.height / 2);
    return hit?.closest('th, td')?.textContent;
  });
  expect(top).toBe('#');
});
