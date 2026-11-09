import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { DataFrame, Field, GrafanaTheme2, LinkModel } from '@grafana/data';
import { Dropdown, FilterInput, Icon, IconButton, Menu, useStyles2 } from '@grafana/ui';
import { PairTable } from '../adapter';
import { ListSort, countText, listRows, nextSort, searchPlaceholder } from './edgeList';

const getStyles = (theme: GrafanaTheme2) => ({
  // Shrinks with the tooltip, never past it: a minimum height here would push the last rows out of
  // a short tooltip, where no scrolling reaches them. The totals above make room for it instead.
  list: css({
    display: 'flex',
    flexDirection: 'column',
    flex: '0 1 auto',
    gap: theme.spacing(0.5),
    minHeight: 0,
    paddingTop: theme.spacing(1),
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
  // Its rows' own height, shrinking to scroll when the tooltip is shorter.
  scroll: css({
    flex: '0 1 auto',
    minHeight: 0,
    overflow: 'auto',
  }),
  table: css({
    borderCollapse: 'collapse',
    fontSize: theme.typography.bodySmall.fontSize,
    'th, td': {
      padding: theme.spacing(0.25, 1),
      maxWidth: 240,
      overflow: 'hidden',
      textAlign: 'left',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    td: { borderTop: `1px solid ${theme.colors.border.weak}` },
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
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead className={styles.head}>
            <tr>
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
            {shown.rows.map((row) => (
              <tr key={row.row} data-testid="geoflow-edge-list-row">
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
