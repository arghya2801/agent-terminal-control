import { describe, expect, it, vi } from 'vitest';
import { debounce, dimsChanged, isUsableDims, paneStyle } from './paneGroup';

describe('dimsChanged', () => {
  it('treats the first measurement as a change', () => {
    expect(dimsChanged(null, { cols: 80, rows: 24 })).toBe(true);
  });

  it('suppresses identical measurements', () => {
    // Every ConPTY resize repaints the child, so a no-op resize is not free.
    expect(dimsChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 24 })).toBe(false);
  });

  it('detects a change in either axis', () => {
    expect(dimsChanged({ cols: 80, rows: 24 }, { cols: 81, rows: 24 })).toBe(true);
    expect(dimsChanged({ cols: 80, rows: 24 }, { cols: 80, rows: 25 })).toBe(true);
  });
});

describe('isUsableDims', () => {
  it('accepts a real measurement', () => {
    expect(isUsableDims({ cols: 80, rows: 24 })).toBe(true);
  });

  it('rejects the zeroes a hidden container produces', () => {
    // This is the display:none trap: forwarding these would resize ConPTY to nothing.
    expect(isUsableDims({ cols: 0, rows: 24 })).toBe(false);
    expect(isUsableDims({ cols: 80, rows: 0 })).toBe(false);
  });

  it('rejects NaN from an unlaid-out container', () => {
    expect(isUsableDims({ cols: NaN, rows: 24 })).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isUsableDims(null)).toBe(false);
    expect(isUsableDims(undefined)).toBe(false);
  });
});

describe('debounce', () => {
  it('collapses a burst into one trailing call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 50);

    // Modelling a window drag: ~60 events in quick succession.
    for (let i = 0; i < 60; i++) {
      d(i);
      vi.advanceTimersByTime(5);
    }
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenLastCalledWith(59); // the final measurement wins
    vi.useRealTimers();
  });

  it('can be cancelled before firing', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('paneStyle', () => {
  it('hides inactive panes without removing their layout box', () => {
    // The load-bearing assertion: `display: none` would make FitAddon measure zero.
    const inactive = paneStyle(false);
    expect(inactive.visibility).toBe('hidden');
    expect(inactive.display).toBeUndefined();
  });

  it('shows and raises the active pane', () => {
    const active = paneStyle(true);
    expect(active.visibility).toBe('visible');
    expect(Number(active.zIndex)).toBeGreaterThan(Number(paneStyle(false).zIndex));
  });
});
