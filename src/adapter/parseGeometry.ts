import { Bounds, SupportedGeometry, isSupportedGeometryType } from '../model';

/** Why a row produced no feature (docs/phase_1.md, Design §3). */
export type WarningKind = 'empty' | 'invalid' | 'unsupported' | 'projected' | 'outOfRange';

export type ParsedGeometry =
  | { ok: true; geometry: SupportedGeometry; bounds: Bounds; properties?: Record<string, unknown> }
  | { ok: false; kind: WarningKind; detail: string };

// Nesting depth of `coordinates` below a single position, per geometry type.
const COORDINATE_DEPTH: Record<SupportedGeometry['type'], number> = {
  Point: 0,
  MultiPoint: 1,
  LineString: 1,
  MultiLineString: 2,
  Polygon: 2,
  MultiPolygon: 3,
};

const GEOJSON_TYPES = new Set([
  'Feature',
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

// "EPSG:4326", "urn:ogc:def:crs:EPSG::4326" and "urn:ogc:def:crs:OGC:1.3:CRS84" all mean lon/lat WGS84.
const WGS84_CRS = /(EPSG:+4326|CRS84)$/i;

const WKB_HEX = /^0[01][0-9a-f]{16,}$/i;

/**
 * Parse one geometry-column value: GeoJSON text, an already-parsed object (jsonb), or a
 * GeoJSON Feature. Never throws; anything unusable comes back as a warning kind.
 */
export function parseGeometry(raw: unknown): ParsedGeometry {
  if (raw === null || raw === undefined || raw === '') {
    return fail('empty', 'no value');
  }

  let value = raw;
  if (typeof raw === 'string') {
    const text = raw.trimStart();
    if (!text.startsWith('{')) {
      return fail('invalid', `not GeoJSON: ${preview(text)}`);
    }
    try {
      value = JSON.parse(text);
    } catch {
      return fail('invalid', `malformed JSON: ${preview(text)}`);
    }
  }
  if (!isObject(value)) {
    return fail('invalid', `not a GeoJSON object: ${preview(String(value))}`);
  }

  let geometry: unknown = value;
  let properties: Record<string, unknown> | undefined;
  if (value.type === 'Feature') {
    if (value.geometry === null || value.geometry === undefined) {
      return fail('empty', 'Feature without geometry');
    }
    geometry = value.geometry;
    properties = isObject(value.properties) ? value.properties : undefined;
  }
  if (!isObject(geometry)) {
    return fail('invalid', 'geometry is not an object');
  }

  const type = geometry.type;
  if (!isSupportedGeometryType(type)) {
    return typeof type === 'string' && GEOJSON_TYPES.has(type)
      ? fail('unsupported', `${type} is not supported`)
      : fail('invalid', `unknown geometry type: ${preview(String(type))}`);
  }

  const crs = crsName(geometry) ?? crsName(value);
  if (crs !== undefined && !WGS84_CRS.test(crs)) {
    return fail('projected', `${crs}; transform to EPSG:4326 with ST_Transform(geom, 4326)`);
  }

  const coordinates = geometry.coordinates;
  if (Array.isArray(coordinates) && coordinates.length === 0) {
    return fail('empty', `empty ${type}`);
  }
  // Grown by checkCoordinates as it visits each position, so bounds cost no extra pass.
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const problem = checkCoordinates(coordinates, COORDINATE_DEPTH[type], bounds);
  if (problem) {
    return problem === 'outOfRange'
      ? fail('outOfRange', 'coordinates outside lon ±180 / lat ±90; is the data in EPSG:4326?')
      : fail('invalid', `${type} coordinates are malformed`);
  }

  // A clean object: drops crs/bbox and never aliases a value owned by the data frame.
  return { ok: true, geometry: { type, coordinates } as SupportedGeometry, bounds, properties };
}

/** Cheap check used to recognize a geometry column by its content. */
export function looksLikeGeoJson(raw: unknown): boolean {
  let value = raw;
  if (typeof raw === 'string') {
    const text = raw.trimStart();
    if (!text.startsWith('{')) {
      return false;
    }
    try {
      value = JSON.parse(text);
    } catch {
      return false;
    }
  }
  return isObject(value) && typeof value.type === 'string' && GEOJSON_TYPES.has(value.type);
}

/** Hex WKB/EWKB, as PostGIS returns a raw geometry column. */
export function looksLikeWkbHex(raw: unknown): boolean {
  return typeof raw === 'string' && raw.length % 2 === 0 && WKB_HEX.test(raw);
}

// Returns undefined when valid, 'outOfRange' for lon/lat outside WGS84 bounds, 'malformed' otherwise.
// Grows `bounds` to cover each valid position.
function checkCoordinates(coordinates: unknown, depth: number, bounds: Bounds): 'malformed' | 'outOfRange' | undefined {
  if (!Array.isArray(coordinates)) {
    return 'malformed';
  }
  if (depth === 0) {
    if (coordinates.length < 2) {
      return 'malformed';
    }
    for (const n of coordinates) {
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        return 'malformed';
      }
    }
    const [lon, lat] = coordinates as number[];
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      return 'outOfRange';
    }
    bounds[0] = Math.min(bounds[0], lon);
    bounds[1] = Math.min(bounds[1], lat);
    bounds[2] = Math.max(bounds[2], lon);
    bounds[3] = Math.max(bounds[3], lat);
    return undefined;
  }
  let outOfRange = false;
  for (const child of coordinates) {
    const problem = checkCoordinates(child, depth - 1, bounds);
    if (problem === 'malformed') {
      return problem;
    }
    outOfRange ||= problem === 'outOfRange';
  }
  return outOfRange ? 'outOfRange' : undefined;
}

function crsName(value: Record<string, unknown>): string | undefined {
  const crs = value.crs;
  if (isObject(crs) && isObject(crs.properties) && typeof crs.properties.name === 'string') {
    return crs.properties.name;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(kind: WarningKind, detail: string): ParsedGeometry {
  return { ok: false, kind, detail };
}

function preview(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
