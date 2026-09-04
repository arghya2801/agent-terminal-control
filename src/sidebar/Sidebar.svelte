<script lang="ts">
  import ProjectNode from './ProjectNode.svelte';
  import {
    anyProjectExpanded,
    appState,
    refresh,
    toggleAllProjects,
  } from '../lib/stores.svelte';
  import type { Project, SessionMeta, TabKey } from '../types';

  let {
    activeKey,
    onOpenProject,
    onOpenSession,
  }: {
    activeKey: TabKey | null;
    onOpenProject: (p: Project) => void;
    onOpenSession: (p: Project, s: SessionMeta) => void;
  } = $props();

  let refreshing = $state(false);

  const limit = $derived(appState.settings?.ui.sessionsPerProject ?? 15);
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

  <div class="list">
    {#if appState.loading}
      <div class="hint">scanning…</div>
    {:else if appState.error}
      <div class="hint err">{appState.error}</div>
    {:else if appState.index.projects.length === 0}
      <div class="hint">
        No Claude sessions found yet. Run <code>claude</code> in a project and it will appear here.
      </div>
    {:else}
      {#each appState.index.projects as project (project.key)}
        <ProjectNode {project} {limit} {activeKey} {onOpenProject} {onOpenSession} />
      {/each}
    {/if}
  </div>

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
    background: #0d1117;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 8px;
    color: #6e7681;
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
    color: #6e7681;
    font-size: 12px;
    cursor: pointer;
  }
  .icon:hover {
    background: #21262d;
    color: #539bf5;
  }
  .icon.spin {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .list {
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: #30363d transparent;
  }
  .hint {
    padding: 10px 12px;
    color: #6e7681;
    font-size: 11px;
    line-height: 1.5;
  }
  .hint.err {
    color: #f47067;
  }
  code {
    padding: 1px 4px;
    border-radius: 3px;
    background: #161b22;
    font-size: 10px;
  }
  footer {
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    color: #545d68;
    font-size: 10px;
  }
</style>
