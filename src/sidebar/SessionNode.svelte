<script lang="ts">
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import { providerName } from '../lib/agents';
  import { markTitle, relativeTime, type SessionMark } from '../lib/format';
  import StatusDot from '../lib/StatusDot.svelte';
  import { subfolderLabel } from '../lib/group';
  import InlineRename from '../lib/InlineRename.svelte';
  import Highlight from '../lib/Highlight.svelte';
  import type { SessionMeta } from '../types';

  let {
    session,
    query = '',
    projectPath,
    active = false,
    mark = null,
    showBranch = true,
    renaming = false,
    renameValue,
    archived = false,
    onRename,
    onRenameCancel,
    onOpen,
    onMenu,
    onPreview,
  }: {
    session: SessionMeta;
    query?: string;
    /** Null when the project has no trusted path; resume is then disabled. */
    projectPath: string | null;
    active?: boolean;
    mark?: SessionMark | null;
    /** Off under a branch sub-header, which already says it. */
    showBranch?: boolean;
    renaming?: boolean;
    /** What the rename box starts with, e.g. a suggested name; the label otherwise. */
    renameValue?: string;
    /** Hidden from the sidebar unless archived sessions are shown (#163). */
    archived?: boolean;
    onRename: (name: string) => void;
    onRenameCancel: () => void;
    onOpen: (session: SessionMeta) => void;
    onMenu: (e: MouseEvent, session: SessionMeta) => void;
    /** Space on the row: its last turns, without resuming it (#160). */
    onPreview: (session: SessionMeta, row: HTMLElement) => void;
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
    <ProviderIcon provider={session.provider} />
    <InlineRename value={renameValue ?? session.label} onDone={onRename} onCancel={onRenameCancel} />
  </div>
{:else}
<button
  class="session"
  data-row
  tabindex="-1"
  class:active
  class:archived
  class:disabled={!launchable}
  disabled={!launchable}
  onclick={() => onOpen(session)}
  oncontextmenu={(e) => onMenu(e, session)}
  onkeydown={(e) => { if (e.key === ' ') { e.preventDefault(); onPreview(session, e.currentTarget); } }}
  title={launchable
    ? `Resume ${session.label}\n${session.id}`
    : 'This session did not record a working directory, so it cannot be resumed'}
>
  {#if mark}<span class="mark"><StatusDot {mark} title={markTitle(mark, providerName(session.provider))} /></span>{/if}
  <ProviderIcon provider={session.provider} />
  <span class="label"><Highlight text={session.label} {query} /></span>
  <span class="meta">
    {#if subfolder}<span class="sub" title="Started in {subfolder}">{subfolder}</span>{/if}
    {#if showBranch && session.gitBranch}
      <span class="branch" class:default={session.gitBranch === 'main'}>
        <Highlight text={session.gitBranch} {query} />
      </span>
    {/if}
    <span class="age">{mark ? 'open' : age}</span>
  </span>
</button>
{/if}

<style>
  .session.archived {
    opacity: 0.55;
  }
  .session {
    position: relative;
    display: flex;
    box-sizing: border-box;
    width: 100%;
    align-items: center;
    gap: 8px;
    /* Indented well past the project row's text, or the tree reads as a flat list. */
    padding: 4px 10px 4px 40px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .sub {
    padding: 0 4px;
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--fg-faint);
    font-size: 11px;
  }
  .session:hover:not(.disabled) {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .session.active {
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    color: var(--fg-bright);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .session.disabled {
    opacity: 0.4;
    cursor: default;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* In the row's left indent, so the label does not shift when a tab opens. */
  .mark {
    position: absolute;
    top: 50%;
    left: 27px;
    display: flex;
    transform: translateY(-50%);
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
    color: var(--info);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* `main` is the unremarkable case: shown so a bare row is never ambiguous, but
     muted so the eye only stops on branches that are not the default. */
  .branch.default {
    color: var(--fg-faint);
  }
  .age {
    color: var(--fg-faint);
  }
</style>
