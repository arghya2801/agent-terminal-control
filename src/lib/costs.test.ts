import { describe, expect, it } from 'vitest';
import {
  formatTokens,
  formatUsd,
  hourToLocalDay,
  localDay,
  owningProject,
  summarize,
} from './costs';
import type { CostRow } from '../types';

const row = (o: Partial<CostRow>): CostRow => ({
  hour: '2026-09-10T12',
  projectKey: 'd:/a',
  projectPath: 'D:/a',
  model: 'claude-opus-5',
  input: 1,
  output: 1,
  cacheWrite: 1,
  cacheRead: 1,
  costUsd: 1,
  unpriced: false,
  ...o,
});
const name = (k: string, p: string | null) => ({ key: k, name: p ?? 'Unknown' });

describe('owningProject', () => {
  const keys = [String.raw`d:\coding\app`, String.raw`d:\coding\app\nested`, String.raw`d:\coding\apple`];
  it('matches itself or the closest listed ancestor', () => {
    expect(owningProject(String.raw`d:\coding\app`, keys)).toBe(String.raw`d:\coding\app`);
    expect(owningProject(String.raw`d:\coding\app\src-tauri`, keys)).toBe(String.raw`d:\coding\app`);
    expect(owningProject(String.raw`d:\coding\app\nested\x`, keys)).toBe(String.raw`d:\coding\app\nested`);
  });
  it('does not treat a name prefix as an ancestor', () => {
    expect(owningProject(String.raw`d:\coding\apples`, keys)).toBeNull();
    expect(owningProject(String.raw`e:\other`, keys)).toBeNull();
  });
});

describe('summarize', () => {
  it('merges rows that map to the same project', () => {
    const s = summarize(
      [row({ projectKey: 'sub1', costUsd: 2 }), row({ projectKey: 'sub2', costUsd: 3 })],
      '2026-09-01',
      '2026-09-30',
      () => ({ key: 'parent', name: 'Parent' }),
    );
    expect(s.byProject).toEqual([{ key: 'parent', name: 'Parent', cost: 5, tokens: 8 }]);
  });

  it('totals by project, most expensive first', () => {
    const s = summarize(
      [
        row({ costUsd: 1 }),
        row({ projectKey: 'd:/b', projectPath: 'D:/b', costUsd: 5 }),
        row({ costUsd: 2 }),
      ],
      '2026-09-01',
      '2026-09-30',
      name,
    );
    expect(s.total).toBe(8);
    expect(s.tokens).toBe(12);
    expect(s.byProject.map((p) => [p.name, p.cost])).toEqual([
      ['D:/b', 5],
      ['D:/a', 3],
    ]);
  });

  it('drops rows outside the range and fills empty days', () => {
    const inside = row({ hour: '2026-09-10T12' });
    const s = summarize(
      [inside, row({ hour: '2025-01-01T12', costUsd: 99 })],
      hourToLocalDay(inside.hour),
      hourToLocalDay(inside.hour),
      name,
    );
    expect(s.total).toBe(1);
    expect(s.byDay).toHaveLength(1);
    const wide = summarize([inside], '2026-09-08', '2026-09-12', name);
    expect(wide.byDay).toHaveLength(5);
    expect(wide.byDay.reduce((a, d) => a + d.cost, 0)).toBe(1);
  });

  it('lists unpriced models', () => {
    const s = summarize([row({ model: 'x', unpriced: true, costUsd: 0 })], '2026-01-01', '2026-12-31', name);
    expect(s.unpricedModels).toEqual(['x']);
  });
});

describe('formatting', () => {
  it('formats money and tokens', () => {
    expect(formatUsd(3.456)).toBe('$3.46');
    expect(formatUsd(1234.5)).toBe('$1235');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });
  it('localDay pads', () => {
    expect(localDay(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
