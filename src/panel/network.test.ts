import { DataFrame, FieldType, createTheme, toDataFrame } from '@grafana/data';
import { LayerConfig, bindPerFrame, buildLayerSpecs } from '../adapter';
import { conversionSummary, firstWarning } from './conversionSummary';
import { ConversionHistory, convertFrames } from './convertFrames';
import { networkProblems, panelProblems } from './panelProblems';

// A network as docs/node-edge/phase_1.md, Design §7 sets one up: integer site ids and text
// trunk ends, from separate queries.
const point = (lon: number, lat: number) => `{"type":"Point","coordinates":[${lon},${lat}]}`;

function sites(refId = 'A', lons = [-78.78, -78.77, -78.76]): DataFrame {
  return toDataFrame({
    refId,
    fields: [
      { name: 'id', type: FieldType.number, values: [1, 2, 3] },
      { name: 'geometry', type: FieldType.string, values: lons.map((lon) => point(lon, 35.78)) },
    ],
  });
}

function trunks(
  refId = 'B',
  ends: Array<[string, string]> = [
    ['1', '2'],
    ['2', '1'],
    ['2', '3'],
  ]
): DataFrame {
  return toDataFrame({
    refId,
    fields: [
      { name: 'trunk_id', type: FieldType.string, values: ends.map((_, i) => `T${i + 1}`) },
      { name: 'a_site', type: FieldType.string, values: ends.map(([a]) => a) },
      { name: 'z_site', type: FieldType.string, values: ends.map(([, z]) => z) },
    ],
  });
}

const NETWORK: LayerConfig[] = [
  { id: 'B', role: 'edges' },
  { id: 'A', role: 'nodes' },
];

function convert(frames: DataFrame[], configs: LayerConfig[] = NETWORK, history?: ConversionHistory) {
  const layers = bindPerFrame(frames, configs);
  return { layers, results: convertFrames(frames, layers, history) };
}

/** What a refresh does: new values arrays with the same content, the old ones emptied. */
function refresh(source: DataFrame): DataFrame {
  const fields = source.fields.map((field) => ({ ...field, values: JSON.parse(JSON.stringify(field.values)) }));
  source.fields.forEach((field) => (field.values.length = 0));
  return { ...source, fields };
}

describe('convertFrames with a network', () => {
  it("joins the edge layer to the node layer's result, keeping results in frame order", () => {
    const { results } = convert([sites(), trunks()]);

    expect(results.map(({ layerId }) => layerId)).toEqual(['A', 'B']);
    expect(results[0].featureCollection.features).toHaveLength(3);
    expect(results[1].pairs?.map(({ nodes, rows }) => [nodes, rows])).toEqual([
      [
        ['1', '2'],
        [0, 1],
      ],
      [['2', '3'], [2]],
    ]);
    expect(results[1].noGeometry).toBeUndefined();
  });

  it("uses named from and to columns, and the node layer's ID column", () => {
    const nodes = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'site', type: FieldType.string, values: ['x', 'y'] },
        { name: 'geometry', type: FieldType.string, values: [point(0, 0), point(1, 1)] },
      ],
    });
    const edges = toDataFrame({
      refId: 'B',
      fields: [
        { name: 'p', type: FieldType.string, values: ['x'] },
        { name: 'q', type: FieldType.string, values: ['y'] },
      ],
    });
    const { results } = convert(
      [nodes, edges],
      [
        { id: 'B', role: 'edges', fromField: 'p', toField: 'q' },
        { id: 'A', role: 'nodes', idField: 'site' },
      ]
    );

    expect(results[1].pairs).toHaveLength(1);
    expect(results[1].edgeFields).toEqual({ from: 'p', to: 'q' });
  });

  it('draws nothing for an edge layer without a node layer, or without from and to columns', () => {
    const noNodes = convert([sites(), trunks()], [{ id: 'B', role: 'edges' }]).results[1];
    const noColumns = convert([sites(), trunks()], [...NETWORK.slice(1), { id: 'B', role: 'edges', fromField: 'x' }])
      .results[1];

    for (const result of [noNodes, noColumns]) {
      expect(result.featureCollection.features).toEqual([]);
      expect(result.pairs).toEqual([]);
      expect(result.noGeometry).toBeUndefined();
    }
  });

  it('draws extra Nodes layers as points and extra Edges layers as nothing', () => {
    const { results } = convert(
      [sites(), trunks(), sites('C'), trunks('D')],
      [...NETWORK, { id: 'C', role: 'nodes' }, { id: 'D', role: 'edges' }]
    );

    expect(results[2].featureCollection.features).toHaveLength(3);
    expect(results[3].featureCollection.features).toEqual([]);
  });

  it('reuses the edge result for a field config change and for a refresh with the same data', () => {
    const history: ConversionHistory = new Map();
    const frames = [sites(), trunks()];
    const first = convert(frames, NETWORK, history).results[1];
    const restyled = convert(
      frames.map((frame) => ({ ...frame, fields: frame.fields.map((field) => ({ ...field })) })),
      NETWORK,
      history
    ).results[1];
    const refreshed = convert(frames.map(refresh), NETWORK, history).results[1];

    expect(restyled).toBe(first);
    expect(refreshed).toBe(first);
  });

  it('rebuilds the edges when nodes move, even with the same edge data', () => {
    const history: ConversionHistory = new Map();
    const edges = trunks();
    const first = convert([sites(), edges], NETWORK, history).results[1];
    const moved = convert([sites('A', [0, 1, 2]), edges], NETWORK, history).results[1];

    expect(moved).not.toBe(first);
    expect(moved.featureCollection.features[0].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 35.78],
        [1, 35.78],
      ],
    });
  });

  it('converts a layer again when its role changes', () => {
    const frames = [sites(), trunks()];
    const asEdges = convert(frames).results[1];
    const asGeometry = convert(frames, [{ id: 'B' }, { id: 'A', role: 'nodes' }]).results[1];

    expect(asEdges.pairs).toBeDefined();
    expect(asGeometry.pairs).toBeUndefined();
    expect(asGeometry.noGeometry).toBeDefined();
  });
});

describe('buildLayerSpecs with a network', () => {
  it('draws edges in the Layers list order, from Map style on the from column, not interactive', () => {
    const frames = [sites(), trunks()];
    frames[1].fields[1].config = { custom: { lineWidth: 6 } };
    const { layers, results } = convert(frames);
    const specs = buildLayerSpecs(layers, results, frames, createTheme());

    expect(specs.map(({ id }) => id)).toEqual(['A', 'B']);
    expect(specs[1]).toMatchObject({ interactive: false, style: { lineWidth: 6 } });
    expect(specs[1].featureStyles).toBeUndefined();
    expect(specs[0].interactive).toBe(true);
  });

  it('ignores Color by and Size by on edges, and says so', () => {
    const frames = [sites(), trunks()];
    frames[1].fields[1].config = { custom: { colorBy: 'trunk_id' } };
    const { layers, results } = convert(frames);

    expect(buildLayerSpecs(layers, results, frames, createTheme())[1].featureStyles).toBeUndefined();
    expect(panelProblems(results, layers, frames)).toContainEqual({
      layerName: 'Query B',
      text: 'Color by and Size by on edges come in a later version',
    });
  });
});

describe('network warnings', () => {
  it("counts edge rows that can't be drawn, and labels node rows as such", () => {
    const nodes = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'id', type: FieldType.number, values: [1, 1, 2] },
        { name: 'geometry', type: FieldType.string, values: [point(0, 0), point(1, 1), point(2, 2)] },
      ],
    });
    const frames = [
      nodes,
      trunks('B', [
        ['1', '2'],
        ['2', '9'],
        ['2', '2'],
      ]),
    ];
    const { layers, results } = convert(frames);

    expect(panelProblems(results, layers, frames)).toEqual([
      {
        layerName: 'Query B',
        text: '3 rows skipped: unknown node 1, self-loop 1, duplicate node id 1',
        // Node rows are checked first, so the first sample is the duplicate node.
        detail: 'Nodes row 2: node id 1 is already used by an earlier node',
      },
    ]);
    expect(firstWarning(results[1])).toBe('nodes row 2: node id 1 is already used by an earlier node');
    expect(results[1].warnings.samples.map(({ kind, row }) => [kind, row])).toEqual([
      ['duplicateId', 1],
      ['unknownNode', 1],
      ['selfLoop', 2],
    ]);
  });

  it('finds nothing wrong with a good network', () => {
    const frames = [sites(), trunks()];
    const { layers, results } = convert(frames);

    expect(panelProblems(results, layers, frames)).toEqual([]);
  });

  it('reports what stops the network from drawing', () => {
    const report = (frames: DataFrame[], configs: LayerConfig[]) => {
      const { layers, results } = convert(frames, configs);
      return networkProblems(layers, frames, results).map(({ layerName, text }) => `${layerName}: ${text}`);
    };
    const noIds = toDataFrame({
      refId: 'A',
      fields: [{ name: 'geometry', type: FieldType.string, values: [point(0, 0)] }],
    });

    expect(report([sites(), trunks()], [{ id: 'B', role: 'edges' }])).toEqual([
      'Query B: No Nodes layer: edges join the points of a Nodes layer',
    ]);
    expect(report([sites(), trunks()], [{ id: 'B', role: 'edges', toField: 'gone' }, NETWORK[1]])).toEqual([
      'Query B: To column: no column named gone',
    ]);
    expect(report([noIds, trunks()], NETWORK)).toEqual([
      'Query A: No id column: edges find nodes by an id column, named id unless chosen',
    ]);
    expect(report([trunks('A'), trunks()], NETWORK)).toEqual([
      'Query A: No geometry column: nodes need points for edges to join',
    ]);
    expect(
      report(
        [sites(), trunks(), sites('C'), trunks('D')],
        [...NETWORK, { id: 'C', role: 'nodes' }, { id: 'D', role: 'edges' }]
      )
    ).toEqual([
      'Query C: Not part of the network, which uses Query A',
      'Query D: Not part of the network, which uses Query B',
    ]);
    expect(report([sites(), trunks('B-undefined'), trunks('B-undefined')], NETWORK)).toEqual([
      // Settings without a frame are named by their id.
      'B: Query B returns several frames; an Edges layer needs one',
    ]);
  });
});

describe('conversionSummary for edges', () => {
  it('counts pairs and names the columns joining them', () => {
    const { results } = convert([sites(), trunks()]);

    expect(conversionSummary(results[1])).toBe('B: 3 rows → 2 pairs (a_site → z_site)');
  });

  it("counts no pairs when the edges can't be joined", () => {
    const { results } = convert([sites(), trunks()], [{ id: 'B', role: 'edges' }]);

    expect(conversionSummary(results[1])).toBe('B: 3 rows → 0 pairs');
  });
});
