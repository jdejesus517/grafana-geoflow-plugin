import {
  DATA_LAYER_PREFIX,
  dataSourceId,
  layoutFor,
  paintFor,
  perFeature,
  styleLayerId,
  styleLayerIds,
  styleLayers,
} from '../layerStyle';
import { BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, BASEMAP_SOURCE_ID } from '../basemapStyle';
import { LayerSpec, LayerStyle } from '../types';

/** A paint value that changes for hovered or selected features. */
const highlighted = (value: unknown, normal: unknown) => [
  'case',
  ['any', ['boolean', ['feature-state', 'selected'], false], ['boolean', ['feature-state', 'hovered'], false]],
  value,
  normal,
];

const style: LayerStyle = {
  color: '#73bf69',
  opacity: 1,
  fillOpacity: 0.35,
  lineWidth: 2,
  lineStyle: { kind: 'solid' },
  pointRadius: 5,
  outlineColor: '#ffffff',
};
const spec: LayerSpec = {
  id: 'A',
  name: 'A',
  visible: true,
  data: { type: 'FeatureCollection', features: [] },
  style,
  interactive: true,
};

describe('ids', () => {
  it('prefixes sources and style layers', () => {
    expect(dataSourceId('A')).toBe('geoflow-layer:A');
    expect(styleLayerId('A', 'circle')).toBe('geoflow-layer:A:circle');
    expect(styleLayerIds('A')).toEqual([
      'geoflow-layer:A:fill',
      'geoflow-layer:A:outline',
      'geoflow-layer:A:line',
      'geoflow-layer:A:circle',
    ]);
  });

  it("can't collide with the basemap's ids", () => {
    for (const id of [BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, BASEMAP_SOURCE_ID]) {
      expect(id.startsWith(DATA_LAYER_PREFIX)).toBe(false);
    }
  });

  it('keeps refIds with any characters apart', () => {
    expect(styleLayerIds('A:fill')).not.toContain(styleLayerId('A', 'fill'));
    expect(new Set([...styleLayerIds('A'), ...styleLayerIds('A:fill')]).size).toBe(8);
  });
});

describe('styleLayers', () => {
  const layers = styleLayers(spec);

  it('draws areas, then outlines, lines and points, all from one source', () => {
    expect(layers.map((layer) => [layer.id, layer.type])).toEqual([
      ['geoflow-layer:A:fill', 'fill'],
      ['geoflow-layer:A:outline', 'line'],
      ['geoflow-layer:A:line', 'line'],
      ['geoflow-layer:A:circle', 'circle'],
    ]);
    expect(layers.every((layer) => 'source' in layer && layer.source === 'geoflow-layer:A')).toBe(true);
  });

  it('filters each style layer to its geometry types, single and Multi*', () => {
    const filters = Object.fromEntries(
      layers.map((layer) => [layer.id.split(':').pop(), 'filter' in layer && layer.filter])
    );

    expect(filters).toEqual({
      fill: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      outline: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      line: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      circle: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
    });
  });

  it('paints every style layer from the LayerStyle', () => {
    expect(layers.map((layer) => layer.paint)).toEqual([
      { 'fill-color': '#73bf69', 'fill-opacity': highlighted(0.6, 0.35) },
      { 'line-color': '#73bf69', 'line-opacity': 1, 'line-width': highlighted(3, 1) },
      { 'line-color': '#73bf69', 'line-opacity': 1, 'line-width': highlighted(4, 2) },
      {
        'circle-color': '#73bf69',
        'circle-opacity': 1,
        'circle-radius': highlighted(7, 5),
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 1,
        'circle-stroke-width': highlighted(2, 1),
      },
    ]);
  });

  it('rounds line joins, and line ends', () => {
    expect(layers[1].layout).toEqual({ 'line-join': 'round' });
    expect(layers[2].layout).toEqual({ 'line-join': 'round', 'line-cap': 'round' });
    expect(layers[0].layout).toBeUndefined();
  });
});

describe('paintFor', () => {
  it('follows the style', () => {
    const paint = paintFor({
      ...style,
      color: 'red',
      fillOpacity: 0.5,
      lineWidth: 4,
      pointRadius: 8,
      outlineColor: 'black',
    });

    expect(paint.fill).toEqual({ 'fill-color': 'red', 'fill-opacity': highlighted(0.75, 0.5) });
    expect(paint.line).toEqual({ 'line-color': 'red', 'line-opacity': 1, 'line-width': highlighted(6, 4) });
    expect(paint.circle).toMatchObject({ 'circle-radius': highlighted(10, 8), 'circle-stroke-color': 'black' });
  });

  it('caps the highlighted fill opacity at 1', () => {
    expect(paintFor({ ...style, fillOpacity: 0.9 }).fill['fill-opacity']).toEqual(highlighted(1, 0.9));
  });

  it('fades the whole layer with its opacity, fills included', () => {
    const paint = paintFor({ ...style, opacity: 0.5, fillOpacity: 0.4 });

    expect(paint.fill['fill-opacity']).toEqual(highlighted(0.325, 0.2));
    expect(paint.outline['line-opacity']).toBe(0.5);
    expect(paint.line['line-opacity']).toBe(0.5);
    expect(paint.circle).toMatchObject({ 'circle-opacity': 0.5, 'circle-stroke-opacity': 0.5 });
  });

  it('dashes lines, but never outlines', () => {
    const dashes = (lineStyle: LayerStyle['lineStyle']) => paintFor({ ...style, lineWidth: 4, lineStyle });

    expect(dashes({ kind: 'solid' }).line).not.toHaveProperty('line-dasharray');
    expect(dashes({ kind: 'dash' }).line['line-dasharray']).toEqual([3, 3]);
    expect(dashes({ kind: 'dot' }).line['line-dasharray']).toEqual([0, 2]);
    expect(dashes({ kind: 'dash' }).outline).not.toHaveProperty('line-dasharray');
  });

  it('measures a custom pattern, typed in pixels, in line widths', () => {
    const paint = paintFor({ ...style, lineWidth: 4, lineStyle: { kind: 'custom', pattern: [8, 4, 2, 6] } });

    expect(paint.line['line-dasharray']).toEqual([2, 1, 0.5, 1.5]);
  });

  it('matches what styleLayers paints', () => {
    const paint = paintFor(style);

    expect(styleLayers(spec).map((layer) => layer.paint)).toEqual([
      paint.fill,
      paint.outline,
      paint.line,
      paint.circle,
    ]);
  });

  describe('per feature', () => {
    const color = ['coalesce', ['feature-state', 'color'], '#73bf69'];
    const radius = ['coalesce', ['feature-state', 'radius'], 5];

    it("takes colors from feature-state, with the layer's color as the fallback", () => {
      const paint = paintFor(style, { color: true, radius: false });

      expect(paint.fill['fill-color']).toEqual(color);
      expect(paint.outline['line-color']).toEqual(color);
      expect(paint.line['line-color']).toEqual(color);
      expect(paint.circle['circle-color']).toEqual(color);
      expect(paint.circle['circle-radius']).toEqual(highlighted(7, 5));
    });

    it('takes point radii from feature-state, still growing highlighted points', () => {
      const paint = paintFor(style, { color: false, radius: true });

      expect(paint.circle['circle-radius']).toEqual(highlighted(['+', radius, 2], radius));
      expect(paint.circle['circle-color']).toBe('#73bf69');
      expect(paint.line['line-width']).toEqual(paintFor(style).line['line-width']);
    });

    it('reads feature-state only for what the per-feature styles set', () => {
      expect(perFeature(spec)).toEqual({ color: false, radius: false });
      expect(perFeature({ featureStyles: {} })).toEqual({ color: false, radius: false });
      expect(perFeature({ featureStyles: { colors: [] } })).toEqual({ color: true, radius: false });
      expect(perFeature({ featureStyles: { radii: [undefined] } })).toEqual({ color: false, radius: true });
    });

    it('is what styleLayers paints for a layer with per-feature styles', () => {
      const styled: LayerSpec = { ...spec, featureStyles: { colors: ['#f00'], radii: [3] } };
      const paint = paintFor(style, { color: true, radius: true });

      expect(styleLayers(styled).map((layer) => layer.paint)).toEqual([
        paint.fill,
        paint.outline,
        paint.line,
        paint.circle,
      ]);
    });
  });
});

describe('layoutFor', () => {
  it('gives custom patterns flat line ends, so their lengths come out as typed', () => {
    expect(layoutFor({ ...style, lineStyle: { kind: 'custom', pattern: [8, 4] } }).line['line-cap']).toBe('butt');
    for (const kind of ['solid', 'dash', 'dot'] as const) {
      expect(layoutFor({ ...style, lineStyle: { kind } }).line['line-cap']).toBe('round');
    }
  });

  it('hides every style layer of a hidden layer, and sets no visibility on a visible one', () => {
    for (const kind of ['fill', 'outline', 'line', 'circle'] as const) {
      expect(layoutFor(style, false)[kind].visibility).toBe('none');
      expect(layoutFor(style)[kind]).not.toHaveProperty('visibility');
    }
    expect(styleLayers({ ...spec, visible: false }).map((layer) => layer.layout?.visibility)).toEqual([
      'none',
      'none',
      'none',
      'none',
    ]);
  });

  it('matches what styleLayers lays out', () => {
    const custom: LayerSpec = { ...spec, style: { ...style, lineStyle: { kind: 'custom', pattern: [8, 4] } } };

    expect(styleLayers(custom)[2].layout).toEqual(layoutFor(custom.style).line);
  });
});
