/**
 * Index and settings state, shared across components.
 *
 * The `.svelte.ts` extension is required: Svelte 5 only compiles runes in `.svelte` and
 * `.svelte.ts` files, so `$state` in a plain `.ts` would silently not be reactive.
 */

import { migrateSessionNames } from './agents';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import {
  gitBranches,
  indexRefresh,
  indexSnapshot,
  settingsGet,
  settingsSet,
  tasksGet,
  tasksSet,
} from './ipc';
import { projectKey } from './paths';
import { newTask } from './tasks';
import {
  anyExpanded,
  isExpandedIn,
  setAll,
  toggleIn,
  type Collapsed,
} from './expansion';
import { normalizeZoom, stepZoom } from './zoom';
import { applyTerminalSettings, applyTheme, refit } from '../terminal/manager';
import { applyPalette, type Palette } from './theme';
import { findTheme, loadThemes } from './themes';
import type { IndexSnapshot, Settings, Task } from '../types';

const EVENT_INDEX_UPDATED = 'index://updated';
const EVENT_SETTINGS_UPDATED = 'settings://updated';
const EVENT_TASKS_UPDATED = 'tasks://updated';
/** Holding a zoom key should not write settings.json on every step. */
const SETTINGS_SAVE_DEBOUNCE_MS = 400;

/// Named `appState`, not `state`: an import called `state` shadows the `$state` rune
/// in any component that uses it, which fails to compile in confusing ways.
export const appState = $state({
  index: { projects: [], sessionCount: 0 } as IndexSnapshot,
  settings: null as Settings | null,
  /** Stored in tasks.json, apart from settings, so neither can overwrite the other. */
  tasks: [] as Task[],
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
  void applyZoom(s.ui.zoom);
}

async function applyZoom(value: number) {
  const z = normalizeZoom(value);
  try {
    await getCurrentWebview().setZoom(z);
  } catch (e) {
    appState.error = `zoom failed: ${e}`;
    return;
  }
  // Zoom changes the cell size, so the terminal must be re-measured or the shell keeps
  // wrapping at the old column count.
  refit();
}

export async function initStores() {
  try {
    // Before settings are applied: the theme named there has to be findable.
    themeState.themes = await loadThemes();
    appState.settings = await settingsGet();
    applySettings(appState.settings);
    appState.tasks = await tasksGet();
    applySnapshot(await indexSnapshot());
    appState.error = null;
  } catch (e) {
    appState.error = String(e);
  } finally {
    appState.loading = false;
  }

  // Rust emits only when the rendered projection actually changed, so this is not a
  // firehose even while a session is being written to.
  await listen<IndexSnapshot>(EVENT_INDEX_UPDATED, (e) => applySnapshot(e.payload));

  // settings.json edited outside the app. Rust only emits when it genuinely differs
  // from what is loaded, so our own saves do not bounce back.
  await listen<Settings>(EVENT_SETTINGS_UPDATED, (e) => {
    appState.settings = e.payload;
    applySettings(e.payload);
  });

  // tasks.json edited outside the app.
  await listen<Task[]>(EVENT_TASKS_UPDATED, (e) => (appState.tasks = e.payload));
}

/** Branch lists by repo, fetched when a picker first needs one. A rescan forgets them. */
const branchCache = new Map<string, Promise<string[]>>();

export function branchesOf(repo: string): Promise<string[]> {
  const key = projectKey(repo);
  let hit = branchCache.get(key);
  if (!hit) {
    hit = gitBranches(repo).catch(() => []);
    branchCache.set(key, hit);
  }
  return hit;
}

export async function refresh(force = false) {
  branchCache.clear();
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

/** Which task the panel shows and whether it is open. Not persisted. */
export const taskUi = $state({
  selected: null as number | null,
  panelOpen: false,
  /** Task whose title is being edited in the sidebar. */
  renaming: null as number | null,
});

export function sidebarView(): 'sessions' | 'tasks' {
  return appState.settings?.ui.sidebarView === 'tasks' ? 'tasks' : 'sessions';
}

export async function setSidebarView(view: 'sessions' | 'tasks') {
  if (!appState.settings || sidebarView() === view) return;
  await saveSettings({ ...appState.settings, ui: { ...appState.settings.ui, sidebarView: view } });
}

export function tasks(): Task[] {
  return appState.tasks;
}

/** Add a task at the top of the list, select it and start renaming it. */
export function createTask(fields: Partial<Task> = {}): Task {
  const task = newTask(tasks(), fields);
  saveTasks([task, ...tasks()]);
  taskUi.selected = task.id;
  taskUi.renaming = task.id;
  return task;
}

let tasksTimer: ReturnType<typeof setTimeout> | undefined;

/** Structural edits save at once; `debounced` is for typing, such as notes. */
export function saveTasks(next: Task[], debounced = false) {
  appState.tasks = next;
  if (tasksTimer !== undefined) clearTimeout(tasksTimer);
  const write = () => {
    tasksTimer = undefined;
    // Whatever is current when the burst ends, not what started it.
    void tasksSet(appState.tasks).catch((e) => (appState.error = String(e)));
  };
  tasksTimer = debounced ? setTimeout(write, SETTINGS_SAVE_DEBOUNCE_MS) : undefined;
  if (!debounced) write();
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
  await applyZoom(next);
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
