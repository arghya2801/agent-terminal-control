<script lang="ts">
  import { onMount } from 'svelte';
  import SessionList from './SessionList.svelte';
  import LiveRow from './LiveRow.svelte';
  import NotesPad from './NotesPad.svelte';
  import Icon from '../lib/Icon.svelte';
  import { focusActiveTerminal } from '../terminal/manager';
  import { enterList, listKeys, rows } from '../lib/roving';
  import { usageCosts } from '../lib/ipc';
  import { anyProjectExpanded, appState, refresh, toggleAllProjects } from '../lib/stores.svelte';
  import type { AgentProvider, Project, SessionMeta, TabKey, TabSummary } from '../types';
  import { tabMark, type SessionMark } from '../lib/format';

  /** One list: live tabs at the top of their project, then history, then chats and scratch. */
  let {
    activeKey,
    activeSessionId,
    tabs,
    openProjectKeys,
    sessionMarks,
    sessionSince,
    unbound,
    parked,
    onPark,
    onOpenProject,
    onOpenSession,
    onNewShell,
    onNewAgent,
    onOpenFolder,
    onAsk,
    onNewTab,
  }: {
    activeKey: TabKey | null;
    activeSessionId: string | null;
    tabs: TabSummary[];
    openProjectKeys: Set<string>;
    /** Sessions with a live tab, by id. */
    sessionMarks: Map<string, SessionMark>;
    sessionSince: Map<string, number>;
    /** Live tabs with no session row yet. */
    unbound: TabSummary[];
    /** Sessions whose tab was parked; clicking resumes them. */
    parked: Set<string>;
    onPark: (sessionId: string) => void;
    onOpenProject: (p: Project) => void;
    onOpenSession: (p: Project, s: SessionMeta) => void;
    onNewShell: (p: Project) => void;
    onNewAgent: (p: Project, provider: AgentProvider) => void;
    onNewChat: () => void;
    onPickAgent: (p: Project) => void;
    onOpenFolder: () => void;
    /** Starts Claude or Codex in the scratch directory. */
    onAsk: (provider: AgentProvider) => void;
    onNewTab: () => void;
    onCloseTab: (key: TabKey) => void;
  } = $props();

  let refreshing = $state(false);
  const working = $derived(tabs.filter((t) => tabMark(t) === 'working').length);
  const waiting = $derived(tabs.filter((t) => tabMark(t) === 'attention').length);
  const projectKeys = $derived(new Set(appState.index.projects.map((p) => p.key)));
  /** Shells outside every listed project have no project to sit under. */
  const loose = $derived(unbound.filter((t) => !t.projectKey || !projectKeys.has(t.projectKey)));

  /** Spend per session, `provider:id`. Reloaded at most once a minute as transcripts grow. */
  let costs = $state(new Map<string, number>());
  let costsAt = 0;
  async function loadCosts() {
    costsAt = Date.now();
    const next = new Map<string, number>();
    for (const r of await usageCosts().catch(() => [])) {
      const k = `${r.provider}:${r.sessionId}`;
      next.set(k, (next.get(k) ?? 0) + (r.costUsd ?? 0));
    }
    costs = next;
  }
  onMount(() => void loadCosts());
  $effect(() => {
    void appState.indexRevision;
    if (Date.now() - costsAt > 60_000) void loadCosts();
  });

  let query = $state('');
  let list = $state<HTMLElement>();
  let lastRow: HTMLElement | null = null;
  const search = () => document.getElementById('sidebar-search')?.focus();
  const leave = { up: search, escape: focusActiveTerminal };

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      if (list) rows(list)[0]?.focus();
      e.preventDefault();
      return;
    }
    if (e.key !== 'Escape') return;
    if (query) query = '';
    else focusActiveTerminal();
  }
  const anyOpen = $derived.by(() => {
    void appState.indexRevision;
    return anyProjectExpanded();
  });

  // The list's height; the notes pad takes the rest. Per machine.
  const LIST_HEIGHT_KEY = 'atc.oneListHeight';
  let listHeight = $state(420);
  try {
    listHeight = Number(localStorage.getItem(LIST_HEIGHT_KEY)) || 420;
  } catch {
    // Storage unavailable: keep the default.
  }
  function setListHeight(h: number) {
    listHeight = Math.max(80, Math.min(Math.round(h), window.innerHeight - 140));
    try {
      localStorage.setItem(LIST_HEIGHT_KEY, String(listHeight));
    } catch {
      // Storage unavailable: the height just is not remembered.
    }
  }
  function dragDivider(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    const y0 = e.clientY;
    const h0 = listHeight;
    handle.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => setListHeight(h0 + m.clientY - y0);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
  }

  async function doRefresh() {
    refreshing = true;
    await refresh(true);
    refreshing = false;
  }

  const common = $derived({ query, activeKey, activeSessionId, openProjectKeys, sessionMarks, sessionSince, unbound, parked, costs, onPark, onOpenProject, onOpenSession, onNewShell, onNewAgent });
</script>

<div class="panel">
  <header>
    <span class="title">Agents <span class="n">{tabs.length} open</span></span>
    <div class="actions">
      <button class="icon" onclick={onNewTab} title="New tab (Ctrl+Shift+T)" aria-label="New tab"><Icon name="plus" size={14} /></button>
      <button
        class="icon"
        onclick={toggleAllProjects}
        title={anyOpen ? 'Collapse all' : 'Expand all'}
        aria-label={anyOpen ? 'Collapse all' : 'Expand all'}
      >
        <Icon name={anyOpen ? 'collapse' : 'expand'} size={14} />
      </button>
      <button class="icon" class:spin={refreshing} onclick={doRefresh} title="Rescan sessions" aria-label="Rescan sessions"><Icon name="refresh" size={14} /></button>
    </div>
  </header>

  <div class="search">
    <input
      id="sidebar-search"
      type="search"
      placeholder="Filter projects and sessions"
      title="Filter by project, path, session name or branch"
      aria-label="Filter projects and sessions"
      spellcheck="false"
      autocomplete="off"
      bind:value={query}
      onkeydown={onSearchKey}
    />
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="list"
    style="height: {listHeight}px"
    tabindex="0"
    role="group"
    aria-label="Agents, projects and sessions"
    bind:this={list}
    onfocus={(e) => list && enterList(e, list, lastRow)}
    onfocusin={(e) => (lastRow = (e.target as HTMLElement).closest('[data-row]'))}
    onkeydown={(e) => list && listKeys(e, list, leave)}
  >
    {#if loose.length > 0 && !query}
      <div class="section">Shells</div>
      {#each loose as tab (tab.key)}<LiveRow {tab} active={tab.key === activeKey} indent={26} />{/each}
    {/if}
    <SessionList {...common} {onOpenFolder} {onAsk} />
    <SessionList scratch {...common} />
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class="divider"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize the notes"
    aria-valuenow={listHeight}
    tabindex="0"
    title="Drag to resize"
    onpointerdown={dragDivider}
    onkeydown={(e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setListHeight(listHeight + (e.key === 'ArrowUp' ? -20 : 20));
      }
    }}
  >
    Notes <em>notes.md</em>
  </div>
  <NotesPad />

  <footer>{[`${working} working`, `${waiting} need you`, `${parked.size} parked`].join(', ')}</footer>
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
  }
  .title {
    color: var(--fg-bright);
    font-size: 12px;
    font-weight: 600;
  }
  .n {
    margin-left: 4px;
    color: var(--fg-faint);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    gap: 2px;
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
  .section {
    padding: 10px 10px 4px;
    color: var(--fg-faint);
    font-size: 11px;
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
    flex: none;
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
