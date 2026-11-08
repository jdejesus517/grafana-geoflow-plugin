import { FieldType, toDataFrame } from '@grafana/data';
import { detectEdgeFields } from '../detectEdgeFields';

function frame(...names: string[]) {
  return toDataFrame({ fields: names.map((name) => ({ name, type: FieldType.string, values: [] })) });
}

function detected(...args: Parameters<typeof detectEdgeFields>) {
  const detection = detectEdgeFields(...args);
  return detection.found ? [detection.from.name, detection.to.name] : detection.detail;
}

describe('detectEdgeFields', () => {
  it.each([
    [
      ['id', 'source', 'target'],
      ['source', 'target'],
    ],
    [
      ['From', 'To'],
      ['From', 'To'],
    ],
    [
      ['src', 'dst'],
      ['src', 'dst'],
    ],
    [
      ['start', 'end'],
      ['start', 'end'],
    ],
    [
      ['a_end', 'z_end'],
      ['a_end', 'z_end'],
    ],
    [
      ['A', 'Z'],
      ['A', 'Z'],
    ],
    [
      ['source_id', 'target_id'],
      ['source_id', 'target_id'],
    ],
    [
      ['from_node', 'to_node'],
      ['from_node', 'to_node'],
    ],
    [
      ['a_site', 'z_site'],
      ['a_site', 'z_site'],
    ],
    [
      ['from_site', 'to_site'],
      ['from_site', 'to_site'],
    ],
    [
      ['source_host', 'target_host'],
      ['source_host', 'target_host'],
    ],
    [
      ['site_a', 'site_z'],
      ['site_a', 'site_z'],
    ],
    [
      ['node_from', 'node_to'],
      ['node_from', 'node_to'],
    ],
    [
      ['host_source', 'host_target'],
      ['host_source', 'host_target'],
    ],
  ])('finds %j', (names, expected) => {
    expect(detected(frame(...names))).toEqual(expected);
  });

  it('prefers name pairs to prefix pairs, and earlier columns within a rule', () => {
    expect(detected(frame('a_site', 'z_site', 'source', 'target'))).toEqual(['source', 'target']);
    expect(detected(frame('a_pop', 'z_pop', 'a_site', 'z_site'))).toEqual(['a_pop', 'z_pop']);
  });

  it("doesn't pair a column with itself or with a half that's missing", () => {
    expect(detected(frame('a_', 'z_'))).toMatch(/^No from and to columns/);
    expect(detected(frame('source', 'to'))).toMatch(/^No from and to columns/);
  });

  it('uses named columns, which must exist', () => {
    expect(detected(frame('x', 'y', 'source', 'target'), 'x', 'y')).toEqual(['x', 'y']);
    expect(detected(frame('x'), 'x', 'gone')).toBe('To column: no column named gone');
    expect(detected(frame('x'), 'gone', 'x')).toBe('From column: no column named gone');
  });

  it('finds the other column of a pair when only one is named', () => {
    expect(detected(frame('a_site', 'z_site', 'source', 'target'), 'a_site')).toEqual(['a_site', 'z_site']);
    expect(detected(frame('a_site', 'z_site', 'source', 'target'), undefined, 'target')).toEqual(['source', 'target']);
    expect(detected(frame('x', 'source', 'target'), 'x')).toBe('To column: no column pairs with x; choose one');
  });
});
