import { DataFrame, FieldConfig, FieldType, createTheme, getDisplayProcessor, toDataFrame } from '@grafana/data';
import { frameToFeatureCollection } from '../frameToFeatureCollection';
import { joinEdges } from '../joinEdges';
import { EdgeFieldConfig, pairDetails } from '../pairDetails';

const theme = createTheme();
const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;
const SITES = toDataFrame({
  fields: [
    { name: 'id', type: FieldType.number, values: [1, 6, 7] },
    { name: 'geometry', type: FieldType.string, values: [point(0), point(1), point(2)] },
  ],
});

interface Column {
  name: string;
  type: FieldType;
  values: unknown[];
  config?: FieldConfig<EdgeFieldConfig & { hideInTooltip?: boolean }>;
}

/** Trunks with a_site and z_site, plus `columns`, each with Grafana's display processor applied. */
function trunks(ends: Array<[string, string]>, columns: Column[]): DataFrame {
  const frame = toDataFrame({
    fields: [
      { name: 'a_site', type: FieldType.string, values: ends.map(([a]) => a) },
      { name: 'z_site', type: FieldType.string, values: ends.map(([, z]) => z) },
      ...columns,
    ],
  });
  frame.fields.forEach((field) => (field.display = getDisplayProcessor({ field, theme })));
  return frame;
}

/** The tooltip lines of the pair drawn as feature `featureId`. */
function lines(frame: DataFrame, featureId = 0) {
  const [from, to] = frame.fields;
  const result = joinEdges(
    frame,
    { layerId: 'B', refId: 'B', fromField: from, toField: to },
    SITES,
    frameToFeatureCollection(SITES),
    SITES.fields[0]
  );
  return pairDetails(frame, result, featureId)?.items.map(({ label, value }) => `${label}: ${value}`);
}

const FOUR_TRUNKS: Array<[string, string]> = [
  ['1', '6'],
  ['6', '1'],
  ['1', '6'],
  ['6', '1'],
];

describe('pairDetails', () => {
  it('names the two nodes and counts the links, with nothing else by default', () => {
    expect(
      lines(trunks(FOUR_TRUNKS, [{ name: 'capacity', type: FieldType.number, values: [100, 100, 10, 1] }]))
    ).toEqual(['Between: 1 and 6', 'Links: 4']);
  });

  it("shows a column's chosen aggregates on one line, in a fixed order, formatted with its unit", () => {
    const capacity: Column = {
      name: 'capacity_gbps',
      type: FieldType.number,
      values: [100, 100, 10, 1],
      config: { unit: 'Gbits', custom: { edgeAggregates: ['max', 'sum', 'mean'] } },
    };

    expect(lines(trunks(FOUR_TRUNKS, [capacity]))).toEqual([
      'Between: 1 and 6',
      'Links: 4',
      'capacity_gbps: sum 211 Gb/s · avg 52.8 Gb/s · max 100 Gb/s',
    ]);
  });

  it('skips nulls, and counts only values', () => {
    const latency: Column = {
      name: 'latency',
      type: FieldType.number,
      values: [2, null, 4, undefined],
      config: { custom: { edgeAggregates: ['mean', 'min', 'count'] } },
    };

    expect(lines(trunks(FOUR_TRUNKS, [latency]))?.[2]).toBe('latency: avg 3 · min 2 · count 2');
  });

  it("skips aggregates that don't apply to a column's type", () => {
    const medium: Column = {
      name: 'medium',
      type: FieldType.string,
      values: ['fiber', 'fiber', null, 'microwave'],
      config: { custom: { edgeAggregates: ['sum', 'max', 'count'] } },
    };
    const installed: Column = {
      name: 'installed',
      type: FieldType.time,
      values: [Date.UTC(2020, 0, 1), Date.UTC(2024, 0, 1), Date.UTC(2021, 0, 1), Date.UTC(2022, 0, 1)],
      config: { unit: 'dateTimeAsIso', custom: { edgeAggregates: ['sum', 'mean', 'min', 'max'] } },
    };

    const [, , text, time] = lines(trunks(FOUR_TRUNKS, [medium, installed]))!;
    expect(text).toBe('medium: count 3');
    expect(time).toMatch(/^installed: min 2020-01-01 \S+ · max 2024-01-01 \S+$/);
  });

  it("shows a column's No value text, or a dash, when it has no values", () => {
    const empty: Column = {
      name: 'errors',
      type: FieldType.number,
      values: [null, null, null, null],
      config: { custom: { edgeAggregates: ['sum', 'count'] } },
    };

    expect(lines(trunks(FOUR_TRUNKS, [empty]))?.[2]).toBe('errors: sum — · count 0');
  });

  it('shows a ratio column as the sum of its numerator over the sum of its denominator', () => {
    const columns: Column[] = [
      { name: 'capacity_gbps', type: FieldType.number, values: [100, 100, 10, 1] },
      { name: 'utilization_gbps', type: FieldType.number, values: [62, 71, 9.2, 0.4] },
      {
        name: 'utilization',
        type: FieldType.number,
        values: [0.62, 0.71, 0.92, 0.4],
        config: {
          unit: 'percentunit',
          decimals: 0,
          custom: { ratioNumerator: 'utilization_gbps', ratioDenominator: 'capacity_gbps', edgeAggregates: ['mean'] },
        },
      },
    ];

    // 142.6 of 211, not the rows' average of 66%.
    expect(lines(trunks(FOUR_TRUNKS, columns))?.[2]).toBe('utilization: 68%');
  });

  it('leaves rows without both values out of a ratio, and shows a dash for a zero denominator', () => {
    const ratio = (capacity: unknown[], used: unknown[]) =>
      lines(
        trunks(FOUR_TRUNKS, [
          { name: 'capacity', type: FieldType.number, values: capacity },
          { name: 'used', type: FieldType.number, values: used },
          {
            name: 'share',
            type: FieldType.number,
            values: [0, 0, 0, 0],
            config: { custom: { ratioNumerator: 'used', ratioDenominator: 'capacity' } },
          },
        ])
      )?.[2];

    expect(ratio([10, 10, null, 10], [5, null, 9, 5])).toBe('share: 0.500');
    expect(ratio([0, 0, 0, 0], [1, 1, 1, 1])).toBe('share: —');
  });

  it('leaves out columns hidden from tooltips', () => {
    const hidden: Column = {
      name: 'cost',
      type: FieldType.number,
      values: [1, 2, 3, 4],
      config: { custom: { edgeAggregates: ['sum'], hideInTooltip: true } },
    };

    expect(lines(trunks(FOUR_TRUNKS, [hidden]))).toEqual(['Between: 1 and 6', 'Links: 4']);
  });

  it('has no links, and nothing for a feature that is not a pair', () => {
    const frame = trunks(FOUR_TRUNKS, []);
    const [from, to] = frame.fields;
    const result = joinEdges(
      frame,
      { layerId: 'B', refId: 'B', fromField: from, toField: to },
      SITES,
      frameToFeatureCollection(SITES),
      SITES.fields[0]
    );

    expect(pairDetails(frame, result, 0)?.links).toEqual([]);
    expect(pairDetails(frame, result, 5)).toBeUndefined();
    expect(pairDetails(frame, frameToFeatureCollection(SITES), 0)).toBeUndefined();
  });
});
