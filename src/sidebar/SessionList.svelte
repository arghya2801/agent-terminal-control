<script lang="ts">
  import { sessionKey } from '../lib/agents';
  import { agentCommand, openInExplorer } from '../lib/ipc';
  import ProjectNode from './ProjectNode.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import { filterProjects } from '../lib/filter';
  import { groupSubfolders } from '../lib/group';
  import { isPinned, togglePinned } from '../lib/pinned';
  import { appState, refresh, saveSettings } from '../lib/stores.svelte';
  import type { AgentProvider, Project, SessionMeta, TabKey } from '../types';
  import type { SessionMark } from './SessionNode.svelte';

  /** The sidebar's Sessions view: projects, their sessions, and both context menus. */
  let {
    query,
    scratch = false,
    activeKey,
    activeSessionId,
    openProjectKeys,
    sessionMarks,
    onOpenProject,
    onOpenSession,
    onNewShell,
    onNewAgent,
  }: {
    query: string;
    /** The Scratch view: only the scratch and chats directories, as fixed sections (#135). */
    scratch?: boolean;
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

  const searching = $derived(query.trim() !== '');
  // Grouped before filtering, so a query matching a parent's name keeps the sessions it
  // has adopted.
  const mine = $derived(appState.index.projects.filter((p) => !!p.kind === scratch));
  const grouped = $derived(
    !scratch && appState.settings?.ui.groupSubfolders ? groupSubfolders(mine) : mine,
  );
  const shown = $derived(filterProjects(grouped, query));
  const SECTIONS = [
    { kind: 'chats', empty: 'No chats yet. Press + to start one.' },
    { kind: 'scratch', empty: 'Nothing here yet. Ctrl+Shift+A asks an agent in the scratch directory.' },
  ] as const;
  // While searching every match is shown: a hit hidden behind "show more" is no hit.
  const limit = $derived(searching ? Infinity : (appState.settings?.ui.sessionsPerProject ?? 15));
</script>

{#snippet node(project: Project, forceOpen: boolean)}
  <ProjectNode
    {project}
    {limit}
    {forceOpen}
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
{/snippet}

{#if appState.loading}
  <div class="hint">scanning…</div>
{:else if appState.error}
  <div class="hint err">{appState.error}</div>
{:else if scratch}
  {#each SECTIONS as section (section.kind)}
    {@const project = shown.find((p) => p.kind === section.kind)}
    {#if project}
      {@render node(project, true)}
    {:else}
      <div class="hint section">
        <strong>{section.kind === 'chats' ? 'Chats' : 'Scratch'}</strong>
        {searching && mine.some((p) => p.kind === section.kind) ? `Nothing matches “${query.trim()}”.` : section.empty}
      </div>
    {/if}
  {/each}
{:else if mine.length === 0}
  <div class="hint">
    No agent sessions found yet. Run <code>claude</code> or <code>codex</code> in a project and it will appear here.
  </div>
{:else if shown.length === 0}
  <div class="hint">Nothing matches “{query.trim()}”.</div>
{:else}
  {#each shown as project (project.key)}{@render node(project, searching)}{/each}
{/if}

{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

<style>
  .hint {
    padding: 10px 12px;
    color: var(--fg-faint);
    font-size: 11px;
    line-height: 1.5;
  }
  /* Lines up with a project row's name. */
  .hint.section {
    padding-left: 34px;
  }
  .hint strong {
    display: block;
    color: var(--fg);
    font-size: 12px;
    font-weight: 500;
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
</style>
