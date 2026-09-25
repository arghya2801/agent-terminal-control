import { describe, expect, it } from 'vitest';
import { clampDays, isActive, MAX_DAYS, parseSaved, presetDates, shiftDay } from './range';

const NOW = new Date(2026, 8, 19, 13, 30); // 2026-09-19, local

describe('presetDates', () => {
  it('counts today as the first day', () => {
    expect(presetDates(1, NOW)).toEqual({ from: '2026-09-19', to: '2026-09-19' });
    expect(presetDates(2, NOW)).toEqual({ from: '2026-09-18', to: '2026-09-19' });
    expect(presetDates(7, NOW)).toEqual({ from: '2026-09-13', to: '2026-09-19' });
  });

  it('crosses a month boundary', () => {
    expect(presetDates(30, NOW).from).toBe('2026-08-21');
  });

  it('reaches back past every transcript for all time', () => {
    expect(presetDates(null, NOW)).toEqual({ from: '2000-01-01', to: '2026-09-19' });
  });

  it('clamps a nonsense span rather than producing a broken range', () => {
    expect(presetDates(0, NOW)).toEqual(presetDates(1, NOW));
    expect(presetDates(-5, NOW)).toEqual(presetDates(1, NOW));
    expect(presetDates(99_999, NOW)).toEqual(presetDates(MAX_DAYS, NOW));
  });
});

describe('clampDays', () => {
  it('keeps a whole number in range and rounds a fractional one', () => {
    expect(clampDays(3)).toBe(3);
    expect(clampDays(2.6)).toBe(3);
    expect(clampDays(NaN)).toBe(1);
  });
});

describe('isActive', () => {
  it('matches a preset only, never a custom selection', () => {
    expect(isActive({ kind: 'preset', days: 7 }, 7)).toBe(true);
    expect(isActive({ kind: 'preset', days: 7 }, 30)).toBe(false);
    expect(isActive({ kind: 'preset', days: null }, null)).toBe(true);
    expect(isActive({ kind: 'custom' }, 7)).toBe(false);
  });
});

describe('parseSaved', () => {
  const custom = { from: '2026-01-01', to: '2026-01-05' };

  it('round-trips a preset with a remembered custom range beside it', () => {
    const saved = { selection: { kind: 'preset', days: 7 }, custom };
    expect(parseSaved(JSON.stringify(saved))).toEqual(saved);
  });

  it('round-trips a custom selection', () => {
    const saved = { selection: { kind: 'custom' }, custom };
    expect(parseSaved(JSON.stringify(saved))).toEqual(saved);
  });

  it('reads the shapes stored before Custom existed', () => {
    expect(parseSaved('{"preset":30}')).toEqual({
      selection: { kind: 'preset', days: 30 },
      custom: null,
    });
    expect(parseSaved('{"preset":null}')).toEqual({
      selection: { kind: 'preset', days: null },
      custom: null,
    });
    expect(parseSaved(JSON.stringify(custom))).toEqual({ selection: { kind: 'custom' }, custom });
  });

  it('refuses a custom selection with nothing to restore', () => {
    expect(parseSaved('{"selection":{"kind":"custom"},"custom":null}')).toBeNull();
  });

  it('returns null rather than throwing on junk', () => {
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved('not json')).toBeNull();
    expect(parseSaved('[]')).toBeNull();
    expect(parseSaved('{"selection":{"kind":"wat"}}')).toBeNull();
    expect(parseSaved('{"from":"nope","to":"nope"}')).toBeNull();
  });
});

describe('shiftDay', () => {
  it('steps across month and year ends', () => {
    expect(shiftDay('2026-09-30', 1)).toBe('2026-10-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });
});
