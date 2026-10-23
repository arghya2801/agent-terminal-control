<script lang="ts">
  import Icon from '../lib/Icon.svelte';
  import { formatTokens, monetary, type SpendSummary } from '../lib/costs';

  /** The range's spend by project (with its sessions), by model, or by session. */
  let { summary, metric, sessionName }: {
    summary: SpendSummary;
    metric: 'tokens' | 'cost';
    sessionName: (id: string) => string;
  } = $props();

  let groupBy = $state<'project' | 'model' | 'session'>('project');
  /** Project keys whose sessions are shown. */
  let expanded = $state<Set<string>>(new Set());
  const ranked = <T extends { tokens: number; cost: number }>(list: T[]) => [...list].sort((a, b) => b[metric] - a[metric]);
  const total = $derived(metric === 'tokens' ? summary.tokens : summary.total);
  const share = (v: { tokens: number; cost: number }) => (total ? (v[metric] / total) * 100 : 0);

  function toggleProject(key: string) {
    const next = new Set(expanded);
    if (!next.delete(key)) next.add(key);
    expanded = next;
  }
</script>

<h2 id="u-breakdown">Breakdown</h2>
<div class="group">
  <button class="btn" class:primary={groupBy === 'project'} onclick={() => (groupBy = 'project')}>By project</button>
  <button class="btn" class:primary={groupBy === 'model'} onclick={() => (groupBy = 'model')}>By model</button>
  <button class="btn" class:primary={groupBy === 'session'} onclick={() => (groupBy = 'session')}>By session</button>
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
      {#each ranked(summary.bySession) as s (s.key)}
        <tr>
          <td title={s.key}>{sessionName(s.key)}</td>
          <td class="num">{formatTokens(s.tokens)}</td>
          <td class="num">{monetary(s)}</td>
          <td class="share"><div class="meter small"><div class="fill" style="width: {share(s)}%"></div></div></td>
        </tr>
      {:else}
        <tr><td colspan="4" class="muted">No usage in this range.</td></tr>
      {/each}
    {:else if groupBy === 'model'}
      {#each ranked(summary.byModel) as m (m.key)}
        <tr>
          <td>{m.key.startsWith('codex:') ? 'Codex' : 'Claude'} · {m.key.slice(m.key.indexOf(':') + 1)}</td>
          <td class="num">{formatTokens(m.tokens)}</td>
          <td class="num">{monetary(m)}</td>
          <td class="share"><div class="meter small"><div class="fill" style="width: {share(m)}%"></div></div></td>
        </tr>
      {:else}
        <tr><td colspan="4" class="muted">No usage in this range.</td></tr>
      {/each}
    {:else}
      {#each ranked(summary.byProject) as p (p.key)}
        {@const sessions = ranked(summary.sessionsByProject.get(p.key) ?? [])}
        <tr>
          <td>
            <button class="expand" onclick={() => toggleProject(p.key)} aria-expanded={expanded.has(p.key)}>
              <span class="twisty" class:open={expanded.has(p.key)}><Icon name="chevron" size={12} /></span>{p.name}
              <span class="muted">{sessions.length} session{sessions.length === 1 ? '' : 's'}</span>
            </button>
          </td>
          <td class="num">{formatTokens(p.tokens)}</td>
          <td class="num">{monetary(p)}</td>
          <td class="share"><div class="meter small"><div class="fill" style="width: {share(p)}%"></div></div></td>
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

<style>
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
    color: var(--fg-faint);
    transition: transform var(--fast) var(--ease-out);
  }
  .twisty.open {
    transform: rotate(90deg);
  }
  tr.session {
    animation: atc-rise var(--enter) var(--ease-out);
  }
  tr.session td:first-child {
    padding-left: 26px;
    color: var(--fg-dim);
  }
  .share {
    width: 120px;
  }
</style>
