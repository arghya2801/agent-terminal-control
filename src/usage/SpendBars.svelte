<script lang="ts">
  import { chartData, rollingAverage, type Split } from '../lib/costs';
  import type { AgentProvider, CostRow } from '../types';

  /** Spend or tokens per day (per hour for one day), optionally split and stacked. The
   *  chart options are bound so they survive switching to another view and back. */
  let {
    rows,
    lo,
    hi,
    metric,
    provider,
    fmt,
    projectOf,
    onDay,
    split = $bindable('none'),
    cumulative = $bindable(false),
    showAverage = $bindable(false),
    share = $bindable(false),
  }: {
    rows: CostRow[];
    lo: string;
    hi: string;
    metric: 'tokens' | 'cost';
    provider: 'all' | AgentProvider;
    fmt: (v: number) => string;
    projectOf: (key: string, path: string | null) => { key: string; name: string };
    onDay: (day: string) => void;
    split?: Split;
    cumulative?: boolean;
    showAverage?: boolean;
    /** 100% stacked bars, so the mix stays readable when totals swing. */
    share?: boolean;
  } = $props();

  // Token kinds have no cost of their own, and one provider needs no provider split.
  const activeSplit = $derived<Split>((split === 'type' && metric === 'cost') || (split === 'provider' && provider !== 'all') ? 'none' : split);
  const chart = $derived(chartData(rows, lo, hi, { metric, split: activeSplit, cumulative }, projectOf));
  const chartMax = $derived(Math.max(0, ...chart.buckets.map((b) => b.total)));
  const hourly = $derived(lo === hi);
  const asShare = $derived(share && chart.series.length > 1);
  const canAverage = $derived(!hourly && !cumulative && !asShare && chart.buckets.length >= 7);
  const average = $derived(showAverage && canAverage ? rollingAverage(chart.buckets.map((b) => b.total)) : null);
  const pct = (v: number, of: number) => `${of ? Math.round((v / of) * 100) : 0}%`;
  /** Bucket under the pointer, for the read-out above the chart. */
  let hovered = $state<number | null>(null);
  const shown = $derived(hovered === null ? null : chart.buckets[hovered]);
  /** A bar's height as a share of the chart, which the hover label sits just above. */
  const barPct = (b: (typeof chart.buckets)[number]) => (asShare ? (b.total ? 100 : 0) : chartMax ? (b.total / chartMax) * 100 : 0);
  /** One series keeps the accent; a split takes the categorical slots chartData assigns. */
  // ponytail: model and project slots follow rank, so a range change can recolour a model;
  // pin colours per name if people compare screenshots across ranges.
  const color = (i: number) =>
    chart.series.length === 1 ? 'var(--accent)' : chart.series[i] === 'Other' ? 'var(--series-other)' : `var(--series-${chart.slots[i] + 1})`;
</script>

<div class="group" aria-label="Bar options">
  <button class="btn" class:primary={!cumulative} onclick={() => (cumulative = false)}>{hourly ? 'Hourly' : 'Daily'}</button>
  <button class="btn" class:primary={cumulative} onclick={() => (cumulative = true)}>Running total</button>
  {#if chart.series.length > 1}
    <button class="btn" class:primary={share} aria-pressed={share} onclick={() => (share = !share)}>Share</button>
  {/if}
  {#if canAverage}
    <button class="btn" class:primary={showAverage} aria-pressed={showAverage} onclick={() => (showAverage = !showAverage)}>7-day average</button>
  {/if}
</div>
<div class="group" aria-label="Split the chart">
  <button class="btn" class:primary={activeSplit === 'none'} onclick={() => (split = 'none')}>Total</button>
  <button class="btn" class:primary={activeSplit === 'model'} onclick={() => (split = 'model')}>By model</button>
  <button class="btn" class:primary={activeSplit === 'project'} onclick={() => (split = 'project')}>By project</button>
  {#if provider === 'all'}
    <button class="btn" class:primary={activeSplit === 'provider'} onclick={() => (split = 'provider')}>By provider</button>
  {/if}
  {#if metric === 'tokens'}
    <button class="btn" class:primary={activeSplit === 'type'} onclick={() => (split = 'type')}>By token type</button>
  {/if}
</div>
{#if chart.buckets.length > 0}
  <div class="readout muted">
    {hourly ? 'Hover an hour' : 'Hover a day for its total; click it to show that day'}
  </div>
  <div class="chart" role="img" aria-label={`${cumulative ? 'Running total of' : ''} ${metric === 'tokens' ? 'tokens' : 'estimated cost'} per ${hourly ? 'hour' : 'day'}`}>
    {#if average && chartMax}
      <svg class="avg" viewBox="0 0 {average.length} {chartMax}" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={average.map((v, i) => `${i + 0.5},${chartMax - v}`).join(' ')} />
      </svg>
    {/if}
    {#if shown && hovered !== null}
      <!-- Its anchor slides from its left edge to its right across the chart, so it
           never runs off either side. -->
      {@const x = ((hovered + 0.5) / chart.buckets.length) * 100}
      <div class="tip" aria-live="polite" style="left: {x}%; bottom: calc({barPct(shown)}% + 8px); transform: translateX(-{x}%)">
        <strong>{shown.label}</strong>
        <span class="tip-total">{fmt(shown.total)}</span>
        {#if chart.series.length > 1}
          {#each chart.series as name, i (name)}
            {#if shown.values[i] > 0}
              <span class="tip-row"><span class="swatch" style="background: {color(i)}"></span>{name}<span>{asShare ? pct(shown.values[i], shown.total) : fmt(shown.values[i])}</span></span>
            {/if}
          {/each}
        {/if}
        {#if average}<span class="tip-row muted">7-day average<span>{fmt(average[hovered])}</span></span>{/if}
      </div>
    {/if}
    {#each chart.buckets as b, i (b.key)}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div
        class="bar-col"
        class:pick={!hourly}
        onmouseenter={() => (hovered = i)}
        onmouseleave={() => (hovered = null)}
        onclick={() => !hourly && onDay(b.key)}
      >
        <div class="stack" style="height: {barPct(b)}%">
          {#each b.values as v, s (s)}
            <!-- Grow weights summing to 100: below 1 in total, flex fills only that fraction of the bar. -->
            {#if v > 0}<div class="seg" style="flex-grow: {(v / b.total) * 100}; background: {color(s)}"></div>{/if}
          {/each}
        </div>
      </div>
    {/each}
  </div>
  <div class="chart-axis muted">
    <span>{hourly ? '00:00' : chart.buckets[0].key}</span><span>{hourly ? '23:00' : chart.buckets[chart.buckets.length - 1].key}</span>
  </div>
  {#if chart.series.length > 1 || average}
    <ul class="legend">
      {#if chart.series.length > 1}
        {#each chart.series as name, i (name)}
          <li><span class="swatch" style="background: {color(i)}"></span>{name}</li>
        {/each}
      {/if}
      {#if average}<li><span class="swatch line"></span>7-day average</li>{/if}
    </ul>
  {/if}
{/if}

<style>
  /* Categorical slots from the dataviz reference palette, validated against every bundled
     theme surface. light-dark() follows the color-scheme the theme sets on the root. */
  .chart,
  .legend {
    --series-1: light-dark(#2a78d6, #3987e5);
    --series-2: light-dark(#eb6834, #d95926);
    --series-3: light-dark(#1baf7a, #199e70);
    --series-4: light-dark(#eda100, #c98500);
    --series-5: light-dark(#e87ba4, #d55181);
    --series-other: var(--fg-faint);
  }
  .tip {
    position: absolute;
    z-index: 2;
    display: flex;
    min-width: 120px;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-chrome);
    box-shadow: var(--shadow-pop);
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }
  .tip strong {
    color: var(--fg-dim);
    font-weight: 500;
  }
  .tip-total {
    color: var(--fg-bright);
    font-size: 13px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .tip-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tip-row > span:last-child {
    margin-left: auto;
    padding-left: 12px;
    font-variant-numeric: tabular-nums;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    margin: 0 0 16px;
    padding: 0;
    color: var(--fg-dim);
    font-size: 12px;
    list-style: none;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 6px;
    border-radius: 2px;
    vertical-align: -1px;
  }
  .swatch.line {
    height: 2px;
    vertical-align: 3px;
    background: var(--fg-bright);
  }
  .avg {
    position: absolute;
    inset: 0 0 2px;
    width: 100%;
    height: calc(100% - 2px);
    overflow: visible;
    pointer-events: none;
  }
  .avg polyline {
    fill: none;
    stroke: var(--fg-bright);
    stroke-width: 2;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .bar-col {
    display: flex;
    height: 100%;
    flex: 1;
    align-items: flex-end;
  }
  .bar-col.pick {
    cursor: pointer;
  }
  .bar-col:hover .stack {
    opacity: 0.8;
  }
  .stack {
    display: flex;
    width: 100%;
    flex-direction: column-reverse;
    gap: 2px;
    overflow: hidden;
    border-radius: 4px 4px 0 0;
    transition: height var(--enter) var(--ease-out), opacity var(--fast);
  }
  .seg {
    min-height: 1px;
  }
</style>
