import { describe, expect, it } from 'vitest';
import { fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('matches letters in order, and nothing else', () => {
    expect(fuzzyScore('game_tracker_app', 'gtr')).not.toBeNull();
    expect(fuzzyScore('game_tracker_app', 'rtg')).toBeNull();
    expect(fuzzyScore('anything', '')).toBe(0);
  });
  it('ranks a substring above a scattered match, and word starts above the middle', () => {
    expect(fuzzyScore('Toggle sidebar', 'side')!).toBeGreaterThan(fuzzyScore('Settings dialog', 'side') ?? -1);
    expect(fuzzyScore('New shell tab', 'shell')!).toBeGreaterThan(fuzzyScore('Unshelled', 'shell')!);
    expect(fuzzyScore('game_tracker_app', 'gta')!).toBeGreaterThan(fuzzyScore('gxxxtxxxa', 'gta')!);
  });
});
