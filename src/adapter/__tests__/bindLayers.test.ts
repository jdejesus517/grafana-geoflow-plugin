import { DataFrame, FieldType, toDataFrame } from '@grafana/data';
import { BoundLayer, bindLayers, bindPerFrame, networkLayers } from '../bindLayers';

function frame(refId: string | undefined, name?: string, labels?: Record<string, string>): DataFrame {
  return toDataFrame({
    refId,
    name,
    fields: [{ name: 'geometry', type: FieldType.string, values: [], labels }],
  });
}

const summary = (layers: BoundLayer[]) => layers.map(({ id, name, frameIndex }) => [id, name, frameIndex]);

describe('bindPerFrame', () => {
  it('without saved settings, puts later queries on top, as before Phase 7', () => {
    expect(summary(bindPerFrame([frame('A'), frame('B'), frame('C')], []))).toEqual([
      ['C', 'Query C', 2],
      ['B', 'Query B', 1],
      ['A', 'Query A', 0],
    ]);
  });

  it('follows the saved order, with layers that have no settings on top', () => {
    const layers = bindPerFrame([frame('A'), frame('B'), frame('C'), frame('D')], [{ id: 'A' }, { id: 'C' }]);

    expect(layers.map(({ id }) => id)).toEqual(['D', 'B', 'A', 'C']);
  });

  it('names a layer by its typed name, else its frame name, else its query', () => {
    const layers = bindPerFrame(
      [frame('A'), frame('B', 'Cables'), frame('C', 'Splices')],
      [{ id: 'C', name: 'Splice cases' }]
    );

    expect(layers.map(({ id, name }) => [id, name])).toEqual([
      ['B', 'Cables'],
      ['A', 'Query A'],
      ['C', 'Splice cases'],
    ]);
  });

  it('ignores a blank typed name', () => {
    expect(bindPerFrame([frame('A')], [{ id: 'A', name: '  ' }])[0].name).toBe('Query A');
  });

  it('hashes By name colors from a typed name, else the frame name or refId, as in Phase 5', () => {
    const layers = bindPerFrame([frame('A'), frame('B', 'Cables'), frame('C')], [{ id: 'C', name: 'Splices' }]);

    expect(Object.fromEntries(layers.map(({ id, colorName }) => [id, colorName]))).toEqual({
      A: 'A',
      B: 'Cables',
      C: 'Splices',
    });
  });

  it('resolves visibility, tooltips and columns, with defaults for what is not saved', () => {
    const [shown, hidden] = bindPerFrame(
      [frame('A'), frame('B')],
      [{ id: 'A' }, { id: 'B', visible: false, tooltips: false, geometryField: 'centroid', idField: 'key' }]
    );

    expect(shown).toEqual({
      id: 'A',
      name: 'Query A',
      colorName: 'A',
      visible: true,
      tooltips: true,
      role: 'geometry',
      config: { id: 'A' },
      frameIndex: 0,
      refId: 'A',
    });
    expect(hidden).toMatchObject({ visible: false, tooltips: false, geometryField: 'centroid', idField: 'key' });
  });

  it('keeps saved settings whose frame is gone, in their place, without a frame', () => {
    const layers = bindPerFrame([frame('A')], [{ id: 'Z', name: 'Old' }, { id: 'A' }]);

    expect(summary(layers)).toEqual([
      ['Z', 'Old', undefined],
      ['A', 'Query A', 0],
    ]);
    expect(layers[0]).not.toHaveProperty('refId');
  });

  it('keeps the first of duplicate saved settings', () => {
    expect(
      bindPerFrame(
        [frame('A')],
        [
          { id: 'A', name: 'One' },
          { id: 'A', name: 'Two' },
        ]
      )
    ).toHaveLength(1);
    expect(
      bindPerFrame(
        [frame('A')],
        [
          { id: 'A', name: 'One' },
          { id: 'A', name: 'Two' },
        ]
      )[0].name
    ).toBe('One');
  });

  describe('several frames from one query', () => {
    it('gives each frame its own id and name, from the frame name', () => {
      expect(summary(bindPerFrame([frame('A', 'aerial'), frame('A', 'underground'), frame('B')], []))).toEqual([
        ['B', 'Query B', 2],
        ['A:underground', 'underground', 1],
        ['A:aerial', 'aerial', 0],
      ]);
    });

    it('uses labels for frames without a name, as Partition by values gives them', () => {
      const layers = bindPerFrame(
        [
          frame('A-undefined', undefined, { placement: 'aerial' }),
          frame('A-undefined', undefined, { placement: 'mixed' }),
        ],
        []
      );

      expect(summary(layers)).toEqual([
        ['A-undefined:placement=mixed', 'placement=mixed', 1],
        ['A-undefined:placement=aerial', 'placement=aerial', 0],
      ]);
    });

    it('falls back to the position for frames without a name or labels, or with the same one', () => {
      const layers = bindPerFrame([frame('A'), frame('A', 'x'), frame('A', 'x'), frame('A', 'y')], []);

      expect(summary(layers).reverse()).toEqual([
        ['A:#1', 'Query A (1)', 0],
        ['A:#2', 'Query A (2)', 1],
        ['A:#3', 'Query A (3)', 2],
        ['A:y', 'y', 3],
      ]);
    });

    it('keeps the refId for a single frame, even when it has labels', () => {
      expect(summary(bindPerFrame([frame('A', undefined, { placement: 'aerial' })], []))).toEqual([
        ['A', 'placement=aerial', 0],
      ]);
    });
  });

  it('gives frames without a refId one from their position', () => {
    expect(bindPerFrame([frame('A'), frame(undefined)], []).map(({ id }) => id)).toEqual(['#1', 'A']);
  });
});

describe('bindLayers', () => {
  it('binds per frame, the only mode, also when the option is missing', () => {
    const frames = [frame('A'), frame('B')];
    const expected = bindPerFrame(frames, [{ id: 'A' }]);

    expect(bindLayers(frames, [{ id: 'A' }], { mode: 'perFrame' })).toEqual(expected);
    expect(bindLayers(frames, [{ id: 'A' }], undefined)).toEqual(expected);
    expect(bindLayers(frames, undefined, undefined)).toEqual(bindPerFrame(frames, []));
  });
});

describe('layer roles', () => {
  it('makes a layer without a role, or with an unknown one, a geometry layer', () => {
    const layers = bindPerFrame(
      [frame('A'), frame('B'), frame('C')],
      [{ id: 'A' }, { id: 'B', role: 'nodes' }, { id: 'C', role: 'other' as never }]
    );

    expect(Object.fromEntries(layers.map(({ id, role }) => [id, role]))).toEqual({
      A: 'geometry',
      B: 'nodes',
      C: 'geometry',
    });
  });

  it("keeps an edge layer's from and to columns, ignoring empty ones", () => {
    const [named, empty] = bindPerFrame(
      [frame('A'), frame('B')],
      [
        { id: 'A', role: 'edges', fromField: 'a_site', toField: 'z_site' },
        { id: 'B', role: 'edges', fromField: ' ', toField: '' },
      ]
    );

    expect([named.fromField, named.toField]).toEqual(['a_site', 'z_site']);
    expect(empty).not.toHaveProperty('fromField');
    expect(empty).not.toHaveProperty('toField');
  });
});

describe('networkLayers', () => {
  it('picks the first Nodes and Edges layers in the Layers list, top first', () => {
    const layers = bindPerFrame(
      [frame('A'), frame('B'), frame('C'), frame('D')],
      [
        { id: 'C', role: 'edges' },
        { id: 'A', role: 'nodes' },
        { id: 'B', role: 'nodes' },
        { id: 'D', role: 'edges' },
      ]
    );
    const network = networkLayers(layers);

    expect(network.nodes?.id).toBe('A');
    expect(network.edges?.id).toBe('C');
    expect(network.extras.map(({ id }) => id)).toEqual(['B', 'D']);
    expect(network.split).toEqual([]);
  });

  it('has no network without network roles', () => {
    expect(networkLayers(bindPerFrame([frame('A')], []))).toEqual({ extras: [], split: [] });
  });

  it('reports a network role whose query Partition by values split into several frames', () => {
    const layers = bindPerFrame(
      [
        frame('A'),
        frame('B-undefined', undefined, { kind: 'fiber' }),
        frame('B-undefined', undefined, { kind: 'radio' }),
      ],
      [
        { id: 'A', role: 'nodes' },
        { id: 'B', role: 'edges' },
      ]
    );
    const network = networkLayers(layers);

    expect(network.edges).toBeUndefined();
    expect(network.split.map(({ id }) => id)).toEqual(['B']);
  });

  it("doesn't report settings whose query is simply gone", () => {
    const layers = bindPerFrame([frame('A')], [{ id: 'B', role: 'edges' }]);

    expect(networkLayers(layers).split).toEqual([]);
  });
});
