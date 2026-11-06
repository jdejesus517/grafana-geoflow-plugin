import { DataFrame } from '@grafana/data';
import { BoundLayer, ConversionResult, GeometryMapping, frameToFeatureCollection } from '../adapter';

interface Cached {
  result: ConversionResult;
  /** What the result was converted from: each field's name and values array. */
  fields: Array<{ name: string; values: unknown }>;
  mapping: GeometryMapping;
}

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
 */
export function convertFrames(frames: DataFrame[], layers: BoundLayer[] = []): ConversionResult[] {
  const layerByFrame = new Map(
    layers.flatMap((layer) => (layer.frameIndex === undefined ? [] : [[layer.frameIndex, layer]]))
  );
  return frames.map((frame, i) => {
    const layer = layerByFrame.get(i);
    // Frames from a data source always have a refId; the fallback keeps layer ids unique.
    const refId = frame.refId ?? `#${i}`;
    const layerId = layer?.id ?? refId;
    const mapping: GeometryMapping = { geometryField: layer?.geometryField, idField: layer?.idField };
    const key = frame.fields[0]?.values;
    const cached = key && cache.get(key);
    if (
      cached &&
      cached.result.layerId === layerId &&
      cached.mapping.geometryField === mapping.geometryField &&
      cached.mapping.idField === mapping.idField &&
      sameFields(cached.fields, frame)
    ) {
      return cached.result;
    }
    const result = frameToFeatureCollection({ ...frame, refId }, mapping, layerId);
    if (key) {
      cache.set(key, { result, fields: frame.fields.map(({ name, values }) => ({ name, values })), mapping });
    }
    return result;
  });
}

function sameFields(fields: Cached['fields'], frame: DataFrame): boolean {
  return (
    fields.length === frame.fields.length &&
    fields.every(({ name, values }, i) => frame.fields[i].name === name && frame.fields[i].values === values)
  );
}
