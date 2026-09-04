<script lang="ts">
  import { relativeTime } from '../lib/format';
  import type { SessionMeta } from '../types';

  let {
    session,
    projectPath,
    active = false,
    onOpen,
  }: {
    session: SessionMeta;
    /** Null when the project has no trusted path; resume is then disabled. */
    projectPath: string | null;
    active?: boolean;
    onOpen: (session: SessionMeta) => void;
  } = $props();

  // Without a directory there is nothing safe to launch in: the only other candidate
  // would be a path reconstructed from the lossy directory name.
  const launchable = $derived(projectPath !== null);
  const age = $derived(relativeTime(session.mtimeMs));
</script>

<button
  class="session"
  class:active
  class:disabled={!launchable}
  disabled={!launchable}
  onclick={() => onOpen(session)}
  title={launchable
    ? `Resume ${session.label}\n${session.id}`
    : 'This session did not record a working directory, so it cannot be resumed'}
>
  <span class="label">{session.label}</span>
  <span class="meta">
    {#if session.gitBranch && session.gitBranch !== 'main'}
      <span class="branch">{session.gitBranch}</span>
    {/if}
    <span class="age">{age}</span>
  </span>
</button>

<style>
  .session {
    display: flex;
    width: 100%;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    /* Indented well past the project row's text, or the tree reads as a flat list. */
    padding: 4px 10px 4px 40px;
    border: none;
    background: transparent;
    color: #8b949e;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .session:hover:not(.disabled) {
    background: #1c2027;
    color: #c9d1d9;
  }
  .session.active {
    background: #1f6feb22;
    color: #cdd9e5;
    box-shadow: inset 2px 0 0 #539bf5;
  }
  .session.disabled {
    opacity: 0.4;
    cursor: default;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    display: flex;
    flex-shrink: 0;
    gap: 6px;
    font-size: 10px;
    opacity: 0.75;
  }
  .branch {
    max-width: 70px;
    overflow: hidden;
    color: #b083f0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .age {
    color: #6e7681;
  }
</style>
