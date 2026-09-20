import { describe, expect, it } from 'vitest';
import { codexLimits, planLimits, weeklyBreakdown } from './plan';

// Trimmed from a real response, codename fields included.
const real = {
  nimbus_quill: { resets_at: null, utilization: 0.0 },
  amber_ladder: null,
  five_hour: { resets_at: '2026-09-16T18:00:00.321799+00:00', utilization: 31.0 },
  seven_day: { resets_at: '2026-09-19T09:59:59.321822+00:00', utilization: 34.0 },
  limits: [
    { group: 'session', kind: 'session', percent: 31, resets_at: '2026-09-16T18:00:00.321799+00:00' },
    { group: 'weekly', kind: 'weekly_all', percent: 34, resets_at: '2026-09-19T09:59:59.321822+00:00' },
  ],
  seven_day_breakdown: {
    rows: [
      { display_name: 'Claude Code', key: 'claude_code', percent: 93 },
      { display_name: 'Chats', key: 'chat', percent: 7 },
      { display_name: 'Cowork', key: 'cowork', percent: 0 },
    ],
  },
};

describe('planLimits', () => {
  it('reads the limits array and ignores codename windows', () => {
    expect(planLimits(real)).toEqual([
      { key: 'session:0', label: 'Current session', percent: 31, resetsAt: real.limits[0].resets_at },
      { key: 'weekly_all:1', label: 'Current week (all models)', percent: 34, resetsAt: real.limits[1].resets_at },
    ]);
  });

  it('falls back to the named windows without a limits array', () => {
    const { limits: _, ...old } = real;
    expect(planLimits(old).map((l) => [l.label, l.percent])).toEqual([
      ['Current session', 31],
      ['Current week (all models)', 34],
    ]);
  });

  it('labels unknown kinds readably and clamps percentages', () => {
    const r = planLimits({ limits: [{ kind: 'weekly_new_thing', percent: 140, resets_at: null }, 'junk'] });
    expect(r).toEqual([{ key: 'weekly_new_thing:0', label: 'weekly new thing', percent: 100, resetsAt: null }]);
  });
});

describe('weeklyBreakdown', () => {
  it('lists products with non-zero share', () => {
    expect(weeklyBreakdown(real)).toEqual([
      { name: 'Claude Code', percent: 93 },
      { name: 'Chats', percent: 7 },
    ]);
    expect(weeklyBreakdown({})).toEqual([]);
  });
});


it('uses Codex window durations and reset times, preferring the multi-bucket response', () => {
  expect(codexLimits({ rateLimits: {primary: {usedPercent: 99}}, rateLimitsByLimitId: {
    codex: {primary: {usedPercent: 25, windowDurationMins: 15, resetsAt: 1730947200}, secondary: null},
  } })).toEqual([{key:'codex:primary',label:'codex · 15 minutes',percent:25,resetsAt:'2024-11-07T02:40:00.000Z'}]);
  expect(codexLimits({rateLimits:null})).toEqual([]);
  expect(codexLimits({rateLimits:{primary:{usedPercent:4}}})[0].label).toContain('duration unavailable');
  const malformed = codexLimits({rateLimits:{primary:{usedPercent:4, windowDurationMins:Infinity, resetsAt:1e30}}})[0];
  expect(malformed.label).toContain('duration unavailable');
  expect(malformed.resetsAt).toBeNull();
});
