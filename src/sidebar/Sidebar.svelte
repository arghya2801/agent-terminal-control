<script lang="ts">
  import SessionList from './SessionList.svelte';
  import OpenList from './OpenList.svelte';
  import NotesPad from './NotesPad.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import Icon from '../lib/Icon.svelte';
  import { focusActiveTerminal } from '../terminal/manager';
  import { enterList, listKeys, rows } from '../lib/roving';
  import {
    anyProjectExpanded,
    appState,
    refresh,
    setSidebarView,
    sidebarView,
    toggleAllProjects,
  } from '../lib/stores.svelte';
  import type { AgentProvider, Project, SessionMeta, TabKey, TabSummary } from '../types';
  import { tabMark, type SessionMark } from '../lib/format';

  let {
    activeKey,
    activeSessionId,
    tabs,
    openProjectKeys,
    sessionMarks,
    onOpenProject,
    onOpenSession,
    onNewShell,
    onNewAgent,
    onNewChat,
    onPickAgent,
    onNewTab,
    onCloseTab,
  }: {
    activeKey: TabKey | null;
    activeSessionId: string | null;
    tabs: TabSummary[];
    openProjectKeys: Set<string>;
    /** Sessions with a live tab, by id. */
    sessionMarks: Map<string, SessionMark>;
    onOpenProject: (p: Project) => void;
    onOpenSession: (p: Project, s: SessionMeta) => void;
    onNewShell: (p: Project) => void;
    onNewAgent: (p: Project, provider: AgentProvider) => void;
    onNewChat: () => void;
    /** Asks Claude or Codex, then starts it in the project (#146). */
    onPickAgent: (p: Project) => void;
    onNewTab: () => void;
    onCloseTab: (key: TabKey) => void;
  } = $props();

  let refreshing = $state(false);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const view = $derived(sidebarView());
  const working = $derived(tabs.filter((t) => tabMark(t) === 'working').length);
  const waiting = $derived(tabs.filter((t) => tabMark(t) === 'attention').length);
  const scratchSessions = $derived(
    appState.index.projects.filter((p) => p.kind).reduce((n, p) => n + p.sessions.length, 0),
  );

  let query = $state('');
  let openList = $state<HTMLElement>();
  let sessionList = $state<HTMLElement>();
  let scratchList = $state<HTMLElement>();
  /** Row last focused in each list, where Tab back into it lands. */
  let lastRow: HTMLElement | null = null;
  const visibleList = () => (view === 'open' ? openList : view === 'scratch' ? scratchList : sessionList);
  const search = () => document.getElementById('sidebar-search')?.focus();
  const leave = { up: search, escape: focusActiveTerminal };

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      const list = visibleList();
      if (list) rows(list)[0]?.focus();
      e.preventDefault();
      return;
    }
    if (e.key !== 'Escape') return;
    // A second Esc on an empty box goes back to the terminal.
    if (query) query = '';
    else focusActiveTerminal();
  }
  // Re-read on every index change so the label tracks projects appearing or vanishing.
  const anyOpen = $derived.by(() => {
    void appState.indexRevision;
    return anyProjectExpanded();
  });

  // The Open list's height; the notes pad takes the rest. Per machine, like the usage range.
  const OPEN_HEIGHT_KEY = 'atc.openListHeight';
  let openHeight = $state(200);
  try {
    openHeight = Number(localStorage.getItem(OPEN_HEIGHT_KEY)) || 200;
  } catch {
    // Storage unavailable: keep the default.
  }
  function setOpenHeight(h: number) {
    openHeight = Math.max(60, Math.min(Math.round(h), window.innerHeight - 200));
    try {
      localStorage.setItem(OPEN_HEIGHT_KEY, String(openHeight));
    } catch {
      // Storage unavailable: the height just is not remembered.
    }
  }
  function dragDivider(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    const y0 = e.clientY;
    const h0 = openHeight;
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setOpenHeight(h0 + m.clientY - y0);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
  }

  async function doRefresh() {
    refreshing = true;
    // Force, so an explicit refresh re-reads transcripts rather than trusting the cache.
    await refresh(true);
    refreshing = false;
  }
</script>

<div class="panel">
  <header>
    <div class="views" role="tablist" aria-label="Sidebar view">
      <button
        role="tab"
        aria-selected={view === 'sessions'}
        onclick={() => void setSidebarView('sessions')}
        title="Projects and sessions (Ctrl+Shift+K)"
      >
        Sessions <span class="n">{appState.index.sessionCount - scratchSessions}</span>
      </button>
      <button
        role="tab"
        aria-selected={view === 'open'}
        onclick={() => void setSidebarView('open')}
        title="Open tabs and notes (Ctrl+Shift+K)"
      >
        Open <span class="n">{tabs.length}</span>
      </button>
      <button
        role="tab"
        aria-selected={view === 'scratch'}
        onclick={() => void setSidebarView('scratch')}
        title="Chats and scratch sessions (Ctrl+Shift+K)"
      >
        Scratch <span class="n">{scratchSessions}</span>
      </button>
    </div>
    <div class="actions">
      {#if view === 'open'}
        <button class="icon" onclick={onNewTab} title="New tab (Ctrl+Shift+T)" aria-label="New tab"><Icon name="plus" size={14} /></button>
      {:else if view === 'scratch'}
        <button class="icon" onclick={onNewChat} title="New chat with Claude or Codex" aria-label="New chat"><Icon name="plus" size={14} /></button>
      {:else}
      <button
        class="icon"
        onclick={toggleAllProjects}
        title={anyOpen ? 'Collapse all' : 'Expand all'}
        aria-label={anyOpen ? 'Collapse all' : 'Expand all'}
      >
        <Icon name={anyOpen ? 'collapse' : 'expand'} size={14} />
      </button>
      <button
        class="icon"
        class:spin={refreshing}
        onclick={doRefresh}
        title="Rescan sessions"
        aria-label="Rescan sessions"
      >
        <Icon name="refresh" size={14} />
      </button>
      {/if}
    </div>
  </header>

  <div class="search">
    <input
      id="sidebar-search"
      type="search"
      placeholder={view === 'open' ? 'Filter open tabs' : view === 'scratch' ? 'Filter chats' : 'Filter projects and sessions'}
      title="Filter by project, path, session name or branch (Ctrl+Shift+P)"
      aria-label={view === 'open' ? 'Filter open tabs' : view === 'scratch' ? 'Filter chats' : 'Filter projects and sessions'}
      spellcheck="false"
      autocomplete="off"
      bind:value={query}
      onkeydown={onSearchKey}
    />
  </div>

  <!-- Both views stay mounted and the hidden one is display:none, so switching does not
       rebuild every project and session row (#117). -->
  <!-- One tab stop per list; Up/Down move between rows (#103). The list only takes focus
       to hand it to a row, the roving-tabindex pattern, hence the ignores. -->
  <div class="open" hidden={view !== 'open'}>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="list open-list"
      style="height: {openHeight}px"
      tabindex="0"
      role="group"
      aria-label="Open tabs"
      bind:this={openList}
      onfocus={(e) => openList && enterList(e, openList, lastRow)}
      onfocusin={(e) => (lastRow = (e.target as HTMLElement).closest('[data-row]'))}
      onkeydown={(e) => openList && listKeys(e, openList, leave)}
      oncontextmenu={(e) => {
        e.preventDefault();
        const items = appState.index.projects.filter((p) => p.path && p.exists).map((p) => ({ label: p.name, icon: 'folder' as const, run: () => onPickAgent(p) }));
        menu = { x: e.clientX, y: e.clientY, items: [{ label: 'New agent in…' }, ...items] };
      }}
    >
      <OpenList {tabs} {activeKey} {query} onClose={onCloseTab} />
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="divider"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the notes"
      aria-valuenow={openHeight}
      tabindex="0"
      title="Drag to resize"
      onpointerdown={dragDivider}
      onkeydown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          setOpenHeight(openHeight + (e.key === 'ArrowUp' ? -20 : 20));
        }
      }}
    >
      Notes <em>notes.md</em>
    </div>
    <NotesPad />
  </div>
  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="list"
    hidden={view !== 'sessions'}
    tabindex="0"
    role="group"
    aria-label="Projects and sessions"
    bind:this={sessionList}
    onfocus={(e) => sessionList && enterList(e, sessionList, lastRow)}
    onfocusin={(e) => (lastRow = (e.target as HTMLElement).closest('[data-row]'))}
    onkeydown={(e) => sessionList && listKeys(e, sessionList, leave)}
  >
    <SessionList
      {query}
      {activeKey}
      {activeSessionId}
      {openProjectKeys}
      {sessionMarks}
      {onOpenProject}
      {onOpenSession}
      {onNewShell}
      {onNewAgent}
    />
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="list"
    hidden={view !== 'scratch'}
    tabindex="0"
    role="group"
    aria-label="Chats and scratch sessions"
    bind:this={scratchList}
    onfocus={(e) => scratchList && enterList(e, scratchList, lastRow)}
    onfocusin={(e) => (lastRow = (e.target as HTMLElement).closest('[data-row]'))}
    onkeydown={(e) => scratchList && listKeys(e, scratchList, leave)}
  >
    <SessionList
      scratch
      {query}
      {activeKey}
      {activeSessionId}
      {openProjectKeys}
      {sessionMarks}
      {onOpenProject}
      {onOpenSession}
      {onNewShell}
      {onNewAgent}
    />
  </div>

  <footer>
    {#if view === 'open'}
      {[`${tabs.length} open`, working && `${working} working`, waiting && `${waiting} need you`].filter(Boolean).join(', ')}
    {:else if view === 'scratch'}
      {scratchSessions} sessions
    {:else}
      {appState.index.projects.filter((p) => !p.kind).length} projects, {appState.index.sessionCount - scratchSessions} sessions
    {/if}
  </footer>
</div>

<style>
  .panel {
    display: flex;
    height: 100%;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: var(--glass-bg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 8px 8px 10px;
    color: var(--fg-faint);
    font-size: 12px;
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 2px;
  }
  .views {
    display: flex;
    gap: 10px;
  }
  .views button {
    position: relative;
    padding: 0 0 4px;
    white-space: nowrap;
    border: none;
    background: transparent;
    color: var(--fg-faint);
    font: inherit;
    cursor: pointer;
  }
  .views button:hover {
    color: var(--fg);
  }
  .views button[aria-selected='true'] {
    color: var(--fg-bright);
  }
  .views button::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
    content: '';
    transform: scaleX(0);
    transition: transform var(--enter) var(--ease-out);
  }
  .views button[aria-selected='true']::after {
    transform: scaleX(1);
  }
  .views .n {
    margin-left: 1px;
    color: var(--fg-faint);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .icon {
    display: grid;
    width: 22px;
    height: 22px;
    place-items: center;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-faint);
    cursor: pointer;
  }
  .icon:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .icon:active {
    transform: scale(0.92);
  }
  .icon.spin :global(svg) {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .search {
    padding: 0 8px 8px;
  }
  .search input {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
  }
  .search input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .open {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
  }
  .open[hidden] {
    display: none;
  }
  .open-list {
    flex: none;
  }
  .divider {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: space-between;
    height: 26px;
    padding: 0 10px;
    border-top: 1px solid var(--border);
    color: var(--fg-dim);
    font-size: 12px;
    font-weight: 600;
    cursor: row-resize;
    user-select: none;
  }
  .divider:hover,
  .divider:focus-visible {
    border-top-color: var(--accent);
    outline: none;
  }
  .divider em {
    color: var(--fg-faint);
    font-size: 11px;
    font-style: normal;
    font-weight: 400;
  }
  .list {
    flex: 1;
    overflow-y: auto;
  }
  .list :global([data-row]:focus-visible) {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  footer {
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    color: var(--fg-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
</style>
