import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, StandardEditorProps } from '@grafana/data';
import { Button, Stack, useStyles2 } from '@grafana/ui';
import { ViewState } from '../engine';
import { GeoFlowOptions } from './options';
import { MapViewEvent, MapViewRequestEvent } from './viewEvents';

const getStyles = (theme: GrafanaTheme2) => ({
  view: css`
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
  `,
});

/**
 * Use current view (docs/phase_8.md, Design §4): shows the map's view as it moves, and saves it as
 * the fixed view, switching the mode to Fixed so the map stays there. The panel publishes its view
 * on the eventBus it shares with its option editors.
 */
export const ViewEditor = ({
  value,
  onChange,
  context,
}: StandardEditorProps<GeoFlowOptions['view'] | undefined, unknown, GeoFlowOptions>) => {
  const styles = useStyles2(getStyles);
  const [current, setCurrent] = useState<ViewState>();
  const eventBus = context.eventBus;

  useEffect(() => {
    const subscription = eventBus?.subscribe(MapViewEvent, (event) => setCurrent(event.payload));
    eventBus?.publish(new MapViewRequestEvent());
    return () => subscription?.unsubscribe();
  }, [eventBus]);

  if (!current) {
    return <div className={styles.view}>The map&apos;s view shows here once it has loaded.</div>;
  }
  const saved = savedView(current);
  return (
    <Stack direction="column" gap={1} alignItems="flex-start">
      <div className={styles.view} data-testid="geoflow-current-view">
        {saved.lat.toFixed(5)}, {saved.lon.toFixed(5)} · zoom {saved.zoom.toFixed(1)}
      </div>
      <Button
        size="sm"
        variant="secondary"
        icon="crosshair"
        onClick={() => onChange({ ...value!, ...saved, mode: 'fixed' })}
      >
        Use current view
      </Button>
    </Stack>
  );
};

/** The view as saved: about a metre of precision, and a tenth of a zoom level. */
function savedView({ center: [lon, lat], zoom }: ViewState): Pick<GeoFlowOptions['view'], 'lat' | 'lon' | 'zoom'> {
  return { lat: round(lat, 5), lon: round(lon, 5), zoom: round(zoom, 1) };
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
