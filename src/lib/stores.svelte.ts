/**
 * Index and settings state, shared across components.
 *
 * The `.svelte.ts` extension is required: Svelte 5 only compiles runes in `.svelte` and
 * `.svelte.ts` files, so `$state` in a plain `.ts` would silently not be reactive.
 */

import { SvelteSet } from 'svelte/reactivity';
import { migrateSessionNames, sessionKey } from './agents';
import { listen, frontendReady, setWindowTheme, setZoom } from './desktop';
import {
  accountList,
  indexRefresh,
  indexSnapshot,
  settingsGet,
  settingsSet,
  notesGet,
  notesSet,
  suggestSessionName,
} from './ipc';
import {
  anyExpanded,
  isExpandedIn,
  setAll,
  toggleIn,
  type Collapsed,
} from './expansion';
import { normalizeZoom, stepZoom } from './zoom';
import { applyTerminalSettings, applyTheme, setTerminalZoom } from '../terminal/manager';
import { applyPalette, isLight, type Palette } from './theme';
import { findTheme, loadThemes } from './themes';
import type { Account, IndexSnapshot, SessionMeta, Settings } from '../types';

const EVENT_INDEX_UPDATED = 'index://updated';
const EVENT_SETTINGS_UPDATED = 'settings://updated';
const EVENT_NOTES_UPDATED = 'notes://updated';
/** Holding a zoom key should not write settings.json on every step. */
const SETTINGS_SAVE_DEBOUNCE_MS = 400;

/// Named `appState`, not `state`: an import called `state` shadows the `$state` rune
/// in any component that uses it, which fails to compile in confusing ways.
export const appState = $state({
  index: { projects: [], sessionCount: 0 } as IndexSnapshot,
  settings: null as Settings | null,
  /** notes.md, the Open view's notes pad (#132). */
  notes: '',
  loading: true,
  error: null as string | null,
  /** Bumped on every applied snapshot, so the debug overlay can show whether the
   *  watcher is causing a re-render storm. */
  indexRevision: 0,
});

/** Tracked as the set of *collapsed* keys, so everything is expanded by default —
 *  including projects that appear while the app is running. Deliberately not persisted:
 *  cheap to redo, and stale expansion after the list shifts is more annoying than
 *  useful. */
const collapsed = $state<Collapsed>({});

/** Installed themes, for the settings page's list. Loaded once, on startup. */
export const themeState = $state({ themes: [] as Palette[] });

/**
 * Put the named theme on the document and into every terminal. Falls back to the default
 * when the name is unknown, so deleting a theme file leaves a working app rather than an
 * unstyled one.
 */
function applyThemeByName(name: string) {
  const palette = findTheme(themeState.themes, name);
  applyPalette(palette, document.documentElement);
  setWindowTheme(isLight(palette));
  applyTheme(palette);
}

export function isExpanded(key: string): boolean {
  return isExpandedIn(collapsed, key);
}

export function toggleExpanded(key: string) {
  toggleIn(collapsed, key);
}

/** Whether the header button should offer "collapse all" or "expand all". */
export function anyProjectExpanded(): boolean {
  return anyExpanded(collapsed, appState.index.projects.map((p) => p.key));
}

export function toggleAllProjects() {
  const keys = appState.index.projects.map((p) => p.key);
  setAll(collapsed, keys, anyExpanded(collapsed, keys));
}

function applySnapshot(snap: IndexSnapshot) {
  appState.index = snap;
  appState.indexRevision += 1;
}

/** Push settings into the parts of the app that are not reactive. */
function applySettings(s: Settings) {
  s.projects.sessionNames = migrateSessionNames(s.projects.sessionNames);
  applyTerminalSettings(s.terminal);
  applyThemeByName(s.ui.theme);
  applyZoom(s.ui.zoom);
  applyMotion();
}

// Windows' "Show animations" reaches the page as reduced motion, and changes live.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
reduceMotion.addEventListener('change', () => applyMotion());

/**
 * `data-still` on the root turns every animation off; app.css reads it. The speed scales
 * the two duration tokens everything else is built from.
 */
function applyMotion(pref = appState.settings?.ui.animations) {
  const root = document.documentElement;
  root.toggleAttribute('data-still', pref === 'off' || (pref !== 'on' && reduceMotion.matches));
  const speed = Math.min(4, Math.max(0.25, appState.settings?.ui.animationSpeed || 1));
  root.style.setProperty('--fast', `${Math.round(75 / speed)}ms`);
  root.style.setProperty('--enter', `${Math.round(160 / speed)}ms`);
}

/** How often to re-read Claude's or Codex's plan limits, from settings, never under 15 s. */
export function refreshMs(which: 'claude' | 'codex'): number {
  const ui = appState.settings?.ui;
  const seconds = which === 'claude' ? ui?.limitsRefreshSec ?? 300 : ui?.codexRefreshSec ?? 300;
  return Math.max(15, seconds || 0) * 1000;
}

/** How long an entrance takes in a JS transition: `--enter`, or 0 while motion is off. */
export function enterMs(): number {
  if (document.documentElement.hasAttribute('data-still')) return 0;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--enter'));
}

function applyZoom(value: number) {
  const z = normalizeZoom(value);
  setZoom(z);
  // Zoom changes the cell size, so the terminal must be re-measured or the shell keeps
  // wrapping at the old column count.
  setTerminalZoom(z);
}

export async function initStores() {
  try {
    await frontendReady();
    // Before settings are applied: the theme named there has to be findable.
    themeState.themes = await loadThemes();
    appState.settings = await settingsGet();
    applySettings(appState.settings);
    appState.notes = await notesGet();
    await loadAccounts();
    applySnapshot(await indexSnapshot());
    appState.error = null;
  } catch (e) {
    appState.error = String(e);
  } finally {
    appState.loading = false;
  }

  // Go emits only when the rendered projection actually changed, so this is not a
  // firehose even while a session is being written to.
  await listen<IndexSnapshot>(EVENT_INDEX_UPDATED, applySnapshot);

  // settings.json edited outside the app. Go only emits when it genuinely differs
  // from what is loaded, so our own saves do not bounce back.
  await listen<Settings>(EVENT_SETTINGS_UPDATED, (s) => {
    appState.settings = s;
    applySettings(s);
  });

  // notes.md edited outside the app.
  await listen<string>(EVENT_NOTES_UPDATED, (t) => (appState.notes = t));
}

export async function refresh(force = false) {
  try {
    applySnapshot(await indexRefresh(force));
    appState.error = null;
  } catch (e) {
    appState.error = String(e);
  }
}

export const renameModelName = () => (appState.settings?.ui.renameModel === 'luna' ? 'Luna' : 'Haiku');

/** Sessions being named by the rename model, by session key. */
export const naming = new SvelteSet<string>();

/** Names each session with the rename model (#195) and keeps the name. One at a time:
 *  each run starts a CLI. */
export async function nameSessions(sessions: SessionMeta[], onNamed: (key: string, name: string) => void) {
  const failed: string[] = [];
  sessions = sessions.filter((s) => !naming.has(sessionKey(s)));
  for (const s of sessions) naming.add(sessionKey(s));
  for (const s of sessions) {
    const key = sessionKey(s);
    try {
      const name = await suggestSessionName(s.file);
      if (!appState.settings) break;
      const sessionNames = { ...appState.settings.projects.sessionNames, [key]: name };
      await saveSettings({ ...appState.settings, projects: { ...appState.settings.projects, sessionNames } });
      onNamed(key, name);
    } catch (e) {
      failed.push(`${s.label}: ${e instanceof Error ? e.message : e}`);
    } finally {
      naming.delete(key);
    }
  }
  await refresh();
  if (failed.length) appState.error = `Could not name ${failed.join('; ')}`;
}

/** Claude accounts (#252), secrets masked. */
export const accountState = $state({ list: [] as Account[], /** An account to add, filled in by Get a token. */ draft: null as Account | null });
export async function loadAccounts() {
  try {
    accountState.list = await accountList();
  } catch (e) {
    appState.error = String(e);
  }
}
export const accountLabel = (id: string) => accountState.list.find((a) => a.id === id)?.label ?? 'Claude login';
/** The account a Claude tab runs as: the one its session last ran as, else the default.
 *  '' is the ~/.claude login, which a removed account falls back to. */
export function accountFor(session?: string | null): string {
  const known = (id: string) => id === '' || accountState.list.some((a) => a.id === id);
  const last = session ? appState.settings?.projects.sessionAccounts?.[session] : undefined;
  if (last !== undefined && known(last)) return last;
  const d = appState.settings?.claude.account ?? '';
  return known(d) ? d : '';
}
/** Notes which account `session` (`provider:id`) ran as, once there are accounts to tell apart. */
export async function rememberAccount(session: string, id: string) {
  const s = appState.settings;
  if (!s || !accountState.list.length || s.projects.sessionAccounts?.[session] === id) return;
  await saveSettings({ ...s, projects: { ...s.projects, sessionAccounts: { ...s.projects.sessionAccounts, [session]: id } } });
}

export async function saveSettings(next: Settings) {
  const prev = appState.settings;
  appState.settings = next;
  // Our own writes never come back as settings://updated, so apply them here.
  if (
    prev?.ui.zoom !== next.ui.zoom ||
    prev?.ui.theme !== next.ui.theme ||
    JSON.stringify(prev?.terminal) !== JSON.stringify(next.terminal)
  ) {
    applySettings(next);
  } else if (prev?.ui.animations !== next.ui.animations || prev?.ui.animationSpeed !== next.ui.animationSpeed) {
    applyMotion();
  }
  // This write carries everything a pending debounced one would.
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  try {
    await settingsSet(next);
  } catch (e) {
    appState.error = String(e);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Update state and apply immediately, but write the file at most once per burst. */
function saveSettingsDebounced(next: Settings) {
  appState.settings = next;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    // Whatever is current when the burst ends, not what started it.
    if (appState.settings) void settingsSet(appState.settings).catch((e) => (appState.error = String(e)));
  }, SETTINGS_SAVE_DEBOUNCE_MS);
}

export type SidebarView = 'sessions' | 'open' | 'scratch';

export function sidebarView(): SidebarView {
  const v = appState.settings?.ui.sidebarView;
  return v === 'sessions' ? 'sessions' : v === 'scratch' ? 'scratch' : 'open';
}

export function setSidebarView(view: SidebarView) {
  if (!appState.settings || sidebarView() === view) return;
  // In place, so only what reads the view updates; a new settings object re-derived the
  // whole sidebar on every switch (#117).
  appState.settings.ui.sidebarView = view;
  saveSettingsDebounced(appState.settings);
}

let notesTimer: ReturnType<typeof setTimeout> | undefined;

/** Typing saves after a pause; `now` is for blur and checkbox clicks. */
export function saveNotes(text: string, now = false) {
  appState.notes = text;
  if (notesTimer !== undefined) clearTimeout(notesTimer);
  const write = () => {
    notesTimer = undefined;
    void notesSet(appState.notes).catch((e) => (appState.error = String(e)));
  };
  if (now) write();
  else notesTimer = setTimeout(write, SETTINGS_SAVE_DEBOUNCE_MS);
}

export function currentZoom(): number {
  return normalizeZoom(appState.settings?.ui.zoom ?? 1);
}

/** `direction` of 0 resets to 100%. */
export async function adjustZoom(direction: 1 | -1 | 0) {
  if (!appState.settings) return;
  const next = direction === 0 ? 1 : stepZoom(currentZoom(), direction);
  if (next === currentZoom()) return;
  saveSettingsDebounced({
    ...appState.settings,
    ui: { ...appState.settings.ui, zoom: next },
  });
  applyZoom(next);
}

export function sidebarOpen(): boolean {
  return appState.settings?.ui.sidebarOpen ?? true;
}

export async function toggleSidebar() {
  if (!appState.settings) return;
  await saveSettings({
    ...appState.settings,
    ui: { ...appState.settings.ui, sidebarOpen: !appState.settings.ui.sidebarOpen },
  });
}

// Module-level reactive state does not survive a hot swap: Vite keeps this module while
// Svelte rebuilds the components around it, leaving listeners bound to a dead store.
// Same failure mode as terminal/manager.ts — reload instead.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
