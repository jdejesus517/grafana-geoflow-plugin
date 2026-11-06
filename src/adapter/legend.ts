import {
  DataFrame,
  Field,
  GrafanaTheme2,
  MappingType,
  ThresholdsMode,
  ValueMapping,
  formattedValueToString,
  getFieldColorModeForField,
  getFieldDisplayName,
  getMinMaxAndDelta,
  getValueFormat,
  sortThresholds,
} from '@grafana/data';
import { LayerSpec } from '../engine';
import { dataStyleFields } from './featureStyles';
import { ConversionResult } from './frameToFeatureCollection';

export interface LegendItem {
  label: string;
  color: string;
}

/** The legend of one layer colored by a column (docs/phase_6.md, Design §4). */
export interface LegendEntry {
  layerId: string;
  /** The layer's name, as tooltips show it. */
  title: string;
  /** The Color by column's display name. */
  column: string;
  /** Value mappings with a color, then threshold steps. */
  items: LegendItem[];
  /** A by-value scheme: its colors, low to high, and the formatted ends of its range. */
  gradient?: { colors: string[]; min: string; max: string };
}

/**
 * Legend entries for the visible layers colored by a column, top layer first, as in the Layers
 * list (docs/phase_7.md, Design §6). A layer gets one when its colors have something to tell
 * apart: colored value mappings, thresholds or a by-value scheme. Single-color and palette
 * schemes give every value the same color, so they show only their mappings. `layers` are the
 * engine's, bottom first; `results` are the conversions of `frames`, in the same order.
 */
export function legendEntries(
  layers: LayerSpec[],
  results: ConversionResult[],
  frames: DataFrame[],
  theme: GrafanaTheme2
): LegendEntry[] {
  return [...layers].reverse().flatMap((layer) => {
    const i = results.findIndex((result) => result.layerId === layer.id);
    const [frame, result] = [frames[i], results[i]];
    const field =
      layer.visible && result && !result.noGeometry && frame ? dataStyleFields(frame, result).colorField : undefined;
    if (!field) {
      return [];
    }
    const colorMode = getFieldColorModeForField(field);
    const items = mappingItems(field.config.mappings ?? [], theme);
    let gradient: LegendEntry['gradient'];
    if (colorMode.isContinuous && colorMode.getColors) {
      const { min, max } = getMinMaxAndDelta(field);
      gradient = { colors: colorMode.getColors(theme), min: format(field, min), max: format(field, max) };
    } else if (colorMode.isByValue) {
      items.push(...thresholdItems(field, theme));
    }
    if (items.length === 0 && !gradient) {
      return [];
    }
    return [
      {
        layerId: layer.id,
        title: layer.name,
        column: getFieldDisplayName(field, frame),
        items,
        ...(gradient && { gradient }),
      },
    ];
  });
}

/** One item per value mapping that sets a color, in the mappings' order, as Grafana lists them. */
function mappingItems(mappings: ValueMapping[], theme: GrafanaTheme2): LegendItem[] {
  const items: Array<LegendItem & { index: number }> = [];
  const add = (fallback: string, result: { text?: string; color?: string; index?: number }) => {
    if (result.color) {
      items.push({
        label: result.text ?? fallback,
        color: theme.visualization.getColorByName(result.color),
        index: result.index ?? items.length,
      });
    }
  };
  for (const mapping of mappings) {
    switch (mapping.type) {
      case MappingType.ValueToText:
        for (const [value, result] of Object.entries(mapping.options)) {
          add(value, result);
        }
        break;
      case MappingType.RangeToText:
        add(`${mapping.options.from ?? '-∞'} to ${mapping.options.to ?? '∞'}`, mapping.options.result);
        break;
      case MappingType.RegexToText:
        add(mapping.options.pattern, mapping.options.result);
        break;
      case MappingType.SpecialValue:
        add(mapping.options.match, mapping.options.result);
        break;
    }
  }
  return items.sort((a, b) => a.index - b.index).map(({ label, color }) => ({ label, color }));
}

/** One item per threshold step: "< 80" for the base, "80+" for the others, as Grafana labels them. */
function thresholdItems(field: Field, theme: GrafanaTheme2): LegendItem[] {
  const thresholds = field.config.thresholds;
  if (!thresholds?.steps.length) {
    return [];
  }
  const percent = thresholds.mode === ThresholdsMode.Percentage;
  const label = (value: number) => (percent ? `${value}%` : format(field, value));
  const steps = sortThresholds(thresholds.steps);
  return steps.map((step, i) => ({
    label: i === 0 ? (steps.length > 1 ? `< ${label(steps[1].value)}` : 'All values') : `${label(step.value)}+`,
    color: theme.visualization.getColorByName(step.color),
  }));
}

/** A value formatted with the column's unit and decimals. */
function format(field: Field, value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  return formattedValueToString(getValueFormat(field.config.unit ?? 'none')(value, field.config.decimals));
}
