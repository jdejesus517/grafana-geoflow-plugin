// Grafana DataFrame → GeoJSON adapter (docs/architecture.md §2.3).
export { buildLayerSpecs } from './buildLayerSpecs';
export type { LayerDefaults } from './buildLayerSpecs';
export { detectGeometryField } from './detectGeometryField';
export { EMPTY_VALUE, featureDetails } from './featureDetails';
export type { FeatureDetailItem, FeatureDetails } from './featureDetails';
export { featureByKey, featureKey, featureRow } from './featureLookup';
export type { GeometryFieldDetection, NoGeometryReason } from './detectGeometryField';
export { MAX_WARNING_SAMPLES, frameToFeatureCollection, framesToFeatureCollections } from './frameToFeatureCollection';
export type {
  ConversionResult,
  ConversionWarnings,
  FeatureKey,
  GeometryMapping,
  WarningSample,
} from './frameToFeatureCollection';
export { parseGeometry } from './parseGeometry';
export type { ParsedGeometry, WarningKind } from './parseGeometry';
