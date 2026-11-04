import { DATA_LAYER_PREFIX, dataSourceId, paintFor, styleLayerId, styleLayerIds, styleLayers } from '../layerStyle';
import { BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, BASEMAP_SOURCE_ID } from '../basemapStyle';
import { LayerSpec, LayerStyle } from '../types';

const style: LayerStyle = {
  color: '#73bf69',
  fillOpacity: 0.35,
  lineWidth: 2,
  pointRadius: 5,
  outlineColor: '#ffffff',
};
const spec: LayerSpec = { id: 'A', data: { type: 'FeatureCollection', features: [] }, style };

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
      { 'fill-color': '#73bf69', 'fill-opacity': 0.35 },
      { 'line-color': '#73bf69', 'line-width': 1 },
      { 'line-color': '#73bf69', 'line-width': 2 },
      { 'circle-color': '#73bf69', 'circle-radius': 5, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
    ]);
  });

  it('rounds line joins, and line ends', () => {
    expect(layers[1].layout).toEqual({ 'line-join': 'round' });
    expect(layers[2].layout).toEqual({ 'line-join': 'round', 'line-cap': 'round' });
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

    expect(paint.fill).toEqual({ 'fill-color': 'red', 'fill-opacity': 0.5 });
    expect(paint.line).toEqual({ 'line-color': 'red', 'line-width': 4 });
    expect(paint.circle).toMatchObject({ 'circle-radius': 8, 'circle-stroke-color': 'black' });
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
});
