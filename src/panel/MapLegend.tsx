import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { VizLegend, VizLegendItem, useStyles2 } from '@grafana/ui';
import { LegendEntry } from '../adapter';

interface Props {
  entries: LegendEntry[];
  /** The legend scrolls past this height, px. */
  maxHeight: number;
}

const getStyles = (theme: GrafanaTheme2) => ({
  legend: css`
    max-width: 100%;
    overflow: auto;
    padding: ${theme.spacing(0.5, 1)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z1};
  `,
  entry: css`
    & + & {
      margin-top: ${theme.spacing(0.5)};
    }
  `,
  title: css`
    color: ${theme.colors.text.secondary};
  `,
  gradient: css`
    display: grid;
    grid-template-columns: auto minmax(60px, 120px) auto;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    padding: ${theme.spacing(0.25, 0)};
  `,
  bar: css`
    height: 8px;
    border-radius: ${theme.shape.radius.default};
  `,
});

/**
 * The colors of layers colored by a column, over the map (docs/phase_6.md, Design §4): one entry
 * per layer, titled with the query and the column. Mappings and thresholds are Grafana's own
 * legend items; a by-value scheme is a bar from Min to Max.
 */
export function MapLegend({ entries, maxHeight }: Props) {
  const styles = useStyles2(getStyles);
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className={styles.legend} style={{ maxHeight }} data-testid="geoflow-legend">
      {entries.map((entry) => (
        <div key={entry.layerId} className={styles.entry} data-testid={`geoflow-legend-${entry.layerId}`}>
          <div className={styles.title}>
            {entry.title} · {entry.column}
          </div>
          {entry.items.length > 0 && (
            <VizLegend
              // List display is the default. @grafana/schema isn't provided by Grafana: importing
              // LegendDisplayMode would bundle it.
              placement="right"
              items={entry.items.map((item, i): VizLegendItem => ({
                ...item,
                yAxis: 1,
                getItemKey: () => `${entry.layerId}:${i}`,
              }))}
              readonly
            />
          )}
          {entry.gradient && (
            <div className={styles.gradient} data-testid="geoflow-legend-gradient">
              <span>{entry.gradient.min}</span>
              <div
                className={styles.bar}
                style={{ background: `linear-gradient(to right, ${entry.gradient.colors.join(', ')})` }}
              />
              <span>{entry.gradient.max}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
