<script lang="ts">
  import SessionList from './SessionList.svelte';
  import OpenList from './OpenList.svelte';
  import NotesPad from './NotesPad.svelte';
  import TaskBox from './TaskBox.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import Icon from '../lib/Icon.svelte';
  import { tick } from 'svelte';
  import { pageZoom } from '../lib/desktop';
  import { activate, focusActiveTerminal, markDone, splitWith } from '../terminal/manager';
  import { isWaiting } from '../lib/triage';
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
    onOpenFolder,
    onAsk,
    onNewTab,
    onCloseTab,
    onRenameTab,
    onDispatch,
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
    /** A chat in the scratch directory that cannot change anything. */
    onNewChat: (provider: AgentProvider) => void;
    /** Asks Claude or Codex, then starts it in the project (#146). */
    onPickAgent: (p: Project) => void;
    onOpenFolder: () => void;
    /** Starts Claude or Codex in the scratch directory. */
    onAsk: (provider: AgentProvider) => void;
    onNewTab: () => void;
    onCloseTab: (key: TabKey) => void;
    onRenameTab: (key: TabKey) => void;
    /** Starts an agent on a task in the background. */
    onDispatch: (p: Project, provider: AgentProvider, task: string) => void;
  } = $props();

  let refreshing = $state(false);
  let menu = $state<{ x: number; y: number; items: MenuItem[]; dropdown?: boolean } | null>(null);

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
  /** The filter box shows on request, and stays while it holds a filter. */
  let searching = $state(false);
  /** Shows and focuses the filter, adding `text` to it: the search icon, the chord, or typing on a row. */
  export async function openSearch(text = '') {
    searching = true;
    query += text;
    await tick();
    document.getElementById('sidebar-search')?.focus();
  }
  const leave = { up: () => void openSearch(), escape: focusActiveTerminal, type: (c: string) => void openSearch(c) };

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      const list = visibleList();
      if (list) rows(list)[0]?.focus();
      e.preventDefault();
      return;
    }
    if (e.key !== 'Escape') return;
    // A second Esc on an empty box hides it and goes back to the terminal.
    if (query) query = '';
    else {
      searching = false;
      focusActiveTerminal();
    }
  }
  // Re-read on every index change so the label tracks projects appearing or vanishing.
  const anyOpen = $derived.by(() => {
    void appState.indexRevision;
    return anyProjectExpanded();
  });

  // The notes pane under the Open list: open or collapsed, and its height. Per machine,
  // like the usage range; the list takes whatever the pane leaves.
  const NOTES_OPEN_KEY = 'atc.notesOpen';
  const NOTES_HEIGHT_KEY = 'atc.notesHeight';
  let notesOpen = $state(true);
  let notesHeight = $state(200);
  let openView = $state<HTMLElement>();
  try {
    notesOpen = localStorage.getItem(NOTES_OPEN_KEY) !== '0';
    notesHeight = Number(localStorage.getItem(NOTES_HEIGHT_KEY)) || 200;
  } catch {
    // Storage unavailable: keep the defaults.
  }
  function remember(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable: the choice just is not remembered.
    }
  }
  function toggleNotes() {
    notesOpen = !notesOpen;
    remember(NOTES_OPEN_KEY, notesOpen ? '1' : '0');
  }
  /** Leaves the list at least 120px, so it never disappears behind the notes. */
  function setNotesHeight(h: number) {
    const most = (openView?.clientHeight ?? window.innerHeight) - 120;
    notesHeight = Math.max(60, Math.min(Math.round(h), most));
    remember(NOTES_HEIGHT_KEY, String(notesHeight));
  }
  function dragSash(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    const y0 = e.clientY;
    const h0 = notesHeight;
    handle.setPointerCapture(e.pointerId);
    // The pane sits at the bottom, so dragging up makes it taller.
    const move = (m: PointerEvent) => setNotesHeight(h0 - (m.clientY - y0) / pageZoom());
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
      <button
        class="icon"
        class:on={searching || query}
        onclick={() => void openSearch()}
        title="Filter, or start typing on a row"
        aria-label="Filter"
      ><Icon name="search" size={14} /></button>
      {#if view === 'open'}
        <button class="icon" onclick={onNewTab} title="New tab (Ctrl+Shift+T)" aria-label="New tab"><Icon name="plus" size={14} /></button>
      {:else if view === 'scratch'}
        <button
          class="icon"
          onclick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            menu = { x: r.right, y: r.bottom + 4, dropdown: true, items: [
              { label: 'Ask Claude', icon: 'agent', run: () => onAsk('claude') },
              { label: 'Ask Codex', icon: 'agent', run: () => onAsk('codex') },
              { label: 'Chat with Claude, no tools', icon: 'agent', sep: true, run: () => onNewChat('claude') },
              { label: 'Chat with Codex, read-only sandbox', icon: 'agent', run: () => onNewChat('codex') },
            ] };
          }}
          title="Ask an agent, or chat with one that cannot change anything"
          aria-label="New in scratch"
        ><Icon name="plus" size={14} /></button>
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

  {#if searching || query}
    <div class="search">
      <input
        id="sidebar-search"
        type="search"
        placeholder={view === 'open' ? 'Filter open tabs' : view === 'scratch' ? 'Filter chats' : 'Filter projects and sessions'}
        title="Filter by project, path, session name or branch"
        aria-label={view === 'open' ? 'Filter open tabs' : view === 'scratch' ? 'Filter chats' : 'Filter projects and sessions'}
        spellcheck="false"
        autocomplete="off"
        bind:value={query}
        onkeydown={onSearchKey}
        onblur={() => { if (!query) searching = false; }}
      />
    </div>
  {/if}

  <!-- Both views stay mounted and the hidden one is display:none, so switching does not
       rebuild every project and session row (#117). -->
  <!-- One tab stop per list; Up/Down move between rows (#103). The list only takes focus
       to hand it to a row, the roving-tabindex pattern, hence the ignores. -->
  <div class="open" hidden={view !== 'open'} bind:this={openView}>
    <TaskBox {activeKey} {onDispatch} />
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="list open-list"
      tabindex="0"
      role="group"
      aria-label="Open tabs"
      bind:this={openList}
      onfocus={(e) => openList && enterList(e, openList, lastRow)}
      onfocusin={(e) => (lastRow = (e.target as HTMLElement).closest('[data-row]'))}
      onkeydown={(e) => openList && listKeys(e, openList, leave)}
      oncontextmenu={(e) => {
        e.preventDefault();
        // A tab row gets that tab's actions; the empty space below starts something new.
        const key = (e.target as HTMLElement).closest<HTMLElement>('[data-tab-key]')?.dataset.tabKey as TabKey | undefined;
        if (key) {
          menu = { x: e.clientX, y: e.clientY, items: [
            { label: 'Go to tab', icon: 'terminal', disabled: key === activeKey, run: () => activate(key) },
            { label: 'Mark done', icon: 'check', disabled: !tabs.some((t) => t.key === key && isWaiting(tabMark(t)) && !t.done), run: () => markDone(key) },
            { label: 'Rename…', icon: 'pencil', run: () => onRenameTab(key) },
            { label: 'Split beside the current tab', icon: 'split', disabled: key === activeKey, run: () => splitWith(key) },
            { label: 'Close tab', icon: 'close', sep: true, run: () => onCloseTab(key) },
          ] };
          return;
        }
        const items = appState.index.projects.filter((p) => p.path && p.exists).map((p) => ({ label: p.name, icon: 'folder' as const, run: () => onPickAgent(p) }));
        menu = { x: e.clientX, y: e.clientY, items: [{ label: 'New agent in…' }, ...items] };
      }}
    >
      <OpenList {tabs} {activeKey} {query} onClose={onCloseTab} />
    </div>
    <!-- Collapses to its header, like the Outline pane under VS Code's explorer. -->
    <section class="notes-pane" style={notesOpen ? `height: ${notesHeight}px` : undefined}>
      {#if notesOpen}
        <!-- svelte-ignore a11y_no_static_element_interactions (the header's arrow keys resize too) -->
        <div
          class="sash"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the notes"
          aria-valuenow={notesHeight}
          title="Drag to resize"
          onpointerdown={dragSash}
        ></div>
      {/if}
      <button
        class="notes-head"
        aria-expanded={notesOpen}
        onclick={toggleNotes}
        onkeydown={(e) => {
          if (notesOpen && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            setNotesHeight(notesHeight + (e.key === 'ArrowUp' ? 20 : -20));
          }
        }}
        title={notesOpen ? 'Collapse the notes (arrow keys resize)' : 'Show the notes'}
      >
        <span class="twisty" class:expanded={notesOpen}><Icon name="chevron" size={12} /></span>
        Notes <em>notes.md</em>
      </button>
      <div class="notes-body" hidden={!notesOpen}><NotesPad /></div>
    </section>
  </div>
  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} dropdown={menu.dropdown} onClose={() => (menu = null)} />
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
      {onOpenFolder}
      {onAsk}
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
  .icon.on {
    color: var(--accent);
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
    min-width: 0;
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
  .notes-pane {
    position: relative;
    display: flex;
    flex: none;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid var(--border);
  }
  /* Straddles the pane's top border; the line lights up while it is the drag target. */
  .sash {
    position: absolute;
    top: -3px;
    right: 0;
    left: 0;
    z-index: 2;
    height: 6px;
    cursor: row-resize;
  }
  .sash:hover,
  .sash:active {
    box-shadow: inset 0 3px 0 -1px var(--accent);
  }
  .notes-head {
    display: flex;
    flex: none;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 10px 0 6px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .notes-head:hover {
    color: var(--fg-bright);
  }
  .notes-head:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .notes-head em {
    margin-left: auto;
    color: var(--fg-faint);
    font-size: 11px;
    font-style: normal;
    font-weight: 400;
  }
  .twisty {
    display: flex;
    flex-shrink: 0;
    color: var(--fg-faint);
    transition: transform var(--fast) var(--ease-out);
  }
  .twisty.expanded {
    transform: rotate(90deg);
  }
  .notes-body {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
  }
  .notes-body[hidden] {
    display: none;
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
