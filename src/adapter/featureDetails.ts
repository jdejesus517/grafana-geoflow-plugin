import { DataFrame, Field, LinkModel, formattedValueToString, getFieldDisplayName } from '@grafana/data';
import { ConversionResult } from './frameToFeatureCollection';
import { featureIndex } from './featureLookup';

/** One line of a tooltip. */
export interface FeatureDetailItem {
  label: string;
  value: string;
}

export interface FeatureDetails {
  items: FeatureDetailItem[];
  links: Array<LinkModel<Field>>;
}

/** Shown for empty values when the field has no No value text. */
export const EMPTY_VALUE = '—';

/**
 * A feature's tooltip content (docs/phase_4.md, Design §3), formatted the way Grafana formats
 * values elsewhere: with the field config Grafana applied to the frame (unit, decimals, value
 * mappings, display names, the dashboard time zone). Undefined when the feature isn't in the result.
 */
export function featureDetails(
  frame: DataFrame,
  result: ConversionResult,
  featureId: number
): FeatureDetails | undefined {
  const index = featureIndex(result, featureId);
  if (index === undefined) {
    return undefined;
  }
  const row = result.featureRows[index];
  const items: FeatureDetailItem[] = [];
  const links: Array<LinkModel<Field>> = [];
  const seenLinks = new Set<string>();

  for (const field of frame.fields) {
    if (field.name === result.geometryField) {
      continue;
    }
    // A hidden field can still carry links.
    for (const link of field.getLinks?.({ valueRowIndex: row }) ?? []) {
      const key = `${link.title}\n${link.href}`;
      if (!seenLinks.has(key)) {
        seenLinks.add(key);
        links.push(link);
      }
    }
    if (!field.config.custom?.hideInTooltip) {
      items.push({ label: getFieldDisplayName(field, frame), value: fieldValue(field, field.values[row]) });
    }
  }

  // Properties from a GeoJSON Feature input that no column covers. They have no Grafana field,
  // so no field config applies; columns already won any name clash in the conversion.
  const columns = new Set(frame.fields.map((field) => field.name));
  const feature = result.featureCollection.features[index];
  for (const [name, value] of Object.entries(feature.properties ?? {})) {
    if (!columns.has(name)) {
      items.push({ label: name, value: isEmpty(value) ? EMPTY_VALUE : String(value) });
    }
  }
  return { items, links };
}

/** A value as its field shows it: formatted with its field config, or its No value text when empty. */
export function fieldValue(field: Field, value: unknown): string {
  if (isEmpty(value)) {
    return field.config.noValue ?? EMPTY_VALUE;
  }
  if (field.display) {
    return formattedValueToString(field.display(value));
  }
  // No field config applied (outside a Grafana panel): the raw value.
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** Null, undefined or empty text. */
export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}
