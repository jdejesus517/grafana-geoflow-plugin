// SPIKE (Phase 2 step 2.2): throwaway check that MapLibre 6 bundles and runs inside the
// plugin. Replaced by the engine in steps 2.3 to 2.6.
import React, { useEffect, useRef } from 'react';

export const SpikeMap = () => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current!;
    let map: { remove(): void } | undefined;
    let cancelled = false;
    const report = (key: string, value: string) => (container.dataset[key] = value);

    (async () => {
      const maplibre = await import('maplibre-gl');
      await import('maplibre-gl/dist/maplibre-gl.css');
      const workerUrl = new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href;
      maplibre.setWorkerUrl(workerUrl);
      report('workerUrl', workerUrl);
      report('webgl2', String(!!document.createElement('canvas').getContext('webgl2')));
      if (cancelled) {
        return;
      }
      const m = new maplibre.Map({
        container,
        center: [-78.7811, 35.7882],
        zoom: 15,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              maxzoom: 19,
              attribution: '© OpenStreetMap contributors',
            },
            // GeoJSON is parsed in the worker, so a rendered feature proves the worker loaded.
            spike: {
              type: 'geojson',
              data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-78.7811, 35.7882] } },
            },
          },
          layers: [
            { id: 'osm', type: 'raster', source: 'osm' },
            { id: 'spike', type: 'circle', source: 'spike', paint: { 'circle-radius': 8, 'circle-color': '#e02f44' } },
          ],
        },
      });
      m.addControl(new maplibre.NavigationControl());
      m.on('error', (e) => report('error', String(e.error?.message ?? e)));
      m.once('idle', () => {
        report('features', String(m.queryRenderedFeatures({ layers: ['spike'] }).length));
        report('idle', 'true');
      });
      map = m;
    })().catch((e) => report('error', String(e?.message ?? e)));

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, []);

  return <div ref={ref} data-testid="geoflow-spike" style={{ position: 'absolute', inset: 0 }} />;
};
