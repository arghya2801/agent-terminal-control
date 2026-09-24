<script lang="ts">
  import { sessionKey } from '../lib/agents';
  import { agentCommand } from '../lib/ipc';
  import ProjectNode from './ProjectNode.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import { openInExplorer } from '../lib/ipc';
  import { filterProjects } from '../lib/filter';
  import { groupSubfolders } from '../lib/group';
  import { focusActiveTerminal } from '../terminal/manager';
  import { isPinned, togglePinned } from '../lib/pinned';
  import {
    anyProjectExpanded,
    appState,
    refresh,
    saveSettings,
    toggleAllProjects,
  } from '../lib/stores.svelte';
  import type { AgentProvider, Project, SessionMeta, TabKey } from '../types';
  import type { SessionMark } from './SessionNode.svelte';

  let {
    activeKey,
    activeSessionId,
    openProjectKeys,
    sessionMarks,
    onOpenProject,
    onOpenSession,
    onNewShell,
    onNewAgent,
  }: {
    activeKey: TabKey | null;
    activeSessionId: string | null;
    openProjectKeys: Set<string>;
    /** Sessions with a live tab, by id. */
    sessionMarks: Map<string, SessionMark>;
    onOpenProject: (p: Project) => void;
    onOpenSession: (p: Project, s: SessionMeta) => void;
    onNewShell: (p: Project) => void;
    onNewAgent: (p: Project, provider: AgentProvider) => void;
  } = $props();

  /** `p:<project key>` or `s:<session id>` while its name is being edited. */
  let renaming = $state<string | null>(null);

  /** Store `name` under `id` in one of the rename maps; empty removes the entry. */
  async function saveName(field: 'names' | 'sessionNames', id: string, name: string) {
    renaming = null;
    if (!appState.settings) return;
    const map = { ...appState.settings.projects[field] };
    if (name) map[id] = name;
    else delete map[id];
    await saveSettings({
      ...appState.settings,
      projects: { ...appState.settings.projects, [field]: map },
    });
    await refresh();
  }

  let refreshing = $state(false);
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      appState.error = `could not copy: ${e}`;
    }
  }

  async function setPinned(path: string, name: string) {
    if (!appState.settings) return;
    const pinned = togglePinned(appState.settings.projects.pinned, path, name);
    await saveSettings({
      ...appState.settings,
      projects: { ...appState.settings.projects, pinned },
    });
  }

  function projectMenu(e: MouseEvent, p: Project) {
    e.preventDefault();
    const path = p.path;
    const pinnedNow = !!path && isPinned(appState.settings?.projects.pinned ?? [], path);
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Open in Claude', disabled: !path || !p.exists, run: () => onNewAgent(p, 'claude') },
        { label: 'Open in Codex', disabled: !path || !p.exists, run: () => onNewAgent(p, 'codex') },
        { label: 'Open terminal here', disabled: !path || !p.exists, run: () => onNewShell(p) },
        { label: 'Rename…', disabled: !path, run: () => (renaming = `p:${p.key}`) },
        {
          label: 'Open in Explorer',
          disabled: !path || !p.exists,
          run: () => path && void openInExplorer(path),
        },
        { label: 'Copy path', disabled: !path, run: () => path && void copy(path) },
        {
          label: pinnedNow ? 'Unpin project' : 'Pin project',
          disabled: !path,
          run: () => path && void setPinned(path, p.name),
        },
      ],
    };
  }

  function sessionMenu(e: MouseEvent, p: Project, s: SessionMeta) {
    e.preventDefault();
    const dir = s.cwd ?? p.path;
    menu = {
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Rename…', run: () => (renaming = `s:${sessionKey(s)}`) },
        { label: 'Copy session id', run: () => void copy(s.id) },
        {
          label: 'Copy resume command',
          run: () => void agentCommand(s.provider, s.id).then(copy).catch(e => appState.error = String(e)),
        },
        {
          label: 'Open in Explorer',
          disabled: !dir,
          run: () => dir && void openInExplorer(dir),
        },
      ],
    };
  }

  let query = $state('');
  const searching = $derived(query.trim() !== '');
  // Grouped before filtering, so a query matching a parent's name keeps the sessions it
  // has adopted.
  const grouped = $derived(
    appState.settings?.ui.groupSubfolders
      ? groupSubfolders(appState.index.projects)
      : appState.index.projects,
  );
  const shown = $derived(filterProjects(grouped, query));
  // While searching every match is shown: a hit hidden behind "show more" is no hit.
  const limit = $derived(searching ? Infinity : (appState.settings?.ui.sessionsPerProject ?? 15));

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
    <span class="title">Projects</span>
    <div class="actions">
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
    </div>
  </header>

  <div class="search">
    <input
      id="sidebar-search"
      type="search"
      placeholder="Filter projects and sessions"
      title="Filter by project, path, session name or branch (Ctrl+Shift+P)"
      aria-label="Filter projects and sessions"
      spellcheck="false"
      autocomplete="off"
      bind:value={query}
      onkeydown={onSearchKey}
    />
  </div>

  <div class="list">
    {#if appState.loading}
      <div class="hint">scanning…</div>
    {:else if appState.error}
      <div class="hint err">{appState.error}</div>
    {:else if appState.index.projects.length === 0}
      <div class="hint">
        No agent sessions found yet. Run <code>claude</code> or <code>codex</code> in a project and it will appear here.
      </div>
    {:else if shown.length === 0}
      <div class="hint">Nothing matches “{query.trim()}”.</div>
    {:else}
      {#each shown as project (project.key)}
        <ProjectNode
          {project}
          {limit}
          forceOpen={searching}
          groupByBranch={appState.settings?.ui.groupByBranch ?? false}
          {sessionMarks}
          {activeKey}
          {activeSessionId}
          open={openProjectKeys.has(project.key)}
          {renaming}
          onRenameProject={(p, name) => p.path && void saveName('names', p.path, name)}
          onRenameSession={(s, name) => void saveName('sessionNames', sessionKey(s), name)}
          onRenameCancel={() => (renaming = null)}
          {onOpenProject}
          {onOpenSession}
          onProjectMenu={projectMenu}
          onSessionMenu={sessionMenu}
        />
      {/each}
    {/if}
  </div>

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
  {/if}

  <footer>
    {appState.index.projects.length} projects · {appState.index.sessionCount} sessions
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
  .hint {
    padding: 10px 12px;
    color: var(--fg-faint);
    font-size: 11px;
    line-height: 1.5;
  }
  .hint.err {
    color: var(--danger);
  }
  code {
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-chrome);
    font-size: 10px;
  }
  footer {
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    color: var(--fg-faint);
    font-size: 10px;
  }
</style>
