// Pure: the feature-state calls that bring a layer's per-feature styles up to date
// (docs/phase_6.md, Design §3). No map needed, so the diff is unit-tested without WebGL.
import type { FeatureCollection, SupportedGeometry } from '../model';
import { COLOR_STATE, RADIUS_STATE, WIDTH_STATE } from './layerStyle';
import { FeatureStyles } from './types';

/** A layer's features and their per-feature styles, as applied or as asked for. */
export interface StyledFeatures {
  data: FeatureCollection<SupportedGeometry>;
  featureStyles?: FeatureStyles;
}

/** What to do to one feature's state: keys to set, and keys to remove. */
export interface FeatureStateChange {
  id: number;
  set?: Record<string, string | number>;
  remove?: string[];
}

type Values = [color: string | undefined, radius: number | undefined, width: number | undefined];

const KEYS = [COLOR_STATE, RADIUS_STATE, WIDTH_STATE] as const;
const NONE: Values = [undefined, undefined, undefined];

function valuesAt({ featureStyles }: StyledFeatures, i: number): Values {
  return [featureStyles?.colors?.[i], featureStyles?.radii?.[i], featureStyles?.widths?.[i]];
}

/**
 * The changes from the states set for `before` (undefined: none are set) to those `after` asks
 * for. Only features whose color, radius or width differs get a change. Features are matched by id, so
 * new data keeps the states of features that stay, and features that are gone lose theirs.
 * MapLibre keeps feature-state by id across setData, so those would otherwise linger.
 */
export function featureStateChanges(before: StyledFeatures | undefined, after: StyledFeatures): FeatureStateChange[] {
  const changes: FeatureStateChange[] = [];
  const diff = (id: number, from: Values, to: Values) => {
    let change: FeatureStateChange | undefined;
    for (let k = 0; k < KEYS.length; k++) {
      if (from[k] === to[k]) {
        continue;
      }
      change ??= { id };
      if (to[k] === undefined) {
        (change.remove ??= []).push(KEYS[k]);
      } else {
        (change.set ??= {})[KEYS[k]] = to[k]!;
      }
    }
    if (change) {
      changes.push(change);
    }
  };

  const features = after.data.features;
  const sameData = before?.data === after.data;
  // Where each feature was in `before`, by id, when the data changed.
  const previous = new Map<number, number>();
  if (before && !sameData) {
    before.data.features.forEach((feature, i) => previous.set(feature.id as number, i));
  }
  for (let i = 0; i < features.length; i++) {
    const id = features[i].id as number;
    let from = NONE;
    if (sameData) {
      from = valuesAt(before!, i);
    } else if (previous.has(id)) {
      from = valuesAt(before!, previous.get(id)!);
      previous.delete(id);
    }
    diff(id, from, valuesAt(after, i));
  }
  for (const [id, i] of previous) {
    diff(id, valuesAt(before!, i), NONE);
  }
  return changes;
}
