// Engine contract: the subset of docs/architecture.md §2.4 built so far (docs/phase_2.md and
// docs/phase_3.md, Design §1). fitToData and featureClick arrive with the phases that need them.
import type { FeatureCollection, SupportedGeometry } from '../model';

export type BasemapSpec =
  | { kind: 'osm' }
  | { kind: 'raster'; tiles: string[]; attribution: string; maxZoom?: number }
  | { kind: 'style'; url: string }
  | { kind: 'none' };

export interface ViewState {
  center: [lon: number, lat: number];
  zoom: number;
}

/** Plain values, never a Grafana theme object. */
export interface EngineTheme {
  dark: boolean;
  /** CSS color shown where there are no tiles, and as the whole map for the `none` basemap. */
  background: string;
}

/** How a layer's features are drawn. Colors are resolved CSS colors, never theme names. */
export interface LayerStyle {
  color: string;
  /** Polygon fill, 0–1. */
  fillOpacity: number;
  /** Lines, px. Polygon outlines are always 1 px. */
  lineWidth: number;
  /** Points, px. */
  pointRadius: number;
  /** Point stroke, for contrast with the basemap. */
  outlineColor: string;
}

/** One set of features drawn together; Phase 3 makes one per data frame. */
export interface LayerSpec {
  /** Stable across refreshes, so the engine updates the layer instead of replacing it. */
  id: string;
  data: FeatureCollection<SupportedGeometry>;
  style: LayerStyle;
  /** Hover and click report this layer's features, and the pointer turns into a hand over them. */
  interactive: boolean;
}

/** A drawn feature: its layer and its MapLibre feature id. */
export interface FeatureRef {
  layerId: string;
  featureId: number;
}

/** Where the pointer is, and the features under it, topmost first. Empty over empty map. */
export interface PointerHit {
  lngLat: [lon: number, lat: number];
  features: FeatureRef[];
}

export interface EngineOptions {
  view: ViewState;
  basemap: BasemapSpec;
  theme: EngineTheme;
  layers: LayerSpec[];
}

export interface EngineError {
  message: string;
  /** The style source that failed, when MapLibre reports one (for example a tile source). */
  sourceId?: string;
  /** The data layer whose features failed to load, when the error came from one. */
  layerId?: string;
}

export interface EngineEvents {
  viewChange: ViewState;
  /**
   * The pointer moved: at most once per animation frame while it's over interactive features, and
   * once with no features when it leaves them or the map.
   */
  hover: PointerHit;
  click: PointerHit;
  error: EngineError;
  /**
   * The browser took the map's WebGL context away, usually because the page has too many (Chromium
   * allows 16). The map stays blank until it is destroyed and created again.
   */
  contextLost: undefined;
}

export interface MapEngine {
  /** Creates the map in `container`. Rejects with WebGLUnavailableError when WebGL2 is missing. */
  mount(container: HTMLElement, options: EngineOptions): Promise<void>;
  /** Replaces the basemap without recreating the map; the camera is kept. */
  setBasemap(basemap: BasemapSpec): void;
  setTheme(theme: EngineTheme): void;
  setView(view: ViewState): void;
  /**
   * Replaces the drawn layers, updating the map in place: unchanged layers are left alone, and new
   * data (compared by reference) or styles are applied to existing ones. Array order is drawing
   * order, last on top; layers always draw above the basemap.
   */
  setLayers(layers: LayerSpec[]): void;
  /**
   * Shows `content` in the tooltip anchored at lngLat, replacing what was there; the same content
   * element only moves it. A tooltip that isn't interactive lets the pointer through, so it never
   * blocks hovering the map. The caller owns `content`.
   */
  openTooltip(lngLat: [lon: number, lat: number], content: HTMLElement, options: { interactive: boolean }): void;
  closeTooltip(): void;
  /** Highlights the hovered feature; undefined clears it. */
  setHovered(feature: FeatureRef | undefined): void;
  /** Highlights the selected (pinned) feature; undefined clears it. Independent of the hovered one. */
  setSelected(feature: FeatureRef | undefined): void;
  resize(): void;
  // Test hook: e2e tests can't see features on the WebGL canvas, so they read these counts
  // through MapPanel's inspect event (docs/phase_3.md, Design §5). Nothing else calls it.
  /**
   * Waits until the map has finished drawing, then counts the distinct features drawn in the
   * current view, per layer id.
   */
  renderedFeatureCounts(): Promise<Record<string, number>>;
  /** Returns a function that removes the listener. */
  on<E extends keyof EngineEvents>(event: E, listener: (payload: EngineEvents[E]) => void): () => void;
  destroy(): void;
}
