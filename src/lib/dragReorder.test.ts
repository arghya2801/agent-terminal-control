import { describe, expect, it } from 'vitest';
import { moveItem } from './dragReorder';

describe('moveItem', () => {
  it('moves forward and back, and ignores no-ops and bad indexes', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    const same = ['a', 'b'];
    expect(moveItem(same, 1, 1)).toBe(same);
    expect(moveItem(same, 0, 5)).toBe(same);
  });
});
