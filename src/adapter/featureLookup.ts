import { ConversionResult, FeatureKey } from './frameToFeatureCollection';

// Lookups between a feature's MapLibre id, its position in the FeatureCollection, its data frame
// row and its key (docs/phase_4.md, Design §2). Each map is built the first time it's needed for
// a result and kept with it; weak keys let old results be garbage collected.
const byId = new WeakMap<ConversionResult, Map<number, number>>();
const byKey = new WeakMap<ConversionResult, Map<FeatureKey, number>>();

/** The feature's position in the result's FeatureCollection, from its MapLibre id. */
export function featureIndex(result: ConversionResult, featureId: number): number | undefined {
  let index = byId.get(result);
  if (!index) {
    index = new Map(result.featureCollection.features.map((feature, i) => [feature.id as number, i]));
    byId.set(result, index);
  }
  return index.get(featureId);
}

/** The data frame row a feature came from. */
export function featureRow(result: ConversionResult, featureId: number): number | undefined {
  const i = featureIndex(result, featureId);
  return i === undefined ? undefined : result.featureRows[i];
}

/** A feature's key, when the result has keys (see ConversionResult.keyField). */
export function featureKey(result: ConversionResult, featureId: number): FeatureKey | undefined {
  const i = featureIndex(result, featureId);
  return i === undefined ? undefined : result.featureKeys?.[i];
}

/** The feature with this key in a (possibly newer) result: its MapLibre id and row. */
export function featureByKey(
  result: ConversionResult,
  key: FeatureKey
): { featureId: number; row: number } | undefined {
  if (!result.featureKeys) {
    return undefined;
  }
  let index = byKey.get(result);
  if (!index) {
    index = new Map(result.featureKeys.map((k, i) => [k, i]));
    byKey.set(result, index);
  }
  const i = index.get(key);
  return i === undefined
    ? undefined
    : { featureId: result.featureCollection.features[i].id as number, row: result.featureRows[i] };
}
