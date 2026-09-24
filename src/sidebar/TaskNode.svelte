<script lang="ts">
  import InlineRename from '../lib/InlineRename.svelte';
  import type { Task } from '../types';

  let {
    task,
    live,
    selected = false,
    renaming = false,
    showRepo = false,
    onSelect,
    onMenu,
    onRename,
    onRenameCancel,
  }: {
    task: Task;
    /** Linked sessions that have a tab open. */
    live: number;
    selected?: boolean;
    renaming?: boolean;
    /** Name the repo, for when tasks from several repos share the list. */
    showRepo?: boolean;
    onSelect: (task: Task) => void;
    onMenu: (e: MouseEvent, task: Task) => void;
    onRename: (name: string) => void;
    onRenameCancel: () => void;
  } = $props();

  const repoName = $derived(task.repo?.split(/[\\/]/).filter(Boolean).pop() ?? null);
</script>

{#if renaming}
  <div class="task {task.state}">
    <InlineRename value={task.title} onDone={onRename} onCancel={onRenameCancel} />
  </div>
{:else}
  <button
    class="task {task.state}"
    class:selected
    onclick={() => onSelect(task)}
    oncontextmenu={(e) => onMenu(e, task)}
    title={task.title}
  >
    <span class="title">{task.title}</span>
    {#if (showRepo && repoName) || task.branches.length || task.sessions.length}
    <span class="meta">
      {#if showRepo && repoName}<span class="repo">{repoName}</span>{/if}
      {#if task.branches.length}
        <span class="branch">{task.branches[0]}</span>
        {#if task.branches.length > 1}<span>+{task.branches.length - 1}</span>{/if}
      {/if}
      {#if live}
        <span class="live">{live} open</span>
      {:else if task.sessions.length}
        <span>{task.sessions.length} session{task.sessions.length === 1 ? '' : 's'}</span>
      {/if}
    </span>
    {/if}
  </button>
{/if}

<style>
  .task {
    display: block;
    box-sizing: border-box;
    width: 100%;
    padding: 5px 10px 6px 12px;
    border: none;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .task:hover {
    background: var(--bg-hover);
  }
  .task.doing {
    border-left-color: var(--warn);
  }
  .task.done {
    border-left-color: var(--ok);
  }
  .task.selected {
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    border-left-color: var(--accent);
  }
  .title {
    display: block;
    overflow: hidden;
    color: var(--fg-bright);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .done .title {
    color: var(--fg-dim);
    text-decoration: line-through;
  }
  .meta {
    display: flex;
    gap: 6px;
    overflow: hidden;
    color: var(--fg-faint);
    font-size: 10px;
    white-space: nowrap;
  }
  .branch {
    overflow: hidden;
    color: var(--info);
    font-family: ui-monospace, monospace;
    text-overflow: ellipsis;
  }
  .repo {
    flex-shrink: 0;
  }
  .live {
    color: var(--ok);
  }
</style>
