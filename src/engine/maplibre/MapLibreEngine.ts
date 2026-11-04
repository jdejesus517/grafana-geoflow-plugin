// MapEngine implemented with MapLibre GL JS (docs/phase_2.md, Design §3). This module imports
// MapLibre statically; createMapEngine loads it lazily, so MapLibre and its CSS stay out of the
// plugin's initial chunk.
import {
  GeoJSONSource,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
  NavigationControl,
  StyleSpecification,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, basemapStyle, rasterPaint } from '../basemapStyle';
import { WebGLUnavailableError } from '../errors';
import { STYLE_LAYER_KINDS, dataSourceId, paintFor, styleLayerId, styleLayerIds, styleLayers } from '../layerStyle';
import {
  BasemapSpec,
  EngineEvents,
  EngineOptions,
  EngineTheme,
  LayerSpec,
  LayerStyle,
  MapEngine,
  ViewState,
} from '../types';
import { workerUrl } from './workerUrl';

/** Errors from the same source are forwarded at most once per this interval. */
export const ERROR_THROTTLE_MS = 10_000;

let workerUrlSet = false;

type PaintProperty = Parameters<MapLibreMap['setPaintProperty']>[1];

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
  /** Sources and layers can only be added once the style has loaded. */
  private styleReady = false;
  private readonly lastErrorAt = new Map<string, number>();
  private readonly listeners: Listeners = { viewChange: new Set(), error: new Set(), contextLost: new Set() };

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
    this.map?.remove();
    this.map = undefined;
    this.applied.clear();
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
        if (current.style !== spec.style) {
          this.repaint(map, spec.id, current.style, spec.style);
        }
      }
      // A Map keeps the position of existing keys and appends new ones, like the map's layers.
      this.applied.set(spec.id, spec);
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

  private repaint(map: MapLibreMap, id: string, from: LayerStyle, to: LayerStyle): void {
    const before = paintFor(from);
    const after = paintFor(to);
    for (const kind of STYLE_LAYER_KINDS) {
      for (const [property, value] of Object.entries(after[kind])) {
        if (before[kind][property] !== value) {
          map.setPaintProperty(styleLayerId(id, kind), property as PaintProperty, value);
        }
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
    this.emit('error', { message: error?.message ?? 'Unknown map error', ...(sourceId && { sourceId }) });
  }

  private emit<E extends keyof EngineEvents>(event: E, payload: EngineEvents[E]): void {
    for (const listener of this.listeners[event]) {
      listener(payload);
    }
  }
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
