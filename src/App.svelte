<script lang="ts">
  import { onMount, tick } from 'svelte';
  import TabBar from './tabs/TabBar.svelte';
  import DebugOverlay from './debug/DebugOverlay.svelte';
  import Sidebar from './sidebar/Sidebar.svelte';
  import FindBar from './terminal/FindBar.svelte';
  import SettingsPanel from './settings/SettingsPanel.svelte';
  import UsagePanel from './usage/UsagePanel.svelte';
  import ShortcutsPanel from './settings/ShortcutsPanel.svelte';
  import ConfirmDialog from './lib/ConfirmDialog.svelte';
  import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
  } from '@tauri-apps/plugin-notification';
  import {
    adjustZoom,
    appState,
    currentZoom,
    initStores,
    saveSettings,
    sidebarOpen,
    toggleSidebar,
  } from './lib/stores.svelte';
  import {
    closeTab,
    cycleTab,
    displayTitle,
    focusActiveTerminal,
    getActiveKey,
    getTab,
    isBusy,
    listTabs,
    mount as mountTerminals,
    onAttention,
    onChange,
    onChord,
    openTab,
    refit,
    renameTab,
    activate,
    type AttentionReason,
    type Tab,
  } from './terminal/manager';
  import { matchChord, type Action } from './lib/keymap';
  import { parseSavedTabs, type SavedTab } from './lib/restore';
  import { openDevtools, scratchDir } from './lib/ipc';
  import { projectKey } from './lib/paths';
  import { zoomLabel } from './lib/zoom';
  import type { Project, SessionMeta, TabKey } from './types';
  import type { SessionMark } from './sidebar/SessionNode.svelte';

  let wrapper: HTMLDivElement;
  let tabs = $state<{ key: TabKey; title: string; exited: boolean; attention: boolean }[]>([]);
  let activeKey = $state<TabKey | null>(null);
  let openProjectKeys = $state<Set<string>>(new Set());
  let tabSessions = $state<
    {
      key: TabKey;
      projectKey: string | null;
      activity: SessionMark;
      claudeName: string | null;
      exited: boolean;
    }[]
  >([]);

  /**
   * Which sessions have a tab, and what Claude is doing in each. A resumed tab knows its
   * session from its key; one started with "Open Claude here" is matched by the name
   * Claude puts in its title, which is the same name the sidebar shows.
   */
  const sessionMarks = $derived.by(() => {
    const marks = new Map<string, SessionMark>();
    for (const t of tabSessions) {
      if (t.exited) continue;
      const id = sessionIdOf(t);
      if (id) marks.set(id, t.activity);
    }
    return marks;
  });

  /**
   * The sidebar row to highlight. Resolved through `sessionIdOf` rather than compared
   * against the tab key: a tab started with "Open Claude here" or the scratch pad is
   * keyed `claude:n` and only knows its session by name, so keying off the tab alone
   * left the row you were looking at unhighlighted.
   */
  const activeSessionId = $derived.by(() => {
    const tab = tabSessions.find((t) => t.key === activeKey);
    return tab ? sessionIdOf(tab) : null;
  });

  function sessionIdOf(t: { key: TabKey; projectKey: string | null; claudeName: string | null }) {
    if (t.key.startsWith('session:')) return t.key.slice('session:'.length);
    if (!t.key.startsWith('claude:') || !t.claudeName) return null;
    const project = appState.index.projects.find((p) => p.key === t.projectKey);
    return project?.sessions.find((x) => x.label === t.claudeName)?.id ?? null;
  }

  // --- restore tabs on launch
  const TABS_KEY = 'atc.tabs';
  /** Until startup has reopened the saved tabs, saving would overwrite them. */
  let restoring = true;

  function saveTabs(all: Tab[]) {
    if (restoring) return;
    // Exited tabs are kept: they are still in the tab bar, and on quit every shell exits
    // just before the window goes, which must not wipe what gets restored.
    const tabs = all.map((t): SavedTab => {
      const common = { projectKey: t.projectKey, customTitle: t.customTitle };
      const sessionId = sessionIdOf(t);
      if (sessionId && t.cwd) return { kind: 'session', sessionId, cwd: t.cwd, ...common };
      return { kind: 'shell', cwd: t.cwd, project: t.key.startsWith('project:'), ...common };
    });
    try {
      const active = all.findIndex((t) => t.key === activeKey);
      localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, active }));
    } catch {
      // Storage unavailable: tabs just are not restored next time.
    }
  }

  /** Reopen last session's tabs. False when there was nothing to reopen. */
  async function restoreTabs(): Promise<boolean> {
    if (appState.settings?.ui.restoreTabs === false) return false;
    let saved;
    try {
      saved = parseSavedTabs(localStorage.getItem(TABS_KEY));
    } catch {
      saved = null;
    }
    if (!saved) return false;

    const keys: TabKey[] = [];
    for (const t of saved.tabs) {
      let key: TabKey;
      if (t.kind === 'session') {
        key = `session:${t.sessionId}`;
        const label = appState.index.projects
          .flatMap((p) => p.sessions)
          .find((s) => s.id === t.sessionId)?.label;
        const command = resumeCommand(t.sessionId);
        await guard(() =>
          openTab(key, label ?? 'claude', { cwd: t.cwd, initialCommand: command }, t.projectKey),
        );
      } else if (t.project && t.projectKey) {
        key = `project:${t.projectKey}`;
        const name = appState.index.projects.find((p) => p.key === t.projectKey)?.name ?? 'pwsh';
        await guard(() => openTab(key, name, { cwd: t.cwd }, t.projectKey));
      } else {
        // Fresh plain keys, so the counter cannot collide with a restored tab.
        counter += 1;
        key = `plain:${counter}`;
        await guard(() => openTab(key, `pwsh ${counter}`, { cwd: t.cwd }, t.projectKey));
      }
      if (t.customTitle) renameTab(key, t.customTitle);
      keys.push(key);
    }
    const focus = keys[saved.active];
    if (focus) activate(focus);
    return listTabs().length > 0;
  }
  let showDebug = $state(false);
  let showFind = $state(false);
  type PageName = 'settings' | 'usage' | 'shortcuts';
  let page = $state<PageName | null>(null);
  let renamingTab = $state<TabKey | null>(null);
  /** A busy tab waiting on the close confirmation. */
  let closing = $state<{ key: TabKey; title: string; what: string } | null>(null);

  function togglePage(p: PageName) {
    page = page === p ? null : p;
  }
  let error = $state<string | null>(null);
  let counter = 0;

  const open = $derived(sidebarOpen());
  // Same limits as the settings page.
  const SIDEBAR_MIN = 160;
  const SIDEBAR_MAX = 800;
  const SIDEBAR_DEFAULT = 260;
  /** Live width while the edge is being dragged; saved once, when the drag ends. */
  let dragWidth = $state<number | null>(null);
  const width = $derived(dragWidth ?? appState.settings?.ui.sidebarWidth ?? SIDEBAR_DEFAULT);

  function saveSidebarWidth(w: number) {
    if (!appState.settings || appState.settings.ui.sidebarWidth === w) return;
    void saveSettings({ ...appState.settings, ui: { ...appState.settings.ui, sidebarWidth: w } });
  }

  function startResize(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = width;
    const move = (ev: PointerEvent) => {
      const w = Math.round(startWidth + ev.clientX - startX);
      dragWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      if (dragWidth !== null) saveSidebarWidth(dragWidth);
      dragWidth = null;
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  function sync() {
    const all = listTabs();
    tabs = all.map((t) => ({
      key: t.key,
      title: displayTitle(t),
      exited: t.exited,
      attention: t.attention,
    }));
    const nextActive = getActiveKey();
    // Picking a tab means the user wants the terminal, not the page covering it.
    if (nextActive !== activeKey) page = null;
    activeKey = nextActive;
    openProjectKeys = new Set(all.flatMap((t) => (t.projectKey ? [t.projectKey] : [])));
    saveTabs(all);
    tabSessions = all.map((t) => ({
      key: t.key,
      projectKey: t.projectKey,
      activity: t.attention ? 'attention' : (t.activity ?? 'open'),
      claudeName: t.claudeName,
      exited: t.exited,
    }));
  }

  async function guard(fn: () => Promise<unknown>) {
    try {
      await fn();
      error = null;
    } catch (e) {
      error = String(e);
    }
  }

  function newTab() {
    counter += 1;
    return guard(() => openTab(`plain:${counter}`, `pwsh ${counter}`, { cwd: null }));
  }

  function openProject(p: Project) {
    if (!p.path) return;
    return guard(() => openTab(`project:${p.key}`, p.name, { cwd: p.path }, p.key));
  }

  /** Always a fresh tab, unlike openProject which focuses an existing one. */
  function newShellIn(p: Project) {
    if (!p.path) return;
    counter += 1;
    return guard(() => openTab(`plain:${counter}`, p.name, { cwd: p.path }, p.key));
  }

  function newClaudeIn(p: Project) {
    if (!p.path) return;
    counter += 1;
    const command = appState.settings?.claude.command || 'claude';
    return guard(() =>
      openTab(`claude:${counter}`, p.name, { cwd: p.path, initialCommand: command }, p.key),
    );
  }

  /**
   * Claude in a scratch directory, for questions that belong to no project: a branch
   * comparison, a curl against some server. Keeps such sessions out of real projects.
   */
  function askClaude() {
    counter += 1;
    const n = counter;
    const command = appState.settings?.claude.command || 'claude';
    return guard(async () => {
      const cwd = await scratchDir();
      // The scratch directory is a real project to Claude, so name it here too. Without a
      // project key its session cannot be matched to a sidebar row at all: no activity
      // dot, no highlight.
      await openTab(`claude:${n}`, 'Ask Claude', { cwd, initialCommand: command }, projectKey(cwd));
    });
  }

  function openSession(p: Project, s: SessionMeta) {
    // Resume needs a real directory. A path reconstructed from the lossy folder name
    // would be wrong, so such rows are disabled rather than guessed at.
    const cwd = s.cwd ?? p.path;
    if (!cwd) return;
    const command = resumeCommand(s.id);
    return guard(() =>
      openTab(`session:${s.id}`, s.label, { cwd, initialCommand: command }, p.key),
    );
  }

  function resumeCommand(id: string): string {
    const claude = appState.settings?.claude;
    return claude
      ? [claude.command, ...claude.resumeArgs.map((a) => a.replace('{session}', id))].join(' ')
      : `claude --resume ${id}`;
  }

  /**
   * Every close goes through here, button or chord. A tab at a bare prompt closes at
   * once; one with a live process asks first, naming what would be stopped.
   */
  function requestClose(key: TabKey) {
    const tab = getTab(key);
    if (!tab) return;
    if (!isBusy(key)) {
      void closeTab(key);
      return;
    }
    const claude = key.startsWith('session:') || key.startsWith('claude:');
    closing = { key, title: displayTitle(tab), what: claude ? 'Claude session' : 'shell' };
  }

  function finishClose(confirmed: boolean) {
    const c = closing;
    closing = null;
    if (c && confirmed) void closeTab(c.key);
    else focusActiveTerminal();
  }

  async function focusSearch() {
    if (!sidebarOpen()) await toggleSidebar();
    await tick();
    const input = document.getElementById('sidebar-search') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }

  /** Windows notification for a background tab, only while ATC itself is not focused. */
  async function notifyAttention(title: string, reason: AttentionReason) {
    if (document.hasFocus() || appState.settings?.ui.notifications === false) return;
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      if (!granted) return;
      sendNotification({
        title,
        body: reason === 'finished' ? 'Claude finished and is waiting for you.' : 'Needs your attention.',
      });
    } catch (e) {
      console.warn('notification failed', e);
    }
  }

  /** The sidebar project the focused tab belongs to, if it has one. */
  function activeProject(): Project | undefined {
    const key = activeKey ? getTab(activeKey)?.projectKey : null;
    return key ? appState.index.projects.find((p) => p.key === key) : undefined;
  }

  // One implementation of every chord, so a shortcut behaves identically whether focus
  // is in the terminal or the sidebar.
  function runAction(action: Action) {
    switch (action) {
      case 'toggleSidebar':
        void toggleSidebar();
        break;
      case 'newTab':
        void newTab();
        break;
      case 'toggleDebug':
        showDebug = !showDebug;
        break;
      case 'closeTab':
        if (activeKey) requestClose(activeKey);
        break;
      case 'nextTab':
        cycleTab(1);
        break;
      case 'prevTab':
        cycleTab(-1);
        break;
      case 'toggleDevtools':
        void openDevtools();
        break;
      case 'find':
        // Re-opening while already open should put the cursor back in the box.
        showFind = false;
        void tick().then(() => (showFind = true));
        break;
      case 'zoomIn':
        void adjustZoom(1);
        break;
      case 'zoomOut':
        void adjustZoom(-1);
        break;
      case 'zoomReset':
        void adjustZoom(0);
        break;
      case 'openClaudeHere': {
        const p = activeProject();
        if (p) void newClaudeIn(p);
        else error = 'This tab is not in a project, so there is nowhere to open Claude.';
        break;
      }
      case 'openShellHere': {
        const p = activeProject();
        if (p) void newShellIn(p);
        else error = 'This tab is not in a project, so there is nowhere to open a terminal.';
        break;
      }
      case 'renameTab':
        page = null;
        renamingTab = activeKey;
        break;
      case 'openSettings':
        togglePage('settings');
        break;
      case 'openUsage':
        togglePage('usage');
        break;
      case 'showShortcuts':
        togglePage('shortcuts');
        break;
      case 'focusSearch':
        void focusSearch();
        break;
      case 'askClaude':
        void askClaude();
        break;
    }
  }

  onMount(() => {
    const off = onChange(sync);
    // Chords pressed while the terminal has focus arrive here, already consumed by
    // xterm's interceptor so they never reach the shell.
    const offChord = onChord(runAction);
    const offAttention = onAttention((t, reason) => void notifyAttention(displayTitle(t), reason));
    mountTerminals(wrapper);
    // Settings decide whether the sidebar is open, and so how wide the pane is.
    // Spawning before that lands starts the PTY at the wrong width.
    void (async () => {
      await initStores();
      const restored = await restoreTabs();
      restoring = false;
      if (!restored) await newTab();
      sync();
    })();

    // Covers focus being anywhere outside the terminal -- the sidebar, a button.
    const onKey = (e: KeyboardEvent) => {
      const action = matchChord(e);
      if (!action) return;
      e.preventDefault();
      runAction(action);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', refit);

    return () => {
      off();
      offChord();
      offAttention();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', refit);
    };
  });

  // The terminal shares the wrapper's geometry, so it must re-measure once the panel
  // has finished animating -- otherwise ConPTY keeps the old column count.
  $effect(() => {
    void open;
    void width;
    const t = setTimeout(refit, 180);
    return () => clearTimeout(t);
  });
</script>

<div class="app" style="--panel: {open ? width : 0}px">
  <nav class="rail">
    <button
      class="rail-btn"
      class:on={open}
      onclick={() => toggleSidebar()}
      title="Toggle projects (Ctrl+Shift+B)"
      aria-label="Toggle projects"
    >
      ▤
    </button>
    <button
      class="rail-btn"
      onclick={() => newTab()}
      title="New shell (Ctrl+Shift+T)"
      aria-label="New shell"
    >
      +
    </button>
    <button
      class="rail-btn"
      onclick={() => askClaude()}
      title="Ask Claude, outside any project (Ctrl+Shift+A)"
      aria-label="Ask Claude"
    >
      ✳
    </button>
    <button
      class="rail-btn"
      class:on={page === 'usage'}
      onclick={() => togglePage('usage')}
      title="Usage and spend (Ctrl+Shift+U)"
      aria-label="Usage and spend"
    >
      $
    </button>
    <div class="spacer"></div>
    {#if currentZoom() !== 1}
      <button
        class="rail-btn zoom"
        onclick={() => adjustZoom(0)}
        title="Reset zoom (Ctrl+0)"
        aria-label="Reset zoom"
      >
        {zoomLabel(currentZoom())}
      </button>
    {/if}
    <button
      class="rail-btn small"
      class:on={page === 'shortcuts'}
      onclick={() => togglePage('shortcuts')}
      title="Keyboard shortcuts (Ctrl+Shift+?)"
      aria-label="Keyboard shortcuts"
    >
      ?
    </button>
    <button
      class="rail-btn small"
      class:on={page === 'settings'}
      onclick={() => togglePage('settings')}
      title="Settings (Ctrl+,)"
      aria-label="Settings"
    >
      ⚙
    </button>
    <button
      class="rail-btn small"
      class:on={showDebug}
      onclick={() => (showDebug = !showDebug)}
      title="PTY stats (Ctrl+Shift+D)"
      aria-label="Toggle debug overlay"
    >
      ◔
    </button>
  </nav>

  <aside class="panel">
    {#if open}
      <div
        class="resize"
        class:dragging={dragWidth !== null}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize, double-click to reset"
        onpointerdown={startResize}
        ondblclick={() => saveSidebarWidth(SIDEBAR_DEFAULT)}
      ></div>
      <Sidebar
        {activeKey}
        {activeSessionId}
        {openProjectKeys}
        {sessionMarks}
        onOpenProject={openProject}
        onOpenSession={openSession}
        onNewShell={newShellIn}
        onNewClaude={newClaudeIn}
      />
    {/if}
  </aside>

  <section class="main">
    <TabBar {tabs} {activeKey} onNew={newTab} onClose={requestClose} bind:renaming={renamingTab} />
    <div class="panes" bind:this={wrapper}></div>
    {#if page === 'settings'}
      <SettingsPanel onClose={() => (page = null)} />
    {:else if page === 'usage'}
      <UsagePanel onClose={() => (page = null)} />
    {:else if page === 'shortcuts'}
      <ShortcutsPanel onClose={() => (page = null)} />
    {/if}
    {#if showFind}
      <FindBar onClose={() => (showFind = false)} />
    {/if}
    {#if showDebug}
      <DebugOverlay {activeKey} />
    {/if}
    {#if closing}
      <ConfirmDialog
        confirmLabel="Close tab"
        onConfirm={() => finishClose(true)}
        onCancel={() => finishClose(false)}
      >
        Close <strong>{closing.title}</strong>? The {closing.what} running in it will be stopped.
      </ConfirmDialog>
    {/if}
    {#if error}
      <div class="error">
        {error}
        <button onclick={() => (error = null)} aria-label="Dismiss">×</button>
      </div>
    {/if}
  </section>
</div>

<style>
  .app {
    display: grid;
    height: 100%;
    grid-template-columns: 44px var(--panel) 1fr;
  }
  .rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding-top: 8px;
    border-right: 1px solid var(--border);
    background: var(--bg-chrome);
  }
  .rail-btn {
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-faint);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }
  .rail-btn:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .rail-btn.on {
    color: var(--accent);
  }
  .rail-btn.small {
    font-size: 12px;
  }
  .rail-btn.zoom {
    width: auto;
    padding: 0 4px;
    color: var(--accent);
    font-size: 10px;
  }
  .spacer {
    flex: 1;
  }
  .panel {
    position: relative;
    overflow: hidden;
  }
  .resize {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    width: 5px;
    cursor: col-resize;
  }
  .resize:hover,
  .resize.dragging {
    background: color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .main {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
  }
  /* Every terminal pane is absolutely positioned inside this one box, so they all
     share its geometry and can be measured once. */
  .panes {
    position: relative;
    flex: 1;
    min-height: 0;
    padding: 6px 0 0 8px;
  }
  .error {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    max-width: 60%;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: 1px solid var(--danger-strong);
    border-radius: 8px;
    background: rgba(35, 15, 15, 0.95);
    color: var(--danger);
    font-size: 12px;
  }
  .error button {
    border: none;
    background: transparent;
    color: inherit;
    font-size: 15px;
    cursor: pointer;
  }
</style>
