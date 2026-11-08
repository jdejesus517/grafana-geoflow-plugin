import { FieldType, toDataFrame } from '@grafana/data';
import { ConversionResult, LayerConfig, bindPerFrame, frameToFeatureCollection } from '../adapter';
import { MANY_FEATURES, MANY_LAYERS, panelProblems } from './panelProblems';

const point = '{"type":"Point","coordinates":[-78.78,35.78]}';

function layer(refId: string, geometry: unknown[], extra: Array<{ name: string; values: unknown[] }> = []) {
  return toDataFrame({
    refId,
    fields: [
      { name: 'geometry', type: FieldType.string, values: geometry },
      ...extra.map((field) => ({ ...field, type: FieldType.string })),
    ],
  });
}

function problems(frames: Array<ReturnType<typeof layer>>, configs: LayerConfig[] = []) {
  const layers = bindPerFrame(frames, configs);
  const results = frames.map((frame, i) => {
    const bound = layers.find(({ frameIndex }) => frameIndex === i);
    return frameToFeatureCollection(frame, { geometryField: bound?.geometryField }, bound?.id);
  });
  return panelProblems(results, layers, frames);
}

describe('panelProblems', () => {
  it('finds nothing wrong with good rows', () => {
    expect(problems([layer('A', [point, point])])).toEqual([]);
  });

  it('counts skipped rows by kind, with why the first was skipped, under the layer name', () => {
    const frames = [layer('A', [point, 'not json', '{"type":"Point","coordinates":[-200,35]}', 'nope'])];

    expect(problems(frames, [{ id: 'A', name: 'Assets' }])).toEqual([
      {
        layerName: 'Assets',
        text: '3 rows skipped: invalid 2, out of range 1',
        detail: expect.stringMatching(/^Row 2: not GeoJSON/),
      },
    ]);
  });

  it('says row for one row', () => {
    expect(problems([layer('A', [point, 'not json'])])[0].text).toBe('1 row skipped: invalid 1');
  });

  it('leaves out empty geometry, which is usually intended', () => {
    expect(problems([layer('A', [point, null, ''])])).toEqual([]);
  });

  it('skips empty rows in the detail too', () => {
    expect(problems([layer('A', [null, point, 'not json'])])[0].detail).toMatch(/^Row 3:/);
  });

  it('reports a missing ID column', () => {
    expect(problems([layer('A', [point])], [{ id: 'A', idField: 'key' }])).toEqual([
      { layerName: 'Query A', text: 'ID column: no column named key' },
    ]);
  });

  it('reports a named geometry column that has gone, but not a query without geometry', () => {
    const noGeometry = toDataFrame({ refId: 'B', fields: [{ name: 'n', type: FieldType.string, values: ['a'] }] });

    expect(problems([layer('A', [point]), noGeometry], [{ id: 'A', geometryField: 'footprint' }])).toEqual([
      { layerName: 'Query A', text: 'No column named "footprint"' },
    ]);
  });

  it('warns about more features than the design allows, for the whole panel', () => {
    const features = new Array(MANY_FEATURES / 2 + 1).fill({ type: 'Feature' });
    const result = { layerId: 'A', warnings: { counts: {}, samples: [] }, featureCollection: { features } };
    const results = [result, { ...result, layerId: 'B' }] as unknown as ConversionResult[];
    const frame = layer('A', []);

    expect(panelProblems(results, [], [frame, frame])).toEqual([
      expect.objectContaining({ text: '100,002 features may draw slowly' }),
    ]);
  });

  describe('many layers', () => {
    const frames = (count: number) => Array.from({ length: count }, (_, i) => layer(`L${i}`, [point]));

    it('warns over the limit, for the whole panel', () => {
      expect(problems(frames(MANY_LAYERS + 1))).toEqual([
        {
          text: '51 layers may draw slowly',
          detail: expect.stringContaining('Partition by values'),
        },
      ]);
    });

    it('does not warn at the limit', () => {
      expect(problems(frames(MANY_LAYERS))).toEqual([]);
    });

    it('counts hidden layers, which keep their sources', () => {
      const hidden = frames(MANY_LAYERS + 1);
      const configs = hidden.map(({ refId }) => ({ id: refId!, visible: false }));

      expect(problems(hidden, configs)).toEqual([expect.objectContaining({ text: '51 layers may draw slowly' })]);
    });

    it("doesn't count queries without geometry, or saved settings whose query is gone", () => {
      const noGeometry = toDataFrame({ refId: 'X', fields: [{ name: 'n', type: FieldType.string, values: ['a'] }] });
      const configs = [{ id: 'gone' }, { id: 'also gone' }];

      expect(problems([...frames(MANY_LAYERS), noGeometry], configs)).toEqual([]);
    });
  });

  it('does not warn at the feature limit', () => {
    const features = new Array(MANY_FEATURES).fill({ type: 'Feature' });
    const result = { layerId: 'A', warnings: { counts: {}, samples: [] }, featureCollection: { features } };

    expect(panelProblems([result as unknown as ConversionResult], [], [layer('A', [])])).toEqual([]);
  });
});
