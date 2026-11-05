import { DataFrame, FieldColorModeId, FieldConfig, FieldType, createTheme, toDataFrame } from '@grafana/data';
import { DEFAULT_LAYER_STYLE } from '../../engine';
import { frameToFeatureCollection } from '../frameToFeatureCollection';
import { MapStyleConfig, layerStyle } from '../layerStyle';

const theme = createTheme();
const palette = theme.visualization.palette.map((name) => theme.visualization.getColorByName(name));
const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;

/** A frame whose geometry field has `config`, as Grafana leaves it after applying field config. */
function frame(
  config: FieldConfig<MapStyleConfig> = {},
  { refId = 'A', name }: { refId?: string; name?: string } = {}
) {
  const data: DataFrame = toDataFrame({
    refId,
    name,
    fields: [
      { name: 'name', type: FieldType.string, values: ['a'] },
      { name: 'geometry', type: FieldType.string, values: [point(-78.78)], config },
    ],
  });
  return { frame: data, result: frameToFeatureCollection(data) };
}

function styleOf(config: FieldConfig<MapStyleConfig> = {}, layerIndex = 0, options = {}) {
  const { frame: data, result } = frame(config, options);
  return layerStyle(data, result, layerIndex, theme);
}

describe('layerStyle', () => {
  it('draws as before Phase 5 when nothing is set', () => {
    expect(styleOf()).toEqual({
      ...DEFAULT_LAYER_STYLE,
      color: palette[0],
      outlineColor: theme.colors.background.primary,
    });
  });

  it('reads the Map style options from the geometry field', () => {
    const style = styleOf({
      custom: { opacity: 50, fillOpacity: 80, lineWidth: 6, pointSize: 14, lineStyle: 'dash' },
    });

    expect(style).toMatchObject({
      opacity: 0.5,
      fillOpacity: 0.8,
      lineWidth: 6,
      pointRadius: 7,
      lineStyle: { kind: 'dash' },
    });
  });

  it('reads the options from a Feature column, which is the geometry field too', () => {
    const feature = JSON.stringify({ type: 'Feature', geometry: JSON.parse(point(-78.78)), properties: {} });
    const data = toDataFrame({
      fields: [{ name: 'feature', type: FieldType.string, values: [feature], config: { custom: { lineWidth: 7 } } }],
    });

    expect(layerStyle(data, frameToFeatureCollection(data), 0, theme).lineWidth).toBe(7);
  });

  it('clamps numbers to their range', () => {
    const style = styleOf({ custom: { opacity: 150, fillOpacity: -5, lineWidth: 0, pointSize: 99 } });

    expect(style).toMatchObject({ opacity: 1, fillOpacity: 0, lineWidth: 1, pointRadius: 20 });
  });

  it('takes the default for values that aren’t numbers', () => {
    const custom = { opacity: '50', lineWidth: NaN, pointSize: null } as unknown as MapStyleConfig;

    expect(styleOf({ custom })).toMatchObject({ opacity: 1, lineWidth: 2, pointRadius: 5 });
  });

  it('draws a custom pattern, and a solid line when the pattern can’t be used', () => {
    expect(styleOf({ custom: { lineStyle: 'custom', dashPattern: '8, 4, 2' } }).lineStyle).toEqual({
      kind: 'custom',
      pattern: [8, 4, 2, 8, 4, 2],
    });
    expect(styleOf({ custom: { lineStyle: 'custom', dashPattern: '12, x' } }).lineStyle).toEqual({ kind: 'solid' });
    expect(styleOf({ custom: { lineStyle: 'custom' } }).lineStyle).toEqual({ kind: 'solid' });
    expect(styleOf({ custom: { lineStyle: 'wavy' as never } }).lineStyle).toEqual({ kind: 'solid' });
  });

  describe('color', () => {
    it('takes palette colors by layer position', () => {
      const classic = { color: { mode: FieldColorModeId.PaletteClassic } };

      expect([0, 1, 2].map((i) => styleOf(classic, i).color)).toEqual(palette.slice(0, 3));
      expect(styleOf(classic, palette.length).color).toBe(palette[0]);
    });

    it('uses a single color', () => {
      const style = styleOf({ color: { mode: FieldColorModeId.Fixed, fixedColor: 'red' } }, 3);

      expect(style.color).toBe(theme.visualization.getColorByName('red'));
    });

    it('hashes the layer’s name for By name, not the geometry column’s', () => {
      const byName = { color: { mode: FieldColorModeId.PaletteClassicByName } };
      const colors = ['A', 'B', 'C', 'D'].map((refId) => styleOf(byName, 0, { refId }).color);

      expect(new Set(colors).size).toBeGreaterThan(1);
      // The same name always gets the same color, wherever the layer is.
      expect(styleOf(byName, 5, { refId: 'B' }).color).toBe(colors[1]);
      // A named frame is hashed by its name.
      expect(styleOf(byName, 0, { refId: 'A', name: 'Cables' }).color).toBe(
        styleOf(byName, 0, { refId: 'Z', name: 'Cables' }).color
      );
    });

    it('falls back to the palette for by-value schemes, which aren’t offered', () => {
      const style = styleOf({ color: { mode: FieldColorModeId.Thresholds } }, 1);

      expect(style.color).toBe(palette[1]);
    });
  });
});
