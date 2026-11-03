// Engine contract: the Phase 2 subset of docs/architecture.md §2.4 (docs/phase_2.md, Design §1).
// setLayers, fitToData and featureClick arrive with the phases that need them.

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

export interface EngineOptions {
  view: ViewState;
  basemap: BasemapSpec;
  theme: EngineTheme;
}

export interface EngineError {
  message: string;
  /** The style source that failed, when MapLibre reports one (for example a tile source). */
  sourceId?: string;
}

export interface EngineEvents {
  viewChange: ViewState;
  error: EngineError;
}

export interface MapEngine {
  /** Creates the map in `container`. Rejects with WebGLUnavailableError when WebGL2 is missing. */
  mount(container: HTMLElement, options: EngineOptions): Promise<void>;
  /** Replaces the basemap without recreating the map; the camera is kept. */
  setBasemap(basemap: BasemapSpec): void;
  setTheme(theme: EngineTheme): void;
  setView(view: ViewState): void;
  resize(): void;
  /** Returns a function that removes the listener. */
  on<E extends keyof EngineEvents>(event: E, listener: (payload: EngineEvents[E]) => void): () => void;
  destroy(): void;
}
