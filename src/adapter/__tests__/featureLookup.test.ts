import { FieldType, toDataFrame } from '@grafana/data';
import { featureByKey, featureKey, featureRow } from '../featureLookup';
import { frameToFeatureCollection } from '../frameToFeatureCollection';

const point = '{"type":"Point","coordinates":[-78.78,35.78]}';

function convert(ids: unknown[], geometries: Array<string | null> = ids.map(() => point)) {
  return frameToFeatureCollection(
    toDataFrame({
      fields: [
        { name: 'id', type: typeof ids[0] === 'string' ? FieldType.string : FieldType.number, values: ids },
        { name: 'geometry', type: FieldType.string, values: geometries },
      ],
    })
  );
}

describe('feature ids, rows and keys', () => {
  describe('MapLibre ids', () => {
    it('uses the id column when its values are unique, non-negative whole numbers', () => {
      const result = convert([10, 0, Number.MAX_SAFE_INTEGER]);

      expect(result.featureCollection.features.map((f) => f.id)).toEqual([10, 0, Number.MAX_SAFE_INTEGER]);
    });

    // MapLibre reads negative ids back as unsigned 64-bit numbers and cuts decimals, so 7.2 and
    // 7.7 collide (docs/phase_4.md, step 4.1 findings).
    it.each([
      ['a negative id', [1, -3]],
      ['a decimal id', [1, 7.2]],
      ['an id above the safe integer range', [1, 2 ** 53]],
    ])('falls back to row indexes for %s, keeping the values as keys', (_, ids) => {
      const result = convert(ids);

      expect(result.featureCollection.features.map((f) => f.id)).toEqual([0, 1]);
      expect(result.keyField).toBe('id');
      expect(result.featureKeys).toEqual(ids);
    });
  });

  describe('keys', () => {
    it('takes keys from a numeric or a text id column', () => {
      expect(convert([3, 1]).featureKeys).toEqual([3, 1]);
      expect(convert(['building:1', 'building:2']).featureKeys).toEqual(['building:1', 'building:2']);
    });

    it.each([
      ['repeat', [1, 1]],
      ['are missing', [1, null]],
      ['are empty strings', ['a', '']],
    ])('has no keys when values %s', (_, ids) => {
      const result = convert(ids);

      expect(result.keyField).toBeUndefined();
      expect(result.featureKeys).toBeUndefined();
    });

    it('has no keys without an id column', () => {
      const result = frameToFeatureCollection(
        toDataFrame({ fields: [{ name: 'geometry', type: FieldType.string, values: [point] }] })
      );

      expect(result.keyField).toBeUndefined();
    });

    it('only needs keys on the rows that became features', () => {
      const result = convert(['a', null, 'b'], [point, null, point]);

      expect(result.featureKeys).toEqual(['a', 'b']);
    });
  });

  describe('lookups', () => {
    const result = convert(['a', 'skipped', 'c'], [point, '{bad', point]);

    it('records the frame row of each feature', () => {
      expect(result.featureRows).toEqual([0, 2]);
      // Text ids, so MapLibre ids are row indexes.
      expect(featureRow(result, 2)).toBe(2);
      expect(featureRow(result, 1)).toBeUndefined();
    });

    it('goes between MapLibre ids and keys', () => {
      expect(featureKey(result, 2)).toBe('c');
      expect(featureByKey(result, 'c')).toEqual({ featureId: 2, row: 2 });
      expect(featureByKey(result, 'skipped')).toBeUndefined();
    });

    it('finds a feature by key in a newer result whose rows moved', () => {
      const newer = convert(['new', 'c', 'a']);

      expect(featureByKey(newer, 'c')).toEqual({ featureId: 1, row: 1 });
    });

    it('finds nothing by key in a result without keys', () => {
      expect(featureByKey(convert([1, 1]), 1)).toBeUndefined();
    });
  });
});
