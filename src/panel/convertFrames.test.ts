import { DataFrame, FieldType, toDataFrame } from '@grafana/data';
import { convertFrames } from './convertFrames';

const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;

function frame(refId = 'A'): DataFrame {
  return toDataFrame({
    refId,
    fields: [
      { name: 'name', type: FieldType.string, values: ['a', 'b'] },
      { name: 'geometry', type: FieldType.string, values: [point(-78.78), point(-78.77)] },
    ],
  });
}

/** What Grafana does when field config changes: new frame and field objects, same values arrays. */
function withNewConfig(source: DataFrame): DataFrame {
  return {
    ...source,
    fields: source.fields.map((field) => ({ ...field, config: { ...field.config, custom: { lineWidth: 5 } } })),
  };
}

describe('convertFrames', () => {
  it('converts each frame', () => {
    const [result] = convertFrames([frame()]);

    expect(result.refId).toBe('A');
    expect(result.featureCollection.features).toHaveLength(2);
  });

  it('reuses the conversion of a frame with new field config and the same data', () => {
    const original = frame();
    const [first] = convertFrames([original]);
    const [second] = convertFrames([withNewConfig(original)]);

    expect(second).toBe(first);
    expect(second.featureCollection).toBe(first.featureCollection);
  });

  it('converts again when a field has new values', () => {
    const original = frame();
    const [first] = convertFrames([original]);
    const refreshed = withNewConfig(original);
    refreshed.fields[1] = { ...refreshed.fields[1], values: [point(-78.7)] };

    expect(convertFrames([refreshed])[0]).not.toBe(first);
  });

  it('converts again when a field is added, removed or renamed', () => {
    const original = frame();
    const [first] = convertFrames([original]);
    const extra = { name: 'status', type: FieldType.string, config: {}, values: ['x', 'y'] };

    expect(convertFrames([{ ...original, fields: [...original.fields, extra] }])[0]).not.toBe(first);
    expect(convertFrames([{ ...original, fields: original.fields.slice(0, 1) }])[0]).not.toBe(first);
    const renamed = { ...original, fields: [original.fields[0], { ...original.fields[1], name: 'geom' }] };
    expect(convertFrames([renamed])[0]).not.toBe(first);
  });

  it('converts again for a new refId, so each query keeps its own layer id', () => {
    const original = frame('A');
    convertFrames([original]);
    const [moved] = convertFrames([{ ...withNewConfig(original), refId: 'B' }]);

    expect(moved.refId).toBe('B');
  });

  it('gives frames without a refId one from their position', () => {
    const { refId, ...noRefId } = frame();

    expect(convertFrames([frame('A'), noRefId as DataFrame]).map((result) => result.refId)).toEqual(['A', '#1']);
  });

  it('copes with a frame without fields', () => {
    expect(() => convertFrames([{ fields: [], length: 0 }])).not.toThrow();
  });
});
