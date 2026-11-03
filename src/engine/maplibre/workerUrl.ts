// Webpack sees `new URL(<literal>, import.meta.url)`, emits MapLibre's worker as an asset and
// replaces this expression with the asset's served URL under public/plugins/<id>/. MapLibre's own
// lookup is relative to its import.meta.url, which webpack rewrites, so it can't find the worker.
// Kept in its own module because Jest can't compile import.meta; unit tests mock this file.
export const workerUrl = new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href;
