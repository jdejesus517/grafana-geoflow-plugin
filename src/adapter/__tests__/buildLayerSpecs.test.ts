import { FieldType, toDataFrame } from '@grafana/data';
import { DEFAULT_LAYER_STYLE } from '../../engine';
import { loadFixture } from '../__fixtures__';
import { buildLayerSpecs } from '../buildLayerSpecs';
import { frameToFeatureCollection } from '../frameToFeatureCollection';

const defaults = { colors: ['green', 'yellow', 'blue'], outlineColor: 'white' };

function converted(refId: string, fixture: Parameters<typeof loadFixture>[0] = 'buildings') {
  return frameToFeatureCollection({ ...loadFixture(fixture), refId });
}

const noGeometry = frameToFeatureCollection(
  toDataFrame({ refId: 'N', fields: [{ name: 'name', type: FieldType.string, values: ['a'] }] })
);

describe('buildLayerSpecs', () => {
  it('makes one layer per frame, with the refId as id and the conversion as data', () => {
    const buildings = converted('A');
    const cables = converted('B', 'fiber_cables');
    const layers = buildLayerSpecs([buildings, cables], defaults);

    expect(layers.map((layer) => layer.id)).toEqual(['A', 'B']);
    expect(layers[0].data).toBe(buildings.featureCollection);
    expect(layers[1].data).toBe(cables.featureCollection);
  });

  it('styles layers with the defaults and the theme values', () => {
    const [layer] = buildLayerSpecs([converted('A')], defaults);

    expect(layer.style).toEqual({ ...DEFAULT_LAYER_STYLE, color: 'green', outlineColor: 'white' });
  });

  it('leaves out frames without a geometry column, without using up a color', () => {
    const layers = buildLayerSpecs([noGeometry, converted('A'), converted('B')], defaults);

    expect(layers.map((layer) => [layer.id, layer.style.color])).toEqual([
      ['A', 'green'],
      ['B', 'yellow'],
    ]);
  });

  it('keeps a layer whose rows were all skipped', () => {
    const allSkipped = frameToFeatureCollection(
      toDataFrame({
        refId: 'E',
        fields: [{ name: 'geometry', type: FieldType.string, values: ['{"type":"Point","coordinates":[500,95]}'] }],
      })
    );
    expect(allSkipped.noGeometry).toBeUndefined();

    const [layer] = buildLayerSpecs([allSkipped], defaults);
    expect(layer.id).toBe('E');
    expect(layer.data.features).toEqual([]);
  });

  it('cycles through the colors', () => {
    const layers = buildLayerSpecs(
      ['A', 'B', 'C', 'D'].map((refId) => converted(refId)),
      defaults
    );

    expect(layers.map((layer) => layer.style.color)).toEqual(['green', 'yellow', 'blue', 'green']);
  });

  it('returns no layers for no frames', () => {
    expect(buildLayerSpecs([], defaults)).toEqual([]);
  });
});
