import React from 'react';
import { act, render, screen } from '@testing-library/react';
import {
  FieldType,
  LoadingState,
  PanelData,
  PanelProps,
  ThemeContext,
  createTheme,
  getDefaultTimeRange,
  toDataFrame,
} from '@grafana/data';
import {
  DEFAULT_LAYER_STYLE,
  EngineError,
  EngineOptions,
  LayerSpec,
  MapEngine,
  WebGLUnavailableError,
  createMapEngine,
} from '../engine';
import { MapPanel } from './MapPanel';
import { DEFAULT_OPTIONS, GeoFlowOptions } from './options';
import { INSPECT_EVENT, RENDERED_FEATURES_ATTRIBUTE } from './testHook';

jest.mock('../engine', () => ({
  ...jest.requireActual('../engine/errors'),
  ...jest.requireActual('../engine/layerStyle'),
  createMapEngine: jest.fn(),
}));

class FakeEngine implements MapEngine {
  mount = jest.fn<Promise<void>, [HTMLElement, EngineOptions]>(() => Promise.resolve());
  setBasemap = jest.fn();
  setTheme = jest.fn();
  setView = jest.fn();
  setLayers = jest.fn();
  resize = jest.fn();
  renderedFeatureCounts = jest.fn(() => Promise.resolve({}));
  destroy = jest.fn();
  errorListeners: Array<(error: EngineError) => void> = [];
  on = jest.fn((event: string, listener: (payload: never) => void) => {
    if (event === 'error') {
      this.errorListeners.push(listener as (error: EngineError) => void);
    }
    return () => undefined;
  }) as jest.Mock & MapEngine['on'];
}

/** IntersectionObserver whose entries the tests control. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  /** Whether observed elements report as on screen straight away. */
  static startOnScreen = true;
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe() {
    if (FakeIntersectionObserver.startOnScreen) {
      queueMicrotask(() => this.report(true));
    }
  }
  disconnect() {}
  report(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

/** Moves every panel on or off screen. */
function setOnScreen(onScreen: boolean) {
  act(() => FakeIntersectionObserver.instances.forEach((observer) => observer.report(onScreen)));
}

let engine: FakeEngine;
const realIntersectionObserver = global.IntersectionObserver;

beforeEach(() => {
  engine = new FakeEngine();
  jest.mocked(createMapEngine).mockReset().mockResolvedValue(engine);
  FakeIntersectionObserver.instances = [];
  FakeIntersectionObserver.startOnScreen = true;
  global.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  global.IntersectionObserver = realIntersectionObserver;
});

interface PanelOverrides {
  options?: Partial<GeoFlowOptions>;
  data?: Partial<PanelData>;
  width?: number;
  height?: number;
}

function props({ options, data, width = 400, height = 300 }: PanelOverrides = {}) {
  return {
    id: 1,
    data: { state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange(), ...data },
    options: { ...DEFAULT_OPTIONS, ...options },
    fieldConfig: { defaults: {}, overrides: [] },
    width,
    height,
  } as unknown as PanelProps<GeoFlowOptions>;
}

/** Renders the panel and lets the async engine creation and mount settle. */
async function renderPanel(overrides?: PanelOverrides) {
  const view = render(<MapPanel {...props(overrides)} />);
  await act(async () => {});
  return view;
}

describe('MapPanel', () => {
  describe('map lifecycle', () => {
    it('mounts the engine once with the current options', async () => {
      await renderPanel({ options: { view: { lat: 35.79, lon: -78.78, zoom: 15 } } });

      expect(createMapEngine).toHaveBeenCalledTimes(1);
      expect(engine.mount).toHaveBeenCalledTimes(1);
      expect(engine.mount).toHaveBeenCalledWith(screen.getByTestId('geoflow-map'), {
        basemap: { kind: 'osm' },
        view: { center: [-78.78, 35.79], zoom: 15 },
        theme: { dark: expect.any(Boolean), background: expect.any(String) },
        layers: [],
      });
    });

    it('updates the basemap in place when the options change', async () => {
      const { rerender } = await renderPanel();
      rerender(<MapPanel {...props({ options: { basemap: { kind: 'none' } } })} />);

      expect(engine.setBasemap).toHaveBeenLastCalledWith({ kind: 'none' });
      expect(createMapEngine).toHaveBeenCalledTimes(1);
      expect(engine.mount).toHaveBeenCalledTimes(1);
    });

    it('moves to a new initial view without remounting', async () => {
      const { rerender } = await renderPanel();
      rerender(<MapPanel {...props({ options: { view: { lat: 1, lon: 2, zoom: 3 } } })} />);

      expect(engine.setView).toHaveBeenLastCalledWith({ center: [2, 1], zoom: 3 });
      expect(engine.mount).toHaveBeenCalledTimes(1);
    });

    it('leaves the view alone on re-renders that change something else', async () => {
      const { rerender } = await renderPanel();
      const calls = engine.setView.mock.calls.length;
      rerender(<MapPanel {...props({ options: { showSummary: true } })} />);

      expect(engine.setView).toHaveBeenCalledTimes(calls);
    });

    it('resizes the map when the panel size changes', async () => {
      const { rerender } = await renderPanel();
      engine.resize.mockClear();
      rerender(<MapPanel {...props({ width: 800 })} />);

      expect(engine.resize).toHaveBeenCalledTimes(1);
    });

    it('destroys the engine on unmount', async () => {
      const { unmount } = await renderPanel();
      unmount();

      expect(engine.destroy).toHaveBeenCalledTimes(1);
    });

    it('destroys the engine when unmounted while it is still mounting', async () => {
      let finishMount!: () => void;
      engine.mount.mockReturnValue(new Promise<void>((resolve) => (finishMount = resolve)));
      const { unmount } = await renderPanel();

      unmount();
      expect(engine.destroy).toHaveBeenCalledTimes(1);
      await act(async () => finishMount());
      expect(engine.setBasemap).not.toHaveBeenCalled();
    });

    it('never mounts an engine that loads after the panel is gone', async () => {
      let finishLoad!: (engine: MapEngine) => void;
      jest.mocked(createMapEngine).mockReturnValue(new Promise((resolve) => (finishLoad = resolve)));
      const { unmount } = render(<MapPanel {...props()} />);

      unmount();
      await act(async () => finishLoad(engine));
      expect(engine.mount).not.toHaveBeenCalled();
    });
  });

  describe('off screen', () => {
    it('waits until the panel is on screen before creating the map', async () => {
      FakeIntersectionObserver.startOnScreen = false;
      await renderPanel();
      expect(createMapEngine).not.toHaveBeenCalled();

      setOnScreen(true);
      await act(async () => {});
      expect(engine.mount).toHaveBeenCalledTimes(1);
    });

    it('releases the map off screen, and recreates it at the last view', async () => {
      await renderPanel();
      const viewListener = engine.on.mock.calls.find(([event]) => event === 'viewChange')![1];
      act(() => viewListener({ center: [10, 20], zoom: 5 }));

      setOnScreen(false);
      expect(engine.destroy).toHaveBeenCalledTimes(1);

      const second = new FakeEngine();
      jest.mocked(createMapEngine).mockResolvedValue(second);
      setOnScreen(true);
      await act(async () => {});
      expect(second.mount).toHaveBeenCalledWith(
        screen.getByTestId('geoflow-map'),
        expect.objectContaining({ view: { center: [10, 20], zoom: 5 } })
      );
      expect(second.setView).not.toHaveBeenCalled();
    });

    it('applies a view changed while off screen when the map comes back', async () => {
      const { rerender } = await renderPanel();
      setOnScreen(false);
      rerender(<MapPanel {...props({ options: { view: { lat: 1, lon: 2, zoom: 3 } } })} />);

      const second = new FakeEngine();
      jest.mocked(createMapEngine).mockResolvedValue(second);
      setOnScreen(true);
      await act(async () => {});
      expect(second.mount).toHaveBeenCalledWith(
        screen.getByTestId('geoflow-map'),
        expect.objectContaining({ view: { center: [2, 1], zoom: 3 } })
      );
    });

    it('pauses a map whose WebGL context was lost, and reloads it on request', async () => {
      await renderPanel();
      const lostListener = engine.on.mock.calls.find(([event]) => event === 'contextLost')![1];
      act(() => lostListener(undefined as never));

      expect(engine.destroy).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('geoflow-map-paused')).toHaveTextContent('too many maps open');

      const second = new FakeEngine();
      jest.mocked(createMapEngine).mockResolvedValue(second);
      await act(async () => screen.getByRole('button', { name: 'Reload map' }).click());
      expect(second.mount).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('geoflow-map-paused')).not.toBeInTheDocument();
    });
  });

  describe('failures', () => {
    it('explains a missing WebGL2 instead of showing the map', async () => {
      engine.mount.mockRejectedValue(new WebGLUnavailableError());
      await renderPanel();

      expect(screen.getByTestId('geoflow-map-error')).toHaveTextContent(
        "This panel needs WebGL2, which isn't available in this browser"
      );
      expect(screen.queryByTestId('geoflow-map')).not.toBeInTheDocument();
    });

    it('reports a map that fails to load', async () => {
      jest.mocked(createMapEngine).mockRejectedValue(new Error('Loading chunk maplibre failed'));
      await renderPanel();

      expect(screen.getByTestId('geoflow-map-error')).toHaveTextContent(
        "The map couldn't load: Loading chunk maplibre failed"
      );
    });

    it('shows basemap errors until the basemap changes', async () => {
      const { rerender } = await renderPanel();
      act(() => engine.errorListeners.forEach((listener) => listener({ message: 'tile 503' })));

      expect(screen.getByTestId('geoflow-basemap-error')).toHaveTextContent('Basemap: tile 503');

      rerender(<MapPanel {...props({ options: { basemap: { kind: 'none' } } })} />);
      expect(screen.queryByTestId('geoflow-basemap-error')).not.toBeInTheDocument();
    });
  });

  describe('data layers', () => {
    const points = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'id', type: FieldType.number, values: [1, 2] },
        {
          name: 'geometry',
          type: FieldType.string,
          values: ['{"type":"Point","coordinates":[1,2]}', '{"type":"Point","coordinates":[3,4]}'],
        },
      ],
    });
    const lines = toDataFrame({
      refId: 'B',
      fields: [
        { name: 'geometry', type: FieldType.string, values: ['{"type":"LineString","coordinates":[[1,2],[3,4]]}'] },
      ],
    });
    const noGeometry = toDataFrame({ refId: 'C', fields: [{ name: 'name', type: FieldType.string, values: ['a'] }] });

    const lastLayers = (fake: FakeEngine = engine): LayerSpec[] => fake.setLayers.mock.lastCall![0];

    it('draws one layer per frame with geometry, in query order', async () => {
      await renderPanel({ data: { series: [points, noGeometry, lines] } });
      const layers = lastLayers();

      expect(layers.map((layer) => [layer.id, layer.data.features.length])).toEqual([
        ['A', 2],
        ['B', 1],
      ]);
      expect(layers[0].style).toMatchObject(DEFAULT_LAYER_STYLE);
      expect(layers[0].style.color).not.toBe(layers[1].style.color);
    });

    it('passes the layers to a map created after the panel comes back on screen', async () => {
      const { rerender } = await renderPanel({ data: { series: [points] } });
      setOnScreen(false);
      rerender(<MapPanel {...props({ data: { series: [points, lines] } })} />);

      const second = new FakeEngine();
      jest.mocked(createMapEngine).mockResolvedValue(second);
      setOnScreen(true);
      await act(async () => {});
      const mounted: LayerSpec[] = second.mount.mock.calls[0][1].layers;

      expect(mounted.map((layer) => layer.id)).toEqual(['A', 'B']);
    });

    it('reuses the data of frames that did not change', async () => {
      const { rerender } = await renderPanel({ data: { series: [points, lines] } });
      const before = lastLayers();
      const newLines = toDataFrame({ ...lines });
      rerender(<MapPanel {...props({ data: { series: [points, newLines] } })} />);
      const after = lastLayers();

      expect(after[0].data).toBe(before[0].data);
      expect(after[1].data).not.toBe(before[1].data);
    });

    it('does not touch the layers when something else changes', async () => {
      const series = [points];
      const { rerender } = await renderPanel({ data: { series } });
      engine.setLayers.mockClear();
      rerender(<MapPanel {...props({ data: { series }, options: { basemap: { kind: 'none' } } })} />);

      expect(engine.setLayers).not.toHaveBeenCalled();
    });

    it('recolors the layers, keeping their data, when the theme changes', async () => {
      const series = [points];
      const panel = (mode: 'light' | 'dark') => (
        <ThemeContext.Provider value={createTheme({ colors: { mode } })}>
          <MapPanel {...props({ data: { series } })} />
        </ThemeContext.Provider>
      );
      const { rerender } = render(panel('dark'));
      await act(async () => {});
      const dark = lastLayers();
      rerender(panel('light'));
      const light = lastLayers();

      expect(light[0].style.color).not.toBe(dark[0].style.color);
      expect(light[0].style.outlineColor).not.toBe(dark[0].style.outlineColor);
      expect(light[0].data).toBe(dark[0].data);
    });

    it('explains when no frame has a geometry column', async () => {
      await renderPanel({ data: { series: [noGeometry] } });

      expect(screen.getByTestId('geoflow-no-geometry')).toHaveTextContent('No GeoJSON geometry column');
      expect(screen.getByTestId('geoflow-map')).toBeInTheDocument();
    });

    it('shows no notice when a frame has geometry, or when there is no data', async () => {
      const { rerender } = await renderPanel({ data: { series: [noGeometry, points] } });
      expect(screen.queryByTestId('geoflow-no-geometry')).not.toBeInTheDocument();

      rerender(<MapPanel {...props()} />);
      expect(screen.queryByTestId('geoflow-no-geometry')).not.toBeInTheDocument();
    });

    // Test hook: the e2e tests read drawn features this way (docs/phase_3.md, Design §5).
    it('writes the drawn-feature counts to the map container when inspected', async () => {
      await renderPanel({ data: { series: [points] } });
      engine.renderedFeatureCounts.mockResolvedValue({ A: 2 });
      const container = screen.getByTestId('geoflow-map');
      container.setAttribute(RENDERED_FEATURES_ATTRIBUTE, 'stale');

      await act(async () => container.dispatchEvent(new Event(INSPECT_EVENT)));

      expect(container).toHaveAttribute(RENDERED_FEATURES_ATTRIBUTE, '{"A":2}');
    });
  });

  describe('data summary', () => {
    const series = [
      toDataFrame({
        refId: 'A',
        fields: [
          { name: 'id', type: FieldType.number, values: [1, 2] },
          { name: 'geometry', type: FieldType.string, values: ['{"type":"Point","coordinates":[1,2]}', null] },
        ],
      }),
      toDataFrame({
        refId: 'B',
        fields: [{ name: 'id', type: FieldType.number, values: [1, 2, 3] }],
      }),
    ];

    it('is hidden by default', async () => {
      await renderPanel({ data: { series } });

      expect(screen.queryByTestId('geoflow-summary')).not.toBeInTheDocument();
    });

    it('lists each frame with the adapter result and fields when turned on', async () => {
      await renderPanel({ data: { series }, options: { showSummary: true } });

      expect(screen.getByTestId('geoflow-summary-A')).toHaveTextContent('A: 2 rows → 1 feature (geometry) · empty 1');
      expect(screen.getByTestId('geoflow-frame-A')).toHaveTextContent('row 2: no value');
      expect(screen.getByTestId('geoflow-frame-A')).toHaveTextContent('id (number), geometry (string)');
      expect(screen.getByTestId('geoflow-summary-B')).toHaveTextContent('B: 3 rows → no geometry:');
    });

    it('names frames without a refId by position', async () => {
      await renderPanel({
        data: { series: [toDataFrame({ fields: [{ name: 'id', type: FieldType.number, values: [1] }] })] },
        options: { showSummary: true },
      });

      expect(screen.getByTestId('geoflow-summary-#0')).toHaveTextContent('#0: 1 row → no geometry:');
    });

    it('still shows the map when there is no data', async () => {
      await renderPanel({ options: { showSummary: true } });

      expect(screen.getByTestId('geoflow-map')).toBeInTheDocument();
      expect(screen.queryByTestId('geoflow-summary')).not.toBeInTheDocument();
    });
  });
});
