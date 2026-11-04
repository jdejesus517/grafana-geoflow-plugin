import { DEFAULT_LAYER_STYLE, LayerSpec } from '../engine';
import { ConversionResult } from './frameToFeatureCollection';

/** Theme values the layers are styled with, resolved by the panel so this stays pure. */
export interface LayerDefaults {
  /** CSS colors handed to layers in turn. */
  colors: string[];
  /** Point stroke, for contrast with the basemap. */
  outlineColor: string;
}

/**
 * One layer per frame with a geometry column, with the frame's refId as its id (the `perFrame`
 * binding, docs/architecture.md §3.4). Frames without a geometry column are left out. A frame
 * whose rows were all skipped still gets a layer, so its id is stable when a refresh brings
 * valid rows. Colors go by position among the layers, so frames without geometry don't use one.
 */
export function buildLayerSpecs(results: ConversionResult[], defaults: LayerDefaults): LayerSpec[] {
  return results
    .filter((result) => !result.noGeometry)
    .map((result, i) => ({
      id: result.refId,
      data: result.featureCollection,
      style: {
        ...DEFAULT_LAYER_STYLE,
        color: defaults.colors[i % defaults.colors.length],
        outlineColor: defaults.outlineColor,
      },
    }));
}
