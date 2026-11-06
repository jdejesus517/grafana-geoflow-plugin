import {
  FieldColorModeId,
  FieldConfig,
  FieldType,
  MappingType,
  SpecialValueMatch,
  ThresholdsMode,
  applyFieldOverrides,
  createTheme,
  toDataFrame,
} from '@grafana/data';
import { LayerConfig, bindPerFrame } from '../bindLayers';
import { buildLayerSpecs } from '../buildLayerSpecs';
import { frameToFeatureCollection } from '../frameToFeatureCollection';
import { MapStyleConfig } from '../layerStyle';
import { legendEntries } from '../legend';

const theme = createTheme();
const color = (name: string) => theme.visualization.getColorByName(name);
const point = '{"type":"Point","coordinates":[-78.78,35.78]}';

const THRESHOLDS: FieldConfig['thresholds'] = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'green' },
    { value: 80, color: 'red' },
    { value: 60, color: 'orange' },
  ],
};

/** One query's frame, with field config applied, and its Map style options on the geometry column. */
function query(refId: string, custom: MapStyleConfig, config: FieldConfig = {}, values: unknown[] = [10, 90]) {
  const source = toDataFrame({
    refId,
    fields: [
      { name: 'geometry', type: FieldType.string, values: values.map(() => point), config: { custom } },
      { name: 'pct', type: typeof values[0] === 'string' ? FieldType.string : FieldType.number, values, config },
    ],
  });
  const [frame] = applyFieldOverrides({
    data: [source],
    fieldConfig: { defaults: { color: { mode: FieldColorModeId.PaletteClassic } }, overrides: [] },
    replaceVariables: (value) => value,
    theme,
  });
  return frame;
}

function entries(...frames: Array<ReturnType<typeof query>>) {
  return entriesWith([], ...frames);
}

/** The legend of `frames` with the given layer settings. */
function entriesWith(configs: LayerConfig[], ...frames: Array<ReturnType<typeof query>>) {
  const results = frames.map((frame) => frameToFeatureCollection(frame));
  return legendEntries(buildLayerSpecs(bindPerFrame(frames, configs), results, frames, theme), results, frames, theme);
}

describe('legendEntries', () => {
  it('lists threshold steps low to high, labelled as Grafana does, with the unit', () => {
    const config = { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds }, unit: 'percent' };

    expect(entries(query('A', { colorBy: 'pct' }, config))).toEqual([
      {
        layerId: 'A',
        title: 'Query A',
        column: 'pct',
        items: [
          { label: '< 60%', color: color('green') },
          { label: '60%+', color: color('orange') },
          { label: '80%+', color: color('red') },
        ],
      },
    ]);
  });

  it('labels percentage thresholds as percentages of the range', () => {
    const thresholds = { ...THRESHOLDS!, mode: ThresholdsMode.Percentage };
    const [entry] = entries(
      query('A', { colorBy: 'pct' }, { thresholds, color: { mode: FieldColorModeId.Thresholds } })
    );

    expect(entry.items.map(({ label }) => label)).toEqual(['< 60%', '60%+', '80%+']);
  });

  it('lists colored value mappings first, in their order, leaving out mappings without a color', () => {
    const config: FieldConfig = {
      color: { mode: FieldColorModeId.Thresholds },
      thresholds: { mode: ThresholdsMode.Absolute, steps: [{ value: -Infinity, color: 'gray' }] },
      mappings: [
        {
          type: MappingType.ValueToText,
          options: {
            underground: { color: 'blue', index: 1 },
            aerial: { color: 'orange', text: 'Aerial', index: 0 },
            mixed: { text: 'Mixed', index: 2 },
          },
        },
        { type: MappingType.RangeToText, options: { from: 0, to: 10, result: { color: 'green', index: 3 } } },
        { type: MappingType.RegexToText, options: { pattern: 'buried.*', result: { color: 'purple', index: 4 } } },
        {
          type: MappingType.SpecialValue,
          options: { match: SpecialValueMatch.Null, result: { color: 'red', index: 5 } },
        },
      ],
    };
    const [entry] = entries(query('B', { colorBy: 'pct' }, config, ['aerial', 'underground']));

    expect(entry.items).toEqual([
      { label: 'Aerial', color: color('orange') },
      { label: 'underground', color: color('blue') },
      { label: '0 to 10', color: color('green') },
      { label: 'buried.*', color: color('purple') },
      { label: 'null', color: color('red') },
      { label: 'All values', color: color('gray') },
    ]);
  });

  it("shows a by-value scheme as a gradient across the column's range", () => {
    const gradient = { mode: 'continuous-GrYlRd' } as FieldConfig['color'];
    const [fromData] = entries(query('A', { colorBy: 'pct' }, { color: gradient }));
    const [fromMinMax] = entries(
      query('A', { colorBy: 'pct' }, { color: gradient, min: 0, max: 200, unit: 'lengthm' })
    );

    expect(fromData.items).toEqual([]);
    expect(fromData.gradient).toEqual({
      colors: [color('green'), color('yellow'), color('red')],
      min: '10',
      max: '90',
    });
    expect(fromMinMax.gradient).toMatchObject({ min: '0 m', max: '200 m' });
  });

  it('leaves out layers without Color by, or whose scheme gives every value one color', () => {
    const palette = query('B', { colorBy: 'pct' }, { color: { mode: FieldColorModeId.PaletteClassic } });
    const fixed = query('C', { colorBy: 'pct' }, { color: { mode: FieldColorModeId.Fixed, fixedColor: 'red' } });

    expect(entries(query('A', { sizeBy: 'pct' }), palette, fixed)).toEqual([]);
  });

  it('names each layer as the Layers list does, top layer first', () => {
    const config = { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } };
    const named = { ...query('B', { colorBy: 'pct' }, config), name: 'Patch panels' };

    expect(
      entries(query('A', { colorBy: 'pct' }, config), named).map(({ layerId, title }) => [layerId, title])
    ).toEqual([
      ['B', 'Patch panels'],
      ['A', 'Query A'],
    ]);
  });

  it('follows the saved order and names, and leaves out hidden layers', () => {
    const config = { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } };
    const frames = ['A', 'B', 'C'].map((refId) => query(refId, { colorBy: 'pct' }, config));
    const configs = [{ id: 'A', name: 'Cables' }, { id: 'B', visible: false }, { id: 'C' }];

    expect(entriesWith(configs, ...frames).map(({ layerId, title }) => [layerId, title])).toEqual([
      ['A', 'Cables'],
      ['C', 'Query C'],
    ]);
  });
});
