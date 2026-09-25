<script lang="ts">
  import { sessionKey } from '../lib/agents';
  import SessionNode from './SessionNode.svelte';
  import InlineRename from '../lib/InlineRename.svelte';
  import { isExpanded, toggleExpanded } from '../lib/stores.svelte';
  import { shortenPath } from '../lib/format';
  import { branchGroups } from '../lib/branchGroups';
  import type { Project, SessionMeta, TabKey } from '../types';
  import type { SessionMark } from './SessionNode.svelte';

  let {
    project,
    limit,
    forceOpen = false,
    groupByBranch = false,
    sessionTasks,
    sessionMarks,
    activeKey,
    activeSessionId,
    open: hasTab,
    renaming,
    onRenameProject,
    onRenameSession,
    onRenameCancel,
    onOpenProject,
    onOpenSession,
    onProjectMenu,
    onSessionMenu,
  }: {
    project: Project;
    limit: number;
    /** Expanded regardless of the user's toggle, e.g. while a search is showing results. */
    forceOpen?: boolean;
    /** Sub-headers per git branch. The "show more" limit stays per project. */
    groupByBranch?: boolean;
    sessionMarks: Map<string, SessionMark>;
    /** Linked task by session key. */
    sessionTasks: Map<string, { id: number; title: string }>;
    activeKey: TabKey | null;
    /** Session whose tab is focused, already resolved from the tab. */
    activeSessionId: string | null;
    /** A tab is open somewhere for this project. */
    open: boolean;
    renaming: string | null;
    onRenameProject: (p: Project, name: string) => void;
    onRenameSession: (s: SessionMeta, name: string) => void;
    onRenameCancel: () => void;
    onOpenProject: (p: Project) => void;
    onOpenSession: (p: Project, s: SessionMeta) => void;
    onProjectMenu: (e: MouseEvent, p: Project) => void;
    onSessionMenu: (e: MouseEvent, p: Project, s: SessionMeta) => void;
  } = $props();

  let showAll = $state(false);

  const open = $derived(forceOpen || isExpanded(project.key));
  const visible = $derived(showAll ? project.sessions : project.sessions.slice(0, limit));
  const hidden = $derived(project.sessions.length - visible.length);
  const launchable = $derived(project.path !== null && project.exists);
  const projectActive = $derived(activeKey === `project:${project.key}`);
</script>

<div class="project" data-group>
  <!-- The whole row toggles expansion, so hitting a 10px chevron is never required.
       Opening a shell is the explicit action on the right. -->
  <div
    class="row"
    class:active={projectActive}
    class:has-tab={hasTab}
    role="group"
    oncontextmenu={(e) => onProjectMenu(e, project)}
  >
    {#if renaming === `p:${project.key}`}
      <div class="disclosure">
        <span class="twisty" class:open>▸</span>
        <InlineRename
          value={project.name}
          onDone={(name) => onRenameProject(project, name)}
          onCancel={onRenameCancel}
        />
      </div>
    {:else}
      <button
        class="disclosure"
        data-row
        tabindex="-1"
        onclick={() => toggleExpanded(project.key)}
        aria-expanded={open}
        title={open ? 'Collapse' : 'Expand'}
      >
        <span class="twisty" class:open>▸</span>
        {#if project.pinned}<span class="pin">●</span>{/if}
        <span class="text" class:missing={!launchable}>{project.name}</span>
        {#if hasTab}<span class="live" title="Open in a tab"></span>{/if}
        <span class="count">{project.sessions.length}</span>
      </button>
    {/if}

    <button
      class="open"
      tabindex="-1"
      disabled={!launchable}
      onclick={() => onOpenProject(project)}
      title={project.path
        ? `Open a shell in ${shortenPath(project.path, 80)}`
        : 'These sessions never recorded a working directory'}
      aria-label="Open a shell here"
    >
      ▸_
    </button>
  </div>

  {#if open}
    <div class="sessions">
      {#snippet row(session: SessionMeta)}
        <SessionNode
          {session}
          projectPath={project.path}
          active={sessionKey(session) === activeSessionId}
          mark={sessionMarks.get(sessionKey(session)) ?? null}
          showBranch={!groupByBranch}
          task={sessionTasks.get(sessionKey(session)) ?? null}
          renaming={renaming === `s:${sessionKey(session)}`}
          onRename={(name) => onRenameSession(session, name)}
          onRenameCancel={onRenameCancel}
          onOpen={(s) => onOpenSession(project, s)}
          onMenu={(e, s) => onSessionMenu(e, project, s)}
        />
      {/snippet}
      {#if groupByBranch}
        {#each branchGroups(visible) as group (group.branch ?? '')}
          <div class="branch-head" class:none={group.branch === null}>{group.branch ?? 'no branch'}</div>
          {#each group.sessions as session (sessionKey(session))}{@render row(session)}{/each}
        {/each}
      {:else}
        {#each visible as session (sessionKey(session))}{@render row(session)}{/each}
      {/if}
      {#if hidden > 0}
        <button class="more" data-row tabindex="-1" onclick={() => (showAll = true)}>show {hidden} more</button>
      {/if}
      {#if project.sessions.length === 0}
        <div class="empty">no sessions yet</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .row {
    display: flex;
    align-items: stretch;
    gap: 2px;
    padding-right: 6px;
  }
  .row:hover {
    background: var(--bg-chrome);
  }
  .row.active {
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
  }
  .row.has-tab {
    box-shadow: inset 2px 0 0 var(--ok);
  }
  .row.has-tab .text {
    color: var(--fg-bright);
  }
  .live {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ok);
  }
  .disclosure {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 6px;
    padding: 7px 4px 7px 8px;
    border: none;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .twisty {
    flex-shrink: 0;
    width: 10px;
    color: var(--fg-dim);
    font-size: 11px;
    transition: transform 120ms ease;
  }
  .disclosure:hover .twisty {
    color: var(--accent);
  }
  .twisty.open {
    transform: rotate(90deg);
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text.missing {
    color: var(--fg-faint);
    text-decoration: line-through;
  }
  .pin {
    flex-shrink: 0;
    color: var(--accent);
    font-size: 8px;
  }
  .count {
    flex-shrink: 0;
    padding: 0 5px;
    border-radius: 8px;
    background: var(--bg-surface);
    color: var(--fg-faint);
    font-size: 9px;
    line-height: 14px;
  }
  .open {
    flex-shrink: 0;
    padding: 0 5px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-faint);
    font-family: ui-monospace, monospace;
    font-size: 10px;
    cursor: pointer;
    opacity: 0;
  }
  .row:hover .open {
    opacity: 1;
  }
  .open:hover:not(:disabled) {
    background: var(--border);
    color: var(--accent);
  }
  .open:disabled {
    cursor: default;
    opacity: 0;
  }
  .branch-head {
    overflow: hidden;
    padding: 5px 10px 2px 40px;
    color: var(--info);
    font-family: ui-monospace, monospace;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .branch-head.none {
    color: var(--fg-faint);
    font-family: inherit;
    font-style: italic;
  }
  .more,
  .empty {
    width: 100%;
    padding: 3px 10px 6px 40px;
    border: none;
    background: transparent;
    color: var(--fg-faint);
    font: inherit;
    font-size: 11px;
    text-align: left;
  }
  .more {
    cursor: pointer;
  }
  .more:hover {
    color: var(--accent);
  }
</style>
