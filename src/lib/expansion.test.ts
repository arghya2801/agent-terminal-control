import { beforeEach, describe, expect, it } from 'vitest';
import {
  anyExpanded,
  isExpandedIn,
  setAll,
  setCollapsedIn,
  toggleIn,
  type Collapsed,
} from './expansion';

describe('expansion', () => {
  let collapsed: Collapsed;
  beforeEach(() => {
    collapsed = {};
  });

  it('treats an unknown project as expanded', () => {
    // The default matters: a project that appears while the app is running must show
    // its sessions rather than hide them behind a twisty.
    expect(isExpandedIn(collapsed, 'brand-new')).toBe(true);
  });

  it('toggles closed then open again', () => {
    toggleIn(collapsed, 'p');
    expect(isExpandedIn(collapsed, 'p')).toBe(false);
    toggleIn(collapsed, 'p');
    expect(isExpandedIn(collapsed, 'p')).toBe(true);
  });

  it('forgets keys once re-expanded rather than accumulating them', () => {
    toggleIn(collapsed, 'p');
    toggleIn(collapsed, 'p');
    expect(Object.keys(collapsed)).toEqual([]);
  });

  it('collapsing one project leaves the others open', () => {
    setCollapsedIn(collapsed, 'a', true);
    expect(isExpandedIn(collapsed, 'a')).toBe(false);
    expect(isExpandedIn(collapsed, 'b')).toBe(true);
  });

  describe('anyExpanded', () => {
    it('is true while at least one is open', () => {
      setCollapsedIn(collapsed, 'a', true);
      expect(anyExpanded(collapsed, ['a', 'b'])).toBe(true);
    });

    it('is false once everything is collapsed', () => {
      setAll(collapsed, ['a', 'b'], true);
      expect(anyExpanded(collapsed, ['a', 'b'])).toBe(false);
    });

    it('is false for an empty list', () => {
      expect(anyExpanded(collapsed, [])).toBe(false);
    });
  });

  describe('setAll', () => {
    it('collapses and re-expands every key', () => {
      setAll(collapsed, ['a', 'b', 'c'], true);
      expect(['a', 'b', 'c'].every((k) => !isExpandedIn(collapsed, k))).toBe(true);

      setAll(collapsed, ['a', 'b', 'c'], false);
      expect(['a', 'b', 'c'].every((k) => isExpandedIn(collapsed, k))).toBe(true);
      expect(Object.keys(collapsed)).toEqual([]);
    });

    it('does not touch keys outside the list', () => {
      setCollapsedIn(collapsed, 'other', true);
      setAll(collapsed, ['a'], false);
      expect(isExpandedIn(collapsed, 'other')).toBe(false);
    });
  });
});
