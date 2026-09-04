import { describe, expect, it } from 'vitest';
import { createDoubleTap } from './doubleTap';

describe('createDoubleTap', () => {
  it('does not fire on a single tap', () => {
    // A lone Escape must reach the shell, not be swallowed waiting for a partner.
    const t = createDoubleTap(300);
    expect(t.hit(1000)).toBe(false);
  });

  it('fires on the second tap inside the window', () => {
    const t = createDoubleTap(300);
    t.hit(1000);
    expect(t.hit(1200)).toBe(true);
  });

  it('does not fire when the taps are too far apart', () => {
    const t = createDoubleTap(300);
    t.hit(1000);
    expect(t.hit(1400)).toBe(false);
  });

  it('treats a slow third tap as the start of a new sequence', () => {
    const t = createDoubleTap(300);
    t.hit(1000);
    expect(t.hit(1100)).toBe(true);
    // Consumed: the next tap is a first tap again, not an instant re-fire.
    expect(t.hit(1150)).toBe(false);
    expect(t.hit(1200)).toBe(true);
  });

  it('rearms after a miss', () => {
    const t = createDoubleTap(300);
    t.hit(1000);
    expect(t.hit(9000)).toBe(false);
    expect(t.hit(9100)).toBe(true);
  });

  it('is broken by an intervening key', () => {
    // Esc, then a character, then Esc is not a double tap.
    const t = createDoubleTap(300);
    t.hit(1000);
    t.reset();
    expect(t.hit(1100)).toBe(false);
  });

  it('respects the configured window', () => {
    const slow = createDoubleTap(1000);
    slow.hit(0);
    expect(slow.hit(900)).toBe(true);
  });
});
