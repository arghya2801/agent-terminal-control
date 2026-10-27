/**
 * Owns every live `Terminal`, outside the framework. Svelte renders an empty wrapper and
 * this module appends panes into it; a component holding a `Terminal` could have it
 * re-created by the reconciler, destroying scrollback and orphaning the PTY.
 *
 * Two rules that are expensive to rediscover:
 *
 * - `term.onData` must be wired before `pty_spawn`. ConPTY stalls at startup until a
 *   terminal answers its cursor-position request, and xterm only answers if listening.
 * - At most `gpuTabs` (a setting, 4 by default) recently used tabs hold a WebGL context; WebView2 caps them at
 *   ~16 and silently kills the oldest beyond that.
 */

import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { moveItem } from '../lib/dragReorder';
import '@xterm/xterm/css/xterm.css';

import { Channel, ptyAck, ptyBusy, ptyKill, ptyResize, ptySpawn, ptyWrite } from '../lib/ipc';
import { isCopy, isNativePaste, newlineInput, matchChord, type Action } from '../lib/keymap';
import { decodeOsc52 } from '../lib/osc52';
import type { Palette } from '../lib/theme';
import { claudeTitle, tabMark, usableTitle, type Activity, type TabMark } from '../lib/format';
import { cycleIndex } from './cycle';
import type { AgentProvider, SessionMeta, Dims, PtyEvent, SpawnOpts, TabKey, TerminalSettings } from '../types';
import {
  debounce,
  dimsChanged,
  isUsableDims,
  nearestFirst,
  paneStyle,
  showIn,
  slotOf,
  withoutTab,
  type Panes,
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

/** Ack once this many unacked bytes accumulate. Matches the Go backpressure window. */
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
  /** Moved out of "Waiting on you" by the user; cleared when the agent starts working. */
  done: boolean;
  /** Typed in for the agent once it stops working (#158); dropped if the tab exits. */
  queued: string | null;
  /** Canonical key of the sidebar project this tab belongs to, if any. */
  projectKey: string | null;
  /** When the tab was opened. Identifies which session Claude went on to create. */
  startedAt: number;
  /** When output last arrived, for the Open view. Not reactive: read on the view's tick. */
  lastOutputAt: number;
  /** Directory the shell started in; null for the default. Kept to reopen the tab. */
  cwd: string | null;
  /** Null for an agent tab: its chat runs in the sidecar, not in a terminal. */
  term: Terminal | null;
  fit: FitAddon | null;
  search: SearchAddon | null;
  container: HTMLDivElement;
  ptyId: string | null;
  exited: boolean;
  exitCode: number | null;
  /** Dimensions applied to this terminal and its PTY. Per tab, not global: a new tab
   *  must be sized on arrival even though pane geometry is unchanged. */
  dims: Dims | null;
  /** Bytes written but not yet acked to Go, which releases backpressure. */
  unacked: number;
  /** The state the sidebar shows, and since when: "waiting 12m", and who waited longest. */
  mark: TabMark;
  markSince: number;
  /** Output bytes per BUCKET_MS, oldest first, ending at `bucketAt`. */
  buckets: number[];
  bucketAt: number;
}

const BUCKET_MS = 10_000;
const BUCKETS = 30;

const tabs = new Map<TabKey, Tab>();
/** The focused tab: the one in the focused pane. */
let activeKey: TabKey | null = null;
/** What each pane shows; the right one only while split (#21). */
let panes: Panes<TabKey> = [null, null];
let focusedPane: 0 | 1 = 0;
/** WebGL contexts by tab, least recently activated first. Kept across switches:
 *  recreating one (and its glyph atlas) on every switch made switching lag (#117). */
const webgl = new Map<TabKey, WebglAddon>();
let wrapper: HTMLElement | null = null;
/** Latest settings-driven appearance; theme.ts stays the fallback. */
let termOptions: TerminalSettings = {
  fontFamily: defaultFontFamily,
  fontSize: defaultFontSize,
  scrollback: defaultScrollback,
  cursorStyle: 'bar',
  cursorBlink: true,
  lineHeight: 1,
  shell: 'auto',
  loadProfile: true,
  // Well under WebView2's limit of about 16 contexts.
  gpuTabs: 4,
};
/** App zoom. The UI zooms with CSS `zoom`, which xterm cannot measure through (rows come
 *  out wrong and the prompt drops below a blank band), so the terminal area cancels it
 *  and scales its font instead. */
let zoom = 1;
const zoomedFontSize = () => termOptions.fontSize * zoom;
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
  const now = Date.now();
  for (const t of tabs.values()) {
    const mark = tabMark(t);
    if (mark !== t.mark) {
      t.mark = mark;
      t.markSince = now;
      if (mark === 'working') t.done = false;
      if (mark === 'exited') t.queued = null;
      if ((mark === 'idle' || mark === 'attention') && t.queued) {
        const text = t.queued;
        t.queued = null;
        // After this notify: sendText notifies again.
        setTimeout(() => sendText(t.key, text));
      }
      if (mosaic) layout();
    }
  }
  for (const l of listeners) l();
}

/** Shift the output history up to `now`, so silence reads as zeros. */
function roll(tab: Tab, now: number) {
  const at = Math.floor(now / BUCKET_MS);
  for (let i = Math.min(BUCKETS, at - tab.bucketAt); i > 0; i--) {
    tab.buckets.shift();
    tab.buckets.push(0);
  }
  tab.bucketAt = at;
}

/** Output bytes per 10 s over the last 5 minutes, oldest first. */
export function outputHistory(key: TabKey): number[] {
  const tab = tabs.get(key);
  if (!tab) return [];
  roll(tab, Date.now());
  return [...tab.buckets];
}

/** The lines on screen in a tab, as text, with rows the terminal wrapped joined back up. */
export function screenLines(key: TabKey): string[] {
  const tab = tabs.get(key);
  if (!tab) return [];
  if (!tab.term) return agentPeek(key);
  const b = tab.term.buffer.active;
  const lines: string[] = [];
  for (let y = b.baseY; y < b.baseY + tab.term.rows; y++) {
    const line = b.getLine(y);
    const text = line?.translateToString() ?? '';
    if (line?.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  return lines.map((l) => l.trimEnd());
}

/** Put tab `from` where tab `to` is (#74). The Map's order is the tab bar's order. */
export function moveTab(from: TabKey, to: TabKey) {
  const keys = [...tabs.keys()];
  const order = moveItem(keys, keys.indexOf(from), keys.indexOf(to));
  if (order === keys) return;
  const entries = order.map((k) => [k, tabs.get(k)!] as const);
  tabs.clear();
  for (const [k, t] of entries) tabs.set(k, t);
  notify();
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
  el.style.zoom = String(1 / zoom);
  const ro = new ResizeObserver(scheduleFit);
  ro.observe(el);
  // Re-fit after fonts load, or the first measurement uses fallback metrics.
  document.fonts?.ready.then(() => scheduleFit());
}

/** A tab's pane, laid out by `layout` like every other. */
function paneContainer(key: TabKey): HTMLDivElement {
  if (!wrapper) throw new Error('terminal manager not mounted');
  const container = document.createElement('div');
  Object.assign(container.style, paneStyle(null));
  // In the mosaic a click picks the tile and leaves the mosaic; xterm never sees it.
  container.addEventListener('mousedown', (e) => {
    if (!mosaic) return;
    e.preventDefault();
    e.stopPropagation();
    mosaic = false;
    activate(key);
  }, true);
  // Clicking into the other half of a split focuses that pane.
  container.addEventListener('focusin', () => {
    if (activeKey !== key && slotOf(panes, key) !== null) activate(key);
  });
  wrapper.appendChild(container);
  return container;
}

/**
 * Focus an existing tab for `key`, or create an agent tab: a pane with no terminal, which
 * App fills with the chat. Its state comes from `setAgentState`, not from a title.
 */
export function openAgentTab(key: TabKey, title: string, cwd: string | null, projectKey: string | null, provider: AgentProvider): Tab {
  const existing = tabs.get(key);
  if (existing) {
    activate(key);
    return existing;
  }
  const container = paneContainer(key);
  // The wrapper cancels the page zoom for xterm's sake; the chat wants it back.
  container.style.zoom = String(zoom);
  const now = Date.now();
  const tab: Tab = {
    provider, boundSession: key.startsWith('session:') ? key.slice(8) : null, existingSessions: [], codexSequence: null,
    key, title, autoTitle: null, customTitle: null, activity: null, claudeName: null, attention: false, done: false,
    queued: null, projectKey, startedAt: now, lastOutputAt: now, cwd, term: null, fit: null, search: null, container,
    ptyId: null, exited: false, exitCode: null, dims: null, unacked: 0, mark: 'open', markSince: now,
    buckets: new Array(BUCKETS).fill(0), bucketAt: Math.floor(now / BUCKET_MS),
  };
  tabs.set(key, tab);
  activate(key);
  return tab;
}

/** What an agent tab's session reports: its state, its session id, that it exited. */
export function setAgentState(key: TabKey, s: { activity?: Activity | null; session?: string; exited?: boolean; waiting?: boolean }) {
  const tab = tabs.get(key);
  if (!tab || tab.term) return;
  // A question or a permission pauses the turn: the tab waits on the user, and says so once.
  if (s.waiting) {
    tab.activity = 'idle';
    flagAttention(tab, 'bell');
  } else if (s.activity !== undefined) {
    if (tab.activity === 'working' && s.activity === 'idle') flagAttention(tab, 'finished');
    tab.activity = s.activity;
  }
  if (s.session) tab.boundSession = s.session;
  if (s.exited) tab.exited = true;
  notify();
}

/** Output an agent tab received, for the Open view's graph. Read on its tick, so no notify. */
export function countOutput(key: TabKey, n: number) {
  const tab = tabs.get(key);
  if (!tab) return;
  tab.lastOutputAt = Date.now();
  roll(tab, tab.lastOutputAt);
  tab.buckets[BUCKETS - 1] += n;
}

/** What the manager asks of the agent store, which imports the manager and not the
 *  reverse: the Open view's peek, and Reply and queued prompts. */
let agentHooks: { peek: (key: TabKey) => string[]; send: (key: TabKey, text: string) => void } = { peek: () => [], send: () => {} };
export function setAgentHooks(h: typeof agentHooks) {
  agentHooks = h;
}
const agentPeek = (key: TabKey) => agentHooks.peek(key);

type CloseListener = (key: TabKey) => void;
const closeListeners = new Set<CloseListener>();
/** Called as a tab closes, so its agent session can end with it. */
export function onClosed(fn: CloseListener): () => void {
  closeListeners.add(fn);
  return () => closeListeners.delete(fn);
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

  const container = paneContainer(key);

  const term = new Terminal({
    fontFamily: termOptions.fontFamily,
    fontSize: zoomedFontSize(),
    theme: termTheme,
    scrollback: termOptions.scrollback,
    cursorBlink: termOptions.cursorBlink,
    cursorStyle: termOptions.cursorStyle,
    lineHeight: termOptions.lineHeight,
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
    if (isCopy(e, term.hasSelection())) {
      e.preventDefault();
      e.stopPropagation();
      void writeClipboard(term.getSelection());
      term.clearSelection();
      return false;
    }
    // Codex gets a real Shift+Enter key record rather than LF: it reads Windows key
    // events, and ConPTY turns LF into plain Enter, which submits (#82). A non-null
    // activity means Claude is running, even if the user started it by hand.
    const agent = tab.provider === 'codex' ? 'codex' : tab.activity !== null ? 'claude' : null;
    const newline = newlineInput(e, agent);
    if (newline !== null) {
      e.preventDefault();
      e.stopPropagation();
      if (tab.ptyId) void ptyWrite(tab.ptyId, newline);
      return false;
    }
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
    done: false,
    queued: null,
    projectKey,
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
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
    mark: 'open',
    markSince: Date.now(),
    buckets: new Array(BUCKETS).fill(0),
    bucketAt: Math.floor(Date.now() / BUCKET_MS),
  };
  tabs.set(key, tab);

  term.onBell(() => {
    flagAttention(tab, 'bell');
    notify();
  });

  term.onTitleChange((t) => {
    const claude = claudeTitle(t);
    // The status glyph is drawn by StatusDot; keeping it here showed it twice.
    tab.autoTitle = claude?.name || usableTitle(t);
    if (tab.provider === 'codex') { notify(); return; }
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
      tab.lastOutputAt = Date.now();
      roll(tab, tab.lastOutputAt);
      tab.buckets[BUCKETS - 1] += msg.d.length;
      // The callback fires once xterm has parsed the payload: the honest ack point.
      term.write(msg.d, () => {
        tab.unacked += new TextEncoder().encode(msg.d).byteLength;
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

  tab.ptyId = await ptySpawn({ ...opts, cols: dims.cols, rows: dims.rows, shell: termOptions.shell, noProfile: !termOptions.loadProfile }, channel);
  notify();
  return tab;
}

/** Apply recorded Codex status. The first observed state is history, never a notification. */
export function bindSessions(bindings: Map<TabKey, string>, sessions: SessionMeta[]) {
  let changed = false;
  for (const tab of tabs.values()) {
    const id = bindings.get(tab.key);
    // Rebinds too: a /resume inside the tab moves it to another session (#75).
    if (id && tab.term && id !== tab.boundSession) { tab.boundSession = id; tab.codexSequence = null; changed = true; }
    // Agent tabs hear their state from the sidecar, live.
    if (tab.provider !== 'codex' || !tab.term || !tab.boundSession || tab.exited) continue;
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
 * Move `delta` tabs from the active one, wrapping, in tab order: the order they were
 * opened, or the tab bar's, which dragging changes.
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
/** Takes effect in open tabs too, except the shell settings, which apply to new tabs. */
export function applyTerminalSettings(s: TerminalSettings) {
  termOptions = {
    ...s,
    fontFamily: s.fontFamily || defaultFontFamily,
    fontSize: s.fontSize || defaultFontSize,
    scrollback: s.scrollback ?? defaultScrollback,
    lineHeight: s.lineHeight || 1,
  };
  for (const t of tabs.values()) {
    if (!t.term) continue;
    Object.assign(t.term.options, {
      fontFamily: termOptions.fontFamily,
      fontSize: zoomedFontSize(),
      scrollback: termOptions.scrollback,
      cursorStyle: termOptions.cursorStyle,
      cursorBlink: termOptions.cursorBlink,
      lineHeight: termOptions.lineHeight,
    });
  }
  trimWebgl();
  refit();
}

export function setTerminalZoom(z: number) {
  zoom = z;
  if (wrapper) wrapper.style.zoom = String(1 / z);
  for (const t of tabs.values()) {
    if (t.term) t.term.options.fontSize = zoomedFontSize();
    else t.container.style.zoom = String(z);
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
  for (const t of tabs.values()) if (t.term) t.term.options.theme = termTheme;
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
  if (!tab?.search) return;
  const sub = tab.search.onDidChangeResults((r) => {
    for (const l of findListeners) l({ index: r.resultIndex, count: r.resultCount });
  });
  findDisposer = () => sub.dispose();
}

export function findInActiveTab(query: string, direction: 1 | -1 = 1): void {
  const tab = activeKey ? tabs.get(activeKey) : null;
  if (!tab?.search) return;
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
  tab?.search?.clearDecorations();
}

export function focusActiveTerminal(): void {
  const tab = activeKey ? tabs.get(activeKey) : null;
  if (tab) focusTab(tab);
}

/** The terminal, or an agent tab's message box. */
function focusTab(tab: Tab) {
  if (tab.term) tab.term.focus();
  else tab.container.querySelector('textarea')?.focus();
}

/** Give the tab a WebGL context, reusing its own, and retire the least recent past the cap. */
function useWebgl(key: TabKey, term: Terminal) {
  const had = webgl.get(key);
  webgl.delete(key);
  if (had) {
    webgl.set(key, had);
    return;
  }
  if (termOptions.gpuTabs < 1) return;
  try {
    const addon = new WebglAddon();
    // Contexts are lost on OOM or system resume; fall back rather than render nothing.
    addon.onContextLoss(() => {
      addon.dispose();
      if (webgl.get(key) === addon) webgl.delete(key);
    });
    term.loadAddon(addon);
    webgl.set(key, addon);
  } catch {
    // Software rendering or RDP: the DOM renderer is correct, just slower.
  }
  trimWebgl();
}

/** Disposing a tab's WebGL addon puts it back on the DOM renderer. */
function trimWebgl() {
  for (const [old, addon] of webgl) {
    if (webgl.size <= termOptions.gpuTabs) break;
    addon.dispose();
    webgl.delete(old);
  }
}

export function isSplit(): boolean {
  return panes[1] !== null;
}

/**
 * Every tab at once, each a scaled-down copy of a full-size pane. Scaled rather than
 * resized, so no agent redraws or rewraps, and leaving restores them exactly.
 */
let mosaic = false;
export function isMosaic(): boolean {
  return mosaic;
}
export function toggleMosaic() {
  mosaic = !mosaic && tabs.size > 1;
  if (mosaic) layout();
  else if (activeKey) activate(activeKey);
  notify();
}

function mosaicLayout() {
  const all = [...tabs.values()];
  const cols = Math.ceil(Math.sqrt(all.length));
  all.forEach((t, i) => {
    Object.assign(t.container.style, {
      inset: '0',
      // Percentages are of the unscaled pane, so one tile step is 100/cols of it.
      transform: `translate(${((i % cols) * 100) / cols}%, ${(Math.floor(i / cols) * 100) / cols}%) scale(${1 / cols})`,
      transformOrigin: '0 0',
      visibility: 'visible',
      zIndex: '1',
      cursor: 'pointer',
      // A split's dimming and focus border don't belong on tiles.
      opacity: '',
      borderLeft: '',
      borderTop: '',
    });
    t.container.style.setProperty('--tile-scale', String(cols));
    t.container.dataset.tile = displayTitle(t);
    // The label carries the state colour: xterm's canvas paints over any border.
    t.container.dataset.mark = t.mark;
  });
}

/** Where a split divides the pane area, as a share of its width from the left. */
let splitRatio = 0.5;
export function getSplitRatio(): number {
  return splitRatio;
}
export function setSplitRatio(ratio: number) {
  splitRatio = Math.min(0.8, Math.max(0.2, ratio));
  layout();
  scheduleFit();
  notify();
}

/** Place every tab's container in its pane, or hide it. */
function layout() {
  if (mosaic) return mosaicLayout();
  for (const t of tabs.values()) {
    Object.assign(t.container.style, { transform: '', cursor: '' });
    delete t.container.dataset.tile;
    delete t.container.dataset.mark;
    const slot = slotOf(panes, t.key);
    Object.assign(t.container.style, paneStyle(slot, isSplit(), slot === focusedPane, splitRatio));
  }
}

/** Show `key` beside the focused tab and focus it (#21). */
export function splitWith(key: TabKey) {
  if (!tabs.has(key) || !activeKey || key === activeKey) return;
  panes = [activeKey, key];
  focusedPane = 1;
  activate(key);
}

/** Back to one pane, keeping the focused tab. */
export function unsplit() {
  if (!isSplit()) return;
  panes = [activeKey, null];
  focusedPane = 0;
  layout();
  scheduleFit();
  notify();
}

export function focusOtherPane() {
  const other = panes[focusedPane === 0 ? 1 : 0];
  if (isSplit() && other) activate(other);
}

export function activate(key: TabKey) {
  if (!tabs.has(key)) return;
  ({ panes, focused: focusedPane } = showIn(panes, focusedPane, key));
  activeKey = key;
  tabs.get(key)!.attention = false;
  layout();

  const tab = tabs.get(key)!;
  if (tab.term) useWebgl(key, tab.term);

  focusTab(tab);
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
  webgl.get(key)?.dispose();
  webgl.delete(key);
  tab.term?.dispose();
  for (const l of closeListeners) l(key);
  tab.container.remove();
  const nearest = nearestFirst([...tabs.keys()], key);
  tabs.delete(key);

  const wasShown = slotOf(panes, key) !== null;
  ({ panes, focused: focusedPane } = withoutTab(panes, focusedPane, key, nearest));
  if (activeKey === key) {
    activeKey = null;
    const next = panes[focusedPane] ?? nearest[0];
    if (next) activate(next);
  } else if (wasShown) {
    layout();
    scheduleFit();
  }
  notify();
}

/**
 * Type `text` into a tab, as if at its prompt, and press Enter. Enter goes on its own a
 * beat later: in one write, Claude Code reads the pair as a paste and keeps the newline.
 */
export function sendText(key: TabKey, text: string) {
  const tab = tabs.get(key);
  if (tab && !tab.term && !tab.exited) {
    agentHooks.send(key, text);
    tab.attention = false;
    return notify();
  }
  if (!tab?.ptyId || tab.exited) return;
  const id = tab.ptyId;
  void ptyWrite(id, text).then(() => setTimeout(() => void ptyWrite(id, '\r'), 50));
  // Answered: no longer waiting on you, though it was never shown.
  tab.attention = false;
  notify();
}

/** Sets or, with null, cancels the message sent when the tab's agent next stops working. */
export function queuePrompt(key: TabKey, text: string | null) {
  const tab = tabs.get(key);
  if (!tab || tab.exited) return;
  tab.queued = text?.trim() || null;
  notify();
}

export function markDone(key: TabKey) {
  const tab = tabs.get(key);
  if (!tab) return;
  tab.done = true;
  tab.attention = false;
  notify();
}

/** What the header shows: the user's name, else the program's, else the default. */
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

// --- the terminal's right-click menu
/** The tab whose terminal holds `node`. */
export function tabAt(node: Node): TabKey | null {
  for (const t of tabs.values()) if (t.container.contains(node)) return t.key;
  return null;
}
export function hasSelection(key: TabKey): boolean {
  return !!tabs.get(key)?.term?.hasSelection();
}
export async function copySelection(key: TabKey) {
  const term = tabs.get(key)?.term;
  if (!term?.hasSelection()) return;
  await writeClipboard(term.getSelection());
  term.clearSelection();
}
/** As a paste, so bracketed-paste programs such as Claude Code see one block. */
export async function pasteInto(key: TabKey) {
  const term = tabs.get(key)?.term;
  if (!term) return;
  const text = await navigator.clipboard.readText().catch(() => '');
  if (text) term.paste(text);
  term.focus();
}
export function selectAllIn(key: TabKey) {
  tabs.get(key)?.term?.selectAll();
}
/** Drops the scrollback; the program's current line stays. */
export function clearTerminal(key: TabKey) {
  const term = tabs.get(key)?.term;
  term?.clear();
  term?.focus();
}

async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.warn('Clipboard write failed', e);
  }
}

/** True when the tab has a live process, i.e. closing it would kill something. */
/** What closing the tab would stop: a program under its shell, or null (#106). */
export async function busyWith(key: TabKey): Promise<string | null> {
  const tab = tabs.get(key);
  if (tab && !tab.term) return !tab.exited && tab.activity === 'working' ? tab.provider : null;
  if (!tab?.ptyId || tab.exited) return null;
  // Unknown is treated as busy: asking once too often beats killing a running agent.
  return ptyBusy(tab.ptyId).catch(() => 'a program');
}

/** Resolves after the browser has laid out and painted at least once. */
function nextLayout(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function measure(tab: Tab): Dims {
  const proposed = tab.fit?.proposeDimensions();
  if (isUsableDims(proposed)) return { cols: proposed.cols, rows: proposed.rows };
  // A sane default beats forwarding zeroes into ConPTY.
  return { cols: 80, rows: 24 };
}

/**
 * Unsplit, every tab shares the wrapper's geometry, so dimensions are measured once and
 * applied to all of them. Split, each visible pane is measured on its own, and hidden
 * tabs take the focused pane's size, since that is where they will appear.
 */
function fitAll() {
  const active = activeKey ? tabs.get(activeKey) : null;
  // An agent pane has no terminal to measure; a hidden terminal sits in the same place.
  const ref = active?.term ? active : [...tabs.values()].find((t) => t.term && slotOf(panes, t.key) === null);
  if (isSplit()) {
    for (const k of panes) {
      const t = k ? tabs.get(k) : undefined;
      if (t?.term) applyDims(t, measure(t));
    }
  }
  if (!ref) return;
  const dims = measure(ref);
  // Each tab tracks what it has actually been given -- so a newly opened tab is
  // corrected even when nothing about the window moved.
  const hidden = [...tabs.values()].filter((t) => t.term && (!isSplit() || slotOf(panes, t.key) === null));
  for (const t of panesNeedingResize(hidden, dims)) {
    applyDims(t, dims);
  }
}
const scheduleFit = debounce(fitAll, RESIZE_DEBOUNCE_MS);

/** Resize the emulator and its PTY together, and remember what was applied. */
function applyDims(tab: Tab, dims: Dims) {
  if (!tab.term || !dimsChanged(tab.dims, dims)) return;
  tab.dims = dims;
  tab.term.resize(dims.cols, dims.rows);
  // Only after a PTY exists; openTab applies dims before spawning, and passes the same
  // values to pty_spawn so the two can never disagree.
  if (tab.ptyId) void ptyResize(tab.ptyId, dims.cols, dims.rows);
}

export function refit() {
  scheduleFit();
}

/** Measure now, in this frame: for a layout change that is about to be animated. */
export function refitNow() {
  scheduleFit.cancel();
  fitAll();
}

// Terminal instances, their PTY ids, and the WebGL context all live in module scope, and
// none of it survives a hot swap: Vite would keep this module's state while Svelte
// rebuilt the DOM around it, leaving orphaned terminals attached to detached containers
// and a blank pane. Dev reloads the page instead.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
