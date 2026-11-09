import { DataFrame, FieldType, createTheme, getDisplayProcessor, toDataFrame } from '@grafana/data';
import { frameToFeatureCollection } from '../frameToFeatureCollection';
import { joinEdges } from '../joinEdges';
import { pairRows } from '../pairRows';

const theme = createTheme();
const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;
const SITES = toDataFrame({
  fields: [
    { name: 'id', type: FieldType.number, values: [1, 6, 7] },
    { name: 'geometry', type: FieldType.string, values: [point(0), point(1), point(2)] },
  ],
});

function trunks(): DataFrame {
  const frame = toDataFrame({
    fields: [
      { name: 'trunk_id', type: FieldType.string, values: ['T1', 'T2', 'T3', 'T4'] },
      { name: 'a_site', type: FieldType.string, values: ['1', '6', '6', '1'] },
      { name: 'z_site', type: FieldType.string, values: ['6', '1', '7', '6'] },
      { name: 'capacity', type: FieldType.number, values: [100, 10, 40, null], config: { unit: 'Gbits' } },
      {
        name: 'secret',
        type: FieldType.string,
        values: ['a', 'b', 'c', 'd'],
        config: { custom: { hideInTooltip: true } },
      },
    ],
  });
  frame.fields.forEach((field) => (field.display = getDisplayProcessor({ field, theme })));
  return frame;
}

function rows(showDirection = true, featureId = 0) {
  const frame = trunks();
  const [, from, to] = frame.fields;
  const result = joinEdges(
    frame,
    { layerId: 'B', refId: 'B', fromField: from, toField: to },
    SITES,
    frameToFeatureCollection(SITES),
    SITES.fields[0]
  );
  return pairRows(frame, result, featureId, { showDirection });
}

describe('pairRows', () => {
  it("lists the pair's rows in query order, each with its own direction, then the shown columns", () => {
    const table = rows()!;

    expect(table.columns.map(({ label }) => label)).toEqual(['Direction', 'trunk_id', 'a_site', 'z_site', 'capacity']);
    expect(table.rows.map(({ row, cells }) => [row, ...cells])).toEqual([
      [0, '1 → 6', 'T1', '1', '6', '100 Gb/s'],
      [1, '6 → 1', 'T2', '6', '1', '10 Gb/s'],
      [3, '1 → 6', 'T4', '1', '6', '—'],
    ]);
  });

  it('sorts by raw values, and the direction by its text', () => {
    expect(rows()!.rows[0].values).toEqual(['1 → 6', 'T1', '1', '6', 100]);
  });

  it('leaves out the direction column when Show direction is off', () => {
    const table = rows(false)!;

    expect(table.columns[0].label).toBe('trunk_id');
    expect(table.rows[0].cells[0]).toBe('T1');
  });

  it('is undefined for a feature that is not a pair', () => {
    expect(rows(true, 9)).toBeUndefined();
  });
});
