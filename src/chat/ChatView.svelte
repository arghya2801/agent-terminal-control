<script lang="ts">
  import { onMount } from 'svelte';
  import Markdown from './Markdown.svelte';
  import ToolLine from './ToolLine.svelte';
  import { chatOf, follow } from './transcript.svelte';
  import { pendingCall } from './merge';
  import { getActiveKey, interrupt, sendText, setView } from '../terminal/manager';
  import { providerName } from '../lib/agents';
  import { appState } from '../lib/stores.svelte';
  import type { TabMark } from '../lib/format';
  import type { AgentProvider, TabKey } from '../types';

  let { tabKey, provider, file, mark }: { tabKey: TabKey; provider: AgentProvider; file: string | null; mark: TabMark } = $props();

  const name = $derived(providerName(provider));
  $effect(() => {
    if (file) follow(provider, file);
  });
  const chat = $derived(file ? chatOf(file) : undefined);
  const items = $derived(chat?.items ?? []);
  const exited = $derived(mark === 'exited');
  // A call with no result while the agent sits idle is a prompt in the TUI: a permission,
  // a question or a plan. Only the terminal can answer it.
  const waiting = $derived(mark === 'idle' || mark === 'attention' ? pendingCall(items) : null);
  const asks = $derived(
    waiting?.tool === 'AskUserQuestion' ? `${name} is asking you a question`
    : waiting?.tool === 'ExitPlanMode' ? `${name} has a plan for you to approve`
    : `${name} wants to run ${waiting?.tool}`,
  );

  let draft = $state('');
  let list = $state<HTMLDivElement>();
  let box = $state<HTMLTextAreaElement>();
  // Follow new items unless the user has scrolled up to read. On any resize, not on new
  // items: offscreen items lay out late (content-visibility), and the waiting dock shrinks
  // the list when it opens.
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
    if (getActiveKey() === tabKey) box?.focus();
  });

  function send() {
    const text = draft.trim();
    if (!text || exited) return;
    sendText(tabKey, text);
    draft = '';
    stuck = true;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }
  function worked(ms: number): string {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }
  const firstLine = (s = '') => s.trim().split('\n')[0];
</script>

<div
  class="chat"
  style:--mono={appState.settings?.terminal.fontFamily}
  style:--mono-size="{appState.settings?.terminal.fontSize ?? 13}px"
>
  <div class="list" bind:this={list} onscroll={(e) => (stuck = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
    <div class="column">
      {#if !file}
        <p class="empty">Waiting for {name} to start. The terminal shows what it's doing (Ctrl+`).</p>
      {:else if chat?.error}
        <p class="empty">Can't read this transcript: {chat.error}. The terminal still works (Ctrl+`).</p>
      {:else if chat?.loaded && !items.length}
        <p class="empty">No messages yet. Type below to start.</p>
      {/if}
      {#if chat?.dropped}<p class="notice">Showing the last {items.length} items. The terminal has the rest.</p>{/if}
      {#each items as it, i (i)}
        <div class="item {it.kind}">
          {#if it.kind === 'user'}
            <div class="you">{it.text}</div>
          {:else if it.kind === 'assistant'}
            <Markdown text={it.text ?? ''} />
          {:else if it.kind === 'thinking'}
            <details class="thinking"><summary>{firstLine(it.text)}</summary><Markdown text={it.text ?? ''} /></details>
          {:else if it.kind === 'tool'}
            <ToolLine item={it} />
          {:else if it.kind === 'turn'}
            <div class="turn">{it.durationMs ? `Worked ${worked(it.durationMs)}` : ''}</div>
          {:else if it.kind === 'notice'}
            <p class="notice">{it.text}</p>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  {#if waiting}
    <div class="dock" role="status">
      <p class="asks">{asks}</p>
      {#if waiting.tool === 'ExitPlanMode'}
        <div class="plan"><Markdown text={waiting.body ?? ''} /></div>
      {:else}
        <pre>{waiting.tool === 'Bash' || waiting.tool === 'AskUserQuestion' ? waiting.body : waiting.input}</pre>
      {/if}
      <button class="btn" onclick={() => setView(tabKey, 'terminal')}>Answer in terminal <kbd>Ctrl+`</kbd></button>
    </div>
  {/if}

  {#if exited}
    <div class="composer ended">
      <span>{name} exited. Reopen the session from the sidebar.</span>
      <button class="btn" onclick={() => setView(tabKey, 'terminal')}>Show terminal</button>
    </div>
  {:else}
    <div class="composer">
      <textarea bind:this={box} bind:value={draft} onkeydown={onKey} rows="1" placeholder="Message {name}" aria-label="Message {name}"></textarea>
      {#if mark === 'working'}<button class="btn" onclick={() => interrupt(tabKey)} title="Stop the turn (Esc in the terminal)">Stop</button>{/if}
      <button class="btn primary" onclick={send} disabled={!draft.trim()}>Send</button>
    </div>
  {/if}
</div>

<style>
  .chat {
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
    padding: 16px 20px 8px;
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
  .item.user + .item,
  .item.tool + .item:not(.tool) {
    margin-top: 10px;
  }
  .item.assistant,
  .item.thinking {
    max-width: 72ch;
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
  .thinking[open] summary {
    margin-bottom: 4px;
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
  .empty {
    color: var(--fg-faint);
    margin: 8px 0;
  }
  .empty {
    color: var(--fg-dim);
  }
  .dock {
    margin: 0 20px 8px;
    padding: 8px 12px 10px;
    border-left: 3px solid var(--warn);
    background: var(--bg-chrome);
    max-width: calc(100ch - 15px);
    animation: dock-in var(--enter) var(--ease-out);
  }
  @keyframes dock-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  .asks {
    margin: 0 0 6px;
    color: var(--fg-bright);
    font-weight: 600;
  }
  .dock pre {
    margin: 0 0 8px;
    max-height: 10em;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: var(--mono-size);
    color: var(--fg);
  }
  .plan {
    max-height: 16em;
    overflow: auto;
    margin-bottom: 8px;
  }
  kbd {
    font: inherit;
    font-size: 11px;
    color: var(--fg-dim);
    margin-left: 6px;
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 8px 20px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
  .composer.ended {
    align-items: center;
    justify-content: space-between;
    color: var(--fg-dim);
  }
  textarea {
    flex: 1;
    field-sizing: content;
    min-height: 1.5em;
    max-height: 40vh;
    resize: none;
    font-family: var(--mono);
    font-size: var(--mono-size);
    line-height: 1.5;
    color: var(--fg-bright);
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
  }
  textarea:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .btn {
    font: inherit;
    color: var(--fg);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 12px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .btn:focus-visible {
    outline: 1px solid var(--accent);
  }
  .btn.primary {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: var(--on-accent);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
