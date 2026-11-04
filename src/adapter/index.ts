// Grafana DataFrame → GeoJSON adapter (docs/architecture.md §2.3).
export { buildLayerSpecs } from './buildLayerSpecs';
export type { LayerDefaults } from './buildLayerSpecs';
export { detectGeometryField } from './detectGeometryField';
export type { GeometryFieldDetection, NoGeometryReason } from './detectGeometryField';
export { MAX_WARNING_SAMPLES, frameToFeatureCollection, framesToFeatureCollections } from './frameToFeatureCollection';
export type { ConversionResult, ConversionWarnings, GeometryMapping, WarningSample } from './frameToFeatureCollection';
export { parseGeometry } from './parseGeometry';
export type { ParsedGeometry, WarningKind } from './parseGeometry';
