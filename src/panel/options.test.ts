import {
  basemapFromOptions,
  fitFromOptions,
  migrateOptions,
  optional,
  styleUrlProblem,
  tileUrlProblem,
  tooltipMode,
  viewFromOptions,
} from './options';

const TILES = 'https://tiles.example.com/{z}/{x}/{y}.png';

describe('tooltipMode', () => {
  it.each(['hover', 'click', 'off'] as const)('keeps %s', (mode) => {
    expect(tooltipMode({ tooltip: mode })).toBe(mode);
  });

  it('defaults to hover for dashboards saved before the option, and for unknown values', () => {
    expect(tooltipMode(undefined)).toBe('hover');
    expect(tooltipMode({} as never)).toBe('hover');
    expect(tooltipMode({ tooltip: 'always' as never })).toBe('hover');
  });
});

describe('basemapFromOptions', () => {
  it('defaults to OpenStreetMap', () => {
    expect(basemapFromOptions(undefined)).toEqual({ kind: 'osm' });
  });

  it('maps OpenStreetMap and None', () => {
    expect(basemapFromOptions({ kind: 'osm', tileUrl: TILES })).toEqual({ kind: 'osm' });
    expect(basemapFromOptions({ kind: 'none' })).toEqual({ kind: 'none' });
  });

  it('maps custom tiles, trimming the URL and attribution', () => {
    expect(basemapFromOptions({ kind: 'raster', tileUrl: ` ${TILES} `, tileAttribution: ' © Example ' })).toEqual({
      kind: 'raster',
      tiles: [TILES],
      attribution: '© Example',
    });
    expect(basemapFromOptions({ kind: 'raster', tileUrl: TILES })).toMatchObject({ attribution: '' });
  });

  it('uses a dark tile URL in dark theme only, without dimming', () => {
    const basemap = {
      kind: 'raster' as const,
      tileUrl: TILES,
      darkTileUrl: ' https://dark.example.com/{z}/{x}/{y}.png ',
    };

    expect(basemapFromOptions(basemap, true)).toEqual({
      kind: 'raster',
      tiles: ['https://dark.example.com/{z}/{x}/{y}.png'],
      attribution: '',
      dimInDark: false,
    });
    expect(basemapFromOptions(basemap, false)).toEqual({ kind: 'raster', tiles: [TILES], attribution: '' });
  });

  it('uses a dark style URL in dark theme only', () => {
    const basemap = { kind: 'style' as const, styleUrl: 'https://s/light.json', darkStyleUrl: 'https://s/dark.json' };

    expect(basemapFromOptions(basemap, true)).toEqual({ kind: 'style', url: 'https://s/dark.json' });
    expect(basemapFromOptions(basemap, false)).toEqual({ kind: 'style', url: 'https://s/light.json' });
  });

  it('ignores an empty or invalid dark URL, keeping the light one', () => {
    expect(basemapFromOptions({ kind: 'raster', tileUrl: TILES, darkTileUrl: ' ' }, true)).toEqual({
      kind: 'raster',
      tiles: [TILES],
      attribution: '',
    });
    expect(basemapFromOptions({ kind: 'raster', tileUrl: TILES, darkTileUrl: 'https://t/x.png' }, true)).toMatchObject({
      tiles: [TILES],
    });
    expect(
      basemapFromOptions({ kind: 'style', styleUrl: 'https://s/light.json', darkStyleUrl: 'ftp://s/dark.json' }, true)
    ).toEqual({ kind: 'style', url: 'https://s/light.json' });
  });

  it('ignores a dark URL without a usable light one', () => {
    expect(basemapFromOptions({ kind: 'raster', tileUrl: '', darkTileUrl: TILES }, true)).toEqual({ kind: 'none' });
  });

  it('maps a style URL', () => {
    expect(basemapFromOptions({ kind: 'style', styleUrl: 'https://s.example.com/style.json' })).toEqual({
      kind: 'style',
      url: 'https://s.example.com/style.json',
    });
  });

  it.each([
    ['empty tile URL', { kind: 'raster' as const, tileUrl: '' }],
    ['tile URL without placeholders', { kind: 'raster' as const, tileUrl: 'https://tiles.example.com/tile.png' }],
    ['missing style URL', { kind: 'style' as const }],
    ['non-HTTP style URL', { kind: 'style' as const, styleUrl: 'javascript:alert(1)' }],
    ['unknown kind from an old or hand-edited dashboard', { kind: 'wms' as never }],
  ])('falls back to none for %s', (_, basemap) => {
    expect(basemapFromOptions(basemap)).toEqual({ kind: 'none' });
  });
});

describe('tileUrlProblem', () => {
  it('accepts absolute and same-origin templates', () => {
    expect(tileUrlProblem(TILES)).toBeUndefined();
    expect(tileUrlProblem('/tiles/{z}/{x}/{y}.png')).toBeUndefined();
  });

  it('names the missing placeholders', () => {
    expect(tileUrlProblem('https://t.example.com/{z}/tile.png')).toMatch(/^The tile URL needs \{x\}, \{y\}/);
  });

  it('rejects empty and non-HTTP URLs', () => {
    expect(tileUrlProblem('  ')).toBe('Enter a tile URL template');
    expect(tileUrlProblem('ftp://t/{z}/{x}/{y}.png')).toBe('The tile URL must start with http://, https:// or /');
  });
});

describe('styleUrlProblem', () => {
  it('accepts HTTP URLs only', () => {
    expect(styleUrlProblem('https://s.example.com/style.json')).toBeUndefined();
    expect(styleUrlProblem(undefined)).toBe('Enter a style URL');
    expect(styleUrlProblem('data:application/json,{}')).toBe('The style URL must start with http://, https:// or /');
  });
});

describe('viewFromOptions', () => {
  it('defaults to the whole world', () => {
    expect(viewFromOptions(undefined)).toEqual({ center: [0, 20], zoom: 1 });
  });

  it('converts lat/lon to a lon/lat center', () => {
    expect(viewFromOptions({ lat: 35.79, lon: -78.78, zoom: 15 })).toEqual({ center: [-78.78, 35.79], zoom: 15 });
  });

  it('clamps out-of-range values and replaces non-numbers', () => {
    expect(viewFromOptions({ lat: 95, lon: -200, zoom: 30 })).toEqual({ center: [-180, 85], zoom: 22 });
    expect(viewFromOptions({ lat: NaN, lon: undefined, zoom: null as never })).toEqual({ center: [0, 20], zoom: 1 });
  });
});

describe('fitFromOptions', () => {
  const view = { lat: 0, lon: 0, zoom: 1 };

  it('is undefined for a fixed view, and for one saved without a mode', () => {
    expect(fitFromOptions({ ...view, mode: 'fixed' })).toBeUndefined();
    expect(fitFromOptions(view)).toBeUndefined();
    expect(fitFromOptions(undefined)).toBeUndefined();
  });

  it('fills in the defaults', () => {
    expect(fitFromOptions({ ...view, mode: 'fit' })).toEqual({ padding: 40, maxZoom: 17, onRefresh: false });
  });

  it('clamps out-of-range values and replaces non-numbers', () => {
    expect(fitFromOptions({ mode: 'fit', padding: 500, maxZoom: -3, fitOnRefresh: true })).toEqual({
      padding: 200,
      maxZoom: 0,
      onRefresh: true,
    });
    expect(fitFromOptions({ mode: 'fit', padding: NaN, maxZoom: null as never })).toMatchObject({
      padding: 40,
      maxZoom: 17,
    });
  });
});

describe('migrateOptions', () => {
  it('keeps the fixed view of a panel saved before Phase 8', () => {
    expect(migrateOptions({ view: { lat: 35.78, lon: -78.78, zoom: 14 } as never, tooltip: 'click' })).toEqual({
      view: { mode: 'fixed', lat: 35.78, lon: -78.78, zoom: 14 },
      tooltip: 'click',
    });
    expect(migrateOptions(undefined)).toEqual({ view: { mode: 'fixed' } });
  });

  it('leaves a panel with a view mode alone', () => {
    const options = { view: { mode: 'fit' as const, lat: 0, lon: 0, zoom: 1 } };

    expect(migrateOptions(options)).toBe(options);
  });
});

describe('optional', () => {
  it('accepts an empty URL, and checks any other', () => {
    const check = optional(tileUrlProblem);

    expect(check(undefined)).toBeUndefined();
    expect(check('  ')).toBeUndefined();
    expect(check(TILES)).toBeUndefined();
    expect(check('https://t/x.png')).toMatch(/needs \{z\}/);
  });
});
