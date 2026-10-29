<script lang="ts">
  import { onMount } from 'svelte';
  import { formatTokens, monetary, modelLabel, sessionStats } from '../lib/costs';
  import { changesText, sparkPath } from '../lib/format';
  import type { GitChanges } from '../lib/ipc';
  import { loadCosts, planState } from '../lib/limits.svelte';
  import { outputHistory } from '../terminal/manager';
  import type { TabKey } from '../types';

  /** The pane header's right side: the session's model, cost and cache use, and the tab's output graph. */
  let { tabKey, sessionKey, working, changes }: {
    tabKey: TabKey;
    sessionKey: string | null;
    working: boolean;
    /** The working tree's changes since HEAD, read when the agent last stopped; null outside git. */
    changes?: GitChanges | null;
  } = $props();

  const stats = $derived(sessionKey ? sessionStats(planState.costRows, sessionKey) : null);
  const context = $derived(sessionKey ? planState.context[sessionKey] : undefined);

  let now = $state(Date.now());
  onMount(() => {
    const clock = setInterval(() => (now = Date.now()), 5_000);
    return () => clearInterval(clock);
  });
  // ponytail: every poll ships all cost rows over IPC; ask Go for one session's totals if that gets slow.
  $effect(() => {
    if (!sessionKey) return;
    void loadCosts();
    const poll = setInterval(loadCosts, 60_000);
    return () => clearInterval(poll);
  });
</script>

<div class="stats">
  {#if stats}
    <span title="Model used most recently">{modelLabel(stats.model)}</span>
    <span title="This session's cost at API prices: {formatTokens(stats.tokens)} tokens, {Math.round(stats.cacheShare * 100)}% of input from the prompt cache">{monetary(stats)}</span>
  {/if}
  {#if changes && (changes.files || changes.untracked)}
    <span title="{changesText(changes)}, since the agent last stopped">{changes.files + changes.untracked} <small>{changes.files + changes.untracked === 1 ? 'file' : 'files'}</small> <ins>+{changes.insertions}</ins> <del>−{changes.deletions}</del></span>
  {/if}
  {#if context}
    {@const fill = context.used / context.window}
    <span class:full={fill >= 0.8} title="{formatTokens(context.used)} of {formatTokens(context.window)} tokens on the latest request">{Math.round(fill * 100)}% <small>context</small></span>
  {/if}
  <svg class:working viewBox="0 0 60 10" preserveAspectRatio="none" aria-label="Output, last 5 minutes"><path d={sparkPath((void now, outputHistory(tabKey)))} /></svg>
</div>

<style>
  .stats {
    display: flex;
    flex: none;
    align-items: center;
    gap: 14px;
    padding: 0 10px;
    color: var(--fg-dim);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .full {
    color: var(--warn);
  }
  ins,
  del {
    text-decoration: none;
  }
  ins {
    color: var(--ok);
  }
  del {
    color: var(--danger);
  }
  small {
    color: var(--fg-faint);
    font-size: inherit;
  }
  svg {
    width: 60px;
    height: 10px;
    stroke: var(--fg-faint);
    stroke-width: 1.5;
  }
  svg.working {
    stroke: var(--warn);
  }
  @media (max-width: 900px) {
    .stats {
      display: none;
    }
  }
</style>
