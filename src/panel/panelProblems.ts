import { DataFrame } from '@grafana/data';
import {
  BoundLayer,
  ConversionResult,
  DETECTED_NAMES,
  WarningKind,
  dataStyleFields,
  defaultIdField,
  detectEdgeFields,
  networkLayers,
} from '../adapter';
import { WARNING_LABELS, sampleRow } from './conversionSummary';

/** More features than this draw slowly: the limit of the design (docs/architecture.md §4.2). */
export const MANY_FEATURES = 100_000;

/**
 * More layers than this draw and pan slowly: each is a MapLibre source with four style layers
 * (docs/phase_11.md, decision 1). Partition by values on a column with many values gets there
 * easily, since it makes a frame per value.
 */
export const MANY_LAYERS = 50;

export interface PanelProblem {
  /** The layer's name; undefined for a problem with the whole panel. */
  layerName?: string;
  /** The layer's id, for problems the data summary shows under the layer. */
  layerId?: string;
  /** For example "12 rows skipped: invalid 10, out of range 2". */
  text: string;
  /** More about it, such as why the first row was skipped. */
  detail?: string;
}

/** Empty geometry isn't a problem: it's usually intended, such as an asset without a location. */
const SKIPPED_KINDS: WarningKind[] = [
  'invalid',
  'unsupported',
  'projected',
  'outOfRange',
  'unknownNode',
  'selfLoop',
  'missingEnd',
  'duplicateId',
  'notAPoint',
];

/**
 * What's wrong with the layer's settings for its frame: columns it names that aren't there. The
 * warning on the map and the data summary both list these.
 */
export function layerSettingProblems(
  layer: BoundLayer | undefined,
  frame: DataFrame,
  result: ConversionResult
): string[] {
  const missingId = layer?.idField && !frame.fields.some(({ name }) => name === layer.idField);
  // Edge layers have no ID column, and are styled by their pairs' values (docs/node-edge/phase_5.md).
  if (layer?.role === 'edges') {
    return dataStyleFields(frame, result).problems;
  }
  return [
    ...(missingId ? [`ID column: no column named ${layer.idField}`] : []),
    ...(result.noGeometry ? [] : dataStyleFields(frame, result).problems),
  ];
}

/**
 * What stops the panel's network from drawing as set up (docs/node-edge/phase_1.md, Design §6),
 * layer by layer: no node layer, edge columns or node ids not found, extra network layers, and
 * network queries split into frames.
 */
export function networkProblems(
  layers: BoundLayer[],
  frames: DataFrame[],
  results: ConversionResult[]
): PanelProblem[] {
  const network = networkLayers(layers);
  const problem = (layer: BoundLayer, text: string, detail?: string): PanelProblem => ({
    layerName: layer.name,
    layerId: layer.id,
    text,
    ...(detail && { detail }),
  });
  const problems: PanelProblem[] = [];
  const { nodes, edges } = network;
  if (edges) {
    const detection = detectEdgeFields(frames[edges.frameIndex!], edges.fromField, edges.toField);
    if (!detection.found) {
      problems.push(problem(edges, detection.detail, `Edges are found by ${DETECTED_NAMES} columns.`));
    }
    if (!nodes) {
      problems.push(problem(edges, 'No Nodes layer: edges join the points of a Nodes layer'));
    } else if (results[nodes.frameIndex!]?.noGeometry) {
      problems.push(problem(nodes, 'No geometry column: nodes need points for edges to join'));
    } else if (!nodes.idField && !defaultIdField(frames[nodes.frameIndex!])) {
      problems.push(problem(nodes, 'No id column: edges find nodes by an id column, named id unless chosen'));
    }
  }
  for (const extra of network.extras) {
    const used = extra.role === 'nodes' ? nodes : edges;
    problems.push(
      problem(
        extra,
        `Not part of the network, which uses ${used!.name}`,
        extra.role === 'nodes'
          ? 'A panel draws one network, from one Nodes and one Edges layer. This layer draws as plain points.'
          : "A panel draws one network, from one Nodes and one Edges layer. This layer isn't drawn."
      )
    );
  }
  for (const split of network.split) {
    problems.push(
      problem(
        split,
        `Query ${split.id} returns several frames; ${split.role === 'nodes' ? 'a Nodes' : 'an Edges'} layer needs one`,
        'Partition by values splits a query into a frame per value. Remove it from this query, and color by the column instead.'
      )
    );
  }
  return problems;
}

/** Everything the warning on the map lists (docs/phase_9.md, Design §1), layer by layer. */
export function panelProblems(results: ConversionResult[], layers: BoundLayer[], frames: DataFrame[]): PanelProblem[] {
  const problems: PanelProblem[] = results.flatMap((result, i) => {
    const layer = layers.find(({ frameIndex }) => frameIndex === i);
    const layerName = layer?.name ?? result.layerId;
    return [
      ...skippedRows(result, layerName),
      // A query without a geometry column is left out on purpose; a named column that's gone isn't.
      ...(result.noGeometry?.reason === 'fieldNotFound' ? [{ layerName, text: result.noGeometry.detail }] : []),
      ...layerSettingProblems(layer, frames[i], result).map((text) => ({ layerName, text })),
    ];
  });
  problems.push(...networkProblems(layers, frames, results));
  // Every frame with a geometry column is drawn as a layer, hidden ones included: they keep their
  // source (docs/phase_7.md, Design §5).
  const layerCount = results.filter((result) => !result.noGeometry).length;
  if (layerCount > MANY_LAYERS) {
    problems.push({
      text: `${layerCount.toLocaleString('en-US')} layers may draw slowly`,
      detail:
        'Each layer is a frame. Partition by values on a column with many values makes one per value: ' +
        'split on a column with fewer values, or filter the query.',
    });
  }
  const features = results.reduce((total, result) => total + result.featureCollection.features.length, 0);
  if (features > MANY_FEATURES) {
    problems.push({
      text: `${features.toLocaleString('en-US')} features may draw slowly`,
      detail: 'Filter the query, or simplify detailed polygons with ST_SimplifyPreserveTopology.',
    });
  }
  return problems;
}

function skippedRows(result: ConversionResult, layerName: string): PanelProblem[] {
  const { counts, samples } = result.warnings;
  const kinds = SKIPPED_KINDS.filter((kind) => counts[kind] > 0);
  if (kinds.length === 0) {
    return [];
  }
  const total = kinds.reduce((sum, kind) => sum + counts[kind], 0);
  const sample = samples.find(({ kind }) => kinds.includes(kind));
  return [
    {
      layerName,
      text: `${total} ${total === 1 ? 'row' : 'rows'} skipped: ${kinds
        .map((kind) => `${WARNING_LABELS[kind]} ${counts[kind]}`)
        .join(', ')}`,
      ...(sample && { detail: `${sampleRow(sample, 'Row')}: ${sample.detail}` }),
    },
  ];
}
