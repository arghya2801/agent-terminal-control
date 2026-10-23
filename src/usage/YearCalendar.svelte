<script lang="ts">
  import { dailyTotals, localDay, streaks } from '../lib/costs';
  import type { CostRow } from '../types';

  /** The last 53 weeks, Monday first, whatever the range. */
  let { rows, metric, today, fmt, onDay }: {
    rows: CostRow[];
    metric: 'tokens' | 'cost';
    today: string;
    fmt: (v: number) => string;
    onDay: (day: string) => void;
  } = $props();

  const dayTotals = $derived(dailyTotals(rows, metric));
  const calendar = $derived.by(() => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 52 * 7);
    return Array.from({ length: 53 }, () =>
      Array.from({ length: 7 }, () => {
        const day = localDay(d);
        d.setDate(d.getDate() + 1);
        return day;
      }),
    );
  });
  const calendarMax = $derived(Math.max(0, ...calendar.flat().map((d) => dayTotals.get(d) ?? 0)));
  const level = (v: number) => (v > 0 && calendarMax ? Math.ceil((v / calendarMax) * 4) : 0);
  const streak = $derived(streaks([...dayTotals].filter(([, v]) => v > 0).map(([d]) => d), today));
  const monthLabel = (week: string[]) =>
    Number(week[0].slice(8)) <= 7 ? new Date(`${week[0]}T00:00:00`).toLocaleString(undefined, { month: 'short' }) : '';
  let hovered = $state<string | null>(null);
</script>

<div class="readout muted" aria-live="polite">
  {#if hovered}
    <strong>{hovered}</strong> · {fmt(dayTotals.get(hovered) ?? 0)}
  {:else}
    {streak.active} active {streak.active === 1 ? 'day' : 'days'} · current streak {streak.current} · longest {streak.longest}. The last year, whatever the range; click a day to show it.
  {/if}
</div>
<div class="calendar" role="img" aria-label={`${metric === 'tokens' ? 'Tokens' : 'Estimated cost'} per day over the last year`}>
  <div class="cal-days muted"><span></span><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>
  {#each calendar as days (days[0])}
    <div class="cal-week">
      <span class="cal-month muted">{monthLabel(days)}</span>
      {#each days as day (day)}
        {#if day > today}
          <span class="cell future"></span>
        {:else}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <span
            class="cell l{level(dayTotals.get(day) ?? 0)}"
            class:hot={hovered === day}
            role="presentation"
            onmouseenter={() => (hovered = day)}
            onmouseleave={() => (hovered = null)}
            onclick={() => onDay(day)}
          ></span>
        {/if}
      {/each}
    </div>
  {/each}
</div>
<div class="heat-scale muted">
  Less {#each [0, 1, 2, 3, 4] as l (l)}<span class="cell l{l}"></span>{/each} More
</div>

<style>
  .calendar {
    display: flex;
    gap: 2px;
    max-width: 100%;
    overflow-x: auto;
  }
  .cal-days,
  .cal-week {
    display: grid;
    grid-template-rows: 14px repeat(7, 10px);
    gap: 2px;
  }
  /* Fixed width: a month label overflows into the next weeks rather than widening its own. */
  .cal-week {
    grid-template-columns: 10px;
  }
  .cal-days {
    padding-right: 4px;
    font-size: 9px;
    line-height: 10px;
  }
  .cal-week .cell {
    width: 10px;
    min-width: 10px;
    height: 10px;
    cursor: pointer;
  }
  .cal-week .cell.future {
    visibility: hidden;
  }
  .cal-month {
    overflow: visible;
    font-size: 9px;
    white-space: nowrap;
  }
</style>
