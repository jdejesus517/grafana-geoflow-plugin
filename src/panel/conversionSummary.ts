import { ConversionResult, WarningKind } from '../adapter';

export const WARNING_LABELS: Record<WarningKind, string> = {
  empty: 'empty',
  invalid: 'invalid',
  unsupported: 'unsupported',
  projected: 'projected',
  outOfRange: 'out of range',
  unknownNode: 'unknown node',
  selfLoop: 'self-loop',
  missingEnd: 'empty end',
  duplicateId: 'duplicate node id',
  notAPoint: 'node not a point',
};

/** One line per frame, e.g. "A: 6 rows → 1 feature (geom) · empty 4, unsupported 1". */
export function conversionSummary(result: ConversionResult): string {
  const rows = `${result.layerId}: ${plural(result.rowCount, 'row')}`;
  if (result.noGeometry) {
    return `${rows} → no geometry: ${result.noGeometry.detail}`;
  }
  const features = `${rows} → ${plural(result.featureCollection.features.length, 'feature')} (${result.geometryField})`;
  const warnings = (Object.keys(WARNING_LABELS) as WarningKind[])
    .filter((kind) => result.warnings.counts[kind] > 0)
    .map((kind) => `${WARNING_LABELS[kind]} ${result.warnings.counts[kind]}`);
  return warnings.length > 0 ? `${features} · ${warnings.join(', ')}` : features;
}

/** The first skipped row, e.g. "row 1: EPSG:2264; transform to EPSG:4326 with ST_Transform(geom, 4326)". */
export function firstWarning(result: ConversionResult): string | undefined {
  const [sample] = result.warnings.samples;
  return sample && `row ${sample.row + 1}: ${sample.detail}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
