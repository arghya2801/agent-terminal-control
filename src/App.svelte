<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import ProviderPicker from './lib/ProviderPicker.svelte';
  import { providerName, sessionKey } from './lib/agents';
  import TabBar from './tabs/TabBar.svelte';
  import DebugOverlay from './debug/DebugOverlay.svelte';
  import Sidebar from './sidebar/Sidebar.svelte';
  import FindBar from './terminal/FindBar.svelte';
  import SettingsPanel from './settings/SettingsPanel.svelte';
  import UsagePanel from './usage/UsagePanel.svelte';
  import ShortcutsPanel from './settings/ShortcutsPanel.svelte';
  import ConfirmDialog from './lib/ConfirmDialog.svelte';
  import Icon from './lib/Icon.svelte';
  import Tooltip from './lib/Tooltip.svelte';
  import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
  } from './lib/desktop';
  import {
    adjustZoom,
    appState,
    currentZoom,
    enterMs,
    initStores,
    saveSettings,
    sidebarOpen,
    toggleSidebar,
    setSidebarView,
    sidebarView,
  } from './lib/stores.svelte';
  import {
    bindSessions,
    closeTab,
    cycleTab,
    displayTitle,
    focusActiveTerminal,
    getActiveKey,
    getTab,
    busyWith,
    listTabs,
    mount as mountTerminals,
    onAttention,
    onChange,
    onChord,
    openTab,
    refit,
    refitNow,
    renameTab,
    activate,
    focusOtherPane,
    isSplit,
    getSplitRatio,
    setSplitRatio,
    splitWith,
    unsplit,
    type AttentionReason,
    type Tab,
  } from './terminal/manager';
  import { matchChord, type Action } from './lib/keymap';
  import { parseSavedTabs, type SavedTab } from './lib/restore';
  import { agentCommand, openDevtools, scratchDir } from './lib/ipc';
  import { projectKey } from './lib/paths';
  import { resolveSessions, type TabRef } from './lib/sessions';
  import { zoomLabel } from './lib/zoom';
  import type { AgentProvider, Project, SessionMeta, TabKey, TabSummary } from './types';
  import type { SessionMark } from './lib/format';

  let wrapper: HTMLDivElement;
  let tabs = $state<TabSummary[]>([]);
  let activeKey = $state<TabKey | null>(null);
  let openProjectKeys = $state<Set<string>>(new Set());
  let tabSessions = $state<(TabRef & { activity: SessionMark; exited: boolean })[]>([]);

  /** Which sidebar session each tab is showing. See `resolveSessions` for how. */
  const tabToSession = $derived(resolveSessions(tabSessions, appState.index.projects));

  /** Which sessions have a tab, and what Claude is doing in each. */
  const sessionMarks = $derived.by(() => {
    const marks = new Map<string, SessionMark>();
    for (const t of tabSessions) {
      if (t.exited) continue;
      const id = tabToSession.get(t.key);
      if (id) marks.set(id, t.activity);
    }
    return marks;
  });

  /** The sidebar row to highlight: the session the focused tab is showing. */
  const activeSessionId = $derived(activeKey ? (tabToSession.get(activeKey) ?? null) : null);

  /** The session a tab is showing, for deciding how to restore it. */
  function sessionIdOf(t: Tab): string | null {
    const key = t.boundSession ?? tabToSession.get(t.key);
    return key ? key.slice(key.indexOf(':') + 1) : null;
  }

  // --- restore tabs on launch
  const TABS_KEY = import.meta.env.VITE_ATC_PLAYGROUND === '1' ? 'atc.playground.tabs' : 'atc.tabs';
  /** Until startup has reopened the saved tabs, saving would overwrite them. */
  let restoring = $state(true);

  let savedTabs = '';
  function saveTabs(all: Tab[]) {
    if (restoring) return;
    // Exited tabs are kept: they are still in the tab bar, and on quit every shell exits
    // just before the window goes, which must not wipe what gets restored.
    const tabs = all.map((t): SavedTab => {
      const common = { projectKey: t.projectKey, customTitle: t.customTitle };
      const sessionId = sessionIdOf(t);
      if (sessionId && t.cwd) return { kind: 'session', provider: t.provider ?? 'claude', sessionId, cwd: t.cwd, ...common };
      if (t.provider && t.cwd) return { kind: 'agent', provider: t.provider, cwd: t.cwd, ...common };
      return { kind: 'shell', cwd: t.cwd, project: t.key.startsWith('project:'), ...common };
    });
    try {
      const active = all.findIndex((t) => t.key === activeKey);
      const text = JSON.stringify({ tabs, active });
      // Every tab event lands here (titles change constantly); only real changes write.
      if (text === savedTabs) return;
      localStorage.setItem(TABS_KEY, text);
      savedTabs = text;
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
        key = `session:${t.provider}:${t.sessionId}`;
        const label = appState.index.projects
          .flatMap((p) => p.sessions)
          .find((s) => s.id === t.sessionId && s.provider === t.provider)?.label;
        const command = await agentCommand(t.provider, t.sessionId);
        await guard(() =>
          openTab(key, label ?? providerName(t.provider), { cwd: t.cwd, initialCommand: command }, t.projectKey, t.provider),
        );
      } else if (t.kind === 'agent') {
        counter += 1;
        key = `agent:${t.provider}:${counter}`;
        await guard(async () => openTab(key, providerName(t.provider), { cwd: t.cwd, initialCommand: await agentCommand(t.provider) }, t.projectKey, t.provider, knownSessions()));
      } else if (t.kind === 'shell' && t.project && t.projectKey) {
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
  /** Svelte's `cubicOut`, which the drawer uses, so drawer and terminal move as one. */
  const DRAWER_EASE = 'cubic-bezier(0.33, 1, 0.68, 1)';
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

  let split = $state(false);
  let splitRatio = $state(0.5);

  function dragSplit(e: PointerEvent) {
    if (e.button !== 0) return;
    const handle = e.currentTarget as HTMLElement;
    const box = wrapper.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setSplitRatio((m.clientX - box.left) / box.width);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
  }

  function sync() {
    split = isSplit();
    splitRatio = getSplitRatio();
    const all = listTabs();
    tabs = all.map((t) => ({
      key: t.key,
      provider: t.provider,
      title: displayTitle(t),
      exited: t.exited,
      attention: t.attention,
      activity: t.activity,
      projectKey: t.projectKey,
    }));
    const nextActive = getActiveKey();
    // Picking a tab means the user wants the terminal, not the page covering it.
    if (nextActive !== activeKey) page = null;
    activeKey = nextActive;
    openProjectKeys = new Set(all.flatMap((t) => (t.projectKey ? [t.projectKey] : [])));
    // Before saveTabs: it asks which session each tab is showing, and that answer is
    // derived from this list. Saving first would persist the previous tick's answer.
    tabSessions = all.map((t) => ({
      key: t.key,
      provider: t.provider,
      projectKey: t.projectKey,
      cwd: t.cwd,
      claudeName: t.claudeName,
      boundSession: t.boundSession,
      existingSessions: t.existingSessions,
      startedAt: t.startedAt,
      activity: t.attention ? 'attention' : (t.activity ?? 'open'),
      exited: t.exited,
    }));
    saveTabs(all);
  }

  async function guard(fn: () => Promise<unknown>) {
    try {
      await fn();
      error = null;
    } catch (e) {
      error = String(e);
    }
  }

  /** Split beside the next tab, opening a shell when there is no other (#21). */
  async function toggleSplit() {
    if (isSplit()) return unsplit();
    const current = activeKey;
    let other = tabs.find((t) => t.key !== current)?.key ?? null;
    if (!other) {
      // A new tab becomes the active one.
      await newTab();
      other = getActiveKey();
    }
    if (current && other && other !== current) {
      activate(current);
      splitWith(other);
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

  function knownSessions(): string[] { return appState.index.projects.flatMap(p => p.sessions.map(sessionKey)); }

  function newAgentIn(p: Project, provider: AgentProvider) {
    if (!p.path) return;
    counter += 1;
    const key: TabKey = `agent:${provider}:${counter}`;
    const existing = knownSessions();
    return guard(async () => openTab(key, p.name, { cwd: p.path, initialCommand: await agentCommand(provider) }, p.key, provider, existing));
  }

  /** No project: the scratch directory, or with `chats` the chats directory (#135). */
  let picker = $state<{ project: Project | null; chats?: boolean } | null>(null);
  function finishPicker(provider?: AgentProvider) {
    const target = picker;
    picker = null;
    if (!provider || !target) { void tick().then(focusActiveTerminal); return; }
    if (target.project) { void newAgentIn(target.project, provider); return; }
    void guard(async () => {
      const cwd = await scratchDir(target.chats ? 'chats' : undefined);
      const name = target.chats ? `${providerName(provider)} chat` : `Ask ${providerName(provider)}`;
      await newAgentIn({ key: projectKey(cwd), path: cwd, name, pinned: false, exists: true, lastActiveMs: 0, sessions: [] }, provider);
    });
  }

  function openSession(p: Project, s: SessionMeta) {
    const cwd = s.cwd ?? p.path;
    if (!cwd) return;
    // A fresh launch already bound to this conversation is reused too.
    const existing = listTabs().find(t => t.boundSession === sessionKey(s));
    if (existing) { activate(existing.key); return; }
    return guard(async () => openTab(`session:${sessionKey(s)}`, s.label,
      { cwd, initialCommand: await agentCommand(s.provider, s.id) }, p.key, s.provider));
  }

  $effect(() => { bindSessions(tabToSession, appState.index.projects.flatMap(p => p.sessions)); });

  /**
   * Every close goes through here, button or chord. A tab at a bare prompt closes at
   * once; one with a live process asks first, naming what would be stopped.
   */
  async function requestClose(key: TabKey) {
    const tab = getTab(key);
    if (!tab) return;
    const running = await busyWith(key);
    if (!running) {
      void closeTab(key);
      return;
    }
    const agent = tab.provider && /codex|claude|node/i.test(running);
    closing = { key, title: displayTitle(tab), what: agent ? `${providerName(tab.provider!)} session` : running };
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
  /** In-app notes for background tabs, while ATC has focus and Windows would show nothing. */
  let toasts = $state<{ id: number; key: TabKey; title: string; body: string }[]>([]);
  let toastId = 0;
  function dismissToast(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
  }

  function attentionBody(provider: AgentProvider | null, reason: AttentionReason) {
    return reason === 'finished' ? `${provider ? providerName(provider) : 'Agent'} finished and is waiting for you.` : 'Needs your attention.';
  }

  async function notifyAttention(key: TabKey, title: string, provider: AgentProvider | null, reason: AttentionReason) {
    if (document.hasFocus()) {
      const id = ++toastId;
      toasts = [...toasts.filter((t) => t.key !== key), { id, key, title, body: attentionBody(provider, reason) }].slice(-3);
      setTimeout(() => dismissToast(id), 6000);
      return;
    }
    if (appState.settings?.ui.notifications === false) return;
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === 'granted';
      if (!granted) return;
      sendNotification({ title, body: attentionBody(provider, reason) });
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
      case 'openAgentHere': {
        const p = activeProject();
        if (p) picker = { project: p };
        else error = 'This tab is not in a project, so there is nowhere to open an agent.';
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
      case 'switchSidebarView':
        if (!sidebarOpen()) void toggleSidebar();
        void setSidebarView(({ sessions: 'open', open: 'scratch', scratch: 'sessions' } as const)[sidebarView()]);
        break;
      case 'askAgent':
        picker = { project: null };
        break;
      case 'toggleSplit':
        void toggleSplit();
        break;
      case 'focusOtherPane':
        focusOtherPane();
        break;
    }
  }

  onMount(() => {
    const off = onChange(sync);
    // Chords pressed while the terminal has focus arrive here, already consumed by
    // xterm's interceptor so they never reach the shell.
    const offChord = onChord(runAction);
    const offAttention = onAttention((t, reason) => void notifyAttention(t.key, displayTitle(t), t.provider, reason));
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
      if (picker) return;
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

  // The terminal shares the wrapper's geometry, so it re-measures whenever the panel
  // changes; otherwise ConPTY keeps the old column count. Waiting any longer than
  // refit's own debounce leaves the terminal clipped at its old width, then jumping.
  $effect(() => {
    void width;
    refit();
  });

  // Toggling the sidebar: the column snaps and the terminal takes its final size in the
  // same frame, then slides with the drawer. Resizing after the slide made it jump.
  let main: HTMLElement;
  $effect(() => {
    const isOpen = open;
    // Untracked: startup ending is not a toggle.
    if (untrack(() => restoring)) return refit();
    refitNow();
    const ms = enterMs();
    const w = untrack(() => width);
    if (ms) main.animate([{ transform: `translateX(${isOpen ? -w : w}px)` }, { transform: 'none' }], { duration: ms, easing: DRAWER_EASE });
  });
</script>

<div class="app" style="--panel: {open ? width : 0}px">
  <nav class="rail" data-tip-side="right">
    <button
      class="rail-btn"
      class:on={open}
      onclick={() => toggleSidebar()}
      title="Toggle projects (Ctrl+Shift+B)"
      aria-label="Toggle projects"
    >
      <Icon name="sidebar" />
    </button>
    <button
      class="rail-btn"
      onclick={() => newTab()}
      title="New shell (Ctrl+Shift+T)"
      aria-label="New shell"
    >
      <Icon name="plus" />
    </button>
    <button
      class="rail-btn"
      onclick={() => (picker = { project: null })}
      title="Ask agent, outside any project (Ctrl+Shift+A)"
      aria-label="Ask agent"
    >
      <Icon name="agent" />
    </button>
    <button
      class="rail-btn"
      class:on={page === 'usage'}
      onclick={() => togglePage('usage')}
      title="Usage and spend (Ctrl+Shift+U)"
      aria-label="Usage and spend"
    >
      <Icon name="usage" />
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
      class="rail-btn"
      class:on={page === 'shortcuts'}
      onclick={() => togglePage('shortcuts')}
      title="Keyboard shortcuts (Ctrl+Shift+?)"
      aria-label="Keyboard shortcuts"
    >
      <Icon name="keyboard" />
    </button>
    <button
      class="rail-btn"
      class:on={page === 'settings'}
      onclick={() => togglePage('settings')}
      title="Settings (Ctrl+,)"
      aria-label="Settings"
    >
      <Icon name="settings" />
    </button>
    <button
      class="rail-btn"
      class:on={showDebug}
      onclick={() => (showDebug = !showDebug)}
      title="PTY stats (Ctrl+Shift+D)"
      aria-label="Toggle debug overlay"
    >
      <Icon name="pulse" />
    </button>
  </nav>

  <aside class="panel">
    {#if open}
      <div
        class="drawer"
        style="width: {width}px"
        transition:fly={{ x: -width, opacity: 1, duration: restoring ? 0 : enterMs(), easing: cubicOut }}
      >
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
        onNewAgent={newAgentIn}
        onNewChat={() => (picker = { project: null, chats: true })}
        onPickAgent={(p) => (picker = { project: p })}
        {tabs}
        onNewTab={newTab}
        onCloseTab={requestClose}
      />
      </div>
    {/if}
  </aside>

  <section class="main" bind:this={main}>
    <TabBar {tabs} {activeKey} onNew={newTab} onClose={requestClose} bind:renaming={renamingTab} />
    <div class="panes" bind:this={wrapper}>
      {#if split}
        <div
          class="split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          title="Drag to resize, double-click to make them equal"
          style="left: {splitRatio * 100}%"
          onpointerdown={dragSplit}
          ondblclick={() => setSplitRatio(0.5)}
        ></div>
      {/if}
    </div>
    {#if page === 'settings'}
      <SettingsPanel onClose={() => (page = null)} />
    {:else if page === 'usage'}
      <UsagePanel onClose={() => (page = null)} sessionKey={activeSessionId} />
    {:else if page === 'shortcuts'}
      <ShortcutsPanel onClose={() => (page = null)} />
    {/if}
    {#if showFind}
      <FindBar onClose={() => (showFind = false)} />
    {/if}
    {#if showDebug}
      <DebugOverlay {activeKey} />
    {/if}
    {#if picker}
      <ProviderPicker
        title={picker.project ? `New agent in ${picker.project.name}` : picker.chats ? 'New chat' : 'Ask an agent'}
        detail={picker.project?.path ?? null}
        onPick={finishPicker}
        onCancel={() => finishPicker()}
      />
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
    <div class="corner" aria-live="polite">
      {#each toasts as t (t.id)}
        <div class="toast">
          <button class="toast-body" onclick={() => { activate(t.key); dismissToast(t.id); }} title="Go to this tab">
            <strong>{t.title}</strong>
            <span>{t.body}</span>
          </button>
          <button class="dismiss" onclick={() => dismissToast(t.id)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      {/each}
      {#if error}
        <div class="error">
          {error}
          <button class="dismiss" onclick={() => (error = null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      {/if}
    </div>
  </section>
</div>
<Tooltip />

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
    position: relative;
    z-index: 2;
    padding: 8px 0;
    border-right: 1px solid var(--border);
    background: var(--glass-chrome);
  }
  .rail-btn {
    position: relative;
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-faint);
    line-height: 1;
    cursor: pointer;
  }
  .rail-btn:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .rail-btn:active {
    transform: scale(0.94);
  }
  .rail-btn.on {
    color: var(--accent);
  }
  /* Flush with the window edge, so the open page reads as attached to its button. */
  .rail-btn::before {
    position: absolute;
    top: 7px;
    bottom: 7px;
    left: -6px;
    width: 2px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
    content: '';
    transform: scaleY(0);
    transition: transform var(--enter) var(--ease-out);
  }
  .rail-btn.on::before {
    transform: scaleY(1);
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
  /* The drawer is not clipped to its column: sliding out, it overlays the terminal that
     has already taken the column back. The rail covers it from the other side. */
  .panel {
    position: relative;
  }
  .drawer {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 1;
  }
  /* Centred on the sidebar's border. The line and grip wait a beat on hover, so passing
     the mouse across does not flash them. */
  .resize {
    position: absolute;
    top: 0;
    right: -4px;
    bottom: 0;
    z-index: 5;
    width: 8px;
    cursor: col-resize;
  }
  .split-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 3;
    width: 8px;
    margin-left: -4px;
    cursor: col-resize;
  }
  .resize::before,
  .resize::after,
  .split-handle::before,
  .split-handle::after {
    position: absolute;
    left: 3px;
    width: 2px;
    background: var(--accent);
    content: '';
    opacity: 0;
    transition: opacity var(--fast);
  }
  .resize::before,
  .split-handle::before {
    top: 0;
    bottom: 0;
  }
  .resize::after,
  .split-handle::after {
    top: 50%;
    left: 1px;
    width: 6px;
    height: 32px;
    margin-top: -16px;
    border-radius: 3px;
  }
  .resize:hover::before,
  .resize:hover::after,
  .split-handle:hover::before,
  .split-handle:hover::after {
    opacity: 1;
    transition-delay: 150ms;
  }
  .resize.dragging::before,
  .resize.dragging::after {
    opacity: 1;
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
    background: var(--bg);
    flex: 1;
    min-height: 0;
    padding: 6px 0 0 8px;
  }
  /* Toasts and the error stack here, newest at the bottom, so they never overlap. */
  .corner {
    position: absolute;
    right: 12px;
    bottom: 12px;
    z-index: 25;
    display: flex;
    max-width: min(60%, 420px);
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
    pointer-events: none;
  }
  .toast,
  .error {
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 8px;
    box-shadow: var(--shadow-pop);
    font-size: 12px;
    pointer-events: auto;
    animation: atc-rise var(--enter) var(--ease-out);
  }
  .toast {
    padding: 4px 6px 4px 4px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    background: var(--bg-chrome);
  }
  .toast-body {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    padding: 4px 8px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .toast-body:hover {
    background: var(--bg-hover);
  }
  .toast-body strong {
    overflow: hidden;
    color: var(--fg-bright);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .error {
    padding: 8px 8px 8px 12px;
    border: 1px solid var(--danger-strong);
    background: color-mix(in srgb, var(--danger) 12%, var(--bg-chrome));
    color: var(--danger);
  }
  .dismiss {
    padding: 2px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .toast .dismiss {
    color: var(--fg-faint);
  }
  .dismiss:hover {
    background: var(--bg-hover);
  }
</style>
