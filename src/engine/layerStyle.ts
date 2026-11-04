// Pure: LayerSpec → MapLibre style layers (docs/phase_3.md, Design §2). No map needed, so the
// styling rules are unit-tested without WebGL.
// Type-only import: erased at build time, so this module doesn't pull MapLibre into the eager chunk.
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { LayerSpec, LayerStyle } from './types';

/** Style defaults for the parts the panel doesn't set yet. Phase 5 makes them panel options. */
export const DEFAULT_LAYER_STYLE: Omit<LayerStyle, 'color' | 'outlineColor'> = {
  fillOpacity: 0.35,
  lineWidth: 2,
  pointRadius: 5,
};

/** Polygon outlines stay thin, so a dense area of buildings doesn't turn into solid color. */
const OUTLINE_WIDTH = 1;
const POINT_STROKE_WIDTH = 1;

/**
 * How much a hovered or selected feature stands out (docs/phase_4.md, Design §4): wider lines
 * and outlines, a larger point with a thicker stroke, and a stronger fill.
 */
export const HIGHLIGHT = { width: 2, radius: 2, strokeWidth: 2, fillOpacity: 0.25 } as const;

/** Feature-state keys the engine sets for highlights. */
export const HOVERED_STATE = 'hovered';
export const SELECTED_STATE = 'selected';

const highlighted: ExpressionSpecification = [
  'any',
  ['boolean', ['feature-state', SELECTED_STATE], false],
  ['boolean', ['feature-state', HOVERED_STATE], false],
];

function whenHighlighted(value: number, normal: number): ExpressionSpecification {
  return ['case', highlighted, value, normal];
}

/**
 * Prefix for every source and style layer drawn from data. It keeps them apart from the basemap's
 * ids and from any layer in a user's style URL. Layer ids come from refIds, which may contain any
 * character, so ids are only ever built from the prefix, never parsed back.
 */
export const DATA_LAYER_PREFIX = 'geoflow-layer:';

/** The style layers drawn for one LayerSpec, bottom to top: points sit on lines, lines on areas. */
export const STYLE_LAYER_KINDS = ['fill', 'outline', 'line', 'circle'] as const;
export type StyleLayerKind = (typeof STYLE_LAYER_KINDS)[number];

export function dataSourceId(layerId: string): string {
  return DATA_LAYER_PREFIX + layerId;
}

export function styleLayerId(layerId: string, kind: StyleLayerKind): string {
  return `${DATA_LAYER_PREFIX}${layerId}:${kind}`;
}

export function styleLayerIds(layerId: string): string[] {
  return STYLE_LAYER_KINDS.map((kind) => styleLayerId(layerId, kind));
}

/**
 * Matches both simple and Multi* types. MapLibre 6 reports MultiPolygon as Polygon (and so on);
 * older versions reported them separately. The list form is right either way.
 */
function geometryFilter(...types: string[]): ExpressionSpecification {
  return ['match', ['geometry-type'], types, true, false];
}

const FILTERS: Record<StyleLayerKind, ExpressionSpecification> = {
  fill: geometryFilter('Polygon', 'MultiPolygon'),
  outline: geometryFilter('Polygon', 'MultiPolygon'),
  line: geometryFilter('LineString', 'MultiLineString'),
  circle: geometryFilter('Point', 'MultiPoint'),
};

type Paint = Record<string, string | number | ExpressionSpecification>;

/** Paint properties per style layer kind. Kept separate so the engine can diff them on a style change. */
export function paintFor(style: LayerStyle): Record<StyleLayerKind, Paint> {
  return {
    fill: {
      'fill-color': style.color,
      'fill-opacity': whenHighlighted(Math.min(1, style.fillOpacity + HIGHLIGHT.fillOpacity), style.fillOpacity),
    },
    outline: {
      'line-color': style.color,
      'line-width': whenHighlighted(OUTLINE_WIDTH + HIGHLIGHT.width, OUTLINE_WIDTH),
    },
    line: {
      'line-color': style.color,
      'line-width': whenHighlighted(style.lineWidth + HIGHLIGHT.width, style.lineWidth),
    },
    circle: {
      'circle-color': style.color,
      'circle-radius': whenHighlighted(style.pointRadius + HIGHLIGHT.radius, style.pointRadius),
      'circle-stroke-color': style.outlineColor,
      'circle-stroke-width': whenHighlighted(HIGHLIGHT.strokeWidth, POINT_STROKE_WIDTH),
    },
  };
}

/**
 * The four style layers for a spec, all reading its one GeoJSON source. They exist even when the
 * data has no geometry of their kind: an empty filter costs nothing, and a refresh that brings a
 * new geometry type needs no structural change.
 */
export function styleLayers(spec: LayerSpec): LayerSpecification[] {
  const source = dataSourceId(spec.id);
  const paint = paintFor(spec.style);
  const id = (kind: StyleLayerKind) => styleLayerId(spec.id, kind);
  const roundLine = { 'line-join': 'round', 'line-cap': 'round' } as const;
  return [
    { id: id('fill'), type: 'fill', source, filter: FILTERS.fill, paint: paint.fill },
    {
      id: id('outline'),
      type: 'line',
      source,
      filter: FILTERS.outline,
      layout: { 'line-join': 'round' },
      paint: paint.outline,
    },
    { id: id('line'), type: 'line', source, filter: FILTERS.line, layout: roundLine, paint: paint.line },
    { id: id('circle'), type: 'circle', source, filter: FILTERS.circle, paint: paint.circle },
  ];
}
