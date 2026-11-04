import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DataFrame } from '@grafana/data';
import { ConversionResult, FeatureKey, featureByKey, featureDetails, featureKey } from '../adapter';
import { BasemapSpec, FeatureRef, LayerSpec, MapEngine, PointerHit } from '../engine';
import { FeatureTooltip, TooltipFeature } from './FeatureTooltip';
import { TooltipMode } from './options';

interface Options {
  engine: MapEngine | undefined;
  mode: TooltipMode;
  /** Conversion results, in the same order as `frames`. */
  results: ConversionResult[];
  frames: DataFrame[];
  layers: LayerSpec[];
  basemap: BasemapSpec;
  width: number;
  height: number;
}

/** A pinned feature, with what's needed to find it again in newer data. */
interface PinnedRef extends FeatureRef {
  result: ConversionResult;
  key?: FeatureKey;
}

interface Pinned {
  lngLat: [number, number];
  refs: PinnedRef[];
  index: number;
  // What it was pinned on. Any of these changing closes it: the tooltip belonged to that map.
  engine: MapEngine;
  basemap: BasemapSpec;
}

interface Hover {
  lngLat: [number, number];
  refs: FeatureRef[];
  engine: MapEngine;
  results: ConversionResult[];
}

/**
 * Hover and click tooltips (docs/phase_4.md, Design §5): hovering highlights a feature and shows
 * a compact tooltip; clicking pins a full one with a pager and data links. Returns the tooltip's
 * React content, which renders into an element the engine anchors on the map.
 */
export function useFeatureTooltip({
  engine,
  mode,
  results,
  frames,
  layers,
  basemap,
  width,
  height,
}: Options): ReactNode {
  // The panel owns the tooltip's DOM element; the engine only places it.
  const [element] = useState(() => document.createElement('div'));
  const [pinned, setPinned] = useState<Pinned>();
  const [hover, setHover] = useState<Hover>();

  const pinnedShown = useMemo(
    () => (mode === 'off' ? undefined : resolvePinned(pinned, engine, basemap, results)),
    [pinned, engine, basemap, results, mode]
  );
  // New data or another map drops the hover; the next pointer move brings it back.
  const hoverShown =
    hover && hover.engine === engine && hover.results === results && mode !== 'off' ? hover : undefined;

  const handlers = useRef({ click: (_: PointerHit) => {}, hover: (_: PointerHit) => {} });
  useEffect(() => {
    handlers.current = {
      click: (hit) => {
        if (!engine || mode === 'off') {
          return;
        }
        const refs = hit.features.flatMap((ref) => {
          const result = results.find(({ refId }) => refId === ref.layerId);
          return result ? [{ ...ref, result, key: featureKey(result, ref.featureId) }] : [];
        });
        // A click on empty map unpins.
        setPinned(refs.length > 0 ? { lngLat: hit.lngLat, refs, index: 0, engine, basemap } : undefined);
      },
      hover: (hit) => {
        if (!engine || hit.features.length === 0) {
          setHover(undefined);
          return;
        }
        // Hover arrives every animation frame. Keeping the same refs while the features under the
        // pointer don't change means only the tooltip's position updates, not its content.
        setHover((previous) => ({
          lngLat: hit.lngLat,
          refs: previous && sameRefs(previous.refs, hit.features) ? previous.refs : hit.features,
          engine,
          results,
        }));
      },
    };
  });
  useEffect(() => {
    if (!engine) {
      return;
    }
    const offClick = engine.on('click', (hit) => handlers.current.click(hit));
    const offHover = engine.on('hover', (hit) => handlers.current.hover(hit));
    return () => {
      offClick();
      offHover();
    };
  }, [engine]);

  // Escape closes a pinned tooltip.
  useEffect(() => {
    if (!pinnedShown) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinned(undefined);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [pinnedShown]);

  const selected = pinnedShown?.refs[pinnedShown.index];
  const hovered = hoverShown?.refs[0];
  useEffect(
    () => engine?.setSelected(selected && { layerId: selected.layerId, featureId: selected.featureId }),
    [engine, selected]
  );
  useEffect(() => engine?.setHovered(hovered), [engine, hovered]);

  // A pinned tooltip wins; while one is pinned, hovering only moves the highlight.
  const showHover = !pinnedShown && hoverShown && mode === 'hover' ? hoverShown : undefined;
  const lngLat = pinnedShown?.lngLat ?? showHover?.lngLat;
  useEffect(() => {
    if (!engine) {
      return;
    }
    if (lngLat) {
      engine.openTooltip(lngLat, element, { interactive: !!pinnedShown });
    } else {
      engine.closeTooltip();
    }
  }, [engine, element, lngLat, pinnedShown]);

  const shownRefs = pinnedShown?.refs ?? showHover?.refs;
  const features = useMemo(
    () => (shownRefs ? tooltipFeatures(shownRefs, results, frames, layers) : []),
    [shownRefs, results, frames, layers]
  );
  if (!engine || features.length === 0) {
    return null;
  }
  return createPortal(
    <FeatureTooltip
      features={features}
      index={Math.min(pinnedShown?.index ?? 0, features.length - 1)}
      pinned={!!pinnedShown}
      maxWidth={Math.max(160, Math.min(400, width - 32))}
      maxHeight={Math.max(120, height - 40)}
      onIndexChange={(index) => pinnedShown && setPinned({ ...pinnedShown, engine: engine!, basemap, index })}
      onClose={() => setPinned(undefined)}
    />,
    element
  );
}

/**
 * The pinned features as they are in the current data, or undefined when the tooltip should
 * close (docs/phase_4.md, Design §5). A feature whose layer's data changed is found again by its
 * key; without keys, row positions may now be other features, so the tooltip closes.
 */
function resolvePinned(
  pinned: Pinned | undefined,
  engine: MapEngine | undefined,
  basemap: BasemapSpec,
  results: ConversionResult[]
): { lngLat: [number, number]; refs: PinnedRef[]; index: number } | undefined {
  if (!pinned || pinned.engine !== engine || pinned.basemap !== basemap) {
    return undefined;
  }
  const current = pinned.refs[pinned.index];
  const refs: PinnedRef[] = [];
  let index = 0;
  for (const ref of pinned.refs) {
    const result = results.find(({ refId }) => refId === ref.layerId);
    let found: PinnedRef | undefined;
    if (result === ref.result) {
      found = ref;
    } else if (result && ref.key !== undefined) {
      const match = featureByKey(result, ref.key);
      found = match && { ...ref, featureId: match.featureId, result };
    } else if (result) {
      return undefined;
    }
    if (found) {
      if (ref === current) {
        index = refs.length;
      }
      refs.push(found);
    }
  }
  return refs.length > 0 ? { lngLat: pinned.lngLat, refs, index } : undefined;
}

function tooltipFeatures(
  refs: FeatureRef[],
  results: ConversionResult[],
  frames: DataFrame[],
  layers: LayerSpec[]
): TooltipFeature[] {
  return refs.flatMap((ref) => {
    const i = results.findIndex(({ refId }) => refId === ref.layerId);
    const details = i >= 0 ? featureDetails(frames[i], results[i], ref.featureId) : undefined;
    if (!details) {
      return [];
    }
    const color = layers.find(({ id }) => id === ref.layerId)?.style.color ?? 'transparent';
    return [
      {
        layerId: ref.layerId,
        featureId: ref.featureId,
        title: frames[i].name || `Query ${ref.layerId}`,
        color,
        details,
      },
    ];
  });
}

function sameRefs(a: FeatureRef[], b: FeatureRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref.layerId === b[i].layerId && ref.featureId === b[i].featureId);
}
