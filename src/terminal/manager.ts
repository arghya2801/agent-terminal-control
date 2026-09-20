/**
 * Owns every live `Terminal`, outside the framework. Svelte renders an empty wrapper and
 * this module appends panes into it; a component holding a `Terminal` could have it
 * re-created by the reconciler, destroying scrollback and orphaning the PTY.
 *
 * Two rules that are expensive to rediscover:
 *
 * - `term.onData` must be wired before `pty_spawn`. ConPTY stalls at startup until a
 *   terminal answers its cursor-position request, and xterm only answers if listening.
 * - Only the active tab may hold a WebGL context; WebView2 caps them at ~16 and
 *   silently kills the oldest beyond that.
 */

import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

import { Channel, ptyAck, ptyKill, ptyResize, ptySpawn, ptyWrite } from '../lib/ipc';
import { isNativePaste, matchChord, type Action } from '../lib/keymap';
import { decodeOsc52 } from '../lib/osc52';
import type { Palette } from '../lib/theme';
import { claudeTitle, usableTitle, type Activity } from '../lib/format';
import { cycleIndex } from './cycle';
import type { AgentProvider, SessionMeta, Dims, PtyEvent, SpawnOpts, TabKey, TerminalSettings } from '../types';
import {
  debounce,
  dimsChanged,
  isUsableDims,
  paneStyle,
  panesNeedingResize,
} from './paneGroup';
import {
  defaultFontFamily,
  defaultFontSize,
  defaultScrollback,
  defaultPalette,
  defaultTheme,
  xtermTheme,
  searchDecorations,
} from './theme';

/** Ack once this many unacked bytes accumulate. Matches the Rust backpressure window. */
const ACK_BATCH = 64 * 1024;
const RESIZE_DEBOUNCE_MS = 50;

export interface Tab {
  provider: AgentProvider | null;
  boundSession: string | null;
  existingSessions: string[];
  codexSequence: number | null;
  key: TabKey;
  title: string;
  /** Set by the running program through OSC 0/2, e.g. Claude Code's session name. */
  autoTitle: string | null;
  /** Set by the user; wins over everything else. */
  customTitle: string | null;
  /** Claude Code's state, read from its title; null when Claude is not running. */
  activity: Activity | null;
  /** The session name Claude shows in its title, used to find the sidebar row. */
  claudeName: string | null;
  /** Something happened in this tab while it was in the background; cleared on focus. */
  attention: boolean;
  /** Canonical key of the sidebar project this tab belongs to, if any. */
  projectKey: string | null;
  /** When the tab was opened. Identifies which session Claude went on to create. */
  startedAt: number;
  /** Directory the shell started in; null for the default. Kept to reopen the tab. */
  cwd: string | null;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  container: HTMLDivElement;
  ptyId: string | null;
  exited: boolean;
  exitCode: number | null;
  /** Dimensions applied to this terminal and its PTY. Per tab, not global: a new tab
   *  must be sized on arrival even though pane geometry is unchanged. */
  dims: Dims | null;
  /** Bytes written but not yet acked to Rust, which releases backpressure. */
  unacked: number;
}

const tabs = new Map<TabKey, Tab>();
let activeKey: TabKey | null = null;
let webgl: WebglAddon | null = null;
let wrapper: HTMLElement | null = null;
/** Latest settings-driven appearance; theme.ts stays the fallback. */
let termOptions = {
  fontFamily: defaultFontFamily,
  fontSize: defaultFontSize,
  scrollback: defaultScrollback,
};
/** Latest palette, so a tab opened after a theme change is born with the right colours. */
let termTheme: ITheme = defaultTheme;
let termPalette: Palette = defaultPalette;

type Listener = () => void;
const listeners = new Set<Listener>();
type ChordListener = (action: Action) => void;
const chordListeners = new Set<ChordListener>();
export type AttentionReason = 'finished' | 'bell';
type AttentionListener = (tab: Tab, reason: AttentionReason) => void;
const attentionListeners = new Set<AttentionListener>();

/**
 * Notified when Claude finishes a turn, or a program rings the bell, in a tab the user
 * is not looking at: a background tab, or any tab while the window is unfocused.
 */
export function onAttention(fn: AttentionListener): () => void {
  attentionListeners.add(fn);
  return () => attentionListeners.delete(fn);
}

function flagAttention(tab: Tab, reason: AttentionReason) {
  const background = tab.key !== activeKey;
  if (!background && document.hasFocus()) return;
  // The focused tab needs no badge; it only needs the notification.
  if (background) tab.attention = true;
  for (const l of attentionListeners) l(tab, reason);
}

/** Svelte subscribes here; the manager never imports Svelte. */
export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const l of listeners) l();
}

export function listTabs(): Tab[] {
  return [...tabs.values()];
}
export function getActiveKey(): TabKey | null {
  return activeKey;
}
export function getTab(key: TabKey): Tab | undefined {
  return tabs.get(key);
}

/**
 * Notified when an app chord is pressed while the terminal has focus.
 *
 * xterm owns the keyboard when focused, and -- more importantly -- forwards whatever it
 * handles to the PTY. Listening on `window` would therefore fire the app action *and*
 * send the keystroke to the shell. Chords are matched inside xterm's own interceptor
 * instead, where returning false consumes them outright.
 */
export function onChord(fn: ChordListener): () => void {
  chordListeners.add(fn);
  return () => chordListeners.delete(fn);
}

export function mount(el: HTMLElement) {
  wrapper = el;
  const ro = new ResizeObserver(scheduleFit);
  ro.observe(el);
  // Re-fit after fonts load, or the first measurement uses fallback metrics.
  document.fonts?.ready.then(() => scheduleFit());
}

/** Focus an existing tab for `key`, or create and spawn a new one. */
export async function openTab(
  key: TabKey,
  title: string,
  opts: Omit<SpawnOpts, 'cols' | 'rows'>,
  projectKey: string | null = null,
  provider: AgentProvider | null = null,
  existingSessions: string[] = [],
): Promise<Tab> {
  const existing = tabs.get(key);
  if (existing) {
    activate(key);
    return existing;
  }

  if (!wrapper) throw new Error('terminal manager not mounted');

  const container = document.createElement('div');
  Object.assign(container.style, paneStyle(false));
  wrapper.appendChild(container);

  const term = new Terminal({
    fontFamily: termOptions.fontFamily,
    fontSize: termOptions.fontSize,
    theme: termTheme,
    scrollback: termOptions.scrollback,
    cursorBlink: true,
    cursorStyle: 'bar',
    allowProposedApi: true, // required by addon-unicode11
  });

  const unicode = new Unicode11Addon();
  term.loadAddon(unicode);
  // Correct widths for the box-drawing and emoji in Claude Code's TUI.
  term.unicode.activeVersion = '11';

  const fit = new FitAddon();
  const search = new SearchAddon();
  term.loadAddon(fit);
  term.loadAddon(search);

  // Returning false stops xterm both handling the key and forwarding it to the PTY. It
  // does not stop DOM propagation, so without stopPropagation the window listener runs
  // the same chord a second time -- which cancels out every toggle.
  term.attachCustomKeyEventHandler((e) => {
    // Let the browser run its native paste, which xterm turns into a bracketed paste.
    // Otherwise Ctrl+V goes out as ^V, which Claude Code only reads as "paste an image".
    if (isNativePaste(e, term.modes.bracketedPasteMode)) return false;
    const action = matchChord(e);
    if (!action) return true;
    e.preventDefault();
    e.stopPropagation();
    for (const l of chordListeners) l(action);
    return false;
  });

  term.open(container);

  // Claude Code copies a selection by emitting OSC 52 (and, on Windows, by also spawning
  // a slow powershell Set-Clipboard that can time out). xterm ignores OSC 52 unless
  // handled, which made copies arrive late or not at all.
  term.parser.registerOscHandler(52, (data) => {
    const text = decodeOsc52(data);
    if (text !== null) void writeClipboard(text);
    return true;
  });

  // Image-only clipboard: the native paste has no text, so forward ^V and let Claude
  // Code read the image itself.
  term.textarea?.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd || cd.getData('text/plain') || !term.modes.bracketedPasteMode) return;
    if (cd.files.length > 0 || [...cd.types].includes('Files')) {
      if (tab.ptyId) void ptyWrite(tab.ptyId, '\x16');
    }
  });

  const tab: Tab = {
    provider, boundSession: key.startsWith('session:') ? key.slice(8) : null,
    existingSessions, codexSequence: null,
    key,
    title,
    autoTitle: null,
    customTitle: null,
    activity: null,
    claudeName: null,
    attention: false,
    projectKey,
    startedAt: Date.now(),
    cwd: opts.cwd ?? null,
    term,
    fit,
    search,
    container,
    ptyId: null,
    exited: false,
    exitCode: null,
    dims: null,
    unacked: 0,
  };
  tabs.set(key, tab);

  term.onBell(() => {
    flagAttention(tab, 'bell');
    notify();
  });

  term.onTitleChange((t) => {
    tab.autoTitle = usableTitle(t);
    if (tab.provider === 'codex') { notify(); return; }
    const claude = claudeTitle(t);
    const was = tab.activity;
    tab.activity = claude?.activity ?? null;
    if (was === 'working' && tab.activity === 'idle') flagAttention(tab, 'finished');
    tab.claudeName = claude?.name ?? null;
    notify();
  });

  // Must be visible and laid out before measuring: FitAddon reads zero from a hidden
  // container, and measuring in the insertion frame yields the pre-layout size. Either
  // spawns at the wrong width and garbles a replaying session on the resize that follows.
  activate(key);
  await nextLayout();
  const dims = measure(tab);
  // Size the emulator to match what the PTY is about to be spawned with. Without this
  // the Terminal keeps xterm's 80x24 default while the shell writes at the pane's real
  // width, and a resumed session wraps into garbage until the window is nudged.
  applyDims(tab, dims);

  // --- input path. MUST be wired before pty_spawn (see the module comment).
  term.onData((d) => {
    if (tab.ptyId) void ptyWrite(tab.ptyId, d);
  });
  term.onBinary((d) => {
    if (tab.ptyId) void ptyWrite(tab.ptyId, d);
  });

  // --- output path
  const channel = new Channel<PtyEvent>();
  channel.onmessage = (msg) => {
    if (msg.t === 'o') {
      // The callback fires once xterm has parsed the payload: the honest ack point.
      term.write(msg.d, () => {
        tab.unacked += msg.d.length;
        if (tab.unacked >= ACK_BATCH && tab.ptyId) {
          const n = tab.unacked;
          tab.unacked = 0;
          void ptyAck(tab.ptyId, n);
        }
      });
    } else if (msg.t === 'x') {
      tab.exited = true;
      tab.exitCode = msg.code;
      term.write(`\r\n\x1b[90m[process exited${msg.code === null ? '' : ` with ${msg.code}`}]\x1b[0m\r\n`);
      notify();
    } else if (msg.t === 'e') {
      term.write(`\r\n\x1b[31m[error: ${msg.msg}]\x1b[0m\r\n`);
      notify();
    }
  };

  tab.ptyId = await ptySpawn({ ...opts, provider, cols: dims.cols, rows: dims.rows }, channel);
  notify();
  return tab;
}

/** Apply recorded Codex status. The first observed state is history, never a notification. */
export function bindSessions(bindings: Map<TabKey, string>, sessions: SessionMeta[]) {
  let changed = false;
  for (const tab of tabs.values()) {
    const id = bindings.get(tab.key);
    if (id && !tab.boundSession) { tab.boundSession = id; changed = true; }
    if (tab.provider !== 'codex' || !tab.boundSession || tab.exited) continue;
    const session = sessions.find(s => `${s.provider}:${s.id}` === tab.boundSession);
    if (!session) continue;
    const sequence = session.activitySequence ?? 0;
    if (tab.codexSequence === sequence) continue;
    if (tab.codexSequence !== null && sequence > tab.codexSequence && session.activity === 'idle') flagAttention(tab, 'finished');
    tab.codexSequence = sequence;
    tab.activity = session.activity === 'working' ? 'working' : session.activity === 'idle' ? 'idle' : session.activity === 'interrupted' ? 'interrupted' : null;
    changed = true;
  }
  if (changed) notify();
}

/**
 * Move `delta` tabs from the active one, wrapping. Uses the `tabs` Map's insertion
 * order, which is the order the tab bar renders, so cycling matches what is on screen.
 */
export function cycleTab(delta: number) {
  const keys = [...tabs.keys()];
  if (keys.length < 2) return;
  const current = activeKey ? keys.indexOf(activeKey) : -1;
  activate(keys[cycleIndex(current, keys.length, delta)]);
}

/**
 * Apply appearance from settings to every open tab.
 *
 * Font size changes the cell size, so this must refit: the shell would otherwise keep
 * wrapping at the old column count.
 */
export function applyTerminalSettings(s: TerminalSettings) {
  termOptions = {
    fontFamily: s.fontFamily || defaultFontFamily,
    fontSize: s.fontSize || defaultFontSize,
    scrollback: s.scrollback ?? defaultScrollback,
  };
  for (const t of tabs.values()) {
    t.term.options.fontFamily = termOptions.fontFamily;
    t.term.options.fontSize = termOptions.fontSize;
    t.term.options.scrollback = termOptions.scrollback;
  }
  refit();
}

/**
 * Recolour every open tab. Only colours change, so unlike a font change this needs no
 * refit: the cell size is the same.
 */
export function applyTheme(p: Palette) {
  termPalette = p;
  termTheme = xtermTheme(p);
  for (const t of tabs.values()) t.term.options.theme = termTheme;
}

// --- find ------------------------------------------------------------------

export interface FindResult {
  index: number;
  count: number;
}

type FindListener = (r: FindResult) => void;
const findListeners = new Set<FindListener>();
let findDisposer: (() => void) | null = null;

export function onFindResults(fn: FindListener): () => void {
  findListeners.add(fn);
  return () => findListeners.delete(fn);
}

/** Subscribe to the active tab's search addon; results arrive asynchronously. */
function bindFindResults() {
  findDisposer?.();
  findDisposer = null;
  const tab = activeKey ? tabs.get(activeKey) : null;
  if (!tab) return;
  const sub = tab.search.onDidChangeResults((r) => {
    for (const l of findListeners) l({ index: r.resultIndex, count: r.resultCount });
  });
  findDisposer = () => sub.dispose();
}

export function findInActiveTab(query: string, direction: 1 | -1 = 1): void {
  const tab = activeKey ? tabs.get(activeKey) : null;
  if (!tab) return;
  if (!query) {
    tab.search.clearDecorations();
    for (const l of findListeners) l({ index: -1, count: 0 });
    return;
  }
  const opts = { decorations: searchDecorations(termPalette) };
  if (direction === 1) tab.search.findNext(query, opts);
  else tab.search.findPrevious(query, opts);
}

export function clearFind(): void {
  const tab = activeKey ? tabs.get(activeKey) : null;
  tab?.search.clearDecorations();
}

export function focusActiveTerminal(): void {
  const tab = activeKey ? tabs.get(activeKey) : null;
  tab?.term.focus();
}

export function activate(key: TabKey) {
  if (!tabs.has(key)) return;
  activeKey = key;
  tabs.get(key)!.attention = false;

  for (const t of tabs.values()) {
    Object.assign(t.container.style, paneStyle(t.key === key));
  }

  // One WebGL context, on the active tab only.
  const tab = tabs.get(key)!;
  webgl?.dispose();
  webgl = null;
  try {
    const addon = new WebglAddon();
    // Contexts are lost on OOM or system resume; fall back rather than render nothing.
    addon.onContextLoss(() => {
      addon.dispose();
      if (webgl === addon) webgl = null;
    });
    tab.term.loadAddon(addon);
    webgl = addon;
  } catch {
    // Software rendering or RDP: the DOM renderer is correct, just slower.
  }

  tab.term.focus();
  // Find results are per-terminal, so follow the active tab.
  bindFindResults();
  scheduleFit();
  notify();
}

export async function closeTab(key: TabKey) {
  const tab = tabs.get(key);
  if (!tab) return;

  if (tab.ptyId) {
    try {
      await ptyKill(tab.ptyId);
    } catch {
      // Already gone; closing the tab is still the right outcome.
    }
  }
  if (activeKey === key) {
    webgl?.dispose();
    webgl = null;
  }
  tab.term.dispose();
  tab.container.remove();
  tabs.delete(key);

  if (activeKey === key) {
    activeKey = null;
    const next = tabs.keys().next();
    if (!next.done) activate(next.value);
  }
  notify();
}

/** What the tab bar shows: the user's name, else the program's, else the default. */
export function displayTitle(tab: Tab): string {
  return tab.customTitle ?? tab.autoTitle ?? tab.title;
}

/** An empty name clears the override. */
export function renameTab(key: TabKey, name: string) {
  const tab = tabs.get(key);
  if (!tab) return;
  tab.customTitle = name.trim() || null;
  notify();
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.warn('OSC 52 clipboard write failed', e);
  }
}

/** True when the tab has a live process, i.e. closing it would kill something. */
export function isBusy(key: TabKey): boolean {
  const tab = tabs.get(key);
  return !!tab && !!tab.ptyId && !tab.exited;
}

/** Resolves after the browser has laid out and painted at least once. */
function nextLayout(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function measure(tab: Tab): Dims {
  const proposed = tab.fit.proposeDimensions();
  if (isUsableDims(proposed)) return { cols: proposed.cols, rows: proposed.rows };
  // A sane default beats forwarding zeroes into ConPTY.
  return { cols: 80, rows: 24 };
}

/**
 * All panes share the wrapper's geometry, so dimensions are measured once and applied
 * to every tab — correct here only because there are no splits.
 */
const scheduleFit = debounce(() => {
  const active = activeKey ? tabs.get(activeKey) : null;
  if (!active) return;

  const dims = measure(active);
  // Every pane shares the wrapper's geometry, but each tracks what it has actually been
  // given -- so a newly opened tab is corrected even when nothing about the window moved.
  for (const t of panesNeedingResize([...tabs.values()], dims)) {
    applyDims(t, dims);
  }
}, RESIZE_DEBOUNCE_MS);

/** Resize the emulator and its PTY together, and remember what was applied. */
function applyDims(tab: Tab, dims: Dims) {
  if (!dimsChanged(tab.dims, dims)) return;
  tab.dims = dims;
  tab.term.resize(dims.cols, dims.rows);
  // Only after a PTY exists; openTab applies dims before spawning, and passes the same
  // values to pty_spawn so the two can never disagree.
  if (tab.ptyId) void ptyResize(tab.ptyId, dims.cols, dims.rows);
}

export function refit() {
  scheduleFit();
}

// Terminal instances, their PTY ids, and the WebGL context all live in module scope, and
// none of it survives a hot swap: Vite would keep this module's state while Svelte
// rebuilt the DOM around it, leaving orphaned terminals attached to detached containers
// and a blank pane. Dev reloads the page instead.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
