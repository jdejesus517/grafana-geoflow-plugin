import { FieldColorModeId, FieldConfigProperty, FieldType, PanelPlugin, StandardEditorProps } from '@grafana/data';
import { DASH_PATTERN_EXAMPLE, LineStyleOption, MAP_STYLE_RANGES, dashPatternProblem } from './adapter';
import { CheckedTextEditor, CheckedTextEditorSettings } from './panel/CheckedTextEditor';
import { MapPanel } from './panel/MapPanel';
import {
  BasemapKind,
  DEFAULT_OPTIONS,
  GeoFlowFieldConfig,
  GeoFlowOptions,
  TooltipMode,
  styleUrlProblem,
  tileUrlProblem,
} from './panel/options';

const BASEMAP = ['Basemap'];
const VIEW = ['Initial view'];
const TOOLTIP = ['Tooltip'];
const MAP_STYLE = ['Map style'];

const BASEMAP_OPTIONS: Array<{ value: BasemapKind; label: string }> = [
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'raster', label: 'Custom tiles' },
  { value: 'style', label: 'Style URL' },
  { value: 'none', label: 'None' },
];

const LINE_STYLE_OPTIONS: Array<{ value: LineStyleOption; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dash', label: 'Dashed' },
  { value: 'dot', label: 'Dotted' },
  { value: 'custom', label: 'Custom' },
];

/** A Map style slider: its range and default from MAP_STYLE_RANGES. */
function styleSlider(
  path: keyof typeof MAP_STYLE_RANGES,
  name: string,
  description: string,
  unit: string,
  showIf?: (config: GeoFlowFieldConfig) => boolean
) {
  const { min, max, default: defaultValue } = MAP_STYLE_RANGES[path];
  return {
    path,
    name,
    description: `${description} (${unit})`,
    category: MAP_STYLE,
    defaultValue,
    settings: { min, max, step: 1 },
    showIf,
  };
}

export const plugin = new PanelPlugin<GeoFlowOptions, GeoFlowFieldConfig>(MapPanel)
  // Field options format tooltip values and give them data links (docs/phase_4.md, Design §1),
  // style each query's layer from its geometry field (docs/phase_5.md, Design §1), and color and
  // size features by a column's value (docs/phase_6.md, Design §1). Options that nothing uses
  // are hidden.
  .useFieldConfig({
    disableStandardOptions: [
      // Color by and Size by use the column's own range: its Min and Max, or its data's.
      FieldConfigProperty.FieldMinMax,
      FieldConfigProperty.Filterable,
      // Plugins can't build Grafana's actions yet (docs/architecture.md §7).
      FieldConfigProperty.Actions,
    ],
    standardOptions: {
      [FieldConfigProperty.Color]: {
        defaultValue: { mode: FieldColorModeId.PaletteClassic },
        // By-value schemes color features through a Color by column. On the geometry column
        // itself, they fall back to the palette.
        settings: { byValueSupport: true, bySeriesSupport: true, preferThresholdsMode: false },
      },
    },
    useCustomConfig: (builder) =>
      builder
        .addSliderInput(styleSlider('opacity', 'Opacity', 'The whole layer: lines, points and fills', '%'))
        .addSliderInput(styleSlider('fillOpacity', 'Fill opacity', 'Polygon interiors, before Opacity', '%'))
        .addSliderInput(styleSlider('lineWidth', 'Line width', 'Lines. Polygon outlines stay 1 px', 'px'))
        // A select: four radio buttons don't fit the options pane (docs/phase_5.md, step 5.5).
        .addSelect<LineStyleOption, { options: Array<{ value: LineStyleOption; label: string }> }>({
          path: 'lineStyle',
          name: 'Line style',
          description: 'Lines. Polygon outlines stay solid.',
          category: MAP_STYLE,
          defaultValue: 'solid',
          settings: { options: LINE_STYLE_OPTIONS },
        })
        .addGenericEditor<CheckedTextEditorSettings>(
          {
            path: 'dashPattern',
            name: 'Dash pattern',
            description: `Dash and gap lengths in pixels, separated by commas, ${DASH_PATTERN_EXAMPLE}.`,
            category: MAP_STYLE,
            settings: { placeholder: '8, 4', validate: dashPatternProblem },
            showIf: (config) => config.lineStyle === 'custom',
          },
          // addGenericEditor types the editor's props with the settings type as the value type.
          CheckedTextEditor as unknown as (
            props: StandardEditorProps<CheckedTextEditorSettings>
          ) => ReturnType<typeof CheckedTextEditor>
        )
        .addSliderInput(styleSlider('pointSize', 'Point size', 'Point diameter', 'px'))
        .addFieldNamePicker({
          path: 'colorBy',
          name: 'Color by',
          description:
            "Colors the features by this column's value, with its thresholds, color scheme and value mappings.",
          category: MAP_STYLE,
          settings: { placeholderText: 'None', isClearable: true },
        })
        .addFieldNamePicker({
          path: 'sizeBy',
          name: 'Size by',
          description: "Sizes the points by this number column's value, across its Min and Max.",
          category: MAP_STYLE,
          settings: {
            placeholderText: 'None',
            isClearable: true,
            filter: (field) => field.type === FieldType.number,
            noFieldsMessage: 'No number columns',
          },
        })
        .addSliderInput(
          styleSlider('sizeMin', 'Min point size', 'Point diameter at Min', 'px', (config) => !!config.sizeBy)
        )
        .addSliderInput(
          styleSlider('sizeMax', 'Max point size', 'Point diameter at Max', 'px', (config) => !!config.sizeBy)
        )
        .addBooleanSwitch({
          path: 'hideInTooltip',
          name: 'Hide in tooltip',
          description: "Leaves this field out of the map's tooltips. Its data links still show.",
          category: TOOLTIP,
          defaultValue: false,
        }),
  })
  .setPanelOptions((builder) =>
    builder
      // A select: as radio buttons, the labels were cut off (docs/phase_4.md, Findings).
      .addSelect<BasemapKind, { options: Array<{ value: BasemapKind; label: string }> }>({
        path: 'basemap.kind',
        name: 'Basemap',
        category: BASEMAP,
        defaultValue: DEFAULT_OPTIONS.basemap.kind,
        settings: { options: BASEMAP_OPTIONS },
      })
      .addCustomEditor<CheckedTextEditorSettings, string | undefined>({
        id: 'basemap.tileUrl',
        path: 'basemap.tileUrl',
        name: 'Tile URL template',
        description: 'An XYZ raster tile URL with {z}, {x} and {y} placeholders.',
        category: BASEMAP,
        editor: CheckedTextEditor,
        settings: { placeholder: 'https://tiles.example.com/{z}/{x}/{y}.png', validate: tileUrlProblem },
        showIf: (options) => options.basemap?.kind === 'raster',
      })
      .addTextInput({
        path: 'basemap.tileAttribution',
        name: 'Tile attribution',
        description: 'Shown as plain text in the map corner. Most tile providers require one.',
        category: BASEMAP,
        settings: { placeholder: '© Example tile provider' },
        showIf: (options) => options.basemap?.kind === 'raster',
      })
      .addCustomEditor<CheckedTextEditorSettings, string | undefined>({
        id: 'basemap.styleUrl',
        path: 'basemap.styleUrl',
        name: 'Style URL',
        description: 'A MapLibre style JSON. The style controls the whole basemap, including in dark theme.',
        category: BASEMAP,
        editor: CheckedTextEditor,
        settings: { placeholder: 'https://tiles.example.com/styles/basic/style.json', validate: styleUrlProblem },
        showIf: (options) => options.basemap?.kind === 'style',
      })
      .addNumberInput({
        path: 'view.lat',
        name: 'Latitude',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.lat,
        settings: { min: -85, max: 85 },
      })
      .addNumberInput({
        path: 'view.lon',
        name: 'Longitude',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.lon,
        settings: { min: -180, max: 180 },
      })
      .addNumberInput({
        path: 'view.zoom',
        name: 'Zoom',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.zoom,
        settings: { min: 0, max: 22 },
      })
      .addRadio<TooltipMode, { options: Array<{ value: TooltipMode; label: string }> }>({
        path: 'tooltip',
        name: 'Tooltip',
        description:
          'Hover: hovering a feature shows its tooltip, and clicking pins it. Click: only clicking shows one.',
        category: TOOLTIP,
        defaultValue: DEFAULT_OPTIONS.tooltip,
        settings: {
          options: [
            { value: 'hover', label: 'Hover' },
            { value: 'click', label: 'Click' },
            { value: 'off', label: 'Off' },
          ],
        },
      })
      .addBooleanSwitch({
        path: 'legend.show',
        name: 'Legend',
        description: 'Shows the colors of layers colored by a column, over the map.',
        defaultValue: DEFAULT_OPTIONS.legend.show,
      })
      .addBooleanSwitch({
        path: 'showSummary',
        name: 'Show data summary',
        description: 'Lists each query result and what GeoFlow made of it. Useful for checking a query.',
        defaultValue: DEFAULT_OPTIONS.showSummary,
      })
  );
