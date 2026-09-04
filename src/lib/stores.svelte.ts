/**
 * Index and settings state, shared across components.
 *
 * The `.svelte.ts` extension is required: Svelte 5 only compiles runes in `.svelte` and
 * `.svelte.ts` files, so `$state` in a plain `.ts` would silently not be reactive.
 */

import { listen } from '@tauri-apps/api/event';
import { indexRefresh, indexSnapshot, settingsGet, settingsSet } from './ipc';
import {
  anyExpanded,
  isExpandedIn,
  setAll,
  toggleIn,
  type Collapsed,
} from './expansion';
import type { IndexSnapshot, Settings } from '../types';

const EVENT_INDEX_UPDATED = 'index://updated';

/// Named `appState`, not `state`: an import called `state` shadows the `$state` rune
/// in any component that uses it, which fails to compile in confusing ways.
export const appState = $state({
  index: { projects: [], sessionCount: 0 } as IndexSnapshot,
  settings: null as Settings | null,
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

export async function initStores() {
  try {
    appState.settings = await settingsGet();
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
  appState.settings = next;
  try {
    await settingsSet(next);
  } catch (e) {
    appState.error = String(e);
  }
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
