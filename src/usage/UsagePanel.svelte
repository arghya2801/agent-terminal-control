<script lang="ts">
  import { onMount } from 'svelte';
  import Page from '../lib/Page.svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { claudeUsage, usageCosts, writeTextFile } from '../lib/ipc';
  import { appState } from '../lib/stores.svelte';
  import { formatTokens, formatUsd, localDay, owningProject, summarize, toCsv } from '../lib/costs';
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

  async function loadPlan() {
    if (planLoading) return;
    planLoading = true;
    try {
      plan = await claudeUsage();
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
  let from = $state(localDay(new Date(Date.now() - 29 * 86_400_000)));
  let to = $state(today);

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

  // The chosen range is remembered per machine. A preset is stored as itself, so "7 days"
  // still means the last 7 days tomorrow.
  const RANGE_KEY = 'atc.usage.range';
  type SavedRange = { preset: number | null } | { from: string; to: string };

  function remember(r: SavedRange) {
    try {
      localStorage.setItem(RANGE_KEY, JSON.stringify(r));
    } catch {
      // Storage unavailable: the range just is not remembered.
    }
  }

  function applyPreset(days: number | null) {
    to = today;
    from = days === null ? '2000-01-01' : localDay(new Date(Date.now() - (days - 1) * 86_400_000));
  }

  function preset(days: number | null) {
    applyPreset(days);
    remember({ preset: days });
  }

  function restoreRange() {
    try {
      const r = JSON.parse(localStorage.getItem(RANGE_KEY) ?? 'null') as SavedRange | null;
      if (!r) return;
      if ('preset' in r) applyPreset(r.preset);
      else if (r.from && r.to) {
        from = r.from;
        to = r.to;
      }
    } catch {
      // Missing or unreadable: keep the default range.
    }
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
    <p class="muted">loading…</p>
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
    <label>From <input type="date" bind:value={from} max={today} onchange={() => remember({ from, to })} /></label>
    <label>To <input type="date" bind:value={to} max={today} onchange={() => remember({ from, to })} /></label>
    <button class="btn" onclick={() => preset(1)}>Today</button>
    <button class="btn" onclick={() => preset(7)}>7 days</button>
    <button class="btn" onclick={() => preset(30)}>30 days</button>
    <button class="btn" onclick={() => preset(null)}>All time</button>
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
