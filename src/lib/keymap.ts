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
  | 'zoomReset'
  | 'openAgentHere'
  | 'openShellHere'
  | 'renameTab'
  | 'openSettings'
  | 'openUsage'
  | 'focusSearch'
  | 'toggleTaskView'
  | 'toggleTaskPanel'
  | 'askAgent'
  | 'showShortcuts'
  | 'toggleSplit'
  | 'focusOtherPane';

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
  // Launch actions for the active tab's project, and the app's pages. Ctrl+Shift+C/V
  // are left alone: terminals use them for copy and paste.
  { key: 'l', ctrl: true, shift: true, action: 'openAgentHere' },
  { key: 'n', ctrl: true, shift: true, action: 'openShellHere' },
  { key: 'r', ctrl: true, shift: true, action: 'renameTab' },
  { key: 'u', ctrl: true, shift: true, action: 'openUsage' },
  { key: 'p', ctrl: true, shift: true, action: 'focusSearch' },
  { key: 'k', ctrl: true, shift: true, action: 'toggleTaskView' },
  { key: 'e', ctrl: true, shift: true, action: 'toggleTaskPanel' },
  { key: 'a', ctrl: true, shift: true, action: 'askAgent' },
  // Ctrl+Comma is the settings chord in most editors; the shell and Claude Code ignore it.
  { key: ',', ctrl: true, shift: false, action: 'openSettings' },
  // `?` is what the key reports with Shift held on a US layout; `/` covers layouts where
  // it does not. Plain F1 is left alone: PSReadLine binds it to command help.
  { key: '?', ctrl: true, shift: true, action: 'showShortcuts' },
  { key: '/', ctrl: true, shift: true, action: 'showShortcuts' },
  // Split panes (#21). Backslash reports as `|` with Shift held on a US layout.
  { key: '|', ctrl: true, shift: true, action: 'toggleSplit' },
  { key: '\\', ctrl: true, shift: true, action: 'toggleSplit' },
  { key: 'o', ctrl: true, shift: true, action: 'focusOtherPane' },
];

/**
 * What each action is called, and where it sits in the shortcut list. Keyed by `Action`,
 * so a new binding without a description here is a type error rather than a chord the
 * help page silently omits.
 */
const DESCRIPTIONS: Record<Action, { group: Group; label: string }> = {
  newTab: { group: 'Tabs', label: 'New shell tab' },
  closeTab: { group: 'Tabs', label: 'Close tab' },
  nextTab: { group: 'Tabs', label: 'Next tab' },
  prevTab: { group: 'Tabs', label: 'Previous tab' },
  renameTab: { group: 'Tabs', label: 'Rename tab' },
  toggleSplit: { group: 'Tabs', label: 'Split into two panes, or back to one' },
  focusOtherPane: { group: 'Tabs', label: 'Focus the other pane' },
  openAgentHere: { group: 'Launch', label: 'Open an agent in this tab’s project' },
  openShellHere: { group: 'Launch', label: 'Open a shell in this tab’s project' },
  askAgent: { group: 'Launch', label: 'Ask agent (scratch directory)' },
  toggleSidebar: { group: 'View', label: 'Show or hide the sidebar' },
  focusSearch: { group: 'View', label: 'Search projects and sessions' },
  toggleTaskView: { group: 'View', label: 'Switch the sidebar between sessions and tasks' },
  toggleTaskPanel: { group: 'View', label: 'Show or hide the task panel' },
  find: { group: 'View', label: 'Find in the terminal' },
  zoomIn: { group: 'View', label: 'Zoom in' },
  zoomOut: { group: 'View', label: 'Zoom out' },
  zoomReset: { group: 'View', label: 'Reset zoom' },
  openSettings: { group: 'Pages', label: 'Settings' },
  openUsage: { group: 'Pages', label: 'Usage' },
  showShortcuts: { group: 'Pages', label: 'This list' },
  toggleDebug: { group: 'Debug', label: 'Debug overlay' },
  toggleDevtools: { group: 'Debug', label: 'WebView devtools' },
};

export type Group = 'Tabs' | 'Launch' | 'View' | 'Pages' | 'Debug';
const GROUP_ORDER: Group[] = ['Tabs', 'Launch', 'View', 'Pages', 'Debug'];

/** How a key reads on a keycap, where that differs from what the event reports. */
const KEY_LABELS: Record<string, string> = {
  tab: 'Tab',
  add: 'Numpad +',
  subtract: 'Numpad −',
  ',': 'Comma',
};

export function chordLabel(b: { key: string; ctrl: boolean; shift: boolean }): string {
  const parts = [];
  if (b.ctrl) parts.push('Ctrl');
  if (b.shift) parts.push('Shift');
  parts.push(KEY_LABELS[b.key] ?? b.key.toUpperCase());
  return parts.join('+');
}

export interface ShortcutGroup {
  group: Group;
  rows: { action: Action; label: string; chords: string[] }[];
}

/**
 * The bindings as the help page shows them: grouped, in a fixed order, with the chords
 * for one action collapsed onto its row. Derived from `BINDINGS`, so the page cannot
 * drift from what the app actually does.
 */
export function shortcutGroups(): ShortcutGroup[] {
  const byAction = new Map<Action, string[]>();
  for (const b of BINDINGS) {
    const chords = byAction.get(b.action) ?? [];
    chords.push(chordLabel(b));
    byAction.set(b.action, chords);
  }
  return GROUP_ORDER.flatMap((group) => {
    const rows = [...byAction].flatMap(([action, chords]) =>
      DESCRIPTIONS[action].group === group
        ? [{ action, label: DESCRIPTIONS[action].label, chords }]
        : [],
    );
    return rows.length > 0 ? [{ group, rows }] : [];
  });
}

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

/**
 * Plain Ctrl+V while the program has bracketed paste on (Claude Code does, PSReadLine
 * does not). Such a key is left to the browser's native paste instead of becoming ^V.
 */
export function isNativePaste(e: ChordEvent, bracketedPaste: boolean): boolean {
  return (
    bracketedPaste &&
    e.type === 'keydown' &&
    e.key.toLowerCase() === 'v' &&
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey
  );
}

/**
 * Shift+Enter as a win32-input-mode key record (`CSI Vk;Sc;Uc;Kd;Cs;Rc _`, down then up).
 * ConPTY runs in win32-input-mode and turns this into a real KEY_EVENT with SHIFT_PRESSED,
 * which Codex reads as Shift+Enter. A bare LF, pasted or typed, reaches Codex as plain
 * Enter and submits (#82).
 */
export const SHIFT_ENTER = '\x1b[13;28;13;1;16;1_\x1b[13;28;13;0;16;1_';

/**
 * Codex binds Shift+Enter to insert a newline, but xterm/WebView2 can collapse it to
 * ordinary Enter. Ctrl+J is ATC's alternate spelling for the same action.
 */
export function codexNewlineInput(e: ChordEvent): string | null {
  if (e.type !== undefined && e.type !== 'keydown') return null;
  if (e.altKey || e.metaKey) return null;
  const matches =
    (e.key.toLowerCase() === 'j' && e.ctrlKey && !e.shiftKey) ||
    (e.key === 'Enter' && !e.ctrlKey && e.shiftKey);
  return matches ? SHIFT_ENTER : null;
}
