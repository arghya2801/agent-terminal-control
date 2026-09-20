import { describe, expect, it } from 'vitest';
import { parseSavedTabs, type SavedTabs } from './restore';

const saved: SavedTabs = {
  tabs: [
    { kind: 'shell', cwd: null, projectKey: null, project: false, customTitle: null },
    { kind: 'session', provider: 'claude', sessionId: 'abc', cwd: 'D:\p', projectKey: 'd:\p', customTitle: 'mine' },
    { kind: 'shell', cwd: 'D:\p', projectKey: 'd:\p', project: true, customTitle: null },
  ],
  active: 1,
};

describe('parseSavedTabs', () => {
  it('round-trips what was saved', () => {
    expect(parseSavedTabs(JSON.stringify(saved))).toEqual(saved);
  });

  it('treats missing, empty or corrupt storage as nothing to restore', () => {
    expect(parseSavedTabs(null)).toBeNull();
    expect(parseSavedTabs('')).toBeNull();
    expect(parseSavedTabs('{not json')).toBeNull();
    expect(parseSavedTabs('{"tabs":"nope"}')).toBeNull();
    expect(parseSavedTabs('{"tabs":[]}')).toBeNull();
  });

  it('drops malformed tabs and keeps the focused one pointing at the right tab', () => {
    const text = JSON.stringify({
      tabs: [
        { kind: 'session', sessionId: '', cwd: 'D:\p' }, // no id: cannot resume
        { kind: 'mystery' },
        { kind: 'shell', cwd: 'D:\q' },
      ],
      active: 2,
    });
    const r = parseSavedTabs(text);
    expect(r?.tabs).toEqual([
      { kind: 'shell', cwd: 'D:\q', projectKey: null, project: false, customTitle: null },
    ]);
    expect(r?.active).toBe(0);
  });

  it('falls back to the first tab when the focused one was dropped', () => {
    const text = JSON.stringify({ tabs: [{ kind: 'shell' }, null], active: 1 });
    expect(parseSavedTabs(text)?.active).toBe(0);
  });
});
