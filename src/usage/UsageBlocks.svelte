<script lang="ts">
  import { formatTokens, monetary, usageBlocks, type UsageBlock } from '../lib/costs';
  import type { CostRow } from '../types';

  /** Usage in 5-hour windows, each starting at its first activity. */
  let { rows, lo, hi, metric }: { rows: CostRow[]; lo: string; hi: string; metric: 'tokens' | 'cost' } = $props();

  const SHOWN = 50;
  const blocks = $derived(usageBlocks(rows, lo, hi));
  const value = (b: UsageBlock) => (metric === 'tokens' ? b.tokens : b.cost);
  const max = $derived(Math.max(0, ...blocks.map(value)));
  const window = (b: UsageBlock) =>
    `${new Date(b.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} – ${new Date(b.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
</script>

<p class="muted">
  Usage in 5-hour windows, each starting at its first activity, like Claude's session limit. Usage is
  recorded per hour, so the edges are approximate.
</p>
{#if blocks.length === 0}
  <p class="muted">No usage in this range.</p>
{:else}
  <table>
    <thead>
      <tr><th>Window</th><th class="num">Active hours</th><th class="num">Tokens</th><th class="num">Cost</th><th></th></tr>
    </thead>
    <tbody>
      {#each blocks.slice(0, SHOWN) as b (b.start)}
        <tr>
          <td>{window(b)}{#if Date.now() < b.end}<span class="now">now</span>{/if}</td>
          <td class="num">{b.activeHours}</td>
          <td class="num">{formatTokens(b.tokens)}</td>
          <td class="num">{monetary({ cost: b.cost, partial: b.partial, unavailable: b.partial && b.cost === 0 })}</td>
          <td class="bar-cell"><span class="hbar" style="width: {max ? (value(b) / max) * 100 : 0}%"></span></td>
        </tr>
      {/each}
    </tbody>
  </table>
  {#if blocks.length > SHOWN}<p class="muted">Showing the newest {SHOWN} of {blocks.length} blocks.</p>{/if}
{/if}

<style>
  .now {
    margin-left: 6px;
    color: var(--accent);
    font-size: 11px;
  }
  .bar-cell {
    width: 30%;
  }
  .hbar {
    display: block;
    height: 6px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
  }
</style>
