import { DataFrame, Field } from '@grafana/data';
import {
  BoundLayer,
  ConversionResult,
  GeometryMapping,
  NetworkLayers,
  defaultIdField,
  detectEdgeFields,
  emptyEdgeResult,
  frameRefId,
  frameToFeatureCollection,
  joinEdges,
  networkLayers,
} from '../adapter';

/**
 * What an edge layer's result depends on besides its own frame (docs/node-edge/phase_1.md, Design
 * §4): the node layer's result and the columns joining them. Without a node result, or without
 * columns, the edge layer draws nothing.
 */
interface EdgeInputs {
  nodeResult?: ConversionResult;
  from: string;
  to: string;
  nodeId: string;
}

interface Cached {
  result: ConversionResult;
  /** What the result was converted from: each field's name and values array. */
  fields: Array<{ name: string; values: unknown }>;
  mapping: GeometryMapping;
  edge?: EdgeInputs;
}

/** A layer's last conversion, with a copy of the data it came from. */
interface Previous {
  result: ConversionResult;
  mapping: GeometryMapping;
  fields: Array<{ name: string; type: string; values: unknown[] }>;
  edge?: EdgeInputs;
}

/**
 * Each layer's last conversion, by layer id, for one panel. The panel keeps it across renders, so
 * a refresh that brings the same data again reuses the conversion (docs/phase_8.md, Design §1).
 */
export type ConversionHistory = Map<string, Previous>;

/**
 * Conversions by frame data, not frame object (docs/phase_5.md, Design §3). Grafana applies field
 * config by building new frame objects around the same `values` arrays, so a style change hands
 * over new frames whose data hasn't changed. Those keep their conversion, and with it their
 * FeatureCollection object, which the engine then skips. New query results come in new arrays
 * and are converted again, as are frames whose layer gets another id or geometry or id column
 * (docs/phase_7.md, Design §3). Keyed by the first field's values array; weak keys let old data
 * be garbage collected.
 */
const cache = new WeakMap<object, Cached>();

/**
 * Converts every frame for its layer in `layers` (from bindLayers), reusing the result for frames
 * whose data and columns were already converted. Results are in frame order.
 *
 * Edge layers' frames have no geometry, so they're joined to the node layer's result instead, in
 * a second pass (docs/node-edge/phase_1.md, decision 1). Only the network's edge layer draws; other
 * Edges layers get an empty result.
 *
 * With a `history`, a refresh whose data equals the layer's last data, value for value, reuses
 * that conversion too. Grafana empties the previous query's arrays once new data arrives
 * (docs/phase_8.md, step 8.1), so the history keeps its own copy of them. It holds only the
 * layers in `frames`.
 */
export function convertFrames(
  frames: DataFrame[],
  layers: BoundLayer[] = [],
  history?: ConversionHistory
): ConversionResult[] {
  const layerByFrame = new Map(
    layers.flatMap((layer) => (layer.frameIndex === undefined ? [] : [[layer.frameIndex, layer]]))
  );
  const seen = new Set<string>();
  const results = frames.map((frame, i) => {
    const layer = layerByFrame.get(i);
    const refId = frameRefId(frame, i);
    const layerId = layer?.id ?? refId;
    seen.add(layerId);
    if (layer?.role === 'edges') {
      // Filled in below, once the node layer is converted.
      return undefined;
    }
    const mapping: GeometryMapping = { geometryField: layer?.geometryField, idField: layer?.idField };
    const key = frame.fields[0]?.values;
    const cached = key && cache.get(key);
    const previous = history?.get(layerId);
    // Two ways to skip converting: the cache spots the same arrays (a field config change), the
    // history the same values in new arrays (a refresh that brought the same data again).
    let result: ConversionResult;
    if (cached && sameLayer(cached, layerId, mapping) && sameFields(cached.fields, frame)) {
      result = cached.result;
    } else if (previous && sameLayer(previous, layerId, mapping) && sameData(previous.fields, frame)) {
      result = previous.result;
    } else {
      result = frameToFeatureCollection({ ...frame, refId }, mapping, layerId);
      if (previous && sameLayer(previous, layerId, mapping) && reordered(previous.result, result)) {
        result.reordered = true;
      }
    }
    if (key && cached?.result !== result) {
      cache.set(key, { result, fields: frame.fields.map(({ name, values }) => ({ name, values })), mapping });
    }
    if (history && previous?.result !== result) {
      history.set(layerId, { result, mapping, fields: frame.fields.map(copyField) });
    }
    return result;
  });

  const network = networkLayers(layers);
  results.forEach((result, i) => {
    if (!result) {
      results[i] = edgeResult(frames, results, i, layerByFrame.get(i)!, network, history);
    }
  });
  for (const layerId of history?.keys() ?? []) {
    if (!seen.has(layerId)) {
      history!.delete(layerId);
    }
  }
  return results as ConversionResult[];
}

/**
 * An Edges layer's result: the network's edge layer joined to its node layer, or nothing drawn
 * for other Edges layers and for a network that can't be joined. Reused as other results are: for
 * the same arrays, or a refresh with the same values, as long as the node result is the same
 * object and the same columns join them.
 */
function edgeResult(
  frames: DataFrame[],
  results: Array<ConversionResult | undefined>,
  i: number,
  layer: BoundLayer,
  network: NetworkLayers,
  history?: ConversionHistory
): ConversionResult {
  const frame = frames[i];
  const refId = frameRefId(frame, i);
  const join = network.edges === layer ? joinable(frame, layer, frames, results, network) : undefined;
  const inputs: EdgeInputs = join
    ? { nodeResult: join.nodeResult, from: join.from.name, to: join.to.name, nodeId: join.nodeId.name }
    : { from: '', to: '', nodeId: '' };
  const mapping: GeometryMapping = {};
  const key = frame.fields[0]?.values;
  const cached = key && cache.get(key);
  const previous = history?.get(layer.id);

  let result: ConversionResult;
  if (cached && sameEdge(cached, layer.id, inputs) && sameFields(cached.fields, frame)) {
    result = cached.result;
  } else if (previous && sameEdge(previous, layer.id, inputs) && sameData(previous.fields, frame)) {
    result = previous.result;
  } else if (join) {
    result = joinEdges(
      frame,
      { layerId: layer.id, refId, fromField: join.from, toField: join.to },
      frames[network.nodes!.frameIndex!],
      join.nodeResult,
      join.nodeId
    );
  } else {
    result = emptyEdgeResult(layer.id, refId, frame.length);
  }
  if (key && cached?.result !== result) {
    cache.set(key, {
      result,
      fields: frame.fields.map(({ name, values }) => ({ name, values })),
      mapping,
      edge: inputs,
    });
  }
  if (history && previous?.result !== result) {
    history.set(layer.id, { result, mapping, fields: frame.fields.map(copyField), edge: inputs });
  }
  return result;
}

/** What joins the network's edge layer to its nodes, or undefined when something's missing. */
function joinable(
  frame: DataFrame,
  layer: BoundLayer,
  frames: DataFrame[],
  results: Array<ConversionResult | undefined>,
  network: NetworkLayers
): { nodeResult: ConversionResult; from: Field; to: Field; nodeId: Field } | undefined {
  const nodes = network.nodes;
  const nodeResult = nodes && results[nodes.frameIndex!];
  if (!nodes || !nodeResult || nodeResult.noGeometry) {
    return undefined;
  }
  const nodeFrame = frames[nodes.frameIndex!];
  const nodeId = nodes.idField
    ? nodeFrame.fields.find(({ name }) => name === nodes.idField)
    : defaultIdField(nodeFrame);
  const columns = detectEdgeFields(frame, layer.fromField, layer.toField);
  return nodeId && columns.found ? { nodeResult, from: columns.from, to: columns.to, nodeId } : undefined;
}

function sameEdge(cached: { result: ConversionResult; edge?: EdgeInputs }, layerId: string, inputs: EdgeInputs) {
  const edge = cached.edge;
  return (
    cached.result.layerId === layerId &&
    !!edge &&
    edge.nodeResult === inputs.nodeResult &&
    edge.from === inputs.from &&
    edge.to === inputs.to &&
    edge.nodeId === inputs.nodeId
  );
}

function sameLayer(
  cached: { result: ConversionResult; mapping: GeometryMapping; edge?: EdgeInputs },
  layerId: string,
  mapping: GeometryMapping
): boolean {
  return (
    cached.result.layerId === layerId &&
    !cached.edge &&
    cached.mapping.geometryField === mapping.geometryField &&
    cached.mapping.idField === mapping.idField
  );
}

/**
 * Whether the same keys came back in another order: a query without ORDER BY, which makes every
 * refresh count as new data (docs/phase_9.md, Design §3).
 */
function reordered({ featureKeys: before }: ConversionResult, { featureKeys: after }: ConversionResult): boolean {
  if (!before || !after || before.length !== after.length || before.every((key, i) => key === after[i])) {
    return false;
  }
  const keys = new Set(before);
  return after.every((key) => keys.has(key));
}

function sameFields(fields: Cached['fields'], frame: DataFrame): boolean {
  return (
    fields.length === frame.fields.length &&
    fields.every(({ name, values }, i) => frame.fields[i].name === name && frame.fields[i].values === values)
  );
}

/**
 * Whether the frame holds the same values as the copy, by `===`: numbers and text by value,
 * objects (such as parsed JSON) only when they're the same object. 100k rows take a few
 * milliseconds, against hundreds to convert them (docs/phase_8.md, step 8.1).
 */
function sameData(fields: Previous['fields'], frame: DataFrame): boolean {
  if (fields.length !== frame.fields.length) {
    return false;
  }
  return fields.every(({ name, type, values }, i) => {
    const field = frame.fields[i];
    if (field.name !== name || field.type !== type || field.values.length !== values.length) {
      return false;
    }
    for (let row = 0; row < values.length; row++) {
      if (field.values[row] !== values[row]) {
        return false;
      }
    }
    return true;
  });
}

/** A shallow copy: the values themselves (text, numbers) are shared, so it costs one array. */
function copyField({ name, type, values }: DataFrame['fields'][number]): Previous['fields'][number] {
  return { name, type, values: Array.from(values) };
}
