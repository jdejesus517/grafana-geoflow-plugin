import { DataFrame, Field } from '@grafana/data';

export type EdgeFieldDetection = { found: true; from: Field; to: Field } | { found: false; detail: string };

/** One way of naming a from and to column: each side's name from the other's, or undefined. */
interface PairRule {
  toOf: (from: string) => string | undefined;
  fromOf: (to: string) => string | undefined;
}

const exact = (from: string, to: string): PairRule => ({
  toOf: (name) => (name === from ? to : undefined),
  fromOf: (name) => (name === to ? from : undefined),
});

/** `a_site`/`z_site`: the same rest after each prefix. */
const prefix = (from: string, to: string): PairRule => ({
  toOf: (name) => (name.startsWith(from) && name.length > from.length ? to + name.slice(from.length) : undefined),
  fromOf: (name) => (name.startsWith(to) && name.length > to.length ? from + name.slice(to.length) : undefined),
});

/** `site_a`/`site_z`: the same rest before each suffix. */
const suffix = (from: string, to: string): PairRule => ({
  toOf: (name) => (name.endsWith(from) && name.length > from.length ? name.slice(0, -from.length) + to : undefined),
  fromOf: (name) => (name.endsWith(to) && name.length > to.length ? name.slice(0, -to.length) + from : undefined),
});

const NAME_PAIRS: Array<[string, string]> = [
  ['source', 'target'],
  ['from', 'to'],
  ['src', 'dst'],
  ['start', 'end'],
  ['a_end', 'z_end'],
  ['a', 'z'],
];

/**
 * The ways from and to columns are found, in order (docs/node-edge/phase_1.md, Design §2): name
 * pairs, the same with `_id` or `_node` added, then prefix and suffix pairs.
 */
const RULES: PairRule[] = [
  ...NAME_PAIRS.map(([from, to]) => exact(from, to)),
  ...NAME_PAIRS.flatMap(([from, to]) => ['_id', '_node'].map((end) => exact(from + end, to + end))),
  prefix('a_', 'z_'),
  prefix('from_', 'to_'),
  prefix('source_', 'target_'),
  suffix('_a', '_z'),
  suffix('_from', '_to'),
  suffix('_source', '_target'),
];

/** Shown when nothing is found: the names that are. */
export const DETECTED_NAMES = 'source and target, from and to, or a_site and z_site';

/**
 * The columns of an edge frame holding the ids of the nodes each edge joins. Named columns must
 * exist. Otherwise they're found by name, ignoring case: by the first rule that matches, then the
 * first column in frame order. With only one named, the other is found from the same rule.
 */
export function detectEdgeFields(frame: DataFrame, fromField?: string, toField?: string): EdgeFieldDetection {
  const byName = (name: string) => frame.fields.find((field) => field.name === name);
  const byLowerName = (name: string) => frame.fields.find((field) => field.name.toLowerCase() === name);
  const named = { from: fromField ? byName(fromField) : undefined, to: toField ? byName(toField) : undefined };
  if (fromField && !named.from) {
    return { found: false, detail: `From column: no column named ${fromField}` };
  }
  if (toField && !named.to) {
    return { found: false, detail: `To column: no column named ${toField}` };
  }
  if (named.from && named.to) {
    return { found: true, from: named.from, to: named.to };
  }

  if (named.from || named.to) {
    const given = (named.from ?? named.to)!;
    const lower = given.name.toLowerCase();
    for (const rule of RULES) {
      const partnerName = named.from ? rule.toOf(lower) : rule.fromOf(lower);
      const partner = partnerName && byLowerName(partnerName);
      if (partner && partner !== given) {
        return named.from ? { found: true, from: given, to: partner } : { found: true, from: partner, to: given };
      }
    }
    return named.from
      ? { found: false, detail: `To column: no column pairs with ${given.name}; choose one` }
      : { found: false, detail: `From column: no column pairs with ${given.name}; choose one` };
  }

  for (const rule of RULES) {
    for (const field of frame.fields) {
      const toName = rule.toOf(field.name.toLowerCase());
      const to = toName && byLowerName(toName);
      if (to && to !== field) {
        return { found: true, from: field, to };
      }
    }
  }
  return { found: false, detail: `No from and to columns: name them ${DETECTED_NAMES}, or choose them` };
}
