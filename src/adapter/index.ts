// Grafana DataFrame → GeoJSON adapter (docs/architecture.md §2.3).
export { DEFAULT_LAYER_BINDING, bindLayers, bindPerFrame, frameRefId, networkLayers } from './bindLayers';
export type { BoundLayer, LayerBinding, LayerConfig, LayerRole, NetworkLayers } from './bindLayers';
export { DETECTED_NAMES, detectEdgeFields } from './detectEdgeFields';
export type { EdgeFieldDetection } from './detectEdgeFields';
export { NODE_WARNING_KINDS, emptyEdgeResult, joinEdges } from './joinEdges';
export type { EdgeLayerColumns } from './joinEdges';
export { buildLayerSpecs } from './buildLayerSpecs';
export { DASH_PATTERN_EXAMPLE, dashPatternProblem, parseDashPattern } from './dashPattern';
export { MAP_STYLE_RANGES, layerStyle } from './layerStyle';
export type { LineStyleOption, MapStyleConfig } from './layerStyle';
export { detectGeometryField } from './detectGeometryField';
export { dataStyleFields, featureStyles } from './featureStyles';
export type { DataStyleFields } from './featureStyles';
export { EMPTY_VALUE, featureDetails } from './featureDetails';
export { EDGE_AGGREGATES, pairDetails } from './pairDetails';
export type { EdgeAggregate, EdgeFieldConfig } from './pairDetails';
export type { FeatureDetailItem, FeatureDetails } from './featureDetails';
export { featureByKey, featureIndex, featureKey } from './featureLookup';
export { legendEntries } from './legend';
export type { LegendEntry, LegendItem } from './legend';
export type { GeometryFieldDetection, NoGeometryReason } from './detectGeometryField';
export {
  MAX_WARNING_SAMPLES,
  defaultIdField,
  emptyWarningCounts,
  frameToFeatureCollection,
  styleFieldOf,
} from './frameToFeatureCollection';
export type {
  ConversionResult,
  ConversionWarnings,
  EdgePair,
  FeatureKey,
  GeometryMapping,
  WarningSample,
} from './frameToFeatureCollection';
export { parseGeometry } from './parseGeometry';
export type { ParsedGeometry, WarningKind } from './parseGeometry';
