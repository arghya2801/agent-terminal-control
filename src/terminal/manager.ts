/**
 * Owns every live `Terminal`, outside the framework. Svelte renders an empty wrapper and
 * this module appends panes into it; a component holding a `Terminal` could have it
 * re-created by the reconciler, destroying scrollback and orphaning the PTY.
 *
 * Two rules that are expensive to rediscover:
 *
 * - `term.onData` must be wired before `pty_spawn`. ConPTY stalls at startup until a
 *   terminal answers its cursor-position request, and xterm only answers if listening.
 * - At most WEBGL_TABS recently used tabs hold a WebGL context; WebView2 caps them at
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
  /** Canonical key of the sidebar project this tab belongs to, if any. */
  projectKey: string | null;
  /** When the tab was opened. Identifies which session Claude went on to create. */
  startedAt: number;
  /** When output last arrived, for the Open view. Not reactive: read on the view's tick. */
  lastOutputAt: number;
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
// ponytail: a fixed small cap under WebView2's ~16; make it adaptive only if split panes
// ever need more visible at once.
const WEBGL_TABS = 4;
let wrapper: HTMLElement | null = null;
/** Latest settings-driven appearance; theme.ts stays the fallback. */
let termOptions = {
  fontFamily: defaultFontFamily,
  fontSize: defaultFontSize,
  scrollback: defaultScrollback,
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

/** The rows on screen in a tab, as text. */
export function screenLines(key: TabKey): string[] {
  const tab = tabs.get(key);
  if (!tab) return [];
  const b = tab.term.buffer.active;
  const lines: string[] = [];
  for (let y = b.baseY; y < b.baseY + tab.term.rows; y++) lines.push(b.getLine(y)?.translateToString(true) ?? '');
  return lines;
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

  const term = new Terminal({
    fontFamily: termOptions.fontFamily,
    fontSize: zoomedFontSize(),
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

  tab.ptyId = await ptySpawn({ ...opts, cols: dims.cols, rows: dims.rows }, channel);
  notify();
  return tab;
}

/** Apply recorded Codex status. The first observed state is history, never a notification. */
export function bindSessions(bindings: Map<TabKey, string>, sessions: SessionMeta[]) {
  let changed = false;
  for (const tab of tabs.values()) {
    const id = bindings.get(tab.key);
    // Rebinds too: a /resume inside the tab moves it to another session (#75).
    if (id && id !== tab.boundSession) { tab.boundSession = id; tab.codexSequence = null; changed = true; }
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
    t.term.options.fontSize = zoomedFontSize();
    t.term.options.scrollback = termOptions.scrollback;
  }
  refit();
}

export function setTerminalZoom(z: number) {
  zoom = z;
  if (wrapper) wrapper.style.zoom = String(1 / z);
  for (const t of tabs.values()) t.term.options.fontSize = zoomedFontSize();
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

/** Give the tab a WebGL context, reusing its own, and retire the least recent past the cap. */
function useWebgl(key: TabKey, term: Terminal) {
  const had = webgl.get(key);
  webgl.delete(key);
  if (had) {
    webgl.set(key, had);
    return;
  }
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
  for (const [old, addon] of webgl) {
    if (webgl.size <= WEBGL_TABS) break;
    addon.dispose();
    webgl.delete(old);
  }
}

export function isSplit(): boolean {
  return panes[1] !== null;
}

/**
 * Every live tab at once, each a scaled-down copy of a full-size pane. Scaled rather
 * than resized, so no agent redraws or rewraps, and leaving restores them exactly.
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
  const live = [...tabs.values()];
  const cols = Math.ceil(Math.sqrt(live.length));
  live.forEach((t, i) => {
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
  useWebgl(key, tab.term);

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
  webgl.get(key)?.dispose();
  webgl.delete(key);
  tab.term.dispose();
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

/** Type `text` into a tab, as if at its prompt, and press Enter. */
export function sendText(key: TabKey, text: string) {
  const tab = tabs.get(key);
  if (tab?.ptyId && !tab.exited) void ptyWrite(tab.ptyId, `${text}\r`);
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

// --- the terminal's right-click menu
/** The tab whose terminal holds `node`. */
export function tabAt(node: Node): TabKey | null {
  for (const t of tabs.values()) if (t.container.contains(node)) return t.key;
  return null;
}
export function hasSelection(key: TabKey): boolean {
  return !!tabs.get(key)?.term.hasSelection();
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
  tabs.get(key)?.term.selectAll();
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
  const proposed = tab.fit.proposeDimensions();
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
  if (!active) return;

  const dims = measure(active);
  if (isSplit()) {
    for (const k of panes) {
      const t = k ? tabs.get(k) : undefined;
      if (t) applyDims(t, measure(t));
    }
  }
  // Each tab tracks what it has actually been given -- so a newly opened tab is
  // corrected even when nothing about the window moved.
  const hidden = [...tabs.values()].filter((t) => !isSplit() || slotOf(panes, t.key) === null);
  for (const t of panesNeedingResize(hidden, dims)) {
    applyDims(t, dims);
  }
}
const scheduleFit = debounce(fitAll, RESIZE_DEBOUNCE_MS);

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
