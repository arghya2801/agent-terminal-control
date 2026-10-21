<script lang="ts">
  import { codexLimits, planLimits, resetsIn, type PlanLimit } from '../lib/plan';
  import { formatUsd } from '../lib/costs';
  import { loadCodexLimits, loadTodaySpend, planState } from '../lib/limits.svelte';

  /**
   * The plan limit nearest to running out, in the tab bar. Hovering shows every limit and
   * today's spend without opening anything; a click opens the usage tab.
   */
  let { onOpen }: { onOpen: () => void } = $props();

  const PEEK_DELAY = 400;
  const CODEX_STALE = 300_000;
  const SPEND_STALE = 60_000;

  const claude = $derived(planState.claude ? planLimits(planState.claude) : []);
  const codex = $derived(planState.codex ? codexLimits(planState.codex) : []);
  /** Claude's tightest limit, or Codex's when there is no Claude plan. */
  const top = $derived([...(claude.length ? claude : codex)].sort((a, b) => b.percent - a.percent)[0] as PlanLimit | undefined);
  const level = (p: number) => (p >= 95 ? 'full' : p >= 80 ? 'hot' : '');

  let peek = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let spendAt = 0;

  function enter() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      peek = true;
      if (!planState.codexMissing && Date.now() - planState.codexAt > CODEX_STALE) void loadCodexLimits();
      if (Date.now() - spendAt > SPEND_STALE) {
        spendAt = Date.now();
        void loadTodaySpend();
      }
    }, peek ? 0 : PEEK_DELAY);
  }
  function leave() {
    clearTimeout(timer);
    // A moment's grace, so crossing the gap into the popover does not close it.
    timer = setTimeout(() => (peek = false), 150);
  }
  function open() {
    clearTimeout(timer);
    peek = false;
    onOpen();
  }
</script>

{#snippet rows(list: PlanLimit[])}
  {#each list as l (l.key)}
    <div class="row">
      <span class="name">{l.label}</span>
      <span class="pct {level(l.percent)}">{Math.round(l.percent)}%</span>
      <span class="meter"><span class="fill {level(l.percent)}" style="width: {l.percent}%"></span></span>
      <span class="when">{resetsIn(l.resetsAt)}</span>
    </div>
  {/each}
{/snippet}

{#if top}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="wrap" onmouseenter={enter} onmouseleave={leave}>
    <button class="chip" onclick={open} aria-label="{top.label}: {Math.round(top.percent)}% used. Open usage">
      <span class="pct {level(top.percent)}">{Math.round(top.percent)}%</span>
      <span class="meter"><span class="fill {level(top.percent)}" style="width: {top.percent}%"></span></span>
    </button>
    {#if peek}
      <div class="peek" role="dialog" aria-label="Plan limits">
        {#if claude.length}
          <h3>Claude</h3>
          {@render rows(claude)}
        {/if}
        {#if codex.length}
          <h3>Codex</h3>
          {@render rows(codex)}
        {:else if planState.codexLoading}
          <h3>Codex</h3>
          <div class="row"><span class="ghost" style="width: 18ch"></span></div>
        {/if}
        <div class="foot">
          <span>Today {planState.today === null ? '…' : formatUsd(planState.today)}</span>
          <button class="btn" onclick={open}>Open usage</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .wrap {
    position: relative;
    display: flex;
    align-self: center;
  }
  .chip {
    display: flex;
    height: 26px;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    cursor: pointer;
  }
  .chip:hover {
    background: var(--bg-hover);
  }
  .chip .pct {
    font-size: 11px;
    line-height: 1;
  }
  .chip .meter {
    width: 32px;
    height: 3px;
  }
  .pct {
    font-variant-numeric: tabular-nums;
  }
  .pct.hot {
    color: var(--warn);
  }
  .pct.full {
    color: var(--danger);
  }
  .meter {
    display: block;
    overflow: hidden;
    border-radius: 2px;
    background: var(--bg-surface);
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width var(--enter) var(--ease-out);
  }
  .fill.hot {
    background: var(--warn);
  }
  .fill.full {
    background: var(--danger);
  }
  .peek {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    width: 320px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-chrome);
    box-shadow: var(--shadow-pop);
    font-size: 12px;
    animation: atc-pop var(--enter) var(--ease-out);
    transform-origin: top right;
  }
  h3 {
    margin: 8px 0 6px;
    color: var(--fg-bright);
    font-size: 12px;
    font-weight: 600;
  }
  h3:first-child {
    margin-top: 0;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 8px;
    margin-bottom: 8px;
  }
  .name {
    color: var(--fg);
  }
  .row .meter {
    grid-column: 1 / -1;
    height: 4px;
  }
  .when {
    grid-column: 1 / -1;
    color: var(--fg-faint);
    font-size: 11px;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
  }
  .btn {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-surface);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .btn:hover {
    border-color: var(--accent);
  }
</style>
