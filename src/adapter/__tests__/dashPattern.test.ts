import { MAX_DASH_NUMBERS, dashPatternProblem, parseDashPattern } from '../dashPattern';

describe('parseDashPattern', () => {
  it('reads dash and gap lengths separated by commas, spaces or both', () => {
    expect(parseDashPattern('8, 4')).toEqual({ pattern: [8, 4] });
    expect(parseDashPattern('8 4 2 4')).toEqual({ pattern: [8, 4, 2, 4] });
    expect(parseDashPattern(' 8,4 ,, 2  4 ')).toEqual({ pattern: [8, 4, 2, 4] });
  });

  it('takes decimals and zeros', () => {
    expect(parseDashPattern('0, 2.5')).toEqual({ pattern: [0, 2.5] });
  });

  it('repeats an odd count, as SVG does', () => {
    expect(parseDashPattern('5, 3, 2')).toEqual({ pattern: [5, 3, 2, 5, 3, 2] });
    expect(parseDashPattern('4')).toEqual({ pattern: [4, 4] });
  });

  it.each([
    ['', /Enter dash and gap lengths/],
    [undefined, /Enter dash and gap lengths/],
    [' , ', /Enter dash and gap lengths/],
    ['12, x', /numbers of 0 or more/],
    ['8, -4', /numbers of 0 or more/],
    ['8, Infinity', /numbers of 0 or more/],
    ['0, 0', /more than 0/],
    [
      Array(MAX_DASH_NUMBERS + 1)
        .fill('1')
        .join(','),
      /at most 16/,
    ],
  ])('explains why %p can’t be used', (text, problem) => {
    const parsed = parseDashPattern(text);

    expect('problem' in parsed && parsed.problem).toMatch(problem);
    expect(dashPatternProblem(text)).toMatch(problem);
  });

  it('has no problem with a usable pattern', () => {
    expect(dashPatternProblem('8, 4')).toBeUndefined();
  });
});
