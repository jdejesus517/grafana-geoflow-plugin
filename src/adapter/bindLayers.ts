import { DataFrame } from '@grafana/data';

/**
 * What a layer is for (docs/node-edge/architecture.md, decision 1): drawn from its own geometry,
 * the points of a network, or the links between them. A panel's network is one Nodes and one
 * Edges layer (decision 8; networkLayers).
 */
export type LayerRole = 'geometry' | 'nodes' | 'edges';

/**
 * A layer's settings in the Layers list, as saved in the panel options (docs/phase_7.md, Design
 * §1). Keyed by layer id, so any other layer binding can use them too. Unset fields keep the
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
  /** Default 'geometry'. */
  role?: LayerRole;
  /** Edges only: the columns holding the ids of the nodes an edge joins; default detected. */
  fromField?: string;
  toField?: string;
  /** Edges only: the list of a clicked edge line starts with each row's direction; default true. */
  showDirection?: boolean;
}

/**
 * How frames become layers (docs/architecture.md §3.4). Only one mode so far: Grafana's Partition
 * by values transformation already splits a query into a frame per value, which perFrame draws as
 * a layer each. A `byColumn` mode is deferred (docs/architecture.md §7).
 */
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
  role: LayerRole;
  fromField?: string;
  toField?: string;
  showDirection: boolean;
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
    role: config?.role === 'nodes' || config?.role === 'edges' ? config.role : 'geometry',
    ...(nonEmpty(config?.fromField) && { fromField: config!.fromField }),
    ...(nonEmpty(config?.toField) && { toField: config!.toField }),
    showDirection: config?.showDirection !== false,
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
  const refIds = frames.map(frameRefId);
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

/** A panel's network: the layers that make it, and the others with a network role. */
export interface NetworkLayers {
  nodes?: BoundLayer;
  edges?: BoundLayer;
  /** Further Nodes and Edges layers. An extra Nodes layer draws as geometry; an extra Edges layer doesn't draw. */
  extras: BoundLayer[];
  /** Network layers whose query returns several frames (Partition by values), so none is used. */
  split: BoundLayer[];
}

/**
 * The network in `layers` (from bindLayers, top first): the first Nodes and the first Edges layer
 * with a frame (docs/node-edge/phase_1.md, decision 6).
 *
 * Partition by values gives each frame a refId of its own, `B-undefined` or `B-fiber`, so a role
 * saved for layer `B` finds no frame. Such settings are reported in `split`, to say why the network
 * isn't drawn.
 */
export function networkLayers(layers: BoundLayer[]): NetworkLayers {
  const network: NetworkLayers = { extras: [], split: [] };
  for (const layer of layers) {
    if (layer.role === 'geometry') {
      continue;
    }
    if (layer.frameIndex === undefined) {
      const splitFrom = `${layer.id}-`;
      if (layers.some((other) => other.refId?.startsWith(splitFrom))) {
        network.split.push(layer);
      }
    } else if (!network[layer.role]) {
      network[layer.role] = layer;
    } else {
      network.extras.push(layer);
    }
  }
  return network;
}

/**
 * The frame's refId. Frames from a data source always have one; frames built by hand (tests,
 * some transformations) may not, and get `#n`, their position, so layer ids stay unique.
 */
export function frameRefId(frame: DataFrame, index: number): string {
  return frame.refId ?? `#${index}`;
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
