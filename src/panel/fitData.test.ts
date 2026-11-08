import { ConversionResult } from '../adapter';
import { LayerSpec } from '../engine';
import { drawnBounds, fitDone, fitDue } from './fitData';
import { FitSettings } from './options';

const FIT: FitSettings = { padding: 40, maxZoom: 17, onRefresh: false };
const BOUNDS: [number, number, number, number] = [-80, 35, -79, 36];

describe('fitDue', () => {
  it('fits the first data with geometry', () => {
    expect(fitDue({}, FIT, BOUNDS, 'r1', false)).toBe(true);
  });

  it("doesn't fit in Fixed, without data, or while a query runs", () => {
    expect(fitDue({}, undefined, BOUNDS, 'r1', false)).toBe(false);
    expect(fitDue({}, FIT, undefined, 'r1', false)).toBe(false);
    expect(fitDue({}, FIT, BOUNDS, 'r1', true)).toBe(false);
  });

  it('fits again only when the settings change', () => {
    const last = fitDone(FIT, 'r1');

    expect(fitDue(last, FIT, BOUNDS, 'r2', false)).toBe(false);
    expect(fitDue(last, { ...FIT, padding: 10 }, BOUNDS, 'r1', false)).toBe(true);
  });

  it('fits each new response in Fit on refresh', () => {
    const fit = { ...FIT, onRefresh: true };
    const last = fitDone(fit, 'r1');

    expect(fitDue(last, fit, BOUNDS, 'r1', false)).toBe(false);
    expect(fitDue(last, fit, BOUNDS, 'r2', false)).toBe(true);
  });
});

describe('drawnBounds', () => {
  const result = (layerId: string, bounds?: [number, number, number, number]) =>
    ({ layerId, bounds }) as ConversionResult;
  const layer = (id: string, visible = true) => ({ id, visible }) as LayerSpec;

  it('covers the visible layers only', () => {
    const results = [result('A', [0, 0, 1, 1]), result('B', [5, 5, 6, 6]), result('C', [-9, -9, -8, -8])];

    expect(drawnBounds([layer('A'), layer('B'), layer('C', false)], results)).toEqual([0, 0, 6, 6]);
  });

  it('is undefined without features', () => {
    expect(drawnBounds([layer('A')], [result('A')])).toBeUndefined();
  });
});
