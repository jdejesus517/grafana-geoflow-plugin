import { DataFrame, Field } from '@grafana/data';
import { Feature, SupportedGeometry } from '../model';
import {
  ConversionResult,
  EdgePair,
  MAX_WARNING_SAMPLES,
  emptyWarningCounts,
  growBounds,
} from './frameToFeatureCollection';
import { WarningKind } from './parseGeometry';

/** Warning kinds about the node layer's rows rather than the edge frame's. */
export const NODE_WARNING_KINDS: WarningKind[] = ['duplicateId', 'notAPoint'];

export interface EdgeLayerColumns {
  layerId: string;
  refId: string;
  fromField: Field;
  toField: Field;
}

/** Separates the two ids of a pair key; it can't appear in ids from a database. */
const KEY_SEPARATOR = '\u0000';

/**
 * An edge layer's result (docs/node-edge/architecture.md §5.2, docs/node-edge/phase_1.md, Design
 * §3): one straight line per pair of nodes, between their points, for every edge row whose from
 * and to name two nodes of `nodeResult`.
 *
 * Ids match as text, so an integer site id joins a text trunk end (decision 13). A node needs a
 * Point; the first node with an id wins. Rows that can't be drawn are counted in the result's
 * warnings, node problems included: the node result is shared and cached, so it isn't changed
 * (docs/node-edge/phase_1.md, decision 2).
 */
export function joinEdges(
  edgeFrame: DataFrame,
  edges: EdgeLayerColumns,
  nodeFrame: DataFrame,
  nodeResult: ConversionResult,
  nodeIdField: Field
): ConversionResult {
  const result = emptyEdgeResult(edges.layerId, edges.refId, edgeFrame.length);
  result.styleField = edges.fromField.name;
  const count = (kind: WarningKind, row: number, detail: string) => {
    result.warnings.counts[kind]++;
    if (result.warnings.samples.length < MAX_WARNING_SAMPLES) {
      result.warnings.samples.push({ row, kind, detail });
    }
  };

  const positions = nodePositions(nodeFrame, nodeResult, nodeIdField, count);
  // Every node id, drawn or not, to tell an unknown id from a node without a point. Only built
  // when an edge names a node without a position.
  let allIds: Set<string> | undefined;
  const nodeIds = () =>
    (allIds ??= new Set(Array.from(nodeIdField.values, idText).filter((id): id is string => id !== undefined)));

  const pairs = new Map<string, EdgePair>();
  const fromValues = edges.fromField.values;
  const toValues = edges.toField.values;
  for (let row = 0; row < edgeFrame.length; row++) {
    const from = idText(fromValues[row]);
    const to = idText(toValues[row]);
    if (from === undefined || to === undefined) {
      count('missingEnd', row, `no node id in ${from === undefined ? edges.fromField.name : edges.toField.name}`);
      continue;
    }
    if (from === to) {
      count('selfLoop', row, `from and to are both ${from}`);
      continue;
    }
    const unknown = [from, to].filter((id) => !positions.has(id));
    if (unknown.length > 0) {
      count('unknownNode', row, unknownDetail(unknown, nodeIds()));
      continue;
    }
    const nodes: [string, string] = from < to ? [from, to] : [to, from];
    const key = nodes.join(KEY_SEPARATOR);
    const pair = pairs.get(key);
    if (pair) {
      pair.rows.push(row);
    } else {
      pairs.set(key, { key, nodes, rows: [row] });
    }
  }

  const { features } = result.featureCollection;
  for (const pair of pairs.values()) {
    const coordinates = pair.nodes.map((id) => positions.get(id)!);
    const feature: Feature<SupportedGeometry> = {
      type: 'Feature',
      id: features.length,
      geometry: { type: 'LineString', coordinates },
      properties: {},
    };
    features.push(feature);
    result.featureRows.push(pair.rows[0]);
    result.pairs!.push(pair);
    result.featureKeys!.push(pair.key);
    for (const [lon, lat] of coordinates) {
      growBounds(result, [lon, lat, lon, lat]);
    }
  }
  return result;
}

/** An edge result with nothing drawn yet. */
export function emptyEdgeResult(layerId: string, refId: string, rowCount: number): ConversionResult {
  return {
    layerId,
    refId,
    rowCount,
    featureCollection: { type: 'FeatureCollection', features: [] },
    featureRows: [],
    featureKeys: [],
    pairs: [],
    warnings: { counts: emptyWarningCounts(), samples: [] },
  };
}

/** Why an edge's nodes have no position: no such node, or one the node layer couldn't draw. */
function unknownDetail(ids: string[], nodeIds: Set<string>): string {
  const [known, unknown] = [ids.filter((id) => nodeIds.has(id)), ids.filter((id) => !nodeIds.has(id))];
  return [
    ...(unknown.length > 0 ? [`no node with id ${unknown.join(' or ')}`] : []),
    ...(known.length > 0 ? [`node ${known.join(' and ')} has no point to draw`] : []),
  ].join('; ');
}

/**
 * Each node's point, by its id as text. Samples of node problems hold the node layer's row
 * (NODE_WARNING_KINDS).
 */
function nodePositions(
  nodeFrame: DataFrame,
  nodeResult: ConversionResult,
  idField: Field,
  count: (kind: WarningKind, row: number, detail: string) => void
): Map<string, [number, number]> {
  const positions = new Map<string, [number, number]>();
  const ids = idField.values;
  nodeResult.featureCollection.features.forEach((feature, i) => {
    const nodeRow = nodeResult.featureRows[i];
    const id = idText(ids[nodeRow]);
    if (id === undefined) {
      return;
    }
    const { geometry } = feature;
    if (geometry.type !== 'Point') {
      count('notAPoint', nodeRow, `node ${id} is a ${geometry.type}, not a Point`);
      return;
    }
    if (positions.has(id)) {
      count('duplicateId', nodeRow, `node id ${id} is already used by an earlier node`);
      return;
    }
    const [lon, lat] = geometry.coordinates;
    positions.set(id, [lon, lat]);
  });
  return positions;
}

/** An id as text, or undefined when there's none. `1` and `"1"` match; `1.5` reads as `"1.5"`. */
function idText(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const text = String(value);
  return text === '' ? undefined : text;
}
