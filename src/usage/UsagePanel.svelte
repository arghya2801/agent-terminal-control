<script lang="ts">
  import { onMount } from 'svelte';
  import Page from '../lib/Page.svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { claudeUsage, usageCosts, writeTextFile } from '../lib/ipc';
  import { appState } from '../lib/stores.svelte';
  import { formatTokens, formatUsd, localDay, owningProject, summarize, toCsv } from '../lib/costs';
  import {
    clampDays,
    isActive,
    MAX_DAYS,
    MIN_DAYS,
    parseSaved,
    presetDates,
    type Dates,
    type Selection,
  } from '../lib/range';
  import { planLimits, weeklyBreakdown } from '../lib/plan';
  import { relativeTime } from '../lib/format';
  import type { CostRow } from '../types';

  let { onClose }: { onClose: () => void } = $props();

  // --- plan limits
  let plan = $state<Record<string, unknown> | null>(null);
  let planError = $state<string | null>(null);
  let planLoading = $state(false);
  let planUpdatedAt = $state(0);
  /** Ticks so "updated 3m ago" stays current while the page sits open. */
  let now = $state(Date.now());
  /** Limits move slowly, and the endpoint rate-limits, so poll gently. */
  const PLAN_REFRESH_MS = 90_000;

  const limits = $derived(plan ? planLimits(plan) : []);
  const breakdown = $derived(plan ? weeklyBreakdown(plan) : []);

  // How many limit rows to reserve space for before the response lands. How many an
  // account has varies (session, week, and per-model weeks), so remember the last count
  // rather than guess it every time; the default only matters on the very first load.
  const ROWS_KEY = 'atc.usage.limitRows';
  let skeletonRows = $state(readRows());

  function readRows(): number {
    try {
      const n = Number(localStorage.getItem(ROWS_KEY));
      if (Number.isInteger(n) && n > 0 && n <= 6) return n;
    } catch {
      // Storage unavailable: fall through to the default.
    }
    return 3;
  }

  function rememberRows(n: number) {
    if (n <= 0 || n === skeletonRows) return;
    skeletonRows = n;
    try {
      localStorage.setItem(ROWS_KEY, String(n));
    } catch {
      // Storage unavailable: next launch reserves the default instead.
    }
  }

  async function loadPlan() {
    if (planLoading) return;
    planLoading = true;
    try {
      plan = await claudeUsage();
      rememberRows(limits.length);
      planUpdatedAt = Date.now();
      now = planUpdatedAt;
      planError = null;
    } catch (e) {
      planError = String(e);
    } finally {
      planLoading = false;
    }
  }

  function resetsIn(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const mins = Math.round((d.getTime() - Date.now()) / 60_000);
    const when = d.toLocaleString(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
    if (mins <= 0) return 'resetting now';
    if (mins < 60) return `resets in ${mins}m (${when})`;
    if (mins < 48 * 60) return `resets in ${Math.floor(mins / 60)}h ${mins % 60}m (${when})`;
    return `resets ${when}`;
  }

  // --- spend
  let rows = $state<CostRow[]>([]);
  let costError = $state<string | null>(null);
  let costLoading = $state(false);
  const today = localDay(new Date());
  const initial = presetDates(30);
  let from = $state(initial.from);
  let to = $state(initial.to);

  async function loadCosts() {
    costLoading = true;
    try {
      rows = await usageCosts();
      costError = null;
    } catch (e) {
      costError = String(e);
    } finally {
      costLoading = false;
    }
  }

  // The chosen range is remembered per machine, along with the last range picked by hand
  // so switching to a preset and back does not lose it.
  const RANGE_KEY = 'atc.usage.range';

  let selection = $state<Selection>({ kind: 'preset', days: 30 });
  let custom = $state<Dates | null>(null);
  /** What the "last N days" box holds; applied on Enter or on leaving the box. */
  let spanDays = $state(30);

  function saveRange() {
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify({ selection, custom }));
    } catch {
      // Storage unavailable: the range just is not remembered.
    }
  }

  function preset(days: number | null) {
    selection = { kind: 'preset', days };
    ({ from, to } = presetDates(days));
    if (days !== null) spanDays = days;
    saveRange();
  }

  /** The date inputs. Editing either is what makes a range "custom". */
  function pickedByHand() {
    selection = { kind: 'custom' };
    custom = { from, to };
    saveRange();
  }

  function useCustom() {
    if (!custom) return;
    selection = { kind: 'custom' };
    ({ from, to } = custom);
    saveRange();
  }

  function applySpan(raw: number) {
    const days = clampDays(raw);
    spanDays = days;
    preset(days);
  }

  function restoreRange() {
    let saved = null;
    try {
      saved = parseSaved(localStorage.getItem(RANGE_KEY));
    } catch {
      // Storage unavailable: keep the default range.
    }
    if (!saved) return;
    custom = saved.custom;
    if (saved.selection.kind === 'custom') useCustom();
    else preset(saved.selection.days);
  }

  function projectOf(key: string, path: string | null): { key: string; name: string } {
    if (!key) return { key: '', name: 'Unknown directory' };
    const projects = appState.index.projects;
    const owner = owningProject(key, projects.map((p) => p.key));
    const p = owner ? projects.find((x) => x.key === owner) : undefined;
    if (p) return { key: p.key, name: p.name };
    return { key, name: path?.split(/[\\/]/).filter(Boolean).pop() ?? key };
  }

  let groupBy = $state<'project' | 'model'>('project');
  /** Project keys whose sessions are shown. */
  let expanded = $state<Set<string>>(new Set());

  function toggleProject(key: string) {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }

  /** Session label from the sidebar index, falling back to a short id. */
  function sessionName(id: string): string {
    for (const p of appState.index.projects) {
      const s = p.sessions.find((x) => x.id === id);
      if (s) return s.label;
    }
    return id.slice(0, 8);
  }

  let exportError = $state<string | null>(null);

  async function exportCsv() {
    try {
      const path = await save({
        defaultPath: `atc-spend-${from}-to-${to}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!path) return;
      await writeTextFile(path, toCsv(rows, from <= to ? from : to, from <= to ? to : from, projectOf));
      exportError = null;
    } catch (e) {
      exportError = String(e);
    }
  }

  const summary = $derived(
    summarize(rows, from <= to ? from : to, from <= to ? to : from, projectOf),
  );
  // Start the chart at the first day with spend, or "all time" draws years of empty bars.
  const chartDays = $derived.by(() => {
    const first = summary.byDay.findIndex((d) => d.cost > 0);
    return first < 0 ? [] : summary.byDay.slice(first);
  });
  const maxDay = $derived(Math.max(0, ...chartDays.map((d) => d.cost)));

  onMount(() => {
    restoreRange();
    void loadPlan();
    void loadCosts();
    const poll = setInterval(() => void loadPlan(), PLAN_REFRESH_MS);
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  });
</script>

<Page title="Usage" {onClose}>
  <h2>
    Plan limits
    {#if typeof plan?.subscriptionType === 'string'}<span class="tag">{plan.subscriptionType}</span>{/if}
  </h2>
  {#if planError && !plan}
    <p class="err">{planError}</p>
  {:else if !plan}
    <!-- Same markup as the real rows, so the space reserved is the space they take and
         nothing below moves when they arrive. -->
    <div class="limits" aria-busy="true" aria-label="Loading plan limits">
      {#each { length: skeletonRows } as _, i (i)}
        <div class="limit">
          <div class="limit-head">
            <span class="ghost" style="width: 11ch"></span>
            <span class="ghost" style="width: 7ch"></span>
          </div>
          <div class="meter"></div>
          <div class="muted"><span class="ghost" style="width: 18ch"></span></div>
        </div>
      {/each}
    </div>
  {:else if limits.length === 0}
    <p class="muted">No limits reported for this account.</p>
  {:else}
    <div class="limits">
      {#each limits as l (l.key)}
        <div class="limit">
          <div class="limit-head">
            <span>{l.label}</span>
            <span class="pct" class:hot={l.percent >= 80}>{Math.round(l.percent)}% used</span>
          </div>
          <div class="meter">
            <div class="fill" class:hot={l.percent >= 80} style="width: {l.percent}%"></div>
          </div>
          <div class="muted">{resetsIn(l.resetsAt)}</div>
        </div>
      {/each}
    </div>
    {#if breakdown.length > 0}
      <p class="muted">
        This week by product: {breakdown.map((b) => `${b.name} ${b.percent}%`).join(' · ')}
      </p>
    {/if}
    {#if planError}
      <!-- A failed background refresh keeps the last good numbers on screen. -->
      <p class="err">Refresh failed: {planError}</p>
    {/if}
  {/if}
  <div class="refresh">
    <button class="btn" onclick={loadPlan} disabled={planLoading}>
      {planLoading ? 'Refreshing…' : 'Refresh'}
    </button>
    {#if planUpdatedAt}
      {@const ago = relativeTime(planUpdatedAt, now)}
      <span class="muted">Updated {ago === 'now' ? 'just now' : `${ago} ago`}</span>
    {/if}
  </div>

  <h2>Spend at API prices</h2>
  <p class="muted">
    What the tokens in your local Claude Code transcripts would cost at API list prices,
    subagents included. On a subscription, this isn't what you pay.
  </p>

  <div class="range">
    <label>From <input type="date" bind:value={from} max={today} onchange={pickedByHand} /></label>
    <label>To <input type="date" bind:value={to} max={today} onchange={pickedByHand} /></label>
    <button class="btn" class:on={isActive(selection, 1)} onclick={() => preset(1)}>Today</button>
    <button class="btn" class:on={isActive(selection, 7)} onclick={() => preset(7)}>7 days</button>
    <button class="btn" class:on={isActive(selection, 30)} onclick={() => preset(30)}>30 days</button>
    <button class="btn" class:on={isActive(selection, null)} onclick={() => preset(null)}>
      All time
    </button>
    <label>
      Last
      <input
        class="span"
        type="number"
        min={MIN_DAYS}
        max={MAX_DAYS}
        bind:value={spanDays}
        onchange={() => applySpan(spanDays)}
        aria-label="Last N days"
      />
      days
    </label>
    <button
      class="btn"
      class:on={selection.kind === 'custom'}
      onclick={useCustom}
      disabled={!custom}
      title={custom ? `${custom.from} to ${custom.to}` : 'Pick a From and To date first'}
    >
      Custom
    </button>
    <button class="btn" onclick={loadCosts} disabled={costLoading}>
      {costLoading ? 'Scanning…' : 'Rescan'}
    </button>
    <button class="btn" onclick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
  </div>
  {#if exportError}<p class="err">{exportError}</p>{/if}

  {#if costError}
    <p class="err">{costError}</p>
  {:else if costLoading && rows.length === 0}
    <p class="muted">Reading transcripts. The first scan can take a few seconds.</p>
  {:else}
    <div class="total">
      <span class="big">{formatUsd(summary.total)}</span>
      <span class="muted">{formatTokens(summary.tokens)} tokens</span>
    </div>

    {#if chartDays.length > 0}
      <div class="chart" role="img" aria-label="Spend per day">
        {#each chartDays as d (d.day)}
          <div class="bar-col" title="{d.day}: {formatUsd(d.cost)}">
            <div class="bar" style="height: {maxDay ? (d.cost / maxDay) * 100 : 0}%"></div>
          </div>
        {/each}
      </div>
      <div class="chart-axis muted">
        <span>{chartDays[0].day}</span><span>{chartDays[chartDays.length - 1].day}</span>
      </div>
    {/if}

    <div class="group">
      <button class="btn" class:primary={groupBy === 'project'} onclick={() => (groupBy = 'project')}>
        By project
      </button>
      <button class="btn" class:primary={groupBy === 'model'} onclick={() => (groupBy = 'model')}>
        By model
      </button>
    </div>

    <table>
      <thead>
        <tr>
          <th>{groupBy === 'project' ? 'Project' : 'Model'}</th>
          <th class="num">Tokens</th><th class="num">Cost</th><th class="share"></th>
        </tr>
      </thead>
      <tbody>
        {#if groupBy === 'model'}
          {#each summary.byModel as m (m.key)}
            <tr>
              <td>{m.key}</td>
              <td class="num">{formatTokens(m.tokens)}</td>
              <td class="num">{formatUsd(m.cost)}</td>
              <td class="share">
                <div class="meter small">
                  <div class="fill" style="width: {summary.total ? (m.cost / summary.total) * 100 : 0}%"></div>
                </div>
              </td>
            </tr>
          {:else}
            <tr><td colspan="4" class="muted">No usage in this range.</td></tr>
          {/each}
        {:else}
          {#each summary.byProject as p (p.key)}
            {@const sessions = summary.sessionsByProject.get(p.key) ?? []}
            <tr>
              <td>
                <button class="expand" onclick={() => toggleProject(p.key)} aria-expanded={expanded.has(p.key)}>
                  <span class="twisty" class:open={expanded.has(p.key)}>▸</span>{p.name}
                  <span class="muted">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
                </button>
              </td>
              <td class="num">{formatTokens(p.tokens)}</td>
              <td class="num">{formatUsd(p.cost)}</td>
              <td class="share">
                <div class="meter small">
                  <div class="fill" style="width: {summary.total ? (p.cost / summary.total) * 100 : 0}%"></div>
                </div>
              </td>
            </tr>
            {#if expanded.has(p.key)}
              {#each sessions as s (s.key)}
                <tr class="session">
                  <td title={s.key}>{sessionName(s.key)}</td>
                  <td class="num">{formatTokens(s.tokens)}</td>
                  <td class="num">{formatUsd(s.cost)}</td>
                  <td class="share"></td>
                </tr>
              {/each}
            {/if}
          {:else}
            <tr><td colspan="4" class="muted">No usage in this range.</td></tr>
          {/each}
        {/if}
      </tbody>
    </table>

    {#if summary.unpricedModels.length > 0}
      <p class="muted">No price known for: {summary.unpricedModels.join(', ')} (counted as $0).</p>
    {/if}
  {/if}
</Page>

<style>
  .tag {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 8px;
    background: #21262d;
    color: #8b949e;
    letter-spacing: 0;
    text-transform: none;
  }
  .limits {
    display: grid;
    gap: 14px;
    margin-bottom: 12px;
  }
  /* Placeholder for a line of text that has not arrived, sized to the line it replaces. */
  .ghost {
    display: inline-block;
    height: 1em;
    vertical-align: -0.15em;
    border-radius: 3px;
    background: #21262d;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.45;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ghost {
      animation: none;
    }
  }
  .limit-head {
    display: flex;
    justify-content: space-between;
    margin-bottom: 5px;
    color: #c9d1d9;
    font-size: 13px;
  }
  .pct.hot {
    color: #f0883e;
  }
  .meter {
    height: 8px;
    overflow: hidden;
    margin-bottom: 4px;
    border-radius: 4px;
    background: #21262d;
  }
  .meter.small {
    height: 5px;
    margin: 0;
  }
  .fill {
    height: 100%;
    border-radius: 4px;
    background: #539bf5;
  }
  .fill.hot {
    background: #f0883e;
  }
  .refresh {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .range .span {
    width: 4.5em;
  }
  .range :global(button.btn.on) {
    border-color: #539bf5;
    color: #e6edf3;
  }
  .range {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
    color: #8b949e;
    font-size: 12px;
  }
  .total {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 8px 0 12px;
  }
  .big {
    color: #e6edf3;
    font-size: 28px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .chart {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 110px;
    padding-bottom: 2px;
    border-bottom: 1px solid var(--border);
  }
  .bar-col {
    display: flex;
    height: 100%;
    flex: 1;
    align-items: flex-end;
  }
  .bar-col:hover .bar {
    background: #79b8ff;
  }
  .bar {
    width: 100%;
    min-height: 1px;
    border-radius: 2px 2px 0 0;
    background: #539bf5;
  }
  .chart-axis {
    display: flex;
    justify-content: space-between;
    margin: 4px 0 16px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th {
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
    color: #6e7681;
    font-weight: 500;
    text-align: left;
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid #161b22;
    color: #c9d1d9;
  }
  .group {
    display: flex;
    gap: 6px;
    margin: 14px 0 8px;
  }
  .expand {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .twisty {
    display: inline-block;
    color: #6e7681;
    font-size: 9px;
    transition: transform 0.12s;
  }
  .twisty.open {
    transform: rotate(90deg);
  }
  tr.session td:first-child {
    padding-left: 26px;
    color: #8b949e;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .share {
    width: 120px;
  }
</style>
