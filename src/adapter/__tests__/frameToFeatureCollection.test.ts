import { FieldType, toDataFrame } from '@grafana/data';
import { loadFixture } from '../__fixtures__';
import { MAX_WARNING_SAMPLES, frameToFeatureCollection, framesToFeatureCollections } from '../frameToFeatureCollection';

const point = '{"type":"Point","coordinates":[-78.786,35.788]}';
const noWarnings = { empty: 0, invalid: 0, unsupported: 0, projected: 0, outOfRange: 0 };

describe('frameToFeatureCollection', () => {
  describe('captured frames', () => {
    // Seed row counts from docker/postgres/init/03_seed_fixtures.sql.
    it.each([
      ['buildings', 9, 'geometry'],
      ['fiber_cables', 15, 'geometry'],
      ['patch_panels_jsonb', 11, 'geom'],
      ['splice_cases_feature', 7, 'feature'],
      ['network_assets', 42, 'geometry'],
    ] as const)('%s converts all %i rows from "%s"', (fixture, count, geometryField) => {
      const result = frameToFeatureCollection(loadFixture(fixture));

      expect(result.featureCollection.features).toHaveLength(count);
      expect(result.rowCount).toBe(count);
      expect(result.geometryField).toBe(geometryField);
      expect(result.warnings.counts).toEqual(noWarnings);
      expect(result.noGeometry).toBeUndefined();
    });

    it('covers all six geometry types in the mixed view', () => {
      const { features } = frameToFeatureCollection(loadFixture('network_assets')).featureCollection;
      const counts: Record<string, number> = {};
      for (const f of features) {
        counts[f.geometry.type] = (counts[f.geometry.type] ?? 0) + 1;
      }

      expect(counts).toEqual({
        Point: 17,
        MultiPoint: 1,
        LineString: 14,
        MultiLineString: 1,
        Polygon: 8,
        MultiPolygon: 1,
      });
    });

    it('keeps the courtyard hole of the data center polygon', () => {
      const frame = loadFixture('buildings');
      const { featureCollection, featureRows } = frameToFeatureCollection(frame);
      const row = frame.fields.find(({ name }) => name === 'name')!.values.indexOf('Triangle Data Hub');
      const dataCenter = featureCollection.features[featureRows.indexOf(row)];

      expect(dataCenter.geometry.type).toBe('Polygon');
      expect(dataCenter.geometry.type === 'Polygon' && dataCenter.geometry.coordinates).toHaveLength(2);
    });

    it('keeps all three racks of the MultiPoint patch panel group (jsonb input)', () => {
      const { features } = frameToFeatureCollection(loadFixture('patch_panels_jsonb')).featureCollection;
      const group = features.find((f) => f.id === 7)!;

      expect(group.geometry).toEqual({
        type: 'MultiPoint',
        coordinates: [
          [-78.7748, 35.7924],
          [-78.7748, 35.7927],
          [-78.7742, 35.7927],
        ],
      });
    });

    it('keeps columns out of the features: tooltips read them from the frame', () => {
      const [first] = frameToFeatureCollection(loadFixture('buildings')).featureCollection.features;

      expect(first).toMatchObject({ id: 1, properties: {} });
      expect(first.properties).toEqual({});
    });

    it("keeps a GeoJSON Feature's own properties", () => {
      const [first] = frameToFeatureCollection(loadFixture('splice_cases_feature')).featureCollection.features;

      expect(first).toEqual({
        type: 'Feature',
        id: 1,
        geometry: { type: 'Point', coordinates: [-78.786, 35.788] },
        properties: expect.objectContaining({ enclosure_type: 'dome' }),
      });
    });

    it('uses row indexes as ids when the id column is not numeric', () => {
      const { features } = frameToFeatureCollection(loadFixture('network_assets')).featureCollection;

      expect(features.map((f) => f.id)).toEqual(features.map((_, i) => i));
    });

    it('skips and counts the edge-case geometries', () => {
      const result = frameToFeatureCollection(loadFixture('edge_cases'));

      expect(result.featureCollection.features).toHaveLength(1);
      expect(result.warnings.counts).toEqual({ ...noWarnings, empty: 4, unsupported: 1 });
      expect(result.warnings.samples.map((s) => [s.row, s.kind])).toEqual([
        [0, 'empty'],
        [1, 'empty'],
        [2, 'unsupported'],
        [4, 'empty'],
        [5, 'empty'],
      ]);
    });

    it('skips and counts the malformed raw text in geojson_text', () => {
      const result = frameToFeatureCollection(loadFixture('edge_cases'), { geometryField: 'geojson_text' });

      expect(result.featureCollection.features).toHaveLength(0);
      expect(result.warnings.counts).toEqual({ ...noWarnings, empty: 3, invalid: 2, outOfRange: 1 });
    });

    it('reports every State Plane row as projected, naming EPSG:2264', () => {
      const result = frameToFeatureCollection(loadFixture('stateplane'));

      expect(result.featureCollection.features).toHaveLength(0);
      expect(result.warnings.counts).toEqual({ ...noWarnings, projected: 15 });
      expect(result.warnings.samples).toHaveLength(MAX_WARNING_SAMPLES);
      expect(result.warnings.samples[0].detail).toMatch(/^EPSG:2264; .*ST_Transform/);
    });

    it.each([
      ['raw_wkb', 'wkbDetected'],
      ['no_geometry', 'none'],
    ] as const)('%s yields no features and the reason %s', (fixture, reason) => {
      const result = frameToFeatureCollection(loadFixture(fixture));

      expect(result.featureCollection.features).toHaveLength(0);
      expect(result.noGeometry?.reason).toBe(reason);
      expect(result.geometryField).toBeUndefined();
    });
  });

  describe('synthetic frames', () => {
    it('converts a frame with no rows', () => {
      const frame = toDataFrame({ fields: [{ name: 'geometry', type: FieldType.string, values: [] }] });

      expect(frameToFeatureCollection(frame)).toMatchObject({
        rowCount: 0,
        geometryField: 'geometry',
        featureCollection: { type: 'FeatureCollection', features: [] },
      });
    });

    it('records the box around the features, leaving out skipped rows', () => {
      const frame = toDataFrame({
        fields: [
          {
            name: 'geometry',
            type: FieldType.string,
            values: [
              point,
              '{"type":"LineString","coordinates":[[-78.79,35.78],[-78.77,35.79]]}',
              '{"type":"Point","coordinates":[-200,35.78]}',
              null,
            ],
          },
        ],
      });

      expect(frameToFeatureCollection(frame).bounds).toEqual([-78.79, 35.78, -78.77, 35.79]);
    });

    it('has no bounds without features', () => {
      const frame = toDataFrame({ fields: [{ name: 'geometry', type: FieldType.string, values: [null] }] });

      expect(frameToFeatureCollection(frame).bounds).toBeUndefined();
    });

    it('falls back to row indexes for every feature when ids repeat', () => {
      const frame = toDataFrame({
        fields: [
          { name: 'id', type: FieldType.number, values: [3, 1, 3] },
          { name: 'geometry', type: FieldType.string, values: [point, point, point] },
        ],
      });

      const { features } = frameToFeatureCollection(frame).featureCollection;

      expect(features.map((f) => f.id)).toEqual([0, 1, 2]);
    });

    it('uses an explicit id column', () => {
      const frame = toDataFrame({
        fields: [
          { name: 'id', type: FieldType.number, values: [1, 2] },
          { name: 'asset_no', type: FieldType.number, values: [501, 502] },
          { name: 'geometry', type: FieldType.string, values: [point, point] },
        ],
      });

      const { features } = frameToFeatureCollection(frame, { idField: 'asset_no' }).featureCollection;

      expect(features.map((f) => f.id)).toEqual([501, 502]);
    });

    it('uses row indexes when the explicit id column does not exist', () => {
      const frame = toDataFrame({
        fields: [
          { name: 'id', type: FieldType.number, values: [10, 20] },
          { name: 'geometry', type: FieldType.string, values: [point, point] },
        ],
      });

      const { features } = frameToFeatureCollection(frame, { idField: 'missing' }).featureCollection;

      expect(features.map((f) => f.id)).toEqual([0, 1]);
    });

    it('uses row indexes when an id is not a finite number', () => {
      const frame = toDataFrame({
        fields: [
          { name: 'id', type: FieldType.number, values: [1, NaN] },
          { name: 'geometry', type: FieldType.string, values: [point, point] },
        ],
      });

      expect(frameToFeatureCollection(frame).featureCollection.features.map((f) => f.id)).toEqual([0, 1]);
    });

    it('keeps the row index as id when earlier rows are skipped', () => {
      const frame = toDataFrame({
        fields: [{ name: 'geometry', type: FieldType.string, values: [null, point] }],
      });

      expect(frameToFeatureCollection(frame).featureCollection.features.map((f) => f.id)).toEqual([1]);
    });

    it('stringifies nested Feature properties', () => {
      const frame = toDataFrame({
        fields: [
          {
            name: 'feature',
            type: FieldType.other,
            values: [
              { type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { meta: { a: 1 } } },
            ],
          },
        ],
      });

      const [feature] = frameToFeatureCollection(frame).featureCollection.features;

      expect(feature.properties).toEqual({ meta: '{"a":1}' });
    });

    it('accepts text and parsed objects mixed in one column', () => {
      const frame = toDataFrame({
        fields: [
          {
            name: 'geometry',
            type: FieldType.other,
            values: [point, { type: 'Point', coordinates: [-78.78, 35.79] }],
          },
        ],
      });

      expect(frameToFeatureCollection(frame).featureCollection.features).toHaveLength(2);
    });

    it('keeps at most five warning samples but counts every skipped row', () => {
      const frame = toDataFrame({
        fields: [{ name: 'geometry', type: FieldType.string, values: [...Array(8).fill('{bad'), point] }],
      });

      const { featureCollection, warnings } = frameToFeatureCollection(frame);

      expect(featureCollection.features).toHaveLength(1);
      expect(warnings.counts.invalid).toBe(8);
      expect(warnings.samples).toHaveLength(MAX_WARNING_SAMPLES);
    });

    it('reports a missing explicit geometry column', () => {
      const frame = toDataFrame({ fields: [{ name: 'geometry', type: FieldType.string, values: [point] }] });

      expect(frameToFeatureCollection(frame, { geometryField: 'shape' }).noGeometry).toEqual({
        reason: 'fieldNotFound',
        detail: 'No column named "shape"',
      });
    });

    it('defaults refId to an empty string', () => {
      const frame = toDataFrame({ fields: [{ name: 'geometry', type: FieldType.string, values: [point] }] });

      expect(frameToFeatureCollection({ ...frame, refId: undefined }).refId).toBe('');
    });
  });
});

describe('framesToFeatureCollections', () => {
  it('converts each frame in order, keeping refIds', () => {
    const results = framesToFeatureCollections([loadFixture('buildings', 'A'), loadFixture('fiber_cables', 'B')]);

    expect(results.map((r) => [r.refId, r.featureCollection.features.length])).toEqual([
      ['A', 9],
      ['B', 15],
    ]);
  });
});
