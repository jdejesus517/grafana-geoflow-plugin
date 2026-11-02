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
