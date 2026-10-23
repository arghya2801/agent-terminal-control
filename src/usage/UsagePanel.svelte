<script lang="ts">
  import { onMount } from 'svelte';
  import { sessionKey, providerName } from '../lib/agents';
  import Page from '../lib/Page.svelte';
  import SectionNav from '../lib/SectionNav.svelte';
  import { save } from '../lib/desktop';
  import { usageCosts, writeTextFile } from '../lib/ipc';
  import { appState, refreshMs } from '../lib/stores.svelte';
  import { sessionStats, formatTokens, formatUsd, monetary, localDay, owningProject, summarize, toCsv, type Split } from '../lib/costs';
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
  import type { AgentProvider, CostRow } from '../types';
  import PlanLimits from './PlanLimits.svelte';
  import SpendBars from './SpendBars.svelte';
  import WeekHeat from './WeekHeat.svelte';
  import YearCalendar from './YearCalendar.svelte';
  import UsageBlocks from './UsageBlocks.svelte';
  import CacheRate from './CacheRate.svelte';
  import Breakdown from './Breakdown.svelte';
  import './usage.css';

  /** The usage page: plan limits, then local spend over a range in one of several views. */
  let { onClose, sessionKey: current = null }: { onClose: () => void; sessionKey?: string | null } =
    $props();

  // --- spend
  let rows = $state<CostRow[]>([]);
  let provider = $state<'all' | AgentProvider>('all');
  const filteredRows = $derived(provider === 'all' ? rows : rows.filter(r => r.provider === provider));
  let costError = $state<string | null>(null);
  let costLoading = $state(false);
  /** Until the first scan lands, sections that depend on it hold their space. */
  let costsLoaded = $state(false);
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
      costsLoaded = true;
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
  let exporting = $state(false);

  async function exportCsv() {
    if (exporting) return;
    exporting = true;
    try {
      const path = await save({
        defaultPath: `atc-spend-${from}-to-${to}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!path) return;
      await writeTextFile(path, toCsv(filteredRows, lo, hi, projectOf));
      exportError = null;
    } catch (e) {
      exportError = String(e);
    } finally {
      exporting = false;
    }
  }

  const lo = $derived(from <= to ? from : to);
  const hi = $derived(from <= to ? to : from);
  const summary = $derived(summarize(filteredRows, lo, hi, projectOf));
  let metric = $state<'tokens' | 'cost'>('cost');
  let view = $state<'bars' | 'week' | 'calendar' | 'blocks' | 'cache'>('bars');
  let bars = $state({ split: 'none' as Split, cumulative: false, showAverage: false, share: false });
  /** The focused tab's session, all time (#80). */
  const session = $derived(current ? sessionStats(rows, current) : null);
  const localTime = (hour: string) =>
    new Date(`${hour}:00:00Z`).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmt = (v: number) => (metric === 'tokens' ? `${formatTokens(v)} tokens` : formatUsd(v));

  const sections = $derived([
    { id: 'u-limits', label: 'Limits' },
    ...(current && (session || !costsLoaded) ? [{ id: 'u-session', label: "This tab's session" }] : []),
    { id: 'u-local', label: 'Local usage' },
    ...(costsLoaded && !costError ? [{ id: 'u-breakdown', label: 'Breakdown' }] : []),
  ]);

  onMount(() => {
    restoreRange();
    void loadCosts();
    const poll = setInterval(() => void loadCosts(), refreshMs('claude'));
    return () => clearInterval(poll);
  });
</script>

<Page title="Usage" wide {onClose}>
  <SectionNav {sections}>
  <div class="usage">
  <span id="u-limits" class="anchor"></span>
  <PlanLimits />

  {#if current && (session || !costsLoaded)}
    <h2 id="u-session">This tab's session</h2>
    {#if session}
      <div class="total">
        <span class="big">{monetary({ cost: session.cost, partial: session.partial, unavailable: false })}</span>
        <span class="muted">{formatTokens(session.tokens)} tokens · {Math.round(session.cacheShare * 100)}% of input from cache · {sessionName(current)}</span>
      </div>
      <p class="muted">
        Active {localTime(session.firstHour)} to {localTime(session.lastHour)}, by the hour. API and wall durations and code changes are only in the CLI's own <code>/usage</code>.
      </p>
    {:else}
      <div class="total" aria-busy="true">
        <span class="big"><span class="ghost" style="width: 5ch"></span></span>
        <span class="muted"><span class="ghost" style="width: 36ch"></span></span>
      </div>
      <p class="muted"><span class="ghost" style="width: 60ch; max-width: 100%"></span></p>
    {/if}
    <table>
      <thead><tr><th>Model</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cache read</th><th class="num">Cache write</th><th class="num">API cost</th></tr></thead>
      <tbody>
        {#if !session}<tr><td colspan="6"><span class="ghost" style="width: 16ch"></span></td></tr>{/if}
        {#each session?.byModel ?? [] as m (m.model)}
          <tr>
            <td>{m.model}</td>
            <td class="num">{formatTokens(m.input)}</td>
            <td class="num">{formatTokens(m.output)}</td>
            <td class="num">{formatTokens(m.cacheRead)}</td>
            <td class="num">{formatTokens(m.cacheWrite)}</td>
            <td class="num">{m.cost === null ? 'unavailable' : formatUsd(m.cost)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}

  <h2 id="u-local">Local usage</h2>
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
    <button class="btn" onclick={exportCsv} disabled={exporting || rows.length === 0}>Export CSV</button>
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
      <button class="btn" class:primary={view === 'bars'} onclick={() => (view = 'bars')}>Over time</button>
      <button class="btn" class:primary={view === 'week'} onclick={() => (view = 'week')}>By weekday and hour</button>
      <button class="btn" class:primary={view === 'calendar'} onclick={() => (view = 'calendar')}>Calendar</button>
      <button class="btn" class:primary={view === 'blocks'} onclick={() => (view = 'blocks')}>5-hour blocks</button>
      <button class="btn" class:primary={view === 'cache'} onclick={() => (view = 'cache')}>Cache hit rate</button>
    </div>
    {#if view === 'bars'}
      <SpendBars
        rows={filteredRows}
        {lo}
        {hi}
        {metric}
        {provider}
        {fmt}
        {projectOf}
        onDay={showDay}
        bind:split={bars.split}
        bind:cumulative={bars.cumulative}
        bind:showAverage={bars.showAverage}
        bind:share={bars.share}
      />
    {:else if view === 'week'}
      <WeekHeat rows={filteredRows} {lo} {hi} {metric} {fmt} />
    {:else if view === 'calendar'}
      <YearCalendar rows={filteredRows} {metric} {today} {fmt} onDay={showDay} />
    {:else if view === 'blocks'}
      <UsageBlocks rows={filteredRows} {lo} {hi} {metric} />
    {:else}
      <CacheRate rows={filteredRows} {lo} {hi} onDay={showDay} />
    {/if}

    <Breakdown {summary} {metric} {sessionName} />
  {/if}
  </div>
  </SectionNav>
</Page>

<style>
  .anchor {
    display: block;
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
  .daystep {
    display: inline-flex;
    gap: 2px;
  }
</style>
