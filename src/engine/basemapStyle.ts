// Type-only import: erased at build time, so this module doesn't pull MapLibre into the eager chunk.
import type { StyleSpecification } from 'maplibre-gl';
import { BasemapSpec, EngineTheme } from './types';

/** Style layer and source IDs the engine owns. User layers (Phase 3) must not reuse them. */
export const BASEMAP_SOURCE_ID = 'geoflow-basemap';
export const BASEMAP_RASTER_LAYER_ID = 'geoflow-basemap-raster';
export const BACKGROUND_LAYER_ID = 'geoflow-background';

export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>';
const OSM_MAX_ZOOM = 19;

/**
 * Raster paint for the theme. Dark theme dims and desaturates the tiles so a bright basemap
 * doesn't glare in a dark dashboard. Light theme returns the MapLibre defaults explicitly, so
 * switching back with setPaintProperty resets every property.
 */
export function rasterPaint(theme: EngineTheme) {
  return theme.dark
    ? { 'raster-brightness-max': 0.75, 'raster-saturation': -0.4, 'raster-contrast': 0.1 }
    : { 'raster-brightness-max': 1, 'raster-saturation': 0, 'raster-contrast': 0 };
}

/**
 * The MapLibre style for a basemap. A `style` basemap is returned as its URL: the user's style
 * controls everything, and theme dimming doesn't apply.
 */
export function basemapStyle(spec: BasemapSpec, theme: EngineTheme): StyleSpecification | string {
  switch (spec.kind) {
    case 'osm':
      return rasterStyle([OSM_TILE_URL], OSM_ATTRIBUTION, OSM_MAX_ZOOM, theme);
    case 'raster':
      // MapLibre renders attribution as HTML. A custom attribution is typed by a dashboard
      // editor and shown to every viewer, so it is shown as plain text.
      return rasterStyle(spec.tiles, escapeHtml(spec.attribution), spec.maxZoom, theme);
    case 'style':
      return spec.url;
    case 'none':
      return { version: 8, sources: {}, layers: [backgroundLayer(theme)] };
  }
}

function rasterStyle(
  tiles: string[],
  attribution: string,
  maxZoom: number | undefined,
  theme: EngineTheme
): StyleSpecification {
  return {
    version: 8,
    sources: {
      [BASEMAP_SOURCE_ID]: {
        type: 'raster',
        tiles,
        tileSize: 256,
        ...(maxZoom !== undefined && { maxzoom: maxZoom }),
        ...(attribution && { attribution }),
      },
    },
    layers: [
      backgroundLayer(theme),
      { id: BASEMAP_RASTER_LAYER_ID, type: 'raster', source: BASEMAP_SOURCE_ID, paint: rasterPaint(theme) },
    ],
  };
}

function backgroundLayer(theme: EngineTheme) {
  return { id: BACKGROUND_LAYER_ID, type: 'background' as const, paint: { 'background-color': theme.background } };
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}
