import { DataFrame, GrafanaTheme2 } from '@grafana/data';
import { LayerSpec } from '../engine';
import { featureStyles } from './featureStyles';
import { ConversionResult } from './frameToFeatureCollection';
import { layerStyle } from './layerStyle';

/**
 * One layer per frame with a geometry column, with the frame's refId as its id (the `perFrame`
 * binding, docs/architecture.md §3.4). Frames without a geometry column are left out. A frame
 * whose rows were all skipped still gets a layer, so its id is stable when a refresh brings
 * valid rows. Each layer is styled from its frame's field config (layerStyle); palette colors go
 * by position among the layers, so frames without geometry don't use one. Layers with Color by
 * or Size by also get per-feature styles (docs/phase_6.md, Design §2).
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
    .map(({ result, frame }, layerIndex) => {
      const styles = featureStyles(frame, result, theme);
      return {
        id: result.refId,
        name: frame.name || `Query ${result.refId}`,
        visible: true,
        data: result.featureCollection,
        style: layerStyle(frame, result, layerIndex, theme),
        ...(styles && { featureStyles: styles }),
        interactive,
      };
    });
}
