import {
  DataFrame,
  FieldColorModeId,
  FieldConfig,
  FieldType,
  MappingType,
  SpecialValueMatch,
  ThresholdsMode,
  ValueMapping,
  applyFieldOverrides,
  colorManipulator,
  createTheme,
  toDataFrame,
} from '@grafana/data';
import { MapStyleConfig } from '../layerStyle';
import { dataStyleFields, featureStyles } from '../featureStyles';
import { frameToFeatureCollection } from '../frameToFeatureCollection';

const theme = createTheme();
const color = (name: string) => theme.visualization.getColorByName(name);
const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;

const THRESHOLDS: FieldConfig['thresholds'] = {
  mode: ThresholdsMode.Absolute,
  steps: [
    { value: -Infinity, color: 'green' },
    { value: 80, color: 'red' },
  ],
};

interface Column {
  name: string;
  type: FieldType;
  values: unknown[];
  config?: FieldConfig;
}

/**
 * A frame as the panel gets it, with field config applied by Grafana. The Map style options are
 * on the geometry column. A column's own config wins over the defaults, as an override on that
 * column would.
 */
function frame(custom: MapStyleConfig, columns: Column[], geometry = columns[0].values.map((_, i) => point(i))) {
  const source = toDataFrame({
    refId: 'A',
    fields: [{ name: 'geometry', type: FieldType.string, values: geometry, config: { custom } }, ...columns],
  });
  const [applied] = applyFieldOverrides({
    data: [source],
    fieldConfig: { defaults: { color: { mode: FieldColorModeId.PaletteClassic } }, overrides: [] },
    replaceVariables: (value) => value,
    theme,
  });
  return applied;
}

function styles(data: DataFrame) {
  return featureStyles(data, frameToFeatureCollection(data), theme);
}

const number = (name: string, values: unknown[], config?: FieldConfig): Column => ({
  name,
  type: FieldType.number,
  values,
  config,
});

describe('featureStyles', () => {
  it('is undefined without Color by and Size by', () => {
    expect(styles(frame({}, [number('pct', [10, 90])]))).toBeUndefined();
  });

  describe('colors', () => {
    it("gives each feature its value's threshold color", () => {
      const pct = number('pct', [10, 90, 80], { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } });

      expect(styles(frame({ colorBy: 'pct' }, [pct]))).toEqual({
        colors: [color('green'), color('red'), color('red')],
      });
    });

    it('spreads a by-value scheme across the data range, or Min and Max', () => {
      const gradient = { mode: 'continuous-GrYlRd' } as FieldConfig['color'];
      const fromData = styles(frame({ colorBy: 'pct' }, [number('pct', [0, 50, 100], { color: gradient })]))!;
      const fromMinMax = styles(
        frame({ colorBy: 'pct' }, [number('pct', [0, 50, 100], { color: gradient, min: 0, max: 200 })])
      )!;

      expect(fromData.colors![0]).toBe(fromMinMax.colors![0]);
      // 100 is the top of the data's range, but halfway to a Max of 200.
      expect(fromMinMax.colors![2]).toBe(fromData.colors![1]);
      expect(fromData.colors![2]).not.toBe(fromData.colors![1]);
    });

    it("uses the column's own range, not one across every number column", () => {
      const gradient = { mode: 'continuous-GrYlRd' } as FieldConfig['color'];
      const alone = styles(frame({ colorBy: 'pct' }, [number('pct', [0, 100], { color: gradient })]))!;
      const withIds = styles(
        frame({ colorBy: 'pct' }, [number('id', [0, 5000]), number('pct', [0, 100], { color: gradient })])
      )!;

      expect(withIds.colors).toEqual(alone.colors);
    });

    it("matches the display processor's colors for numbers, across schemes", () => {
      const values = [-20, 0, 3.5, 50, 79.9, 80, 100, 250];
      const schemes: Array<FieldConfig['color']> = [
        { mode: FieldColorModeId.Thresholds },
        { mode: 'continuous-GrYlRd' } as FieldConfig['color'],
        { mode: 'continuous-blues' } as FieldConfig['color'],
        { mode: FieldColorModeId.PaletteClassic },
        { mode: FieldColorModeId.Fixed, fixedColor: 'purple' },
      ];
      for (const scheme of schemes) {
        const config = { thresholds: THRESHOLDS, color: scheme, min: 0, max: 100 };
        const data = frame({ colorBy: 'pct' }, [number('pct', values, config)]);
        const field = data.fields[1];

        // Grafana's panels turn colors into hex (`cachingDisplayProcessor`); gradients come as rgb().
        const hex = (color?: string) => color && colorManipulator.asHexString(color).toLowerCase();
        expect(styles(data)!.colors!.map(hex)).toEqual(values.map((value) => hex(field.display!(value).color)));
      }
    });

    it('colors by value mappings, which win over thresholds', () => {
      const mappings: ValueMapping[] = [
        {
          type: MappingType.ValueToText,
          options: { aerial: { color: 'orange', index: 0 }, underground: { color: 'blue', index: 1 } },
        },
      ];
      const placement: Column = {
        name: 'placement',
        type: FieldType.string,
        values: ['aerial', 'underground', 'aerial'],
        config: { mappings, thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } },
      };

      expect(styles(frame({ colorBy: 'placement' }, [placement]))!.colors).toEqual([
        color('orange'),
        color('blue'),
        color('orange'),
      ]);
    });

    it("keeps the layer's color for empty values, unless a mapping colors them", () => {
      const config = { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } };
      const empty = [90, null, undefined, NaN];

      expect(styles(frame({ colorBy: 'pct' }, [number('pct', empty, config)]))!.colors).toEqual([
        color('red'),
        undefined,
        undefined,
        undefined,
      ]);

      const mappings: ValueMapping[] = [
        { type: MappingType.SpecialValue, options: { match: SpecialValueMatch.Null, result: { color: 'purple' } } },
      ];
      expect(styles(frame({ colorBy: 'pct' }, [number('pct', empty, { ...config, mappings })]))!.colors).toEqual([
        color('red'),
        color('purple'),
        color('purple'),
        undefined,
      ]);
    });

    it('follows features, not rows, when rows were skipped', () => {
      const pct = number('pct', [90, 10, 90], { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } });

      expect(styles(frame({ colorBy: 'pct' }, [pct], [point(0), 'not geometry', point(2)]))!.colors).toEqual([
        color('red'),
        color('red'),
      ]);
    });
  });

  describe('sizes', () => {
    it('scales point diameters linearly across the data range, as radii', () => {
      const data = frame({ sizeBy: 'used', sizeMin: 4, sizeMax: 20 }, [number('used', [0, 5, 10])]);

      expect(styles(data)).toEqual({ radii: [2, 6, 10] });
    });

    it('uses Min and Max when set, clamping values outside them', () => {
      const used = number('used', [-5, 5, 10, 30], { min: 0, max: 20 });

      expect(styles(frame({ sizeBy: 'used', sizeMin: 10, sizeMax: 30 }, [used]))!.radii).toEqual([5, 7.5, 10, 15]);
    });

    it('defaults to 4–20 px, and gives every value the middle size when they are all the same', () => {
      expect(styles(frame({ sizeBy: 'used' }, [number('used', [0, 10])]))!.radii).toEqual([2, 10]);
      expect(styles(frame({ sizeBy: 'used' }, [number('used', [7, 7])]))!.radii).toEqual([6, 6]);
    });

    it("keeps the layer's size for empty values", () => {
      expect(styles(frame({ sizeBy: 'used' }, [number('used', [0, null, 10])]))!.radii).toEqual([2, undefined, 10]);
    });

    it('colors and sizes together, from different columns', () => {
      const pct = number('pct', [10, 90], { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } });
      const data = frame({ colorBy: 'pct', sizeBy: 'used' }, [pct, number('used', [0, 10])]);

      expect(styles(data)).toEqual({ colors: [color('green'), color('red')], radii: [2, 10] });
    });
  });

  describe('caching', () => {
    it('gives the same arrays back while the column and its config are unchanged', () => {
      const pct = number('pct', [10, 90], { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } });
      const data = frame({ colorBy: 'pct', sizeBy: 'pct' }, [pct]);
      const result = frameToFeatureCollection(data);
      const first = featureStyles(data, result, theme)!;
      // A field config change elsewhere: new frame, field and config objects, the same values.
      const again = {
        ...data,
        fields: data.fields.map((field) => ({ ...field, config: JSON.parse(JSON.stringify(field.config)) })),
      };
      const second = featureStyles(again, result, theme)!;

      expect(second.colors).toBe(first.colors);
      expect(second.radii).toBe(first.radii);
    });

    it('gives the same arrays back for a reused conversion, after a refresh with the same data', () => {
      const pct = number('pct', [10, 90], { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } });
      const data = frame({ colorBy: 'pct' }, [pct]);
      const result = frameToFeatureCollection(data);
      const first = featureStyles(data, result, theme)!;
      // The panel reuses the conversion only when the new values equal the old (docs/phase_8.md).
      const refreshed = { ...data, fields: data.fields.map((field) => ({ ...field, values: [...field.values] })) };

      expect(featureStyles(refreshed, result, theme)!.colors).toBe(first.colors);
    });

    it('works them out again for a new conversion', () => {
      const pct = number('pct', [10, 90], { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } });
      const data = frame({ colorBy: 'pct' }, [pct]);
      const first = featureStyles(data, frameToFeatureCollection(data), theme)!;

      expect(featureStyles(data, frameToFeatureCollection(data), theme)!.colors).not.toBe(first.colors);
    });

    it('works them out again when the config changes', () => {
      const pct = number('pct', [10, 90], { thresholds: THRESHOLDS, color: { mode: FieldColorModeId.Thresholds } });
      const data = frame({ colorBy: 'pct' }, [pct]);
      const result = frameToFeatureCollection(data);
      const first = featureStyles(data, result, theme)!;
      const lower = {
        mode: ThresholdsMode.Absolute,
        steps: [
          { value: -Infinity, color: 'green' },
          { value: 5, color: 'red' },
        ],
      };
      data.fields[1] = { ...data.fields[1], config: { ...data.fields[1].config, thresholds: lower } };
      data.fields[1].display = undefined;

      expect(featureStyles(data, result, theme)!.colors).toEqual([color('red'), color('red')]);
      expect(first.colors).toEqual([color('green'), color('red')]);
    });
  });
});

describe('dataStyleFields', () => {
  it('finds the columns by name or display name', () => {
    const data = frame({ colorBy: 'Utilization', sizeBy: 'used' }, [
      number('pct', [1], { displayName: 'Utilization' }),
      number('used', [1]),
    ]);
    const fields = dataStyleFields(data, frameToFeatureCollection(data));

    expect(fields.colorField?.name).toBe('pct');
    expect(fields.sizeField?.name).toBe('used');
    expect(fields.problems).toEqual([]);
  });

  it('says why a column it can’t use has no effect, and leaves the layer as it is', () => {
    const name: Column = { name: 'name', type: FieldType.string, values: ['a'] };
    const data = frame({ colorBy: 'gone', sizeBy: 'name' }, [name]);
    const result = frameToFeatureCollection(data);

    expect(dataStyleFields(data, result).problems).toEqual([
      'Color by: no column named gone',
      "Size by: name isn't a number column",
    ]);
    expect(featureStyles(data, result, theme)).toBeUndefined();
  });
});
