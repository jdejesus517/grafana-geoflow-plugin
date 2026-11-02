import { DataFrame, Field, FieldType } from '@grafana/data';
import { looksLikeGeoJson, looksLikeWkbHex } from './parseGeometry';

export type NoGeometryReason = 'fieldNotFound' | 'wkbDetected' | 'none';

export type GeometryFieldDetection =
  { found: true; field: Field; index: number } | { found: false; reason: NoGeometryReason; detail: string };

// Checked in this order, case-insensitively (docs/architecture.md §3.2).
const CONVENTIONAL_NAMES = ['geometry', 'geom', 'geojson', 'the_geom', 'wkb_geometry', 'shape'];

const EXAMPLE_QUERY = 'SELECT ST_AsGeoJSON(geom) AS geometry, ...';

/**
 * Find the column holding GeoJSON geometry: an explicit name, then a conventional name, then
 * the first text/JSON column whose content is GeoJSON.
 */
export function detectGeometryField(frame: DataFrame, preferred?: string): GeometryFieldDetection {
  const fields = frame.fields;

  if (preferred) {
    const index = fields.findIndex((f) => f.name === preferred);
    return index >= 0
      ? { found: true, field: fields[index], index }
      : { found: false, reason: 'fieldNotFound', detail: `No column named "${preferred}"` };
  }

  for (const name of CONVENTIONAL_NAMES) {
    const index = fields.findIndex((f) => f.name.toLowerCase() === name && isCandidate(f));
    if (index >= 0) {
      const sample = firstValue(fields[index]);
      // An all-null column with a geometry name is still the geometry column.
      if (sample === undefined || looksLikeGeoJson(sample)) {
        return { found: true, field: fields[index], index };
      }
    }
  }

  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (isCandidate(field) && looksLikeGeoJson(firstValue(field))) {
      return { found: true, field, index };
    }
  }

  const wkb = fields.find((f) => f.type === FieldType.string && looksLikeWkbHex(firstValue(f)));
  if (wkb) {
    return {
      found: false,
      reason: 'wkbDetected',
      detail: `Column "${wkb.name}" holds binary geometry; select ST_AsGeoJSON(${wkb.name}) instead`,
    };
  }
  return { found: false, reason: 'none', detail: `No GeoJSON geometry column; for example: ${EXAMPLE_QUERY}` };
}

function isCandidate(field: Field): boolean {
  return field.type === FieldType.string || field.type === FieldType.other;
}

function firstValue(field: Field): unknown {
  for (const value of field.values) {
    if (value !== null && value !== undefined && value !== '') {
      return value;
    }
  }
  return undefined;
}
