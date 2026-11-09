import { savedAggregates } from './AggregatesEditor';

// Picking from the list is covered by the e2e tests: MultiCombobox virtualizes its list, which
// renders no options in jsdom.
describe('savedAggregates', () => {
  it("saves the aggregates picked in the tooltip's order", () => {
    expect(savedAggregates(['max', 'count', 'sum'])).toEqual(['sum', 'max', 'count']);
  });

  it('saves nothing when none is picked, so the option is removed', () => {
    expect(savedAggregates([])).toBeUndefined();
  });
});
