// MapLibre 6 is ESM-only and needs WebGL, so these tests run against a fake that records calls
// (docs/phase_2.md, Design §6). The real map is covered by the e2e tests.
import { BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, basemapStyle, rasterPaint } from '../../basemapStyle';
import { WebGLUnavailableError } from '../../errors';
import { styleLayerIds, styleLayers } from '../../layerStyle';
import { EngineOptions, EngineTheme, LayerSpec, LayerStyle } from '../../types';
import { ERROR_THROTTLE_MS, HIT_TOLERANCE_PX, MapLibreEngine } from '../MapLibreEngine';

type Handler = (event?: unknown) => void;

class FakeMap {
  static instances: FakeMap[] = [];
  handlers: Record<string, Handler[]> = {};
  /** Style layer ids, bottom to top. */
  layers = new Set<string>();
  sources: Record<string, { setData: jest.Mock }> = {};
  isLoaded = true;
  moving = false;
  rendered: Array<{ id?: number; source: string; layer: { id: string } }> = [];
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
  addSource = jest.fn((id: string) => {
    this.sources[id] = { setData: jest.fn() };
  });
  removeSource = jest.fn((id: string) => {
    delete this.sources[id];
  });
  addLayer = jest.fn((layer: { id: string }) => {
    this.layers.add(layer.id);
  });
  removeLayer = jest.fn((id: string) => {
    this.layers.delete(id);
  });
  moveLayer = jest.fn((id: string) => {
    this.layers.delete(id);
    this.layers.add(id);
  });
  /** Called with options only (counting) or with a box and options (hit testing). */
  queryRenderedFeatures = jest.fn((boxOrOptions: unknown, maybeOptions?: { layers: string[] }) => {
    const { layers } = (maybeOptions ?? boxOrOptions) as { layers: string[] };
    return this.rendered.filter((feature) => layers.includes(feature.layer.id));
  });
  setFeatureState = jest.fn();
  canvas = { style: { cursor: '' } };
  canvasContainer = document.createElement('div');

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
  getSource(id: string) {
    return this.sources[id];
  }
  loaded() {
    return this.isLoaded;
  }
  isMoving() {
    return this.moving;
  }
  once(type: string) {
    return new Promise((resolve) => this.on(type, resolve));
  }
  /** What the map would build from a style given at mount or to setStyle. */
  transform(style: { sources: Record<string, unknown>; layers: unknown[] }) {
    return (this.options.transformStyle as (previous: unknown, next: unknown) => typeof style)(undefined, style);
  }
  dataLayerIds() {
    return [...this.layers].filter((id) => id.startsWith('geoflow-layer:'));
  }
  getCanvas() {
    return this.canvas;
  }
  getCanvasContainer() {
    return this.canvasContainer;
  }
  getCenter() {
    return this.center;
  }
  getZoom() {
    return this.zoom;
  }
}

class FakePopup {
  static instances: FakePopup[] = [];
  element = document.createElement('div');
  open = false;
  setDOMContent = jest.fn(() => this);
  setLngLat = jest.fn(() => this);
  addTo = jest.fn(() => {
    this.open = true;
    return this;
  });
  remove = jest.fn(() => {
    this.open = false;
    return this;
  });
  constructor(public options: Record<string, unknown>) {
    FakePopup.instances.push(this);
  }
  isOpen() {
    return this.open;
  }
  getElement() {
    return this.element;
  }
}

// Virtual: Jest can't resolve the real package, whose exports have only an `import` condition.
jest.mock(
  'maplibre-gl',
  () => ({
    Map: jest.fn((options) => new FakeMap(options)),
    NavigationControl: jest.fn((options) => ({ navigation: options })),
    Popup: jest.fn((options) => new FakePopup(options)),
    setWorkerUrl: jest.fn(),
  }),
  { virtual: true }
);
jest.mock('../workerUrl', () => ({ workerUrl: 'http://grafana/public/plugins/geoflow/worker.mjs' }));

const light: EngineTheme = { dark: false, background: '#ffffff' };
const dark: EngineTheme = { dark: true, background: '#111217' };
const options: EngineOptions = {
  view: { center: [-78.78, 35.79], zoom: 15 },
  basemap: { kind: 'osm' },
  theme: light,
  layers: [],
};

const style: LayerStyle = { color: '#73bf69', fillOpacity: 0.35, lineWidth: 2, pointRadius: 5, outlineColor: '#fff' };

function layer(id: string, overrides: Partial<LayerSpec> = {}): LayerSpec {
  return { id, data: { type: 'FeatureCollection', features: [] }, style, interactive: true, ...overrides };
}

let getContext: jest.SpyInstance;
let loseContext: jest.Mock;

beforeEach(() => {
  FakeMap.instances = [];
  FakePopup.instances = [];
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
  // A real map knows its layers once the style has loaded, including the data layers the
  // transformStyle added to it.
  const style = map.transform({ sources: {}, layers: [] });
  map.layers = new Set([
    BACKGROUND_LAYER_ID,
    BASEMAP_RASTER_LAYER_ID,
    ...style.layers.map((l) => (l as { id: string }).id),
  ]);
  for (const id of Object.keys(style.sources)) {
    map.sources[id] = { setData: jest.fn() };
  }
  map.fire('style.load');
  // Each test sees only the calls it causes.
  map.setPaintProperty.mockClear();
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
        transformStyle: expect.any(Function),
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

  describe('setLayers', () => {
    it('draws the layers given at mount as part of the first style', async () => {
      const { map } = await mounted({ ...options, layers: [layer('A')] });
      const next = map.transform({ sources: { basemap: {} }, layers: [{ id: 'basemap-layer' }] });

      expect(next.sources).toEqual({
        basemap: {},
        'geoflow-layer:A': { type: 'geojson', data: layer('A').data },
      });
      expect(next.layers).toEqual([{ id: 'basemap-layer' }, ...styleLayers(layer('A'))]);
      expect(map.addSource).not.toHaveBeenCalled();
    });

    it('adds a source and four style layers for a new layer, above the basemap', async () => {
      const { engine, map } = await mounted();
      engine.setLayers([layer('A')]);

      expect(map.addSource).toHaveBeenCalledWith('geoflow-layer:A', { type: 'geojson', data: layer('A').data });
      expect(map.addLayer.mock.calls.map(([added]) => added)).toEqual(styleLayers(layer('A')));
      expect([...map.layers]).toEqual([BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID, ...styleLayerIds('A')]);
    });

    it('removes a layer that is no longer asked for', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A'), layer('B')] });
      engine.setLayers([layer('B')]);

      expect(map.dataLayerIds()).toEqual(styleLayerIds('B'));
      expect(map.removeSource).toHaveBeenCalledWith('geoflow-layer:A');
      expect(map.sources['geoflow-layer:A']).toBeUndefined();
    });

    it('replaces the data of an existing layer when it is a new object', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
      const data = { type: 'FeatureCollection' as const, features: [] };
      engine.setLayers([layer('A', { data })]);

      expect(map.sources['geoflow-layer:A'].setData).toHaveBeenCalledWith(data);
      expect(map.addSource).not.toHaveBeenCalled();
      expect(map.addLayer).not.toHaveBeenCalled();
    });

    it('does nothing when the data and style objects are the same', async () => {
      const spec = layer('A');
      const { engine, map } = await mounted({ ...options, layers: [spec] });
      engine.setLayers([{ ...spec }]);

      expect(map.sources['geoflow-layer:A'].setData).not.toHaveBeenCalled();
      expect(map.setPaintProperty).not.toHaveBeenCalled();
      expect(map.moveLayer).not.toHaveBeenCalled();
    });

    it('repaints only the properties that changed', async () => {
      const spec = layer('A');
      const { engine, map } = await mounted({ ...options, layers: [spec] });
      engine.setLayers([{ ...spec, style: { ...style, color: '#f2cc0c' } }]);

      expect(map.setPaintProperty.mock.calls).toEqual([
        ['geoflow-layer:A:fill', 'fill-color', '#f2cc0c'],
        ['geoflow-layer:A:outline', 'line-color', '#f2cc0c'],
        ['geoflow-layer:A:line', 'line-color', '#f2cc0c'],
        ['geoflow-layer:A:circle', 'circle-color', '#f2cc0c'],
      ]);
      expect(map.sources['geoflow-layer:A'].setData).not.toHaveBeenCalled();
    });

    it('restacks the layers when their order changes', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A'), layer('B')] });
      engine.setLayers([layer('B'), layer('A')]);

      expect(map.dataLayerIds()).toEqual([...styleLayerIds('B'), ...styleLayerIds('A')]);

      map.moveLayer.mockClear();
      engine.setLayers([layer('B'), layer('A')]);
      expect(map.moveLayer).not.toHaveBeenCalled();
    });

    it('keeps the order when a layer is added between existing ones', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A'), layer('C')] });
      engine.setLayers([layer('A'), layer('B'), layer('C')]);

      expect(map.dataLayerIds()).toEqual([...styleLayerIds('A'), ...styleLayerIds('B'), ...styleLayerIds('C')]);
    });

    it('waits for a loading style, then applies the latest layers', async () => {
      const { engine, map } = await mounted();
      map.fire('styledataloading');
      engine.setLayers([layer('A')]);
      expect(map.addSource).not.toHaveBeenCalled();

      engine.setLayers([layer('B')]);
      map.fire('style.load');

      expect(map.addSource.mock.calls.map(([id]) => id)).toEqual(['geoflow-layer:B']);
      expect(map.dataLayerIds()).toEqual(styleLayerIds('B'));
    });

    it('carries the current layers into a new basemap style', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
      engine.setLayers([layer('A'), layer('B')]);
      engine.setBasemap({ kind: 'none' });
      const next = map.transform(basemapStyle({ kind: 'none' }, light) as never);

      expect(next.layers.slice(-8)).toEqual([...styleLayers(layer('A')), ...styleLayers(layer('B'))]);
      expect(Object.keys(next.sources)).toEqual(expect.arrayContaining(['geoflow-layer:A', 'geoflow-layer:B']));
    });

    it('is a no-op before mount', () => {
      expect(() => new MapLibreEngine().setLayers([layer('A')])).not.toThrow();
    });
  });

  describe('renderedFeatureCounts', () => {
    const feature = (id: number, layerId: string, kind = 'fill') => ({
      id,
      source: `geoflow-layer:${layerId}`,
      layer: { id: `geoflow-layer:${layerId}:${kind}` },
    });

    it('counts each feature once per layer, however many tiles and style layers it is in', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A'), layer('B')] });
      map.rendered = [
        feature(1, 'A'),
        feature(1, 'A', 'outline'),
        feature(1, 'A'),
        feature(2, 'A', 'circle'),
        feature(1, 'B', 'line'),
      ];

      await expect(engine.renderedFeatureCounts()).resolves.toEqual({ A: 2, B: 1 });
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith({
        layers: [...styleLayerIds('A'), ...styleLayerIds('B')],
      });
    });

    it('waits until the map is idle', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
      map.isLoaded = false;
      const counts = engine.renderedFeatureCounts();
      await Promise.resolve();
      expect(map.queryRenderedFeatures).not.toHaveBeenCalled();

      map.rendered = [feature(7, 'A')];
      map.fire('idle');

      await expect(counts).resolves.toEqual({ A: 1 });
    });

    it('reports layers with nothing drawn as zero', async () => {
      const { engine } = await mounted({ ...options, layers: [layer('A')] });

      await expect(engine.renderedFeatureCounts()).resolves.toEqual({ A: 0 });
    });

    it('returns nothing before mount', async () => {
      await expect(new MapLibreEngine().renderedFeatureCounts()).resolves.toEqual({});
    });
  });

  describe('hover and click', () => {
    /** A rendered feature as MapLibre returns it. */
    const drawn = (layerId: string, id: number, kind = 'circle') => ({
      id,
      source: `geoflow-layer:${layerId}`,
      layer: { id: `geoflow-layer:${layerId}:${kind}` },
    });
    const pointer = (x = 100, y = 50, target?: EventTarget) => ({
      point: { x, y },
      lngLat: { lng: -78.78, lat: 35.79 },
      originalEvent: { target },
    });

    it('reports the interactive features under a click, topmost first, each once', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A'), layer('B')] });
      const listener = jest.fn();
      engine.on('click', listener);
      map.rendered = [drawn('B', 4), drawn('A', 1, 'fill'), drawn('A', 1, 'outline'), drawn('B', 4), drawn('A', 2)];
      map.fire('click', pointer());

      expect(listener).toHaveBeenCalledWith({
        lngLat: [-78.78, 35.79],
        features: [
          { layerId: 'B', featureId: 4 },
          { layerId: 'A', featureId: 1 },
          { layerId: 'A', featureId: 2 },
        ],
      });
      const t = HIT_TOLERANCE_PX;
      expect(map.queryRenderedFeatures).toHaveBeenCalledWith(
        [
          [100 - t, 50 - t],
          [100 + t, 50 + t],
        ],
        { layers: [...styleLayerIds('A'), ...styleLayerIds('B')] }
      );
    });

    it('leaves out layers that are not interactive', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A', { interactive: false }), layer('B')] });
      const listener = jest.fn();
      engine.on('click', listener);
      map.rendered = [drawn('A', 1), drawn('B', 2)];
      map.fire('click', pointer());

      expect(listener.mock.calls[0][0].features).toEqual([{ layerId: 'B', featureId: 2 }]);
    });

    it('reports a click on empty map with no features, without querying when nothing is interactive', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A', { interactive: false })] });
      const listener = jest.fn();
      engine.on('click', listener);
      map.fire('click', pointer());

      expect(listener).toHaveBeenCalledWith({ lngLat: [-78.78, 35.79], features: [] });
      expect(map.queryRenderedFeatures).not.toHaveBeenCalled();
    });

    it('ignores clicks inside a pinned tooltip', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
      const listener = jest.fn();
      engine.on('click', listener);
      map.fire('click', pointer(100, 50, document.createElement('button')));

      expect(listener).not.toHaveBeenCalled();
    });

    describe('hover', () => {
      beforeEach(() => jest.useFakeTimers());
      const frame = () => jest.advanceTimersByTime(20);

      it('hit tests once per animation frame, with the latest pointer position', async () => {
        const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
        const listener = jest.fn();
        engine.on('hover', listener);
        map.rendered = [drawn('A', 1)];
        map.fire('mousemove', pointer(10, 10));
        map.fire('mousemove', pointer(20, 20));
        expect(listener).not.toHaveBeenCalled();
        frame();

        expect(map.queryRenderedFeatures).toHaveBeenCalledTimes(1);
        expect(map.queryRenderedFeatures.mock.calls[0][0]).toEqual([
          [20 - HIT_TOLERANCE_PX, 20 - HIT_TOLERANCE_PX],
          [20 + HIT_TOLERANCE_PX, 20 + HIT_TOLERANCE_PX],
        ]);
        expect(listener).toHaveBeenCalledWith({ lngLat: [-78.78, 35.79], features: [{ layerId: 'A', featureId: 1 }] });
        expect(map.canvas.style.cursor).toBe('pointer');
      });

      it('keeps reporting while over features, then reports leaving them once', async () => {
        const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
        const listener = jest.fn();
        engine.on('hover', listener);
        map.rendered = [drawn('A', 1)];
        map.fire('mousemove', pointer());
        frame();
        map.fire('mousemove', pointer(101, 50));
        frame();
        expect(listener).toHaveBeenCalledTimes(2);

        map.rendered = [];
        map.fire('mousemove', pointer(300, 50));
        frame();
        map.fire('mousemove', pointer(301, 50));
        frame();

        expect(listener).toHaveBeenCalledTimes(3);
        expect(listener.mock.lastCall[0].features).toEqual([]);
        expect(map.canvas.style.cursor).toBe('');
      });

      it('reports leaving the map once, and drops a pending move', async () => {
        const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
        const listener = jest.fn();
        engine.on('hover', listener);
        map.rendered = [drawn('A', 1)];
        map.fire('mousemove', pointer());
        frame();
        map.fire('mousemove', pointer());
        map.fire('mouseout');
        map.fire('mouseout');
        frame();

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.lastCall[0].features).toEqual([]);
        expect(map.canvas.style.cursor).toBe('');
      });
    });
  });

  describe('tooltip', () => {
    it('opens one MapLibre popup anchored at the point, with the given content', async () => {
      const { engine, map } = await mounted();
      const content = document.createElement('div');
      engine.openTooltip([-78.78, 35.79], content, { interactive: true });
      const [popup] = FakePopup.instances;

      expect(popup.options).toMatchObject({ closeButton: false, closeOnClick: false, closeOnMove: false });
      expect(popup.setDOMContent).toHaveBeenCalledWith(content);
      expect(popup.setLngLat).toHaveBeenCalledWith([-78.78, 35.79]);
      expect(popup.addTo).toHaveBeenCalledWith(map);
      expect(popup.element.style.pointerEvents).toBe('');
    });

    it('only moves the tooltip when the content element is the same', async () => {
      const { engine } = await mounted();
      const content = document.createElement('div');
      engine.openTooltip([1, 2], content, { interactive: false });
      engine.openTooltip([3, 4], content, { interactive: false });
      const [popup] = FakePopup.instances;

      expect(FakePopup.instances).toHaveLength(1);
      expect(popup.setDOMContent).toHaveBeenCalledTimes(1);
      expect(popup.setLngLat).toHaveBeenLastCalledWith([3, 4]);
      expect(popup.addTo).toHaveBeenCalledTimes(1);
    });

    it('replaces the content, and lets the pointer through when not interactive', async () => {
      const { engine } = await mounted();
      engine.openTooltip([1, 2], document.createElement('div'), { interactive: true });
      const next = document.createElement('div');
      engine.openTooltip([1, 2], next, { interactive: false });
      const [popup] = FakePopup.instances;

      expect(popup.setDOMContent).toHaveBeenLastCalledWith(next);
      expect(popup.element.style.pointerEvents).toBe('none');
    });

    it('closes, and opens again with the same content', async () => {
      const { engine } = await mounted();
      const content = document.createElement('div');
      engine.openTooltip([1, 2], content, { interactive: true });
      engine.closeTooltip();
      const [popup] = FakePopup.instances;
      expect(popup.isOpen()).toBe(false);

      engine.openTooltip([1, 2], content, { interactive: true });
      expect(popup.setDOMContent).toHaveBeenCalledTimes(2);
      expect(popup.isOpen()).toBe(true);
    });

    it('is closed when the engine is destroyed', async () => {
      const { engine } = await mounted();
      engine.openTooltip([1, 2], document.createElement('div'), { interactive: true });
      engine.destroy();

      expect(FakePopup.instances[0].isOpen()).toBe(false);
    });

    it('is a no-op before mount', () => {
      expect(() =>
        new MapLibreEngine().openTooltip([1, 2], document.createElement('div'), { interactive: true })
      ).not.toThrow();
      expect(FakePopup.instances).toHaveLength(0);
    });
  });

  describe('highlights', () => {
    it('sets and moves the hovered feature-state', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
      engine.setHovered({ layerId: 'A', featureId: 1 });
      engine.setHovered({ layerId: 'A', featureId: 2 });
      engine.setHovered(undefined);

      expect(map.setFeatureState.mock.calls).toEqual([
        [{ source: 'geoflow-layer:A', id: 1 }, { hovered: true }],
        [{ source: 'geoflow-layer:A', id: 1 }, { hovered: false }],
        [{ source: 'geoflow-layer:A', id: 2 }, { hovered: true }],
        [{ source: 'geoflow-layer:A', id: 2 }, { hovered: false }],
      ]);
    });

    it('keeps the selected highlight apart from the hovered one', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
      engine.setSelected({ layerId: 'A', featureId: 1 });
      engine.setHovered({ layerId: 'A', featureId: 1 });
      engine.setHovered(undefined);

      expect(map.setFeatureState.mock.calls).toEqual([
        [{ source: 'geoflow-layer:A', id: 1 }, { selected: true }],
        [{ source: 'geoflow-layer:A', id: 1 }, { hovered: true }],
        [{ source: 'geoflow-layer:A', id: 1 }, { hovered: false }],
      ]);
    });

    it('ignores the same feature again, and layers without a source', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A')] });
      engine.setSelected({ layerId: 'A', featureId: 1 });
      engine.setSelected({ layerId: 'A', featureId: 1 });
      engine.setSelected({ layerId: 'gone', featureId: 1 });

      expect(map.setFeatureState.mock.calls).toEqual([
        [{ source: 'geoflow-layer:A', id: 1 }, { selected: true }],
        [{ source: 'geoflow-layer:A', id: 1 }, { selected: false }],
      ]);
    });
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

    it('names the data layer an error came from', async () => {
      const { engine, map } = await mounted({ ...options, layers: [layer('A:1')] });
      const listener = jest.fn();
      engine.on('error', listener);
      map.fire('error', { error: new Error('bad GeoJSON'), sourceId: 'geoflow-layer:A:1' });

      expect(listener).toHaveBeenCalledWith({ message: 'bad GeoJSON', sourceId: 'geoflow-layer:A:1', layerId: 'A:1' });
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
