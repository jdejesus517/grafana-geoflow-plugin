import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { MultiCombobox } from '@grafana/ui';
import { EDGE_AGGREGATES, EdgeAggregate } from '../adapter';

const OPTIONS = EDGE_AGGREGATES.map(({ value, label }) => ({ value, label }));

/**
 * The Aggregates field option (docs/node-edge/phase_3.md, decision 2): any of the five totals a
 * clicked edge line's Summary shows for this column (docs/node-edge/phase_5.md, decision 6).
 * Saved in the tooltip's order whatever the order picked, and removed when none is left.
 */
export const AggregatesEditor = ({ value, onChange, id }: StandardEditorProps<EdgeAggregate[] | undefined>) => (
  <MultiCombobox<EdgeAggregate>
    id={id}
    options={OPTIONS}
    value={value ?? []}
    placeholder="None"
    isClearable
    onChange={(selected) => onChange(savedAggregates(selected.map((option) => option.value)))}
  />
);

/** The aggregates picked, in the tooltip's order; undefined for none, so the option is removed. */
export function savedAggregates(picked: EdgeAggregate[]): EdgeAggregate[] | undefined {
  const saved = EDGE_AGGREGATES.map(({ value }) => value).filter((aggregate) => picked.includes(aggregate));
  return saved.length > 0 ? saved : undefined;
}
