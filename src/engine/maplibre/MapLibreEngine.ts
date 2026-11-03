// MapEngine implemented with MapLibre GL JS (docs/phase_2.md, Design §3). This module imports
// MapLibre statically; createMapEngine loads it lazily, so MapLibre and its CSS stay out of the
// plugin's initial chunk.
import { Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, basemapStyle, rasterPaint } from '../basemapStyle';
import { WebGLUnavailableError } from '../errors';
import { BasemapSpec, EngineEvents, EngineOptions, EngineTheme, MapEngine, ViewState } from '../types';
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
  private readonly lastErrorAt = new Map<string, number>();
  private readonly listeners: Listeners = { viewChange: new Set(), error: new Set(), contextLost: new Set() };

  async mount(container: HTMLElement, { view, basemap, theme }: EngineOptions): Promise<void> {
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
    const map = new MapLibreMap({
      container,
      style: basemapStyle(basemap, theme),
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
    // A theme change while a new style is still loading has no layer to paint yet.
    map.on('style.load', () => this.applyTheme());
    this.map = map;
  }

  setBasemap(basemap: BasemapSpec): void {
    const key = JSON.stringify(basemap);
    if (key === this.basemapKey) {
      return;
    }
    this.basemap = basemap;
    this.basemapKey = key;
    // Inline styles are diffed by MapLibre; the camera is kept either way.
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

  resize(): void {
    this.map?.resize();
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
