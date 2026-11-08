// Basemap presets (docs/phase_12.md, Design §2): every provider's URLs, styles and attribution,
// in one table. The panel turns a preset into an ordinary BasemapSpec, so the engine knows
// nothing about providers.
import { BasemapSpec } from '../engine';

export type ProviderId = 'openfreemap' | 'stadia' | 'maptiler' | 'thunderforest';

export interface PresetStyle {
  id: string;
  label: string;
}

/** A provider's style choices, as saved in the panel options. Unset means the defaults. */
export interface PresetChoice {
  /** A light style id; default the provider's first. */
  style?: string;
  /** A dark style id, or SAME_STYLE; default the light style's pair. */
  dark?: string;
}

/** Dark theme style: keep the light style (dimmed, for raster tiles). */
export const SAME_STYLE = 'same';

export interface Provider {
  id: ProviderId;
  label: string;
  /** Whether the provider needs the user's API key. Optional: it works without one in some setups. */
  key: 'none' | 'optional' | 'required';
  /** Where the user gets a key and reads the terms, for the options' descriptions. */
  site: string;
  light: PresetStyle[];
  dark: PresetStyle[];
  /** The dark style a light style pairs with, or SAME_STYLE. */
  darkPair: (light: string) => string;
  /** The basemap for one style. `dim`: a light raster style shown in dark theme. */
  spec: (style: string, key: string | undefined, dim: boolean) => BasemapSpec;
}

const link = (href: string, text: string) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

/** Query parameters for the key, on every request to `host`; none without a key. */
const keyParams = (host: string, name: string, key: string | undefined) =>
  key ? { requestParams: { host, params: { [name]: key } } } : {};

export const PROVIDERS: Record<ProviderId, Provider> = {
  // No key and no limits (docs/phase_12.md, Starting point). Its tiles carry the attribution.
  openfreemap: {
    id: 'openfreemap',
    label: 'OpenFreeMap',
    key: 'none',
    site: 'https://openfreemap.org',
    light: [
      { id: 'liberty', label: 'Liberty' },
      { id: 'bright', label: 'Bright' },
      { id: 'positron', label: 'Positron' },
    ],
    dark: [
      { id: 'dark', label: 'Dark' },
      { id: 'fiord', label: 'Fiord' },
    ],
    darkPair: () => 'dark',
    spec: (style) => ({ kind: 'style', url: `https://tiles.openfreemap.org/styles/${style}` }),
  },
  // Works without a key on localhost and on domains registered with Stadia. Its styles point at
  // tiles and fonts without the key, so the key goes on every request to its host.
  stadia: {
    id: 'stadia',
    label: 'Stadia Maps',
    key: 'optional',
    site: 'https://stadiamaps.com',
    light: [
      { id: 'alidade_smooth', label: 'Alidade Smooth' },
      { id: 'alidade_bright', label: 'Alidade Bright' },
      { id: 'osm_bright', label: 'OSM Bright' },
      { id: 'outdoors', label: 'Outdoors' },
      { id: 'stamen_toner', label: 'Stamen Toner' },
    ],
    dark: [
      { id: 'alidade_smooth_dark', label: 'Alidade Smooth Dark' },
      { id: 'stamen_toner_dark', label: 'Stamen Toner Dark' },
    ],
    darkPair: (light) => (light === 'stamen_toner' ? 'stamen_toner_dark' : 'alidade_smooth_dark'),
    spec: (style, key) => ({
      kind: 'style',
      url: `https://tiles.stadiamaps.com/styles/${style}.json`,
      ...keyParams('tiles.stadiamaps.com', 'api_key', key),
    }),
  },
  // Every style has a dark variant with -dark on its id (step 12.1). The free plan requires the logo.
  maptiler: {
    id: 'maptiler',
    label: 'MapTiler',
    key: 'required',
    site: 'https://www.maptiler.com',
    light: [
      { id: 'streets-v4', label: 'Streets' },
      { id: 'basic-v2', label: 'Basic' },
      { id: 'bright-v2', label: 'Bright' },
      { id: 'dataviz-v4', label: 'Dataviz' },
      { id: 'outdoor-v4', label: 'Outdoor' },
      { id: 'topo-v4', label: 'Topo' },
      { id: 'backdrop', label: 'Backdrop' },
    ],
    dark: [
      { id: 'streets-v4-dark', label: 'Streets Dark' },
      { id: 'basic-v2-dark', label: 'Basic Dark' },
      { id: 'bright-v2-dark', label: 'Bright Dark' },
      { id: 'dataviz-v4-dark', label: 'Dataviz Dark' },
      { id: 'outdoor-v4-dark', label: 'Outdoor Dark' },
      { id: 'topo-v4-dark', label: 'Topo Dark' },
      { id: 'backdrop-dark', label: 'Backdrop Dark' },
    ],
    darkPair: (light) => `${light}-dark`,
    spec: (style, key) => ({
      kind: 'style',
      url: `https://api.maptiler.com/maps/${style}/style.json`,
      ...keyParams('api.maptiler.com', 'key', key),
      logo: { href: 'https://www.maptiler.com/', src: 'https://api.maptiler.com/resources/logo.svg', alt: 'MapTiler' },
    }),
  },
  // Raster tiles. Its terms require working links to Thunderforest and OpenStreetMap.
  thunderforest: {
    id: 'thunderforest',
    label: 'Thunderforest',
    key: 'required',
    site: 'https://www.thunderforest.com',
    light: [
      { id: 'atlas', label: 'Atlas' },
      { id: 'transport', label: 'Transport' },
      { id: 'landscape', label: 'Landscape' },
      { id: 'outdoors', label: 'Outdoors' },
      { id: 'neighbourhood', label: 'Neighbourhood' },
      { id: 'cycle', label: 'OpenCycleMap' },
    ],
    dark: [{ id: 'transport-dark', label: 'Transport Dark' }],
    darkPair: (light) => (light === 'transport' ? 'transport-dark' : SAME_STYLE),
    spec: (style, key, dim) => ({
      kind: 'raster',
      tiles: [`https://tile.thunderforest.com/${style}/{z}/{x}/{y}.png`],
      attribution: `Maps © ${link('https://www.thunderforest.com/', 'Thunderforest')}, Data © ${link(
        'https://www.openstreetmap.org/copyright',
        'OpenStreetMap contributors'
      )}`,
      attributionHtml: true,
      maxZoom: 22,
      dimInDark: dim,
      ...keyParams('tile.thunderforest.com', 'apikey', key),
    }),
  },
};

export function isProviderId(kind: unknown): kind is ProviderId {
  return typeof kind === 'string' && kind in PROVIDERS;
}

/** Why a provider can't be used with this key, or undefined when it can. */
export function apiKeyProblem(provider: Provider, key: string | undefined): string | undefined {
  return provider.key === 'required' && !key?.trim() ? `Enter your ${provider.label} API key` : undefined;
}

/**
 * The light and dark style a choice resolves to: unknown ids, such as another provider's after
 * switching provider, fall back to the defaults.
 */
export function presetStyles(provider: Provider, choice: PresetChoice | undefined): { light: string; dark: string } {
  const light = provider.light.find(({ id }) => id === choice?.style)?.id ?? provider.light[0].id;
  const chosen = choice?.dark === SAME_STYLE || provider.dark.some(({ id }) => id === choice?.dark);
  return { light, dark: chosen ? choice!.dark! : provider.darkPair(light) };
}

/**
 * The basemap for a preset in the current theme, or `none` when a required key is missing, as for
 * an invalid URL: the options pane says why.
 */
export function presetBasemap(
  provider: Provider,
  choice: PresetChoice | undefined,
  key: string | undefined,
  dark: boolean
): BasemapSpec {
  if (apiKeyProblem(provider, key)) {
    return { kind: 'none' };
  }
  const { light, dark: darkStyle } = presetStyles(provider, choice);
  const trimmed = key?.trim() || undefined;
  if (!dark) {
    return provider.spec(light, trimmed, true);
  }
  return darkStyle === SAME_STYLE ? provider.spec(light, trimmed, true) : provider.spec(darkStyle, trimmed, false);
}
