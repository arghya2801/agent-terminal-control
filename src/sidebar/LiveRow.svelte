<script lang="ts">
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import StatusDot from '../lib/StatusDot.svelte';
  import { providerName } from '../lib/agents';
  import { markTitle, relativeTime, tabMark } from '../lib/format';
  import { stateWord } from '../lib/triage';
  import { activate } from '../terminal/manager';
  import type { TabSummary } from '../types';

  /** A live tab with no session row: a shell, or an agent the index has not caught yet. */
  let { tab, active, indent = 40 }: { tab: TabSummary; active: boolean; indent?: number } = $props();

  const mark = $derived(tabMark(tab));
</script>

<button
  class="live"
  class:active
  data-row
  tabindex="-1"
  style="padding-left: {indent}px"
  onclick={() => activate(tab.key)}
  title={markTitle(mark, providerName(tab.provider ?? 'claude'))}
>
  <span class="mark" style="left: {indent - 13}px"><StatusDot {mark} title="" /></span>
  {#if tab.provider}<ProviderIcon provider={tab.provider} />{:else}<span class="shell">›_</span>{/if}
  <span class="label">{tab.title}</span>
  <span class="age">{stateWord(mark)} {relativeTime(tab.since)}</span>
</button>

<style>
  .live {
    position: relative;
    display: flex;
    box-sizing: border-box;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .live:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .live.active {
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    color: var(--fg-bright);
    box-shadow: inset 2px 0 0 var(--accent);
  }
  .mark {
    position: absolute;
    top: 50%;
    display: flex;
    transform: translateY(-50%);
  }
  .shell {
    color: var(--fg-faint);
    font-family: ui-monospace, monospace;
    font-size: 10px;
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .age {
    flex-shrink: 0;
    color: var(--fg-faint);
    font-size: 10px;
  }
</style>
