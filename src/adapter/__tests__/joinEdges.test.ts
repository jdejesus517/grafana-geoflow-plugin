import { DataFrame, Field, FieldType, toDataFrame } from '@grafana/data';
import { frameToFeatureCollection } from '../frameToFeatureCollection';
import { joinEdges } from '../joinEdges';

const point = (lon: number, lat: number) => JSON.stringify({ type: 'Point', coordinates: [lon, lat] });

/** Nodes with integer ids, as a PostgreSQL integer column arrives. */
function nodes(rows: Array<[unknown, string | null]>): DataFrame {
  return toDataFrame({
    refId: 'A',
    fields: [
      { name: 'id', type: FieldType.number, values: rows.map(([id]) => id) },
      { name: 'geometry', type: FieldType.string, values: rows.map(([, geometry]) => geometry) },
    ],
  });
}

/** Edges with text ends, as a PostgreSQL text column arrives. */
function edges(rows: Array<[unknown, unknown]>): DataFrame {
  return toDataFrame({
    refId: 'B',
    fields: [
      { name: 'trunk', type: FieldType.string, values: rows.map((_, i) => `T${i + 1}`) },
      { name: 'a_site', type: FieldType.string, values: rows.map(([from]) => from) },
      { name: 'z_site', type: FieldType.string, values: rows.map(([, to]) => to) },
    ],
  });
}

const SITES = nodes([
  [1, point(-78.78, 35.78)],
  [2, point(-78.77, 35.79)],
  [3, point(-78.76, 35.8)],
]);

function join(edgeFrame: DataFrame, nodeFrame: DataFrame = SITES) {
  const field = (frame: DataFrame, name: string) => frame.fields.find((f) => f.name === name) as Field;
  return joinEdges(
    edgeFrame,
    { layerId: 'B', refId: 'B', fromField: field(edgeFrame, 'a_site'), toField: field(edgeFrame, 'z_site') },
    nodeFrame,
    frameToFeatureCollection(nodeFrame),
    field(nodeFrame, 'id')
  );
}

const lines = (result: ReturnType<typeof join>) =>
  result.featureCollection.features.map(({ geometry }) => (geometry.type === 'LineString' ? geometry.coordinates : []));

describe('joinEdges', () => {
  it('draws one line per pair, whatever the direction or number of rows, matching ids as text', () => {
    const result = join(
      edges([
        ['1', '2'],
        ['2', '1'],
        ['3', '2'],
        ['1', '2'],
      ])
    );

    expect(lines(result)).toEqual([
      [
        [-78.78, 35.78],
        [-78.77, 35.79],
      ],
      [
        [-78.77, 35.79],
        [-78.76, 35.8],
      ],
    ]);
    expect(result.pairs).toEqual([
      { key: '1\u00002', nodes: ['1', '2'], rows: [0, 1, 3] },
      { key: '2\u00003', nodes: ['2', '3'], rows: [2] },
    ]);
    expect(result.featureKeys).toEqual(['1\u00002', '2\u00003']);
    expect(result.featureRows).toEqual([0, 2]);
    expect(result.featureCollection.features.map(({ id }) => id)).toEqual([0, 1]);
    expect(result.bounds).toEqual([-78.78, 35.78, -78.76, 35.8]);
  });

  it("is styled from the from column, and isn't a geometry layer", () => {
    const result = join(edges([['1', '2']]));

    expect(result.styleField).toBe('a_site');
    expect(result.geometryField).toBeUndefined();
    expect(result.rowCount).toBe(1);
  });

  it('matches text and number ids either way round', () => {
    const textNodes = toDataFrame({
      fields: [
        { name: 'id', type: FieldType.string, values: ['1', '2'] },
        { name: 'geometry', type: FieldType.string, values: [point(0, 0), point(1, 1)] },
      ],
    });

    expect(join(edges([[1, 2]]), textNodes).pairs).toHaveLength(1);
  });

  it('counts rows it cannot draw, with a sample of each', () => {
    const result = join(
      edges([
        ['1', '2'],
        ['1', '9'],
        ['2', '2'],
        [null, '2'],
        ['3', ''],
      ])
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.warnings.counts).toMatchObject({ unknownNode: 1, selfLoop: 1, missingEnd: 2 });
    expect(result.warnings.samples).toEqual([
      { row: 1, kind: 'unknownNode', detail: 'no node with id 9' },
      { row: 2, kind: 'selfLoop', detail: 'from and to are both 2' },
      { row: 3, kind: 'missingEnd', detail: 'no node id in a_site' },
      { row: 4, kind: 'missingEnd', detail: 'no node id in z_site' },
    ]);
  });

  it('counts duplicate and non-point nodes against the node rows, keeping the first of an id', () => {
    const nodeFrame = nodes([
      [1, point(0, 0)],
      [1, point(5, 5)],
      [2, JSON.stringify({ type: 'MultiPoint', coordinates: [[1, 1]] })],
      [3, point(2, 2)],
    ]);
    const result = join(
      edges([
        ['1', '3'],
        ['2', '3'],
      ]),
      nodeFrame
    );

    expect(lines(result)).toEqual([
      [
        [0, 0],
        [2, 2],
      ],
    ]);
    expect(result.warnings.counts).toMatchObject({ duplicateId: 1, notAPoint: 1, unknownNode: 1 });
    expect(result.warnings.samples).toEqual([
      { row: 1, kind: 'duplicateId', detail: 'node id 1 is already used by an earlier node' },
      { row: 2, kind: 'notAPoint', detail: 'node 2 is a MultiPoint, not a Point' },
      { row: 1, kind: 'unknownNode', detail: 'node 2 has no point to draw' },
    ]);
  });

  it('says when a node exists but its geometry was skipped', () => {
    const result = join(
      edges([['1', '2']]),
      nodes([
        [1, point(0, 0)],
        [2, null],
      ])
    );

    expect(result.warnings.samples).toEqual([{ row: 0, kind: 'unknownNode', detail: 'node 2 has no point to draw' }]);
  });

  it('draws nothing from an empty edge frame', () => {
    const result = join(edges([]));

    expect(result.featureCollection.features).toEqual([]);
    expect(result.pairs).toEqual([]);
    expect(result.bounds).toBeUndefined();
  });
});
