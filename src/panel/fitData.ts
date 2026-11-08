// When Fit to data moves the map (docs/phase_8.md, Design §3). Pure, so the rules are
// unit-tested without a map; MapPanel calls them when the map mounts and on every change after.
import { ConversionResult } from '../adapter';
import { LayerSpec } from '../engine';
import { Bounds, unionBounds } from '../model';
import { FitSettings } from './options';

/** What the panel last fitted with. Empty until the first fit, and again after switching to Fixed. */
export interface LastFit {
  /** The fit settings it used, as fitKey gives them. */
  settings?: string;
  /** The query response it fitted, for Fit on refresh. */
  requestId?: string;
}

/**
 * Whether the map should fit the data now: on the first data with geometry, when the fit settings
 * change, and in Fit on refresh, on each new query response once it has arrived. Nothing else
 * fits, so a map that scrolls back on screen keeps the user's view.
 */
export function fitDue(
  last: LastFit,
  fit: FitSettings | undefined,
  bounds: Bounds | undefined,
  requestId: string | undefined,
  loading: boolean
): boolean {
  if (!fit || !bounds || loading) {
    return false;
  }
  return last.settings !== fitKey(fit) || (fit.onRefresh && last.requestId !== requestId);
}

/** The LastFit to keep after fitting with `fit` for the response `requestId`. */
export function fitDone(fit: FitSettings, requestId: string | undefined): LastFit {
  return { settings: fitKey(fit), requestId };
}

/** The box around the features of the visible layers, which are the ones a fit frames. */
export function drawnBounds(layers: LayerSpec[], results: ConversionResult[]): Bounds | undefined {
  const drawn = new Set(layers.filter((layer) => layer.visible).map(({ id }) => id));
  return results.reduce<Bounds | undefined>(
    (bounds, result) => (drawn.has(result.layerId) ? unionBounds(bounds, result.bounds) : bounds),
    undefined
  );
}

/** Fit settings as a string, so a change to any of them is seen by comparing two strings. */
function fitKey({ padding, maxZoom, onRefresh }: FitSettings): string {
  return `${padding},${maxZoom},${onRefresh}`;
}
