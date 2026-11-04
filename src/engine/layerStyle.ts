import { LayerStyle } from './types';

/** Style defaults for the parts the panel doesn't set yet. Phase 5 makes them panel options. */
export const DEFAULT_LAYER_STYLE: Omit<LayerStyle, 'color' | 'outlineColor'> = {
  fillOpacity: 0.35,
  lineWidth: 2,
  pointRadius: 5,
};
