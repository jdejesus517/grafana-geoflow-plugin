import type { Geometry, GeometryCollection } from 'geojson';

export type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  LineString,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from 'geojson';

/** Geometry types GeoFlow renders (docs/architecture.md §3.3). GeometryCollection is not supported. */
export const SUPPORTED_GEOMETRY_TYPES = [
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
] as const;

export type SupportedGeometryType = (typeof SUPPORTED_GEOMETRY_TYPES)[number];

export type SupportedGeometry = Exclude<Geometry, GeometryCollection>;

export function isSupportedGeometryType(type: unknown): type is SupportedGeometryType {
  return typeof type === 'string' && (SUPPORTED_GEOMETRY_TYPES as readonly string[]).includes(type);
}

/** A box in degrees: west, south, east, north. Never crosses the antimeridian (§4.1). */
export type Bounds = [west: number, south: number, east: number, north: number];

/** `a` grown to cover `b`; undefined only when both are. */
export function unionBounds(a: Bounds | undefined, b: Bounds | undefined): Bounds | undefined {
  if (!a || !b) {
    return a ?? b;
  }
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
