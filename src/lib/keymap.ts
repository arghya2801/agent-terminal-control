/**
 * The one place that decides whether a keystroke belongs to the app or the shell.
 *
 * App chords live in the `Ctrl+Shift+*` namespace, which neither PSReadLine nor Claude
 * Code binds. That matters more than it sounds: a chord matched here is **consumed**,
 * so anything claimed is taken away from whatever is running in the terminal. Plain
 * `Ctrl+B` in particular must never match — Claude Code uses it to background a task.
 *
 * Matching is deliberately strict (Ctrl and Shift present, Alt and Meta absent) so a
 * near-miss falls through to the shell rather than being silently swallowed.
 */

export type Action = 'toggleSidebar' | 'newTab' | 'toggleDebug' | 'closeTab';

/** The subset of KeyboardEvent this needs, so tests require no DOM. */
export interface ChordEvent {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  /** Only `keydown` acts, so one press is one action. */
  type?: string;
}

const CHORDS: Record<string, Action> = {
  b: 'toggleSidebar',
  t: 'newTab',
  d: 'toggleDebug',
  w: 'closeTab',
};

export function matchChord(e: ChordEvent): Action | null {
  if (e.type !== undefined && e.type !== 'keydown') return null;
  if (!e.ctrlKey || !e.shiftKey) return null;
  if (e.altKey || e.metaKey) return null;
  // `key` arrives uppercased when Shift is held.
  return CHORDS[e.key.toLowerCase()] ?? null;
}

/** Human-readable label for tooltips, so the UI and the keymap cannot drift apart. */
export function chordLabel(action: Action): string {
  const key = Object.entries(CHORDS).find(([, a]) => a === action)?.[0];
  return key ? `Ctrl+Shift+${key.toUpperCase()}` : '';
}
