<script lang="ts" module>
  /** A session with a live tab: what Claude is doing, or just "open" before it says. */
  export type SessionMark = 'working' | 'idle' | 'open' | 'attention';
</script>

<script lang="ts">
  import { relativeTime } from '../lib/format';
  import { subfolderLabel } from '../lib/group';
  import InlineRename from '../lib/InlineRename.svelte';
  import type { SessionMeta } from '../types';

  let {
    session,
    projectPath,
    active = false,
    mark = null,
    renaming = false,
    onRename,
    onRenameCancel,
    onOpen,
    onMenu,
  }: {
    session: SessionMeta;
    /** Null when the project has no trusted path; resume is then disabled. */
    projectPath: string | null;
    active?: boolean;
    mark?: SessionMark | null;
    renaming?: boolean;
    onRename: (name: string) => void;
    onRenameCancel: () => void;
    onOpen: (session: SessionMeta) => void;
    onMenu: (e: MouseEvent, session: SessionMeta) => void;
  } = $props();

  // Without a directory there is nothing safe to launch in: the only other candidate
  // would be a path reconstructed from the lossy directory name.
  const launchable = $derived(projectPath !== null);
  const age = $derived(relativeTime(session.mtimeMs));
  // Only ever non-empty while subfolder grouping is on: without it a session's directory
  // is its project's. Two sessions adopted from different subfolders can share a name, so
  // the row has to say which one it is.
  const subfolder = $derived(subfolderLabel(projectPath, session.cwd));
</script>

{#if renaming}
  <div class="session">
    <InlineRename value={session.label} onDone={onRename} onCancel={onRenameCancel} />
  </div>
{:else}
<button
  class="session"
  class:active
  class:disabled={!launchable}
  disabled={!launchable}
  onclick={() => onOpen(session)}
  oncontextmenu={(e) => onMenu(e, session)}
  title={launchable
    ? `Resume ${session.label}\n${session.id}`
    : 'This session did not record a working directory, so it cannot be resumed'}
>
  {#if mark}
    <span
      class="mark {mark}"
      title={{
        working: 'Claude is working',
        idle: 'Claude is waiting for you',
        attention: 'Finished in the background: needs your attention',
        open: 'Open in a tab',
      }[mark]}
    ></span>
  {/if}
  <span class="label">{session.label}</span>
  <span class="meta">
    {#if subfolder}<span class="sub" title="Started in {subfolder}">{subfolder}</span>{/if}
    {#if session.gitBranch}
      <span class="branch" class:default={session.gitBranch === 'main'}>
        {session.gitBranch}
      </span>
    {/if}
    <span class="age">{age}</span>
  </span>
</button>
{/if}

<style>
  .session {
    position: relative;
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
  .sub {
    padding: 0 4px;
    border-radius: 4px;
    background: #21262d;
    color: #6e7681;
    font-size: 11px;
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
  /* In the row's left indent, so the label does not shift when a tab opens. */
  .mark {
    position: absolute;
    top: 50%;
    left: 27px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    transform: translateY(-50%);
  }
  .mark.open {
    box-shadow: inset 0 0 0 1px #6e7681;
  }
  .mark.idle {
    background: #3fb950;
  }
  .mark.attention {
    background: #539bf5;
    box-shadow: 0 0 0 2px #539bf544;
  }
  .mark.working {
    background: #f0883e;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
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
  /* `main` is the unremarkable case: shown so a bare row is never ambiguous, but
     muted so the eye only stops on branches that are not the default. */
  .branch.default {
    color: #6e7681;
  }
  .age {
    color: #6e7681;
  }
</style>
