import { DataFrame } from '@grafana/data';
import { BoundLayer, ConversionResult, GeometryMapping, frameToFeatureCollection } from '../adapter';

interface Cached {
  result: ConversionResult;
  /** What the result was converted from: each field's name and values array. */
  fields: Array<{ name: string; values: unknown }>;
  mapping: GeometryMapping;
}

/** A layer's last conversion, with a copy of the data it came from. */
interface Previous {
  result: ConversionResult;
  mapping: GeometryMapping;
  fields: Array<{ name: string; type: string; values: unknown[] }>;
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
    // Frames from a data source always have a refId; the fallback keeps layer ids unique.
    const refId = frame.refId ?? `#${i}`;
    const layerId = layer?.id ?? refId;
    seen.add(layerId);
    const mapping: GeometryMapping = { geometryField: layer?.geometryField, idField: layer?.idField };
    const key = frame.fields[0]?.values;
    const cached = key && cache.get(key);
    const previous = history?.get(layerId);
    let result: ConversionResult;
    if (cached && sameLayer(cached, layerId, mapping) && sameFields(cached.fields, frame)) {
      result = cached.result;
    } else if (previous && sameLayer(previous, layerId, mapping) && sameData(previous.fields, frame)) {
      result = previous.result;
    } else {
      result = frameToFeatureCollection({ ...frame, refId }, mapping, layerId);
    }
    if (key && cached?.result !== result) {
      cache.set(key, { result, fields: frame.fields.map(({ name, values }) => ({ name, values })), mapping });
    }
    if (history && previous?.result !== result) {
      history.set(layerId, { result, mapping, fields: frame.fields.map(copyField) });
    }
    return result;
  });
  for (const layerId of history?.keys() ?? []) {
    if (!seen.has(layerId)) {
      history!.delete(layerId);
    }
  }
  return results;
}

function sameLayer(
  cached: { result: ConversionResult; mapping: GeometryMapping },
  layerId: string,
  mapping: GeometryMapping
): boolean {
  return (
    cached.result.layerId === layerId &&
    cached.mapping.geometryField === mapping.geometryField &&
    cached.mapping.idField === mapping.idField
  );
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
