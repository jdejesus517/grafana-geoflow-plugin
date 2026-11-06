import { DataFrame } from '@grafana/data';

/**
 * A layer's settings in the Layers list, as saved in the panel options (docs/phase_7.md, Design
 * §1). Keyed by layer id, so Phase 11's per-value layers can use them too. Unset fields keep the
 * defaults, so dashboards saved before Phase 7 draw as before.
 */
export interface LayerConfig {
  /** The layer's id: the query's refId, unless the query returns several frames (bindPerFrame). */
  id: string;
  /** Shown in tooltips, the legend and the data summary; default: the frame's name or "Query A". */
  name?: string;
  /** Default true. */
  visible?: boolean;
  /** Hover and click tooltips; default true. The panel's Tooltip option still applies. */
  tooltips?: boolean;
  /** Default: detected (docs/architecture.md §3.2). */
  geometryField?: string;
  /** Default: a column named "id". */
  idField?: string;
}

/** How frames become layers (docs/architecture.md §3.4). Phase 11 adds `byColumn`. */
export type LayerBinding = { mode: 'perFrame' };

export const DEFAULT_LAYER_BINDING: LayerBinding = { mode: 'perFrame' };

/** A layer with its settings resolved, and where its data comes from. */
export interface BoundLayer {
  id: string;
  name: string;
  /** What By name colors hash: a typed name, or what Phase 5 hashed (the frame's name or refId). */
  colorName: string;
  visible: boolean;
  tooltips: boolean;
  geometryField?: string;
  idField?: string;
  /** The saved settings; undefined for a layer that has none yet. */
  config?: LayerConfig;
  /** Index into the frames; undefined for saved settings whose frame is gone. */
  frameIndex?: number;
  /** The query, when there's a frame. */
  refId?: string;
}

/** The layers for `frames`, top layer first, by the panel's layer binding. */
export function bindLayers(
  frames: DataFrame[],
  configs: LayerConfig[] | undefined,
  binding: LayerBinding | undefined
): BoundLayer[] {
  switch (binding?.mode ?? DEFAULT_LAYER_BINDING.mode) {
    case 'perFrame':
    default:
      return bindPerFrame(frames, configs ?? []);
  }
}

/**
 * One layer per frame (docs/phase_7.md, Design §2), top layer first.
 *
 * - **Ids:** the frame's refId when it's the query's only frame. When a query returns several,
 *   each is `${refId}:${key}`, the key being the frame's name, else its labels (Partition by
 *   values' As label naming), else `#n`, its position among the query's frames.
 * - **Order:** layers with saved settings in the saved order; layers without any on top of them,
 *   later frames higher, as new layers have always gone on top. Without saved settings, that's
 *   query order with A at the bottom.
 * - **Gone layers:** saved settings whose layer has no frame are kept, without `frameIndex`, so
 *   the editor can show them. They don't draw.
 */
export function bindPerFrame(frames: DataFrame[], configs: LayerConfig[]): BoundLayer[] {
  const configById = new Map<string, LayerConfig>();
  for (const config of configs) {
    if (config && typeof config.id === 'string' && !configById.has(config.id)) {
      configById.set(config.id, config);
    }
  }

  const fromFrames = frameLayers(frames).map(({ id, refId, defaultName, colorName, frameIndex }) => {
    const config = configById.get(id);
    return bound(id, config, { defaultName, colorName, frameIndex, refId });
  });
  const byId = new Map(fromFrames.map((layer) => [layer.id, layer]));

  const saved = [...configById.values()].map(
    (config) => byId.get(config.id) ?? bound(config.id, config, { defaultName: config.id, colorName: config.id })
  );
  const unsaved = fromFrames.filter((layer) => !layer.config).reverse();
  return [...unsaved, ...saved];
}

function bound(
  id: string,
  config: LayerConfig | undefined,
  from: { defaultName: string; colorName: string; frameIndex?: number; refId?: string }
): BoundLayer {
  const name = nonEmpty(config?.name);
  return {
    id,
    name: name ?? from.defaultName,
    colorName: name ?? from.colorName,
    visible: config?.visible !== false,
    tooltips: config?.tooltips !== false,
    ...(nonEmpty(config?.geometryField) && { geometryField: config!.geometryField }),
    ...(nonEmpty(config?.idField) && { idField: config!.idField }),
    ...(config && { config }),
    ...(from.frameIndex !== undefined && { frameIndex: from.frameIndex, refId: from.refId }),
  };
}

interface FrameLayer {
  id: string;
  refId: string;
  defaultName: string;
  colorName: string;
  frameIndex: number;
}

/** Each frame's layer id and default names, in frame order. */
function frameLayers(frames: DataFrame[]): FrameLayer[] {
  // Frames from a data source always have a refId; the fallback keeps layer ids unique.
  const refIds = frames.map((frame, i) => frame.refId ?? `#${i}`);
  const byRefId = new Map<string, number[]>();
  refIds.forEach((refId, i) => byRefId.set(refId, [...(byRefId.get(refId) ?? []), i]));

  return frames.map((frame, i) => {
    const refId = refIds[i];
    const label = frame.name || labelText(frame);
    const siblings = byRefId.get(refId)!;
    if (siblings.length === 1) {
      return {
        id: refId,
        refId,
        defaultName: label || `Query ${refId}`,
        colorName: label || refId,
        frameIndex: i,
      };
    }
    const position = siblings.indexOf(i) + 1;
    const unique = label && siblings.filter((j) => (frames[j].name || labelText(frames[j])) === label).length === 1;
    const key = unique ? label : `#${position}`;
    return {
      id: `${refId}:${key}`,
      refId,
      defaultName: unique ? label : `Query ${refId} (${position})`,
      colorName: unique ? label : `${refId}:${key}`,
      frameIndex: i,
    };
  });
}

/** The labels of the frame's first labelled field, as `name=value, …`; '' without labels. */
function labelText(frame: DataFrame): string {
  const labels = frame.fields.find((field) => field.labels && Object.keys(field.labels).length > 0)?.labels;
  return labels
    ? Object.entries(labels)
        .map(([key, value]) => `${key}=${value}`)
        .join(', ')
    : '';
}

function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
