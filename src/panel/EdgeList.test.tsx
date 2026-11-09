import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataFrame, Field, FieldType, LinkModel, toDataFrame } from '@grafana/data';
import { PairTable } from '../adapter';
import { EdgeList, ROW_HEIGHT, wheelRows, wholeRowsHeight } from './EdgeList';

const TABLE: PairTable = {
  columns: [
    { key: 'direction', label: 'Direction' },
    { key: 'trunk_id', label: 'trunk_id' },
    { key: 'capacity', label: 'capacity' },
  ],
  rows: [
    { row: 0, cells: ['1 → 6', 'TRK-001', '100 Gb/s'], values: ['1 → 6', 'TRK-001', 100] },
    { row: 1, cells: ['6 → 1', 'TRK-002', '10 Gb/s'], values: ['6 → 1', 'TRK-002', 10] },
    { row: 2, cells: ['1 → 6', 'TRK-003', '40 Gb/s'], values: ['1 → 6', 'TRK-003', 40] },
  ],
};

/** A frame whose columns have `links` link settings each, as Grafana gives them a getLinks. */
function frame(linksPerField: number[] = []): DataFrame {
  const data = toDataFrame({
    fields: [
      { name: 'trunk_id', type: FieldType.string, values: ['TRK-001', 'TRK-002', 'TRK-003'] },
      { name: 'medium', type: FieldType.string, values: ['fiber', 'fiber', 'microwave'] },
    ],
  });
  data.fields.forEach((field: Field, i) => {
    const count = linksPerField[i] ?? 0;
    field.config.links = Array.from({ length: count }, (_, n) => ({ title: `${field.name} ${n}`, url: '' }));
    field.getLinks = ({ valueRowIndex }: { valueRowIndex?: number } = {}) =>
      Array.from({ length: count }, (_, n): LinkModel<Field> => ({
        title: `${field.name} ${n}`,
        href: `/d/x?var-${field.name}=${field.values[valueRowIndex!]}&n=${n}`,
        target: '_blank',
        origin: field,
      }));
  });
  return data;
}

const rows = () =>
  screen.getAllByTestId('geoflow-edge-list-row').map((row) => within(row).getAllByRole('cell')[1].textContent);
const count = () => screen.getByTestId('geoflow-edge-list-count').textContent;

describe('EdgeList', () => {
  it('lists the rows in query order, with a count', () => {
    render(<EdgeList table={TABLE} frame={frame()} />);

    expect(rows()).toEqual(['TRK-001', 'TRK-002', 'TRK-003']);
    expect(count()).toBe('3 items');
    expect(screen.getByRole('columnheader', { name: 'Direction' })).toBeInTheDocument();
  });

  it('filters by search, counting what it found', () => {
    render(<EdgeList table={TABLE} frame={frame()} />);
    fireEvent.change(screen.getByPlaceholderText('Search items'), { target: { value: '6 → 1' } });

    expect(rows()).toEqual(['TRK-002']);
    expect(count()).toBe('1 of 3 items');
  });

  it('sorts by a header: ascending, descending, then query order', () => {
    render(<EdgeList table={TABLE} frame={frame()} />);
    const header = screen.getByRole('button', { name: 'capacity' });

    fireEvent.click(header);
    expect(rows()).toEqual(['TRK-002', 'TRK-003', 'TRK-001']);
    expect(screen.getByRole('columnheader', { name: 'capacity' })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(header);
    expect(rows()).toEqual(['TRK-001', 'TRK-003', 'TRK-002']);
    fireEvent.click(header);
    expect(rows()).toEqual(['TRK-001', 'TRK-002', 'TRK-003']);
    expect(screen.getByRole('columnheader', { name: 'capacity' })).toHaveAttribute('aria-sort', 'none');
  });

  it('clears a search on Escape without letting it close the tooltip, and lets it through when empty', () => {
    const onDocumentKey = jest.fn();
    document.addEventListener('keydown', onDocumentKey);
    render(<EdgeList table={TABLE} frame={frame()} />);
    const search = screen.getByPlaceholderText('Search items');

    fireEvent.change(search, { target: { value: 'TRK-002' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(onDocumentKey).not.toHaveBeenCalled();

    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onDocumentKey).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', onDocumentKey);
  });

  it("links each row with the query's one link, filled in with the row's values", () => {
    render(<EdgeList table={TABLE} frame={frame([1])} />);
    const links = screen.getAllByRole('link', { name: 'trunk_id 0' });

    expect(links).toHaveLength(3);
    expect(links[1]).toHaveAttribute('href', '/d/x?var-trunk_id=TRK-002&n=0');
    expect(links[1]).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it("offers a menu of the row's links when the query has several", async () => {
    render(<EdgeList table={TABLE} frame={frame([1, 1])} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Links' })[2]);
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['trunk_id 0', 'medium 0']);
    expect(items[1].closest('a') ?? items[1]).toHaveAttribute('href', '/d/x?var-medium=microwave&n=0');
  });

  it('has no links column without link settings', () => {
    render(<EdgeList table={TABLE} frame={frame()} />);

    expect(screen.queryByRole('columnheader', { name: 'Links' })).not.toBeInTheDocument();
  });
});

describe('wholeRowsHeight', () => {
  it('fits the header and whole rows in the room, at least one row', () => {
    expect(ROW_HEIGHT).toBe(24);
    expect(wholeRowsHeight(62)).toBe(48);
    expect(wholeRowsHeight(72)).toBe(72);
    expect(wholeRowsHeight(95)).toBe(72);
    expect(wholeRowsHeight(30)).toBe(48);
  });
});

describe('wheelRows', () => {
  it('moves one row per notch, whichever its size or mode', () => {
    expect(wheelRows({ deltaY: 100, deltaMode: 0 }, 0)).toEqual({ rows: 1, pending: 0 });
    expect(wheelRows({ deltaY: -53, deltaMode: 0 }, 0)).toEqual({ rows: -1, pending: 0 });
    expect(wheelRows({ deltaY: 3, deltaMode: 1 }, 0)).toEqual({ rows: 1, pending: 0 });
  });

  it("adds up a trackpad's small steps, one row per row's height", () => {
    let pending = 0;
    const rows: number[] = [];
    for (const deltaY of [10, 10, 10, 10, 10]) {
      const step = wheelRows({ deltaY, deltaMode: 0 }, pending);
      pending = step.pending;
      rows.push(step.rows);
    }
    expect(rows).toEqual([0, 0, 1, 0, 1]);
    expect(pending).toBe(2);
  });

  it('drops what was carried when the direction changes', () => {
    expect(wheelRows({ deltaY: -10, deltaMode: 0 }, 20)).toEqual({ rows: 0, pending: -10 });
  });
});
