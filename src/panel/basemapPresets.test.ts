import { PROVIDERS, SAME_STYLE, apiKeyProblem, presetBasemap, presetStyles } from './basemapPresets';

const { openfreemap, stadia, maptiler, thunderforest } = PROVIDERS;

describe('presetStyles', () => {
  it("defaults to the provider's first style and its dark pair", () => {
    expect(presetStyles(openfreemap, undefined)).toEqual({ light: 'liberty', dark: 'dark' });
    expect(presetStyles(maptiler, { style: 'dataviz-v4' })).toEqual({ light: 'dataviz-v4', dark: 'dataviz-v4-dark' });
    expect(presetStyles(stadia, { style: 'stamen_toner' })).toEqual({
      light: 'stamen_toner',
      dark: 'stamen_toner_dark',
    });
  });

  it('keeps a chosen dark style, or the light one', () => {
    expect(presetStyles(openfreemap, { style: 'positron', dark: 'fiord' })).toEqual({
      light: 'positron',
      dark: 'fiord',
    });
    expect(presetStyles(openfreemap, { dark: SAME_STYLE })).toEqual({ light: 'liberty', dark: SAME_STYLE });
  });

  it("falls back to the defaults for another provider's ids", () => {
    expect(presetStyles(stadia, { style: 'liberty', dark: 'fiord' })).toEqual({
      light: 'alidade_smooth',
      dark: 'alidade_smooth_dark',
    });
  });

  it('pairs every light style with a dark style the provider has', () => {
    for (const provider of Object.values(PROVIDERS)) {
      const dark = new Set([...provider.dark.map(({ id }) => id), SAME_STYLE]);
      for (const { id } of provider.light) {
        expect(dark).toContain(provider.darkPair(id));
      }
    }
  });
});

describe('presetBasemap', () => {
  it('builds OpenFreeMap styles, with no key', () => {
    expect(presetBasemap(openfreemap, { style: 'positron' }, undefined, false)).toEqual({
      kind: 'style',
      url: 'https://tiles.openfreemap.org/styles/positron',
    });
    expect(presetBasemap(openfreemap, { style: 'positron' }, undefined, true)).toEqual({
      kind: 'style',
      url: 'https://tiles.openfreemap.org/styles/dark',
    });
  });

  it("puts Stadia Maps' optional key on every request to its host", () => {
    expect(presetBasemap(stadia, undefined, undefined, false)).toEqual({
      kind: 'style',
      url: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
    });
    expect(presetBasemap(stadia, undefined, ' k1 ', false)).toEqual({
      kind: 'style',
      url: 'https://tiles.stadiamaps.com/styles/alidade_smooth.json',
      requestParams: { host: 'tiles.stadiamaps.com', params: { api_key: 'k1' } },
    });
  });

  it('builds MapTiler styles with the key and its logo', () => {
    expect(presetBasemap(maptiler, undefined, 'k1', true)).toEqual({
      kind: 'style',
      url: 'https://api.maptiler.com/maps/streets-v4-dark/style.json',
      requestParams: { host: 'api.maptiler.com', params: { key: 'k1' } },
      logo: { href: 'https://www.maptiler.com/', src: 'https://api.maptiler.com/resources/logo.svg', alt: 'MapTiler' },
    });
  });

  it('builds Thunderforest raster tiles with linked attribution, dimmed in dark theme without a dark style', () => {
    const atlas = presetBasemap(thunderforest, undefined, 'k1', true);

    expect(atlas).toMatchObject({
      kind: 'raster',
      tiles: ['https://tile.thunderforest.com/atlas/{z}/{x}/{y}.png'],
      attributionHtml: true,
      dimInDark: true,
      requestParams: { host: 'tile.thunderforest.com', params: { apikey: 'k1' } },
    });
    expect(atlas.kind === 'raster' && atlas.attribution).toMatch(
      /<a href="https:\/\/www.thunderforest.com\/".*<a href="https:\/\/www.openstreetmap.org\/copyright"/
    );
    expect(presetBasemap(thunderforest, { style: 'transport' }, 'k1', true)).toMatchObject({
      tiles: ['https://tile.thunderforest.com/transport-dark/{z}/{x}/{y}.png'],
      dimInDark: false,
    });
  });

  it('draws no basemap without a required key', () => {
    expect(presetBasemap(maptiler, undefined, undefined, false)).toEqual({ kind: 'none' });
    expect(presetBasemap(thunderforest, undefined, '  ', false)).toEqual({ kind: 'none' });
  });
});

describe('apiKeyProblem', () => {
  it('asks for a required key only', () => {
    expect(apiKeyProblem(maptiler, '')).toBe('Enter your MapTiler API key');
    expect(apiKeyProblem(maptiler, 'k1')).toBeUndefined();
    expect(apiKeyProblem(stadia, undefined)).toBeUndefined();
  });
});
