<script lang="ts">
  import { cacheHitRate, hourToLocalDay } from '../lib/costs';
  import type { CostRow } from '../types';

  /** Share of input tokens read from the prompt cache, per day. */
  let { rows, lo, hi, onDay }: { rows: CostRow[]; lo: string; hi: string; onDay: (day: string) => void } = $props();

  const rates = $derived(cacheHitRate(rows, lo, hi));
  /** The line, split where a day had no input so gaps stay gaps. */
  const lines = $derived.by(() => {
    const out: string[] = [];
    let line: string[] = [];
    rates.forEach((r, i) => {
      if (r.rate === null) {
        if (line.length) out.push(line.join(' '));
        line = [];
      } else line.push(`${i + 0.5},${100 - r.rate * 100}`);
    });
    if (line.length) out.push(line.join(' '));
    return out;
  });
  const overall = $derived.by(() => {
    let read = 0;
    let fed = 0;
    for (const r of rows) {
      const day = hourToLocalDay(r.hour);
      if (day < lo || day > hi) continue;
      read += r.cacheRead;
      fed += r.input + r.cacheRead + r.cacheWrite;
    }
    return fed ? read / fed : null;
  });
  let hovered = $state<number | null>(null);
</script>

<div class="readout muted" aria-live="polite">
  {#if hovered !== null && rates[hovered]}
    <strong>{rates[hovered].day}</strong> ·
    {rates[hovered].rate === null ? 'no input' : `${Math.round(rates[hovered].rate! * 100)}% from cache`}
  {:else}
    {overall === null ? 'No input in this range.' : `${Math.round(overall * 100)}% of input tokens came from the prompt cache across the range.`}
  {/if}
</div>
{#if rates.length > 0}
  <div class="chart rate" role="img" aria-label="Share of input tokens read from the prompt cache, per day">
    <span class="rate-label muted" style="top: 2px">100%</span>
    <span class="rate-label muted" style="top: calc(50% + 2px)">50%</span>
    <svg viewBox="0 0 {rates.length} 100" preserveAspectRatio="none" aria-hidden="true">
      {#each [25, 50, 75] as y (y)}<line class="grid" x1="0" x2={rates.length} y1={y} y2={y} />{/each}
      {#each lines as points (points)}<polyline points={points} />{/each}
      {#if hovered !== null}<line class="cross" x1={hovered + 0.5} x2={hovered + 0.5} y1="0" y2="100" />{/if}
    </svg>
    {#each rates as r, i (r.day)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="hit" onmouseenter={() => (hovered = i)} onmouseleave={() => (hovered = null)} onclick={() => onDay(r.day)}>
        {#if r.rate !== null}<span class="rate-dot" class:hot={hovered === i} style="bottom: {r.rate * 100}%"></span>{/if}
      </div>
    {/each}
  </div>
  <div class="chart-axis muted"><span>{rates[0].day}</span><span>{rates[rates.length - 1].day}</span></div>
{/if}

<style>
  .chart.rate {
    gap: 0;
  }
  .chart.rate svg {
    position: absolute;
    inset: 0 0 2px;
    width: 100%;
    height: calc(100% - 2px);
    overflow: visible;
    pointer-events: none;
  }
  .chart.rate polyline {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .chart.rate .grid {
    stroke: var(--border);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .chart.rate .cross {
    stroke: var(--fg-faint);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
  .rate-label {
    position: absolute;
    left: 0;
    font-size: 10px;
  }
  .hit {
    position: relative;
    flex: 1;
    height: 100%;
    cursor: pointer;
  }
  .rate-dot {
    position: absolute;
    left: 50%;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    transform: translate(-50%, 50%);
  }
  .rate-dot.hot {
    width: 10px;
    height: 10px;
    box-shadow: 0 0 0 2px var(--bg);
  }
</style>
