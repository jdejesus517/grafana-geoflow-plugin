// Test hook: everything in this file exists only for the e2e tests (docs/phase_3.md, Design §5).
// Features are drawn on a WebGL canvas, so tests can't see them in the DOM. A test sends
// INSPECT_EVENT to a panel's map container (data-testid="geoflow-map"), and the panel writes
// the number of features drawn per layer id, as JSON, to RENDERED_FEATURES_ATTRIBUTE. Nothing
// happens unless a test sends the event. This file has no imports, so tests/ can import it.

/** Test hook: the DOM event a test sends to the map container. */
export const INSPECT_EVENT = 'geoflow:inspect';

/** Test hook: the map container attribute that receives the drawn-feature counts. */
export const RENDERED_FEATURES_ATTRIBUTE = 'data-rendered-features';
