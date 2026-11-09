import { DataFrame, Field, getFieldDisplayName } from '@grafana/data';
import { fieldValue } from './featureDetails';
import { featureIndex } from './featureLookup';
import { ConversionResult } from './frameToFeatureCollection';

/** A column of a pair's list. The direction column has no field. */
export interface PairColumn {
  key: string;
  label: string;
  field?: Field;
}

/** One edge row of a pair's list. */
export interface PairRow {
  /** The edge frame's row. */
  row: number;
  /** Shown text, one per column. */
  cells: string[];
  /** What each column sorts by: raw values, and the direction's text. */
  values: unknown[];
}

export interface PairTable {
  columns: PairColumn[];
  rows: PairRow[];
}

export const DIRECTION_KEY = 'direction';

/**
 * The list a clicked edge line shows (docs/node-edge/phase_4.md, Design §1): one row per edge of
 * the pair, in query order. Columns are the row's own direction, unless `showDirection` is off,
 * then the edge query's columns in query order, less those hidden from tooltips, as feature
 * tooltips show them. Undefined when the feature isn't one of the result's pairs.
 */
export function pairRows(
  frame: DataFrame,
  result: ConversionResult,
  featureId: number,
  { showDirection }: { showDirection: boolean }
): PairTable | undefined {
  const index = featureIndex(result, featureId);
  const pair = index === undefined ? undefined : result.pairs?.[index];
  const edgeFields = result.edgeFields;
  if (!pair || !edgeFields) {
    return undefined;
  }
  const fields = frame.fields.filter((field) => !field.config.custom?.hideInTooltip);
  const columns: PairColumn[] = [
    ...(showDirection ? [{ key: DIRECTION_KEY, label: 'Direction' }] : []),
    ...fields.map((field) => ({ key: field.name, label: getFieldDisplayName(field, frame), field })),
  ];
  const from = frame.fields.find(({ name }) => name === edgeFields.from)!;
  const to = frame.fields.find(({ name }) => name === edgeFields.to)!;
  const rows = pair.rows.map((row) => {
    const direction = `${from.values[row]} → ${to.values[row]}`;
    return {
      row,
      cells: [...(showDirection ? [direction] : []), ...fields.map((field) => fieldValue(field, field.values[row]))],
      values: [...(showDirection ? [direction] : []), ...fields.map((field) => field.values[row])],
    };
  });
  return { columns, rows };
}
