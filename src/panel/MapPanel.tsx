import React, { useMemo } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { PanelDataErrorView } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { framesToFeatureCollections } from '../adapter';
import { conversionSummary, firstWarning } from './conversionSummary';
import { GeoFlowOptions } from './options';
import { SpikeMap } from './SpikeMap';

interface Props extends PanelProps<GeoFlowOptions> {}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    position: relative;
    overflow: auto;
    padding: ${theme.spacing(1)};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  overlay: css`
    position: relative;
    z-index: 1;
    display: inline-block;
    background: ${theme.colors.background.primary};
  `,
  frame: css`
    margin-top: ${theme.spacing(1)};
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
 * Placeholder panel until map rendering exists: lists each data frame the panel receives and
 * what the adapter made of it, so the PostGIS → data source → adapter path can be checked.
 */
export const MapPanel = ({ data, width, height, fieldConfig, id }: Props) => {
  const styles = useStyles2(getStyles);
  const results = useMemo(
    () => framesToFeatureCollections(data.series.map((frame, i) => ({ ...frame, refId: frame.refId ?? `#${i}` }))),
    [data.series]
  );

  if (data.series.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} />;
  }

  return (
    <div className={styles.wrapper} style={{ width, height }} data-testid="geoflow-placeholder">
      <SpikeMap />
      <div className={styles.overlay}>
        <strong>GeoFlow</strong>
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
    </div>
  );
};
