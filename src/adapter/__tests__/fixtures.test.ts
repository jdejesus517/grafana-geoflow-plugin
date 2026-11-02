import { FieldType } from '@grafana/data';
import { FIXTURE_NAMES, loadFixture } from '../__fixtures__';

describe('captured frame fixtures', () => {
  it.each(FIXTURE_NAMES)('%s loads as a data frame', (name) => {
    const frame = loadFixture(name);

    expect(frame.length).toBeGreaterThan(0);
    expect(frame.fields.length).toBeGreaterThan(0);
  });

  it('keeps jsonb geometry as parsed objects in an "other" field', () => {
    const geom = loadFixture('patch_panels_jsonb').fields.find((f) => f.name === 'geom')!;

    expect(geom.type).toBe(FieldType.other);
    expect(geom.values[0]).toMatchObject({ type: 'Point' });
  });
});
