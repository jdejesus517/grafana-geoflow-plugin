import { FieldColorModeId, FieldConfigProperty, FieldType, PanelPlugin, StandardEditorProps } from '@grafana/data';
import { DASH_PATTERN_EXAMPLE, LineStyleOption, MAP_STYLE_RANGES, dashPatternProblem } from './adapter';
import { CheckedTextEditor, CheckedTextEditorSettings } from './panel/CheckedTextEditor';
import { PROVIDERS, ProviderId, apiKeyProblem, isProviderId } from './panel/basemapPresets';
import { LayersEditor } from './panel/LayersEditor';
import { MapPanel } from './panel/MapPanel';
import { PresetEditor } from './panel/PresetEditor';
import { ViewEditor } from './panel/ViewEditor';
import {
  BasemapKind,
  DEFAULT_OPTIONS,
  FIT_RANGES,
  GeoFlowFieldConfig,
  GeoFlowOptions,
  TooltipMode,
  ViewMode,
  apiKeyPath,
  migrateOptions,
  optional,
  styleUrlProblem,
  tileUrlProblem,
} from './panel/options';

const LAYERS = ['Layers'];
const BASEMAP = ['Basemap'];
const VIEW = ['View'];
const TOOLTIP = ['Tooltip'];
const MAP_STYLE = ['Map style'];

const BASEMAP_OPTIONS: Array<{ value: BasemapKind; label: string; description?: string }> = [
  { value: 'osm', label: 'OpenStreetMap' },
  { value: 'openfreemap', label: 'OpenFreeMap', description: 'Vector styles, no key' },
  { value: 'stadia', label: 'Stadia Maps', description: 'Vector styles, key optional' },
  { value: 'maptiler', label: 'MapTiler', description: 'Vector styles, your API key' },
  { value: 'thunderforest', label: 'Thunderforest', description: 'Raster tiles, your API key' },
  { value: 'raster', label: 'Custom tiles' },
  { value: 'style', label: 'Style URL' },
  { value: 'none', label: 'None' },
];

/** The API key option of a preset provider that takes one (docs/phase_12.md, Design §3). */
function apiKeyOption(provider: ProviderId) {
  const { label, key, site } = PROVIDERS[provider];
  return {
    id: `basemap.${apiKeyPath(provider)}`,
    path: `basemap.${apiKeyPath(provider)}`,
    name: key === 'optional' ? 'API key (optional)' : 'API key',
    description:
      `From your ${label} account (${site}). It's saved in the dashboard and sent to every viewer's browser: ` +
      `restrict it to this Grafana's domain in your account.` +
      (key === 'optional' ? ' Not needed on domains registered with Stadia Maps.' : ''),
    category: BASEMAP,
    editor: CheckedTextEditor,
    settings: { validate: (text: string | undefined) => apiKeyProblem(PROVIDERS[provider], text) },
    showIf: (options: GeoFlowOptions) => options.basemap?.kind === provider,
  };
}

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
      // The Layers list comes first: it's the panel's content (docs/phase_7.md, Design §4).
      .addCustomEditor({
        id: 'layers',
        path: 'layers',
        name: '',
        description: 'Top layer first. Style each layer with field overrides on its query.',
        category: LAYERS,
        editor: LayersEditor,
        defaultValue: DEFAULT_OPTIONS.layers,
      })
      // Saved so another mode can be added without a migration (LayerBinding); one mode isn't worth showing.
      .addCustomEditor({
        id: 'layerBinding',
        path: 'layerBinding',
        name: 'Layer binding',
        category: LAYERS,
        editor: () => null,
        defaultValue: DEFAULT_OPTIONS.layerBinding,
        showIf: () => false,
      })
      // A select: as radio buttons, the labels were cut off (docs/phase_4.md, Findings).
      .addSelect<BasemapKind, { options: Array<{ value: BasemapKind; label: string }> }>({
        path: 'basemap.kind',
        name: 'Basemap',
        category: BASEMAP,
        defaultValue: DEFAULT_OPTIONS.basemap.kind,
        settings: { options: BASEMAP_OPTIONS },
      })
      .addCustomEditor({
        id: 'basemap.preset',
        path: 'basemap.preset',
        name: '',
        category: BASEMAP,
        editor: PresetEditor,
        showIf: (options) => isProviderId(options.basemap?.kind),
      })
      .addCustomEditor<CheckedTextEditorSettings, string | undefined>(apiKeyOption('stadia'))
      .addCustomEditor<CheckedTextEditorSettings, string | undefined>(apiKeyOption('maptiler'))
      .addCustomEditor<CheckedTextEditorSettings, string | undefined>(apiKeyOption('thunderforest'))
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
        id: 'basemap.darkTileUrl',
        path: 'basemap.darkTileUrl',
        name: 'Dark theme tile URL',
        description: 'Optional tiles for dark theme, used as they are. Without them, the tiles above are dimmed.',
        category: BASEMAP,
        editor: CheckedTextEditor,
        settings: { placeholder: 'https://tiles.example.com/dark/{z}/{x}/{y}.png', validate: optional(tileUrlProblem) },
        showIf: (options) => options.basemap?.kind === 'raster',
      })
      .addCustomEditor<CheckedTextEditorSettings, string | undefined>({
        id: 'basemap.styleUrl',
        path: 'basemap.styleUrl',
        name: 'Style URL',
        description: "A MapLibre style JSON. The style controls the whole basemap; it isn't dimmed in dark theme.",
        category: BASEMAP,
        editor: CheckedTextEditor,
        settings: { placeholder: 'https://tiles.example.com/styles/basic/style.json', validate: styleUrlProblem },
        showIf: (options) => options.basemap?.kind === 'style',
      })
      .addCustomEditor<CheckedTextEditorSettings, string | undefined>({
        id: 'basemap.darkStyleUrl',
        path: 'basemap.darkStyleUrl',
        name: 'Dark theme style URL',
        description: 'Optional style for dark theme.',
        category: BASEMAP,
        editor: CheckedTextEditor,
        settings: {
          placeholder: 'https://tiles.example.com/styles/dark/style.json',
          validate: optional(styleUrlProblem),
        },
        showIf: (options) => options.basemap?.kind === 'style',
      })
      .addRadio<ViewMode, { options: Array<{ value: ViewMode; label: string }> }>({
        path: 'view.mode',
        name: 'View mode',
        description: 'Fit to data frames the visible layers. Without data, the map shows the fixed view.',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.mode,
        settings: {
          options: [
            { value: 'fixed', label: 'Fixed' },
            { value: 'fit', label: 'Fit to data' },
          ],
        },
      })
      .addCustomEditor({
        id: 'view.current',
        path: 'view',
        name: 'Current view',
        description: "Saves the map's view as the fixed view.",
        category: VIEW,
        editor: ViewEditor,
      })
      .addNumberInput({
        path: 'view.lat',
        name: 'Latitude',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.lat,
        settings: { min: -85, max: 85 },
        showIf: isFixed,
      })
      .addNumberInput({
        path: 'view.lon',
        name: 'Longitude',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.lon,
        settings: { min: -180, max: 180 },
        showIf: isFixed,
      })
      .addNumberInput({
        path: 'view.zoom',
        name: 'Zoom',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.zoom,
        settings: { min: 0, max: 22 },
        showIf: isFixed,
      })
      .addBooleanSwitch({
        path: 'view.fitOnRefresh',
        name: 'Fit on refresh',
        description:
          'Fits the data again on every refresh, undoing any panning: for wall displays. Off, the map fits when the panel loads.',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.fitOnRefresh,
        showIf: (options) => !isFixed(options),
      })
      .addNumberInput({
        path: 'view.padding',
        name: 'Padding',
        description: 'Room around the data, in pixels.',
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.padding,
        settings: { ...FIT_RANGES.padding, integer: true },
        showIf: (options) => !isFixed(options),
      })
      .addNumberInput({
        path: 'view.maxZoom',
        name: 'Max zoom',
        description: "The closest a fit zooms in, so a single feature doesn't fill the map.",
        category: VIEW,
        defaultValue: DEFAULT_OPTIONS.view.maxZoom,
        settings: FIT_RANGES.maxZoom,
        showIf: (options) => !isFixed(options),
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
        path: 'showWarnings',
        name: 'Show warnings',
        description: 'A small warning on the map when rows are skipped or a column is missing. Viewers see it too.',
        defaultValue: DEFAULT_OPTIONS.showWarnings,
      })
      .addBooleanSwitch({
        path: 'showSummary',
        name: 'Show data summary',
        description: 'Lists each query result and what GeoFlow made of it. Useful for checking a query.',
        defaultValue: DEFAULT_OPTIONS.showSummary,
      })
  )
  // Panels saved before Phase 8 keep their fixed view (docs/phase_8.md, Design §2).
  .setMigrationHandler((panel) => migrateOptions(panel.options) as GeoFlowOptions);

/** A view saved before Phase 8 has no mode, and is fixed. */
function isFixed(options: GeoFlowOptions): boolean {
  return options.view?.mode !== 'fit';
}
