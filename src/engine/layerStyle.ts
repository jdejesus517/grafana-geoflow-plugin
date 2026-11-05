// Pure: LayerSpec → MapLibre style layers (docs/phase_3.md, Design §2). No map needed, so the
// styling rules are unit-tested without WebGL.
// Type-only import: erased at build time, so this module doesn't pull MapLibre into the eager chunk.
import type { ExpressionSpecification, LayerSpecification } from 'maplibre-gl';
import { LayerSpec, LayerStyle, LineStyle } from './types';

/** The style a layer has before any option is set; colors come from the theme. */
export const DEFAULT_LAYER_STYLE: Omit<LayerStyle, 'color' | 'outlineColor'> = {
  opacity: 1,
  fillOpacity: 0.35,
  lineWidth: 2,
  lineStyle: { kind: 'solid' },
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

type Value = string | number | number[] | ExpressionSpecification;
type Properties = Record<string, Value>;

/**
 * MapLibre dash arrays, in line widths (docs/phase_5.md, Design §4). Round line ends add half a
 * width to each end of every dash: dashed draws dashes of 4 widths with gaps of 2, and a dash of
 * length 0 draws a round dot one width across.
 */
const DASH_ARRAYS = { dash: [3, 3], dot: [0, 2] } as const;

/** The line layer's dash array, or undefined for a solid line. */
function dashArray(lineStyle: LineStyle, lineWidth: number): number[] | undefined {
  switch (lineStyle.kind) {
    case 'dash':
    case 'dot':
      return [...DASH_ARRAYS[lineStyle.kind]];
    // Typed in pixels; MapLibre measures in line widths.
    case 'custom':
      return lineStyle.pattern.map((length) => length / lineWidth);
    default:
      return undefined;
  }
}

/**
 * Paint properties per style layer kind. Kept separate so the engine can diff them on a style
 * change; a property left out (a solid line's dash array) goes back to MapLibre's default.
 */
export function paintFor(style: LayerStyle): Record<StyleLayerKind, Properties> {
  const { opacity } = style;
  const dashes = dashArray(style.lineStyle, style.lineWidth);
  return {
    fill: {
      'fill-color': style.color,
      'fill-opacity': whenHighlighted(
        Math.min(1, style.fillOpacity + HIGHLIGHT.fillOpacity) * opacity,
        style.fillOpacity * opacity
      ),
    },
    outline: {
      'line-color': style.color,
      'line-opacity': opacity,
      'line-width': whenHighlighted(OUTLINE_WIDTH + HIGHLIGHT.width, OUTLINE_WIDTH),
    },
    line: {
      'line-color': style.color,
      'line-opacity': opacity,
      'line-width': whenHighlighted(style.lineWidth + HIGHLIGHT.width, style.lineWidth),
      ...(dashes && { 'line-dasharray': dashes }),
    },
    circle: {
      'circle-color': style.color,
      'circle-opacity': opacity,
      'circle-radius': whenHighlighted(style.pointRadius + HIGHLIGHT.radius, style.pointRadius),
      'circle-stroke-color': style.outlineColor,
      'circle-stroke-opacity': opacity,
      'circle-stroke-width': whenHighlighted(HIGHLIGHT.strokeWidth, POINT_STROKE_WIDTH),
    },
  };
}

/**
 * Layout properties per style layer kind, diffed like paint. Lines have round ends, except custom
 * patterns: flat ends keep their dashes and gaps at the lengths typed.
 */
export function layoutFor(style: LayerStyle): Record<StyleLayerKind, Properties> {
  return {
    fill: {},
    outline: { 'line-join': 'round' },
    line: { 'line-join': 'round', 'line-cap': style.lineStyle.kind === 'custom' ? 'butt' : 'round' },
    circle: {},
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
  const layout = layoutFor(spec.style);
  const id = (kind: StyleLayerKind) => styleLayerId(spec.id, kind);
  const layer = (kind: StyleLayerKind, type: 'fill' | 'line' | 'circle') =>
    ({
      id: id(kind),
      type,
      source,
      filter: FILTERS[kind],
      ...(Object.keys(layout[kind]).length > 0 && { layout: layout[kind] }),
      paint: paint[kind],
    }) as LayerSpecification;
  return [layer('fill', 'fill'), layer('outline', 'line'), layer('line', 'line'), layer('circle', 'circle')];
}
