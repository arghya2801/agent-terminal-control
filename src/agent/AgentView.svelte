<script lang="ts">
  import { onMount } from 'svelte';
  import Composer from './Composer.svelte';
  import Markdown from './Markdown.svelte';
  import RequestCard from './RequestCard.svelte';
  import ToolLine, { toolStatus } from './ToolLine.svelte';
  import Icon from '../lib/Icon.svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import { agents, answer, interrupt, send, setMode, setModel } from './agent.svelte';
  import { activity, blocks, summarize, type Block } from './work';
  import { getActiveKey, queuePrompt } from '../terminal/manager';
  import { providerName } from '../lib/agents';
  import { appState } from '../lib/stores.svelte';
  import type { ChatItem } from '../../sidecar/protocol';
  import type { AgentProvider, TabKey } from '../types';

  /** `queued`: a message waiting for the turn to end (the tab's queue, shared with the Open view). */
  let { tabKey, provider, cwd, queued, onTerminal }: { tabKey: TabKey; provider: AgentProvider; cwd: string | null; queued: string | null; onTerminal: () => void } = $props();

  const name = $derived(providerName(provider));
  const s = $derived(agents[tabKey]);
  const request = $derived(s?.requests[0]);
  const MODES: Record<string, string> = { default: 'Ask first', acceptEdits: 'Accept edits', plan: 'Plan', auto: 'Auto', bypassPermissions: 'Bypass', dontAsk: "Don't ask" };
  // The CLI reports the full model id; the picker lists aliases that resolve to one.
  const model = $derived(s ? (s.models.find((m) => m.id === s.model || m.resolved === s.model)?.id ?? s.model ?? s.models[0]?.id ?? '') : '');

  /** A prompt, then everything the agent did for it, then how the turn ended. */
  interface Turn { prompt: ChatItem | null; steps: ChatItem[]; end: ChatItem | null }
  const turns = $derived.by(() => {
    const out: Turn[] = [];
    for (const it of s?.items ?? []) {
      if (it.kind === 'user') {
        out.push({ prompt: it, steps: [], end: null });
        continue;
      }
      let t = out.at(-1);
      if (!t || t.end) out.push((t = { prompt: null, steps: [], end: null }));
      if (it.kind === 'turn') t.end = it;
      else t.steps.push(it);
    }
    return out;
  });
  const history = $derived(turns.flatMap((t) => (t.prompt?.text ? [t.prompt.text] : [])));

  /** Groups the user opened or closed; others follow `live`: the run being worked on stays
   *  open, and folds once something comes after it. */
  let opened = $state<Record<string, boolean>>({});
  const groupStatus = (b: Block & { kind: 'group' }) => {
    const all = b.items.map((it) => toolStatus(it, !s?.exited));
    return all.includes('running') ? 'running' : all.includes('failed') ? 'failed' : 'done';
  };

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
  const cost = (usd?: number) => (usd ? `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}` : '');
  const status = $derived(
    !s ? '' : s.exited ? 'Stopped' : request ? 'Waiting for you' : s.working ? `Working ${clock(now - s.since)}` : s.ready ? 'Ready' : 'Starting',
  );

  // Follow the end unless the user has scrolled up. On any resize, not on new items: text
  // streams into an item without adding one, and a request card shrinks the list.
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

  let copied = $state<string | null>(null);
  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    copied = id;
    setTimeout(() => copied === id && (copied = null), 1500);
  }
</script>

<div
  class="agent"
  style:--mono={appState.settings?.terminal.fontFamily}
  style:--mono-size="{Math.max(11, (appState.settings?.terminal.fontSize ?? 13) - 1)}px"
>
  <div class="list" bind:this={list} onscroll={(e) => (stuck = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
    <div class="column">
      {#if s?.ready && !turns.length}
        <div class="empty">
          <span class="mark"><ProviderIcon {provider} /></span>
          <p class="lead">Ask {name} anything</p>
          <p>Type <kbd>{provider === 'claude' ? '/' : '$'}</kbd> for {provider === 'claude' ? 'commands and skills' : 'skills'}. <kbd>Enter</kbd> sends, <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line.</p>
        </div>
      {:else if !s?.ready && !s?.exited && !turns.length}
        <div class="empty"><p class="lead">Starting {name}</p></div>
      {/if}

      {#each turns as turn, i (i)}
        {@const live = i === turns.length - 1 && !!s?.working}
        <section class="turn">
          {#if turn.prompt}<div class="prompt">{turn.prompt.text}</div>{/if}
          {#if turn.steps.length || turn.end || live}
            {@const all = blocks(turn.steps)}
            <div class="trail" class:live class:ended={!!turn.end}>
              {#each all as b, bi (b.kind === 'group' ? `g:${b.id}` : b.item.id)}
                {#if b.kind === 'group'}
                  {@const open = opened[b.id] ?? (live && bi === all.length - 1)}
                  <div class="step tool group {groupStatus(b)}" class:sub={!!b.items[0].parent}>
                    <button class="summary" aria-expanded={open} onclick={() => (opened[b.id] = !open)}>
                      <span>{summarize(b.items)}</span><span class="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
                    </button>
                    {#if open}
                      <div class="calls">
                        {#each b.items as it (it.id)}<ToolLine item={it} live={!s?.exited} {cwd} />{/each}
                      </div>
                    {/if}
                  </div>
                {:else}
                  {@const it = b.item}
                  {#if it.kind === 'tool'}
                    <div class="step tool {toolStatus(it, !s?.exited)}" class:sub={!!it.parent}><ToolLine item={it} live={!s?.exited} {cwd} /></div>
                  {:else if it.kind === 'assistant'}
                    {#if it.text}
                      <div class="step text" class:sub={!!it.parent}>
                        <Markdown text={it.text} />
                        <button class="copy" onclick={() => copy(it.text ?? '', it.id)} title="Copy as Markdown">{copied === it.id ? 'Copied' : 'Copy'}</button>
                      </div>
                    {/if}
                  {:else if it.kind === 'thinking'}
                    {#if it.text}<details class="step thinking" class:sub={!!it.parent}><summary>{it.text.trim().split('\n')[0]}</summary><Markdown text={it.text} /></details>{/if}
                  {:else}
                    <p class="step notice" class:error={it.error}>{it.text}</p>
                  {/if}
                {/if}
              {/each}
              {#if live && !request}<div class="step working"><span class="what">{activity(turn.steps, cwd)}</span><span class="secs">{clock(now - (s?.since ?? now))}</span></div>{/if}
              {#if turn.end}
                <div class="step end">
                  {#if turn.end.durationMs}<span>Worked {clock(turn.end.durationMs)}</span>{/if}
                  {#if turn.end.costUsd}<span>{cost(turn.end.costUsd)}</span>{/if}
                </div>
              {/if}
            </div>
          {/if}
        </section>
      {/each}
    </div>
  </div>

  <div class="dock">
    {#if request && s}
      {#key request.id}
        <RequestCard {request} {name} onAnswer={(a) => answer(tabKey, request.id, a)} />
      {/key}
      {#if s.requests.length > 1}<p class="aside">{s.requests.length - 1} more waiting</p>{/if}
    {/if}
    {#if queued}
      <p class="aside queued">
        <span>Sends when {name} finishes: {queued}</span>
        <button class="link" onclick={() => queuePrompt(tabKey, null)}>Cancel</button>
      </p>
    {/if}
    <Composer
      {name}
      {history}
      sigil={provider === 'claude' ? '/' : '$'}
      commands={s?.commands ?? []}
      working={!!s?.working}
      disabled={!s || s.exited}
      onSend={(text) => send(tabKey, text)}
      onStop={() => interrupt(tabKey)}
    >
      {#snippet toolbar()}
        {#if s?.models.length}
          <label class="chip" title="Model">
            <select aria-label="Model" value={model} onchange={(e) => setModel(tabKey, e.currentTarget.value)}>
              {#if model && !s.models.some((m) => m.id === model)}<option value={model}>{model}</option>{/if}
              {#each s.models as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
            </select>
          </label>
        {/if}
        {#if s?.modes.length}
          <label class="chip" class:plan={s.mode === 'plan'} title="Permission mode">
            <select aria-label="Permission mode" value={s.mode ?? 'default'} onchange={(e) => setMode(tabKey, e.currentTarget.value)}>
              {#each s.modes as m (m)}<option value={m}>{MODES[m] ?? m}</option>{/each}
            </select>
          </label>
        {/if}
        <span class="status" class:working={s?.working && !request} class:waiting={!!request}>{status}</span>
        <button class="icon" onclick={onTerminal} title="Open in terminal: resume this session in {name}'s own TUI" aria-label="Open in terminal"><Icon name="terminal" size={14} /></button>
      {/snippet}
    </Composer>
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
    font-size: 13.5px;
    line-height: 1.6;
    --rail: 18px;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 28px 24px 12px;
  }
  .column,
  .dock {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    box-sizing: border-box;
  }

  .empty {
    display: grid;
    justify-items: center;
    gap: 6px;
    margin-top: 18vh;
    text-align: center;
    color: var(--fg-dim);
  }
  .empty p {
    margin: 0;
  }
  .empty .mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 12px;
    background: var(--bg-surface);
    margin-bottom: 6px;
  }
  .lead {
    font-size: 16px;
    font-weight: 600;
    color: var(--fg-bright);
  }
  kbd {
    font: inherit;
    font-size: 12px;
    padding: 0 5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    color: var(--fg);
  }

  .turn + .turn {
    margin-top: 26px;
  }
  .prompt {
    width: fit-content;
    max-width: 100%;
    box-sizing: border-box;
    padding: 9px 14px;
    border-radius: 12px;
    background: var(--bg-surface);
    color: var(--fg-bright);
    font-size: 14px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* The rail: each turn's work hangs off one line, a light per tool call. */
  .trail {
    position: relative;
    margin: 12px 0 0 7px;
    padding-left: var(--rail);
  }
  .trail::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;
    border-radius: 1px;
    background: var(--border);
  }
  .trail.live::before {
    background: linear-gradient(to bottom, var(--border), color-mix(in srgb, var(--accent) 70%, transparent));
  }
  /* Whole turns skip layout offscreen. Not steps: the containment clips what a step draws
     outside its box, such as list numbers and the copy button. */
  .turn {
    content-visibility: auto;
    contain-intrinsic-size: auto 120px;
  }
  .step {
    position: relative;
  }
  .step + .step {
    margin-top: 6px;
  }
  .step.text + .step,
  .step + .step.text {
    margin-top: 10px;
  }
  .step.sub {
    margin-left: 14px;
    padding-left: 10px;
    border-left: 1px dashed var(--border);
  }
  .step.tool::before,
  .step.working::before,
  .step.end::before {
    content: '';
    position: absolute;
    left: calc(-1 * var(--rail) - 4px);
    top: 8px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--bg);
    border: 2px solid var(--fg-faint);
  }
  /* A subagent's calls sit on its own dashed line, with smaller lights. */
  .step.sub::before {
    left: -4px;
    top: 9px;
    width: 3px;
    height: 3px;
  }
  .step.tool.done::before {
    border-color: var(--ok);
    background: color-mix(in srgb, var(--ok) 35%, var(--bg));
  }
  .step.tool.failed::before {
    border-color: var(--danger);
    background: var(--danger);
  }
  .step.tool.running::before,
  .step.working::before {
    border-color: var(--accent);
    background: var(--accent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 22%, transparent);
    animation: beacon 1.4s ease-in-out infinite;
  }
  @keyframes beacon {
    50% {
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 10%, transparent);
    }
  }
  .step.text {
    max-width: 68ch;
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
    list-style: none;
  }
  .thinking summary::before {
    content: 'Thought: ';
    font-style: normal;
  }
  .notice {
    margin: 0;
    color: var(--fg-faint);
    font-size: 12.5px;
  }
  .notice.error {
    color: var(--danger);
  }
  .working {
    display: flex;
    gap: 1ch;
    color: var(--fg-dim);
    font-size: 12.5px;
  }
  .working .what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .working .secs {
    color: var(--fg-faint);
    font-variant-numeric: tabular-nums;
  }

  /* A run of calls, folded into one sentence. */
  .summary {
    all: unset;
    box-sizing: border-box;
    display: flex;
    gap: 1ch;
    align-items: baseline;
    width: 100%;
    padding: 2px 8px;
    margin-left: -8px;
    border-radius: 6px;
    color: var(--fg-dim);
    font-size: 12.5px;
    cursor: pointer;
  }
  .summary:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .summary:focus-visible {
    outline: 1px solid var(--accent);
  }
  .group.failed .summary {
    color: var(--danger);
  }
  .summary .chev {
    color: var(--fg-faint);
  }
  .calls {
    margin: 2px 0 2px;
    padding-left: 10px;
    border-left: 1px solid var(--border);
  }

  .step.text {
    position: relative;
  }
  .copy {
    position: absolute;
    top: -2px;
    right: -64px;
    font: inherit;
    font-size: 11px;
    color: var(--fg-faint);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 1px 8px;
    cursor: pointer;
    opacity: 0;
  }
  .step.text:hover .copy,
  .copy:focus-visible {
    opacity: 1;
  }
  .copy:hover {
    color: var(--fg-bright);
    border-color: var(--border);
  }
  .end {
    display: flex;
    gap: 14px;
    color: var(--fg-faint);
    font-size: 12px;
    padding-top: 2px;
  }
  .step.end::before {
    border-radius: 2px;
    border-color: var(--border);
    background: var(--border);
  }

  .dock {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 24px 16px;
    max-width: calc(760px + 48px);
  }
  .aside {
    display: flex;
    gap: 1ch;
    margin: 0 4px;
    font-size: 12px;
    color: var(--fg-dim);
  }
  .queued span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .link {
    all: unset;
    color: var(--accent);
    cursor: pointer;
  }
  .link:focus-visible {
    outline: 1px solid var(--accent);
  }

  /* Toolbar, inside the composer. */
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    border-radius: 7px;
    background: var(--bg-surface);
    color: var(--fg-dim);
  }
  .chip::after {
    content: '▾';
    position: absolute;
    right: 7px;
    pointer-events: none;
    font-size: 10px;
  }
  .chip:hover {
    color: var(--fg-bright);
  }
  .chip.plan {
    color: var(--info);
    background: color-mix(in srgb, var(--info) 14%, var(--bg-surface));
  }
  .chip select {
    appearance: none;
    font: inherit;
    font-size: 12px;
    color: inherit;
    background: transparent;
    border: none;
    padding: 3px 22px 3px 9px;
    cursor: pointer;
  }
  .chip select:focus-visible {
    outline: 1px solid var(--accent);
    border-radius: 7px;
  }
  .chip option {
    color: var(--fg);
    background: var(--bg-chrome);
  }
  .status {
    margin-left: 4px;
  }
  .status.working {
    color: var(--fg-dim);
  }
  .status.waiting {
    color: var(--warn);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .icon:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .icon:focus-visible {
    outline: 1px solid var(--accent);
  }
</style>
