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

import { createDoubleTap } from '../lib/doubleTap';
import { Channel, ptyAck, ptyKill, ptyResize, ptySpawn, ptyWrite } from '../lib/ipc';
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
} from './theme';

/** Ack once this many unacked bytes accumulate. Matches the Rust backpressure window. */
const ACK_BATCH = 64 * 1024;
const RESIZE_DEBOUNCE_MS = 50;
/** Two Escapes closer together than this leave the terminal. Deliberately tight: a
 *  single Escape must still reach the shell, and Claude Code's own double-Escape is a
 *  real binding we are shadowing (see SESSION.md > Gotchas). */
const DOUBLE_ESCAPE_MS = 300;

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

type Listener = () => void;
const listeners = new Set<Listener>();
const escapeListeners = new Set<Listener>();
/** When false, keystrokes are for the app rather than the shell. */
let terminalHasFocus = true;
let doubleEscapeEnabled = true;
const escapeTap = createDoubleTap(DOUBLE_ESCAPE_MS);

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
 * Notified when the user double-taps Escape to hand focus back to the app.
 *
 * xterm owns the keyboard while it has focus, so app chords like Ctrl+B never arrive.
 * Rather than stealing a chord from the shell -- Ctrl+B is Claude Code's "background
 * this task" -- the terminal is blurred on demand and app keys work normally.
 */
export function onEscapeToApp(fn: Listener): () => void {
  escapeListeners.add(fn);
  return () => escapeListeners.delete(fn);
}

export function setDoubleEscapeEnabled(on: boolean) {
  doubleEscapeEnabled = on;
}

export function isTerminalFocused(): boolean {
  return terminalHasFocus;
}

/** Return keyboard control to the shell. */
export function focusTerminal() {
  const tab = activeKey ? tabs.get(activeKey) : null;
  if (!tab) return;
  terminalHasFocus = true;
  tab.term.focus();
  notify();
}

function leaveTerminal() {
  const tab = activeKey ? tabs.get(activeKey) : null;
  terminalHasFocus = false;
  tab?.term.blur();
  for (const l of escapeListeners) l();
  notify();
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
    fontFamily: defaultFontFamily,
    fontSize: defaultFontSize,
    theme: defaultTheme,
    scrollback: defaultScrollback,
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

  // Returning false stops xterm handling the key *and* forwarding it to the PTY.
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.key !== 'Escape') {
      escapeTap.reset();
      return true;
    }
    if (!doubleEscapeEnabled) return true;
    if (escapeTap.hit(performance.now())) {
      leaveTerminal();
      // Swallow only the second Escape; the first already reached the shell.
      return false;
    }
    return true;
  });

  term.open(container);
  // Clicking back into the terminal is the other way to resume typing at the shell.
  container.addEventListener('mousedown', () => {
    terminalHasFocus = true;
    notify();
  });

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

  if (terminalHasFocus) tab.term.focus();
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
