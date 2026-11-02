import { PanelPlugin } from '@grafana/data';
import { MapPanel } from './panel/MapPanel';
import { GeoFlowOptions } from './panel/options';

export const plugin = new PanelPlugin<GeoFlowOptions>(MapPanel);
