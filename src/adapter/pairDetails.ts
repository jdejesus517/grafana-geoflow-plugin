import { DataFrame, Field, getFieldDisplayName } from '@grafana/data';
import {
  EDGE_AGGREGATES,
  EdgeAggregate,
  EdgeFieldConfig,
  aggregate,
  aggregateApplies,
  edgeValueKind,
  ratioFields,
  ratioOfSums,
  sharedValue,
} from './edgeValues';
import { FeatureDetailItem, FeatureDetails, fieldValue, isEmpty } from './featureDetails';
import { featureIndex } from './featureLookup';
import { dataStyleFields } from './featureStyles';
import { ConversionResult } from './frameToFeatureCollection';

/** What a pair's tooltip shows: a hover's glance, or a pinned line's whole Summary. */
export type PairView = 'hover' | 'summary';

/**
 * A pair's tooltip content (docs/node-edge/phase_3.md, Design §1), in the shape of a feature's:
 * the two nodes and the number of rows, then column by column:
 * - **summary** (a pinned line's Summary): each column's chosen aggregates, each ratio column's
 *   ratio of sums, and the edge values behind Color by and Size by;
 * - **hover**: only the edge values behind Color by and Size by, so a hover stays a few lines and
 *   never needs scrolling (docs/node-edge/phase_5.md, decision 6).
 *
 * Values are formatted as the column shows them. Columns hidden from tooltips are left out, and a
 * pair has no links: no single row holds a link's values. Undefined when the feature isn't one of
 * the result's pairs.
 */
export function pairDetails(
  frame: DataFrame,
  result: ConversionResult,
  featureId: number,
  { view }: { view: PairView } = { view: 'summary' }
): FeatureDetails | undefined {
  const index = featureIndex(result, featureId);
  const pair = index === undefined ? undefined : result.pairs?.[index];
  if (!pair) {
    return undefined;
  }
  const items: FeatureDetailItem[] = [
    { label: 'Between', value: `${pair.nodes[0]} and ${pair.nodes[1]}` },
    // "Items": viewers see lines between locations, and needn't know they're edges (docs/node-edge/phase_4.md, decision 8).
    { label: 'Items', value: String(pair.rows.length) },
  ];
  const { colorField, sizeField } = dataStyleFields(frame, result);
  for (const field of frame.fields) {
    const custom: EdgeFieldConfig & { hideInTooltip?: boolean } = field.config.custom ?? {};
    const styled = field === colorField || field === sizeField;
    if (custom.hideInTooltip || (view === 'hover' && !styled)) {
      continue;
    }
    const label = getFieldDisplayName(field, frame);
    const ratio = ratioFields(frame, field);
    if (ratio) {
      items.push({ label, value: fieldValue(field, ratioOfSums(ratio[0], ratio[1], pair.rows)) });
      continue;
    }
    const kind = styled ? edgeValueKind(frame, field) : undefined;
    if (kind === 'shared') {
      items.push({ label, value: sharedText(field, pair.rows) });
      continue;
    }
    const shown = EDGE_AGGREGATES.filter(
      ({ value }) =>
        (value === kind || (view === 'summary' && custom.edgeAggregates?.includes(value))) &&
        aggregateApplies(value, field.type)
    );
    if (shown.length > 0) {
      const parts = shown.map(({ value, short }) => `${short} ${aggregateText(field, value, pair.rows)}`);
      items.push({ label, value: parts.join(' · ') });
    }
  }
  return { items, links: [] };
}

/** An aggregate as the column shows its values; a count as a plain number. */
function aggregateText(field: Field, kind: EdgeAggregate, rows: number[]): string {
  const value = aggregate(field, kind, rows);
  return kind === 'count' ? String(value) : fieldValue(field, value);
}

/**
 * A text column's shared value, as the column shows it; "mixed" when the rows differ, which is
 * why the line keeps the layer's color (docs/node-edge/phase_5.md, decision 2).
 */
function sharedText(field: Field, rows: number[]): string {
  const shared = sharedValue(field, rows);
  if (shared === undefined && rows.some((row) => !isEmpty(field.values[row]))) {
    return 'mixed';
  }
  return fieldValue(field, shared);
}
