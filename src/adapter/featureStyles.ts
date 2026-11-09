import {
  DataFrame,
  Field,
  FieldType,
  GrafanaTheme2,
  getDisplayProcessor,
  MappingType,
  SpecialValueMatch,
  ValueMapping,
  getFieldColorModeForField,
  getMinMaxAndDelta,
  getScaleCalculator,
} from '@grafana/data';
import { FeatureStyles } from '../engine';
import { EdgeValueKind, edgeValueProblem, edgeValues } from './edgeValues';
import { findField } from './featureLookup';
import { ConversionResult, styleFieldOf } from './frameToFeatureCollection';
import { MapStyleConfig, mapStyleNumber } from './layerStyle';

/** Distinct colors a gradient is drawn with, across the column's range. */
const GRADIENT_STEPS = 1024;

/** The columns a layer's Color by and Size by options pick, found in its frame. */
export interface DataStyleFields {
  colorField?: Field;
  sizeField?: Field;
  /** Why an option that is set has no effect, for the data summary. */
  problems: string[];
}

/**
 * The Color by and Size by columns of the layer drawn from `frame`, read from its style column's
 * config like the rest of Map style (docs/phase_6.md, Design §2). A column is found by
 * name or display name, which is what the options' field picker saves.
 */
export function dataStyleFields(frame: DataFrame, result: ConversionResult): DataStyleFields {
  const custom: MapStyleConfig = styleFieldOf(frame, result)?.config.custom ?? {};
  const fields: DataStyleFields = { problems: [] };
  if (custom.colorBy) {
    fields.colorField = findField(frame, custom.colorBy);
    if (!fields.colorField) {
      fields.problems.push(`Color by: no column named ${custom.colorBy}`);
    }
  }
  const edgeProblem = (option: string, field: Field | undefined) => {
    const problem = result.pairs && field && edgeValueProblem(frame, field);
    if (problem) {
      fields.problems.push(`${option}: ${problem}`);
    }
  };
  edgeProblem('Color by', fields.colorField);
  if (custom.sizeBy) {
    const field = findField(frame, custom.sizeBy);
    if (!field) {
      fields.problems.push(`Size by: no column named ${custom.sizeBy}`);
    } else if (field.type !== FieldType.number) {
      fields.problems.push(`Size by: ${custom.sizeBy} isn't a number column`);
    } else {
      fields.sizeField = field;
    }
  }
  edgeProblem('Size by', fields.sizeField);
  return fields;
}

/**
 * Per-feature colors and point radii from the layer's Color by and Size by columns, or undefined
 * when neither is in use (docs/phase_6.md, Design §2). Features without a usable value get
 * undefined entries, which keep the layer's style. An edge layer's lines are colored and sized by
 * their pairs' edge values, and Size by sets their widths (docs/node-edge/phase_5.md, Design §2).
 */
export function featureStyles(
  frame: DataFrame,
  result: ConversionResult,
  theme: GrafanaTheme2
): FeatureStyles | undefined {
  const { colorField, sizeField } = dataStyleFields(frame, result);
  if (!colorField && !sizeField) {
    return undefined;
  }
  const custom: MapStyleConfig = styleFieldOf(frame, result)?.config.custom ?? {};
  const sizes =
    sizeField && featureSizes(styleSource(frame, result, sizeField), result, sizeRange(custom), !result.pairs);
  return {
    ...(colorField && { colors: featureColors(styleSource(frame, result, colorField), result, theme) }),
    ...(sizes && (result.pairs ? { widths: sizes } : { radii: sizes })),
  };
}

/** What a column styles a layer's features from (docs/node-edge/phase_5.md, Design §2). */
export interface StyleSource {
  /** The column, as its values are colored: a count of a column's values is a plain number column. */
  field: Field;
  /** Each feature's value, by its position in the FeatureCollection. */
  valueAt: (index: number) => unknown;
  /** The range gradients and sizes span: the column's Min and Max, or its data's. */
  range?: { min: number; max: number; delta: number };
  /** For edge layers, how each pair's value was worked out. */
  edgeKind?: EdgeValueKind;
}

/**
 * Each feature's value from `field`: its row's for most layers, its pair's edge value for an edge
 * layer, whose range spans the pairs' values rather than the rows' (docs/node-edge/architecture.md
 * §6.3).
 */
export function styleSource(frame: DataFrame, result: ConversionResult, field: Field): StyleSource {
  if (!result.pairs) {
    return { field, valueAt: (i) => field.values[result.featureRows[i]], range: columnRange(field) };
  }
  const { kind, values, range } = edgeValues(frame, result, field);
  // A count is a number whatever the column holds, and has no unit: "4", not "4 Gb/s".
  const counted: Field =
    kind === 'count' ? { ...field, type: FieldType.number, config: { ...field.config, unit: undefined } } : field;
  return { field: counted, valueAt: (i) => values[i], range, edgeKind: kind };
}

/** Min and Max point size, px, with their defaults and ranges. */
function sizeRange(custom: MapStyleConfig): [number, number] {
  return [mapStyleNumber(custom, 'sizeMin'), mapStyleNumber(custom, 'sizeMax')];
}

/**
 * Each feature's color, as Grafana's display processor gives it for the feature's value: value
 * mappings, then thresholds or the by-value scheme, across the column's range. The display
 * processor colors empty values too (the base threshold), so they keep the layer's color unless
 * a value mapping for them sets one (docs/phase_6.md, step 6.1).
 */
function featureColors(
  { field, valueAt, range, edgeKind }: StyleSource,
  result: ConversionResult,
  theme: GrafanaTheme2
): Array<string | undefined> {
  // The display processor also reads the series index, for palette colors.
  const inputs = JSON.stringify([field.config, range, field.state?.seriesIndex, edgeKind]);
  return cached(colorCache, field, result, inputs, theme, () => {
    const color = colorOf(range ? { ...field, state: { ...field.state, range } } : field, theme);
    const mappings = field.config.mappings ?? [];
    return result.featureCollection.features.map((_, i) => {
      const value = valueAt(i);
      if (isEmpty(value) && !mapsEmptyToColor(mappings, value)) {
        return undefined;
      }
      return color(value);
    });
  });
}

/**
 * The display processor's color for a value, without the cost of formatting its text, which is
 * most of a display() call: about 200 ms for 100k values (docs/phase_6.md, step 6.3). A number
 * column without value mappings gets its color straight from Grafana's scale calculator, as the
 * display processor does; other columns go through the display processor once per distinct value.
 * Gradient colors come as rgb(), where Grafana's panels show the same color as hex.
 */
function colorOf(field: Field, theme: GrafanaTheme2): (value: unknown) => string | undefined {
  if (field.type === FieldType.number && !field.config.mappings?.length && field.config.unit !== 'string') {
    const scale = getScaleCalculator(field, theme);
    const range = field.state?.range;
    if (getFieldColorModeForField(field).isContinuous && range?.delta) {
      // Interpolating a gradient for every value still takes about 200 ms for 100k; GRADIENT_STEPS
      // steps across the range look the same.
      const { min, delta } = range as { min: number; delta: number };
      const steps = new Map<number, string>();
      return (value) => {
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
          return scale(-Infinity).color;
        }
        const step = Math.round(Math.min(1, Math.max(0, (numeric - min) / delta)) * GRADIENT_STEPS);
        if (!steps.has(step)) {
          steps.set(step, scale(min + (step / GRADIENT_STEPS) * delta).color);
        }
        return steps.get(step);
      };
    }
    return (value) => {
      const numeric = Number(value);
      return scale(Number.isNaN(numeric) ? -Infinity : numeric).color;
    };
  }
  const display = getDisplayProcessor({ field, theme });
  const colors = new Map<unknown, string | undefined>();
  return (value) => {
    if (!colors.has(value)) {
      colors.set(value, display(value).color);
    }
    return colors.get(value);
  };
}

/**
 * Each feature's size: the value's place in the range, clamped, mapped linearly onto Min size to
 * Max size, a point's diameter or an edge line's width. Points get radii: half the diameter.
 * Every value gets the middle size when the range is a single value.
 */
function featureSizes(
  { field, valueAt, range, edgeKind }: StyleSource,
  result: ConversionResult,
  [sizeMin, sizeMax]: [number, number],
  radii: boolean
) {
  const scale = radii ? 0.5 : 1;
  return cached(sizeCache, field, result, JSON.stringify([range, edgeKind]), `${sizeMin},${sizeMax},${scale}`, () =>
    result.featureCollection.features.map((_, i) => {
      const value = valueAt(i);
      if (typeof value !== 'number' || !Number.isFinite(value) || !range) {
        return undefined;
      }
      const t = range.delta > 0 ? Math.min(1, Math.max(0, (value - range.min) / range.delta)) : 0.5;
      return (sizeMin + t * (sizeMax - sizeMin)) * scale;
    })
  );
}

/**
 * A number column's own range: its Min and Max, or its data's. Grafana's default range
 * (`state.range`) spans every number column of every query, so an id column would squash every
 * gradient and size (docs/phase_6.md, step 6.3).
 */
function columnRange(field: Field): { min: number; max: number; delta: number } | undefined {
  if (field.type !== FieldType.number) {
    return undefined;
  }
  const { min, max } = getMinMaxAndDelta(field);
  return finite(min) !== undefined && finite(max) !== undefined
    ? { min: min!, max: max!, delta: max! - min! }
    : undefined;
}

interface Cached<T> {
  inputs: string;
  extra: unknown;
  values: T[];
}
const colorCache = new WeakMap<ConversionResult, Map<string, Cached<string | undefined>>>();
const sizeCache = new WeakMap<ConversionResult, Map<string, Cached<number | undefined>>>();

/**
 * Per-feature values, worked out again only when the column's data, `inputs` or `extra` change.
 * Keyed by the conversion and the column's name: a conversion is reused only while its frame's
 * data is unchanged, through field config changes (docs/phase_5.md, Design §3) and refreshes that
 * bring the same data again (docs/phase_8.md, Design §1). Grafana clones every config, so
 * `inputs` holds what the values depend on as JSON, compared by content. Unchanged inputs give
 * the same array back.
 */
function cached<T>(
  cache: WeakMap<ConversionResult, Map<string, Cached<T>>>,
  field: Field,
  result: ConversionResult,
  inputs: string,
  extra: unknown,
  compute: () => T[]
): T[] {
  let byField = cache.get(result);
  if (!byField) {
    byField = new Map();
    cache.set(result, byField);
  }
  const hit = byField.get(field.name);
  if (hit && hit.inputs === inputs && hit.extra === extra) {
    return hit.values;
  }
  const values = compute();
  byField.set(field.name, { inputs, extra, values });
  return values;
}

/** Whether a Special value mapping gives this empty value a color. No other mapping matches one. */
function mapsEmptyToColor(mappings: ValueMapping[], value: unknown): boolean {
  const matches = (match: SpecialValueMatch) => {
    switch (match) {
      case SpecialValueMatch.Null:
        return value === null || value === undefined;
      case SpecialValueMatch.NaN:
        return typeof value === 'number' && Number.isNaN(value);
      case SpecialValueMatch.NullAndNaN:
        return value === null || value === undefined || Number.isNaN(value);
      case SpecialValueMatch.Empty:
        return value === '';
      default:
        return false;
    }
  };
  return mappings.some(
    (mapping) =>
      mapping.type === MappingType.SpecialValue && !!mapping.options.result.color && matches(mapping.options.match)
  );
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));
}

function finite(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
