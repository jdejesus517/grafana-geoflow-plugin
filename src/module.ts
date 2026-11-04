import { FieldConfigProperty, PanelPlugin } from '@grafana/data';
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
import { UrlEditor, UrlEditorSettings } from './panel/UrlEditor';

const BASEMAP = ['Basemap'];
const VIEW = ['Initial view'];
const TOOLTIP = ['Tooltip'];

export const plugin = new PanelPlugin<GeoFlowOptions, GeoFlowFieldConfig>(MapPanel)
  // Field options format tooltip values and give them data links (docs/phase_4.md, Design §1).
  // Options that nothing uses yet are hidden; Phase 5 may bring Color back for styling.
  .useFieldConfig({
    disableStandardOptions: [
      FieldConfigProperty.Min,
      FieldConfigProperty.Max,
      FieldConfigProperty.FieldMinMax,
      FieldConfigProperty.Color,
      FieldConfigProperty.Thresholds,
      FieldConfigProperty.Filterable,
      // Plugins can't build Grafana's actions yet (docs/architecture.md §7).
      FieldConfigProperty.Actions,
    ],
    useCustomConfig: (builder) =>
      builder.addBooleanSwitch({
        path: 'hideInTooltip',
        name: 'Hide in tooltip',
        description: "Leaves this field out of the map's tooltips. Its data links still show.",
        category: TOOLTIP,
        defaultValue: false,
      }),
  })
  .setPanelOptions((builder) =>
    builder
      .addRadio<BasemapKind, { options: Array<{ value: BasemapKind; label: string }> }>({
        path: 'basemap.kind',
        name: 'Basemap',
        category: BASEMAP,
        defaultValue: DEFAULT_OPTIONS.basemap.kind,
        settings: {
          options: [
            { value: 'osm', label: 'OpenStreetMap' },
            { value: 'raster', label: 'Custom tiles' },
            { value: 'style', label: 'Style URL' },
            { value: 'none', label: 'None' },
          ],
        },
      })
      .addCustomEditor<UrlEditorSettings, string>({
        id: 'basemap.tileUrl',
        path: 'basemap.tileUrl',
        name: 'Tile URL template',
        description: 'An XYZ raster tile URL with {z}, {x} and {y} placeholders.',
        category: BASEMAP,
        editor: UrlEditor,
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
      .addCustomEditor<UrlEditorSettings, string>({
        id: 'basemap.styleUrl',
        path: 'basemap.styleUrl',
        name: 'Style URL',
        description: 'A MapLibre style JSON. The style controls the whole basemap, including in dark theme.',
        category: BASEMAP,
        editor: UrlEditor,
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
        path: 'showSummary',
        name: 'Show data summary',
        description: 'Lists each query result and what GeoFlow made of it. Useful for checking a query.',
        defaultValue: DEFAULT_OPTIONS.showSummary,
      })
  );
