import { describe, expect, it } from 'vitest';
import { revealPosition, tabWheelDelta } from './scroll';

describe('tab bar scrolling', () => {
  it('keeps a visible tab in place', () => {
    expect(revealPosition(100, 300, 180, 100)).toBe(100);
  });

  it('reveals tabs clipped on either side', () => {
    expect(revealPosition(100, 300, 40, 100)).toBe(40);
    expect(revealPosition(100, 300, 360, 100)).toBe(160);
  });

  it('uses vertical wheel movement unless the device supplies more horizontal movement', () => {
    expect(tabWheelDelta(0, 120)).toBe(120);
    expect(tabWheelDelta(-80, 20)).toBe(-80);
  });
});
