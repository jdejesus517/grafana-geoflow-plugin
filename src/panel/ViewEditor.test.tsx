import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EventBusSrv, StandardEditorsRegistryItem } from '@grafana/data';
import { DEFAULT_OPTIONS, GeoFlowOptions } from './options';
import { ViewEditor } from './ViewEditor';
import { MapViewEvent, MapViewRequestEvent } from './viewEvents';

function setup(eventBus = new EventBusSrv()) {
  const onChange = jest.fn();
  const value: GeoFlowOptions['view'] = { ...DEFAULT_OPTIONS.view, mode: 'fit' };
  render(
    <ViewEditor
      value={value}
      onChange={onChange}
      item={{} as StandardEditorsRegistryItem}
      context={{ data: [], eventBus, options: { ...DEFAULT_OPTIONS, view: value } }}
    />
  );
  return { onChange, eventBus };
}

describe('ViewEditor', () => {
  it('asks the panel for its view when it opens', () => {
    const eventBus = new EventBusSrv();
    const asked = jest.fn();
    eventBus.subscribe(MapViewRequestEvent, asked);
    setup(eventBus);

    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('waits for the map, then shows its view as it moves', () => {
    const { eventBus } = setup();
    expect(screen.getByText(/once it has loaded/)).toBeInTheDocument();

    act(() => eventBus.publish(new MapViewEvent({ center: [-78.784523456, 35.783512345], zoom: 16.4567 })));
    expect(screen.getByTestId('geoflow-current-view')).toHaveTextContent('35.78351, -78.78452 · zoom 16.5');

    act(() => eventBus.publish(new MapViewEvent({ center: [-78.7, 35.7], zoom: 12 })));
    expect(screen.getByTestId('geoflow-current-view')).toHaveTextContent('35.70000, -78.70000 · zoom 12.0');
  });

  it('saves the rounded view as the fixed view, keeping the fit settings', () => {
    const { eventBus, onChange } = setup();
    act(() => eventBus.publish(new MapViewEvent({ center: [-78.784523456, 35.783512345], zoom: 16.4567 })));
    fireEvent.click(screen.getByRole('button', { name: 'Use current view' }));

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_OPTIONS.view,
      mode: 'fixed',
      lat: 35.78351,
      lon: -78.78452,
      zoom: 16.5,
    });
  });
});
