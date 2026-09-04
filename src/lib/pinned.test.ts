import { describe, expect, it } from 'vitest';
import { isPinned, togglePinned, type PinnedProject } from './pinned';

const P = String.raw`D:\Coding\portfolio2`;
const G = String.raw`D:\Coding\game_tracker_app`;

const pin = (path: string, order: number, displayName: string | null = null): PinnedProject => ({
  path,
  displayName,
  order,
});

describe('isPinned', () => {
  it('finds a pinned path', () => {
    expect(isPinned([pin(P, 0)], P)).toBe(true);
  });

  it('is not fooled by casing, separators or a trailing slash', () => {
    // The sidebar and a hand-edited settings file spell paths differently.
    const list = [pin(P, 0)];
    expect(isPinned(list, P.toUpperCase())).toBe(true);
    expect(isPinned(list, 'D:/Coding/portfolio2')).toBe(true);
    expect(isPinned(list, `${P}\\`)).toBe(true);
  });

  it('reports an unpinned path', () => {
    expect(isPinned([pin(P, 0)], G)).toBe(false);
  });
});

describe('togglePinned', () => {
  it('pins a new project', () => {
    const next = togglePinned([], P, 'Portfolio');
    expect(next).toEqual([{ path: P, displayName: 'Portfolio', order: 0 }]);
  });

  it('unpins an already pinned project', () => {
    expect(togglePinned([pin(P, 0)], P)).toEqual([]);
  });

  it('unpins despite a differently spelled path', () => {
    expect(togglePinned([pin(P, 0)], 'd:/coding/portfolio2/')).toEqual([]);
  });

  it('never mutates the list it was given', () => {
    // It is about to be written to the user's settings file.
    const original = [pin(P, 0)];
    const copy = structuredClone(original);
    togglePinned(original, G);
    expect(original).toEqual(copy);
  });

  it('keeps the other pins and their relative order', () => {
    const list = [pin(P, 0), pin(G, 1)];
    const next = togglePinned(list, P);
    expect(next.map((p) => p.path)).toEqual([G]);
  });

  it('renumbers order contiguously after a removal', () => {
    // Otherwise repeated pinning leaves gaps and duplicate positions.
    const list = [pin('a', 0), pin('b', 1), pin('c', 2)];
    const next = togglePinned(list, 'b');
    expect(next.map((p) => p.order)).toEqual([0, 1]);
  });

  it('appends a new pin at the end', () => {
    const next = togglePinned([pin(P, 0)], G);
    expect(next.map((p) => p.path)).toEqual([P, G]);
    expect(next.map((p) => p.order)).toEqual([0, 1]);
  });

  it('preserves an existing displayName on other entries', () => {
    const next = togglePinned([pin(P, 0, 'Portfolio')], G);
    expect(next[0].displayName).toBe('Portfolio');
  });

  it('round-trips: pin then unpin returns the original list', () => {
    const list = [pin(P, 0)];
    expect(togglePinned(togglePinned(list, G), G)).toEqual(list);
  });
});
