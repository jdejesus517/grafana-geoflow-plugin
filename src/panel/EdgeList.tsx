import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { DataFrame, Field, GrafanaTheme2, LinkModel } from '@grafana/data';
import { Dropdown, FilterInput, Icon, IconButton, Menu, useStyles2 } from '@grafana/ui';
import { PairTable } from '../adapter';
import { ListSort, countText, listRows, nextSort, searchPlaceholder } from './edgeList';

/**
 * Every row, and the header, is this tall, so the list can show whole rows and scroll one row at a
 * time (docs/node-edge/phase_4.md, Outcome). Cells don't wrap, so nothing makes a row taller.
 */
export const ROW_HEIGHT = 24;

const getStyles = (theme: GrafanaTheme2) => ({
  // Shrinks with the tooltip, never past it: a minimum height here would push the last rows out of
  // a short tooltip, where no scrolling reaches them.
  list: css({
    display: 'flex',
    flexDirection: 'column',
    flex: '0 1 auto',
    gap: theme.spacing(0.5),
    minHeight: 0,
    // Room for the search box's focus ring, which the scrolling tooltip body would clip.
    padding: theme.spacing(0.5),
  }),
  // The search box and the count on one line, saving the count's own line for rows.
  searchRow: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    '& > :first-child': { flex: 1, minWidth: 0 },
  }),
  count: css({
    flexShrink: 0,
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'nowrap',
  }),
  // Its rows' own height, shrinking to scroll when the tooltip is shorter, but never below the
  // header and one whole row. Rows snap under the sticky header, so dragging the scrollbar ends on
  // a row; the wheel moves one row a notch (wheelRows).
  scroll: css({
    flex: '0 1 auto',
    minHeight: ROW_HEIGHT * 2,
    overflow: 'auto',
    scrollSnapType: 'y mandatory',
    scrollPaddingTop: ROW_HEIGHT,
  }),
  table: css({
    borderCollapse: 'collapse',
    fontSize: theme.typography.bodySmall.fontSize,
    'th, td': {
      height: ROW_HEIGHT,
      padding: theme.spacing(0, 1),
      lineHeight: `${ROW_HEIGHT}px`,
      maxWidth: 240,
      overflow: 'hidden',
      textAlign: 'left',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    // A line that takes no height, so every row is ROW_HEIGHT.
    td: { boxShadow: `inset 0 1px 0 ${theme.colors.border.weak}` },
    // On a cell, not the row: table rows aren't snap targets.
    'tbody td:first-of-type': { scrollSnapAlign: 'start', scrollSnapStop: 'always' },
  }),
  head: css({
    position: 'sticky',
    top: 0,
    background: theme.colors.background.elevated,
    zIndex: 1,
  }),
  sortButton: css({
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: 0,
    color: theme.colors.text.secondary,
    font: 'inherit',
    fontWeight: theme.typography.fontWeightMedium,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    '&:hover': { color: theme.colors.text.primary },
  }),
  // The row's place in the list as shown, to keep track of where you are while scrolling.
  number: css({
    color: theme.colors.text.secondary,
    textAlign: 'right !important' as 'right',
    fontVariantNumeric: 'tabular-nums',
  }),
  link: css({
    display: 'inline-flex',
    color: theme.colors.text.link,
  }),
});

interface Props {
  table: PairTable;
  /** The edge frame, for the rows' data links. */
  frame: DataFrame;
}

/**
 * The list of a clicked edge line's rows (docs/node-edge/phase_4.md, Design §3): a search box, a
 * count, and a table whose headers sort it, under a sticky header, with each row's data links.
 * Keys and the wheel here don't reach the map: MapLibre listens on its canvas container, which
 * the tooltip isn't in (step 4.1).
 */
export const EdgeList = ({ table, frame }: Props) => {
  const styles = useStyles2(getStyles);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ListSort>();
  const shown = useMemo(() => listRows(table, { query, sort }), [table, query, sort]);
  const linkFields = frame.fields.filter((field) => (field.config.links?.length ?? 0) > 0);
  const linkSettings = linkFields.reduce((count, field) => count + field.config.links!.length, 0);
  const scroller = useRef<HTMLDivElement>(null);
  // Once the list has its room, the scrolling area shows the header and whole rows only. The room
  // is known when the tooltip is on the map, after this renders, so it's watched rather than read.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      // A horizontal scrollbar, when the table is wider than the tooltip, takes height from the
      // rows: the gap between the outer and the inner height. The area grows by it, so the header
      // and whole rows show above it.
      const scrollbar = element.offsetHeight - element.clientHeight;
      const minHeight = `${ROW_HEIGHT * 2 + scrollbar}px`;
      if (element.style.minHeight !== minHeight) {
        element.style.minHeight = minHeight;
      }
      if (element.scrollHeight > element.clientHeight && element.clientHeight > 0) {
        const height = `${wholeRowsHeight(element.clientHeight) + scrollbar}px`;
        if (element.style.maxHeight !== height) {
          element.style.maxHeight = height;
        }
      }
    });
    observer.observe(element);
    // One row per wheel notch (Chrome doesn't stop at each row for the wheel, whatever the snap
    // settings). Not passive, to replace the browser's scroll.
    let pending = 0;
    const onWheel = (event: WheelEvent) => {
      const step = wheelRows(event, pending);
      pending = step.pending;
      const top = Math.round(element.scrollTop / ROW_HEIGHT) * ROW_HEIGHT + step.rows * ROW_HEIGHT;
      const max = element.scrollHeight - element.clientHeight;
      if ((event.deltaY < 0 && element.scrollTop > 0) || (event.deltaY > 0 && element.scrollTop < max)) {
        event.preventDefault();
        element.scrollTop = Math.min(max, Math.max(0, top));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className={styles.list} data-testid="geoflow-edge-list">
      <div className={styles.searchRow}>
        <FilterInput
          value={query}
          onChange={setQuery}
          placeholder={searchPlaceholder(shown)}
          onKeyDown={(event) => {
            // Escape clears a search first; with none, it closes the tooltip (decision 5).
            if (event.key === 'Escape' && query) {
              event.stopPropagation();
              event.nativeEvent.stopImmediatePropagation();
              setQuery('');
            }
          }}
        />
        <div className={styles.count} data-testid="geoflow-edge-list-count">
          {countText(shown, table.rows.length, query.trim() !== '')}
        </div>
      </div>
      <div className={styles.scroll} ref={scroller}>
        <table className={styles.table}>
          <thead className={styles.head}>
            <tr>
              <th className={styles.number} title="Row number, as listed">
                #
              </th>
              {table.columns.map((column) => {
                const sorted = sort?.key === column.key ? sort : undefined;
                return (
                  <th
                    key={column.key}
                    aria-sort={sorted ? (sorted.descending ? 'descending' : 'ascending') : 'none'}
                    title={column.label}
                  >
                    <button
                      type="button"
                      className={styles.sortButton}
                      onClick={() => setSort(nextSort(sort, column.key))}
                    >
                      {column.label}
                      {sorted && <Icon name={sorted.descending ? 'arrow-down' : 'arrow-up'} size="sm" />}
                    </button>
                  </th>
                );
              })}
              {linkSettings > 0 && <th aria-label="Links" />}
            </tr>
          </thead>
          <tbody>
            {shown.rows.map((row, position) => (
              <tr key={row.row} data-testid="geoflow-edge-list-row">
                <td className={styles.number}>{position + 1}</td>
                {row.cells.map((cell, i) => (
                  <td key={table.columns[i].key} title={cell}>
                    {cell}
                  </td>
                ))}
                {linkSettings > 0 && (
                  <td>
                    {linkSettings === 1 ? (
                      <SingleLink field={linkFields[0]} row={row.row} className={styles.link} />
                    ) : (
                      <LinksMenu fields={linkFields} row={row.row} />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/** The row's one data link, as an icon (decision 4). */
function SingleLink({ field, row, className }: { field: Field; row: number; className: string }) {
  const [link] = field.getLinks?.({ valueRowIndex: row }) ?? [];
  if (!link) {
    return null;
  }
  return (
    <a
      className={className}
      href={link.href}
      target={link.target}
      rel={link.target === '_blank' ? 'noopener noreferrer' : undefined}
      title={link.title}
      aria-label={link.title}
      onClick={link.onClick && ((event) => link.onClick!(event))}
    >
      <Icon name="external-link-alt" size="sm" />
    </a>
  );
}

/** The row's data links in a menu, built when it opens (decision 4). */
function LinksMenu({ fields, row }: { fields: Field[]; row: number }) {
  const menu = () => (
    <Menu>
      {rowLinks(fields, row).map((link) => (
        <Menu.Item
          key={`${link.title}\n${link.href}`}
          label={link.title}
          url={link.href}
          target={link.target}
          onClick={link.onClick && ((event) => link.onClick!(event))}
        />
      ))}
    </Menu>
  );
  return (
    <Dropdown overlay={menu} placement="bottom-end">
      <IconButton name="external-link-alt" size="sm" aria-label="Links" />
    </Dropdown>
  );
}

/** Every column's links for the row, deduplicated as a feature tooltip's are. */
export function rowLinks(fields: Field[], row: number): Array<LinkModel<Field>> {
  const seen = new Set<string>();
  return fields.flatMap((field) =>
    (field.getLinks?.({ valueRowIndex: row }) ?? []).filter((link) => {
      const key = `${link.title}\n${link.href}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
  );
}

/** The tallest height up to `room` that shows the header and whole rows: at least one row. */
export function wholeRowsHeight(room: number): number {
  return ROW_HEIGHT * (1 + Math.max(1, Math.floor((room - ROW_HEIGHT) / ROW_HEIGHT)));
}

/** A wheel notch's size in pixels, from about 50 (macOS) to 100 (Windows, Linux) in Chrome. */
const NOTCH = 50;

/**
 * How many rows a wheel event moves the list: one per notch, or for a trackpad's small pixel
 * steps, one per row's height of them, carrying the rest to the next event in `pending`.
 */
export function wheelRows(
  { deltaY, deltaMode }: Pick<WheelEvent, 'deltaY' | 'deltaMode'>,
  pending: number
): { rows: number; pending: number } {
  if (deltaY === 0) {
    return { rows: 0, pending };
  }
  // Lines or pages, or a pixel delta of a notch or more: one row.
  if (deltaMode !== 0 || Math.abs(deltaY) >= NOTCH) {
    return { rows: Math.sign(deltaY), pending: 0 };
  }
  // A change of direction drops what was carried the other way.
  const carried = Math.sign(pending) === Math.sign(deltaY) ? pending : 0;
  const total = carried + deltaY;
  // `|| 0`: Math.trunc gives -0 for a small upward total.
  const rows = Math.trunc(total / ROW_HEIGHT) || 0;
  return { rows, pending: total - rows * ROW_HEIGHT };
}
