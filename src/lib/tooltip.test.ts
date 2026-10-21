import { describe, expect, it } from 'vitest';
import { splitChord } from './tooltip';

describe('splitChord', () => {
  it('takes a trailing chord off the text', () => {
    expect(splitChord('Toggle projects (Ctrl+Shift+B)')).toEqual({ text: 'Toggle projects', chord: 'Ctrl+Shift+B' });
    expect(splitChord('Close (Esc)')).toEqual({ text: 'Close', chord: 'Esc' });
    expect(splitChord('Settings (Ctrl+,)')).toEqual({ text: 'Settings', chord: 'Ctrl+,' });
  });
  it('leaves other brackets alone', () => {
    expect(splitChord('Tab (double-click to rename)').chord).toBeNull();
    expect(splitChord('Width (px)').chord).toBeNull();
    expect(splitChord('Rescan sessions')).toEqual({ text: 'Rescan sessions', chord: null });
  });
});
