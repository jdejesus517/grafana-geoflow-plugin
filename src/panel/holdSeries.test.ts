import { DataFrame, FieldType, LoadingState, toDataFrame } from '@grafana/data';
import { HeldSeries, holdSeries } from './holdSeries';

const frame = (refId: string, values: string[] = ['a', 'b']) =>
  toDataFrame({ refId, fields: [{ name: 'name', type: FieldType.string, values }] });
const refIds = (frames: DataFrame[]) => frames.map(({ refId }) => refId);
/** What Grafana does to the previous frames once a query runs again (docs/phase_9.md, step 9.1). */
const empty = (frames: DataFrame[]) => frames.forEach((f) => f.fields.forEach((field) => (field.values.length = 0)));

describe('holdSeries', () => {
  it('passes good data through', () => {
    const series = [frame('A')];

    expect(holdSeries({ series, state: LoadingState.Done }, { frames: [] })).toBe(series);
  });

  it('keeps every frame when all queries fail, with values Grafana can no longer empty', () => {
    const held: HeldSeries = { frames: [] };
    const series = [frame('A'), frame('B')];
    holdSeries({ series, state: LoadingState.Done }, held);
    empty(series);
    const kept = holdSeries({ series: [], state: LoadingState.Error }, held);

    expect(refIds(kept)).toEqual(['A', 'B']);
    expect(kept[0].fields[0].values).toEqual(['a', 'b']);
  });

  it('keeps only the failed query, in query order, using the new frames of the others', () => {
    const held: HeldSeries = { frames: [] };
    holdSeries({ series: [frame('A'), frame('B'), frame('C')], state: LoadingState.Done }, held);
    const newer = frame('C', ['z']);
    const kept = holdSeries({ series: [frame('A', ['y']), newer], state: LoadingState.Error }, held);

    expect(refIds(kept)).toEqual(['A', 'B', 'C']);
    expect(kept[0].fields[0].values).toEqual(['y']);
    expect(kept[1].fields[0].values).toEqual(['a', 'b']);
    expect(kept[2]).toBe(newer);
  });

  it('adds frames of queries it has not seen', () => {
    const held: HeldSeries = { frames: [] };
    holdSeries({ series: [frame('A')], state: LoadingState.Done }, held);

    expect(refIds(holdSeries({ series: [frame('B')], state: LoadingState.Error }, held))).toEqual(['A', 'B']);
  });

  it('has nothing to keep when the first query fails', () => {
    expect(holdSeries({ series: [], state: LoadingState.Error }, { frames: [] })).toEqual([]);
  });

  it('forgets a query that is gone from good data', () => {
    const held: HeldSeries = { frames: [] };
    holdSeries({ series: [frame('A'), frame('B')], state: LoadingState.Done }, held);
    holdSeries({ series: [frame('A')], state: LoadingState.Done }, held);

    expect(refIds(holdSeries({ series: [], state: LoadingState.Error }, held))).toEqual(['A']);
  });

  it('leaves what it holds alone while a query is loading', () => {
    const held: HeldSeries = { frames: [] };
    holdSeries({ series: [frame('A')], state: LoadingState.Done }, held);
    holdSeries({ series: [], state: LoadingState.Loading }, held);

    expect(refIds(holdSeries({ series: [], state: LoadingState.Error }, held))).toEqual(['A']);
  });

  it('copies new data only, and takes the newest field config', () => {
    const held: HeldSeries = { frames: [] };
    const series = [frame('A')];
    holdSeries({ series, state: LoadingState.Done }, held);
    const copy = held.frames[0].frame.fields[0].values;
    const restyled = { ...series[0], fields: [{ ...series[0].fields[0], config: { unit: 'percent' } }] };
    holdSeries({ series: [restyled], state: LoadingState.Done }, held);

    expect(held.frames[0].frame.fields[0].values).toBe(copy);
    expect(held.frames[0].frame.fields[0].config.unit).toBe('percent');
  });
});
