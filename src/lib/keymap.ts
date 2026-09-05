/**
 * Decides whether a keystroke belongs to the app or the shell.
 *
 * A match here is consumed by xterm's interceptor, so anything claimed is taken from
 * whatever is running in the terminal. Plain `Ctrl+B` (Claude Code backgrounds a task)
 * and bare `Tab` / `Shift+Tab` must therefore never match. Modifiers are matched exactly
 * so a near-miss falls through rather than being swallowed.
 *
 * These only arrive because WebView2's accelerators are disabled at startup — see
 * `disable_browser_accelerator_keys`.
 */

export type Action =
  | 'toggleSidebar'
  | 'newTab'
  | 'toggleDebug'
  | 'closeTab'
  | 'nextTab'
  | 'prevTab'
  | 'toggleDevtools'
  | 'find'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset';

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
}

const BINDINGS: Binding[] = [
  { key: 'b', ctrl: true, shift: true, action: 'toggleSidebar' },
  { key: 't', ctrl: true, shift: true, action: 'newTab' },
  { key: 'w', ctrl: true, shift: true, action: 'closeTab' },
  { key: 'd', ctrl: true, shift: true, action: 'toggleDebug' },
  { key: 'i', ctrl: true, shift: true, action: 'toggleDevtools' },
  // Ctrl is what separates these from the Tab the shell needs for completion, and from
  // the Shift+Tab Claude Code uses to cycle permission modes.
  { key: 'tab', ctrl: true, shift: false, action: 'nextTab' },
  { key: 'tab', ctrl: true, shift: true, action: 'prevTab' },
  { key: 'f', ctrl: true, shift: true, action: 'find' },
  // Zoom takes plain Ctrl because nothing in a shell or in Claude Code binds these, and
  // WebView2's own Ctrl+/- zoom is disabled. `=` and `-` report as `+` and `_` when
  // Shift is held, and the numpad reports 'Add'/'Subtract'.
  { key: '=', ctrl: true, shift: false, action: 'zoomIn' },
  { key: '+', ctrl: true, shift: true, action: 'zoomIn' },
  { key: 'add', ctrl: true, shift: false, action: 'zoomIn' },
  { key: '-', ctrl: true, shift: false, action: 'zoomOut' },
  { key: 'subtract', ctrl: true, shift: false, action: 'zoomOut' },
  { key: '0', ctrl: true, shift: false, action: 'zoomReset' },
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
