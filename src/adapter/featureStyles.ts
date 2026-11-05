import {
  DataFrame,
  Field,
  FieldType,
  GrafanaTheme2,
  getDisplayProcessor,
  MappingType,
  SpecialValueMatch,
  ValueMapping,
  getFieldDisplayName,
  getFieldColorModeForField,
  getMinMaxAndDelta,
  getScaleCalculator,
} from '@grafana/data';
import { FeatureStyles } from '../engine';
import { ConversionResult } from './frameToFeatureCollection';
import { MAP_STYLE_RANGES, MapStyleConfig } from './layerStyle';

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
 * The Color by and Size by columns of the layer drawn from `frame`, read from its geometry
 * field's config like the rest of Map style (docs/phase_6.md, Design §2). A column is found by
 * name or display name, which is what the options' field picker saves.
 */
export function dataStyleFields(frame: DataFrame, result: ConversionResult): DataStyleFields {
  const custom: MapStyleConfig = geometryField(frame, result)?.config.custom ?? {};
  const fields: DataStyleFields = { problems: [] };
  if (custom.colorBy) {
    fields.colorField = findField(frame, custom.colorBy);
    if (!fields.colorField) {
      fields.problems.push(`Color by: no column named ${custom.colorBy}`);
    }
  }
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
  return fields;
}

/**
 * Per-feature colors and point radii from the layer's Color by and Size by columns, or undefined
 * when neither is in use (docs/phase_6.md, Design §2). Features without a usable value get
 * undefined entries, which keep the layer's style.
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
  const custom: MapStyleConfig = geometryField(frame, result)?.config.custom ?? {};
  return {
    ...(colorField && { colors: featureColors(colorField, result, theme) }),
    ...(sizeField && { radii: featureRadii(sizeField, result, sizeRange(custom)) }),
  };
}

/** Min and Max point size, px, with their defaults and ranges. */
function sizeRange({ sizeMin, sizeMax }: MapStyleConfig): [number, number] {
  const option = (value: number | undefined, name: 'sizeMin' | 'sizeMax') => {
    const { min, max, default: fallback } = MAP_STYLE_RANGES[name];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return [option(sizeMin, 'sizeMin'), option(sizeMax, 'sizeMax')];
}

/**
 * Each feature's color, as Grafana's display processor gives it for the feature's value: value
 * mappings, then thresholds or the by-value scheme, across the column's range. The display
 * processor colors empty values too (the base threshold), so they keep the layer's color unless
 * a value mapping for them sets one (docs/phase_6.md, step 6.1).
 */
function featureColors(field: Field, result: ConversionResult, theme: GrafanaTheme2): Array<string | undefined> {
  const range = columnRange(field);
  // The display processor also reads the series index, for palette colors.
  const inputs = JSON.stringify([field.config, range, field.state?.seriesIndex]);
  return cached(colorCache, field, result, inputs, theme, () => {
    const color = colorOf(range ? { ...field, state: { ...field.state, range } } : field, theme);
    const mappings = field.config.mappings ?? [];
    return result.featureRows.map((row) => {
      const value = field.values[row];
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
 * Each point's radius: the value's place in the column's range, clamped, mapped linearly onto
 * the point diameters and halved. Every value gets the middle size when the range is a single
 * value.
 */
function featureRadii(field: Field, result: ConversionResult, [sizeMin, sizeMax]: [number, number]) {
  const range = columnRange(field);
  return cached(radiusCache, field, result, JSON.stringify(range), `${sizeMin},${sizeMax}`, () =>
    result.featureRows.map((row) => {
      const value = field.values[row];
      if (typeof value !== 'number' || !Number.isFinite(value) || !range) {
        return undefined;
      }
      const t = range.delta > 0 ? Math.min(1, Math.max(0, (value - range.min) / range.delta)) : 0.5;
      return (sizeMin + t * (sizeMax - sizeMin)) / 2;
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
  featureRows: number[];
  inputs: string;
  extra: unknown;
  values: T[];
}
const colorCache = new WeakMap<object, Cached<string | undefined>>();
const radiusCache = new WeakMap<object, Cached<number | undefined>>();

/**
 * Per-feature values, worked out again only when the column's data, the features, `inputs` or
 * `extra` change. Keyed by the column's values array, which Grafana keeps across field config
 * changes (docs/phase_5.md, Design §3). It clones every config, so `inputs` holds what the
 * values depend on as JSON, compared by content. Unchanged inputs give the same array back.
 */
function cached<T>(
  cache: WeakMap<object, Cached<T>>,
  field: Field,
  result: ConversionResult,
  inputs: string,
  extra: unknown,
  compute: () => T[]
): T[] {
  const hit = cache.get(field.values);
  if (hit && hit.featureRows === result.featureRows && hit.inputs === inputs && hit.extra === extra) {
    return hit.values;
  }
  const values = compute();
  cache.set(field.values, { featureRows: result.featureRows, inputs, extra, values });
  return values;
}

function geometryField(frame: DataFrame, result: ConversionResult): Field | undefined {
  return frame.fields.find(({ name }) => name === result.geometryField);
}

function findField(frame: DataFrame, name: string): Field | undefined {
  return (
    frame.fields.find((field) => field.name === name) ??
    frame.fields.find((field) => getFieldDisplayName(field, frame) === name)
  );
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
