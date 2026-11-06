import { DataFrame, FieldColorModeId, FieldType, createTheme, toDataFrame } from '@grafana/data';
import { DEFAULT_LAYER_STYLE } from '../../engine';
import { loadFixture } from '../__fixtures__';
import { LayerConfig, bindPerFrame } from '../bindLayers';
import { buildLayerSpecs } from '../buildLayerSpecs';
import { ConversionResult, frameToFeatureCollection } from '../frameToFeatureCollection';

const theme = createTheme();
const palette = theme.visualization.palette.map((name) => theme.visualization.getColorByName(name));

interface Converted {
  frame: DataFrame;
  result: ConversionResult;
}

function converted(refId: string, fixture: Parameters<typeof loadFixture>[0] = 'buildings'): Converted {
  const frame = { ...loadFixture(fixture), refId };
  return { frame, result: frameToFeatureCollection(frame) };
}

/** Binds the frames with `configs`, converts them as convertFrames does, and builds the layers. */
function build(items: Converted[], options?: { interactive: boolean }, configs: LayerConfig[] = []) {
  const frames = items.map(({ frame }) => frame);
  const bound = bindPerFrame(frames, configs);
  const results = frames.map((frame, i) => {
    const layer = bound.find(({ frameIndex }) => frameIndex === i)!;
    const { geometryField, idField } = layer;
    return geometryField || idField || layer.id !== frame.refId
      ? frameToFeatureCollection(frame, { geometryField, idField }, layer.id)
      : items[i].result;
  });
  return buildLayerSpecs(bound, results, frames, theme, options);
}

/** Sets the Color scheme of the frame's geometry field. */
function colorScheme({ frame, result }: Converted, mode: FieldColorModeId): Converted {
  const geometry = frame.fields.find(({ name }) => name === result.geometryField)!;
  geometry.config = { ...geometry.config, color: { mode } };
  return { frame, result };
}

const noGeometryFrame = toDataFrame({ refId: 'N', fields: [{ name: 'name', type: FieldType.string, values: ['a'] }] });
const noGeometry: Converted = { frame: noGeometryFrame, result: frameToFeatureCollection(noGeometryFrame) };

describe('buildLayerSpecs', () => {
  it('makes one layer per frame, with the refId as id and the conversion as data', () => {
    const buildings = converted('A');
    const cables = converted('B', 'fiber_cables');
    const layers = build([buildings, cables]);

    expect(layers.map((layer) => layer.id)).toEqual(['A', 'B']);
    expect(layers[0].data).toBe(buildings.result.featureCollection);
    expect(layers[1].data).toBe(cables.result.featureCollection);
  });

  it('styles layers with the defaults and the theme', () => {
    const [layer] = build([converted('A')]);

    expect(layer.style).toEqual({
      ...DEFAULT_LAYER_STYLE,
      color: palette[0],
      outlineColor: theme.colors.background.primary,
    });
  });

  it("styles each layer from its own frame's field config", () => {
    const cables = converted('B', 'fiber_cables');
    const geometry = cables.frame.fields.find(({ name }) => name === cables.result.geometryField)!;
    geometry.config = { ...geometry.config, custom: { lineWidth: 6 } };
    const layers = build([converted('A'), cables]);

    expect(layers.map((layer) => layer.style.lineWidth)).toEqual([2, 6]);
  });

  it('gives layers with Color by or Size by per-feature styles, and leaves the others without', () => {
    const cables = converted('B', 'fiber_cables');
    const geometry = cables.frame.fields.find(({ name }) => name === cables.result.geometryField)!;
    geometry.config = { ...geometry.config, custom: { sizeBy: 'fiber_count' } };
    const layers = build([converted('A'), cables]);

    expect(layers[0]).not.toHaveProperty('featureStyles');
    expect(layers[1].featureStyles?.radii).toHaveLength(cables.result.featureCollection.features.length);
    expect(layers[1].featureStyles).not.toHaveProperty('colors');
  });

  it('leaves out frames without a geometry column, without using up a color', () => {
    const layers = build([noGeometry, converted('A'), converted('B')]);

    expect(layers.map((layer) => [layer.id, layer.style.color])).toEqual([
      ['A', palette[0]],
      ['B', palette[1]],
    ]);
  });

  it('keeps a layer whose rows were all skipped', () => {
    const frame = toDataFrame({
      refId: 'E',
      fields: [{ name: 'geometry', type: FieldType.string, values: ['{"type":"Point","coordinates":[500,95]}'] }],
    });
    const allSkipped = { frame, result: frameToFeatureCollection(frame) };
    expect(allSkipped.result.noGeometry).toBeUndefined();

    const [layer] = build([allSkipped]);
    expect(layer.id).toBe('E');
    expect(layer.data.features).toEqual([]);
  });

  it('makes layers interactive unless told otherwise, by the panel or the layer', () => {
    expect(build([converted('A')])[0].interactive).toBe(true);
    expect(build([converted('A')], { interactive: false })[0].interactive).toBe(false);
    expect(build([converted('A')], undefined, [{ id: 'A', tooltips: false }])[0].interactive).toBe(false);
  });

  it('draws the layers in the saved order, bottom first, with their names and visibility', () => {
    const layers = build([converted('A'), converted('B', 'fiber_cables'), converted('C')], undefined, [
      { id: 'A', name: 'Buildings' },
      { id: 'C', visible: false },
      { id: 'B' },
    ]);

    expect(layers.map(({ id, name, visible }) => [id, name, visible])).toEqual([
      ['B', 'Query B', true],
      ['C', 'Query C', false],
      ['A', 'Buildings', true],
    ]);
  });

  it("keeps each layer's palette color when layers are moved or hidden", () => {
    const items = [converted('A'), converted('B'), converted('C')];
    const colors = (configs: LayerConfig[]) =>
      Object.fromEntries(build(items, undefined, configs).map(({ id, style }) => [id, style.color]));

    expect(colors([{ id: 'C' }, { id: 'B', visible: false }, { id: 'A' }])).toEqual({
      A: palette[0],
      B: palette[1],
      C: palette[2],
    });
  });

  it('colors By name from a typed name, and from the frame name or refId without one, as in Phase 5', () => {
    const color = (refId: string, frameName?: string, configs: LayerConfig[] = []) => {
      const item = converted(refId);
      const named = { ...item, frame: { ...item.frame, name: frameName } };
      return build([colorScheme(named, FieldColorModeId.PaletteClassicByName)], undefined, configs)[0].style.color;
    };

    expect(color('A', undefined, [{ id: 'A', name: 'Buildings' }])).toBe(color('B', 'Buildings'));
    expect(color('A')).toBe(color('X', 'A'));
    expect(color('A')).not.toBe(color('A', 'Buildings'));
  });

  it('uses the geometry and id columns given to the conversion', () => {
    const frame = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'key', type: FieldType.number, values: [7] },
        { name: 'footprint', type: FieldType.string, values: ['{"type":"Point","coordinates":[1,2]}'] },
        { name: 'centroid', type: FieldType.string, values: ['{"type":"Point","coordinates":[3,4]}'] },
      ],
    });
    const [layer] = build([{ frame, result: frameToFeatureCollection(frame) }], undefined, [
      { id: 'A', geometryField: 'centroid', idField: 'key' },
    ]);

    expect(layer.data.features).toEqual([
      { type: 'Feature', id: 7, geometry: { type: 'Point', coordinates: [3, 4] }, properties: expect.any(Object) },
    ]);
  });

  it('makes a layer for each frame of a query that returns several', () => {
    const split = (name: string) => ({ ...converted('A'), frame: { ...converted('A').frame, name } });
    const layers = build([split('aerial'), split('underground')]);

    expect(layers.map(({ id, name }) => [id, name])).toEqual([
      ['A:aerial', 'aerial'],
      ['A:underground', 'underground'],
    ]);
  });

  it('leaves out saved settings whose layer is gone', () => {
    expect(build([converted('A')], undefined, [{ id: 'Z' }, { id: 'A' }]).map(({ id }) => id)).toEqual(['A']);
  });

  it('returns no layers for no frames', () => {
    expect(build([])).toEqual([]);
  });
});
