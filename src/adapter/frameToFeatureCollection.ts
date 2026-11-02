import { DataFrame, Field } from '@grafana/data';
import { Feature, FeatureCollection, SupportedGeometry } from '../model';
import { NoGeometryReason, detectGeometryField } from './detectGeometryField';
import { WarningKind, parseGeometry } from './parseGeometry';

export interface GeometryMapping {
  /** Geometry column name; auto-detected when omitted. */
  geometryField?: string;
  /** Column whose values become feature ids; defaults to a column named "id". */
  idField?: string;
}

export interface WarningSample {
  row: number;
  kind: WarningKind;
  detail: string;
}

export interface ConversionWarnings {
  counts: Record<WarningKind, number>;
  /** The first few skipped rows, for showing the user what went wrong. */
  samples: WarningSample[];
}

export interface ConversionResult {
  refId: string;
  rowCount: number;
  featureCollection: FeatureCollection<SupportedGeometry>;
  /** Name of the geometry column used, when one was found. */
  geometryField?: string;
  noGeometry?: { reason: NoGeometryReason; detail: string };
  warnings: ConversionWarnings;
}

export const MAX_WARNING_SAMPLES = 5;

/**
 * Convert one data frame to a GeoJSON FeatureCollection (docs/architecture.md §3.3).
 * Every non-geometry column becomes a feature property; rows that can't be converted are
 * skipped and counted by warning kind. Never throws.
 */
export function frameToFeatureCollection(frame: DataFrame, mapping: GeometryMapping = {}): ConversionResult {
  const result: ConversionResult = {
    refId: frame.refId ?? '',
    rowCount: frame.length,
    featureCollection: { type: 'FeatureCollection', features: [] },
    warnings: { counts: { empty: 0, invalid: 0, unsupported: 0, projected: 0, outOfRange: 0 }, samples: [] },
  };

  const detection = detectGeometryField(frame, mapping.geometryField);
  if (!detection.found) {
    result.noGeometry = { reason: detection.reason, detail: detection.detail };
    return result;
  }
  result.geometryField = detection.field.name;

  const geometryValues = detection.field.values;
  const propertyFields = frame.fields.filter((_, i) => i !== detection.index);
  const ids = featureIds(frame, mapping.idField);
  const { features } = result.featureCollection;
  const { counts, samples } = result.warnings;

  for (let row = 0; row < frame.length; row++) {
    const parsed = parseGeometry(geometryValues[row]);
    if (!parsed.ok) {
      counts[parsed.kind]++;
      if (samples.length < MAX_WARNING_SAMPLES) {
        samples.push({ row, kind: parsed.kind, detail: parsed.detail });
      }
      continue;
    }

    const properties: Record<string, unknown> = {};
    if (parsed.properties) {
      for (const key of Object.keys(parsed.properties)) {
        properties[key] = propertyValue(parsed.properties[key]);
      }
    }
    // Columns override Feature properties on a name clash (docs/phase_1.md, decision 3).
    for (const field of propertyFields) {
      properties[field.name] = propertyValue(field.values[row]);
    }

    const feature: Feature<SupportedGeometry> = {
      type: 'Feature',
      id: ids ? ids[row] : row,
      geometry: parsed.geometry,
      properties,
    };
    features.push(feature);
  }

  return result;
}

/** Convert every frame; results keep the frames' order and carry their refIds. */
export function framesToFeatureCollections(frames: DataFrame[], mapping?: GeometryMapping): ConversionResult[] {
  return frames.map((frame) => frameToFeatureCollection(frame, mapping));
}

/**
 * Ids from the id column, but only when every value is a unique finite number (MapLibre
 * feature-state needs numeric ids). Otherwise undefined, and row indexes are used for all
 * features so a fallback id can never collide with a real one.
 */
function featureIds(frame: DataFrame, idField?: string): number[] | undefined {
  const field: Field | undefined = idField
    ? frame.fields.find((f) => f.name === idField)
    : frame.fields.find((f) => f.name.toLowerCase() === 'id');
  if (!field) {
    return undefined;
  }
  const ids: number[] = [];
  const seen = new Set<number>();
  for (let row = 0; row < frame.length; row++) {
    const value = field.values[row];
    if (typeof value !== 'number' || !Number.isFinite(value) || seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

// MapLibre flattens nested values to strings anyway; doing it here keeps properties predictable.
function propertyValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
}
