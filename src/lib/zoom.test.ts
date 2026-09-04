import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  normalizeZoom,
  stepZoom,
  zoomLabel,
  ZOOM_LEVELS,
} from './zoom';

describe('stepZoom', () => {
  it('steps up and down the ladder', () => {
    expect(stepZoom(1.0, 1)).toBe(1.1);
    expect(stepZoom(1.0, -1)).toBe(0.9);
  });

  it('clamps at both ends rather than running away', () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it('never drifts onto fractional values however much it is stepped', () => {
    // The reason for a ladder: repeated multiplication lands on 1.2100000000000002,
    // which then persists to settings and never returns cleanly to 1.
    let z = DEFAULT_ZOOM;
    for (let i = 0; i < 40; i++) z = stepZoom(z, 1);
    for (let i = 0; i < 40; i++) z = stepZoom(z, -1);
    expect(z).toBe(MIN_ZOOM);
    expect(ZOOM_LEVELS).toContain(z);
  });

  it('always moves when starting between rungs', () => {
    // A hand-edited settings file can hold anything; a keypress must still do something.
    expect(stepZoom(1.05, 1)).toBe(1.1);
    expect(stepZoom(1.05, -1)).toBe(1.0);
  });

  it('recovers from a nonsense current value', () => {
    expect(stepZoom(NaN, 1)).toBe(1.1);
    expect(stepZoom(Infinity, -1)).toBe(0.9);
  });

  it('lands on a real rung every time', () => {
    let z = 0.73;
    for (const d of [1, 1, -1, 1, -1, -1] as const) {
      z = stepZoom(z, d);
      expect(ZOOM_LEVELS).toContain(z);
    }
  });
});

describe('normalizeZoom', () => {
  it('passes through a sane value', () => {
    expect(normalizeZoom(1.25)).toBe(1.25);
  });

  it('clamps out-of-range values from a hand-edited file', () => {
    expect(normalizeZoom(99)).toBe(MAX_ZOOM);
    expect(normalizeZoom(0.01)).toBe(MIN_ZOOM);
  });

  it('falls back to 1 for junk', () => {
    expect(normalizeZoom('big')).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(null)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(undefined)).toBe(DEFAULT_ZOOM);
    expect(normalizeZoom(NaN)).toBe(DEFAULT_ZOOM);
  });
});

describe('zoomLabel', () => {
  it('reads as a percentage', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(1.25)).toBe('125%');
    expect(zoomLabel(0.67)).toBe('67%');
  });
});
