import { DataFrame, FieldColorModeId, GrafanaTheme2, getFieldColorModeForField } from '@grafana/data';
import { DEFAULT_LAYER_STYLE, LayerStyle, LineStyle } from '../engine';
import { parseDashPattern } from './dashPattern';
import { ConversionResult, styleFieldOf } from './frameToFeatureCollection';

export type LineStyleOption = 'solid' | 'dash' | 'dot' | 'custom';

/** GeoFlow's Map style field options, as saved in the dashboard (docs/phase_5.md, Design §1). */
export interface MapStyleConfig {
  /** Percent. */
  opacity?: number;
  /** Percent. */
  fillOpacity?: number;
  /** Pixels. */
  lineWidth?: number;
  /** Point diameter, pixels. */
  pointSize?: number;
  lineStyle?: LineStyleOption;
  /** Dash and gap lengths in pixels, for the custom line style. */
  dashPattern?: string;
  /** The column whose values color the features (docs/phase_6.md, Design §1). */
  colorBy?: string;
  /** The number column whose values size the points. */
  sizeBy?: string;
  /** Point diameter at the Size by column's Min, pixels. */
  sizeMin?: number;
  /** Point diameter at its Max, pixels. */
  sizeMax?: number;
}

export type NumberOption = Exclude<keyof MapStyleConfig, 'lineStyle' | 'dashPattern' | 'colorBy' | 'sizeBy'>;

/** Ranges and defaults of the numeric options. The defaults draw as Phases 3 and 4 did. */
export const MAP_STYLE_RANGES: Record<NumberOption, { min: number; max: number; default: number }> = {
  opacity: { min: 0, max: 100, default: DEFAULT_LAYER_STYLE.opacity * 100 },
  fillOpacity: { min: 0, max: 100, default: DEFAULT_LAYER_STYLE.fillOpacity * 100 },
  lineWidth: { min: 1, max: 10, default: DEFAULT_LAYER_STYLE.lineWidth },
  pointSize: { min: 2, max: 40, default: DEFAULT_LAYER_STYLE.pointRadius * 2 },
  sizeMin: { min: 2, max: 40, default: 4 },
  sizeMax: { min: 2, max: 40, default: 20 },
};

/**
 * A numeric Map style option, clamped to its range. Unset, mistyped or non-finite values (hand
 * edited JSON, or a dashboard from an older version) get the default.
 */
export function mapStyleNumber(custom: MapStyleConfig, name: NumberOption): number {
  const { min, max, default: fallback } = MAP_STYLE_RANGES[name];
  const value = custom[name];
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/**
 * The style of the layer drawn from `frame`, from its style column's config (docs/phase_5.md,
 * Design §2): the geometry column, or an edge layer's from column. Grafana applies the panel's
 * field options and overrides to every field, so an override on one query, or on that column's
 * name, styles that layer. Bad or missing
 * values fall back to the defaults, so old dashboards draw as before. `colorName` is what By name
 * hashes (BoundLayer.colorName): the frame's name or refId unless the layer has a typed name.
 */
export function layerStyle(
  frame: DataFrame,
  result: ConversionResult,
  layerIndex: number,
  theme: GrafanaTheme2,
  colorName = frame.name || frame.refId || ''
): LayerStyle {
  const field = styleFieldOf(frame, result);
  const custom: MapStyleConfig = field?.config.custom ?? {};
  const option = (name: NumberOption) => mapStyleNumber(custom, name);

  return {
    color: layerColor(colorName, field, layerIndex, theme),
    opacity: option('opacity') / 100,
    fillOpacity: option('fillOpacity') / 100,
    lineWidth: option('lineWidth'),
    lineStyle: lineStyle(custom),
    pointRadius: option('pointSize') / 2,
    outlineColor: theme.colors.background.primary,
  };
}

/**
 * Classic palette colors go by the layer's position among layers, as before Phase 5 (decision 2):
 * Grafana's own series index counts every column of every query. Other schemes use Grafana's
 * color calculator, so they behave as in its other panels. By name hashes the layer's name
 * (`colorName`): Grafana would hash the field's, and every query's geometry column may be called
 * `geometry` (docs/phase_5.md, step 5.1). By-value schemes aren't offered (there's no value to
 * color by), and fall back to the palette if set by hand.
 */
function layerColor(
  colorName: string,
  field: DataFrame['fields'][number] | undefined,
  layerIndex: number,
  theme: GrafanaTheme2
): string {
  const palette = () => {
    const names = theme.visualization.palette;
    return theme.visualization.getColorByName(names[layerIndex % names.length]);
  };
  const mode = field?.config.color?.mode;
  if (!field || !mode || mode === FieldColorModeId.PaletteClassic) {
    return palette();
  }
  const colorMode = getFieldColorModeForField(field);
  if (colorMode.isByValue) {
    return palette();
  }
  const named =
    mode === FieldColorModeId.PaletteClassicByName
      ? { ...field, state: { ...field.state, displayName: colorName } }
      : field;
  return colorMode.getCalculator(named, theme)(0, 0);
}

function lineStyle({ lineStyle: kind, dashPattern }: MapStyleConfig): LineStyle {
  switch (kind) {
    case 'dash':
    case 'dot':
      return { kind };
    case 'custom': {
      // A pattern that doesn't parse draws solid; the option's editor says why.
      const parsed = parseDashPattern(dashPattern);
      return 'pattern' in parsed ? { kind: 'custom', pattern: parsed.pattern } : { kind: 'solid' };
    }
    default:
      return { kind: 'solid' };
  }
}
