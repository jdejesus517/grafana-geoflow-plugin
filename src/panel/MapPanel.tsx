import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, PanelProps } from '@grafana/data';
import { PanelDataErrorView } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { GeoFlowOptions } from './options';

interface Props extends PanelProps<GeoFlowOptions> {}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    overflow: auto;
    padding: ${theme.spacing(1)};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  frame: css`
    margin-top: ${theme.spacing(1)};
  `,
  fields: css`
    color: ${theme.colors.text.secondary};
    font-family: ${theme.typography.fontFamilyMonospace};
  `,
});

/**
 * Placeholder panel for Phase 0: lists the data frames the panel receives so the
 * PostGIS → data source → panel path can be verified before map rendering exists.
 */
export const MapPanel = ({ data, width, height, fieldConfig, id }: Props) => {
  const styles = useStyles2(getStyles);

  if (data.series.length === 0) {
    return <PanelDataErrorView fieldConfig={fieldConfig} panelId={id} data={data} />;
  }

  return (
    <div className={styles.wrapper} style={{ width, height }} data-testid="geoflow-placeholder">
      <strong>GeoFlow</strong>
      {data.series.map((frame, i) => {
        const refId = frame.refId ?? `#${i}`;
        return (
          <div key={refId} className={styles.frame} data-testid={`geoflow-frame-${refId}`}>
            <div>
              {refId}: {frame.length} rows
            </div>
            <div className={styles.fields}>
              {frame.fields.map((field) => `${field.name} (${field.type})`).join(', ')}
            </div>
          </div>
        );
      })}
    </div>
  );
};
