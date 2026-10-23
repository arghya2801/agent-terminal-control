<script lang="ts">
  import { weekHeatmap } from '../lib/costs';
  import type { CostRow } from '../types';

  /** Totals per weekday and local hour across the range. */
  let { rows, lo, hi, metric, fmt }: {
    rows: CostRow[];
    lo: string;
    hi: string;
    metric: 'tokens' | 'cost';
    fmt: (v: number) => string;
  } = $props();

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const week = $derived(weekHeatmap(rows, lo, hi, metric));
  const weekMax = $derived(Math.max(0, ...week.flat()));
  const level = (v: number) => (v > 0 && weekMax ? Math.ceil((v / weekMax) * 4) : 0);
  let hovered = $state<{ day: number; hour: number } | null>(null);
</script>

<div class="readout muted" aria-live="polite">
  {#if hovered}
    <strong>{WEEKDAYS[hovered.day]} {String(hovered.hour).padStart(2, '0')}:00</strong> · {fmt(week[hovered.day][hovered.hour])}
  {:else}
    Total per weekday and hour across the range, in local time. Hover a cell.
  {/if}
</div>
<div class="heat" role="img" aria-label={`${metric === 'tokens' ? 'Tokens' : 'Estimated cost'} by weekday and hour`}>
  <span></span>
  {#each { length: 24 } as _, h (h)}<span class="heat-hour muted">{h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>{/each}
  {#each week as hours, d (d)}
    <span class="heat-day muted">{WEEKDAYS[d]}</span>
    {#each hours as v, h (h)}
      <span
        class="cell l{level(v)}"
        class:hot={hovered?.day === d && hovered?.hour === h}
        role="presentation"
        onmouseenter={() => (hovered = { day: d, hour: h })}
        onmouseleave={() => (hovered = null)}
      ></span>
    {/each}
  {/each}
</div>
<div class="heat-scale muted">
  Less {#each [0, 1, 2, 3, 4] as l (l)}<span class="cell l{l}"></span>{/each} More
</div>

<style>
  .heat {
    display: grid;
    grid-template-columns: 32px repeat(24, 1fr);
    gap: 2px;
    align-items: center;
    max-width: 640px;
  }
  .heat-hour,
  .heat-day {
    font-size: 10px;
  }
</style>
