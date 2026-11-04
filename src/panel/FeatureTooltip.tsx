import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import {
  IconButton,
  VizTooltipColorIndicator,
  VizTooltipContent,
  VizTooltipFooter,
  VizTooltipHeader,
  VizTooltipWrapper,
  useStyles2,
} from '@grafana/ui';
import { FeatureDetails } from '../adapter';
import { FeatureRef } from '../engine';

/** A feature ready to show: where it's from and what to list. */
export interface TooltipFeature extends FeatureRef {
  /** The query it came from: the frame's name, or "Query A". */
  title: string;
  /** Its layer's color, shown next to the title. */
  color: string;
  details: FeatureDetails;
}

interface Props {
  /** Every feature under the pointer or click, topmost first. */
  features: TooltipFeature[];
  /** The one shown. */
  index: number;
  /** Pinned by a click: adds the pager, the close button and data links. */
  pinned: boolean;
  /** The room it has on the map; the field list scrolls when the tooltip would be taller. */
  maxWidth: number;
  maxHeight: number;
  onIndexChange?: (index: number) => void;
  onClose?: () => void;
}

/** Narrower tooltips wrap most values; used unless the map has less room than this. */
const MIN_WIDTH = 180;

// The look of Grafana's own tooltip container (getTooltipContainerStyles in @grafana/ui), which
// isn't exported to plugins. The header and footer keep their height, and the field list between
// them shrinks and scrolls to keep the whole tooltip within its maximum height.
const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: theme.colors.background.elevated,
    boxShadow: theme.shadows.z2,
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.lg,
    color: theme.colors.text.primary,
  }),
  wrapper: css({
    minHeight: 0,
    '& > *': { flexShrink: 0 },
  }),
  body: css({
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 1,
    minHeight: 0,
    '& > *': { minHeight: 0 },
  }),
  top: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(0.5),
    '& > :first-child': { flex: 1, minWidth: 0 },
  }),
  pager: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  more: css({
    color: theme.colors.text.secondary,
    paddingTop: theme.spacing(0.5),
  }),
});

/**
 * A feature's tooltip, built from Grafana's own tooltip components so it looks like every other
 * Grafana tooltip (docs/phase_4.md, Design §5). Hover shows the topmost feature and how many
 * more are under the pointer; a pinned tooltip pages through them.
 */
export const FeatureTooltip = ({ features, index, pinned, maxWidth, maxHeight, onIndexChange, onClose }: Props) => {
  const styles = useStyles2(getStyles);
  const feature = features[index];
  if (!feature) {
    return null;
  }
  const count = features.length;
  const others = count - 1;

  return (
    <div
      className={styles.container}
      style={{ maxWidth, maxHeight, minWidth: Math.min(MIN_WIDTH, maxWidth) }}
      data-testid="geoflow-tooltip"
    >
      <VizTooltipWrapper className={styles.wrapper}>
        <div className={styles.top}>
          <VizTooltipHeader
            item={{
              label: feature.title,
              value: '',
              color: feature.color,
              colorIndicator: VizTooltipColorIndicator.marker_md,
            }}
            isPinned={pinned}
          />
          {pinned && count > 1 && (
            <div className={styles.pager} data-testid="geoflow-tooltip-pager">
              <IconButton
                name="angle-left"
                size="sm"
                aria-label="Previous feature"
                disabled={index === 0}
                onClick={() => onIndexChange?.(index - 1)}
              />
              {index + 1} of {count}
              <IconButton
                name="angle-right"
                size="sm"
                aria-label="Next feature"
                disabled={index === count - 1}
                onClick={() => onIndexChange?.(index + 1)}
              />
            </div>
          )}
          {pinned && <IconButton name="times" size="sm" aria-label="Close" onClick={onClose} />}
        </div>
        <div className={styles.body}>
          <VizTooltipContent items={feature.details.items} isPinned={pinned} scrollable>
            {!pinned && others > 0 && (
              <div className={styles.more} data-testid="geoflow-tooltip-more">
                +{others} more
              </div>
            )}
          </VizTooltipContent>
        </div>
        {pinned && feature.details.links.length > 0 && <VizTooltipFooter dataLinks={feature.details.links} />}
      </VizTooltipWrapper>
    </div>
  );
};
