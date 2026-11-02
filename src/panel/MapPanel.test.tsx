import React from 'react';
import { render, screen } from '@testing-library/react';
import { FieldType, LoadingState, PanelData, PanelProps, getDefaultTimeRange, toDataFrame } from '@grafana/data';
import { MapPanel } from './MapPanel';
import { GeoFlowOptions } from './options';

jest.mock('@grafana/runtime', () => ({
  PanelDataErrorView: () => <div>No data</div>,
}));

function renderPanel(data: Partial<PanelData>) {
  const props = {
    id: 1,
    data: { state: LoadingState.Done, series: [], timeRange: getDefaultTimeRange(), ...data },
    options: {},
    fieldConfig: { defaults: {}, overrides: [] },
    width: 400,
    height: 300,
  } as unknown as PanelProps<GeoFlowOptions>;
  return render(<MapPanel {...props} />);
}

describe('MapPanel placeholder', () => {
  it('lists each frame with its row count and fields', () => {
    renderPanel({
      series: [
        toDataFrame({
          refId: 'A',
          fields: [
            { name: 'id', type: FieldType.number, values: [1, 2] },
            { name: 'geometry', type: FieldType.string, values: ['{}', '{}'] },
          ],
        }),
        toDataFrame({
          refId: 'B',
          fields: [{ name: 'id', type: FieldType.number, values: [1, 2, 3] }],
        }),
      ],
    });

    expect(screen.getByTestId('geoflow-frame-A')).toHaveTextContent('A: 2 rows');
    expect(screen.getByTestId('geoflow-frame-A')).toHaveTextContent('id (number), geometry (string)');
    expect(screen.getByTestId('geoflow-frame-B')).toHaveTextContent('B: 3 rows');
  });

  it('shows the no-data view when there are no frames', () => {
    renderPanel({ series: [] });

    expect(screen.getByText('No data')).toBeInTheDocument();
    expect(screen.queryByTestId('geoflow-placeholder')).not.toBeInTheDocument();
  });
});
