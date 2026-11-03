// MapLibre 6 is ESM-only and needs WebGL, so these tests run against a fake that records calls
// (docs/phase_2.md, Design §6). The real map is covered by the e2e tests.
import { BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, basemapStyle, rasterPaint } from '../../basemapStyle';
import { WebGLUnavailableError } from '../../errors';
import { EngineOptions, EngineTheme } from '../../types';
import { ERROR_THROTTLE_MS, MapLibreEngine } from '../MapLibreEngine';

type Handler = (event?: unknown) => void;

class FakeMap {
  static instances: FakeMap[] = [];
  handlers: Record<string, Handler[]> = {};
  layers = new Set<string>();
  controls: unknown[] = [];
  center = { lng: 0, lat: 0 };
  zoom = 0;
  touchZoomRotate = { disableRotation: jest.fn() };
  keyboard = { disableRotation: jest.fn() };
  setStyle = jest.fn();
  setPaintProperty = jest.fn();
  jumpTo = jest.fn();
  resize = jest.fn();
  remove = jest.fn();

  constructor(public options: Record<string, unknown>) {
    FakeMap.instances.push(this);
  }
  on(type: string, handler: Handler) {
    (this.handlers[type] ??= []).push(handler);
    return this;
  }
  fire(type: string, event?: unknown) {
    this.handlers[type]?.forEach((h) => h(event));
  }
  addControl(control: unknown) {
    this.controls.push(control);
    return this;
  }
  getLayer(id: string) {
    return this.layers.has(id) ? { id } : undefined;
  }
  getCenter() {
    return this.center;
  }
  getZoom() {
    return this.zoom;
  }
}

// Virtual: Jest can't resolve the real package, whose exports have only an `import` condition.
jest.mock(
  'maplibre-gl',
  () => ({
    Map: jest.fn((options) => new FakeMap(options)),
    NavigationControl: jest.fn((options) => ({ navigation: options })),
    setWorkerUrl: jest.fn(),
  }),
  { virtual: true }
);
jest.mock('../workerUrl', () => ({ workerUrl: 'http://grafana/public/plugins/geoflow/worker.mjs' }));

const light: EngineTheme = { dark: false, background: '#ffffff' };
const dark: EngineTheme = { dark: true, background: '#111217' };
const options: EngineOptions = { view: { center: [-78.78, 35.79], zoom: 15 }, basemap: { kind: 'osm' }, theme: light };

let getContext: jest.SpyInstance;
let loseContext: jest.Mock;

beforeEach(() => {
  FakeMap.instances = [];
  loseContext = jest.fn();
  getContext = jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ getExtension: () => ({ loseContext }) } as unknown as WebGL2RenderingContext);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function mounted(opts: EngineOptions = options) {
  const engine = new MapLibreEngine();
  await engine.mount(document.createElement('div'), opts);
  const map = FakeMap.instances[FakeMap.instances.length - 1];
  // A real map knows its layers once the style has loaded.
  map.layers = new Set([BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID]);
  return { engine, map };
}

describe('MapLibreEngine', () => {
  describe('mount', () => {
    it('creates a north-up map with the basemap style, view and controls', async () => {
      const container = document.createElement('div');
      await new MapLibreEngine().mount(container, options);
      const [map] = FakeMap.instances;

      expect(map.options).toEqual({
        container,
        style: basemapStyle({ kind: 'osm' }, light),
        center: [-78.78, 35.79],
        zoom: 15,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        maxPitch: 0,
      });
      expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled();
      expect(map.keyboard.disableRotation).toHaveBeenCalled();
      expect(map.controls).toEqual([{ navigation: { showCompass: false } }]);
    });

    it('sets the worker URL once per page, however many engines mount', async () => {
      // A fresh module registry, so earlier tests haven't already set it.
      await jest.isolateModulesAsync(async () => {
        const maplibre = await import('maplibre-gl');
        const { MapLibreEngine: FreshEngine } = await import('../MapLibreEngine');
        jest.mocked(maplibre.setWorkerUrl).mockClear();

        await new FreshEngine().mount(document.createElement('div'), options);
        await new FreshEngine().mount(document.createElement('div'), options);

        expect(maplibre.setWorkerUrl).toHaveBeenCalledTimes(1);
        expect(maplibre.setWorkerUrl).toHaveBeenCalledWith('http://grafana/public/plugins/geoflow/worker.mjs');
      });
    });

    it('rejects with WebGLUnavailableError and creates no map without WebGL2', async () => {
      getContext.mockReturnValue(null);

      await expect(new MapLibreEngine().mount(document.createElement('div'), options)).rejects.toBeInstanceOf(
        WebGLUnavailableError
      );
      expect(FakeMap.instances).toHaveLength(0);
    });

    it('treats a throwing getContext as no WebGL2', async () => {
      getContext.mockImplementation(() => {
        throw new Error('blocked');
      });

      await expect(new MapLibreEngine().mount(document.createElement('div'), options)).rejects.toBeInstanceOf(
        WebGLUnavailableError
      );
    });

    it('releases the probe context', async () => {
      await mounted();

      expect(getContext).toHaveBeenCalledWith('webgl2');
      expect(loseContext).toHaveBeenCalled();
    });

    it('creates no map when destroyed before mounting', async () => {
      const engine = new MapLibreEngine();
      engine.destroy();
      await engine.mount(document.createElement('div'), options);

      expect(FakeMap.instances).toHaveLength(0);
    });

    it('creates only one map when mounted twice', async () => {
      const engine = new MapLibreEngine();
      await engine.mount(document.createElement('div'), options);
      await engine.mount(document.createElement('div'), options);

      expect(FakeMap.instances).toHaveLength(1);
    });
  });

  describe('setBasemap', () => {
    it('swaps the style on the existing map', async () => {
      const { engine, map } = await mounted();
      engine.setBasemap({ kind: 'none' });

      expect(FakeMap.instances).toHaveLength(1);
      expect(map.setStyle).toHaveBeenCalledWith(basemapStyle({ kind: 'none' }, light));
    });

    it('builds the new style with the current theme', async () => {
      const { engine, map } = await mounted();
      engine.setTheme(dark);
      engine.setBasemap({ kind: 'raster', tiles: ['https://t/{z}/{x}/{y}.png'], attribution: '' });

      expect(map.setStyle).toHaveBeenCalledWith(
        basemapStyle({ kind: 'raster', tiles: ['https://t/{z}/{x}/{y}.png'], attribution: '' }, dark)
      );
    });

    it('ignores an unchanged basemap', async () => {
      const { engine, map } = await mounted();
      engine.setBasemap({ kind: 'osm' });

      expect(map.setStyle).not.toHaveBeenCalled();
    });

    it('is a no-op before mount', () => {
      expect(() => new MapLibreEngine().setBasemap({ kind: 'none' })).not.toThrow();
    });
  });

  describe('setTheme', () => {
    it('repaints the raster and background layers without reloading the style', async () => {
      const { engine, map } = await mounted();
      engine.setTheme(dark);

      expect(map.setStyle).not.toHaveBeenCalled();
      expect(map.setPaintProperty).toHaveBeenCalledWith(BACKGROUND_LAYER_ID, 'background-color', '#111217');
      for (const [property, value] of Object.entries(rasterPaint(dark))) {
        expect(map.setPaintProperty).toHaveBeenCalledWith(BASEMAP_RASTER_LAYER_ID, property, value);
      }
    });

    it('ignores an unchanged theme', async () => {
      const { engine, map } = await mounted();
      engine.setTheme({ ...light });

      expect(map.setPaintProperty).not.toHaveBeenCalled();
    });

    it('leaves a style URL basemap alone', async () => {
      const { engine, map } = await mounted({ ...options, basemap: { kind: 'style', url: 'https://s/style.json' } });
      engine.setTheme(dark);

      expect(map.setPaintProperty).not.toHaveBeenCalled();
    });

    it('applies a theme that changed while a new style was loading', async () => {
      const { engine, map } = await mounted();
      map.layers.clear();
      engine.setTheme(dark);
      expect(map.setPaintProperty).not.toHaveBeenCalled();

      map.layers = new Set([BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID]);
      map.fire('style.load');

      expect(map.setPaintProperty).toHaveBeenCalledWith(BACKGROUND_LAYER_ID, 'background-color', '#111217');
    });
  });

  it('jumps to a new view', async () => {
    const { engine, map } = await mounted();
    engine.setView({ center: [1, 2], zoom: 3 });

    expect(map.jumpTo).toHaveBeenCalledWith({ center: [1, 2], zoom: 3 });
  });

  it('resizes the map', async () => {
    const { engine, map } = await mounted();
    engine.resize();

    expect(map.resize).toHaveBeenCalled();
  });

  describe('events', () => {
    it('reports the view on moveend', async () => {
      const { engine, map } = await mounted();
      const listener = jest.fn();
      engine.on('viewChange', listener);
      map.center = { lng: -78.7, lat: 35.8 };
      map.zoom = 12;
      map.fire('moveend');

      expect(listener).toHaveBeenCalledWith({ center: [-78.7, 35.8], zoom: 12 });
    });

    it('stops calling a listener once it is removed', async () => {
      const { engine, map } = await mounted();
      const listener = jest.fn();
      engine.on('viewChange', listener)();
      map.fire('moveend');

      expect(listener).not.toHaveBeenCalled();
    });

    it('forwards errors at most once per source per interval', async () => {
      jest.useFakeTimers();
      const { engine, map } = await mounted();
      const listener = jest.fn();
      engine.on('error', listener);

      const tileError = { error: new Error('tile 503'), sourceId: 'geoflow-basemap' };
      map.fire('error', tileError);
      map.fire('error', tileError);
      map.fire('error', { error: new Error('style failed') });
      expect(listener.mock.calls).toEqual([
        [{ message: 'tile 503', sourceId: 'geoflow-basemap' }],
        [{ message: 'style failed' }],
      ]);

      jest.advanceTimersByTime(ERROR_THROTTLE_MS);
      map.fire('error', tileError);
      expect(listener).toHaveBeenCalledTimes(3);
    });

    it("reports a context loss from the browser, not MapLibre's synthetic one", async () => {
      const { engine, map } = await mounted();
      const listener = jest.fn();
      engine.on('contextLost', listener);

      map.fire('webglcontextlost', { originalEvent: { isTrusted: false } });
      expect(listener).not.toHaveBeenCalled();

      map.fire('webglcontextlost', { originalEvent: { isTrusted: true } });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('removes the map and drops listeners', async () => {
      const { engine, map } = await mounted();
      const listener = jest.fn();
      engine.on('viewChange', listener);
      engine.destroy();
      map.fire('moveend');

      expect(map.remove).toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
    });

    it('makes later calls no-ops', async () => {
      const { engine, map } = await mounted();
      engine.destroy();
      engine.setBasemap({ kind: 'none' });
      engine.resize();

      expect(map.setStyle).not.toHaveBeenCalled();
      expect(map.resize).not.toHaveBeenCalled();
    });
  });
});
