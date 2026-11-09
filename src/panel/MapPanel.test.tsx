import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import {
  DataFrame,
  EventBusSrv,
  Field,
  FieldColorModeId,
  FieldType,
  LinkModel,
  LoadingState,
  PanelData,
  PanelProps,
  ThemeContext,
  ThresholdsMode,
  createTheme,
  getDefaultTimeRange,
  toDataFrame,
} from '@grafana/data';
import {
  DEFAULT_LAYER_STYLE,
  EngineError,
  EngineOptions,
  LayerSpec,
  PointerHit,
  MapEngine,
  WebGLUnavailableError,
  createMapEngine,
} from '../engine';
import { MapPanel } from './MapPanel';
import { DEFAULT_OPTIONS, GeoFlowOptions } from './options';
import { INSPECT_EVENT, RENDERED_FEATURES_ATTRIBUTE } from './testHook';
import { MapViewEvent, MapViewRequestEvent } from './viewEvents';

jest.mock('../engine', () => ({
  ...jest.requireActual('../engine/errors'),
  ...jest.requireActual('../engine/layerStyle'),
  createMapEngine: jest.fn(),
}));

class FakeEngine implements MapEngine {
  stylesheet = '';
  mount = jest.fn<Promise<void>, [HTMLElement, EngineOptions]>(() => Promise.resolve());
  setBasemap = jest.fn();
  setTheme = jest.fn();
  setView = jest.fn();
  fitBounds = jest.fn();
  setLayers = jest.fn();
  /** Attaches the content, as MapLibre's popup does, so tests can query and click it. */
  openTooltip = jest.fn((_lngLat: [number, number], content: HTMLElement, _options: { interactive: boolean }) => {
    document.body.appendChild(content);
  });
  closeTooltip = jest.fn();
  tooltipSpace = jest.fn((_lngLat: [number, number]) => ({ width: 300, height: 200 }));
  setHovered = jest.fn();
  setSelected = jest.fn();
  resize = jest.fn();
  softwareRendering = jest.fn(() => false);
  renderedFeatureCounts = jest.fn(() => Promise.resolve({}));
  destroy = jest.fn();
  errorListeners: Array<(error: EngineError) => void> = [];
  pointerListeners: Record<'click' | 'hover', Set<(hit: PointerHit) => void>> = { click: new Set(), hover: new Set() };
  on = jest.fn((event: string, listener: (payload: never) => void) => {
    if (event === 'error') {
      this.errorListeners.push(listener as (error: EngineError) => void);
    }
    if (event === 'click' || event === 'hover') {
      const listeners = this.pointerListeners[event];
      listeners.add(listener as (hit: PointerHit) => void);
      return () => listeners.delete(listener as (hit: PointerHit) => void);
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

/** How jsdom reports a hex color set as an inline style. */
function hexToRgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Moves every panel on or off screen. */
/** A query's new result after a refresh with the same data: a new frame with new values arrays. */
function refreshed(frame: DataFrame): DataFrame {
  return { ...frame, fields: frame.fields.map((field) => ({ ...field, values: [...field.values] })) };
}

/** A query's new result after a refresh with changed data: the last column's last value changes. */
function changed(frame: DataFrame): DataFrame {
  const next = refreshed(frame);
  const values = next.fields.at(-1)!.values;
  // A trailing space keeps GeoJSON text valid.
  values[values.length - 1] = `${values[values.length - 1]} `;
  return next;
}

/** What Grafana does when field config changes: new frame and field objects around the same values. */
function withFieldConfig(frame: DataFrame, custom: Record<string, unknown>): DataFrame {
  return { ...frame, fields: frame.fields.map((field) => ({ ...field, config: { ...field.config, custom } })) };
}

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
  eventBus?: EventBusSrv;
  options?: Partial<GeoFlowOptions>;
  data?: Partial<PanelData>;
  width?: number;
  height?: number;
}

function props({ options, data, eventBus, width = 400, height = 300 }: PanelOverrides = {}) {
  return {
    id: 1,
    eventBus,
    data: { state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange(), ...data },
    // A fixed view, as most of these tests expect; the fit tests set Fit to data.
    options: { ...DEFAULT_OPTIONS, view: { ...DEFAULT_OPTIONS.view, mode: 'fixed' }, ...options },
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
      await renderPanel({ options: { view: { mode: 'fixed', lat: 35.79, lon: -78.78, zoom: 15 } } });

      expect(createMapEngine).toHaveBeenCalledTimes(1);
      expect(engine.mount).toHaveBeenCalledTimes(1);
      expect(engine.mount).toHaveBeenCalledWith(screen.getByTestId('geoflow-map'), {
        basemap: { kind: 'osm' },
        view: { center: [-78.78, 35.79], zoom: 15 },
        theme: { dark: expect.any(Boolean), background: expect.any(String) },
        layers: [],
      });
    });

    it("applies the engine's stylesheet to the map, scoped to the panel, before mounting", async () => {
      engine.stylesheet = '.maplibregl-ctrl { background-color: salmon; }';
      let background = '';
      engine.mount.mockImplementation((container) => {
        const element = container.appendChild(document.createElement('div'));
        element.className = 'maplibregl-ctrl';
        background = getComputedStyle(element).backgroundColor;
        return Promise.resolve();
      });
      await renderPanel();

      expect(background).toBe('rgb(250, 128, 114)');
      const outside = document.body.appendChild(document.createElement('div'));
      outside.className = 'maplibregl-ctrl';
      expect(getComputedStyle(outside).backgroundColor).not.toBe('rgb(250, 128, 114)');
      outside.remove();
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
      rerender(<MapPanel {...props({ options: { view: { mode: 'fixed', lat: 1, lon: 2, zoom: 3 } } })} />);

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
      rerender(<MapPanel {...props({ options: { view: { mode: 'fixed', lat: 1, lon: 2, zoom: 3 } } })} />);

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

    it('shows a data layer error under its query, not the basemap, until new data arrives', async () => {
      const series = [toDataFrame({ refId: 'A', fields: [{ name: 'geometry', type: FieldType.string, values: [] }] })];
      const { rerender } = await renderPanel({ data: { series } });
      act(() => engine.errorListeners.forEach((listener) => listener({ message: 'bad GeoJSON', layerId: 'A' })));

      expect(screen.getByTestId('geoflow-layer-error')).toHaveTextContent('Query A: bad GeoJSON');
      expect(screen.queryByTestId('geoflow-basemap-error')).not.toBeInTheDocument();

      rerender(<MapPanel {...props({ data: { series: [toDataFrame({ ...series[0] })] } })} />);
      expect(screen.queryByTestId('geoflow-layer-error')).not.toBeInTheDocument();
    });
  });

  describe('tooltips', () => {
    const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;
    /** Text ids, so MapLibre ids are row indexes and keys are the ids. */
    const assets = (rows: Array<[string, string]>) =>
      toDataFrame({
        refId: 'A',
        fields: [
          { name: 'id', type: FieldType.string, values: rows.map(([id]) => id) },
          { name: 'name', type: FieldType.string, values: rows.map(([, name]) => name) },
          { name: 'geometry', type: FieldType.string, values: rows.map((_, i) => point(-78.78 + i / 1000)) },
        ],
      });
    const noKeys = toDataFrame({
      refId: 'B',
      fields: [
        { name: 'name', type: FieldType.string, values: ['Cable 1', 'Cable 2'] },
        { name: 'geometry', type: FieldType.string, values: [point(-78.7), point(-78.71)] },
      ],
    });
    const series = [
      assets([
        ['a', 'Office'],
        ['b', 'Depot'],
      ]),
      noKeys,
    ];
    const at: [number, number] = [-78.78, 35.78];
    const hit = (...features: Array<[string, number]>): PointerHit => ({
      lngLat: at,
      features: features.map(([layerId, featureId]) => ({ layerId, featureId })),
    });

    function fire(event: 'click' | 'hover', pointerHit: PointerHit) {
      act(() => engine.pointerListeners[event].forEach((listener) => listener(pointerHit)));
    }
    /** The tooltip content the panel last handed to the engine. */
    function tooltip() {
      const [, element, options] = engine.openTooltip.mock.lastCall!;
      return {
        content: within(element as HTMLElement),
        interactive: (options as { interactive: boolean }).interactive,
      };
    }
    const lastOf = (mock: jest.Mock) => mock.mock.lastCall?.[0];

    it('pins a tooltip on click, with the feature and its query, and selects it', async () => {
      await renderPanel({ data: { series } });
      fire('click', hit(['A', 1]));
      const { content, interactive } = tooltip();

      expect(engine.openTooltip).toHaveBeenLastCalledWith(at, expect.any(HTMLElement), { interactive: true });
      expect(interactive).toBe(true);
      expect(content.getByText('Query A')).toBeInTheDocument();
      expect(content.getByText('Depot')).toBeInTheDocument();
      expect(lastOf(engine.setSelected)).toEqual({ layerId: 'A', featureId: 1 });
    });

    it("titles a tooltip with its layer's name", async () => {
      await renderPanel({ data: { series }, options: { layers: [{ id: 'A', name: 'Assets' }] } });
      fire('click', hit(['A', 1]));

      expect(tooltip().content.getByText('Assets')).toBeInTheDocument();
    });

    it('closes a pinned tooltip when its layer is hidden, and keeps it closed when shown again', async () => {
      const view = await renderPanel({ data: { series } });
      fire('click', hit(['A', 1]));
      expect(lastOf(engine.setSelected)).toEqual({ layerId: 'A', featureId: 1 });

      const rerender = (layers: GeoFlowOptions['layers']) =>
        act(() => view.rerender(<MapPanel {...props({ data: { series }, options: { layers } })} />));
      rerender([{ id: 'A', visible: false }]);
      expect(engine.closeTooltip).toHaveBeenCalled();
      expect(lastOf(engine.setSelected)).toBeUndefined();

      engine.openTooltip.mockClear();
      rerender([{ id: 'A' }]);
      expect(engine.openTooltip).not.toHaveBeenCalled();
    });

    it("leaves a hidden layer's features out of a pinned tooltip with others", async () => {
      const view = await renderPanel({ data: { series } });
      fire('click', hit(['B', 0], ['A', 0]));
      act(() =>
        view.rerender(<MapPanel {...props({ data: { series }, options: { layers: [{ id: 'B', visible: false }] } })} />)
      );

      expect(tooltip().content.queryByTestId('geoflow-tooltip-pager')).not.toBeInTheDocument();
      expect(tooltip().content.getByText('Office')).toBeInTheDocument();
    });

    it("drops a hover tooltip when its layer's tooltips are turned off", async () => {
      const view = await renderPanel({ data: { series } });
      fire('hover', hit(['A', 1]));
      expect(lastOf(engine.setHovered)).toEqual({ layerId: 'A', featureId: 1 });

      act(() =>
        view.rerender(
          <MapPanel {...props({ data: { series }, options: { layers: [{ id: 'A', tooltips: false }] } })} />
        )
      );
      expect(lastOf(engine.setHovered)).toBeUndefined();
      expect(engine.closeTooltip).toHaveBeenCalled();
    });

    it('sizes the tooltip to the room the map has beside it, measured when it opens', async () => {
      await renderPanel({ data: { series } });
      engine.tooltipSpace.mockReturnValue({ width: 600, height: 150 });
      fire('click', hit(['A', 1]));
      const box = () => (engine.openTooltip.mock.lastCall![1] as HTMLElement).firstElementChild as HTMLElement;

      expect(engine.tooltipSpace).toHaveBeenLastCalledWith(at);
      // Never wider than 400 px, however much room there is.
      expect(box().style).toMatchObject({ maxWidth: '400px', maxHeight: '150px', minWidth: '180px' });

      // Panning doesn't resize a pinned tooltip; paging keeps its size too.
      engine.tooltipSpace.mockReturnValue({ width: 100, height: 50 });
      fire('hover', hit(['A', 0]));
      expect(box().style).toMatchObject({ maxWidth: '400px', maxHeight: '150px' });
    });

    it('lets a tooltip narrower than its usual minimum fit a small map', async () => {
      await renderPanel({ data: { series } });
      engine.tooltipSpace.mockReturnValue({ width: 120, height: 90 });
      fire('hover', hit(['A', 1]));
      const box = (engine.openTooltip.mock.lastCall![1] as HTMLElement).firstElementChild as HTMLElement;

      expect(box.style).toMatchObject({ maxWidth: '120px', maxHeight: '90px', minWidth: '120px' });
    });

    it('pages through overlapping features, topmost first', async () => {
      await renderPanel({ data: { series } });
      fire('click', hit(['B', 0], ['A', 0]));
      expect(tooltip().content.getByTestId('geoflow-tooltip-pager')).toHaveTextContent('1 of 2');
      expect(tooltip().content.getByText('Cable 1')).toBeInTheDocument();

      act(() => tooltip().content.getByRole('button', { name: 'Next feature' }).click());

      expect(tooltip().content.getByTestId('geoflow-tooltip-pager')).toHaveTextContent('2 of 2');
      expect(tooltip().content.getByText('Office')).toBeInTheDocument();
      expect(lastOf(engine.setSelected)).toEqual({ layerId: 'A', featureId: 0 });
    });

    it.each([
      ['a click on empty map', () => fire('click', hit())],
      ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
      ['the close button', () => act(() => tooltip().content.getByRole('button', { name: 'Close' }).click())],
    ])('unpins on %s', async (_, close) => {
      await renderPanel({ data: { series } });
      fire('click', hit(['A', 1]));
      engine.closeTooltip.mockClear();
      close();

      expect(engine.closeTooltip).toHaveBeenCalled();
      expect(lastOf(engine.setSelected)).toBeUndefined();
    });

    it('shows a compact tooltip on hover that lets the pointer through, and highlights', async () => {
      await renderPanel({ data: { series } });
      fire('hover', hit(['A', 0], ['B', 1]));
      const { content, interactive } = tooltip();

      expect(interactive).toBe(false);
      expect(content.getByText('Office')).toBeInTheDocument();
      expect(content.getByTestId('geoflow-tooltip-more')).toHaveTextContent('+1 more');
      expect(content.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
      expect(lastOf(engine.setHovered)).toEqual({ layerId: 'A', featureId: 0 });

      fire('hover', hit());
      expect(engine.closeTooltip).toHaveBeenCalled();
      expect(lastOf(engine.setHovered)).toBeUndefined();
    });

    it('only moves the hover highlight while a tooltip is pinned', async () => {
      await renderPanel({ data: { series } });
      fire('click', hit(['A', 1]));
      engine.openTooltip.mockClear();
      fire('hover', { lngLat: [1, 2], features: [{ layerId: 'B', featureId: 0 }] });

      expect(engine.openTooltip).not.toHaveBeenCalledWith([1, 2], expect.anything(), expect.anything());
      expect(lastOf(engine.setHovered)).toEqual({ layerId: 'B', featureId: 0 });
      expect(lastOf(engine.setSelected)).toEqual({ layerId: 'A', featureId: 1 });
    });

    it('in Click mode, highlights on hover without a tooltip, and pins on click', async () => {
      await renderPanel({ data: { series }, options: { tooltip: 'click' } });
      fire('hover', hit(['A', 0]));

      expect(engine.openTooltip).not.toHaveBeenCalled();
      expect(lastOf(engine.setHovered)).toEqual({ layerId: 'A', featureId: 0 });

      fire('click', hit(['A', 0]));
      expect(tooltip().interactive).toBe(true);
    });

    it('when Off, makes layers non-interactive and ignores clicks', async () => {
      await renderPanel({ data: { series }, options: { tooltip: 'off' } });
      fire('click', hit(['A', 0]));

      expect((engine.setLayers.mock.lastCall![0] as LayerSpec[]).every((layer) => !layer.interactive)).toBe(true);
      expect(engine.openTooltip).not.toHaveBeenCalled();
    });

    it('follows a pinned feature by its key when new data arrives', async () => {
      const { rerender } = await renderPanel({ data: { series } });
      fire('click', hit(['A', 1]));
      // Depot moves to row 0, so its MapLibre id (the row index) changes from 1 to 0.
      rerender(
        <MapPanel
          {...props({
            data: {
              series: [
                assets([
                  ['b', 'Depot'],
                  ['c', 'Hub'],
                ]),
                noKeys,
              ],
            },
          })}
        />
      );

      expect(tooltip().content.getByText('Depot')).toBeInTheDocument();
      expect(lastOf(engine.setSelected)).toEqual({ layerId: 'A', featureId: 0 });
    });

    it('closes when the pinned feature is gone from new data', async () => {
      const { rerender } = await renderPanel({ data: { series } });
      fire('click', hit(['A', 1]));
      engine.closeTooltip.mockClear();
      rerender(<MapPanel {...props({ data: { series: [assets([['c', 'Hub']]), noKeys] } })} />);

      expect(engine.closeTooltip).toHaveBeenCalled();
    });

    it('keeps a hover tooltip through a refresh with the same data, and drops it when the data changes', async () => {
      const { rerender } = await renderPanel({ data: { series } });
      fire('hover', hit(['B', 0]));
      engine.closeTooltip.mockClear();
      rerender(<MapPanel {...props({ data: { series: series.map(refreshed) } })} />);

      expect(engine.closeTooltip).not.toHaveBeenCalled();
      expect(tooltip().content.getByText('Cable 1')).toBeInTheDocument();

      rerender(<MapPanel {...props({ data: { series: [series[0], changed(noKeys)] } })} />);
      expect(engine.closeTooltip).toHaveBeenCalled();
    });

    it('keeps a pinned feature without a key through a refresh with the same data', async () => {
      const { rerender } = await renderPanel({ data: { series } });
      fire('click', hit(['B', 0]));
      engine.closeTooltip.mockClear();
      rerender(<MapPanel {...props({ data: { series: series.map(refreshed) } })} />);

      expect(engine.closeTooltip).not.toHaveBeenCalled();
      expect(tooltip().content.getByText('Cable 1')).toBeInTheDocument();
    });

    it("closes when a pinned feature's layer has no keys and its data changed", async () => {
      const { rerender } = await renderPanel({ data: { series } });
      fire('click', hit(['B', 0]));
      engine.closeTooltip.mockClear();
      rerender(<MapPanel {...props({ data: { series: [series[0], changed(noKeys)] } })} />);

      expect(engine.closeTooltip).toHaveBeenCalled();
    });

    it('keeps a pinned feature when only another layer changed', async () => {
      const { rerender } = await renderPanel({ data: { series } });
      fire('click', hit(['B', 1]));
      engine.closeTooltip.mockClear();
      rerender(<MapPanel {...props({ data: { series: [assets([['z', 'Other']]), noKeys] } })} />);

      expect(engine.closeTooltip).not.toHaveBeenCalled();
      expect(tooltip().content.getByText('Cable 2')).toBeInTheDocument();
    });

    it('closes when the basemap changes', async () => {
      const { rerender } = await renderPanel({ data: { series } });
      fire('click', hit(['A', 1]));
      engine.closeTooltip.mockClear();
      rerender(<MapPanel {...props({ data: { series }, options: { basemap: { kind: 'none' } } })} />);

      expect(engine.closeTooltip).toHaveBeenCalled();
    });

    describe('data links', () => {
      /** Grafana gives fields with links a getLinks that fills in the row's values. */
      function withLink(frame: DataFrame) {
        const name = frame.fields.find((field) => field.name === 'name')!;
        name.getLinks = ({ valueRowIndex }) => [
          {
            title: `Open ${name.values[valueRowIndex!]}`,
            href: `/d/assets?var-name=${name.values[valueRowIndex!]}`,
            target: '_self',
            origin: name,
          } as LinkModel<Field>,
        ];
        return frame;
      }

      it("shows the feature's links in the pinned tooltip", async () => {
        await renderPanel({
          data: {
            series: [
              withLink(
                assets([
                  ['a', 'Office'],
                  ['b', 'Depot'],
                ])
              ),
            ],
          },
        });
        fire('click', hit(['A', 1]));
        const link = tooltip().content.getByRole('link', { name: /Open Depot/ });

        expect(link).toHaveAttribute('href', '/d/assets?var-name=Depot');
      });

      it('leaves links out of the hover tooltip, where the pointer could not reach them', async () => {
        await renderPanel({ data: { series: [withLink(assets([['a', 'Office']]))] } });
        fire('hover', hit(['A', 0]));

        expect(tooltip().content.getByText('Office')).toBeInTheDocument();
        expect(tooltip().content.queryByRole('link')).not.toBeInTheDocument();
      });
    });

    it('starts without a tooltip on a map created after the panel comes back on screen', async () => {
      await renderPanel({ data: { series } });
      fire('click', hit(['A', 1]));
      setOnScreen(false);
      const second = new FakeEngine();
      jest.mocked(createMapEngine).mockResolvedValue(second);
      setOnScreen(true);
      await act(async () => {});

      expect(second.openTooltip).not.toHaveBeenCalled();
      expect(engine.pointerListeners.click.size).toBe(0);
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

    it('draws the layers in the saved order, bottom first, with their names, visibility and tooltips', async () => {
      await renderPanel({
        data: { series: [points, lines] },
        options: {
          layers: [
            { id: 'A', name: 'Points', visible: false },
            { id: 'B', tooltips: false },
          ],
        },
      });

      expect(lastLayers().map(({ id, name, visible, interactive }) => [id, name, visible, interactive])).toEqual([
        ['B', 'Query B', true, false],
        ['A', 'Points', false, true],
      ]);
    });

    it('draws a layer from the geometry column given in its settings', async () => {
      const twoColumns = toDataFrame({
        refId: 'A',
        fields: [
          { name: 'footprint', type: FieldType.string, values: ['{"type":"LineString","coordinates":[[1,2],[3,4]]}'] },
          { name: 'centroid', type: FieldType.string, values: ['{"type":"Point","coordinates":[2,3]}'] },
        ],
      });
      await renderPanel({
        data: { series: [twoColumns] },
        options: { layers: [{ id: 'A', geometryField: 'centroid' }] },
      });

      expect(lastLayers()[0].data.features[0].geometry).toEqual({ type: 'Point', coordinates: [2, 3] });
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
      rerender(<MapPanel {...props({ data: { series: [points, changed(lines)] } })} />);
      const after = lastLayers();

      expect(after[0].data).toBe(before[0].data);
      expect(after[1].data).not.toBe(before[1].data);
    });

    it('keeps the data of every layer through a refresh that brings the same data in new arrays', async () => {
      const { rerender } = await renderPanel({ data: { series: [points, lines] } });
      const before = lastLayers();
      rerender(<MapPanel {...props({ data: { series: [refreshed(points), refreshed(lines)] } })} />);
      const after = lastLayers();

      expect(after.map((layer) => layer.data)).toEqual(before.map((layer) => layer.data));
      expect(after[0].data).toBe(before[0].data);
      expect(after[1].data).toBe(before[1].data);
    });

    it('restyles a layer from new field config, keeping its data', async () => {
      const { rerender } = await renderPanel({ data: { series: [points, lines] } });
      const before = lastLayers();
      rerender(<MapPanel {...props({ data: { series: [points, withFieldConfig(lines, { lineWidth: 6 })] } })} />);
      const after = lastLayers();

      expect(after[1].style.lineWidth).toBe(6);
      expect(after[1].data).toBe(before[1].data);
      expect(after[0]).toEqual(before[0]);
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

    it('switches to the dark theme URL with the theme, keeping the map', async () => {
      const basemap = {
        kind: 'raster' as const,
        tileUrl: 'https://t/{z}/{x}/{y}.png',
        darkTileUrl: 'https://d/{z}/{x}/{y}.png',
      };
      const panel = (mode: 'light' | 'dark') => (
        <ThemeContext.Provider value={createTheme({ colors: { mode } })}>
          <MapPanel {...props({ options: { basemap } })} />
        </ThemeContext.Provider>
      );
      const { rerender } = render(panel('light'));
      await act(async () => {});
      expect(engine.mount.mock.lastCall![1].basemap).toMatchObject({ tiles: ['https://t/{z}/{x}/{y}.png'] });

      rerender(panel('dark'));
      expect(engine.setBasemap).toHaveBeenLastCalledWith({
        kind: 'raster',
        tiles: ['https://d/{z}/{x}/{y}.png'],
        attribution: '',
        dimInDark: false,
      });
      rerender(panel('light'));
      expect(engine.setBasemap).toHaveBeenLastCalledWith(
        expect.objectContaining({ tiles: ['https://t/{z}/{x}/{y}.png'] })
      );
      expect(engine.mount).toHaveBeenCalledTimes(1);
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

  describe('data-driven styling', () => {
    const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;
    const thresholds = {
      mode: ThresholdsMode.Absolute,
      steps: [
        { value: -Infinity, color: 'green' },
        { value: 80, color: 'red' },
      ],
    };
    const theme = createTheme();
    const red = theme.visualization.getColorByName('red');
    /** Patch panels colored by utilization, as the panel gets them from Grafana. */
    const panels = (custom: Record<string, unknown> = { colorBy: 'utilization_pct' }) =>
      toDataFrame({
        refId: 'A',
        fields: [
          { name: 'name', type: FieldType.string, values: ['PP-1', 'PP-2'] },
          {
            name: 'utilization_pct',
            type: FieldType.number,
            values: [40, 95],
            config: { thresholds, color: { mode: FieldColorModeId.Thresholds } },
          },
          { name: 'geometry', type: FieldType.string, values: [point(-78.78), point(-78.77)], config: { custom } },
        ],
      });
    const lastLayers = (): LayerSpec[] => engine.setLayers.mock.lastCall![0];

    it("gives the engine each feature's color", async () => {
      await renderPanel({ data: { series: [panels()] } });

      expect(lastLayers()[0].featureStyles).toEqual({ colors: [theme.visualization.getColorByName('green'), red] });
    });

    it("shows a legend of the column's colors over the map", async () => {
      await renderPanel({ data: { series: [panels()] } });
      const legend = within(screen.getByTestId('geoflow-legend-A'));

      expect(legend.getByText('Query A · utilization_pct')).toBeInTheDocument();
      expect(legend.getByText('< 80')).toBeInTheDocument();
      expect(legend.getByText('80+')).toBeInTheDocument();
    });

    it('shows a by-value scheme as a bar from Min to Max', async () => {
      const frame = panels();
      frame.fields[1].config = { color: { mode: 'continuous-GrYlRd' as FieldColorModeId }, min: 0, max: 100 };
      await renderPanel({ data: { series: [frame] } });

      expect(screen.getByTestId('geoflow-legend-gradient')).toHaveTextContent(/^0.*100$/);
    });

    it('shows no legend without Color by, when turned off, or on a narrow panel', async () => {
      const { rerender } = await renderPanel({ data: { series: [panels({ sizeBy: 'utilization_pct' })] } });
      expect(screen.queryByTestId('geoflow-legend')).not.toBeInTheDocument();

      rerender(<MapPanel {...props({ data: { series: [panels()] }, options: { legend: { show: false } } })} />);
      expect(screen.queryByTestId('geoflow-legend')).not.toBeInTheDocument();

      rerender(<MapPanel {...props({ data: { series: [panels()] }, width: 150 })} />);
      expect(screen.queryByTestId('geoflow-legend')).not.toBeInTheDocument();

      rerender(<MapPanel {...props({ data: { series: [panels()] } })} />);
      expect(screen.getByTestId('geoflow-legend')).toBeInTheDocument();
    });

    it("marks a tooltip with the feature's own color", async () => {
      await renderPanel({ data: { series: [panels()] } });
      act(() =>
        engine.pointerListeners.click.forEach((listener) =>
          listener({ lngLat: [0, 0], features: [{ layerId: 'A', featureId: 1 }] })
        )
      );
      const [, element] = engine.openTooltip.mock.lastCall!;
      const marker = (element as HTMLElement).querySelector<HTMLElement>('[style*="background"]');

      expect(marker?.style.background || marker?.style.backgroundColor).toBe(hexToRgb(red));
    });

    it('says in the data summary when Color by names a column the query lacks', async () => {
      await renderPanel({ data: { series: [panels({ colorBy: 'gone' })] }, options: { showSummary: true } });

      expect(screen.getByTestId('geoflow-frame-A')).toHaveTextContent('Color by: no column named gone');
      expect(lastLayers()[0]).not.toHaveProperty('featureStyles');
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

    it('names a layer with a name of its own or that is hidden, and reports a missing ID column', async () => {
      await renderPanel({
        data: { series },
        options: { showSummary: true, layers: [{ id: 'A', name: 'Assets', visible: false, idField: 'key' }] },
      });

      expect(screen.getByTestId('geoflow-summary-layer-A')).toHaveTextContent('Assets · hidden');
      expect(screen.getByTestId('geoflow-frame-A')).toHaveTextContent('ID column: no column named key');
      expect(screen.queryByTestId('geoflow-summary-layer-B')).not.toBeInTheDocument();
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

  describe('fit to data', () => {
    const geometryFrame = (refId: string, coordinates: Array<[number, number]>) =>
      toDataFrame({
        refId,
        fields: [
          {
            name: 'geometry',
            type: FieldType.string,
            values: coordinates.map((position) => JSON.stringify({ type: 'Point', coordinates: position })),
          },
        ],
      });
    const a = geometryFrame('A', [
      [1, 2],
      [3, 4],
    ]);
    const b = geometryFrame('B', [[10, 20]]);
    const fitView: GeoFlowOptions['view'] = { ...DEFAULT_OPTIONS.view, mode: 'fit', lat: 5, lon: 6, zoom: 7 };
    /** Data from a query run; a new requestId is a new query response. */
    const response = (requestId: string, series: DataFrame[] = [a, b], state = LoadingState.Done) =>
      ({ series, state, request: { requestId } }) as unknown as Partial<PanelData>;
    const options = (view: Partial<GeoFlowOptions['view']> = {}, more: Partial<GeoFlowOptions> = {}) => ({
      view: { ...fitView, ...view },
      ...more,
    });

    it('frames the visible layers when the map is created, before anything is drawn', async () => {
      await renderPanel({ data: response('Q1'), options: options() });

      expect(engine.mount.mock.lastCall![1].fit).toEqual({
        bounds: [1, 2, 10, 20],
        padding: 40,
        maxZoom: 17,
      });
      expect(engine.fitBounds).not.toHaveBeenCalled();
    });

    it('starts at the fixed view without data, and fits when data with geometry arrives', async () => {
      const { rerender } = await renderPanel({ options: options() });
      expect(engine.mount.mock.lastCall![1]).toMatchObject({ view: { center: [6, 5], zoom: 7 } });
      expect(engine.mount.mock.lastCall![1].fit).toBeUndefined();

      rerender(<MapPanel {...props({ data: response('Q1', [a]), options: options() })} />);

      expect(engine.fitBounds).toHaveBeenCalledTimes(1);
      expect(engine.fitBounds).toHaveBeenLastCalledWith([1, 2, 3, 4], expect.objectContaining({ padding: 40 }));
    });

    it('leaves out hidden layers', async () => {
      await renderPanel({ data: response('Q1'), options: options({}, { layers: [{ id: 'B', visible: false }] }) });

      expect(engine.mount.mock.lastCall![1].fit?.bounds).toEqual([1, 2, 3, 4]);
    });

    it('does not fit again on a refresh, a style change, hiding a layer or a change to the fixed view', async () => {
      const { rerender } = await renderPanel({ data: response('Q1'), options: options() });
      rerender(<MapPanel {...props({ data: response('Q2'), options: options() })} />);
      rerender(
        <MapPanel {...props({ data: response('Q2', [withFieldConfig(a, { lineWidth: 3 }), b]), options: options() })} />
      );
      rerender(
        <MapPanel
          {...props({ data: response('Q2'), options: options({}, { layers: [{ id: 'B', visible: false }] }) })}
        />
      );
      rerender(<MapPanel {...props({ data: response('Q2'), options: options({ lat: 50 }) })} />);

      expect(engine.fitBounds).not.toHaveBeenCalled();
      expect(engine.setView).not.toHaveBeenCalled();
    });

    it('with Fit on refresh, fits on every query response once it has arrived', async () => {
      const refreshing = options({ fitOnRefresh: true });
      const { rerender } = await renderPanel({ data: response('Q1'), options: refreshing });
      rerender(<MapPanel {...props({ data: response('Q2', [a, b], LoadingState.Loading), options: refreshing })} />);
      expect(engine.fitBounds).not.toHaveBeenCalled();

      rerender(<MapPanel {...props({ data: response('Q2', [a]), options: refreshing })} />);
      expect(engine.fitBounds).toHaveBeenCalledTimes(1);
      expect(engine.fitBounds).toHaveBeenLastCalledWith([1, 2, 3, 4], expect.anything());

      // A style change keeps the requestId.
      rerender(
        <MapPanel {...props({ data: response('Q2', [withFieldConfig(a, { lineWidth: 3 })]), options: refreshing })} />
      );
      expect(engine.fitBounds).toHaveBeenCalledTimes(1);
    });

    it('fits again when a fit setting changes', async () => {
      const { rerender } = await renderPanel({ data: response('Q1'), options: options() });
      rerender(<MapPanel {...props({ data: response('Q1'), options: options({ padding: 10, maxZoom: 12 }) })} />);

      expect(engine.fitBounds).toHaveBeenLastCalledWith([1, 2, 10, 20], { padding: 10, maxZoom: 12 });
    });

    it('moves to the fixed view on switching to Fixed, and fits again on switching back', async () => {
      const { rerender } = await renderPanel({ data: response('Q1'), options: options() });
      rerender(<MapPanel {...props({ data: response('Q1'), options: options({ mode: 'fixed' }) })} />);
      expect(engine.setView).toHaveBeenLastCalledWith({ center: [6, 5], zoom: 7 });

      rerender(<MapPanel {...props({ data: response('Q1'), options: options() })} />);
      expect(engine.fitBounds).toHaveBeenCalledTimes(1);
    });

    it('keeps the view of a map created again after scrolling, without fitting', async () => {
      const { rerender } = await renderPanel({ data: response('Q1'), options: options() });
      const moved = { center: [9, 9] as [number, number], zoom: 11 };
      act(() =>
        jest
          .mocked(engine.on)
          .mock.calls.find(([event]) => event === 'viewChange')![1](moved as never)
      );
      setOnScreen(false);
      rerender(<MapPanel {...props({ data: response('Q2'), options: options() })} />);

      const second = new FakeEngine();
      jest.mocked(createMapEngine).mockResolvedValue(second);
      setOnScreen(true);
      await act(async () => {});

      expect(second.mount.mock.lastCall![1]).toMatchObject({ view: moved });
      expect(second.mount.mock.lastCall![1].fit).toBeUndefined();
      expect(second.fitBounds).not.toHaveBeenCalled();
    });

    it('treats a view saved without a mode as fixed', async () => {
      await renderPanel({
        data: response('Q1'),
        options: { view: { lat: 5, lon: 6, zoom: 7 } as GeoFlowOptions['view'] },
      });

      expect(engine.mount.mock.lastCall![1].fit).toBeUndefined();
    });
  });

  describe('current view for the options pane', () => {
    it("publishes the map's view on the panel's eventBus as it moves, and when asked", async () => {
      const eventBus = new EventBusSrv();
      const views = jest.fn();
      eventBus.subscribe(MapViewEvent, (event) => views(event.payload));
      await renderPanel({ eventBus, options: { view: { ...DEFAULT_OPTIONS.view, mode: 'fixed', lat: 5, lon: 6 } } });

      eventBus.publish(new MapViewRequestEvent());
      expect(views).toHaveBeenLastCalledWith({ center: [6, 5], zoom: 1 });

      const moved = { center: [9, 9], zoom: 11 };
      act(() =>
        jest
          .mocked(engine.on)
          .mock.calls.find(([event]) => event === 'viewChange')![1](moved as never)
      );
      expect(views).toHaveBeenLastCalledWith(moved);
      eventBus.publish(new MapViewRequestEvent());
      expect(views).toHaveBeenLastCalledWith(moved);
    });
  });

  describe('warnings', () => {
    const point = '{"type":"Point","coordinates":[1,2]}';
    const frame = (values: Array<string | null>) =>
      toDataFrame({ refId: 'A', fields: [{ name: 'geometry', type: FieldType.string, values }] });

    it('shows nothing when there is nothing wrong, or only empty geometry', async () => {
      await renderPanel({ data: { series: [frame([point, null])] } });

      expect(screen.queryByTestId('geoflow-warnings')).not.toBeInTheDocument();
    });

    it('counts the problems, and lists them on hover, without the data summary', async () => {
      await renderPanel({
        data: { series: [frame([point, 'not json'])] },
        options: { layers: [{ id: 'A', name: 'Assets', idField: 'key' }] },
      });
      const warning = screen.getByTestId('geoflow-warnings');
      expect(warning).toHaveAccessibleName('2 warnings');

      fireEvent.mouseEnter(warning);
      const details = await screen.findByTestId('geoflow-warnings-details');
      expect(details).toHaveTextContent('Assets: 1 row skipped: invalid 1');
      expect(details).toHaveTextContent('Assets: ID column: no column named key');
    });

    it('is turned off by Show warnings', async () => {
      await renderPanel({ data: { series: [frame([point, 'not json'])] }, options: { showWarnings: false } });

      expect(screen.queryByTestId('geoflow-warnings')).not.toBeInTheDocument();
    });

    it('agrees with the data summary about a layer setting', async () => {
      await renderPanel({
        data: { series: [frame([point])] },
        options: { showSummary: true, layers: [{ id: 'A', idField: 'key' }] },
      });

      expect(screen.getByTestId('geoflow-warnings')).toHaveAccessibleName('1 warning');
      expect(screen.getByTestId('geoflow-frame-A')).toHaveTextContent('ID column: no column named key');
    });
  });

  describe('networks', () => {
    const point = (lon: number) => `{"type":"Point","coordinates":[${lon},2]}`;
    const sites = toDataFrame({
      refId: 'A',
      fields: [
        { name: 'id', type: FieldType.number, values: [1, 2] },
        { name: 'geometry', type: FieldType.string, values: [point(1), point(3)] },
      ],
    });
    const trunks = toDataFrame({
      refId: 'B',
      fields: [
        { name: 'a_site', type: FieldType.string, values: ['1', '2', '1'] },
        { name: 'z_site', type: FieldType.string, values: ['2', '1', '9'] },
      ],
    });
    const network = {
      layers: [
        { id: 'B', role: 'edges' as const },
        { id: 'A', role: 'nodes' as const },
      ],
    };

    it('draws the edges between the nodes, below them, as an interactive layer', async () => {
      await renderPanel({ data: { series: [sites, trunks] }, options: network });

      const [nodes, edges] = engine.setLayers.mock.calls.at(-1)![0] as LayerSpec[];
      expect([nodes.id, edges.id]).toEqual(['A', 'B']);
      expect(edges.data.features.map(({ geometry }) => geometry)).toEqual([
        {
          type: 'LineString',
          coordinates: [
            [1, 2],
            [3, 2],
          ],
        },
      ]);
      expect(edges.interactive).toBe(true);
    });

    const fire = (event: 'click' | 'hover', featureId: number) =>
      act(() =>
        engine.pointerListeners[event].forEach((listener) =>
          listener({ lngLat: [2, 2], features: [{ layerId: 'B', featureId }] })
        )
      );
    const tooltipText = () => (engine.openTooltip.mock.lastCall![1] as HTMLElement).textContent;

    it("shows a hovered edge's pair: its nodes and links", async () => {
      await renderPanel({ data: { series: [sites, trunks] }, options: network });
      fire('hover', 0);

      expect(tooltipText()).toContain('Between1 and 2');
      expect(tooltipText()).toContain('Items2');
    });

    it("lists a pinned pair's rows, wider than other tooltips, but not on hover", async () => {
      await renderPanel({ data: { series: [sites, trunks] }, options: network });
      engine.tooltipSpace.mockReturnValue({ width: 1000, height: 600 });
      fire('hover', 0);
      expect(tooltipText()).not.toContain('Search');
      const hovered = engine.openTooltip.mock.lastCall![1] as HTMLElement;
      expect(within(hovered).getByTestId('geoflow-tooltip').style.maxWidth).toBe('400px');

      fire('click', 0);
      const element = engine.openTooltip.mock.lastCall![1] as HTMLElement;
      expect(within(element).getAllByTestId('geoflow-edge-list-row')).toHaveLength(2);
      expect(within(element).getByTestId('geoflow-edge-list-count')).toHaveTextContent('2 items');
      expect(
        within(element)
          .getAllByRole('cell')
          .map((cell) => cell.textContent)
      ).toContain('2 → 1');
      expect(within(element).getByTestId('geoflow-tooltip').style.maxWidth).toBe('800px');
    });

    it('leaves the direction out of the list when Show direction is off', async () => {
      await renderPanel({
        data: { series: [sites, trunks] },
        options: {
          layers: [
            { id: 'B', role: 'edges', showDirection: false },
            { id: 'A', role: 'nodes' },
          ],
        },
      });
      fire('click', 0);

      const element = engine.openTooltip.mock.lastCall![1] as HTMLElement;
      expect(within(element).queryByRole('columnheader', { name: 'Direction' })).not.toBeInTheDocument();
    });

    it('keeps a pinned pair through new data, by its nodes, and closes it when the pair is gone', async () => {
      const { rerender } = await renderPanel({ data: { series: [sites, trunks] }, options: network });
      fire('click', 0);
      expect(tooltipText()).toContain('Items2');

      const more = toDataFrame({
        refId: 'B',
        fields: [
          { name: 'a_site', type: FieldType.string, values: ['2', '1', '2'] },
          { name: 'z_site', type: FieldType.string, values: ['1', '2', '1'] },
        ],
      });
      rerender(<MapPanel {...props({ data: { series: [sites, more] }, options: network })} />);
      expect(tooltipText()).toContain('Items3');

      const none = toDataFrame({
        refId: 'B',
        fields: [
          { name: 'a_site', type: FieldType.string, values: ['1'] },
          { name: 'z_site', type: FieldType.string, values: ['9'] },
        ],
      });
      rerender(<MapPanel {...props({ data: { series: [sites, none] }, options: network })} />);
      expect(engine.closeTooltip).toHaveBeenCalled();
    });

    it('warns about edges it cannot draw, and summarizes them as pairs', async () => {
      await renderPanel({ data: { series: [sites, trunks] }, options: { ...network, showSummary: true } });

      fireEvent.mouseEnter(screen.getByTestId('geoflow-warnings'));
      expect(await screen.findByTestId('geoflow-warnings-details')).toHaveTextContent(
        'Query B: 1 row skipped: unknown node 1'
      );
      expect(screen.getByTestId('geoflow-summary-B')).toHaveTextContent('B: 3 rows → 1 pair (a_site → z_site)');
    });

    it('says why there is no network, on the map and in the data summary', async () => {
      await renderPanel({
        data: { series: [sites, trunks] },
        options: { layers: [{ id: 'B', role: 'edges' }], showSummary: true },
      });

      expect(screen.getByTestId('geoflow-frame-B')).toHaveTextContent(
        'No Nodes layer: edges join the points of a Nodes layer'
      );
      expect(screen.getByTestId('geoflow-warnings')).toHaveAccessibleName('1 warning');
    });
  });

  describe('a failed query', () => {
    const geometry = (lon: number) => `{"type":"Point","coordinates":[${lon},2]}`;
    const frame = (refId: string, lon = 1) =>
      toDataFrame({ refId, fields: [{ name: 'geometry', type: FieldType.string, values: [geometry(lon)] }] });
    const drawn = () => engine.setLayers.mock.lastCall![0] as LayerSpec[];

    it('keeps drawing the last data, without sending it to the map again', async () => {
      const series = [frame('A'), frame('B')];
      const { rerender } = await renderPanel({ data: { series } });
      const before = drawn();
      series.forEach((f) => f.fields.forEach((field) => (field.values.length = 0)));
      rerender(<MapPanel {...props({ data: { series: [], state: LoadingState.Error } })} />);

      expect(drawn().map(({ id }) => id)).toEqual(['A', 'B']);
      expect(drawn()[0].data).toBe(before[0].data);
      expect(drawn()[1].data).toBe(before[1].data);
    });

    it('keeps only the query that failed, and recovers without redrawing', async () => {
      const { rerender } = await renderPanel({ data: { series: [frame('A'), frame('B')] } });
      const before = drawn();
      rerender(<MapPanel {...props({ data: { series: [frame('B', 5)], state: LoadingState.Error } })} />);
      expect(drawn()[0].data).toBe(before[0].data);
      expect(drawn()[1].data).not.toBe(before[1].data);

      rerender(<MapPanel {...props({ data: { series: [frame('A'), frame('B', 5)] } })} />);
      expect(drawn()[0].data).toBe(before[0].data);
    });
  });

  describe('data summary hints', () => {
    const rows = (ids: number[]) =>
      toDataFrame({
        refId: 'A',
        fields: [
          { name: 'id', type: FieldType.number, values: ids },
          { name: 'geometry', type: FieldType.string, values: ids.map(() => '{"type":"Point","coordinates":[1,2]}') },
        ],
      });

    it('says to add ORDER BY when a refresh brings the same ids in another order', async () => {
      const options = { showSummary: true };
      const { rerender } = await renderPanel({ data: { series: [rows([1, 2])] }, options });
      expect(screen.queryByText(/add ORDER BY/)).not.toBeInTheDocument();

      rerender(<MapPanel {...props({ data: { series: [rows([2, 1])] }, options })} />);
      expect(screen.getByText(/add ORDER BY/)).toBeInTheDocument();

      rerender(<MapPanel {...props({ data: { series: [rows([3, 1])] }, options })} />);
      expect(screen.queryByText(/add ORDER BY/)).not.toBeInTheDocument();
    });

    it('says when the browser draws without a GPU', async () => {
      engine.softwareRendering.mockReturnValue(true);
      await renderPanel({ data: { series: [rows([1])] }, options: { showSummary: true } });

      expect(screen.getByTestId('geoflow-summary-software')).toHaveTextContent('without a GPU');
    });
  });
});
