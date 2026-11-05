// Grafana DataFrame → GeoJSON adapter (docs/architecture.md §2.3).
export { buildLayerSpecs } from './buildLayerSpecs';
export { DASH_PATTERN_EXAMPLE, dashPatternProblem, parseDashPattern } from './dashPattern';
export { LINE_STYLE_OPTIONS, MAP_STYLE_RANGES, layerStyle } from './layerStyle';
export type { LineStyleOption, MapStyleConfig } from './layerStyle';
export { detectGeometryField } from './detectGeometryField';
export { dataStyleFields, featureStyles } from './featureStyles';
export type { DataStyleFields } from './featureStyles';
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
