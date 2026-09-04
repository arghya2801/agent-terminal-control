/**
 * The one place that decides whether a keystroke belongs to the app or the shell.
 *
 * A chord matched here is **consumed** by xterm's key interceptor, so anything claimed
 * is taken away from whatever is running in the terminal. Two keys must therefore never
 * match: plain `Ctrl+B` (Claude Code backgrounds a task) and bare `Tab` / `Shift+Tab`
 * (completion, and Claude Code's permission-mode cycle).
 *
 * Every modifier is matched exactly, so a near-miss falls through to the shell rather
 * than being silently swallowed.
 *
 * Note these only arrive at all because WebView2's own accelerator keys are disabled at
 * startup — see `disable_browser_accelerator_keys` in `src-tauri/src/lib.rs`.
 */

export type Action =
  | 'toggleSidebar'
  | 'newTab'
  | 'toggleDebug'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'toggleDevtools';

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

interface Binding {
  /** Compared case-insensitively; `key` arrives uppercased while Shift is held. */
  key: string;
  ctrl: boolean;
  shift: boolean;
  action: Action;
  label: string;
}

const BINDINGS: Binding[] = [
  { key: 'b', ctrl: true, shift: true, action: 'toggleSidebar', label: 'Ctrl+Shift+B' },
  { key: 't', ctrl: true, shift: true, action: 'newTab', label: 'Ctrl+Shift+T' },
  { key: 'w', ctrl: true, shift: true, action: 'closeTab', label: 'Ctrl+Shift+W' },
  { key: 'd', ctrl: true, shift: true, action: 'toggleDebug', label: 'Ctrl+Shift+D' },
  { key: 'i', ctrl: true, shift: true, action: 'toggleDevtools', label: 'Ctrl+Shift+I' },
  // Ctrl is what separates these from the Tab the shell needs for completion, and from
  // the Shift+Tab Claude Code uses to cycle permission modes.
  { key: 'tab', ctrl: true, shift: false, action: 'nextTab', label: 'Ctrl+Tab' },
  { key: 'tab', ctrl: true, shift: true, action: 'prevTab', label: 'Ctrl+Shift+Tab' },
];

export function matchChord(e: ChordEvent): Action | null {
  if (e.type !== undefined && e.type !== 'keydown') return null;
  // Alt and Meta are never part of a binding, so holding either means "not ours".
  if (e.altKey || e.metaKey) return null;

  const key = e.key.toLowerCase();
  const hit = BINDINGS.find(
    (b) => b.key === key && b.ctrl === e.ctrlKey && b.shift === e.shiftKey,
  );
  return hit?.action ?? null;
}

/** Human-readable label, so tooltips cannot drift from the keymap. */
export function chordLabel(action: Action): string {
  return BINDINGS.find((b) => b.action === action)?.label ?? '';
}
