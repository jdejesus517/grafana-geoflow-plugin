import { DataFrame, Field, FieldType, getFieldDisplayName } from '@grafana/data';
import { FeatureDetailItem, FeatureDetails, fieldValue, isEmpty } from './featureDetails';
import { featureIndex } from './featureLookup';
import { findField } from './featureStyles';
import { ConversionResult } from './frameToFeatureCollection';

/** Totals over a pair's rows: Grafana's reducer ids (docs/node-edge/architecture.md, decision 5). */
export type EdgeAggregate = 'sum' | 'mean' | 'min' | 'max' | 'count';

/** In the order a column's aggregates are shown. `short` is how the tooltip names them. */
export const EDGE_AGGREGATES: Array<{ value: EdgeAggregate; label: string; short: string }> = [
  { value: 'sum', label: 'Sum', short: 'sum' },
  { value: 'mean', label: 'Average', short: 'avg' },
  { value: 'min', label: 'Min', short: 'min' },
  { value: 'max', label: 'Max', short: 'max' },
  { value: 'count', label: 'Count', short: 'count' },
];

/** An edge layer's field options (docs/node-edge/phase_3.md, Design §3), set per column. */
export interface EdgeFieldConfig {
  /** Shown when a pair is hovered. */
  edgeAggregates?: EdgeAggregate[];
  /** With `ratioDenominator`, makes the column a ratio: a pair's value is the sums' quotient. */
  ratioNumerator?: string;
  ratioDenominator?: string;
}

/**
 * A pair's tooltip content (docs/node-edge/phase_3.md, Design §1), in the shape of a feature's:
 * the two nodes, the number of links, then in column order each column's chosen aggregates and
 * each ratio column's ratio of sums. Values are formatted as the column shows them. Columns hidden
 * from tooltips are left out, and a pair has no links: no single row holds a link's values.
 * Undefined when the feature isn't one of the result's pairs.
 */
export function pairDetails(frame: DataFrame, result: ConversionResult, featureId: number): FeatureDetails | undefined {
  const index = featureIndex(result, featureId);
  const pair = index === undefined ? undefined : result.pairs?.[index];
  if (!pair) {
    return undefined;
  }
  const items: FeatureDetailItem[] = [
    { label: 'Between', value: `${pair.nodes[0]} and ${pair.nodes[1]}` },
    { label: 'Links', value: String(pair.rows.length) },
  ];
  for (const field of frame.fields) {
    const custom: EdgeFieldConfig & { hideInTooltip?: boolean } = field.config.custom ?? {};
    if (custom.hideInTooltip) {
      continue;
    }
    const label = getFieldDisplayName(field, frame);
    const numerator = custom.ratioNumerator ? findField(frame, custom.ratioNumerator) : undefined;
    const denominator = custom.ratioDenominator ? findField(frame, custom.ratioDenominator) : undefined;
    if (numerator && denominator) {
      items.push({ label, value: fieldValue(field, ratioOfSums(numerator, denominator, pair.rows)) });
      continue;
    }
    const chosen = EDGE_AGGREGATES.filter(
      ({ value }) => custom.edgeAggregates?.includes(value) && applies(value, field.type)
    );
    if (chosen.length > 0) {
      const parts = chosen.map(({ value, short }) => `${short} ${aggregateText(field, value, pair.rows)}`);
      items.push({ label, value: parts.join(' · ') });
    }
  }
  return { items, links: [] };
}

/** Sum and Average apply to numbers, Min and Max to numbers and times, Count to any column. */
function applies(aggregate: EdgeAggregate, type: FieldType): boolean {
  switch (aggregate) {
    case 'count':
      return true;
    case 'min':
    case 'max':
      return type === FieldType.number || type === FieldType.time;
    default:
      return type === FieldType.number;
  }
}

function aggregateText(field: Field, aggregate: EdgeAggregate, rows: number[]): string {
  const values = rows.map((row) => field.values[row]).filter((value) => !isEmpty(value));
  if (aggregate === 'count') {
    return String(values.length);
  }
  const numbers = values.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) {
    return fieldValue(field, undefined);
  }
  const sum = numbers.reduce((total, n) => total + n, 0);
  const value = {
    sum,
    mean: sum / numbers.length,
    min: Math.min(...numbers),
    max: Math.max(...numbers),
  }[aggregate];
  return fieldValue(field, value);
}

/**
 * Sum of the numerators over sum of the denominators, over the rows where both have a value
 * (docs/node-edge/phase_3.md, decision 4); undefined when there are none or the denominators sum
 * to zero. Never the average of the rows' ratios, which misweights links of different sizes.
 */
function ratioOfSums(numerator: Field, denominator: Field, rows: number[]): number | undefined {
  let top = 0;
  let bottom = 0;
  let counted = 0;
  for (const row of rows) {
    const [n, d] = [Number(numerator.values[row]), Number(denominator.values[row])];
    if (
      isEmpty(numerator.values[row]) ||
      isEmpty(denominator.values[row]) ||
      !Number.isFinite(n) ||
      !Number.isFinite(d)
    ) {
      continue;
    }
    top += n;
    bottom += d;
    counted++;
  }
  return counted > 0 && bottom !== 0 ? top / bottom : undefined;
}
