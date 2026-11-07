import { DEFAULT_LAYER_BINDING, LayerBinding, LayerConfig, MapStyleConfig } from '../adapter';
import { BasemapSpec, ViewState } from '../engine';

export type BasemapKind = BasemapSpec['kind'];

export type ViewMode = 'fixed' | 'fit';

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
  view: {
    /**
     * Fixed: the latitude, longitude and zoom. Fit: framed around the data (docs/phase_8.md,
     * Design §2), with the fixed view until there is data. Panels saved before Phase 8 are
     * migrated to fixed.
     */
    mode: ViewMode;
    lat: number;
    lon: number;
    zoom: number;
    /** Fit only: fit again on every query response. */
    fitOnRefresh?: boolean;
    /** Fit only: px around the data. */
    padding?: number;
    /** Fit only: the closest a fit zooms in, so a single point doesn't fill the map. */
    maxZoom?: number;
  };
  tooltip: TooltipMode;
  /** The legend of colors from Color by (docs/phase_6.md, Design §4). */
  legend: { show: boolean };
  showSummary: boolean;
  /** Layer settings, top layer first (docs/phase_7.md, Design §1). Layers without any get defaults. */
  layers: LayerConfig[];
  /** Saved for Phase 11, which adds a second mode; not shown in the editor yet. */
  layerBinding: LayerBinding;
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
  view: { mode: 'fit', lat: 20, lon: 0, zoom: 1, fitOnRefresh: false, padding: 40, maxZoom: 17 },
  tooltip: 'hover',
  legend: { show: true },
  showSummary: false,
  layers: [],
  layerBinding: DEFAULT_LAYER_BINDING,
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

/** Ranges for the fit options; the defaults are in DEFAULT_OPTIONS. */
export const FIT_RANGES = { padding: { min: 0, max: 200 }, maxZoom: { min: 0, max: 22 } };

/** How the map fits the data, or undefined in fixed mode. */
export interface FitSettings {
  padding: number;
  maxZoom: number;
  onRefresh: boolean;
}

/**
 * The fit settings, clamped to valid ranges, or undefined when the view is fixed. A view without
 * a mode is fixed, as every view was before Phase 8.
 */
export function fitFromOptions(view: Partial<GeoFlowOptions['view']> | undefined): FitSettings | undefined {
  if (view?.mode !== 'fit') {
    return undefined;
  }
  const { padding, maxZoom } = FIT_RANGES;
  return {
    padding: clamp(finite(view.padding, DEFAULT_OPTIONS.view.padding!), padding.min, padding.max),
    maxZoom: clamp(finite(view.maxZoom, DEFAULT_OPTIONS.view.maxZoom!), maxZoom.min, maxZoom.max),
    onRefresh: view.fitOnRefresh === true,
  };
}

/**
 * Panel migration (docs/phase_8.md, Design §2): panels saved before Phase 8 keep their fixed
 * view, while new panels get Fit to data from the defaults. Grafana runs it on panels saved with
 * another plugin version, or none (provisioned dashboards), before applying option defaults.
 */
export function migrateOptions(options: Partial<GeoFlowOptions> | undefined): Partial<GeoFlowOptions> {
  if (options?.view?.mode) {
    return options;
  }
  return { ...options, view: { ...options?.view, mode: 'fixed' } as GeoFlowOptions['view'] };
}

/** The fixed view, clamped to valid ranges. */
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
