// Framework-neutral map engine (docs/architecture.md §2.4, docs/phase_2.md).
// Must not import @grafana/*, React, or the panel/adapter layers; enforced by eslint.config.mjs.
export { WebGLUnavailableError } from './errors';
export type { BasemapSpec, EngineError, EngineEvents, EngineOptions, EngineTheme, MapEngine, ViewState } from './types';
