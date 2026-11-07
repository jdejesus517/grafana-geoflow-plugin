import { DataFrame, LoadingState, PanelData } from '@grafana/data';

interface HeldFrame {
  /** The frame, with its own copy of the values. */
  frame: DataFrame;
  /** The arrays it was copied from, to tell whether a frame is the same data. */
  sources: unknown[];
}

/** The last good frames of a panel, in frame order. The panel keeps it across renders. */
export type HeldSeries = { frames: HeldFrame[] };

/**
 * The frames to draw (docs/phase_9.md, Design §2): the panel's, plus, while a query has failed,
 * the last good frames of the queries that have none. Grafana drops a failed query's frames and
 * empties their arrays, on a failed refresh too (step 9.1), so `held` keeps its own shallow copy.
 * The map keeps drawing its last data, and Grafana's error icon says the query failed.
 */
export function holdSeries({ series, state }: Pick<PanelData, 'series' | 'state'>, held: HeldSeries): DataFrame[] {
  if (state === LoadingState.Done || state === LoadingState.Streaming) {
    held.frames = series.map((frame, i) => hold(frame, held.frames[i]));
    return series;
  }
  if (state !== LoadingState.Error) {
    return series;
  }
  const current = new Set(series.map(({ refId }) => refId));
  const frames: DataFrame[] = [];
  const placed = new Set<string | undefined>();
  for (const { frame } of held.frames) {
    if (!current.has(frame.refId)) {
      frames.push(frame);
    } else if (!placed.has(frame.refId)) {
      placed.add(frame.refId);
      frames.push(...series.filter(({ refId }) => refId === frame.refId));
    }
  }
  return [...frames, ...series.filter(({ refId }) => !placed.has(refId))];
}

/** A copy of the frame, reusing the arrays of `previous` when it holds the same data. */
function hold(frame: DataFrame, previous: HeldFrame | undefined): HeldFrame {
  const sources = frame.fields.map(({ values }) => values);
  const same = previous?.sources.length === sources.length && sources.every((s, i) => s === previous?.sources[i]);
  return {
    sources,
    frame: {
      ...frame,
      fields: frame.fields.map((field, i) => ({
        ...field,
        values: same ? previous!.frame.fields[i].values : Array.from(field.values),
      })),
    },
  };
}
