import { describe, expect, it } from 'vitest';
import { applyProfile, pickProfile } from './profiles';
import type { Settings } from '../types';

describe('profiles', () => {
  it('keeps look-and-feel keys only, and copies out of a proxy like Svelte state', () => {
    const ui = new Proxy({ fontSize: 16, hide: ['usage-chip'], keys: { newTab: 'Ctrl+T' } }, {});
    const p = pickProfile(ui);
    expect(p).toEqual({ fontSize: 16, hide: ['usage-chip'] });
    const target = { fontSize: 13, hide: [] } as unknown as Settings['ui'];
    applyProfile(target, p);
    expect(target.fontSize).toBe(16);
    expect(target.hide).not.toBe(p.hide);
  });
});
