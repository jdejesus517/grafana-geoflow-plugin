/** The most numbers a dash pattern may have. Longer patterns are mistakes, not designs. */
export const MAX_DASH_NUMBERS = 16;

export const DASH_PATTERN_EXAMPLE = 'for example 8, 4';

/**
 * A custom dash pattern (docs/phase_5.md, Design §1): dash and gap lengths in pixels, separated by
 * commas or spaces. Returns the lengths, always an even number of them, or why the text can't be
 * used. An odd count repeats, as in SVG and the browser canvas: `5, 3, 2` is `5, 3, 2, 5, 3, 2`.
 */
export function parseDashPattern(text: string | undefined): { pattern: number[] } | { problem: string } {
  const parts = (text ?? '').split(/[\s,]+/).filter(Boolean);
  if (parts.length === 0) {
    return { problem: `Enter dash and gap lengths in pixels, ${DASH_PATTERN_EXAMPLE}` };
  }
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) {
    return { problem: `Use numbers of 0 or more, separated by commas, ${DASH_PATTERN_EXAMPLE}` };
  }
  if (numbers.length > MAX_DASH_NUMBERS) {
    return { problem: `Use at most ${MAX_DASH_NUMBERS} numbers` };
  }
  if (numbers.every((n) => n === 0)) {
    return { problem: 'At least one length must be more than 0' };
  }
  return { pattern: numbers.length % 2 === 1 ? [...numbers, ...numbers] : numbers };
}

/** Why a dash pattern can't be used, or undefined when it can. For the option's editor. */
export function dashPatternProblem(text: string | undefined): string | undefined {
  const parsed = parseDashPattern(text);
  return 'problem' in parsed ? parsed.problem : undefined;
}
