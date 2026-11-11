import {
  DataFrame,
  FieldColorModeId,
  FieldConfig,
  FieldType,
  MappingType,
  ThresholdsMode,
  createTheme,
  toDataFrame,
} from '@grafana/data';
import { LayerSpec } from '../../engine';
import { EdgeFieldConfig, edgeValueProblem, edgeValues } from '../edgeValues';
import { dataStyleFields, featureStyles } from '../featureStyles';
import { ConversionResult, frameToFeatureCollection } from '../frameToFeatureCollection';
import { joinEdges } from '../joinEdges';
import { MapStyleConfig } from '../layerStyle';
import { legendEntries } from '../legend';

// Styling edge lines by their pairs' values (docs/node-edge/phase_5.md, Design §1, §2 and §4).

const theme = createTheme();
const color = (name: string) => theme.visualization.getColorByName(name);
const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;
const SITES = toDataFrame({
  refId: 'A',
  fields: [
    { name: 'id', type: FieldType.number, values: [1, 6, 7] },
    { name: 'geometry', type: FieldType.string, values: [point(0), point(1), point(2)] },
  ],
});

// Three pairs: 1–6 with four trunks of mixed media, 6–7 with two fiber trunks, and 1–7 with one
// trunk and no values.
const ENDS: Array<[string, string]> = [
  ['1', '6'],
  ['6', '1'],
  ['1', '6'],
  ['6', '1'],
  ['6', '7'],
  ['7', '6'],
  ['1', '7'],
];
const CAPACITY = [100, 100, 10, 1, 10, 10, null];
const UTILIZATION = [62, 71, 9.2, 0.4, 8.8, 4.2, null];
const MEDIUM = ['fiber', 'fiber', 'fiber', 'microwave', 'fiber', 'fiber', null];
// Times, in ms: 1–6 seen from 1000 to 4000.
const SEEN = [1000, 4000, 2000, 3000, 5000, 6000, null];

type Config = FieldConfig<EdgeFieldConfig>;

/** The trunks query with Map style on its from column, and each column's config. */
function trunks(style: MapStyleConfig, configs: Record<string, Config> = {}): DataFrame {
  return toDataFrame({
    refId: 'B',
    fields: [
      { name: 'a_site', type: FieldType.string, values: ENDS.map(([a]) => a), config: { custom: style } },
      { name: 'z_site', type: FieldType.string, values: ENDS.map(([, z]) => z) },
      { name: 'capacity', type: FieldType.number, values: CAPACITY, config: configs.capacity ?? {} },
      { name: 'utilization_gbps', type: FieldType.number, values: UTILIZATION },
      {
        name: 'utilization',
        type: FieldType.number,
        values: UTILIZATION.map((u, i) => (u === null ? null : u / CAPACITY[i]!)),
        config: configs.utilization ?? {
          custom: { ratioNumerator: 'utilization_gbps', ratioDenominator: 'capacity' },
        },
      },
      { name: 'medium', type: FieldType.string, values: MEDIUM, config: configs.medium ?? {} },
      { name: 'seen', type: FieldType.time, values: SEEN, config: configs.seen ?? {} },
    ],
  });
}

function join(frame: DataFrame): ConversionResult {
  return joinEdges(
    frame,
    { layerId: 'B', refId: 'B', fromField: frame.fields[0], toField: frame.fields[1] },
    SITES,
    frameToFeatureCollection(SITES),
    SITES.fields[0]
  );
}

function values(name: string, config?: Config) {
  const frame = trunks({}, config ? { [name]: config } : {});
  return edgeValues(
    frame,
    join(frame),
    frame.fields.find((field) => field.name === name)!
  );
}

const THRESHOLDS: FieldConfig['thresholds'] = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'green' },
    { value: 100, color: 'red' },
  ],
};

describe('edgeValues', () => {
  it("sums a number column's rows per pair by default, skipping empty values", () => {
    expect(values('capacity')).toMatchObject({ kind: 'sum', values: [211, 20, undefined] });
  });

  it('takes the Edge value chosen: average, min, max or count', () => {
    expect(values('capacity', { custom: { edgeValue: 'mean' } }).values).toEqual([52.75, 10, undefined]);
    expect(values('capacity', { custom: { edgeValue: 'min' } }).values).toEqual([1, 10, undefined]);
    expect(values('capacity', { custom: { edgeValue: 'max' } }).values).toEqual([100, 10, undefined]);
    // Count counts the non-empty values: the pair with none counts 0.
    expect(values('capacity', { custom: { edgeValue: 'count' } }).values).toEqual([4, 2, 0]);
  });

  it('gives a ratio column its ratio of sums, whatever its Edge value', () => {
    const { kind, values: ratios } = values('utilization', {
      custom: { ratioNumerator: 'utilization_gbps', ratioDenominator: 'capacity', edgeValue: 'max' },
    });

    expect(kind).toBe('ratio');
    expect(ratios[0]).toBeCloseTo(142.6 / 211);
    expect(ratios[1]).toBeCloseTo(13 / 20);
    expect(ratios[2]).toBeUndefined();
  });

  it("gives a text column its rows' shared value, none when they differ, or its count", () => {
    expect(values('medium')).toMatchObject({ kind: 'shared', values: [undefined, 'fiber', undefined] });
    expect(values('medium', { custom: { edgeValue: 'count' } })).toMatchObject({
      kind: 'count',
      values: [4, 2, 0],
    });
  });

  it('gives a time column its min and max, and no sum, which is a problem', () => {
    expect(values('seen', { custom: { edgeValue: 'min' } }).values).toEqual([1000, 5000, undefined]);
    expect(values('seen', { custom: { edgeValue: 'max' } }).values).toEqual([4000, 6000, undefined]);
    expect(values('seen').values).toEqual([undefined, undefined, undefined]);

    const frame = trunks({});
    const seen = frame.fields.find(({ name }) => name === 'seen')!;
    expect(edgeValueProblem(frame, seen)).toBe("sum doesn't apply to time column seen");
    expect(edgeValueProblem(frame, { ...seen, config: { custom: { edgeValue: 'max' } } })).toBeUndefined();
    expect(
      edgeValueProblem(
        frame,
        frame.fields.find(({ name }) => name === 'medium')!
      )
    ).toBeUndefined();
  });

  it("spans the pairs' values, or the column's Min and Max where set", () => {
    expect(values('capacity').range).toEqual({ min: 20, max: 211, delta: 191 });
    expect(values('capacity', { max: 400 }).range).toEqual({ min: 20, max: 400, delta: 380 });
    expect(values('medium').range).toBeUndefined();
  });

  it('gives the same values back until the config changes', () => {
    const frame = trunks({});
    const result = join(frame);
    const capacity = frame.fields[2];
    const first = edgeValues(frame, result, capacity);

    expect(edgeValues(frame, result, capacity)).toBe(first);
    expect(edgeValues(frame, result, { ...capacity, config: { custom: { edgeValue: 'max' } } })).not.toBe(first);
  });
});

describe('featureStyles on an edge layer', () => {
  function styles(style: MapStyleConfig, configs: Record<string, Config> = {}) {
    const frame = trunks(style, configs);
    return featureStyles(frame, join(frame), theme);
  }

  it("colors each line by its pair's value through the column's thresholds", () => {
    expect(styles({ colorBy: 'capacity' }, { capacity: { thresholds: THRESHOLDS } })).toEqual({
      colors: [color('red'), color('green'), undefined],
    });
  });

  it("spreads a by-value scheme across the pairs' values, as a layer of those values would be", () => {
    const scheme: Config = { color: { mode: FieldColorModeId.ContinuousGrYlRd } };
    const pairs = toDataFrame({
      fields: [
        {
          name: 'geometry',
          type: FieldType.string,
          values: [point(0), point(1)],
          config: { custom: { colorBy: 'v' } },
        },
        { name: 'v', type: FieldType.number, values: [211, 20], config: scheme },
      ],
    });

    expect(styles({ colorBy: 'capacity' }, { capacity: scheme })?.colors).toEqual([
      ...featureStyles(pairs, frameToFeatureCollection(pairs), theme)!.colors!,
      undefined,
    ]);
  });

  it('sets line widths, not radii, from Min size to Max size', () => {
    expect(styles({ sizeBy: 'capacity', sizeMin: 2, sizeMax: 10 })).toEqual({ widths: [10, 2, undefined] });
  });

  it("colors a text column's shared values through its mappings, and leaves mixed pairs alone", () => {
    const mappings: Config = {
      mappings: [
        {
          type: MappingType.ValueToText,
          options: { fiber: { color: 'blue', index: 0 }, microwave: { color: 'orange', index: 1 } },
        },
      ],
    };

    expect(styles({ colorBy: 'medium' }, { medium: mappings })).toEqual({
      colors: [undefined, color('blue'), undefined],
    });
  });

  it("colors a count as a number, through the column's thresholds", () => {
    const counted: Config = {
      custom: { edgeValue: 'count' },
      thresholds: {
        mode: ThresholdsMode.Absolute,
        steps: [
          { value: -Infinity, color: 'green' },
          { value: 3, color: 'red' },
        ],
      },
    };

    expect(styles({ colorBy: 'medium' }, { medium: counted })).toEqual({
      colors: [color('red'), color('green'), color('green')],
    });
  });

  it("says when an Edge value doesn't apply to the column", () => {
    const frame = trunks({ colorBy: 'seen' });

    expect(dataStyleFields(frame, join(frame)).problems).toEqual(["Color by: sum doesn't apply to time column seen"]);
  });
});

describe('legendEntries for an edge layer', () => {
  function entry(style: MapStyleConfig, configs: Record<string, Config>) {
    const frame = trunks(style, configs);
    const result = join(frame);
    const layer = { id: 'B', name: 'Trunks', visible: true } as LayerSpec;
    return legendEntries([layer], [result], [frame], theme)[0];
  }

  it("ends a gradient at the pairs' range, naming the column with its Edge value", () => {
    expect(
      entry(
        { colorBy: 'capacity' },
        { capacity: { unit: 'Gbits', color: { mode: FieldColorModeId.ContinuousGrYlRd } } }
      )
    ).toMatchObject({ column: 'capacity (sum)', gradient: { min: '20 Gb/s', max: '211 Gb/s' } });
  });

  it('labels a count plainly, and names a ratio column alone', () => {
    const counted = entry(
      { colorBy: 'capacity' },
      { capacity: { unit: 'Gbits', custom: { edgeValue: 'count' }, thresholds: THRESHOLDS } }
    );
    expect(counted.column).toBe('capacity (count)');
    expect(counted.items.map(({ label }) => label)).toEqual(['< 100', '100+']);

    const ratio = entry(
      { colorBy: 'utilization' },
      {
        utilization: {
          unit: 'percentunit',
          thresholds: THRESHOLDS,
          custom: { ratioNumerator: 'utilization_gbps', ratioDenominator: 'capacity' },
        },
      }
    );
    expect(ratio.column).toBe('utilization');
  });
});
