import { describe, it, expect } from 'vitest';
import { parsePageRange } from '../../src/utils/pageRange';

describe('parsePageRange', () => {
  it('parses a mix of ranges and singles (1-based) into sorted 0-based indices', () => {
    expect(parsePageRange('1-3,5', 10)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('8-10', 10)).toEqual([7, 8, 9]);
  });

  it('swaps reversed ranges', () => {
    expect(parsePageRange('3-1', 10)).toEqual([0, 1, 2]);
  });

  it('clamps to the available page count', () => {
    expect(parsePageRange('8-12', 10)).toEqual([7, 8, 9]);
    expect(parsePageRange('0,11', 10)).toEqual([]); // 0 and 11 are out of [1,10]
  });

  it('dedupes overlapping selections', () => {
    expect(parsePageRange('1,1,2-3,3', 10)).toEqual([0, 1, 2]);
  });

  it('ignores invalid tokens and tolerates whitespace', () => {
    expect(parsePageRange('1,abc,,4', 10)).toEqual([0, 3]);
    expect(parsePageRange(' 2 - 4 , 6 ', 10)).toEqual([1, 2, 3, 5]);
  });

  it('returns [] for empty or all-invalid input', () => {
    expect(parsePageRange('', 10)).toEqual([]);
    expect(parsePageRange('   ', 10)).toEqual([]);
    expect(parsePageRange('foo,-,9-', 10)).toEqual([]);
  });
});
