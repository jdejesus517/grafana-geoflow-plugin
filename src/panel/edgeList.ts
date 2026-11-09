import { PairRow, PairTable } from '../adapter';

/** Rows a list draws at most (docs/node-edge/architecture.md, decision 7); search narrows the rest. */
export const LIST_LIMIT = 500;

export interface ListSort {
  /** A column's key. */
  key: string;
  descending: boolean;
}

export interface ListRows {
  /** The rows to draw: matching, sorted, at most LIST_LIMIT. */
  rows: PairRow[];
  /** How many rows match the search. */
  matched: number;
}

/**
 * The rows a pair's list draws (docs/node-edge/phase_4.md, Design §2). A row matches when any of
 * its shown cells contains the query, ignoring case (decision 3). Sorting compares numbers as
 * numbers and everything else as text, with numbers in text in order ("TRK-2" before "TRK-10");
 * empty values go last either way, and ties keep query order.
 */
export function listRows(table: PairTable, { query, sort }: { query: string; sort?: ListSort }): ListRows {
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? table.rows.filter((row) => row.cells.some((cell) => cell.toLowerCase().includes(needle)))
    : table.rows;
  const column = sort ? table.columns.findIndex(({ key }) => key === sort.key) : -1;
  const sorted =
    sort && column >= 0
      ? [...matching].sort((a, b) => compareValues(a.values[column], b.values[column], sort.descending))
      : matching;
  return { rows: sorted.slice(0, LIST_LIMIT), matched: matching.length };
}

/** The next sort for a header click (decision 2): ascending, descending, then query order. */
export function nextSort(sort: ListSort | undefined, key: string): ListSort | undefined {
  if (sort?.key !== key) {
    return { key, descending: false };
  }
  return sort.descending ? undefined : { key, descending: true };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compareValues(a: unknown, b: unknown, descending: boolean): number {
  const [emptyA, emptyB] = [isEmpty(a), isEmpty(b)];
  if (emptyA || emptyB) {
    // Last, whichever way the column sorts.
    return emptyA === emptyB ? 0 : emptyA ? 1 : -1;
  }
  const order = typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(String(a), String(b));
  return descending ? -order : order;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));
}

/**
 * "4 items", "1 of 4 items", or past the limit, "Showing 500 of 2,340 items". Short enough to sit
 * beside the search box, whose placeholder then says to search to narrow (searchPlaceholder).
 */
export function countText({ matched }: ListRows, total: number, searching: boolean): string {
  const items = (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'item' : 'items'}`;
  if (matched > LIST_LIMIT) {
    return `Showing ${LIST_LIMIT} of ${items(matched)}`;
  }
  return searching ? `${matched.toLocaleString('en-US')} of ${items(total)}` : items(total);
}

/** The search box's placeholder: a hint to narrow the list when it isn't all drawn. */
export function searchPlaceholder({ matched }: ListRows): string {
  return matched > LIST_LIMIT ? 'Search to narrow' : 'Search items';
}
