import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { framesToFeatureCollections } from '../adapter';
import { BasemapSpec, EngineOptions, MapEngine, WebGLUnavailableError, createMapEngine } from '../engine';
import { conversionSummary, firstWarning } from './conversionSummary';
import { GeoFlowOptions, basemapFromOptions, viewFromOptions } from './options';

interface Props extends PanelProps<GeoFlowOptions> {}

type MapStatus = { state: 'loading' | 'ready' } | { state: 'failed'; message: string };

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
 * GeoFlow panel: an interactive basemap (docs/phase_2.md, Design §5). The map is created once,
 * updated in place as options, theme and size change, and destroyed on unmount.
 */
export const MapPanel = ({ data, options, width, height }: Props) => {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MapEngine | undefined>(undefined);
  const [status, setStatus] = useState<MapStatus>({ state: 'loading' });
  // Remembers the basemap it came from, so it disappears once the user picks another basemap.
  const [basemapError, setBasemapError] = useState<{ basemap: BasemapSpec; message: string }>();

  const basemap = useMemo(() => basemapFromOptions(options.basemap), [options.basemap]);
  const engineTheme = useMemo(
    () => ({ dark: theme.isDark, background: theme.colors.background.primary }),
    [theme.isDark, theme.colors.background.primary]
  );
  const { lat, lon, zoom } = options.view ?? {};
  const view = useMemo(() => viewFromOptions({ lat, lon, zoom }), [lat, lon, zoom]);

  // The engine loads asynchronously; it mounts with whatever the options are by then.
  const latest = useRef<EngineOptions>({ basemap, theme: engineTheme, view });
  useEffect(() => {
    latest.current = { basemap, theme: engineTheme, view };
  });

  useEffect(() => {
    let engine: MapEngine | undefined;
    let cancelled = false;
    createMapEngine()
      .then((created) => {
        if (cancelled) {
          return;
        }
        engine = created;
        engine.on('error', (error) => setBasemapError({ basemap: latest.current.basemap, message: error.message }));
        return engine.mount(containerRef.current!, latest.current).then(() => {
          if (!cancelled) {
            engineRef.current = engine;
            setStatus({ state: 'ready' });
          }
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus({ state: 'failed', message: mapFailureMessage(error) });
        }
      });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = undefined;
    };
  }, []);

  const ready = status.state === 'ready';
  useEffect(() => engineRef.current?.setBasemap(basemap), [basemap, ready]);
  useEffect(() => engineRef.current?.setTheme(engineTheme), [engineTheme, ready]);
  useEffect(() => engineRef.current?.setView(view), [view, ready]);
  useEffect(() => engineRef.current?.resize(), [width, height, ready]);

  const results = useMemo(
    () =>
      options.showSummary
        ? framesToFeatureCollections(data.series.map((frame, i) => ({ ...frame, refId: frame.refId ?? `#${i}` })))
        : [],
    [data.series, options.showSummary]
  );

  return (
    <div className={styles.wrapper} style={{ width, height }} data-testid="geoflow-panel">
      {status.state === 'failed' ? (
        <div className={styles.message} data-testid="geoflow-map-error">
          {status.message}
        </div>
      ) : (
        <div ref={containerRef} className={styles.map} data-testid="geoflow-map" />
      )}
      {basemapError?.basemap === basemap && status.state === 'ready' && (
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
