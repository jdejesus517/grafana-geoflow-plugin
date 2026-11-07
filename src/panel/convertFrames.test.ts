import { DataFrame, FieldType, toDataFrame } from '@grafana/data';
import { bindPerFrame } from '../adapter';
import { ConversionHistory, convertFrames } from './convertFrames';

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

/**
 * What a refresh does: new frame and field objects, and new values arrays with the same content.
 * Grafana then empties the old arrays (docs/phase_8.md, step 8.1).
 */
function refresh(source: DataFrame): DataFrame {
  const fields = source.fields.map((field) => ({ ...field, values: JSON.parse(JSON.stringify(field.values)) }));
  source.fields.forEach((field) => (field.values.length = 0));
  return { ...source, fields };
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

  it("converts each frame for its layer: the layer's id, geometry column and id column", () => {
    const source = toDataFrame({
      refId: 'A',
      name: 'aerial',
      fields: [
        { name: 'key', type: FieldType.number, values: [7] },
        { name: 'footprint', type: FieldType.string, values: [point(-78.78)] },
        { name: 'centroid', type: FieldType.string, values: [point(-78.77)] },
      ],
    });
    const frames = [source, { ...source, name: 'underground' }];
    const [result] = convertFrames(
      frames,
      bindPerFrame(frames, [{ id: 'A:aerial', geometryField: 'centroid', idField: 'key' }])
    );

    expect(result).toMatchObject({ layerId: 'A:aerial', refId: 'A', geometryField: 'centroid' });
    expect(result.featureCollection.features[0].id).toBe(7);
  });

  it('reuses the conversion when only the name, order or visibility change', () => {
    const frames = [frame('A'), frame('B')];
    const [first] = convertFrames(frames, bindPerFrame(frames, []));
    const configs = [{ id: 'B' }, { id: 'A', name: 'Buildings', visible: false }];

    expect(convertFrames(frames, bindPerFrame(frames, configs))[0]).toBe(first);
  });

  it('converts again when the geometry or id column changes, and reports a missing one', () => {
    const frames = [frame('A')];
    const [first] = convertFrames(frames, bindPerFrame(frames, []));
    const [named] = convertFrames(frames, bindPerFrame(frames, [{ id: 'A', geometryField: 'geometry' }]));
    const [missing] = convertFrames(frames, bindPerFrame(frames, [{ id: 'A', geometryField: 'footprint' }]));

    expect(named).not.toBe(first);
    expect(named.featureCollection.features).toHaveLength(2);
    expect(convertFrames(frames, bindPerFrame(frames, [{ id: 'A', idField: 'name' }]))[0]).not.toBe(named);
    expect(missing.noGeometry).toEqual({ reason: 'fieldNotFound', detail: 'No column named "footprint"' });
  });

  describe('with a history', () => {
    it('reuses the conversion of a refresh with the same data, after Grafana empties the old arrays', () => {
      const history: ConversionHistory = new Map();
      const [first] = convertFrames([frame()], [], history);
      const [second] = convertFrames([refresh(frame())], [], history);
      const original = frame();
      convertFrames([original], [], history);

      expect(second).toBe(first);
      expect(convertFrames([refresh(original)], [], history)[0]).toBe(first);
    });

    it('converts again when a value, a type, a field name or the row count changes', () => {
      const history: ConversionHistory = new Map();
      const [first] = convertFrames([frame()], [], history);
      const changed = (change: (source: DataFrame) => void) => {
        const source = refresh(frame());
        change(source);
        const [result] = convertFrames([source], [], history);
        // Back to the original data for the next change.
        convertFrames([frame()], [], history);
        return result;
      };

      expect(changed((source) => (source.fields[0].values[1] = 'c'))).not.toBe(first);
      expect(changed((source) => (source.fields[0] = { ...source.fields[0], type: FieldType.other }))).not.toBe(first);
      expect(changed((source) => (source.fields[0] = { ...source.fields[0], name: 'label' }))).not.toBe(first);
      expect(changed((source) => source.fields.forEach((field) => field.values.pop()))).not.toBe(first);
    });

    it('compares objects by identity, so parsed JSON in new objects converts again', () => {
      const geometry = (lon: number) => ({ type: 'Point', coordinates: [lon, 35.78] });
      const source = () =>
        toDataFrame({ refId: 'A', fields: [{ name: 'geometry', type: FieldType.other, values: [geometry(-78.78)] }] });
      const history: ConversionHistory = new Map();
      const [first] = convertFrames([source()], [], history);

      expect(convertFrames([source()], [], history)[0]).not.toBe(first);
    });

    it("keeps each layer's last conversion apart, and drops layers that are gone", () => {
      const history: ConversionHistory = new Map();
      const [a, b] = convertFrames([frame('A'), frame('B')], [], history);
      const [b2] = convertFrames([refresh(frame('B'))], [], history);

      expect(b2).toBe(b);
      expect([...history.keys()]).toEqual(['B']);
      expect(convertFrames([refresh(frame('A'))], [], history)[0]).not.toBe(a);
    });

    it('converts again when the layer gets another geometry column', () => {
      const history: ConversionHistory = new Map();
      const frames = [frame('A')];
      const [first] = convertFrames(frames, bindPerFrame(frames, []), history);
      const refreshed = [refresh(frame('A'))];

      expect(
        convertFrames(refreshed, bindPerFrame(refreshed, [{ id: 'A', geometryField: 'name' }]), history)[0]
      ).not.toBe(first);
    });
  });

  it('copes with a frame without fields', () => {
    expect(() => convertFrames([{ fields: [], length: 0 }])).not.toThrow();
  });
});
