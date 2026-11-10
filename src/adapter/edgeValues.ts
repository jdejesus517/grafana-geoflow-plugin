import { DataFrame, Field, FieldType } from '@grafana/data';
import { isEmpty } from './featureDetails';
import { findField } from './featureLookup';
import { ConversionResult } from './frameToFeatureCollection';

/** Totals over a pair's rows: Grafana's reducer ids (docs/node-edge/architecture.md, decision 5). */
export type EdgeAggregate = 'sum' | 'mean' | 'min' | 'max' | 'count';

/** In the order a column's aggregates are shown. `short` is how tooltips and the legend name them. */
export const EDGE_AGGREGATES: Array<{ value: EdgeAggregate; label: string; short: string }> = [
  { value: 'sum', label: 'Sum', short: 'sum' },
  { value: 'mean', label: 'Average', short: 'avg' },
  { value: 'min', label: 'Min', short: 'min' },
  { value: 'max', label: 'Max', short: 'max' },
  { value: 'count', label: 'Count', short: 'count' },
];

/** An edge layer's field options (docs/node-edge/phase_3.md, Design §3, and phase_5.md), set per column. */
export interface EdgeFieldConfig {
  /** Shown in a pair's summary. */
  edgeAggregates?: EdgeAggregate[];
  /** The one value an edge line takes from this column, for Color by and Size by. Sum by default. */
  edgeValue?: EdgeAggregate;
  /** With `ratioDenominator`, makes the column a ratio: a pair's value is the sums' quotient. */
  ratioNumerator?: string;
  ratioDenominator?: string;
}

/**
 * How a column's edge values were worked out: a ratio of sums, one of the aggregates, or a text
 * column's shared value (docs/node-edge/phase_5.md, decision 2).
 */
export type EdgeValueKind = EdgeAggregate | 'ratio' | 'shared';

export interface EdgeValues {
  kind: EdgeValueKind;
  /** One per pair, in feature order; undefined where a pair has no value. */
  values: unknown[];
  /** The column's Min and Max when set, otherwise the values'; undefined for values that aren't numbers. */
  range?: { min: number; max: number; delta: number };
}

/** The Edge value a column is set to, Sum by default. */
export function edgeValueOption(field: Field): EdgeAggregate {
  const custom: EdgeFieldConfig = field.config.custom ?? {};
  return EDGE_AGGREGATES.some(({ value }) => value === custom.edgeValue) ? custom.edgeValue! : 'sum';
}

/** Sum and Average apply to numbers, Min and Max to numbers and times, Count to any column. */
export function aggregateApplies(aggregate: EdgeAggregate, type: FieldType): boolean {
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

/**
 * Why a column's Edge value can't be worked out, for the data summary: an aggregate that doesn't
 * apply to a number-like column (Sum of a time column). Text columns take their shared value
 * instead, so only time columns have a problem.
 */
export function edgeValueProblem(frame: DataFrame, field: Field): string | undefined {
  if (ratioFields(frame, field) || field.type !== FieldType.time) {
    return undefined;
  }
  const option = edgeValueOption(field);
  if (aggregateApplies(option, field.type)) {
    return undefined;
  }
  const short = EDGE_AGGREGATES.find(({ value }) => value === option)!.short;
  return `${short} doesn't apply to time column ${field.name}`;
}

/**
 * An aggregate over `rows`, skipping empty values: a count of the non-empty values, or a number;
 * undefined when no row has a number.
 */
export function aggregate(field: Field, kind: EdgeAggregate, rows: number[]): number | undefined {
  const values = rows.map((row) => field.values[row]).filter((value) => !isEmpty(value));
  if (kind === 'count') {
    return values.length;
  }
  const numbers = values.map(Number).filter(Number.isFinite);
  if (numbers.length === 0) {
    return undefined;
  }
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const n of numbers) {
    sum += n;
    min = Math.min(min, n);
    max = Math.max(max, n);
  }
  return { sum, mean: sum / numbers.length, min, max }[kind];
}

/** A ratio column's numerator and denominator, when both are set and found. */
export function ratioFields(frame: DataFrame, field: Field): [Field, Field] | undefined {
  const custom: EdgeFieldConfig = field.config.custom ?? {};
  const numerator = custom.ratioNumerator ? findField(frame, custom.ratioNumerator) : undefined;
  const denominator = custom.ratioDenominator ? findField(frame, custom.ratioDenominator) : undefined;
  return numerator && denominator ? [numerator, denominator] : undefined;
}

/**
 * Sum of the numerators over sum of the denominators, over the rows where both have a value
 * (docs/node-edge/phase_3.md, decision 4); undefined when there are none or the denominators sum
 * to zero. Never the average of the rows' ratios, which misweights links of different sizes.
 */
export function ratioOfSums(numerator: Field, denominator: Field, rows: number[]): number | undefined {
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

/** The value all of `rows` share, skipping empty ones; undefined when they differ or are all empty. */
export function sharedValue(field: Field, rows: number[]): unknown {
  let shared: unknown;
  for (const row of rows) {
    const value = field.values[row];
    if (isEmpty(value)) {
      continue;
    }
    if (shared === undefined) {
      shared = value;
    } else if (shared !== value) {
      return undefined;
    }
  }
  return shared;
}

/** One pair's value from a column (docs/node-edge/phase_5.md, Design §1). */
function edgeValue(frame: DataFrame, field: Field, kind: EdgeValueKind, rows: number[]): unknown {
  if (kind === 'ratio') {
    const [numerator, denominator] = ratioFields(frame, field)!;
    return ratioOfSums(numerator, denominator, rows);
  }
  if (kind === 'shared') {
    return sharedValue(field, rows);
  }
  return aggregateApplies(kind, field.type) ? aggregate(field, kind, rows) : undefined;
}

/** How a column's edge values are worked out: decision 2 for columns that aren't numbers or times. */
export function edgeValueKind(frame: DataFrame, field: Field): EdgeValueKind {
  if (ratioFields(frame, field)) {
    return 'ratio';
  }
  const option = edgeValueOption(field);
  const numeric = field.type === FieldType.number || field.type === FieldType.time;
  return option === 'count' || numeric ? option : 'shared';
}

interface CachedValues extends EdgeValues {
  inputs: string;
}
const cache = new WeakMap<ConversionResult, Map<string, CachedValues>>();

/**
 * Each pair's value from a column, in feature order, for coloring and sizing edge lines
 * (docs/node-edge/phase_5.md, Design §1), with the range they span. Cached per conversion and
 * column, and worked out again only when the column's config changes: a conversion is reused only
 * while its frame's data is unchanged, as for feature styles (docs/phase_6.md).
 */
export function edgeValues(frame: DataFrame, result: ConversionResult, field: Field): EdgeValues {
  const pairs = result.pairs ?? [];
  const kind = edgeValueKind(frame, field);
  const ratio = kind === 'ratio' ? ratioFields(frame, field)!.map(({ name }) => name) : undefined;
  const inputs = JSON.stringify([kind, ratio, field.config.min, field.config.max]);
  let byField = cache.get(result);
  if (!byField) {
    byField = new Map();
    cache.set(result, byField);
  }
  const hit = byField.get(field.name);
  if (hit && hit.inputs === inputs) {
    return hit;
  }
  const values = pairs.map(({ rows }) => edgeValue(frame, field, kind, rows));
  const computed: CachedValues = { kind, values, range: valueRange(field, values), inputs };
  byField.set(field.name, computed);
  return computed;
}

/**
 * The range edge values are colored and sized across: the column's Min and Max where set, the
 * values' own otherwise. Pair values aren't the column's row values (sums exceed them), so the
 * data's range is the pairs' (docs/node-edge/architecture.md §6.3).
 */
function valueRange(field: Field, values: unknown[]): EdgeValues['range'] {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (min === Infinity) {
    return undefined;
  }
  const configured = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  min = configured(field.config.min) ?? min;
  max = configured(field.config.max) ?? max;
  return { min, max, delta: max - min };
}
