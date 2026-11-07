import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { DataFrame, GrafanaTheme2, LoadingState, PanelProps } from '@grafana/data';
import { Button, useStyles2, useTheme2 } from '@grafana/ui';
import { BoundLayer, ConversionResult, bindLayers, buildLayerSpecs, dataStyleFields, legendEntries } from '../adapter';
import { BasemapSpec, EngineOptions, LayerSpec, MapEngine, WebGLUnavailableError, createMapEngine } from '../engine';
import { Bounds, unionBounds } from '../model';
import { conversionSummary, firstWarning } from './conversionSummary';
import { ConversionHistory, convertFrames } from './convertFrames';
import {
  FitSettings,
  GeoFlowOptions,
  basemapFromOptions,
  fitFromOptions,
  tooltipMode,
  viewFromOptions,
} from './options';
import { MapLegend } from './MapLegend';
import { INSPECT_EVENT, RENDERED_FEATURES_ATTRIBUTE } from './testHook';
import { useFeatureTooltip } from './useFeatureTooltip';
import { useOnScreen } from './useOnScreen';
import { MapViewEvent, MapViewRequestEvent } from './viewEvents';

interface Props extends PanelProps<GeoFlowOptions> {}

/**
 * A panel this close to the viewport counts as on screen, so its map is ready as it scrolls in.
 * Further away, the map is destroyed straight away: with any delay, fast scrolling keeps maps alive
 * behind the viewport while new ones start ahead of it, and the page runs out of WebGL contexts.
 */
const ON_SCREEN_MARGIN = '200px';

/** Narrower panels have no room for a legend beside the map's controls. */
const LEGEND_MIN_WIDTH = 200;

const getStyles = (theme: GrafanaTheme2) => ({
  // MapLibre's controls are styled for a light page; these overrides, scoped to the panel, match
  // them to the Grafana theme.
  wrapper: css`
    position: relative;
    overflow: hidden;
    font-size: ${theme.typography.bodySmall.fontSize};

    .maplibregl-ctrl-group,
    .maplibregl-ctrl-attrib.maplibregl-compact {
      background: ${theme.colors.background.primary};
      box-shadow: ${theme.shadows.z1};
    }
    .maplibregl-ctrl-group button + button {
      border-top-color: ${theme.colors.border.weak};
    }
    .maplibregl-ctrl-group button:not(:disabled):hover {
      background: ${theme.colors.action.hover};
    }
    .maplibregl-ctrl-attrib,
    .maplibregl-ctrl-attrib a {
      color: ${theme.colors.text.secondary};
    }
    .maplibregl-ctrl-icon,
    .maplibregl-ctrl-attrib-button {
      filter: ${theme.isDark ? 'invert(1)' : 'none'};
    }

    /* The tooltip renders Grafana's own tooltip box; MapLibre's popup frame and tip are dropped. */
    .geoflow-tooltip {
      z-index: 3;
    }
    .geoflow-tooltip .maplibregl-popup-content {
      padding: 0;
      background: none;
      box-shadow: none;
      border-radius: 0;
    }
    .geoflow-tooltip .maplibregl-popup-tip {
      display: none;
    }
  `,
  // Sized, not positioned: MapLibre's lazily injected CSS sets .maplibregl-map to position: relative,
  // and it lands after these styles.
  map: css`
    width: 100%;
    height: 100%;
  `,
  overlay: css`
    position: absolute;
    top: ${theme.spacing(1)};
    left: ${theme.spacing(1)};
    max-width: calc(100% - ${theme.spacing(8)});
    max-height: calc(100% - ${theme.spacing(2)});
    overflow: auto;
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z1};
  `,
  notices: css`
    position: absolute;
    left: ${theme.spacing(1)};
    bottom: ${theme.spacing(1)};
    max-width: calc(100% - ${theme.spacing(2)});
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: ${theme.spacing(0.5)};
  `,
  notice: css`
    max-width: 100%;
    padding: ${theme.spacing(0.5, 1)};
    color: ${theme.colors.warning.text};
    background: ${theme.colors.background.primary};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z1};
  `,
  paused: css`
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    align-items: center;
    justify-content: center;
    padding: ${theme.spacing(2)};
    text-align: center;
    color: ${theme.colors.text.secondary};
    background: ${theme.colors.background.primary};
  `,
  message: css`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: ${theme.spacing(2)};
    text-align: center;
    color: ${theme.colors.text.secondary};
  `,
  frame: css`
    & + & {
      margin-top: ${theme.spacing(1)};
    }
  `,
  secondary: css`
    color: ${theme.colors.text.secondary};
  `,
  fields: css`
    color: ${theme.colors.text.secondary};
    font-family: ${theme.typography.fontFamilyMonospace};
  `,
});

/**
 * GeoFlow panel: query results drawn on an interactive basemap (docs/phase_2.md, Design §5, and
 * docs/phase_3.md, Design §5). The map is created when the panel comes on screen, updated in
 * place as data, options, theme and size change, and destroyed when the panel goes off screen or
 * unmounts.
 */
export const MapPanel = ({ data, options, width, height, eventBus }: Props) => {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(wrapperRef, ON_SCREEN_MARGIN);
  const [engine, setEngine] = useState<MapEngine>();
  const [failure, setFailure] = useState<string>();
  const [paused, setPaused] = useState(false);
  // Remembers the basemap it came from, so it disappears once the user picks another basemap.
  const [basemapError, setBasemapError] = useState<{ basemap: BasemapSpec; message: string }>();
  // Remembers the layers it came from, so it disappears when new data arrives.
  const [layerError, setLayerError] = useState<{ layers: LayerSpec[]; layerId: string; message: string }>();

  // A dark theme URL replaces the light one while Grafana's theme is dark (docs/phase_8.md). The
  // same basemap keeps its identity, so a theme switch without a dark URL doesn't count as a
  // basemap change, which would close a pinned tooltip.
  const basemapKey = JSON.stringify(basemapFromOptions(options.basemap, theme.isDark));
  const basemap = useMemo<BasemapSpec>(() => JSON.parse(basemapKey), [basemapKey]);
  const engineTheme = useMemo(
    () => ({ dark: theme.isDark, background: theme.colors.background.primary }),
    [theme.isDark, theme.colors.background.primary]
  );
  const { mode: viewMode, lat, lon, zoom, padding, maxZoom, fitOnRefresh } = options.view ?? {};
  const view = useMemo(() => viewFromOptions({ lat, lon, zoom }), [lat, lon, zoom]);
  const fit = useMemo(
    () => fitFromOptions({ mode: viewMode, padding, maxZoom, fitOnRefresh }),
    [viewMode, padding, maxZoom, fitOnRefresh]
  );

  const bound = useMemo(
    () => bindLayers(data.series, options.layers, options.layerBinding),
    [data.series, options.layers, options.layerBinding]
  );
  // Each layer's last conversion, so a refresh with the same data reuses it (docs/phase_8.md).
  const [history] = useState<ConversionHistory>(() => new Map());
  const results = useMemo(() => convertFrames(data.series, bound, history), [data.series, bound, history]);
  const mode = tooltipMode(options);
  const interactive = mode !== 'off';
  const layers = useMemo(
    () => buildLayerSpecs(bound, results, data.series, theme, { interactive }),
    [bound, results, data.series, theme, interactive]
  );
  const showLegend = options.legend?.show !== false && width >= LEGEND_MIN_WIDTH;
  const legend = useMemo(
    () => (showLegend ? legendEntries(layers, results, data.series, theme) : []),
    [showLegend, layers, results, data.series, theme]
  );
  const dataBounds = useMemo(() => drawnBounds(layers, results), [layers, results]);
  const requestId = data.request?.requestId;
  // While a query runs, the data may still be the previous response's.
  const loading = data.state === LoadingState.Loading;
  // Data arrived, but no frame has a geometry column: say why instead of showing an empty map.
  const noGeometry = layers.length === 0 ? results.find((result) => result.noGeometry)?.noGeometry : undefined;

  // Where the map is looking: the configured view until the user moves it or the map fits the
  // data. A map that is released off screen and created again picks up from here.
  const currentView = useRef(view);
  // The fixed view last applied; undefined in Fit to data.
  const appliedView = useRef(fit ? undefined : view);
  // The last fit (docs/phase_8.md, Design §3): fit settings that change, and in Fit on refresh, a
  // new query response, fit again. Nothing else does, scrolling back on screen included.
  const lastFit = useRef<LastFit>({});
  // The engine loads asynchronously; it mounts with whatever the options and data are by then.
  const latest = useRef({ basemap, theme: engineTheme, layers, fit, dataBounds, requestId, loading, eventBus });
  useEffect(() => {
    latest.current = { basemap, theme: engineTheme, layers, fit, dataBounds, requestId, loading, eventBus };
  });

  // Use current view in the options pane asks for the view when it opens (docs/phase_8.md, Design §4).
  useEffect(() => {
    const subscription = eventBus?.subscribe(MapViewRequestEvent, () =>
      eventBus.publish(new MapViewEvent(currentView.current))
    );
    return () => subscription?.unsubscribe();
  }, [eventBus]);

  // A map holds a WebGL context, and browsers cap them per page (16 in Chromium), so the map
  // exists only while the panel is on or near the screen.
  const wanted = onScreen && !paused && !failure;
  useEffect(() => {
    if (!wanted) {
      return;
    }
    let created: MapEngine | undefined;
    let cancelled = false;
    createMapEngine()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        created = loaded;
        loaded.on('error', (error) =>
          error.layerId !== undefined
            ? setLayerError({ layers: latest.current.layers, layerId: error.layerId, message: error.message })
            : setBasemapError({ basemap: latest.current.basemap, message: error.message })
        );
        loaded.on('viewChange', (next) => {
          currentView.current = next;
          latest.current.eventBus?.publish(new MapViewEvent(next));
        });
        loaded.on('contextLost', () => setPaused(true));
        const { basemap, theme, layers, fit, dataBounds, requestId, loading } = latest.current;
        const options: EngineOptions = { basemap, theme, layers, view: currentView.current };
        if (fitDue(lastFit.current, fit, dataBounds, requestId, loading)) {
          options.fit = { bounds: dataBounds!, padding: fit!.padding, maxZoom: fit!.maxZoom };
          lastFit.current = fitDone(fit!, requestId);
        }
        return loaded.mount(containerRef.current!, options).then(() => {
          if (!cancelled) {
            setEngine(loaded);
          }
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailure(mapFailureMessage(error));
        }
      });
    return () => {
      cancelled = true;
      created?.destroy();
      setEngine(undefined);
    };
  }, [wanted]);

  useEffect(() => engine?.setBasemap(basemap), [engine, basemap]);
  useEffect(() => engine?.setTheme(engineTheme), [engine, engineTheme]);
  useEffect(() => engine?.setLayers(layers), [engine, layers]);
  useEffect(() => {
    // Only a change to the fixed view, or switching to Fixed, moves the map; a recreated map keeps
    // the user's view. In Fit to data, the fixed view is only the fallback until there is data.
    const fixed = fit ? undefined : view;
    if (fixed && fixed !== appliedView.current) {
      currentView.current = fixed;
      engine?.setView(fixed);
    }
    appliedView.current = fixed;
  }, [engine, view, fit]);
  useEffect(() => {
    if (!fit) {
      // Switching back to Fit to data fits again.
      lastFit.current = {};
    } else if (engine && fitDue(lastFit.current, fit, dataBounds, requestId, loading)) {
      engine.fitBounds(dataBounds!, { padding: fit.padding, maxZoom: fit.maxZoom });
      lastFit.current = fitDone(fit, requestId);
    }
  }, [engine, fit, dataBounds, requestId, loading]);
  useEffect(() => engine?.resize(), [engine, width, height]);

  const tooltip = useFeatureTooltip({
    engine,
    mode,
    results,
    frames: data.series,
    layers,
    basemap,
  });

  // Test hook: e2e tests send INSPECT_EVENT to read the drawn-feature counts; see testHook.ts.
  useEffect(() => {
    const container = containerRef.current;
    if (!engine || !container) {
      return;
    }
    let active = true;
    const inspect = () => {
      container.removeAttribute(RENDERED_FEATURES_ATTRIBUTE);
      engine.renderedFeatureCounts().then((counts) => {
        if (active) {
          container.setAttribute(RENDERED_FEATURES_ATTRIBUTE, JSON.stringify(counts));
        }
      });
    };
    container.addEventListener(INSPECT_EVENT, inspect);
    return () => {
      active = false;
      container.removeEventListener(INSPECT_EVENT, inspect);
    };
  }, [engine]);

  return (
    <div ref={wrapperRef} className={styles.wrapper} style={{ width, height }} data-testid="geoflow-panel">
      {failure ? (
        <div className={styles.message} data-testid="geoflow-map-error">
          {failure}
        </div>
      ) : (
        <div ref={containerRef} className={styles.map} data-testid="geoflow-map" />
      )}
      {tooltip}
      {paused && (
        <div className={styles.paused} data-testid="geoflow-map-paused">
          <div>The map was paused because this browser tab has too many maps open.</div>
          <Button size="sm" variant="secondary" onClick={() => setPaused(false)}>
            Reload map
          </Button>
        </div>
      )}
      <div className={styles.notices}>
        <MapLegend entries={legend} maxHeight={height / 2} />
        {noGeometry && (
          <div className={styles.notice} data-testid="geoflow-no-geometry">
            {noGeometry.detail}
          </div>
        )}
        {layerError?.layers === layers && engine && (
          <div className={styles.notice} data-testid="geoflow-layer-error" title={layerError.message}>
            Query {layerError.layerId}: {layerError.message}
          </div>
        )}
        {basemapError?.basemap === basemap && engine && (
          <div className={styles.notice} data-testid="geoflow-basemap-error" title={basemapError.message}>
            Basemap: {basemapError.message}
          </div>
        )}
      </div>
      {options.showSummary && results.length > 0 && (
        <div className={styles.overlay} data-testid="geoflow-summary">
          {results.map((result, i) => {
            const warning = firstWarning(result);
            const layer = bound.find(({ frameIndex }) => frameIndex === i);
            const styleProblems = [
              ...layerProblems(layer, data.series[i]),
              ...(result.noGeometry ? [] : dataStyleFields(data.series[i], result).problems),
            ];
            const named = layer && (layer.name !== `Query ${result.layerId}` || !layer.visible);
            return (
              <div key={result.layerId} className={styles.frame} data-testid={`geoflow-frame-${result.layerId}`}>
                <div data-testid={`geoflow-summary-${result.layerId}`}>{conversionSummary(result)}</div>
                {named && (
                  <div className={styles.secondary} data-testid={`geoflow-summary-layer-${result.layerId}`}>
                    {layer.name}
                    {!layer.visible && ' · hidden'}
                  </div>
                )}
                {warning && <div className={styles.secondary}>{warning}</div>}
                {styleProblems.map((problem) => (
                  <div key={problem} className={styles.secondary}>
                    {problem}
                  </div>
                ))}
                <div className={styles.fields}>
                  {data.series[i].fields.map((field) => `${field.name} (${field.type})`).join(', ')}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface LastFit {
  /** The fit settings it used, as fitKey gives them. */
  settings?: string;
  requestId?: string;
}

function fitKey({ padding, maxZoom, onRefresh }: FitSettings): string {
  return `${padding},${maxZoom},${onRefresh}`;
}

/**
 * Whether the map should fit the data now: on the first data with geometry, when the fit settings
 * change, and in Fit on refresh, on each new query response once it has arrived.
 */
function fitDue(
  last: LastFit,
  fit: FitSettings | undefined,
  bounds: Bounds | undefined,
  requestId: string | undefined,
  loading: boolean
): boolean {
  if (!fit || !bounds || loading) {
    return false;
  }
  return last.settings !== fitKey(fit) || (fit.onRefresh && last.requestId !== requestId);
}

function fitDone(fit: FitSettings, requestId: string | undefined): LastFit {
  return { settings: fitKey(fit), requestId };
}

/** The box around the features of the visible layers, which are the ones a fit frames. */
function drawnBounds(layers: LayerSpec[], results: ConversionResult[]): Bounds | undefined {
  const drawn = new Set(layers.filter((layer) => layer.visible).map(({ id }) => id));
  return results.reduce<Bounds | undefined>(
    (bounds, result) => (drawn.has(result.layerId) ? unionBounds(bounds, result.bounds) : bounds),
    undefined
  );
}

/** What's wrong with a layer's settings for its frame, as data summary lines. */
function layerProblems(layer: BoundLayer | undefined, frame: DataFrame): string[] {
  const missing = layer?.idField && !frame.fields.some(({ name }) => name === layer.idField);
  return missing ? [`ID column: no column named ${layer.idField}`] : [];
}

function mapFailureMessage(error: unknown): string {
  if (error instanceof WebGLUnavailableError) {
    return error.message;
  }
  return `The map couldn't load: ${error instanceof Error ? error.message : String(error)}`;
}
