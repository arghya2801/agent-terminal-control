import { describe, expect, it } from 'vitest';
import { cycleIndex } from './cycle';

describe('cycleIndex', () => {
  it('steps forward', () => {
    expect(cycleIndex(0, 3, 1)).toBe(1);
    expect(cycleIndex(1, 3, 1)).toBe(2);
  });

  it('wraps forward off the end', () => {
    expect(cycleIndex(2, 3, 1)).toBe(0);
  });

  it('steps backward', () => {
    expect(cycleIndex(2, 3, -1)).toBe(1);
  });

  it('wraps backward off the start', () => {
    // `-1 % 3` is -1 in JavaScript, so a naive modulo selects no tab at all.
    expect(cycleIndex(0, 3, -1)).toBe(2);
  });

  it('stays put with a single tab', () => {
    expect(cycleIndex(0, 1, 1)).toBe(0);
    expect(cycleIndex(0, 1, -1)).toBe(0);
  });

  it('returns 0 rather than NaN or -1 when there are no tabs', () => {
    expect(cycleIndex(0, 0, 1)).toBe(0);
    expect(cycleIndex(0, 0, -1)).toBe(0);
  });

  it('handles a starting index that is already out of range', () => {
    // The active tab can be closed between keypresses.
    expect(cycleIndex(-1, 3, 1)).toBe(0);
    expect(cycleIndex(9, 3, 1)).toBe(1);
  });

  it('handles steps larger than the list', () => {
    expect(cycleIndex(0, 3, 4)).toBe(1);
    expect(cycleIndex(0, 3, -4)).toBe(2);
  });
});
