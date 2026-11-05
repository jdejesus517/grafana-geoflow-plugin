import { DataFrame, GrafanaTheme2 } from '@grafana/data';
import { LayerSpec } from '../engine';
import { ConversionResult } from './frameToFeatureCollection';
import { layerStyle } from './layerStyle';

/**
 * One layer per frame with a geometry column, with the frame's refId as its id (the `perFrame`
 * binding, docs/architecture.md §3.4). Frames without a geometry column are left out. A frame
 * whose rows were all skipped still gets a layer, so its id is stable when a refresh brings
 * valid rows. Each layer is styled from its frame's field config (layerStyle); palette colors go
 * by position among the layers, so frames without geometry don't use one.
 *
 * `results` are the conversions of `frames`, in the same order.
 */
export function buildLayerSpecs(
  results: ConversionResult[],
  frames: DataFrame[],
  theme: GrafanaTheme2,
  { interactive }: { interactive: boolean } = { interactive: true }
): LayerSpec[] {
  return results
    .map((result, i) => ({ result, frame: frames[i] }))
    .filter(({ result }) => !result.noGeometry)
    .map(({ result, frame }, layerIndex) => ({
      id: result.refId,
      data: result.featureCollection,
      style: layerStyle(frame, result, layerIndex, theme),
      interactive,
    }));
}
