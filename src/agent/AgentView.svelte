<script lang="ts">
  import { onMount } from 'svelte';
  import Composer from './Composer.svelte';
  import Markdown from './Markdown.svelte';
  import RequestCard from './RequestCard.svelte';
  import ToolLine from './ToolLine.svelte';
  import { agents, answer, interrupt, send, setMode, setModel } from './agent.svelte';
  import { getActiveKey, queuePrompt } from '../terminal/manager';
  import { providerName } from '../lib/agents';
  import { appState } from '../lib/stores.svelte';
  import type { AgentProvider, TabKey } from '../types';

  /** `queued`: a message waiting for the turn to end (the tab's queue, shared with the Open view). */
  let { tabKey, provider, queued, onTerminal }: { tabKey: TabKey; provider: AgentProvider; queued: string | null; onTerminal: () => void } = $props();

  const name = $derived(providerName(provider));
  const s = $derived(agents[tabKey]);
  const items = $derived(s?.items ?? []);
  const request = $derived(s?.requests[0]);
  // The CLI reports the full model id; the picker lists aliases that resolve to one.
  const model = $derived(s ? (s.models.find((m) => m.id === s.model || m.resolved === s.model)?.id ?? s.model ?? s.models[0]?.id ?? '') : '');
  const MODES: Record<string, string> = { default: 'Ask first', acceptEdits: 'Accept edits', plan: 'Plan', auto: 'Auto', bypassPermissions: 'Bypass', dontAsk: "Don't ask" };

  // The turn timer, ticking only while the agent works.
  let now = $state(Date.now());
  $effect(() => {
    if (!s?.working) return;
    now = Date.now();
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const clock = (ms: number) => {
    const sec = Math.max(0, Math.round(ms / 1000));
    return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
  };
  const status = $derived(
    !s ? '' : s.exited ? `${name} has stopped` : request ? 'Waiting for you' : s.working ? `Working ${clock(now - s.since)}` : s.ready ? 'Ready' : `Starting ${name}`,
  );

  // Follow the end unless the user has scrolled up. On any resize, not on new items: text
  // streams into an item without adding one, and the request card shrinks the list.
  let list = $state<HTMLDivElement>();
  let stuck = true;
  $effect(() => {
    const el = list;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stuck) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    ro.observe(el.firstElementChild!);
    return () => ro.disconnect();
  });
  onMount(() => {
    if (getActiveKey() === tabKey) (list?.parentElement?.querySelector('textarea') as HTMLTextAreaElement | null)?.focus();
  });

  const turnText = (ms?: number, cost?: number) =>
    [ms ? `Worked ${clock(ms)}` : '', cost ? `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}` : ''].filter(Boolean).join(', ');
</script>

<div
  class="agent"
  style:--mono={appState.settings?.terminal.fontFamily}
  style:--mono-size="{appState.settings?.terminal.fontSize ?? 13}px"
>
  <div class="list" bind:this={list} onscroll={(e) => (stuck = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
    <div class="column">
      {#if s?.ready && !items.length}
        <p class="empty">Ask {name} anything. Type {provider === 'claude' ? '/' : '$'} to see {provider === 'claude' ? 'commands and skills' : 'skills'}.</p>
      {/if}
      {#each items as it (it.id)}
        <div class="item {it.kind}" class:sub={!!it.parent}>
          {#if it.kind === 'user'}
            <div class="you">{it.text}</div>
          {:else if it.kind === 'assistant'}
            {#if it.text}<Markdown text={it.text} />{/if}
          {:else if it.kind === 'thinking'}
            {#if it.text}<details class="thinking"><summary>{it.text.trim().split('\n')[0]}</summary><Markdown text={it.text} /></details>{/if}
          {:else if it.kind === 'tool'}
            <ToolLine item={it} live={!s?.exited} />
          {:else if it.kind === 'turn'}
            <div class="turn">{turnText(it.durationMs, it.costUsd)}</div>
          {:else}
            <p class="notice" class:error={it.error}>{it.text}</p>
          {/if}
        </div>
      {/each}
      {#if s?.working && !request}<div class="working"><span class="pulse" aria-hidden="true"></span>{status}</div>{/if}
    </div>
  </div>

  <div class="bottom">
    {#if request && s}
      {#key request.id}
        <RequestCard {request} {name} onAnswer={(a) => answer(tabKey, request.id, a)} />
      {/key}
      {#if s.requests.length > 1}<p class="more">{s.requests.length - 1} more waiting</p>{/if}
    {/if}
    {#if queued}
      <p class="queued">
        <span>Sends when {name} finishes: {queued}</span>
        <button class="link" onclick={() => queuePrompt(tabKey, null)}>Cancel</button>
      </p>
    {/if}
    <Composer
      {name}
      sigil={provider === 'claude' ? '/' : '$'}
      commands={s?.commands ?? []}
      working={!!s?.working}
      disabled={!s || s.exited}
      onSend={(text) => send(tabKey, text)}
      onStop={() => interrupt(tabKey)}
    />
    <div class="footer">
      {#if s?.models.length}
        <select aria-label="Model" value={model} onchange={(e) => setModel(tabKey, e.currentTarget.value)}>
          {#if model && !s.models.some((m) => m.id === model)}<option value={model}>{model}</option>{/if}
          {#each s.models as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
        </select>
      {/if}
      {#if s?.modes.length}
        <select aria-label="Permission mode" value={s.mode ?? 'default'} onchange={(e) => setMode(tabKey, e.currentTarget.value)}>
          {#each s.modes as m (m)}<option value={m}>{MODES[m] ?? m}</option>{/each}
        </select>
      {/if}
      <span class="status" class:waiting={!!request}>{status}</span>
      <button class="link" onclick={onTerminal} title="Close this view and resume the session in a terminal">Open in terminal</button>
    </div>
  </div>
</div>

<style>
  .agent {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    font-size: 13px;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 18px 24px 8px;
  }
  .column {
    max-width: 100ch;
  }
  .item {
    content-visibility: auto;
    contain-intrinsic-size: auto 24px;
  }
  .item.user,
  .item.assistant,
  .item.thinking {
    margin: 10px 0;
  }
  .item.tool + .item:not(.tool) {
    margin-top: 10px;
  }
  .item.assistant,
  .item.thinking {
    max-width: 76ch;
  }
  .item.sub {
    margin-left: 3ch;
    padding-left: 1ch;
    border-left: 1px solid var(--border);
  }
  .you {
    background: var(--bg-surface);
    color: var(--fg-bright);
    border-left: 2px solid var(--accent);
    padding: 6px 10px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.5;
  }
  .thinking {
    color: var(--fg-faint);
    font-style: italic;
  }
  .thinking summary {
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .turn {
    display: flex;
    align-items: center;
    gap: 1ch;
    margin: 14px 0;
    color: var(--fg-faint);
    font-size: 12px;
  }
  .turn::before,
  .turn::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--border);
  }
  .turn:empty::after {
    display: none;
  }
  .notice,
  .empty,
  .more {
    color: var(--fg-faint);
    margin: 8px 0;
  }
  .notice.error {
    color: var(--danger);
  }
  .empty {
    color: var(--fg-dim);
  }
  .working {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0;
    color: var(--fg-dim);
    font-size: 12px;
  }
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  .bottom {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 24px 10px;
    border-top: 1px solid var(--border);
    max-width: calc(100ch + 48px);
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--fg-faint);
  }
  select {
    font: inherit;
    color: var(--fg-dim);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 2px 4px;
    cursor: pointer;
  }
  select:hover,
  select:focus-visible {
    border-color: var(--border);
    outline: none;
  }
  .status {
    flex: 1;
  }
  .queued {
    display: flex;
    gap: 1ch;
    margin: 0;
    font-size: 12px;
    color: var(--fg-dim);
  }
  .queued span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status.waiting {
    color: var(--warn);
  }
  .link {
    all: unset;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .link:hover {
    color: var(--fg-bright);
    text-decoration: underline;
  }
  .link:focus-visible {
    outline: 1px solid var(--accent);
  }
</style>
