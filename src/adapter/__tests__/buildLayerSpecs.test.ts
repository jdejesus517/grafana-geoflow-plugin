import { DataFrame, FieldType, createTheme, toDataFrame } from '@grafana/data';
import { DEFAULT_LAYER_STYLE } from '../../engine';
import { loadFixture } from '../__fixtures__';
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

function build(items: Converted[], options?: { interactive: boolean }) {
  return buildLayerSpecs(
    items.map(({ result }) => result),
    items.map(({ frame }) => frame),
    theme,
    options
  );
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

  it('makes layers interactive unless told otherwise', () => {
    expect(build([converted('A')])[0].interactive).toBe(true);
    expect(build([converted('A')], { interactive: false })[0].interactive).toBe(false);
  });

  it('returns no layers for no frames', () => {
    expect(build([])).toEqual([]);
  });
});
