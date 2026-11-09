import type { Feature, SupportedGeometry } from '../../model';
import { StyledFeatures, featureStateChanges } from '../featureState';
import { FeatureStyles } from '../types';

function features(...ids: number[]): StyledFeatures['data'] {
  return {
    type: 'FeatureCollection',
    features: ids.map((id): Feature<SupportedGeometry> => ({
      type: 'Feature',
      id,
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    })),
  };
}

const styled = (data: StyledFeatures['data'], featureStyles?: FeatureStyles): StyledFeatures => ({
  data,
  featureStyles,
});

describe('featureStateChanges', () => {
  const data = features(10, 11, 12);

  it('sets the values of every feature that has one, when nothing is set yet', () => {
    const after = styled(data, { colors: ['red', undefined, 'blue'], radii: [4, 6, undefined] });

    expect(featureStateChanges(undefined, after)).toEqual([
      { id: 10, set: { color: 'red', radius: 4 } },
      { id: 11, set: { radius: 6 } },
      { id: 12, set: { color: 'blue' } },
    ]);
  });

  it('sets, changes and removes line widths as it does colors', () => {
    const before = styled(data, { widths: [2, 4, 6] });
    const after = styled(data, { widths: [2, 8, undefined] });

    expect(featureStateChanges(undefined, before)).toEqual([
      { id: 10, set: { width: 2 } },
      { id: 11, set: { width: 4 } },
      { id: 12, set: { width: 6 } },
    ]);
    expect(featureStateChanges(before, after)).toEqual([
      { id: 11, set: { width: 8 } },
      { id: 12, remove: ['width'] },
    ]);
  });

  it('has nothing to do without per-feature styles', () => {
    expect(featureStateChanges(undefined, styled(data))).toEqual([]);
    expect(featureStateChanges(styled(data), styled(data, {}))).toEqual([]);
  });

  it('changes only the features whose values changed', () => {
    const before = styled(data, { colors: ['red', 'red', 'red'] });
    const after = styled(data, { colors: ['red', 'blue', 'red'] });

    expect(featureStateChanges(before, after)).toEqual([{ id: 11, set: { color: 'blue' } }]);
    expect(featureStateChanges(before, styled(data, { colors: ['red', 'red', 'red'] }))).toEqual([]);
  });

  it('removes values that are gone, keeping the others', () => {
    const before = styled(data, { colors: ['red', 'red', 'red'], radii: [4, 4, 4] });
    const after = styled(data, { colors: ['red', undefined, 'blue'] });

    expect(featureStateChanges(before, after)).toEqual([
      { id: 10, remove: ['radius'] },
      { id: 11, remove: ['color', 'radius'] },
      { id: 12, set: { color: 'blue' }, remove: ['radius'] },
    ]);
  });

  it('matches features by id when the data changed, and clears features that are gone', () => {
    const before = styled(data, { colors: ['red', 'green', 'blue'] });
    // 12 moved to the front, 11 is gone, 13 is new.
    const after = styled(features(12, 10, 13), { colors: ['blue', 'red', 'red'] });

    expect(featureStateChanges(before, after)).toEqual([
      { id: 13, set: { color: 'red' } },
      { id: 11, remove: ['color'] },
    ]);
  });

  it('leaves features that are gone alone when they had no values', () => {
    const before = styled(data, { colors: ['red', undefined, undefined] });

    expect(featureStateChanges(before, styled(features(10), { colors: ['red'] }))).toEqual([]);
  });
});
