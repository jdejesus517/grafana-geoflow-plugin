import { looksLikeGeoJson, looksLikeWkbHex, parseGeometry } from '../parseGeometry';

const point = { type: 'Point', coordinates: [-78.786, 35.788] };
const line = {
  type: 'LineString',
  coordinates: [
    [-78.786, 35.788],
    [-78.783, 35.788],
  ],
};
const ring = [
  [-78.79, 35.78],
  [-78.78, 35.78],
  [-78.78, 35.79],
  [-78.79, 35.78],
];

describe('parseGeometry', () => {
  describe('accepts', () => {
    it.each([
      ['Point', point],
      ['MultiPoint', { type: 'MultiPoint', coordinates: [point.coordinates, [-78.77, 35.79]] }],
      ['LineString', line],
      ['MultiLineString', { type: 'MultiLineString', coordinates: [line.coordinates, line.coordinates] }],
      ['Polygon', { type: 'Polygon', coordinates: [ring] }],
      ['MultiPolygon', { type: 'MultiPolygon', coordinates: [[ring], [ring]] }],
    ])('%s as an object (jsonb)', (_type, geometry) => {
      expect(parseGeometry(geometry)).toEqual({ ok: true, geometry, bounds: expect.any(Array), properties: undefined });
    });

    it('GeoJSON text, including leading whitespace', () => {
      expect(parseGeometry(`  ${JSON.stringify(point)}`)).toMatchObject({ ok: true, geometry: point });
    });

    it('a Feature, returning its geometry and properties', () => {
      const feature = { type: 'Feature', geometry: point, properties: { id: 1, name: 'SC-01' } };

      expect(parseGeometry(JSON.stringify(feature))).toEqual({
        ok: true,
        geometry: point,
        bounds: expect.any(Array),
        properties: { id: 1, name: 'SC-01' },
      });
    });

    it('a Feature with null properties', () => {
      expect(parseGeometry({ type: 'Feature', geometry: point, properties: null })).toEqual({
        ok: true,
        geometry: point,
        bounds: expect.any(Array),
        properties: undefined,
      });
    });

    it('Z coordinates, passed through', () => {
      const pointZ = { type: 'Point', coordinates: [-78.786, 35.788, 120.5] };

      expect(parseGeometry(pointZ)).toMatchObject({ ok: true, geometry: pointZ });
    });

    it.each(['EPSG:4326', 'urn:ogc:def:crs:EPSG::4326', 'urn:ogc:def:crs:OGC:1.3:CRS84'])(
      'a %s crs member, dropping it from the result',
      (name) => {
        const result = parseGeometry({ ...point, crs: { type: 'name', properties: { name } } });

        expect(result).toEqual({ ok: true, geometry: point, bounds: expect.any(Array), properties: undefined });
      }
    );

    it.each([
      ['a Point', point, [-78.786, 35.788, -78.786, 35.788]],
      ['a LineString', line, [-78.786, 35.788, -78.783, 35.788]],
      ['a Polygon', { type: 'Polygon', coordinates: [ring] }, [-78.79, 35.78, -78.78, 35.79]],
      [
        'a MultiPolygon',
        {
          type: 'MultiPolygon',
          coordinates: [
            [ring],
            [
              [
                [-79, 36],
                [-78.9, 36],
                [-78.9, 36.1],
                [-79, 36],
              ],
            ],
          ],
        },
        [-79, 35.78, -78.78, 36.1],
      ],
    ])('the box around %s', (_name, geometry, bounds) => {
      expect(parseGeometry(geometry)).toMatchObject({ ok: true, bounds });
    });

    it('returns a new geometry object rather than the frame value', () => {
      const result = parseGeometry(point);

      expect(result.ok && result.geometry).not.toBe(point);
    });
  });

  describe('rejects', () => {
    it.each<[string, unknown, string]>([
      ['null', null, 'empty'],
      ['undefined', undefined, 'empty'],
      ['an empty string', '', 'empty'],
      ['POINT EMPTY as PostGIS emits it', '{"type":"Point","coordinates":[]}', 'empty'],
      ['an empty MultiPolygon', { type: 'MultiPolygon', coordinates: [] }, 'empty'],
      ['a Feature without geometry', { type: 'Feature', geometry: null, properties: {} }, 'empty'],
      ['truncated JSON', '{"type":"Point","coordinates":[-78.782,', 'invalid'],
      ['WKT', 'POINT(-78.782 35.7875)', 'invalid'],
      ['a number', 42, 'invalid'],
      ['an array', [point], 'invalid'],
      ['JSON text that is not an object', '{', 'invalid'],
      ['an object without a type', { coordinates: [1, 2] }, 'invalid'],
      ['an unknown type', { type: 'Circle', coordinates: [1, 2] }, 'invalid'],
      ['a Feature whose geometry is a string', { type: 'Feature', geometry: 'POINT(1 2)' }, 'invalid'],
      ['a GeometryCollection', { type: 'GeometryCollection', geometries: [point, line] }, 'unsupported'],
    ])('%s → %s', (_label, raw, kind) => {
      expect(parseGeometry(raw)).toMatchObject({ ok: false, kind });
    });

    it.each<[string, unknown]>([
      ['Point with one number', [1]],
      ['Point with a string', [-78.7, '35.7']],
      ['Point with NaN', [-78.7, NaN]],
      ['Point with Infinity', [-78.7, Infinity]],
      ['Point nested too deep', [[-78.7, 35.7]]],
      ['Point with no coordinates', undefined],
    ])('malformed coordinates: %s', (_label, coordinates) => {
      expect(parseGeometry({ type: 'Point', coordinates })).toMatchObject({ ok: false, kind: 'invalid' });
    });

    it.each<[string, unknown]>([
      ['MultiPoint', [[[-78.7, 35.7]]]],
      ['LineString', [-78.7, 35.7]],
      ['MultiLineString', [[-78.7, 35.7]]],
      ['Polygon', [[-78.7, 35.7]]],
      ['MultiPolygon', [[[-78.7, 35.7]]]],
    ])('%s with the wrong nesting depth', (type, coordinates) => {
      expect(parseGeometry({ type, coordinates })).toMatchObject({
        ok: false,
        kind: 'invalid',
        detail: `${type} coordinates are malformed`,
      });
    });

    it('a projected crs, naming it and the fix', () => {
      const projected = {
        type: 'LineString',
        crs: { type: 'name', properties: { name: 'EPSG:2264' } },
        coordinates: [
          [2063467.4, 741797],
          [2064357.1, 741798.9],
        ],
      };

      expect(parseGeometry(projected)).toEqual({
        ok: false,
        kind: 'projected',
        detail: 'EPSG:2264; transform to EPSG:4326 with ST_Transform(geom, 4326)',
      });
    });

    it('a projected crs on the Feature rather than its geometry', () => {
      const feature = {
        type: 'Feature',
        crs: { type: 'name', properties: { name: 'EPSG:3857' } },
        geometry: { type: 'Point', coordinates: [-8769900, 4271400] },
      };

      expect(parseGeometry(feature)).toMatchObject({ ok: false, kind: 'projected' });
    });

    it.each<[string, number[]]>([
      ['longitude above 180', [180.1, 35]],
      ['longitude below -180', [-180.1, 35]],
      ['latitude above 90', [-78, 90.1]],
      ['latitude below -90', [-78, -90.1]],
      ['Web Mercator metres', [-8769900, 4271400]],
    ])('out-of-range coordinates: %s', (_label, coordinates) => {
      expect(parseGeometry({ type: 'Point', coordinates })).toMatchObject({ ok: false, kind: 'outOfRange' });
    });

    it('a malformed position after an out-of-range one is reported as malformed', () => {
      const geometry = { type: 'LineString', coordinates: [[-8769900, 4271400], [1]] };

      expect(parseGeometry(geometry)).toMatchObject({ ok: false, kind: 'invalid' });
    });

    it('accepts the exact bounds', () => {
      expect(parseGeometry({ type: 'Point', coordinates: [-180, 90] })).toMatchObject({ ok: true });
      expect(parseGeometry({ type: 'Point', coordinates: [180, -90] })).toMatchObject({ ok: true });
    });

    it('truncates long values in the detail', () => {
      const result = parseGeometry('x'.repeat(200));

      expect(result).toMatchObject({ ok: false, kind: 'invalid' });
      expect(!result.ok && result.detail.length).toBeLessThan(60);
    });
  });
});

describe('looksLikeGeoJson', () => {
  it.each<[unknown, boolean]>([
    [JSON.stringify(point), true],
    [point, true],
    ['{"type":"Feature","geometry":null}', true],
    ['{"type":"GeometryCollection","geometries":[]}', true],
    ['{"type":"Point","coordinates":[]}', true],
    ['{"type":"Banana"}', false],
    ['{"type":', false],
    ['hello', false],
    [null, false],
    [7, false],
  ])('%p → %p', (raw, expected) => {
    expect(looksLikeGeoJson(raw)).toBe(expected);
  });
});

describe('looksLikeWkbHex', () => {
  it.each<[unknown, boolean]>([
    ['0101000020E6100000FCA9F1D24DB253C0BE9F1A2FDDE44140', true],
    ['000000000140000000000000004010000000000000', true],
    ['0101000020E6100000FCA9F1D24DB253C0BE9F1A2FDDE4414', false],
    ['0201000020E6100000FCA9F1D24DB253C0BE9F1A2FDDE44140', false],
    ['0101', false],
    ['SC-01', false],
    [12, false],
  ])('%p → %p', (raw, expected) => {
    expect(looksLikeWkbHex(raw)).toBe(expected);
  });
});
