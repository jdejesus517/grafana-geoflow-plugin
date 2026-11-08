// Type-only import: erased at build time, so this module doesn't pull MapLibre into the eager chunk.
import type { StyleSpecification } from 'maplibre-gl';
import { BasemapLogo, BasemapSpec, EngineTheme } from './types';

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
 * doesn't glare in a dark dashboard, unless `dim` is false: tiles made for dark theme. Otherwise
 * it returns the MapLibre defaults explicitly, so switching back with setPaintProperty resets
 * every property.
 */
export function rasterPaint(theme: EngineTheme, dim = true) {
  return theme.dark && dim
    ? { 'raster-brightness-max': 0.6, 'raster-saturation': -0.5, 'raster-contrast': 0.1 }
    : { 'raster-brightness-max': 1, 'raster-saturation': 0, 'raster-contrast': 0 };
}

/**
 * The MapLibre style for a basemap. A `style` basemap is returned as its URL: the user's style
 * controls everything, and theme dimming doesn't apply.
 */
export function basemapStyle(spec: BasemapSpec, theme: EngineTheme): StyleSpecification | string {
  switch (spec.kind) {
    case 'osm':
      return rasterStyle([OSM_TILE_URL], OSM_ATTRIBUTION, OSM_MAX_ZOOM, theme, true);
    case 'raster':
      // MapLibre renders attribution as HTML. A custom attribution is typed by a dashboard
      // editor and shown to every viewer, so it is shown as plain text; a preset's is the plugin's.
      return rasterStyle(
        spec.tiles,
        spec.attributionHtml ? spec.attribution : escapeHtml(spec.attribution),
        spec.maxZoom,
        theme,
        spec.dimInDark !== false
      );
    case 'style':
      return spec.url;
    case 'none':
      return { version: 8, sources: {}, layers: [backgroundLayer(theme)] };
  }
}

/**
 * A request URL with the basemap's request parameters added, when it goes to their host; any
 * other URL unchanged. MapLibre calls it for every request (transformRequest). Parameters already
 * in the URL are replaced, so a provider that puts its key in its own URLs gets the same key.
 */
export function basemapRequestUrl(spec: BasemapSpec, url: string): string {
  const requestParams = spec.kind === 'raster' || spec.kind === 'style' ? spec.requestParams : undefined;
  if (!requestParams) {
    return url;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.host !== requestParams.host) {
    return url;
  }
  for (const [name, value] of Object.entries(requestParams.params)) {
    parsed.searchParams.set(name, value);
  }
  return parsed.toString();
}

/** The basemap's logo, if it has one. */
export function basemapLogo(spec: BasemapSpec): BasemapLogo | undefined {
  return spec.kind === 'raster' || spec.kind === 'style' ? spec.logo : undefined;
}

function rasterStyle(
  tiles: string[],
  attribution: string,
  maxZoom: number | undefined,
  theme: EngineTheme,
  dim: boolean
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
      { id: BASEMAP_RASTER_LAYER_ID, type: 'raster', source: BASEMAP_SOURCE_ID, paint: rasterPaint(theme, dim) },
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
