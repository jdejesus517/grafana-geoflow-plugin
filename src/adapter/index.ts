// Grafana DataFrame → GeoJSON adapter (docs/architecture.md §2.3).
export { DEFAULT_LAYER_BINDING, bindLayers, bindPerFrame } from './bindLayers';
export type { BoundLayer, LayerBinding, LayerConfig } from './bindLayers';
export { buildLayerSpecs } from './buildLayerSpecs';
export { DASH_PATTERN_EXAMPLE, dashPatternProblem, parseDashPattern } from './dashPattern';
export { LINE_STYLE_OPTIONS, MAP_STYLE_RANGES, layerStyle } from './layerStyle';
export type { LineStyleOption, MapStyleConfig } from './layerStyle';
export { detectGeometryField } from './detectGeometryField';
export { dataStyleFields, featureStyles } from './featureStyles';
export type { DataStyleFields } from './featureStyles';
export { EMPTY_VALUE, featureDetails } from './featureDetails';
export type { FeatureDetailItem, FeatureDetails } from './featureDetails';
export { featureByKey, featureIndex, featureKey, featureRow } from './featureLookup';
export { legendEntries } from './legend';
export type { LegendEntry, LegendItem } from './legend';
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
