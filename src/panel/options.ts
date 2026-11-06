import { MapStyleConfig } from '../adapter';
import { BasemapSpec, ViewState } from '../engine';

export type BasemapKind = BasemapSpec['kind'];

/** When tooltips show: on hover (and pinned on click), only on click, or never (docs/phase_4.md). */
export type TooltipMode = 'hover' | 'click' | 'off';

/** Panel options for GeoFlow (docs/phase_2.md, Design §5). */
export interface GeoFlowOptions {
  basemap: {
    kind: BasemapKind;
    /** XYZ template for `raster`, e.g. https://tiles.example.com/{z}/{x}/{y}.png */
    tileUrl?: string;
    tileAttribution?: string;
    /** MapLibre style JSON URL for `style`. */
    styleUrl?: string;
  };
  view: { lat: number; lon: number; zoom: number };
  tooltip: TooltipMode;
  /** The legend of colors from Color by (docs/phase_6.md, Design §4). */
  legend: { show: boolean };
  showSummary: boolean;
}

/**
 * Per-field options GeoFlow adds to Grafana's standard ones, usable as defaults and in overrides.
 * The Map style options are read from each query's geometry field (docs/phase_5.md and
 * docs/phase_6.md).
 */
export interface GeoFlowFieldConfig extends MapStyleConfig {
  /** Leave the field out of tooltips. Its data links still show. */
  hideInTooltip?: boolean;
}

export const DEFAULT_OPTIONS: GeoFlowOptions = {
  basemap: { kind: 'osm' },
  view: { lat: 20, lon: 0, zoom: 1 },
  tooltip: 'hover',
  legend: { show: true },
  showSummary: false,
};

const TOOLTIP_MODES: readonly TooltipMode[] = ['hover', 'click', 'off'];

/** The tooltip mode, with the default for dashboards saved before the option existed. */
export function tooltipMode(options: Pick<GeoFlowOptions, 'tooltip'> | undefined): TooltipMode {
  return TOOLTIP_MODES.includes(options?.tooltip as TooltipMode) ? options!.tooltip : DEFAULT_OPTIONS.tooltip;
}

const HTTP_URL = /^(https?:\/\/|\/)/i;

/** Why a tile URL template can't be used, or undefined when it can. */
export function tileUrlProblem(url: string | undefined): string | undefined {
  const value = url?.trim() ?? '';
  if (!value) {
    return 'Enter a tile URL template';
  }
  if (!HTTP_URL.test(value)) {
    return 'The tile URL must start with http://, https:// or /';
  }
  const missing = ['{z}', '{x}', '{y}'].filter((placeholder) => !value.includes(placeholder));
  if (missing.length > 0) {
    return `The tile URL needs ${missing.join(', ')}, for example https://tiles.example.com/{z}/{x}/{y}.png`;
  }
  return undefined;
}

/** Why a style URL can't be used, or undefined when it can. */
export function styleUrlProblem(url: string | undefined): string | undefined {
  const value = url?.trim() ?? '';
  if (!value) {
    return 'Enter a style URL';
  }
  if (!HTTP_URL.test(value)) {
    return 'The style URL must start with http://, https:// or /';
  }
  return undefined;
}

/**
 * The engine basemap for the panel options. Incomplete or invalid settings fall back to `none`
 * rather than a broken style; the options pane shows why (see CheckedTextEditor.tsx).
 */
export function basemapFromOptions(basemap: GeoFlowOptions['basemap'] | undefined): BasemapSpec {
  switch (basemap?.kind ?? DEFAULT_OPTIONS.basemap.kind) {
    case 'osm':
      return { kind: 'osm' };
    case 'raster':
      return tileUrlProblem(basemap?.tileUrl)
        ? { kind: 'none' }
        : { kind: 'raster', tiles: [basemap!.tileUrl!.trim()], attribution: basemap?.tileAttribution?.trim() ?? '' };
    case 'style':
      return styleUrlProblem(basemap?.styleUrl) ? { kind: 'none' } : { kind: 'style', url: basemap!.styleUrl!.trim() };
    default:
      return { kind: 'none' };
  }
}

/** The initial view, clamped to valid ranges. */
export function viewFromOptions(view: Partial<GeoFlowOptions['view']> | undefined): ViewState {
  const { lat, lon, zoom } = { ...DEFAULT_OPTIONS.view, ...view };
  return {
    center: [
      clamp(finite(lon, DEFAULT_OPTIONS.view.lon), -180, 180),
      clamp(finite(lat, DEFAULT_OPTIONS.view.lat), -85, 85),
    ],
    zoom: clamp(finite(zoom, DEFAULT_OPTIONS.view.zoom), 0, 22),
  };
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
