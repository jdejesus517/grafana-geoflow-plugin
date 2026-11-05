import { DataFrame } from '@grafana/data';
import { ConversionResult, frameToFeatureCollection } from '../adapter';

interface Cached {
  result: ConversionResult;
  /** What the result was converted from: each field's name and values array. */
  fields: Array<{ name: string; values: unknown }>;
}

/**
 * Conversions by frame data, not frame object (docs/phase_5.md, Design §3). Grafana applies field
 * config by building new frame objects around the same `values` arrays, so a style change hands
 * over new frames whose data hasn't changed. Those keep their conversion, and with it their
 * FeatureCollection object, which the engine then skips. New query results come in new arrays
 * and are converted again. Keyed by the first field's values array; weak keys let old data be
 * garbage collected.
 */
const cache = new WeakMap<object, Cached>();

/** Converts every frame, reusing the result for frames whose data was already converted. */
export function convertFrames(frames: DataFrame[]): ConversionResult[] {
  return frames.map((frame, i) => {
    // Frames from a data source always have a refId; the fallback keeps layer ids unique.
    const refId = frame.refId ?? `#${i}`;
    const key = frame.fields[0]?.values;
    const cached = key && cache.get(key);
    if (cached && cached.result.refId === refId && sameFields(cached.fields, frame)) {
      return cached.result;
    }
    const result = frameToFeatureCollection({ ...frame, refId });
    if (key) {
      cache.set(key, { result, fields: frame.fields.map(({ name, values }) => ({ name, values })) });
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
