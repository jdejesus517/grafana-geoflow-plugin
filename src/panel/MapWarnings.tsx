import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, Tooltip, useStyles2 } from '@grafana/ui';
import { PanelProblem } from './panelProblems';

const getStyles = (theme: GrafanaTheme2) => ({
  button: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    padding: ${theme.spacing(0.25, 0.75)};
    color: ${theme.colors.warning.text};
    background: ${theme.colors.background.primary};
    border: none;
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z1};
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    margin: 0;
    padding: 0;
    list-style: none;
  `,
  detail: css`
    color: ${theme.colors.text.secondary};
  `,
});

interface Props {
  problems: PanelProblem[];
}

/**
 * A small warning on the map (docs/phase_9.md, Design §1), with what's wrong on hover or focus.
 * Grafana's own header notices come from the data source, so a panel can't add to them.
 */
export const MapWarnings = ({ problems }: Props) => {
  const styles = useStyles2(getStyles);
  if (problems.length === 0) {
    return null;
  }
  const details = (
    <ul className={styles.list} data-testid="geoflow-warnings-details">
      {problems.map(({ layerName, text, detail }) => (
        <li key={`${layerName}\n${text}`}>
          {layerName ? `${layerName}: ${text}` : text}
          {detail && <div className={styles.detail}>{detail}</div>}
        </li>
      ))}
    </ul>
  );
  return (
    <Tooltip content={details} placement="top-start">
      <button
        type="button"
        className={styles.button}
        aria-label={`${problems.length} ${problems.length === 1 ? 'warning' : 'warnings'}`}
        data-testid="geoflow-warnings"
      >
        <Icon name="exclamation-triangle" />
        {problems.length}
      </button>
    </Tooltip>
  );
};
