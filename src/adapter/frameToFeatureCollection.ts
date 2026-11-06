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

/** A feature's identity across refreshes: the id column's value, a number or a string. */
export type FeatureKey = string | number;

export interface ConversionResult {
  /** The layer drawn from this result (docs/phase_7.md, Design §2); the refId unless set otherwise. */
  layerId: string;
  /** The query the frame came from. */
  refId: string;
  rowCount: number;
  featureCollection: FeatureCollection<SupportedGeometry>;
  /** The data frame row of each feature, in feature order. Skipped rows make these differ. */
  featureRows: number[];
  /**
   * The column the feature keys come from, set when every feature has a key and they're all
   * unique. Without it, features can't be followed through a refresh (docs/phase_4.md, Design §2).
   */
  keyField?: string;
  /** Each feature's key, in feature order; set with keyField. */
  featureKeys?: FeatureKey[];
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
export function frameToFeatureCollection(
  frame: DataFrame,
  mapping: GeometryMapping = {},
  layerId = frame.refId ?? ''
): ConversionResult {
  const result: ConversionResult = {
    layerId,
    refId: frame.refId ?? '',
    rowCount: frame.length,
    featureCollection: { type: 'FeatureCollection', features: [] },
    featureRows: [],
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
  const idField = findIdField(frame, mapping.idField);
  const ids = idField && featureIds(idField, frame.length);
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
    result.featureRows.push(row);
  }

  if (idField) {
    const keys = featureKeys(idField, result.featureRows);
    if (keys) {
      result.keyField = idField.name;
      result.featureKeys = keys;
    }
  }
  return result;
}

/** Convert every frame; results keep the frames' order and carry their refIds. */
export function framesToFeatureCollections(frames: DataFrame[], mapping?: GeometryMapping): ConversionResult[] {
  return frames.map((frame) => frameToFeatureCollection(frame, mapping));
}

function findIdField(frame: DataFrame, idField?: string): Field | undefined {
  return idField
    ? frame.fields.find((f) => f.name === idField)
    : frame.fields.find((f) => f.name.toLowerCase() === 'id');
}

/**
 * Ids from the id column, but only when every value is a unique whole number from 0 to
 * Number.MAX_SAFE_INTEGER. MapLibre keeps no other ids exactly: it reads negative ids back as
 * unsigned 64-bit numbers and cuts decimals, so 7.2 and 7.7 collide (docs/phase_4.md, step 4.1
 * findings). Otherwise undefined, and row indexes are used for all features so a fallback id
 * can never collide with a real one.
 */
function featureIds(field: Field, length: number): number[] | undefined {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (let row = 0; row < length; row++) {
    const value = field.values[row];
    if (!Number.isSafeInteger(value) || value < 0 || seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

/** The id column's values for the given rows, when every one is a number or non-empty string and unique. */
function featureKeys(field: Field, rows: number[]): FeatureKey[] | undefined {
  const keys: FeatureKey[] = [];
  const seen = new Set<FeatureKey>();
  for (const row of rows) {
    const value = field.values[row];
    const usable = (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value !== '');
    if (!usable || seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    keys.push(value);
  }
  return keys;
}

// MapLibre flattens nested values to strings anyway; doing it here keeps properties predictable.
function propertyValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : value;
}
