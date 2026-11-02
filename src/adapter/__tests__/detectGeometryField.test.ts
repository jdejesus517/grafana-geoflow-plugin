import { FieldType, toDataFrame } from '@grafana/data';
import { loadFixture } from '../__fixtures__';
import { detectGeometryField } from '../detectGeometryField';

const point = '{"type":"Point","coordinates":[-78.786,35.788]}';

describe('detectGeometryField', () => {
  describe('captured frames', () => {
    it.each([
      ['buildings', 'geometry'],
      ['fiber_cables', 'geometry'],
      ['network_assets', 'geometry'],
      ['stateplane', 'geometry'],
      ['patch_panels_jsonb', 'geom'],
      ['edge_cases', 'geom'],
      ['splice_cases_feature', 'feature'],
    ] as const)('%s → %s', (fixture, expected) => {
      const result = detectGeometryField(loadFixture(fixture));

      expect(result).toMatchObject({ found: true, field: { name: expected } });
    });

    it('reports binary geometry with the ST_AsGeoJSON fix', () => {
      expect(detectGeometryField(loadFixture('raw_wkb'))).toEqual({
        found: false,
        reason: 'wkbDetected',
        detail: 'Column "geom" holds binary geometry; select ST_AsGeoJSON(geom) instead',
      });
    });

    it('reports a frame without geometry', () => {
      expect(detectGeometryField(loadFixture('no_geometry'))).toMatchObject({ found: false, reason: 'none' });
    });
  });

  describe('explicit name', () => {
    it('uses the named field even when another has a conventional name', () => {
      const frame = toDataFrame({
        fields: [
          { name: 'geometry', type: FieldType.string, values: [point] },
          { name: 'site_location', type: FieldType.string, values: [point] },
        ],
      });

      expect(detectGeometryField(frame, 'site_location')).toMatchObject({ found: true, index: 1 });
    });

    it('reports a missing name instead of falling back', () => {
      const frame = toDataFrame({ fields: [{ name: 'geometry', type: FieldType.string, values: [point] }] });

      expect(detectGeometryField(frame, 'location')).toEqual({
        found: false,
        reason: 'fieldNotFound',
        detail: 'No column named "location"',
      });
    });
  });

  describe('conventional names', () => {
    it('matches case-insensitively and in priority order', () => {
      const frame = toDataFrame({
        fields: [
          { name: 'SHAPE', type: FieldType.string, values: [point] },
          { name: 'Geom', type: FieldType.string, values: [point] },
        ],
      });

      expect(detectGeometryField(frame)).toMatchObject({ found: true, field: { name: 'Geom' } });
    });

    it('accepts an all-null geometry column', () => {
      const frame = toDataFrame({ fields: [{ name: 'geometry', type: FieldType.string, values: [null, null] }] });

      expect(detectGeometryField(frame)).toMatchObject({ found: true, index: 0 });
    });

    it('skips a conventionally named column whose content is not GeoJSON', () => {
      const frame = toDataFrame({
        fields: [
          { name: 'shape', type: FieldType.string, values: ['round'] },
          { name: 'location', type: FieldType.string, values: [point] },
        ],
      });

      expect(detectGeometryField(frame)).toMatchObject({ found: true, field: { name: 'location' } });
    });

    it('ignores a conventionally named column of a non-text type', () => {
      const frame = toDataFrame({ fields: [{ name: 'geometry', type: FieldType.number, values: [1] }] });

      expect(detectGeometryField(frame)).toMatchObject({ found: false, reason: 'none' });
    });
  });

  describe('content sniffing', () => {
    it('skips leading nulls to find the first value', () => {
      const frame = toDataFrame({
        fields: [
          { name: 'label', type: FieldType.string, values: ['a', 'b', 'c'] },
          { name: 'loc', type: FieldType.string, values: [null, '', point] },
        ],
      });

      expect(detectGeometryField(frame)).toMatchObject({ found: true, field: { name: 'loc' } });
    });

    it('finds parsed objects in an "other" field', () => {
      const frame = toDataFrame({
        fields: [{ name: 'loc', type: FieldType.other, values: [{ type: 'Point', coordinates: [1, 2] }] }],
      });

      expect(detectGeometryField(frame)).toMatchObject({ found: true, field: { name: 'loc' } });
    });

    it('handles a frame with no fields', () => {
      expect(detectGeometryField(toDataFrame({ fields: [] }))).toMatchObject({ found: false, reason: 'none' });
    });
  });
});
