import { frameToFeatureCollection } from '../adapter';
import { loadFixture } from '../adapter/__fixtures__';
import { conversionSummary, firstWarning } from './conversionSummary';

describe('conversionSummary', () => {
  it.each([
    ['buildings', 'A: 9 rows → 9 features (geometry)'],
    ['edge_cases', 'A: 6 rows → 1 feature (geom) · empty 4, unsupported 1'],
    ['stateplane', 'A: 15 rows → 0 features (geometry) · projected 15'],
    ['raw_wkb', 'A: 7 rows → no geometry: Column "geom" holds binary geometry; select ST_AsGeoJSON(geom) instead'],
  ] as const)('%s', (fixture, expected) => {
    expect(conversionSummary(frameToFeatureCollection(loadFixture(fixture)))).toBe(expected);
  });

  it('labels out-of-range warnings readably', () => {
    const result = frameToFeatureCollection(loadFixture('edge_cases'), { geometryField: 'geojson_text' });

    expect(conversionSummary(result)).toBe(
      'A: 6 rows → 0 features (geojson_text) · empty 3, invalid 2, out of range 1'
    );
  });
});

describe('firstWarning', () => {
  it('describes the first skipped row with a 1-based row number', () => {
    expect(firstWarning(frameToFeatureCollection(loadFixture('stateplane')))).toBe(
      'row 1: EPSG:2264; transform to EPSG:4326 with ST_Transform(geom, 4326)'
    );
  });

  it('is undefined when nothing was skipped', () => {
    expect(firstWarning(frameToFeatureCollection(loadFixture('buildings')))).toBeUndefined();
  });
});
