import { DataFrame, Field, getFieldDisplayName } from '@grafana/data';
import {
  EDGE_AGGREGATES,
  EdgeAggregate,
  EdgeFieldConfig,
  aggregate,
  aggregateApplies,
  ratioFields,
  ratioOfSums,
} from './edgeValues';
import { FeatureDetailItem, FeatureDetails, fieldValue } from './featureDetails';
import { featureIndex } from './featureLookup';
import { ConversionResult } from './frameToFeatureCollection';

/**
 * A pair's tooltip content (docs/node-edge/phase_3.md, Design §1), in the shape of a feature's:
 * the two nodes, the number of rows, then in column order each column's chosen aggregates and
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
    // "Items": viewers see lines between locations, and needn't know they're edges (docs/node-edge/phase_4.md, decision 8).
    { label: 'Items', value: String(pair.rows.length) },
  ];
  for (const field of frame.fields) {
    const custom: EdgeFieldConfig & { hideInTooltip?: boolean } = field.config.custom ?? {};
    if (custom.hideInTooltip) {
      continue;
    }
    const label = getFieldDisplayName(field, frame);
    const ratio = ratioFields(frame, field);
    if (ratio) {
      items.push({ label, value: fieldValue(field, ratioOfSums(ratio[0], ratio[1], pair.rows)) });
      continue;
    }
    const chosen = EDGE_AGGREGATES.filter(
      ({ value }) => custom.edgeAggregates?.includes(value) && aggregateApplies(value, field.type)
    );
    if (chosen.length > 0) {
      const parts = chosen.map(({ value, short }) => `${short} ${aggregateText(field, value, pair.rows)}`);
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
