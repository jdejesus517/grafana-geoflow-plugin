import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { Button, useStyles2, useTheme2 } from '@grafana/ui';
import { framesToFeatureCollections } from '../adapter';
import { BasemapSpec, MapEngine, WebGLUnavailableError, createMapEngine } from '../engine';
import { conversionSummary, firstWarning } from './conversionSummary';
import { GeoFlowOptions, basemapFromOptions, viewFromOptions } from './options';
import { useOnScreen } from './useOnScreen';

interface Props extends PanelProps<GeoFlowOptions> {}

/**
 * A panel this close to the viewport counts as on screen, so its map is ready as it scrolls in.
 * Further away, the map is destroyed straight away: with any delay, fast scrolling keeps maps alive
 * behind the viewport while new ones start ahead of it, and the page runs out of WebGL contexts.
 */
const ON_SCREEN_MARGIN = '200px';

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
  notice: css`
    position: absolute;
    left: ${theme.spacing(1)};
    bottom: ${theme.spacing(1)};
    max-width: calc(100% - ${theme.spacing(2)});
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
 * GeoFlow panel: an interactive basemap (docs/phase_2.md, Design §5). The map is created when the
 * panel comes on screen, updated in place as options, theme and size change, and destroyed when
 * the panel goes off screen or unmounts.
 */
export const MapPanel = ({ data, options, width, height }: Props) => {
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

  const basemap = useMemo(() => basemapFromOptions(options.basemap), [options.basemap]);
  const engineTheme = useMemo(
    () => ({ dark: theme.isDark, background: theme.colors.background.primary }),
    [theme.isDark, theme.colors.background.primary]
  );
  const { lat, lon, zoom } = options.view ?? {};
  const view = useMemo(() => viewFromOptions({ lat, lon, zoom }), [lat, lon, zoom]);

  // Where the map is looking: the configured view until the user moves it. A map that is
  // released off screen and created again picks up from here.
  const currentView = useRef(view);
  const appliedView = useRef(view);
  // The engine loads asynchronously; it mounts with whatever the options are by then.
  const latest = useRef({ basemap, theme: engineTheme });
  useEffect(() => {
    latest.current = { basemap, theme: engineTheme };
  });

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
        loaded.on('error', (error) => setBasemapError({ basemap: latest.current.basemap, message: error.message }));
        loaded.on('viewChange', (next) => (currentView.current = next));
        loaded.on('contextLost', () => setPaused(true));
        return loaded.mount(containerRef.current!, { ...latest.current, view: currentView.current }).then(() => {
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
  useEffect(() => {
    // Only a change to the configured view moves the map; a recreated map keeps the user's view.
    if (view !== appliedView.current) {
      appliedView.current = view;
      currentView.current = view;
      engine?.setView(view);
    }
  }, [engine, view]);
  useEffect(() => engine?.resize(), [engine, width, height]);

  const results = useMemo(
    () =>
      options.showSummary
        ? framesToFeatureCollections(data.series.map((frame, i) => ({ ...frame, refId: frame.refId ?? `#${i}` })))
        : [],
    [data.series, options.showSummary]
  );

  return (
    <div ref={wrapperRef} className={styles.wrapper} style={{ width, height }} data-testid="geoflow-panel">
      {failure ? (
        <div className={styles.message} data-testid="geoflow-map-error">
          {failure}
        </div>
      ) : (
        <div ref={containerRef} className={styles.map} data-testid="geoflow-map" />
      )}
      {paused && (
        <div className={styles.paused} data-testid="geoflow-map-paused">
          <div>The map was paused because this browser tab has too many maps open.</div>
          <Button size="sm" variant="secondary" onClick={() => setPaused(false)}>
            Reload map
          </Button>
        </div>
      )}
      {basemapError?.basemap === basemap && engine && (
        <div className={styles.notice} data-testid="geoflow-basemap-error" title={basemapError.message}>
          Basemap: {basemapError.message}
        </div>
      )}
      {results.length > 0 && (
        <div className={styles.overlay} data-testid="geoflow-summary">
          {results.map((result, i) => {
            const warning = firstWarning(result);
            return (
              <div key={result.refId} className={styles.frame} data-testid={`geoflow-frame-${result.refId}`}>
                <div data-testid={`geoflow-summary-${result.refId}`}>{conversionSummary(result)}</div>
                {warning && <div className={styles.secondary}>{warning}</div>}
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

function mapFailureMessage(error: unknown): string {
  if (error instanceof WebGLUnavailableError) {
    return error.message;
  }
  return `The map couldn't load: ${error instanceof Error ? error.message : String(error)}`;
}
