import type { StyleSpecification } from 'maplibre-gl';
import {
  BACKGROUND_LAYER_ID,
  BASEMAP_RASTER_LAYER_ID,
  BASEMAP_SOURCE_ID,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  basemapLogo,
  basemapRequestUrl,
  basemapStyle,
  rasterPaint,
} from '../basemapStyle';
import { BasemapSpec, EngineTheme } from '../types';

const light: EngineTheme = { dark: false, background: '#ffffff' };
const dark: EngineTheme = { dark: true, background: '#111217' };

function asStyle(style: StyleSpecification | string): StyleSpecification {
  if (typeof style === 'string') {
    throw new Error(`expected an inline style, got URL ${style}`);
  }
  return style;
}

describe('basemapStyle', () => {
  describe('osm', () => {
    const style = asStyle(basemapStyle({ kind: 'osm' }, light));

    it('uses the OSM tile server with its attribution and max zoom', () => {
      expect(style.sources[BASEMAP_SOURCE_ID]).toEqual({
        type: 'raster',
        tiles: [OSM_TILE_URL],
        tileSize: 256,
        maxzoom: 19,
        attribution: OSM_ATTRIBUTION,
      });
      expect(OSM_ATTRIBUTION).toContain('© OpenStreetMap contributors');
      expect(OSM_ATTRIBUTION).toContain('https://www.openstreetmap.org/copyright');
    });

    it('draws the theme background under the raster layer', () => {
      expect(style.layers.map((l) => l.id)).toEqual([BACKGROUND_LAYER_ID, BASEMAP_RASTER_LAYER_ID]);
      expect(style.layers[0]).toMatchObject({ type: 'background', paint: { 'background-color': '#ffffff' } });
      expect(style.layers[1]).toMatchObject({ type: 'raster', source: BASEMAP_SOURCE_ID });
    });

    it('does not dim custom tiles made for dark theme', () => {
      const tiles = { kind: 'raster' as const, tiles: ['https://t/{z}/{x}/{y}.png'], attribution: '' };

      expect(asStyle(basemapStyle({ ...tiles, dimInDark: false }, dark)).layers[1]).toMatchObject({
        paint: rasterPaint(light),
      });
      expect(asStyle(basemapStyle(tiles, dark)).layers[1]).toMatchObject({ paint: rasterPaint(dark) });
    });

    it('dims the tiles in dark theme only', () => {
      const darkStyle = asStyle(basemapStyle({ kind: 'osm' }, dark));

      expect(style.layers[1]).toMatchObject({ paint: rasterPaint(light) });
      expect(darkStyle.layers[1]).toMatchObject({ paint: rasterPaint(dark) });
      expect(darkStyle.layers[0]).toMatchObject({ paint: { 'background-color': '#111217' } });
    });
  });

  describe('raster', () => {
    it('uses the custom tiles, attribution and max zoom', () => {
      const style = asStyle(
        basemapStyle(
          {
            kind: 'raster',
            tiles: ['https://tiles.example.com/{z}/{x}/{y}.png'],
            attribution: '© Example',
            maxZoom: 17,
          },
          light
        )
      );

      expect(style.sources[BASEMAP_SOURCE_ID]).toEqual({
        type: 'raster',
        tiles: ['https://tiles.example.com/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 17,
        attribution: '© Example',
      });
    });

    it('leaves out an empty attribution and an unset max zoom', () => {
      const style = asStyle(
        basemapStyle({ kind: 'raster', tiles: ['https://t/{z}/{x}/{y}.png'], attribution: '' }, light)
      );

      expect(style.sources[BASEMAP_SOURCE_ID]).not.toHaveProperty('attribution');
      expect(style.sources[BASEMAP_SOURCE_ID]).not.toHaveProperty('maxzoom');
    });

    it('shows a custom attribution as text, not HTML', () => {
      const style = asStyle(
        basemapStyle(
          { kind: 'raster', tiles: ['https://t/{z}/{x}/{y}.png'], attribution: '<img src=x onerror="alert(1)"> & Co' },
          light
        )
      );

      expect(style.sources[BASEMAP_SOURCE_ID]).toMatchObject({
        attribution: '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Co',
      });
    });

    it("shows a preset's attribution as HTML, links and all", () => {
      const attribution = '<a href="https://www.thunderforest.com/">© Thunderforest</a>';
      const style = asStyle(
        basemapStyle(
          { kind: 'raster', tiles: ['https://t/{z}/{x}/{y}.png'], attribution, attributionHtml: true },
          light
        )
      );

      expect(style.sources[BASEMAP_SOURCE_ID]).toMatchObject({ attribution });
    });
  });

  it('passes a style URL through untouched', () => {
    expect(basemapStyle({ kind: 'style', url: 'https://example.com/style.json' }, dark)).toBe(
      'https://example.com/style.json'
    );
  });

  it('draws only the theme background for none', () => {
    expect(basemapStyle({ kind: 'none' }, dark)).toEqual({
      version: 8,
      sources: {},
      layers: [{ id: BACKGROUND_LAYER_ID, type: 'background', paint: { 'background-color': '#111217' } }],
    });
  });
});

describe('basemapRequestUrl', () => {
  const spec: BasemapSpec = {
    kind: 'style',
    url: 'https://tiles.example.com/styles/a.json',
    requestParams: { host: 'tiles.example.com', params: { api_key: 'k1' } },
  };

  it("adds the parameters to requests to the basemap's host", () => {
    expect(basemapRequestUrl(spec, 'https://tiles.example.com/data/7/36/50.pbf')).toBe(
      'https://tiles.example.com/data/7/36/50.pbf?api_key=k1'
    );
    expect(basemapRequestUrl(spec, 'https://tiles.example.com/fonts/Noto/0-255.pbf?v=2')).toBe(
      'https://tiles.example.com/fonts/Noto/0-255.pbf?v=2&api_key=k1'
    );
  });

  it('replaces a parameter the URL already has', () => {
    expect(basemapRequestUrl(spec, 'https://tiles.example.com/a?api_key=old')).toBe(
      'https://tiles.example.com/a?api_key=k1'
    );
  });

  it('leaves other hosts alone, subdomains and the plugin itself included', () => {
    for (const url of [
      'https://other.example.com/a.pbf',
      'https://cdn.tiles.example.com/a.pbf',
      'http://localhost:3000/public/plugins/x/worker.js',
    ]) {
      expect(basemapRequestUrl(spec, url)).toBe(url);
    }
  });

  it('leaves every URL alone without parameters, or when it cannot be parsed', () => {
    expect(basemapRequestUrl({ kind: 'osm' }, 'https://tile.openstreetmap.org/1/0/0.png')).toBe(
      'https://tile.openstreetmap.org/1/0/0.png'
    );
    expect(basemapRequestUrl(spec, 'not a url')).toBe('not a url');
  });
});

describe('basemapLogo', () => {
  it('is the logo of a raster or style basemap', () => {
    const logo = { href: 'https://example.com', src: 'https://example.com/logo.svg', alt: 'Example' };

    expect(basemapLogo({ kind: 'style', url: 'https://example.com/s.json', logo })).toBe(logo);
    expect(basemapLogo({ kind: 'raster', tiles: [], attribution: '', logo })).toBe(logo);
    expect(basemapLogo({ kind: 'osm' })).toBeUndefined();
  });
});

describe('rasterPaint', () => {
  it('sets the same properties in both themes, so a theme switch resets them all', () => {
    expect(Object.keys(rasterPaint(light)).sort()).toEqual(Object.keys(rasterPaint(dark)).sort());
  });

  it('leaves tiles made for dark theme undimmed', () => {
    expect(rasterPaint(dark, false)).toEqual(rasterPaint(light));
  });

  it('uses the MapLibre defaults in light theme', () => {
    expect(rasterPaint(light)).toEqual({ 'raster-brightness-max': 1, 'raster-saturation': 0, 'raster-contrast': 0 });
  });
});
