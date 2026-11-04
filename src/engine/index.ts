// Framework-neutral map engine (docs/architecture.md §2.4, docs/phase_2.md).
// Must not import @grafana/*, React, or the panel/adapter layers; enforced by eslint.config.mjs.
import { MapEngine } from './types';

export { WebGLUnavailableError } from './errors';
export { DEFAULT_LAYER_STYLE } from './layerStyle';
export type {
  BasemapSpec,
  EngineError,
  EngineEvents,
  EngineOptions,
  EngineTheme,
  FeatureRef,
  LayerSpec,
  LayerStyle,
  MapEngine,
  PointerHit,
  ViewState,
} from './types';

/**
 * Loads MapLibre on first use. Webpack puts MapLibre, its CSS and the engine in a separate chunk,
 * so dashboards without a GeoFlow panel never download it (docs/phase_2.md, Design §4).
 */
export async function createMapEngine(): Promise<MapEngine> {
  const { MapLibreEngine } = await import(/* webpackChunkName: "maplibre" */ './maplibre/MapLibreEngine');
  return new MapLibreEngine();
}
