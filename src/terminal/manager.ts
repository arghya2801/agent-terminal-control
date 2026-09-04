/**
 * Owns every live `Terminal` instance, outside the framework.
 *
 * Svelte renders an empty wrapper div and this module appends panes into it. No
 * component ever holds a `Terminal`: a reconciler that decides to re-create a node
 * would destroy the scrollback and orphan the PTY.
 *
 * Two rules that are easy to violate and expensive to debug:
 *
 * - `term.onData` must be wired **before** `pty_spawn`. ConPTY asks for the cursor
 *   position at startup and stalls until a terminal answers; xterm.js answers for us,
 *   but only if it is already listening. (Rust has a 1.2s watchdog as a safety net, so
 *   the symptom of getting this wrong is a visible delay rather than a dead terminal.)
 * - Only the active tab may hold a WebGL context. WebView2 caps live contexts at ~16
 *   and silently kills the oldest beyond that.
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

import { Channel, ptyAck, ptyKill, ptyResize, ptySpawn, ptyWrite } from '../lib/ipc';
import { matchChord, type Action } from '../lib/keymap';
import { cycleIndex } from './cycle';
import type { Dims, PtyEvent, SpawnOpts, TabKey } from '../types';
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
  defaultTheme,
  searchDecorations,
} from './theme';
import type { TerminalSettings } from '../types';

/** Ack once this many unacked bytes accumulate. Matches the Rust backpressure window. */
const ACK_BATCH = 64 * 1024;
const RESIZE_DEBOUNCE_MS = 50;

export interface Tab {
  key: TabKey;
  title: string;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  container: HTMLDivElement;
  ptyId: string | null;
  exited: boolean;
  exitCode: number | null;
  /** Dimensions currently applied to this terminal and its PTY. Tracked per tab, not
   *  globally: a new tab must be sized on arrival even though pane geometry is
   *  unchanged. */
  dims: Dims | null;
  /** Set while a command is running; drives the close-confirm in phase 3. */
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

type Listener = () => void;
const listeners = new Set<Listener>();
type ChordListener = (action: Action) => void;
const chordListeners = new Set<ChordListener>();

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
    theme: defaultTheme,
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

  // Returning false stops xterm handling the key *and* forwarding it to the PTY, which
  // is the whole point: an app chord must not also land in the shell.
  //
  // It does NOT stop DOM propagation, though. Without the explicit stopPropagation the
  // event still bubbles to the window listener, which matches the same chord and runs
  // the action a second time -- invisible for "new tab" (you get two) but a perfect
  // no-op for every toggle, which is how this surfaced: Ctrl+Shift+B and Ctrl+Shift+D
  // appeared dead while Ctrl+Shift+T and Ctrl+Shift+W appeared to work.
  term.attachCustomKeyEventHandler((e) => {
    const action = matchChord(e);
    if (!action) return true;
    e.preventDefault();
    e.stopPropagation();
    for (const l of chordListeners) l(action);
    return false;
  });

  term.open(container);

  const tab: Tab = {
    key,
    title,
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

  // Show it before measuring, or FitAddon reads a hidden (zero-sized) container, and
  // let the browser complete a layout pass first -- measuring in the same frame the
  // container was inserted yields the pre-layout size. Spawning with the wrong column
  // count then triggers a resize moments later, which garbles a replaying session.
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
      // The write callback fires once xterm has parsed the payload; that is the honest
      // moment to release backpressure.
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

  tab.ptyId = await ptySpawn({ ...opts, cols: dims.cols, rows: dims.rows }, channel);
  notify();
  return tab;
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
  const opts = { decorations: searchDecorations };
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
