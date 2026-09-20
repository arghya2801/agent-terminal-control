import { describe, expect, it } from 'vitest';
import {
  monetary,
  formatTokens,
  formatUsd,
  hourToLocalDay,
  localDay,
  owningProject,
  summarize,
  toCsv,
} from './costs';
import type { CostRow } from '../types';

const row = (o: Partial<CostRow>): CostRow => ({
  provider: 'claude',
  totalTokens: (o.input ?? 1) + (o.output ?? 1) + (o.cacheWrite ?? 1) + (o.cacheRead ?? 1),
  reasoning: 0,
  hour: '2026-09-10T12',
  projectKey: 'd:/a',
  projectPath: 'D:/a',
  model: 'claude-opus-5',
  input: 1,
  output: 1,
  cacheWrite: 1,
  cacheRead: 1,
  costUsd: 1,
  sessionId: 's1',
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
  it('keeps Codex tokens visible by day and session when dollar cost is unavailable', () => {
    const s = summarize([
      row({provider: 'codex', sessionId: 'same', totalTokens: 100, costUsd: null}),
      row({provider: 'codex', sessionId: 'same', totalTokens: 50, costUsd: null, projectKey: 'other'}),
      row({provider: 'claude', sessionId: 'same', totalTokens: 10, costUsd: 1}),
    ], '2026-09-01', '2026-09-30', name);
    expect(s.byDay.reduce((n, d) => n + d.tokens, 0)).toBe(160);
    expect(s.bySession.find(x => x.key === 'codex:same')).toMatchObject({tokens: 150, unavailable: true});
    expect(s.bySession.find(x => x.key === 'claude:same')).toMatchObject({tokens: 10, cost: 1});
    expect(s.bySession).toHaveLength(2);
    const allTime = summarize([row({provider: 'codex', totalTokens: 100, costUsd: null})], '2000-01-01', '2026-09-30', name);
    expect(allTime.byDay[0].tokens).toBe(100);
  });
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
    expect(wide.byDay).toHaveLength(3);
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

describe('byModel and sessionsByProject', () => {
  const rows = [
    row({ model: 'claude-opus-5', sessionId: 's1', costUsd: 3 }),
    row({ model: 'claude-sonnet-5', sessionId: 's1', costUsd: 1 }),
    row({ model: 'claude-opus-5', sessionId: 's2', costUsd: 2 }),
    row({ projectKey: 'd:/b', projectPath: 'D:/b', model: 'claude-opus-5', sessionId: 's3', costUsd: 5 }),
  ];
  const s = summarize(rows, '2026-09-01', '2026-09-30', name);

  it('totals each model, dearest first', () => {
    expect(s.byModel).toEqual([
      { key: 'claude:claude-opus-5', cost: 10, tokens: 12 },
      { key: 'claude:claude-sonnet-5', cost: 1, tokens: 4 },
    ]);
  });

  it('breaks a project down by session, dearest first', () => {
    expect(s.sessionsByProject.get('d:/a')?.map((x) => [x.key, x.cost])).toEqual([
      ['claude:s1', 4],
      ['claude:s2', 2],
    ]);
    expect(s.sessionsByProject.get('d:/b')?.map((x) => x.key)).toEqual(['claude:s3']);
  });

  it('leaves out rows outside the range', () => {
    const outside = summarize([...rows, row({ hour: '2020-01-01T00', costUsd: 99 })], '2026-09-01', '2026-09-30', name);
    expect(outside.total).toBe(11);
  });
});

describe('toCsv', () => {
  it('writes a header and one quoted line per row in range', () => {
    const csv = toCsv(
      [row({ costUsd: 1.5, sessionId: 'sess-1' }), row({ hour: '2020-01-01T00' })],
      '2026-09-01',
      '2026-09-30',
      () => ({ key: 'd:/a', name: 'a, with comma' }),
    );
    const lines = csv.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(
      '"provider","day","hour_utc","project","path","model","session","input","output","cache_write","cache_read","reasoning","total_tokens","cost_usd"',
    );
    expect(lines[1]).toContain('"a, with comma"');
    expect(lines[1]).toContain('"claude:sess-1"');
    expect(lines[1]).toContain('"1.500000"');
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('escapes quotes in a name', () => {
    const csv = toCsv([row({})], '2026-09-01', '2026-09-30', () => ({ key: 'k', name: 'say "hi"' }));
    expect(csv).toContain('"say ""hi"""');
  });
});


it('keeps Codex cost unavailable and combined estimates partial without merging provider identities', () => {
  const codex = row({ provider: 'codex', costUsd: null, model: 'shared', totalTokens: 120, input: 50, cacheRead: 50, output: 20, reasoning: 10 });
  const claude = row({ model: 'shared', costUsd: 2 });
  const combined = summarize([codex, claude], '2026-09-01', '2026-09-30', name);
  expect(combined.tokens).toBe(124);
  expect(combined.byModel.map(m => m.key)).toEqual(['claude:shared', 'codex:shared']);
  expect(combined.sessionsByProject.get('d:/a')?.map(s => s.key)).toEqual(['claude:s1','codex:s1']);
  expect(monetary(combined.byProject[0])).toBe('$2.00 (partial)');
  const only = summarize([codex], '2026-09-01', '2026-09-30', name);
  expect(monetary(only.byProject[0])).toBe('Unavailable');
  const csv = toCsv([codex], '2026-09-01', '2026-09-30', name);
  expect(csv).toContain('"codex:s1"');
  expect(csv).toContain('"10","120",""');
  expect(csv).not.toContain('0.000000');
});

it('includes priced Codex usage in project, model, session, daily totals and CSV', () => {
  const codex = row({provider: 'codex', model: 'gpt-6-astra', costUsd: 4.05});
  const result = summarize([codex, row({costUsd: 2})], '2026-09-01', '2026-09-30', name);
  expect(result.total).toBe(6.05);
  expect(result.partial).toBe(false);
  expect(result.byProject[0].cost).toBe(6.05);
  expect(result.byModel.find(m => m.key === 'codex:gpt-6-astra')?.cost).toBe(4.05);
  expect(result.bySession.find(s => s.key === 'codex:s1')?.cost).toBe(4.05);
  expect(result.byDay.reduce((n, d) => n + d.cost, 0)).toBe(6.05);
  expect(toCsv([codex], '2026-09-01', '2026-09-30', name)).toContain('"4.050000"');
});
