import { PanelPlugin } from '@grafana/data';
import { MapPanel } from './panel/MapPanel';
import { BasemapKind, DEFAULT_OPTIONS, GeoFlowOptions, styleUrlProblem, tileUrlProblem } from './panel/options';
import { UrlEditor, UrlEditorSettings } from './panel/UrlEditor';

const BASEMAP = ['Basemap'];
const VIEW = ['Initial view'];

export const plugin = new PanelPlugin<GeoFlowOptions>(MapPanel).useFieldConfig().setPanelOptions((builder) =>
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
    .addBooleanSwitch({
      path: 'showSummary',
      name: 'Show data summary',
      description: 'Lists each query result and what GeoFlow made of it. Useful for checking a query.',
      defaultValue: DEFAULT_OPTIONS.showSummary,
    })
);
