import React from 'react';
import { css } from '@emotion/css';
import { DataFrame, GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { BoundLayer, ConversionResult } from '../adapter';
import { conversionSummary, firstWarning } from './conversionSummary';
import { layerSettingProblems, networkProblems } from './panelProblems';

interface Props {
  /** Conversion results, in the same order as `frames`. */
  results: ConversionResult[];
  /** The layers from bindLayers, for each frame's layer name and settings. */
  layers: BoundLayer[];
  frames: DataFrame[];
  /** Whether the browser draws the map without a GPU (MapEngine.softwareRendering). */
  softwareRendering: boolean;
}

const getStyles = (theme: GrafanaTheme2) => ({
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
 * The Show data summary overlay (docs/phase_2.md, Design §5): one block per query
 * result with what GeoFlow made of it, for checking a query while building a dashboard. Unlike
 * the warning on the map (MapWarnings), it lists everything, problems or not.
 */
export const DataSummary = ({ results, layers, frames, softwareRendering }: Props) => {
  const styles = useStyles2(getStyles);
  if (results.length === 0) {
    return null;
  }
  const network = networkProblems(layers, frames, results);
  return (
    <div className={styles.overlay} data-testid="geoflow-summary">
      {results.map((result, i) => {
        const warning = firstWarning(result);
        const layer = layers.find(({ frameIndex }) => frameIndex === i);
        const settingProblems = [
          ...layerSettingProblems(layer, frames[i], result),
          ...network.filter(({ layerId }) => layerId === result.layerId).map(({ text }) => text),
        ];
        // The layer line only says something when the name or visibility isn't the default.
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
            {result.reordered && (
              <div className={styles.secondary}>
                Rows came back in another order: add ORDER BY, so a refresh with the same data costs nothing.
              </div>
            )}
            {settingProblems.map((problem) => (
              <div key={problem} className={styles.secondary}>
                {problem}
              </div>
            ))}
            <div className={styles.fields}>
              {frames[i].fields.map((field) => `${field.name} (${field.type})`).join(', ')}
            </div>
          </div>
        );
      })}
      {softwareRendering && (
        <div className={styles.frame} data-testid="geoflow-summary-software">
          This browser draws the map without a GPU, so large maps will be slow.
        </div>
      )}
    </div>
  );
};
