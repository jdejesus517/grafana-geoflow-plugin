import {
  DataFrame,
  Field,
  FieldConfig,
  FieldType,
  LinkModel,
  createTheme,
  getDisplayProcessor,
  toDataFrame,
} from '@grafana/data';
import { EMPTY_VALUE, featureDetails } from '../featureDetails';
import { frameToFeatureCollection } from '../frameToFeatureCollection';

const point = (lon: number) => `{"type":"Point","coordinates":[${lon},35.78]}`;
const theme = createTheme();

/** Applies field config the way Grafana does for a panel: config, display processor and links. */
function withFieldConfig(frame: DataFrame, config: Record<string, FieldConfig> = {}): DataFrame {
  for (const field of frame.fields) {
    field.config = { ...field.config, ...config[field.name] };
    field.display = getDisplayProcessor({ field, theme, timeZone: 'utc' });
  }
  return frame;
}

/** A stand-in for Grafana's link supplier that records the row it's asked for. */
function links(field: Field, title: string) {
  field.getLinks = ({ valueRowIndex }) => [
    { title, href: `/d/x?id=${field.values[valueRowIndex!]}`, target: '_self', origin: field } as LinkModel<Field>,
  ];
}

const buildings = () =>
  toDataFrame({
    refId: 'A',
    fields: [
      { name: 'id', type: FieldType.number, values: [1, 2, 3] },
      { name: 'name', type: FieldType.string, values: ['Office', 'Depot', 'Hub'] },
      { name: 'floors', type: FieldType.number, values: [12, 3, null] },
      { name: 'status', type: FieldType.string, values: ['in_service', 'planned', 'in_service'] },
      { name: 'installed_on', type: FieldType.time, values: [Date.UTC(2015, 2, 1), Date.UTC(2020, 0, 1), null] },
      { name: 'geometry', type: FieldType.string, values: [point(-78.78), point(-78.77), point(-78.76)] },
    ],
  });

describe('featureDetails', () => {
  it('lists every column but the geometry, in frame order, with display names and formatted values', () => {
    const frame = withFieldConfig(buildings(), {
      name: { displayName: 'Building' },
      floors: { unit: 'percent' },
      status: { mappings: [{ type: 'value' as never, options: { in_service: { text: 'In service' } } }] },
    });
    const result = frameToFeatureCollection(frame);

    expect(featureDetails(frame, result, 1)?.items).toEqual([
      { label: 'id', value: '1' },
      { label: 'Building', value: 'Office' },
      { label: 'floors', value: '12%' },
      { label: 'status', value: 'In service' },
      { label: 'installed_on', value: '2015-03-01 00:00:00' },
    ]);
  });

  it('formats times in the time zone Grafana applied', () => {
    const frame = buildings();
    for (const field of frame.fields) {
      field.display = getDisplayProcessor({ field, theme, timeZone: 'Pacific/Honolulu' });
    }

    const installed = featureDetails(frame, frameToFeatureCollection(frame), 1)?.items.find(
      (i) => i.label === 'installed_on'
    );
    expect(installed?.value).toBe('2015-02-28 14:00:00');
  });

  it('shows the No value text, or a dash, for empty values', () => {
    const frame = withFieldConfig(buildings(), { floors: { noValue: 'unknown' } });
    const items = featureDetails(frame, frameToFeatureCollection(frame), 3)!.items;

    expect(items.find((i) => i.label === 'floors')?.value).toBe('unknown');
    expect(items.find((i) => i.label === 'installed_on')?.value).toBe(EMPTY_VALUE);
  });

  it('leaves out fields set to Hide in tooltip, but keeps their links', () => {
    const frame = withFieldConfig(buildings(), { name: { custom: { hideInTooltip: true } } });
    links(frame.fields[1], 'Open');
    const details = featureDetails(frame, frameToFeatureCollection(frame), 2)!;

    expect(details.items.map((i) => i.label)).not.toContain('name');
    expect(details.links.map((l) => [l.title, l.href])).toEqual([['Open', '/d/x?id=Depot']]);
  });

  it("asks for links on the feature's row, and drops duplicates", () => {
    const frame = withFieldConfig(buildings());
    links(frame.fields[0], 'Same');
    links(frame.fields[3], 'Status');
    frame.fields[3].getLinks = frame.fields[0].getLinks;

    expect(featureDetails(frame, frameToFeatureCollection(frame), 3)!.links.map((l) => [l.title, l.href])).toEqual([
      ['Same', '/d/x?id=3'],
    ]);
  });

  it('finds the row of a feature after skipped rows', () => {
    const frame = withFieldConfig(
      toDataFrame({
        fields: [
          { name: 'name', type: FieldType.string, values: ['broken', 'kept'] },
          { name: 'geometry', type: FieldType.string, values: ['{"type":"Point"', point(-78.78)] },
        ],
      })
    );
    const result = frameToFeatureCollection(frame);

    // Row indexes are the ids when there's no id column: the kept feature is row 1.
    expect(featureDetails(frame, result, 1)?.items).toEqual([{ label: 'name', value: 'kept' }]);
  });

  it('adds GeoJSON Feature properties that no column covers, as plain text', () => {
    const feature = (props: object) =>
      JSON.stringify({ type: 'Feature', geometry: JSON.parse(point(-78.78)), properties: props });
    const frame = withFieldConfig(
      toDataFrame({
        fields: [
          { name: 'id', type: FieldType.number, values: [5] },
          {
            name: 'feature',
            type: FieldType.string,
            values: [feature({ id: 99, mount: 'pole', rack: { row: 2 }, note: null })],
          },
        ],
      })
    );

    expect(featureDetails(frame, frameToFeatureCollection(frame), 5)?.items).toEqual([
      { label: 'id', value: '5' },
      { label: 'mount', value: 'pole' },
      { label: 'rack', value: '{"row":2}' },
      { label: 'note', value: EMPTY_VALUE },
    ]);
  });

  it('shows raw values when no field config was applied', () => {
    const frame = buildings();
    const items = featureDetails(frame, frameToFeatureCollection(frame), 1)!.items;

    expect(items.find((i) => i.label === 'floors')?.value).toBe('12');
  });

  it('returns undefined for a feature that is not in the result', () => {
    const frame = withFieldConfig(buildings());

    expect(featureDetails(frame, frameToFeatureCollection(frame), 42)).toBeUndefined();
  });
});
