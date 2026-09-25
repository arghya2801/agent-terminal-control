<script lang="ts">
  import SessionList from './SessionList.svelte';
  import TaskList from './TaskList.svelte';
  import { focusActiveTerminal } from '../terminal/manager';
  import {
    anyProjectExpanded,
    appState,
    createTask,
    refresh,
    setSidebarView,
    sidebarView,
    tasks,
    toggleAllProjects,
  } from '../lib/stores.svelte';
  import type { AgentProvider, Project, SessionMeta, TabKey } from '../types';
  import type { SessionMark } from './SessionNode.svelte';

  let {
    activeKey,
    activeSessionId,
    currentRepo,
    openProjectKeys,
    sessionMarks,
    onOpenProject,
    onOpenSession,
    onNewShell,
    onNewAgent,
  }: {
    activeKey: TabKey | null;
    activeSessionId: string | null;
    /** Project root of the active tab, the default repo for a new task. */
    currentRepo: string | null;
    openProjectKeys: Set<string>;
    /** Sessions with a live tab, by id. */
    sessionMarks: Map<string, SessionMark>;
    onOpenProject: (p: Project) => void;
    onOpenSession: (p: Project, s: SessionMeta) => void;
    onNewShell: (p: Project) => void;
    onNewAgent: (p: Project, provider: AgentProvider) => void;
  } = $props();

  let refreshing = $state(false);

  const view = $derived(sidebarView());
  const openTasks = $derived(tasks().filter((t) => t.state !== 'done').length);

  let query = $state('');
  function onSearchKey(e: KeyboardEvent) {
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
        Sessions <span class="n">{appState.index.sessionCount}</span>
      </button>
      <button
        role="tab"
        aria-selected={view === 'tasks'}
        onclick={() => void setSidebarView('tasks')}
        title="Tasks (Ctrl+Shift+K)"
      >
        Tasks <span class="n">{openTasks}</span>
      </button>
    </div>
    <div class="actions">
      {#if view === 'tasks'}
        <button class="icon" onclick={() => createTask({ repo: currentRepo })} title="New task" aria-label="New task">+</button>
      {:else}
      <button
        class="icon"
        onclick={toggleAllProjects}
        title={anyOpen ? 'Collapse all' : 'Expand all'}
        aria-label={anyOpen ? 'Collapse all' : 'Expand all'}
      >
        {anyOpen ? '⌄' : '›'}
      </button>
      <button
        class="icon"
        class:spin={refreshing}
        onclick={doRefresh}
        title="Rescan sessions"
        aria-label="Rescan sessions"
      >
        ⟳
      </button>
      {/if}
    </div>
  </header>

  <div class="search">
    <input
      id="sidebar-search"
      type="search"
      placeholder={view === 'tasks' ? 'Filter tasks' : 'Filter projects and sessions'}
      title="Filter by project, path, session name or branch (Ctrl+Shift+P)"
      aria-label={view === 'tasks' ? 'Filter tasks' : 'Filter projects and sessions'}
      spellcheck="false"
      autocomplete="off"
      bind:value={query}
      onkeydown={onSearchKey}
    />
  </div>

  <!-- Both views stay mounted and the hidden one is display:none, so switching does not
       rebuild every project and session row (#117). -->
  <div class="list" hidden={view !== 'tasks'}>
    <TaskList {query} {sessionMarks} {onOpenSession} />
  </div>
  <div class="list" hidden={view === 'tasks'}>
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

  <footer>
    {#if view === 'tasks'}
      {tasks().length} tasks · {openTasks} open
    {:else}
      {appState.index.projects.length} projects · {appState.index.sessionCount} sessions
    {/if}
  </footer>
</div>

<style>
  .panel {
    display: flex;
    height: 100%;
    flex-direction: column;
    border-right: 1px solid var(--border);
    background: var(--bg);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 8px;
    color: var(--fg-faint);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
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
    padding: 0 0 3px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--fg-faint);
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  .views button:hover {
    color: var(--fg);
  }
  .views button[aria-selected='true'] {
    border-bottom-color: var(--accent);
    color: var(--fg-bright);
  }
  .views .n {
    color: var(--fg-faint);
    font-variant-numeric: tabular-nums;
  }
  .icon {
    width: 20px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-faint);
    font-size: 12px;
    cursor: pointer;
  }
  .icon:hover {
    background: var(--bg-surface);
    color: var(--accent);
  }
  .icon.spin {
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
  .list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  footer {
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    color: var(--fg-faint);
    font-size: 10px;
  }
</style>
