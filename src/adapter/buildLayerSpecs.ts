import { DataFrame, GrafanaTheme2 } from '@grafana/data';
import { LayerSpec } from '../engine';
import { BoundLayer } from './bindLayers';
import { featureStyles } from './featureStyles';
import { ConversionResult } from './frameToFeatureCollection';
import { layerStyle } from './layerStyle';

/**
 * The engine's layers, bottom first, for `layers` (from bindLayers, top first): one per layer
 * whose frame has a geometry column (docs/architecture.md §3.4, docs/phase_7.md, Design §2). A
 * frame whose rows were all skipped still gets a layer, so its id is stable when a refresh brings
 * valid rows. Hidden layers are kept, so showing them reloads nothing.
 *
 * Each layer is styled from its frame's field config (layerStyle). Palette colors go by the
 * frame's position among frames with a geometry column, so moving or hiding a layer doesn't
 * recolor others (docs/phase_7.md, decision 7). Layers with Color by or Size by also get
 * per-feature styles (docs/phase_6.md, Design §2).
 *
 * Edge layers have no per-feature styles yet: styles from a pair's values come in a later
 * node-edge phase.
 *
 * `results` are the conversions of `frames`, in the same order.
 */
export function buildLayerSpecs(
  layers: BoundLayer[],
  results: ConversionResult[],
  frames: DataFrame[],
  theme: GrafanaTheme2,
  { interactive }: { interactive: boolean } = { interactive: true }
): LayerSpec[] {
  const paletteIndex = new Map<number, number>();
  results.forEach((result, i) => !result.noGeometry && paletteIndex.set(i, paletteIndex.size));

  return layers
    .filter((layer) => layer.frameIndex !== undefined && paletteIndex.has(layer.frameIndex))
    .reverse()
    .map((layer) => {
      const i = layer.frameIndex!;
      const [frame, result] = [frames[i], results[i]];
      const edges = layer.role === 'edges';
      const styles = edges ? undefined : featureStyles(frame, result, theme);
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        data: result.featureCollection,
        style: layerStyle(frame, result, paletteIndex.get(i)!, theme, layer.colorName),
        ...(styles && { featureStyles: styles }),
        interactive: interactive && layer.tooltips,
      };
    });
}
