import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataFrame, FieldType, StandardEditorsRegistryItem, toDataFrame } from '@grafana/data';
import { LayerConfig } from '../adapter';
import { LayersEditor, withoutDefaults } from './LayersEditor';
import { DEFAULT_OPTIONS } from './options';

const point = '{"type":"Point","coordinates":[-78.78,35.78]}';

function frame(refId: string, name?: string): DataFrame {
  return toDataFrame({
    refId,
    name,
    fields: [
      { name: 'id', type: FieldType.number, values: [1] },
      { name: 'footprint', type: FieldType.string, values: [point] },
      { name: 'centroid', type: FieldType.string, values: [point] },
      { name: 'size', type: FieldType.number, values: [3] },
    ],
  });
}

const noGeometry = toDataFrame({ refId: 'N', fields: [{ name: 'name', type: FieldType.string, values: ['a'] }] });

function setup(value: LayerConfig[] | undefined, data: DataFrame[] = [frame('A'), frame('B'), frame('C')]) {
  const onChange = jest.fn();
  const props = {
    value,
    onChange,
    item: {} as StandardEditorsRegistryItem,
    context: { data, options: { ...DEFAULT_OPTIONS, layers: value ?? [] } },
  };
  const view = render(<LayersEditor {...props} />);
  const rerender = (next: LayerConfig[]) =>
    view.rerender(
      <LayersEditor
        {...props}
        value={next}
        context={{ ...props.context, options: { ...DEFAULT_OPTIONS, layers: next } }}
      />
    );
  return { onChange, rerender };
}

const rows = () =>
  screen.getAllByTestId(/^geoflow-layer-row-/).map((row) => row.dataset.testid!.replace('geoflow-layer-row-', ''));
const lastSaved = (onChange: jest.Mock): LayerConfig[] => onChange.mock.calls.at(-1)[0];

describe('LayersEditor', () => {
  it('lists one row per query, top layer first, and selects the top one', () => {
    setup(undefined);

    expect(rows()).toEqual(['C', 'B', 'A']);
    expect(within(screen.getByTestId('geoflow-layer-settings')).getByText('Query C')).toBeInTheDocument();
  });

  it('saves every layer in the new order when one moves, with no other settings', () => {
    const { onChange } = setup(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Move Query C down' }));

    expect(lastSaved(onChange)).toEqual([{ id: 'B' }, { id: 'C' }, { id: 'A' }]);
  });

  it('disables moving the top layer up and the bottom layer down', () => {
    setup(undefined);

    expect(screen.getByRole('button', { name: 'Move Query C up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Query A down' })).toBeDisabled();
  });

  it('hides and shows a layer, saving only what differs from the defaults', () => {
    const { onChange, rerender } = setup([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Query B' }));
    expect(lastSaved(onChange)).toEqual([{ id: 'A' }, { id: 'B', visible: false }, { id: 'C' }]);

    rerender(lastSaved(onChange));
    fireEvent.click(screen.getByRole('button', { name: 'Show Query B' }));
    expect(lastSaved(onChange)).toEqual([{ id: 'A' }, { id: 'B' }, { id: 'C' }]);
  });

  it('renames the selected layer on blur, with its default name as the placeholder', () => {
    const { onChange } = setup(undefined, [frame('A', 'Cables')]);
    const name = screen.getByLabelText(/^Name/);
    expect(name).toHaveAttribute('placeholder', 'Cables');

    fireEvent.change(name, { target: { value: 'Fiber cables' } });
    fireEvent.blur(name);
    expect(lastSaved(onChange)).toEqual([{ id: 'A', name: 'Fiber cables' }]);
  });

  it('clears a typed name when the input is emptied', () => {
    const { onChange } = setup([{ id: 'A', name: 'Fiber cables' }], [frame('A')]);
    const name = screen.getByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: ' ' } });
    fireEvent.blur(name);

    expect(lastSaved(onChange)).toEqual([{ id: 'A' }]);
  });

  it('shows the settings of the row clicked', () => {
    setup(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Query A' }));

    expect(within(screen.getByTestId('geoflow-layer-settings')).getByText('Query A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Query A' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('turns tooltips off for the selected layer', () => {
    const { onChange } = setup(undefined, [frame('A')]);
    fireEvent.click(screen.getByLabelText(/^Tooltips/));

    expect(lastSaved(onChange)).toEqual([{ id: 'A', tooltips: false }]);
  });

  // Picking a column is covered by the e2e tests: Combobox virtualizes its list, which renders no
  // options in jsdom.
  it('names the detected columns in the column pickers, or the fallback', () => {
    setup(undefined, [frame('A'), noGeometry]);
    expect(screen.getByLabelText(/^Geometry column/)).toHaveAttribute('placeholder', 'Auto: none found');
    expect(screen.getByLabelText(/^ID column/)).toHaveAttribute('placeholder', 'Auto: row number');

    fireEvent.click(screen.getByRole('button', { name: 'Query A' }));
    expect(screen.getByLabelText(/^Geometry column/)).toHaveAttribute('placeholder', 'Auto: footprint');
    expect(screen.getByLabelText(/^ID column/)).toHaveAttribute('placeholder', 'Auto: id');
  });

  it('shows a saved column in its picker', () => {
    setup([{ id: 'A', geometryField: 'centroid', idField: 'size' }], [frame('A')]);

    expect(screen.getByLabelText(/^Geometry column/)).toHaveValue('centroid');
    expect(screen.getByLabelText(/^ID column/)).toHaveValue('size');
  });

  it('says why a layer has no geometry, in its row and its settings', () => {
    setup([{ id: 'A', geometryField: 'shape' }], [frame('A'), noGeometry]);

    expect(within(screen.getByTestId('geoflow-layer-row-N')).getByText('No geometry')).toBeInTheDocument();
    expect(within(screen.getByTestId('geoflow-layer-row-A')).getByText('No geometry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Query A' }));
    expect(screen.getByText('No column named "shape"')).toBeInTheDocument();
  });

  it('keeps the settings of a gone layer, marked No data, until they are removed', () => {
    const { onChange } = setup([{ id: 'Z', name: 'Old cables' }, { id: 'A' }], [frame('A')]);

    expect(rows()).toEqual(['Z', 'A']);
    expect(within(screen.getByTestId('geoflow-layer-row-Z')).getByText('No data')).toBeInTheDocument();
    expect(screen.getByTestId('geoflow-layer-settings')).toHaveTextContent('No query returns this layer now');

    fireEvent.click(screen.getByRole('button', { name: 'Remove the settings of Old cables' }));
    expect(lastSaved(onChange)).toEqual([{ id: 'A' }]);
  });

  it('lists saved layers before the queries have run', () => {
    setup([{ id: 'A', name: 'Cables' }], []);

    expect(rows()).toEqual(['A']);
  });

  it('asks for the queries to run when there is nothing to list', () => {
    setup(undefined, []);

    expect(screen.getByText(/Run the panel's queries/)).toBeInTheDocument();
  });
});

describe('withoutDefaults', () => {
  it('keeps every setting that differs from its default', () => {
    const full: Required<LayerConfig> = {
      id: 'B',
      name: 'Trunks',
      visible: false,
      tooltips: false,
      geometryField: 'geom',
      idField: 'key',
      role: 'edges',
      fromField: 'a_site',
      toField: 'z_site',
    };

    expect(withoutDefaults(full)).toEqual(full);
  });

  it('leaves out defaults, and unset and empty settings', () => {
    expect(
      withoutDefaults({ id: 'A', name: '', visible: true, tooltips: true, role: 'geometry', idField: undefined })
    ).toEqual({ id: 'A' });
  });

  it('drops from and to columns off layers that are not edges', () => {
    expect(withoutDefaults({ id: 'A', role: 'nodes', fromField: 'a', toField: 'z' })).toEqual({
      id: 'A',
      role: 'nodes',
    });
    expect(withoutDefaults({ id: 'A', fromField: 'a' })).toEqual({ id: 'A' });
  });
});

describe('LayersEditor with a network', () => {
  const network: LayerConfig[] = [
    { id: 'A', role: 'nodes', idField: 'id' },
    { id: 'B', role: 'edges', fromField: 'footprint', toField: 'centroid' },
  ];

  it('keeps roles and edge columns when a layer is renamed, hidden or moved', () => {
    const { onChange } = setup(network, [frame('A'), frame('B')]);

    fireEvent.click(screen.getByRole('button', { name: 'Hide Query A' }));
    expect(lastSaved(onChange)).toEqual([{ ...network[0], visible: false }, network[1]]);

    fireEvent.click(screen.getByRole('button', { name: 'Move Query A down' }));
    expect(lastSaved(onChange)).toEqual([network[1], network[0]]);

    const name = screen.getByLabelText(/^Name/);
    fireEvent.change(name, { target: { value: 'Sites' } });
    fireEvent.blur(name);
    expect(lastSaved(onChange)).toEqual([{ ...network[0], name: 'Sites' }, network[1]]);
  });
});

describe('LayersEditor roles', () => {
  const sites = (refId = 'A', idName = 'id') =>
    toDataFrame({
      refId,
      fields: [
        { name: idName, type: FieldType.number, values: [1] },
        { name: 'geometry', type: FieldType.string, values: [point] },
      ],
    });
  const trunks = (refId = 'B') =>
    toDataFrame({
      refId,
      fields: [
        { name: 'trunk_id', type: FieldType.string, values: ['T1'] },
        { name: 'a_site', type: FieldType.string, values: ['1'] },
        { name: 'z_site', type: FieldType.string, values: ['1'] },
      ],
    });
  const settings = () => within(screen.getByTestId('geoflow-layer-settings'));
  const select = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
  const placeholder = (label: RegExp) => settings().getByLabelText(label).getAttribute('placeholder');

  it('saves the role chosen for the selected layer', () => {
    const { onChange } = setup([{ id: 'A' }], [sites()]);

    fireEvent.click(settings().getByLabelText('Nodes'));
    expect(lastSaved(onChange)).toEqual([{ id: 'A', role: 'nodes' }]);
  });

  it('shows an edge layer its From and To columns, detected, and no geometry, ID or tooltip settings', () => {
    setup([{ id: 'B', role: 'edges' }], [trunks()]);

    expect(placeholder(/^From column/)).toBe('Auto: a_site');
    expect(placeholder(/^To column/)).toBe('Auto: z_site');
    expect(settings().queryByLabelText(/^Geometry column/)).not.toBeInTheDocument();
    expect(settings().queryByLabelText(/^ID column/)).not.toBeInTheDocument();
    expect(settings().queryByLabelText(/^Tooltips/)).not.toBeInTheDocument();
  });

  it('saves a chosen column, and detects the other from the same pair', () => {
    const data = [
      toDataFrame({
        refId: 'B',
        fields: ['source', 'target', 'a_site', 'z_site'].map((name) => ({ name, type: FieldType.string, values: [] })),
      }),
    ];
    const { onChange, rerender } = setup([{ id: 'B', role: 'edges' }], data);
    expect(placeholder(/^To column/)).toBe('Auto: target');

    rerender([{ id: 'B', role: 'edges', fromField: 'a_site' }]);
    expect(placeholder(/^To column/)).toBe('Auto: z_site');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a problem on the column it is about', () => {
    setup([{ id: 'B', role: 'edges', toField: 'far_end' }], [trunks()]);

    expect(settings().getByText('no column named far_end')).toBeInTheDocument();
  });

  it('says when no from and to columns are found', () => {
    setup([{ id: 'A', role: 'edges' }], [sites()]);

    expect(placeholder(/^From column/)).toBe('Auto: none found');
    expect(settings().getByText(/^No from and to columns/)).toBeInTheDocument();
  });

  it("describes a node layer's ID column, and says when it has none", () => {
    setup([{ id: 'A', role: 'nodes' }], [sites('A', 'site')]);

    expect(settings().getByText('Edges find nodes by this column. Keep it unique.')).toBeInTheDocument();
    expect(placeholder(/^ID column/)).toBe('None: choose one');
    expect(settings().getByText('Edges find nodes by id: choose a column')).toBeInTheDocument();
  });

  it('moves a new edge layer below its nodes', () => {
    const { onChange } = setup([{ id: 'B' }, { id: 'A', role: 'nodes' }], [sites(), trunks()]);
    select('Query B');
    fireEvent.click(settings().getByLabelText('Edges'));
    expect(lastSaved(onChange)).toEqual([
      { id: 'A', role: 'nodes' },
      { id: 'B', role: 'edges' },
    ]);
  });

  it('moves a new node layer above its edges', () => {
    const { onChange } = setup([{ id: 'B', role: 'edges' }, { id: 'A' }], [sites(), trunks()]);
    select('Query A');
    fireEvent.click(settings().getByLabelText('Nodes'));
    expect(lastSaved(onChange)).toEqual([
      { id: 'A', role: 'nodes' },
      { id: 'B', role: 'edges' },
    ]);
  });

  it('keeps the order when the network already draws right side up', () => {
    const { onChange } = setup([{ id: 'A', role: 'nodes' }, { id: 'B' }], [sites(), trunks()]);
    select('Query B');
    fireEvent.click(settings().getByLabelText('Edges'));
    expect(lastSaved(onChange)).toEqual([
      { id: 'A', role: 'nodes' },
      { id: 'B', role: 'edges' },
    ]);
  });

  it('labels network rows by role, without No geometry on edges, and marks extras Not used', () => {
    setup(
      [
        { id: 'A', role: 'nodes' },
        { id: 'B', role: 'edges' },
        { id: 'C', role: 'edges' },
      ],
      [sites(), trunks(), trunks('C')]
    );
    const row = (id: string) => within(screen.getByTestId(`geoflow-layer-row-${id}`));

    expect(row('A').getByText('Nodes')).toBeInTheDocument();
    expect(row('B').getByText('Edges')).toBeInTheDocument();
    expect(row('B').queryByText('No geometry')).not.toBeInTheDocument();
    expect(row('B').queryByText('Not used')).not.toBeInTheDocument();
    expect(row('C').getByText('Not used')).toHaveAttribute('title', 'The network uses Query B');
  });
});
