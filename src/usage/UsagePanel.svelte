<script lang="ts">
  import { onMount } from 'svelte';
  import { sessionKey, providerName } from '../lib/agents';
  import Page from '../lib/Page.svelte';
  import { save } from '@tauri-apps/plugin-dialog';
  import { claudeUsage, codexUsage, codexUsageStop, usageCosts, writeTextFile } from '../lib/ipc';
  import { appState } from '../lib/stores.svelte';
  import { chartData, formatTokens, formatUsd, monetary, localDay, owningProject, summarize, toCsv, type Split } from '../lib/costs';
  import {
    clampDays,
    isActive,
    MAX_DAYS,
    MIN_DAYS,
    parseSaved,
    presetDates,
    shiftDay,
    type Dates,
    type Selection,
  } from '../lib/range';
  import { codexLimits, planLimits, weeklyBreakdown } from '../lib/plan';
  import { relativeTime } from '../lib/format';
  import type { AgentProvider, CostRow } from '../types';

  let { onClose }: { onClose: () => void } = $props();

  let codexPlan = $state<Record<string, unknown> | null>(null);
  let codexError = $state<string | null>(null);
  let codexLoading = $state(false);
  let codexMissing = $state(false);
  const codexWindows = $derived(codexPlan ? codexLimits(codexPlan) : []);
  async function loadCodex() {
    if (codexLoading) return;
    codexLoading = true;
    try {
      const plan = await codexUsage();
      codexMissing = plan === null;
      codexPlan = plan;
      codexError = null;
    }
    catch (e) { codexMissing = false; codexError = String(e); }
    finally { codexLoading = false; }
  }

  // --- plan limits
  let plan = $state<Record<string, unknown> | null>(null);
  let planError = $state<string | null>(null);
  let planLoading = $state(false);
  let planUpdatedAt = $state(0);
  /** Ticks so "updated 3m ago" stays current while the page sits open. */
  let now = $state(Date.now());
  /** Limits move slowly, and the endpoint rate-limits, so poll gently. */
  const PLAN_REFRESH_MS = 90_000;
  const CODEX_REFRESH_MS = 300_000;

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
  let provider = $state<'all' | AgentProvider>('all');
  const filteredRows = $derived(provider === 'all' ? rows : rows.filter(r => r.provider === provider));
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

  /** One day, stepped from the one shown (or today). Not remembered: browsing. (#76) */
  function showDay(day: string) {
    const d = day > today ? today : day;
    selection = { kind: 'day' };
    from = to = d;
  }
  const stepDay = (n: number) => showDay(from === to ? shiftDay(from, n) : today);

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
    else if (saved.selection.kind === 'preset') preset(saved.selection.days);
  }

  function projectOf(key: string, path: string | null): { key: string; name: string } {
    if (!key) return { key: '', name: 'Unknown directory' };
    const projects = appState.index.projects;
    const owner = owningProject(key, projects.map((p) => p.key));
    const p = owner ? projects.find((x) => x.key === owner) : undefined;
    if (p) return { key: p.key, name: p.name };
    return { key, name: path?.split(/[\\/]/).filter(Boolean).pop() ?? key };
  }

  let groupBy = $state<'project' | 'model' | 'session'>('project');
  let metric = $state<'tokens' | 'cost'>('cost');
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
      const s = p.sessions.find((x) => sessionKey(x) === id);
      if (s) return `${providerName(s.provider)} · ${s.label}`;
    }
    const provider = id.startsWith('codex:') ? 'codex' : 'claude';
    return `${providerName(provider)} · ${id.slice(id.indexOf(':') + 1, id.indexOf(':') + 9)}`;
  }

  let exportError = $state<string | null>(null);

  async function exportCsv() {
    try {
      const path = await save({
        defaultPath: `atc-spend-${from}-to-${to}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!path) return;
      await writeTextFile(path, toCsv(filteredRows, from <= to ? from : to, from <= to ? to : from, projectOf));
      exportError = null;
    } catch (e) {
      exportError = String(e);
    }
  }

  const summary = $derived(
    summarize(filteredRows, from <= to ? from : to, from <= to ? to : from, projectOf),
  );
  const rankedProjects = $derived([...summary.byProject].sort((a, b) => b[metric] - a[metric]));
  const rankedModels = $derived([...summary.byModel].sort((a, b) => b[metric] - a[metric]));
  const rankedSessions = $derived([...summary.bySession].sort((a, b) => b[metric] - a[metric]));
  const metricTotal = $derived(metric === 'tokens' ? summary.tokens : summary.total);
  let split = $state<Split>('none');
  let cumulative = $state(false);
  const chart = $derived(
    chartData(filteredRows, from <= to ? from : to, from <= to ? to : from, { metric, split, cumulative }, projectOf),
  );
  const chartMax = $derived(Math.max(0, ...chart.buckets.map((b) => b.total)));
  const chartHourly = $derived(from === to);
  /** Bucket under the pointer, for the read-out above the chart. */
  let hovered = $state<number | null>(null);
  const shown = $derived(hovered === null ? null : chart.buckets[hovered]);
  /** One series keeps the accent; a split takes the categorical slots in rank order. */
  // ponytail: slots follow rank, so a range change can recolour a model; pin colours per
  // name if people compare screenshots across ranges.
  const color = (i: number) =>
    chart.series.length === 1 ? 'var(--accent)' : chart.series[i] === 'Other' ? 'var(--series-other)' : `var(--series-${i + 1})`;
  const fmt = (v: number) => (metric === 'tokens' ? `${formatTokens(v)} tokens` : formatUsd(v));

  onMount(() => {
    restoreRange();
    void loadPlan();
    void loadCodex();
    void loadCosts();
    const poll = setInterval(() => { void loadPlan(); void loadCosts(); }, PLAN_REFRESH_MS);
    // Each Codex read starts a `codex app-server` process, so it refreshes less often.
    const codexPoll = setInterval(() => void loadCodex(), CODEX_REFRESH_MS);
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      void codexUsageStop();
      clearInterval(poll);
      clearInterval(codexPoll);
      clearInterval(tick);
    };
  });
</script>

<Page title="Usage" {onClose}>
  <div class="plan-grid">
  <section class="plan-card" aria-label="Claude plan limits">
  <h2>
    Claude plan limits
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

  </section>
  {#if !codexMissing}
  <section class="plan-card" aria-label="Codex plan limits">
  <h2>Codex plan limits</h2>
  {#if codexError}<p class="err">{codexError}</p>{/if}
  {#if codexLoading && !codexPlan}<p class="muted">Loading Codex limits…</p>
  {:else if codexPlan && codexWindows.length === 0}<p class="muted">No rate-limit data for this account.</p>{/if}
  <div class="limits">
    {#each codexWindows as l (l.key)}
      <div class="limit">
        <div class="limit-head"><span>{l.label}</span><span>{Math.round(100 - l.percent)}% remaining · {Math.round(l.percent)}% used</span></div>
        <div class="meter"><div class="fill" style="width: {l.percent}%"></div></div>
        <div class="muted">{l.resetsAt ? resetsIn(l.resetsAt) : 'Reset time unavailable'}</div>
      </div>
    {/each}
  </div>
  {#if codexPlan && !codexWindows.some(l => l.windowMinutes === 300)}
    <p class="muted">5-hour limit: not reported by Codex for this account. ATC cannot calculate it from local token counts.</p>
  {/if}
  <button class="btn" onclick={loadCodex} disabled={codexLoading}>Refresh Codex limits</button>
  </section>
  {/if}
  </div>

  <h2>Local usage</h2>
  <p class="muted">
    Local tokens include linked child agents. Costs are API-equivalent estimates, not subscription charges. Codex uses standard short-context prices, including cached input; tier and long-context surcharges are excluded. Unknown model prices are unavailable.
  </p>

  <label>Provider <select bind:value={provider}><option value="all">All</option><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
  <div class="range">
    <label>From <input type="date" bind:value={from} max={today} onchange={pickedByHand} /></label>
    <label>To <input type="date" bind:value={to} max={today} onchange={pickedByHand} /></label>
    <span class="daystep">
      <button class="btn" onclick={() => stepDay(-1)} aria-label="Previous day" title="Previous day">‹</button>
      <button class="btn" class:on={isActive(selection, 1)} onclick={() => preset(1)}>Today</button>
      <button class="btn" onclick={() => stepDay(1)} disabled={from === to && to >= today} aria-label="Next day" title="Next day">›</button>
    </span>
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
    <div class="group" aria-label="Usage metric">
      <button class="btn" class:primary={metric === 'tokens'} onclick={() => metric = 'tokens'}>Tokens</button>
      <button class="btn" class:primary={metric === 'cost'} onclick={() => metric = 'cost'}>API cost estimates</button>
    </div>
    <div class="total">
      <span class="big">{metric === 'tokens' ? `${formatTokens(summary.tokens)} tokens` : monetary({ cost: summary.total, partial: summary.partial, unavailable: summary.unavailable })}</span>
      <span class="muted">{metric === 'tokens' ? `${monetary({cost: summary.total, partial: summary.partial, unavailable: summary.unavailable})} API cost estimate` : `${formatTokens(summary.tokens)} tokens`}</span>
    </div>

    <div class="group" aria-label="Chart options">
      <button class="btn" class:primary={!cumulative} onclick={() => (cumulative = false)}>{chartHourly ? 'Hourly' : 'Daily'}</button>
      <button class="btn" class:primary={cumulative} onclick={() => (cumulative = true)}>Running total</button>
      <span class="sep"></span>
      <button class="btn" class:primary={split === 'none'} onclick={() => (split = 'none')}>Total</button>
      <button class="btn" class:primary={split === 'model'} onclick={() => (split = 'model')}>By model</button>
      <button class="btn" class:primary={split === 'project'} onclick={() => (split = 'project')}>By project</button>
    </div>
    {#if chart.buckets.length > 0}
      <div class="readout muted" aria-live="polite">
        {#if shown}
          <strong>{shown.label}</strong> · {fmt(shown.total)}
          {#if chart.series.length > 1}
            {#each chart.series as name, i (name)}{#if shown.values[i] > 0} · {name} {fmt(shown.values[i])}{/if}{/each}
          {/if}
        {:else}
          {chartHourly ? 'Hover an hour' : 'Hover a day for its total; click it to show that day'}
        {/if}
      </div>
      <div class="chart" role="img" aria-label={`${cumulative ? 'Running total of' : ''} ${metric === 'tokens' ? 'tokens' : 'estimated cost'} per ${chartHourly ? 'hour' : 'day'}`}>
        {#each chart.buckets as b, i (b.key)}
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="bar-col"
            class:pick={!chartHourly}
            onmouseenter={() => (hovered = i)}
            onmouseleave={() => (hovered = null)}
            onclick={() => !chartHourly && showDay(b.key)}
          >
            <div class="stack" style="height: {chartMax ? (b.total / chartMax) * 100 : 0}%">
              {#each b.values as v, s (s)}
                {#if v > 0}<div class="seg" style="flex-grow: {v}; background: {color(s)}"></div>{/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <div class="chart-axis muted">
        <span>{chartHourly ? '00:00' : chart.buckets[0].key}</span><span>{chartHourly ? '23:00' : chart.buckets[chart.buckets.length - 1].key}</span>
      </div>
      {#if chart.series.length > 1}
        <ul class="legend">
          {#each chart.series as name, i (name)}
            <li><span class="swatch" style="background: {color(i)}"></span>{name}</li>
          {/each}
        </ul>
      {/if}
    {/if}

    <div class="group">
      <button class="btn" class:primary={groupBy === 'project'} onclick={() => (groupBy = 'project')}>
        By project
      </button>
      <button class="btn" class:primary={groupBy === 'model'} onclick={() => (groupBy = 'model')}>
        By model
      </button>
      <button class="btn" class:primary={groupBy === 'session'} onclick={() => groupBy = 'session'}>By session</button>
    </div>

    <table>
      <thead>
        <tr>
          <th>{groupBy === 'project' ? 'Project' : groupBy === 'model' ? 'Model' : 'Session'}</th>
          <th class="num">Tokens</th><th class="num">Cost</th><th class="share">{metric === 'tokens' ? 'Token share' : 'Cost share'}</th>
        </tr>
      </thead>
      <tbody>
        {#if groupBy === 'session'}
          {#each rankedSessions as s (s.key)}
            <tr>
              <td title={s.key}>{sessionName(s.key)}</td>
              <td class="num">{formatTokens(s.tokens)}</td>
              <td class="num">{monetary(s)}</td>
              <td class="share"><div class="meter small"><div class="fill" style="width: {metricTotal ? s[metric] / metricTotal * 100 : 0}%"></div></div></td>
            </tr>
          {:else}
            <tr><td colspan="4" class="muted">No usage in this range.</td></tr>
          {/each}
        {:else if groupBy === 'model'}
          {#each rankedModels as m (m.key)}
            <tr>
              <td>{m.key.startsWith('codex:') ? 'Codex' : 'Claude'} · {m.key.slice(m.key.indexOf(':') + 1)}</td>
              <td class="num">{formatTokens(m.tokens)}</td>
              <td class="num">{monetary(m)}</td>
              <td class="share">
                <div class="meter small">
                  <div class="fill" style="width: {metricTotal ? (m[metric] / metricTotal) * 100 : 0}%"></div>
                </div>
              </td>
            </tr>
          {:else}
            <tr><td colspan="4" class="muted">No usage in this range.</td></tr>
          {/each}
        {:else}
          {#each rankedProjects as p (p.key)}
            {@const sessions = [...(summary.sessionsByProject.get(p.key) ?? [])].sort((a, b) => b[metric] - a[metric])}
            <tr>
              <td>
                <button class="expand" onclick={() => toggleProject(p.key)} aria-expanded={expanded.has(p.key)}>
                  <span class="twisty" class:open={expanded.has(p.key)}>▸</span>{p.name}
                  <span class="muted">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
                </button>
              </td>
              <td class="num">{formatTokens(p.tokens)}</td>
              <td class="num">{monetary(p)}</td>
              <td class="share">
                <div class="meter small">
                  <div class="fill" style="width: {metricTotal ? (p[metric] / metricTotal) * 100 : 0}%"></div>
                </div>
              </td>
            </tr>
            {#if expanded.has(p.key)}
              {#each sessions as s (s.key)}
                <tr class="session">
                  <td title={s.key}>{sessionName(s.key)}</td>
                  <td class="num">{formatTokens(s.tokens)}</td>
                  <td class="num">{monetary(s)}</td>
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
      <p class="muted">Pricing is incomplete for: {summary.unpricedModels.join(', ')} (unknown portions are excluded from the estimate).</p>
    {/if}
  {/if}
</Page>

<style>
  .plan-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 24px;
  }
  .plan-card {
    min-width: 0;
  }
  .tag {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--bg-surface);
    color: var(--fg-dim);
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
    background: var(--bg-surface);
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
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-bottom: 5px;
    color: var(--fg);
    font-size: 13px;
  }
  .pct.hot {
    color: var(--warn);
  }
  .meter {
    height: 8px;
    overflow: hidden;
    margin-bottom: 4px;
    border-radius: 4px;
    background: var(--bg-surface);
  }
  .meter.small {
    height: 5px;
    margin: 0;
  }
  .fill {
    height: 100%;
    border-radius: 4px;
    background: var(--accent);
  }
  .fill.hot {
    background: var(--warn);
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
    border-color: var(--accent);
    color: var(--fg-bright);
  }
  .range {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 12px 0;
    color: var(--fg-dim);
    font-size: 12px;
  }
  .total {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 8px 0 12px;
  }
  .big {
    color: var(--fg-bright);
    font-size: 28px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
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
  .daystep {
    display: inline-flex;
    gap: 2px;
  }
  .sep {
    width: 8px;
  }
  .readout {
    min-height: 18px;
    margin-bottom: 4px;
  }
  .readout strong {
    color: var(--fg-bright);
    font-weight: 600;
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
  }
  .seg {
    min-height: 1px;
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
    color: var(--fg-faint);
    font-weight: 500;
    text-align: left;
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--bg-chrome);
    color: var(--fg);
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
    color: var(--fg-faint);
    font-size: 9px;
    transition: transform 0.12s;
  }
  .twisty.open {
    transform: rotate(90deg);
  }
  tr.session td:first-child {
    padding-left: 26px;
    color: var(--fg-dim);
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
