<script lang="ts">
  import SessionNode from './SessionNode.svelte';
  import { isExpanded, toggleExpanded } from '../lib/stores.svelte';
  import { relativeTime, shortenPath } from '../lib/format';
  import type { Project, SessionMeta, TabKey } from '../types';

  let {
    project,
    limit,
    activeKey,
    onOpenProject,
    onOpenSession,
  }: {
    project: Project;
    limit: number;
    activeKey: TabKey | null;
    onOpenProject: (p: Project) => void;
    onOpenSession: (p: Project, s: SessionMeta) => void;
  } = $props();

  let showAll = $state(false);

  const open = $derived(isExpanded(project.key));
  const visible = $derived(showAll ? project.sessions : project.sessions.slice(0, limit));
  const hidden = $derived(project.sessions.length - visible.length);
  const launchable = $derived(project.path !== null && project.exists);
  const projectActive = $derived(activeKey === `project:${project.key}`);
</script>

<div class="project">
  <div class="row" class:active={projectActive}>
    <button
      class="twisty"
      onclick={() => toggleExpanded(project.key)}
      aria-label={open ? 'Collapse' : 'Expand'}
      aria-expanded={open}
    >
      {open ? '▾' : '▸'}
    </button>

    <button
      class="name"
      class:missing={!launchable}
      disabled={!launchable}
      onclick={() => onOpenProject(project)}
      title={project.path
        ? `Open a shell in ${shortenPath(project.path, 80)}`
        : 'These sessions never recorded a working directory'}
    >
      {#if project.pinned}<span class="pin">●</span>{/if}
      <span class="text">{project.name}</span>
    </button>

    <span class="count" title="{project.sessions.length} sessions">
      {#if project.lastActiveMs > 0}{relativeTime(project.lastActiveMs)}{/if}
    </span>
  </div>

  {#if open}
    <div class="sessions">
      {#each visible as session (session.id)}
        <SessionNode
          {session}
          projectPath={project.path}
          active={activeKey === `session:${session.id}`}
          onOpen={(s) => onOpenSession(project, s)}
        />
      {/each}
      {#if hidden > 0}
        <button class="more" onclick={() => (showAll = true)}>
          show {hidden} more
        </button>
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
    align-items: center;
    gap: 2px;
    padding-right: 8px;
  }
  .row:hover {
    background: #161b22;
  }
  .row.active {
    background: #1f6feb22;
  }
  .twisty {
    width: 18px;
    padding: 2px 0;
    border: none;
    background: transparent;
    color: #6e7681;
    font-size: 10px;
    cursor: pointer;
  }
  .name {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 5px;
    padding: 5px 0;
    border: none;
    background: transparent;
    color: #c9d1d9;
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .name.missing {
    color: #6e7681;
    cursor: default;
    text-decoration: line-through;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pin {
    flex-shrink: 0;
    color: #539bf5;
    font-size: 8px;
  }
  .count {
    flex-shrink: 0;
    color: #6e7681;
    font-size: 10px;
  }
  .more,
  .empty {
    width: 100%;
    padding: 3px 10px 6px 26px;
    border: none;
    background: transparent;
    color: #6e7681;
    font: inherit;
    font-size: 11px;
    text-align: left;
  }
  .more {
    cursor: pointer;
  }
  .more:hover {
    color: #539bf5;
  }
</style>
