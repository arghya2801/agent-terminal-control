import { describe, expect, it } from 'vitest';
import { branchGroups } from './branchGroups';
import type { SessionMeta } from '../types';

function session(id: string, gitBranch: string | null, mtimeMs: number): SessionMeta {
  return {
    id,
    provider: 'claude',
    file: `${id}.jsonl`,
    cwd: null,
    gitBranch,
    label: id,
    labelSource: 'uuid',
    mtimeMs,
    size: 0,
  };
}

describe('branchGroups', () => {
  it('orders groups by their newest session and puts branchless sessions last', () => {
    const groups = branchGroups([
      session('a', 'main', 10),
      session('b', null, 99),
      session('c', 'feat/x', 50),
      session('d', 'main', 60),
      session('e', '', 70),
    ]);
    expect(groups.map((g) => g.branch)).toEqual(['main', 'feat/x', null]);
    expect(groups[0].sessions.map((s) => s.id)).toEqual(['a', 'd']);
    expect(groups[2].sessions.map((s) => s.id)).toEqual(['b', 'e']);
  });

  it('is empty for no sessions', () => {
    expect(branchGroups([])).toEqual([]);
  });
});
