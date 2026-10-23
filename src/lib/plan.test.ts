import { describe, expect, it } from 'vitest';
import { chipLimit, codexLimits, forecast, limitDuration, limitSeries, planLimits, resetsShort, weeklyBreakdown } from './plan';

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

describe('resetsShort', () => {
  it('is short enough to sit beside the chip', () => {
    const now = Date.parse('2026-10-22T10:00:00Z');
    const at = (mins: number) => new Date(now + mins * 60_000).toISOString();
    expect([resetsShort(null, now), resetsShort(at(-1), now), resetsShort(at(45), now), resetsShort(at(133), now)]).toEqual(['', 'now', '45m', '2h 13m']);
    expect(resetsShort(at(3 * 24 * 60), now)).not.toMatch(/^\d+h/);
  });
});

describe('chipLimit', () => {
  it('shows the 5-hour session even when a weekly limit is fuller, in both response shapes', () => {
    expect(chipLimit(planLimits(real), [])?.label).toBe('Current session');
    const { limits: _, ...old } = real;
    expect(chipLimit(planLimits(old), [])?.key).toBe('five_hour');
  });

  it('falls back to the fullest limit, Claude first, then Codex', () => {
    const weekly = planLimits({ limits: [{ kind: 'weekly_all', percent: 40, resets_at: null }, { kind: 'weekly_opus', percent: 70, resets_at: null }] });
    expect(chipLimit(weekly, [])?.percent).toBe(70);
    const codex = [{ key: 'codex:primary', label: 'Codex · 5h', percent: 12, resetsAt: null }];
    expect(chipLimit([], codex)).toBe(codex[0]);
  });
});

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


it('formats limit windows in days, hours, and minutes without assuming fixed windows', () => {
  expect(limitDuration(10080)).toBe('7 days');
  expect(limitDuration(10800)).toBe('7 days 12 hours');
  expect(limitDuration(300)).toBe('5 hours');
  expect(limitDuration(1501)).toBe('1 day 1 hour 1 minute');
  expect(limitDuration(15)).toBe('15 minutes');
  for (const value of [null, undefined, 0, -1, Infinity, NaN]) {
    expect(limitDuration(value)).toBe('duration unavailable');
  }
});

it('uses Codex window durations and reset times, preferring the multi-bucket response', () => {
  expect(codexLimits({ rateLimits: {primary: {usedPercent: 99}}, rateLimitsByLimitId: {
    codex: {primary: {usedPercent: 25, windowDurationMins: 15, resetsAt: 1730947200}, secondary: null},
  } })).toEqual([{key:'codex:primary',label:'codex · 15 minutes',windowMinutes:15,percent:25,resetsAt:'2024-11-07T02:40:00.000Z'}]);
  expect(codexLimits({rateLimits:null})).toEqual([]);
  expect(codexLimits({rateLimits:{primary:{usedPercent:4}}})[0].label).toContain('duration unavailable');
  const malformed = codexLimits({rateLimits:{primary:{usedPercent:4, windowDurationMins:Infinity, resetsAt:1e30}}})[0];
  expect(malformed.label).toContain('duration unavailable');
  expect(malformed.resetsAt).toBeNull();
});

it('keeps both short and weekly Codex windows using their reported durations', () => {
  const limits = codexLimits({rateLimits: {
    primary: {usedPercent: 45, windowDurationMins: 10080},
    secondary: {usedPercent: 20, windowDurationMins: 300},
  }});
  expect(limits.map(l => [l.windowMinutes, l.label, l.percent])).toEqual([
    [10080, 'codex · 7 days', 45],
    [300, 'codex · 5 hours', 20],
  ]);
});

describe('forecast', () => {
  const h = 3_600_000;
  const now = Date.parse('2026-10-24T12:00:00Z');
  const session = { key: 'session:0', label: 'Current session', percent: 50, resetsAt: new Date(now + 3 * h).toISOString() };

  it('reads one window of one limit, oldest first', () => {
    const other = { ...session, resetsAt: new Date(now - 2 * h).toISOString() };
    const history = [
      { t: now - 0.5 * h, limits: [session] },
      { t: now - 6 * h, limits: [other] },
      // Listed second this time, so its key ends in :1.
      { t: now - 1 * h, limits: [other, { ...session, key: 'session:1', percent: 30, resetsAt: new Date(now + 3 * h + 60_000).toISOString() }] },
    ];
    expect(limitSeries(history, session)).toEqual([{ t: now - h, percent: 30 }, { t: now - 0.5 * h, percent: 50 }]);
  });

  it('projects the last hour of a 5-hour limit to 100%', () => {
    // 20% an hour from 50% at now: full in 2.5 hours, before the reset at 3 hours.
    expect(forecast([{ t: now - h, percent: 30 }, { t: now, percent: 50 }], session, now)).toBe(now + 2.5 * h);
  });

  it('says it lasts until the reset when the pace is slow or flat, and nothing without data', () => {
    expect(forecast([{ t: now - h, percent: 45 }, { t: now, percent: 50 }], session, now)).toBe('reset');
    expect(forecast([{ t: now - h, percent: 50 }, { t: now, percent: 50 }], session, now)).toBe('reset');
    expect(forecast([{ t: now, percent: 50 }], session, now)).toBeNull();
  });
});
