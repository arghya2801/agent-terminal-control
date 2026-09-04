import { describe, expect, it } from 'vitest';
import { chordLabel, matchChord, type ChordEvent } from './keymap';

const press = (key: string, mods: Partial<ChordEvent> = {}): ChordEvent => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  type: 'keydown',
  ...mods,
});

const ctrlShift = (key: string) => press(key, { ctrlKey: true, shiftKey: true });

describe('matchChord', () => {
  it('claims the Ctrl+Shift chords', () => {
    expect(matchChord(ctrlShift('B'))).toBe('toggleSidebar');
    expect(matchChord(ctrlShift('T'))).toBe('newTab');
    expect(matchChord(ctrlShift('D'))).toBe('toggleDebug');
    expect(matchChord(ctrlShift('W'))).toBe('closeTab');
  });

  it('accepts the key in either case', () => {
    // `key` arrives uppercased while Shift is held, but do not depend on it.
    expect(matchChord(ctrlShift('b'))).toBe('toggleSidebar');
  });

  describe('keys that belong to the terminal', () => {
    it('never claims plain Ctrl+B', () => {
      // The load-bearing assertion. A match here is consumed and never reaches the PTY,
      // so claiming Ctrl+B would silently break Claude Code's background-task binding.
      expect(matchChord(press('b', { ctrlKey: true }))).toBeNull();
    });

    it('leaves the rest of Claude Code and the shell alone', () => {
      for (const k of ['c', 'r', 't', 'd', 'l', 'o', 'w']) {
        expect(matchChord(press(k, { ctrlKey: true }))).toBeNull();
      }
    });

    it('ignores bare keys and Escape', () => {
      expect(matchChord(press('b'))).toBeNull();
      expect(matchChord(press('Escape'))).toBeNull();
      expect(matchChord(press('Escape', { ctrlKey: true, shiftKey: true }))).toBeNull();
    });

    it('ignores Shift without Ctrl', () => {
      expect(matchChord(press('B', { shiftKey: true }))).toBeNull();
    });

    it('does not claim a near-miss with Alt or Meta held', () => {
      // Falling through to the shell is the safe failure; swallowing is not.
      expect(matchChord(ctrlShift('B'))).not.toBeNull();
      expect(matchChord({ ...ctrlShift('B'), altKey: true })).toBeNull();
      expect(matchChord({ ...ctrlShift('B'), metaKey: true })).toBeNull();
    });

    it('ignores unmapped Ctrl+Shift letters', () => {
      expect(matchChord(ctrlShift('K'))).toBeNull();
    });
  });

  it('acts once per press, not on release', () => {
    expect(matchChord({ ...ctrlShift('B'), type: 'keyup' })).toBeNull();
  });

  it('matches when no event type is supplied', () => {
    // The window listener passes real events; callers constructing their own may not.
    const { type: _omitted, ...noType } = ctrlShift('B');
    expect(matchChord(noType)).toBe('toggleSidebar');
  });
});

describe('chordLabel', () => {
  it('describes each action so tooltips cannot drift from the keymap', () => {
    expect(chordLabel('toggleSidebar')).toBe('Ctrl+Shift+B');
    expect(chordLabel('newTab')).toBe('Ctrl+Shift+T');
    expect(chordLabel('toggleDebug')).toBe('Ctrl+Shift+D');
    expect(chordLabel('closeTab')).toBe('Ctrl+Shift+W');
  });
});
