<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { codexUsageStop } from '../lib/ipc';
  import { loadClaudeLimits, loadCodexLimits, planState } from '../lib/limits.svelte';
  import { refreshMs } from '../lib/stores.svelte';
  import { codexLimits, planLimits, resetsIn, weeklyBreakdown } from '../lib/plan';
  import { relativeTime } from '../lib/format';

  /** Claude's and Codex's plan limits, from the app-wide store the header's chip shares. */
  const codexPlan = $derived(planState.codex);
  const codexError = $derived(planState.codexError);
  const codexLoading = $derived(planState.codexLoading);
  const CODEX_ROWS_KEY = 'atc.usage.codexRows';
  const lastCodexRows = readRows(CODEX_ROWS_KEY, 2);
  let codexRows = $state(lastCodexRows);
  /** Not installed last time either: reserving a card that then vanishes is worse than none. */
  const codexMissing = $derived(planState.codexAt ? planState.codexMissing : lastCodexRows === 0);
  const codexWindows = $derived(codexPlan ? codexLimits(codexPlan) : []);
  $effect(() => {
    if (!planState.codexAt || planState.codexError) return;
    const n = planState.codex === null ? 0 : codexWindows.length;
    codexRows = rememberRows(CODEX_ROWS_KEY, n, untrack(() => codexRows));
  });

  const plan = $derived(planState.claude);
  const planError = $derived(planState.claudeError);
  const planLoading = $derived(planState.claudeLoading);
  const planUpdatedAt = $derived(plan ? planState.claudeAt : 0);
  /** Ticks so "updated 3m ago" stays current while the page sits open. */
  let now = $state(Date.now());

  const limits = $derived(plan ? planLimits(plan) : []);
  const breakdown = $derived(plan ? weeklyBreakdown(plan) : []);

  // How many limit rows to reserve space for before the response lands. How many an
  // account has varies (session, week, and per-model weeks), so remember the last count
  // rather than guess it every time; the default only matters on the very first load.
  const ROWS_KEY = 'atc.usage.limitRows';
  let skeletonRows = $state(readRows(ROWS_KEY, 3));

  function readRows(key: string, fallback: number): number {
    try {
      const raw = localStorage.getItem(key);
      const n = Number(raw);
      if (raw !== null && Number.isInteger(n) && n >= 0 && n <= 6) return n;
    } catch {
      // Storage unavailable: fall through to the default.
    }
    return fallback;
  }

  /** Returns the count to reserve next time; `0` is only kept for Codex being absent. */
  function rememberRows(key: string, n: number, was: number): number {
    if (n === was || (n === 0 && key === ROWS_KEY)) return was;
    try {
      localStorage.setItem(key, String(n));
    } catch {
      // Storage unavailable: next launch reserves the default instead.
    }
    return n;
  }

  $effect(() => {
    if (!plan) return;
    skeletonRows = rememberRows(ROWS_KEY, limits.length, untrack(() => skeletonRows));
    now = Date.now();
  });

  onMount(() => {
    // The app polls Claude's limits already; only a stale answer is refreshed here.
    if (Date.now() - planState.claudeAt > refreshMs('claude')) void loadClaudeLimits();
    if (Date.now() - planState.codexAt > refreshMs('codex')) void loadCodexLimits();
    // Each Codex read starts a `codex app-server` process, so it refreshes less often.
    const codexPoll = setInterval(() => void loadCodexLimits(), refreshMs('codex'));
    const tick = setInterval(() => (now = Date.now()), 30_000);
    return () => {
      void codexUsageStop();
      clearInterval(codexPoll);
      clearInterval(tick);
    };
  });
</script>

<!-- Same markup as the real rows, so the space reserved is the space they take and
     nothing below moves when they arrive. -->
{#snippet ghostLimits(n: number, label: string)}
  <div class="limits" aria-busy="true" aria-label={label}>
    {#each { length: n } as _, i (i)}
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
{/snippet}

<div class="plan-grid">
  <section class="plan-card" aria-label="Claude plan limits">
    <h2>
      Claude plan limits
      {#if typeof plan?.subscriptionType === 'string'}<span class="tag">{plan.subscriptionType}</span>{/if}
    </h2>
    {#if planError && !plan}
      <p class="err">{planError}</p>
    {:else if !plan}
      {@render ghostLimits(skeletonRows, 'Loading plan limits')}
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
      <button class="btn" onclick={loadClaudeLimits} disabled={planLoading}>
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
      {#if !codexPlan && !codexError}{@render ghostLimits(codexRows || 2, 'Loading Codex limits')}
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
      {#if codexPlan && !codexWindows.some((l) => l.windowMinutes === 300)}
        <p class="muted">5-hour limit: not reported by Codex for this account. ATC cannot calculate it from local token counts.</p>
      {/if}
      <button class="btn" onclick={loadCodexLimits} disabled={codexLoading}>Refresh Codex limits</button>
    </section>
  {/if}
</div>

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
  .refresh {
    display: flex;
    align-items: center;
    gap: 10px;
  }
</style>
