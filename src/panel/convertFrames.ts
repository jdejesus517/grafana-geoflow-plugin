import { DataFrame } from '@grafana/data';
import { ConversionResult, frameToFeatureCollection } from '../adapter';

/**
 * Conversions by frame object. Grafana hands over new frame objects only when a query's data
 * changes, so an unchanged frame keeps its FeatureCollection object and the engine skips it
 * (docs/phase_3.md, Design §5). Weak keys let old frames be garbage collected.
 */
const cache = new WeakMap<DataFrame, ConversionResult>();

/** Converts every frame, reusing the result for frames already converted. */
export function convertFrames(frames: DataFrame[]): ConversionResult[] {
  return frames.map((frame, i) => {
    // Frames from a data source always have a refId; the fallback keeps layer ids unique.
    const refId = frame.refId ?? `#${i}`;
    const cached = cache.get(frame);
    if (cached?.refId === refId) {
      return cached;
    }
    const result = frameToFeatureCollection({ ...frame, refId });
    cache.set(frame, result);
    return result;
  });
}
