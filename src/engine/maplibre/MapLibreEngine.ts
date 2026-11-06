// MapEngine implemented with MapLibre GL JS (docs/phase_2.md, Design §3). This module imports
// MapLibre statically; createMapEngine loads it lazily, so MapLibre and its CSS stay out of the
// plugin's initial chunk.
import {
  GeoJSONSource,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
  MapMouseEvent,
  NavigationControl,
  Popup,
  StyleSpecification,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, basemapStyle, rasterPaint } from '../basemapStyle';
import { WebGLUnavailableError } from '../errors';
import { StyledFeatures, featureStateChanges } from '../featureState';
import {
  HOVERED_STATE,
  SELECTED_STATE,
  STYLE_LAYER_KINDS,
  dataSourceId,
  layoutFor,
  paintFor,
  perFeature,
  styleLayerId,
  styleLayerIds,
  styleLayers,
} from '../layerStyle';
import {
  BasemapSpec,
  EngineEvents,
  EngineOptions,
  EngineTheme,
  FeatureRef,
  LayerSpec,
  MapEngine,
  PointerHit,
  ViewState,
} from '../types';
import { workerUrl } from './workerUrl';

/** Errors from the same source are forwarded at most once per this interval. */
export const ERROR_THROTTLE_MS = 10_000;

/** Hover and click look this many pixels around the pointer, so 2 px lines can be hit. */
export const HIT_TOLERANCE_PX = 4;

/** Keeps the hover tooltip clear of the pointer. */
const TOOLTIP_OFFSET_PX = 12;
/** The least distance between the tooltip and the map's edges. */
export const TOOLTIP_MARGIN_PX = 8;

let workerUrlSet = false;

type PaintProperty = Parameters<MapLibreMap['setPaintProperty']>[1];
type LayoutProperty = Parameters<MapLibreMap['setLayoutProperty']>[1];

type Listeners = { [E in keyof EngineEvents]: Set<(payload: EngineEvents[E]) => void> };

export class MapLibreEngine implements MapEngine {
  private map?: MapLibreMap;
  private destroyed = false;
  private basemap: BasemapSpec = { kind: 'none' };
  private basemapKey = '';
  private theme: EngineTheme = { dark: false, background: 'transparent' };
  /** The layers asked for. */
  private layers: LayerSpec[] = [];
  /** The layers on the map, in drawing order. Differs from `layers` until the style is ready. */
  private applied = new Map<string, LayerSpec>();
  /**
   * Per layer, the per-feature styles set as feature-state, and the source they were set on. A
   * style loaded from scratch brings new sources without any state, so a different source
   * object means nothing is set.
   */
  private featureStates = new Map<string, StyledFeatures & { source: object }>();
  /** Sources and layers can only be added once the style has loaded. */
  private styleReady = false;
  private readonly lastErrorAt = new Map<string, number>();
  private readonly listeners: Listeners = {
    viewChange: new Set(),
    error: new Set(),
    contextLost: new Set(),
    hover: new Set(),
    click: new Set(),
  };
  private tooltip?: Popup;
  private tooltipContent?: HTMLElement;
  private readonly highlights: Record<typeof HOVERED_STATE | typeof SELECTED_STATE, FeatureRef | undefined> = {
    hovered: undefined,
    selected: undefined,
  };
  /** The latest pointer move, waiting for the next animation frame. */
  private pendingMove?: MapMouseEvent;
  private moveFrame?: number;
  /** Whether the last hover event had features, so leaving them is reported once. */
  private overFeatures = false;
  private lastPointer: [number, number] = [0, 0];

  async mount(container: HTMLElement, { view, basemap, theme, layers }: EngineOptions): Promise<void> {
    if (this.destroyed || this.map) {
      return;
    }
    if (!hasWebGL2()) {
      throw new WebGLUnavailableError();
    }
    if (!workerUrlSet) {
      setWorkerUrl(workerUrl);
      workerUrlSet = true;
    }

    this.basemap = basemap;
    this.basemapKey = JSON.stringify(basemap);
    this.theme = theme;
    this.layers = layers;
    const map = new MapLibreMap({
      container,
      style: basemapStyle(basemap, theme),
      // Also used by every later setStyle, so data layers survive basemap changes.
      transformStyle: (_previous, next) => this.withDataLayers(next),
      center: view.center,
      zoom: view.zoom,
      attributionControl: { compact: true },
      // Asset maps stay north-up and flat.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }));

    map.on('moveend', () => {
      const { lng, lat } = map.getCenter();
      this.emit('viewChange', { center: [lng, lat], zoom: map.getZoom() });
    });
    map.on('error', (event) => this.forwardError(event.error, (event as { sourceId?: string }).sourceId));
    // MapLibre also fires a synthetic, immediately restored loss when it restarts its workers;
    // only a loss reported by the browser is real.
    map.on('webglcontextlost', (event) => {
      if (event.originalEvent?.isTrusted) {
        this.emit('contextLost', undefined);
      }
    });
    map.on('click', (event) => {
      if (this.fromCanvas(event)) {
        this.emit('click', this.hitTest(event));
      }
    });
    map.on('mousemove', (event) => this.queueMove(event));
    map.on('mouseout', () => this.leave());
    // MapLibre fires styledataloading when it starts loading a new style from scratch, and
    // style.load both when that finishes and after a basemap change it applied in place. Theme
    // and layer changes made in between are applied on style.load.
    map.on('styledataloading', () => (this.styleReady = false));
    map.on('style.load', () => {
      this.styleReady = true;
      this.applyTheme();
      this.syncLayers();
    });
    this.map = map;
  }

  setBasemap(basemap: BasemapSpec): void {
    const key = JSON.stringify(basemap);
    if (key === this.basemapKey) {
      return;
    }
    this.basemap = basemap;
    this.basemapKey = key;
    // Inline styles are diffed by MapLibre; the camera is kept either way. The transformStyle
    // given at mount adds the data layers to the new style.
    this.map?.setStyle(basemapStyle(basemap, this.theme));
  }

  setTheme(theme: EngineTheme): void {
    if (theme.dark === this.theme.dark && theme.background === this.theme.background) {
      return;
    }
    this.theme = theme;
    this.applyTheme();
  }

  setView(view: ViewState): void {
    this.map?.jumpTo({ center: view.center, zoom: view.zoom });
  }

  setLayers(layers: LayerSpec[]): void {
    this.layers = layers;
    this.syncLayers();
  }

  openTooltip(lngLat: [number, number], content: HTMLElement, { interactive }: { interactive: boolean }): void {
    const map = this.map;
    if (!map) {
      return;
    }
    // The panel renders the content and positions nothing; MapLibre keeps it anchored as the map
    // moves (docs/phase_4.md, Design §4).
    this.tooltip ??= new Popup({
      closeButton: false,
      closeOnClick: false,
      closeOnMove: false,
      maxWidth: 'none',
      offset: TOOLTIP_OFFSET_PX,
      // MapLibre opens the tooltip on the side of the point that has room for it, keeping this
      // far from the edges; tooltipSpace sizes it to fit there.
      padding: { top: TOOLTIP_MARGIN_PX, right: TOOLTIP_MARGIN_PX, bottom: TOOLTIP_MARGIN_PX, left: TOOLTIP_MARGIN_PX },
      className: 'geoflow-tooltip',
    });
    const tooltip = this.tooltip;
    if (this.tooltipContent !== content) {
      tooltip.setDOMContent(content);
      this.tooltipContent = content;
    }
    tooltip.setLngLat(lngLat);
    if (!tooltip.isOpen()) {
      tooltip.addTo(map);
    }
    // A hover tooltip lets the pointer through to the map underneath.
    tooltip.getElement().style.pointerEvents = interactive ? '' : 'none';
  }

  tooltipSpace(lngLat: [number, number]): { width: number; height: number } {
    const map = this.map;
    if (!map) {
      return { width: 0, height: 0 };
    }
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const { x, y } = map.project(lngLat);
    // MapLibre's anchoring puts the tooltip above the point when it fits there, otherwise below.
    // Across, it centers the tooltip on the point when it fits that way, otherwise puts it beside
    // the point, away from the nearer edge. A tooltip within this size fits wherever it goes.
    const beside = (at: number, size: number) => Math.max(at, size - at) - TOOLTIP_MARGIN_PX - TOOLTIP_OFFSET_PX;
    const centered = 2 * Math.min(x, width - x) - 2 * TOOLTIP_MARGIN_PX;
    const room = (pixels: number) => Math.max(0, Math.floor(pixels));
    return { width: room(Math.max(centered, beside(x, width))), height: room(beside(y, height)) };
  }

  closeTooltip(): void {
    this.tooltip?.remove();
    this.tooltipContent = undefined;
  }

  setHovered(feature: FeatureRef | undefined): void {
    this.highlight(HOVERED_STATE, feature);
  }

  setSelected(feature: FeatureRef | undefined): void {
    this.highlight(SELECTED_STATE, feature);
  }

  resize(): void {
    this.map?.resize();
  }

  // Test hook: see MapEngine.renderedFeatureCounts. Only e2e tests call it.
  async renderedFeatureCounts(): Promise<Record<string, number>> {
    const map = this.map;
    if (!map) {
      return {};
    }
    // Idle: every tile loaded and drawn, and no camera movement.
    if (!map.loaded() || map.isMoving()) {
      await map.once('idle');
    }
    if (this.map !== map) {
      return {};
    }
    const counts: Record<string, number> = {};
    const idsBySource = new Map<string, Set<unknown>>();
    for (const { id } of this.layers) {
      counts[id] = 0;
      idsBySource.set(dataSourceId(id), new Set());
    }
    const layerIds = this.layers.flatMap(({ id }) => styleLayerIds(id)).filter((id) => map.getLayer(id));
    // A feature comes back once per tile it touches and once per style layer it's drawn in
    // (a polygon's fill and outline), so count distinct ids.
    for (const feature of layerIds.length > 0 ? map.queryRenderedFeatures({ layers: layerIds }) : []) {
      idsBySource.get(feature.source)?.add(feature.id);
    }
    for (const { id } of this.layers) {
      counts[id] = idsBySource.get(dataSourceId(id))!.size;
    }
    return counts;
  }

  on<E extends keyof EngineEvents>(event: E, listener: (payload: EngineEvents[E]) => void): () => void {
    const listeners = this.listeners[event] as Set<typeof listener>;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.moveFrame !== undefined) {
      cancelAnimationFrame(this.moveFrame);
    }
    this.closeTooltip();
    this.map?.remove();
    this.map = undefined;
    this.applied.clear();
    this.featureStates.clear();
    for (const listeners of Object.values(this.listeners)) {
      listeners.clear();
    }
  }

  private applyTheme(): void {
    const map = this.map;
    // A style URL controls its own look; theme dimming doesn't apply.
    if (!map || this.basemap.kind === 'style') {
      return;
    }
    if (map.getLayer(BACKGROUND_LAYER_ID)) {
      map.setPaintProperty(BACKGROUND_LAYER_ID, 'background-color', this.theme.background);
    }
    if (map.getLayer(BASEMAP_RASTER_LAYER_ID)) {
      for (const [property, value] of Object.entries(rasterPaint(this.theme))) {
        map.setPaintProperty(BASEMAP_RASTER_LAYER_ID, property as PaintProperty, value);
      }
    }
  }

  /** The style plus a source and four style layers per data layer, drawn above everything else. */
  private withDataLayers(style: StyleSpecification): StyleSpecification {
    this.applied = new Map(this.layers.map((spec) => [spec.id, spec]));
    return {
      ...style,
      sources: {
        ...style.sources,
        ...Object.fromEntries(this.layers.map((spec) => [dataSourceId(spec.id), geoJsonSource(spec)])),
      },
      layers: [...style.layers, ...this.layers.flatMap(styleLayers)],
    };
  }

  /**
   * Brings the map's data layers in line with `layers`, touching only what changed (docs/phase_3.md,
   * Design §3). Data is compared by reference: the panel hands over a new object only when a
   * frame changed.
   */
  private syncLayers(): void {
    const map = this.map;
    if (!map || !this.styleReady) {
      return;
    }
    const wanted = new Set(this.layers.map(({ id }) => id));
    for (const id of [...this.applied.keys()].filter((id) => !wanted.has(id))) {
      for (const layerId of styleLayerIds(id)) {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      }
      if (map.getSource(dataSourceId(id))) {
        map.removeSource(dataSourceId(id));
      }
      this.applied.delete(id);
      this.featureStates.delete(id);
    }

    for (const spec of this.layers) {
      const current = this.applied.get(spec.id);
      if (!current) {
        // New layers go on top, which is where they belong in the order below.
        map.addSource(dataSourceId(spec.id), geoJsonSource(spec));
        for (const layer of styleLayers(spec)) {
          map.addLayer(layer);
        }
      } else {
        if (current.data !== spec.data) {
          map.getSource<GeoJSONSource>(dataSourceId(spec.id))?.setData(spec.data);
        }
        if (current.style !== spec.style || !samePerFeature(current, spec)) {
          this.repaint(map, current, spec);
        }
      }
      // A Map keeps the position of existing keys and appends new ones, like the map's layers.
      this.applied.set(spec.id, spec);
      this.syncFeatureStates(map, spec);
    }

    const order = this.layers.map(({ id }) => id);
    if ([...this.applied.keys()].some((id, i) => id !== order[i])) {
      // Moving a layer without a target puts it on top; going through in order restacks them all.
      for (const layerId of order.flatMap(styleLayerIds)) {
        map.moveLayer(layerId);
      }
      this.applied = new Map(this.layers.map((spec) => [spec.id, spec]));
    }
  }

  private repaint(map: MapLibreMap, from: LayerSpec, to: LayerSpec): void {
    const paint = [paintFor(from.style, perFeature(from)), paintFor(to.style, perFeature(to))] as const;
    const layout = [layoutFor(from.style), layoutFor(to.style)] as const;
    for (const kind of STYLE_LAYER_KINDS) {
      const layerId = styleLayerId(to.id, kind);
      for (const [property, value] of changed(paint[0][kind], paint[1][kind])) {
        map.setPaintProperty(layerId, property as PaintProperty, value);
      }
      for (const [property, value] of changed(layout[0][kind], layout[1][kind])) {
        map.setLayoutProperty(layerId, property as LayoutProperty, value);
      }
    }
  }

  /**
   * Sets the layer's per-feature styles as feature-state, calling MapLibre only for features
   * whose color or radius changed (docs/phase_6.md, Design §3).
   */
  private syncFeatureStates(map: MapLibreMap, spec: LayerSpec): void {
    const sourceId = dataSourceId(spec.id);
    const source = map.getSource(sourceId);
    if (!source) {
      return;
    }
    const before = this.featureStates.get(spec.id);
    const applied = before?.source === source ? before : undefined;
    if (applied?.data === spec.data && applied.featureStyles === spec.featureStyles) {
      return;
    }
    // A layer that never had per-feature styles has no state to diff.
    if (applied || spec.featureStyles) {
      for (const { id, set, remove } of featureStateChanges(applied, spec)) {
        if (set) {
          map.setFeatureState({ source: sourceId, id }, set);
        }
        for (const key of remove ?? []) {
          map.removeFeatureState({ source: sourceId, id }, key);
        }
      }
    }
    this.featureStates.set(spec.id, { source, data: spec.data, featureStyles: spec.featureStyles });
  }

  /** Interactive features under the pointer, topmost first, each once (docs/phase_4.md, Design §4). */
  private hitTest({ point, lngLat }: MapMouseEvent): PointerHit {
    const map = this.map!;
    const hit: PointerHit = { lngLat: [lngLat.lng, lngLat.lat], features: [] };
    const layers = this.layers
      .filter((spec) => spec.interactive)
      .flatMap(({ id }) => styleLayerIds(id))
      .filter((id) => map.getLayer(id));
    if (layers.length === 0) {
      return hit;
    }
    const layerBySource = new Map(this.layers.map(({ id }) => [dataSourceId(id), id]));
    const seen = new Set<string>();
    const t = HIT_TOLERANCE_PX;
    const box: [[number, number], [number, number]] = [
      [point.x - t, point.y - t],
      [point.x + t, point.y + t],
    ];
    // MapLibre returns features topmost first, once per tile and style layer.
    for (const feature of map.queryRenderedFeatures(box, { layers })) {
      const layerId = layerBySource.get(feature.source);
      const key = `${feature.source}\n${feature.id}`;
      if (layerId !== undefined && typeof feature.id === 'number' && !seen.has(key)) {
        seen.add(key);
        hit.features.push({ layerId, featureId: feature.id });
      }
    }
    return hit;
  }

  /** One hit test per animation frame, with the latest pointer position. */
  private queueMove(event: MapMouseEvent): void {
    this.pendingMove = event;
    this.moveFrame ??= requestAnimationFrame(() => {
      this.moveFrame = undefined;
      const move = this.pendingMove;
      this.pendingMove = undefined;
      if (!move || !this.map) {
        return;
      }
      const hit = this.hitTest(move);
      this.lastPointer = hit.lngLat;
      this.map.getCanvas().style.cursor = hit.features.length > 0 ? 'pointer' : '';
      // Over empty map, report leaving once rather than on every move.
      if (hit.features.length > 0 || this.overFeatures) {
        this.overFeatures = hit.features.length > 0;
        this.emit('hover', hit);
      }
    });
  }

  private leave(): void {
    if (this.moveFrame !== undefined) {
      cancelAnimationFrame(this.moveFrame);
      this.moveFrame = undefined;
    }
    this.pendingMove = undefined;
    if (this.map) {
      this.map.getCanvas().style.cursor = '';
    }
    if (this.overFeatures) {
      this.overFeatures = false;
      this.emit('hover', { lngLat: this.lastPointer, features: [] });
    }
  }

  /** Clicks inside a pinned tooltip land on its DOM, not the canvas; they aren't map clicks. */
  private fromCanvas(event: MapMouseEvent): boolean {
    const target = event.originalEvent?.target;
    return !(target instanceof Node) || this.map!.getCanvasContainer().contains(target);
  }

  private highlight(state: typeof HOVERED_STATE | typeof SELECTED_STATE, feature: FeatureRef | undefined): void {
    const previous = this.highlights[state];
    if (previous?.layerId === feature?.layerId && previous?.featureId === feature?.featureId) {
      return;
    }
    this.highlights[state] = feature;
    const map = this.map;
    if (!map) {
      return;
    }
    // A layer that's gone (or a style still loading) has no source to set state on.
    for (const [ref, value] of [
      [previous, false],
      [feature, true],
    ] as const) {
      if (ref && map.getSource(dataSourceId(ref.layerId))) {
        map.setFeatureState({ source: dataSourceId(ref.layerId), id: ref.featureId }, { [state]: value });
      }
    }
  }

  private forwardError(error: { message?: string } | undefined, sourceId: string | undefined): void {
    const key = sourceId ?? '';
    const now = Date.now();
    const last = this.lastErrorAt.get(key);
    if (last !== undefined && now - last < ERROR_THROTTLE_MS) {
      return;
    }
    this.lastErrorAt.set(key, now);
    // Data layer ids are never parsed out of source ids (see DATA_LAYER_PREFIX); look them up.
    const layerId = this.layers.find(({ id }) => dataSourceId(id) === sourceId)?.id;
    this.emit('error', {
      message: error?.message ?? 'Unknown map error',
      ...(sourceId && { sourceId }),
      ...(layerId !== undefined && { layerId }),
    });
  }

  private emit<E extends keyof EngineEvents>(event: E, payload: EngineEvents[E]): void {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }
}

/**
 * Properties whose value differs between two sets, with the new value; one that was removed comes
 * back as undefined, which resets it to MapLibre's default. Values can be expressions
 * (highlights) or arrays (dashes), so they're compared as JSON.
 */
function changed<V>(before: Record<string, V>, after: Record<string, V>): Array<[string, V | undefined]> {
  const properties = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...properties]
    .filter((property) => JSON.stringify(before[property]) !== JSON.stringify(after[property]))
    .map((property) => [property, after[property]]);
}

function samePerFeature(a: LayerSpec, b: LayerSpec): boolean {
  const [x, y] = [perFeature(a), perFeature(b)];
  return x.color === y.color && x.radius === y.radius;
}

function geoJsonSource(spec: LayerSpec): GeoJSONSourceSpecification {
  return { type: 'geojson', data: spec.data };
}

/**
 * Probes for WebGL2 before MapLibre does, so a missing context becomes a typed error instead of
 * an exception from inside the Map constructor. The probe context is released straight away:
 * browsers cap live WebGL contexts per page, and a dashboard can hold many map panels.
 */
function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}
