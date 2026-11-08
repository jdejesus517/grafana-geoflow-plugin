import React from 'react';
import { render, screen } from '@testing-library/react';
import { EventBusSrv, StandardEditorsRegistryItem } from '@grafana/data';
import { PresetChoice } from './basemapPresets';
import { BasemapKind, DEFAULT_OPTIONS } from './options';
import { PresetEditor } from './PresetEditor';

function setup(kind: BasemapKind, value?: PresetChoice) {
  const onChange = jest.fn();
  render(
    <PresetEditor
      id="preset"
      value={value}
      onChange={onChange}
      item={{} as StandardEditorsRegistryItem}
      context={{ data: [], eventBus: new EventBusSrv(), options: { ...DEFAULT_OPTIONS, basemap: { kind } } }}
    />
  );
  return { onChange };
}

// Picking a style is covered by the e2e tests: Combobox virtualizes its list, which renders no
// options in jsdom.
describe('PresetEditor', () => {
  it('shows nothing for a basemap that is not a preset', () => {
    const { container } = render(
      <PresetEditor
        value={undefined}
        onChange={jest.fn()}
        item={{} as StandardEditorsRegistryItem}
        context={{ data: [], options: { ...DEFAULT_OPTIONS, basemap: { kind: 'osm' } } }}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the defaults an unset choice resolves to', () => {
    setup('openfreemap');

    expect(screen.getByLabelText('Style')).toHaveValue('Liberty');
    expect(screen.getByLabelText(/Dark theme style/)).toHaveValue('Dark');
  });

  it("falls back to the provider's defaults for another provider's choice", () => {
    setup('stadia', { style: 'liberty', dark: 'fiord' });

    expect(screen.getByLabelText('Style')).toHaveValue('Alidade Smooth');
    expect(screen.getByLabelText(/Dark theme style/)).toHaveValue('Alidade Smooth Dark');
  });

  it('says a raster style is dimmed when kept in dark theme', () => {
    setup('thunderforest', { style: 'atlas' });

    expect(screen.getByLabelText(/Dark theme style/)).toHaveValue('Same as light, dimmed');
  });
});
