import { BusEventBase, BusEventWithPayload } from '@grafana/data';
import { ViewState } from '../engine';

/**
 * The map's current view, published by the panel on its eventBus as the map moves and when
 * asked. The panel's option editors get the same eventBus (docs/phase_8.md, step 8.1), which is
 * how Use current view hears it.
 */
export class MapViewEvent extends BusEventWithPayload<ViewState> {
  static type = 'geoflow-map-view';
}

/** Asks the panel to publish a MapViewEvent: an editor opened after the map last moved. */
export class MapViewRequestEvent extends BusEventBase {
  static type = 'geoflow-map-view-request';
}
