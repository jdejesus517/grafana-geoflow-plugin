import { PairTable } from '../adapter';
import { LIST_LIMIT, countText, listRows, nextSort } from './edgeList';

const table = (rows: Array<[string, string, unknown]>): PairTable => ({
  columns: [
    { key: 'direction', label: 'Direction' },
    { key: 'trunk_id', label: 'trunk_id' },
    { key: 'capacity', label: 'capacity' },
  ],
  rows: rows.map(([direction, id, capacity], row) => ({
    row,
    cells: [direction, id, capacity === null ? '—' : `${capacity} Gb/s`],
    values: [direction, id, capacity],
  })),
});

const TRUNKS = table([
  ['1 → 6', 'TRK-10', 100],
  ['6 → 1', 'TRK-2', null],
  ['1 → 6', 'TRK-1', 10],
  ['6 → 1', 'trk-3', 1],
]);
const ids = (result: ReturnType<typeof listRows>) => result.rows.map(({ cells }) => cells[1]);

describe('listRows', () => {
  it('keeps query order without a search or sort', () => {
    expect(ids(listRows(TRUNKS, { query: '' }))).toEqual(['TRK-10', 'TRK-2', 'TRK-1', 'trk-3']);
  });

  it('matches any shown cell, ignoring case and surrounding spaces, the direction included', () => {
    expect(ids(listRows(TRUNKS, { query: ' trk-1' }))).toEqual(['TRK-10', 'TRK-1']);
    expect(ids(listRows(TRUNKS, { query: '6 → 1' }))).toEqual(['TRK-2', 'trk-3']);
    expect(ids(listRows(TRUNKS, { query: 'gb/S' }))).toEqual(['TRK-10', 'TRK-1', 'trk-3']);
    expect(listRows(TRUNKS, { query: 'none' })).toEqual({ rows: [], matched: 0 });
  });

  it('sorts numbers by value, with empty values last either way', () => {
    expect(ids(listRows(TRUNKS, { query: '', sort: { key: 'capacity', descending: false } }))).toEqual([
      'trk-3',
      'TRK-1',
      'TRK-10',
      'TRK-2',
    ]);
    expect(ids(listRows(TRUNKS, { query: '', sort: { key: 'capacity', descending: true } }))).toEqual([
      'TRK-10',
      'TRK-1',
      'trk-3',
      'TRK-2',
    ]);
  });

  it('sorts text with its numbers in order, ignoring case, keeping query order for ties', () => {
    expect(ids(listRows(TRUNKS, { query: '', sort: { key: 'trunk_id', descending: false } }))).toEqual([
      'TRK-1',
      'TRK-2',
      'trk-3',
      'TRK-10',
    ]);
    expect(ids(listRows(TRUNKS, { query: '', sort: { key: 'direction', descending: false } }))).toEqual([
      'TRK-10',
      'TRK-1',
      'TRK-2',
      'trk-3',
    ]);
  });

  it(`draws at most ${LIST_LIMIT} rows, counting every match`, () => {
    const many = table(Array.from({ length: 2340 }, (_, i) => ['1 → 6', `T${i}`, i] as [string, string, unknown]));
    const result = listRows(many, { query: '' });

    expect(result.rows).toHaveLength(LIST_LIMIT);
    expect(result.matched).toBe(2340);
  });
});

describe('nextSort', () => {
  it('sorts ascending, then descending, then not at all', () => {
    const ascending = nextSort(undefined, 'capacity');
    const descending = nextSort(ascending, 'capacity');

    expect(ascending).toEqual({ key: 'capacity', descending: false });
    expect(descending).toEqual({ key: 'capacity', descending: true });
    expect(nextSort(descending, 'capacity')).toBeUndefined();
    expect(nextSort(descending, 'trunk_id')).toEqual({ key: 'trunk_id', descending: false });
  });
});

describe('countText', () => {
  it('counts items, what a search found, and when only some are drawn', () => {
    expect(countText({ rows: [], matched: 4 }, 4, false)).toBe('4 items');
    expect(countText({ rows: [], matched: 1 }, 1, false)).toBe('1 item');
    expect(countText({ rows: [], matched: 1 }, 4, true)).toBe('1 of 4 items');
    expect(countText({ rows: [], matched: 2340 }, 2340, false)).toBe('Showing 500 of 2,340 items. Search to narrow.');
  });
});
