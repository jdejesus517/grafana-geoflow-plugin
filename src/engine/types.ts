// Engine contract: the subset of docs/architecture.md §2.4 built so far (docs/phase_2.md and
// docs/phase_3.md, Design §1), with fitBounds from Phase 8.
import type { Bounds, FeatureCollection, SupportedGeometry } from '../model';

/**
 * Query parameters added to every request the basemap makes to one host: its style, tiles, fonts
 * and sprites. Keyed providers need their key on all of them (docs/phase_12.md, Design §1).
 */
export interface RequestParams {
  /** The exact host, such as `tiles.stadiamaps.com`. Requests to other hosts are left alone. */
  host: string;
  params: Record<string, string>;
}

/** A provider's logo, shown beside the attribution while its basemap is in use. */
export interface BasemapLogo {
  href: string;
  src: string;
  alt: string;
}

export type BasemapSpec =
  | { kind: 'osm' }
  | {
      kind: 'raster';
      tiles: string[];
      /** Plain text, unless `attributionHtml`. */
      attribution: string;
      maxZoom?: number;
      /** Default true: dims the tiles in dark theme. False for tiles that are dark already. */
      dimInDark?: boolean;
      /**
       * The attribution is HTML, shown as it is. Only for attributions written in the plugin (presets),
       * never for one typed by a dashboard editor.
       */
      attributionHtml?: boolean;
      requestParams?: RequestParams;
      logo?: BasemapLogo;
    }
  | { kind: 'style'; url: string; requestParams?: RequestParams; logo?: BasemapLogo }
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

/**
 * The pattern of lines. Dashed and dotted are fixed patterns; custom is dash and gap lengths in
 * pixels, an even number of them (docs/phase_5.md, Design §4).
 */
export type LineStyle = { kind: 'solid' | 'dash' | 'dot' } | { kind: 'custom'; pattern: number[] };

/** How a layer's features are drawn. Colors are resolved CSS colors, never theme names. */
export interface LayerStyle {
  color: string;
  /** The whole layer, 0–1: lines, points, outlines and fills. */
  opacity: number;
  /** Polygon fill, 0–1, before `opacity`. */
  fillOpacity: number;
  /** Lines, px. Polygon outlines are always 1 px. */
  lineWidth: number;
  /** Lines only; polygon outlines are always solid. */
  lineStyle: LineStyle;
  /** Points, px. */
  pointRadius: number;
  /** Point stroke, for contrast with the basemap. */
  outlineColor: string;
}

/**
 * Per-feature overrides of a layer's style, in feature order (`data.features`). An undefined
 * entry, or a missing array, keeps the layer's style (docs/phase_6.md, Design §3).
 */
export interface FeatureStyles {
  /** CSS colors for points, lines, outlines and fills. */
  colors?: Array<string | undefined>;
  /** Point radii, px. */
  radii?: Array<number | undefined>;
  /** Line widths, px: edge lines sized by a column (docs/node-edge/phase_5.md, Design §3). Polygon outlines stay 1 px. */
  widths?: Array<number | undefined>;
}

/** One set of features drawn together: the panel makes one per layer in its Layers list. */
export interface LayerSpec {
  /** Stable across refreshes, so the engine updates the layer instead of replacing it. */
  id: string;
  /** What the user calls the layer. The engine doesn't use it; it travels with the spec. */
  name: string;
  /** A hidden layer keeps its data and feature-state, so showing it again reloads nothing. */
  visible: boolean;
  data: FeatureCollection<SupportedGeometry>;
  style: LayerStyle;
  /** Colors and sizes from data (Phase 6), applied without reloading `data`. */
  featureStyles?: FeatureStyles;
  /**
   * Hover and click report this layer's features, and the pointer turns into a hand over them.
   * Hidden layers never do.
   */
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

export interface FitOptions {
  padding: number;
  maxZoom: number;
}

export interface EngineOptions {
  view: ViewState;
  /** Framed at once instead of `view`, before anything is drawn. */
  fit?: FitOptions & { bounds: Bounds };
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
  /**
   * The CSS the map needs. The host applies it scoped under an ancestor of the container, before
   * `mount`, so it styles the map and nothing else on the page.
   */
  readonly stylesheet: string;
  /** Creates the map in `container`. Rejects with WebGLUnavailableError when WebGL2 is missing. */
  mount(container: HTMLElement, options: EngineOptions): Promise<void>;
  /** Replaces the basemap without recreating the map; the camera is kept. */
  setBasemap(basemap: BasemapSpec): void;
  setTheme(theme: EngineTheme): void;
  setView(view: ViewState): void;
  /**
   * Frames `bounds` at once, without animation, leaving `padding` px around them where the map is
   * big enough, and zooming in no closer than `maxZoom`. Bounds of a single point center it at
   * `maxZoom`.
   */
  fitBounds(bounds: Bounds, options: FitOptions): void;
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
  /**
   * The largest tooltip, in pixels, that fits inside the map when anchored at lngLat in the
   * current view. The tooltip opens on whichever side of the point has room for it, so content
   * kept within this size is never cut off by the map's edges.
   */
  tooltipSpace(lngLat: [lon: number, lat: number]): { width: number; height: number };
  closeTooltip(): void;
  /** Highlights the hovered feature; undefined clears it. */
  setHovered(feature: FeatureRef | undefined): void;
  /** Highlights the selected (pinned) feature; undefined clears it. Independent of the hovered one. */
  setSelected(feature: FeatureRef | undefined): void;
  resize(): void;
  /**
   * Whether the browser draws the map without a GPU, as far as it says: browsers can mask the
   * renderer's name. False before the map exists.
   */
  softwareRendering(): boolean;
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
