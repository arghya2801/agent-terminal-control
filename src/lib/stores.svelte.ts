/**
 * Index and settings state, shared across components.
 *
 * The `.svelte.ts` extension is required: Svelte 5 only compiles runes in `.svelte` and
 * `.svelte.ts` files, so `$state` in a plain `.ts` would silently not be reactive.
 */

import { migrateSessionNames } from './agents';
import { listen, frontendReady, setZoom } from './desktop';
import {
  indexRefresh,
  indexSnapshot,
  settingsGet,
  settingsSet,
  notesGet,
  notesSet,
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
import { applyPalette, type Palette } from './theme';
import { findTheme, loadThemes } from './themes';
import type { IndexSnapshot, Settings } from '../types';

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
