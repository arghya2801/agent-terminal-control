<script lang="ts">
  import { onMount, tick } from 'svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import Highlight from '../lib/Highlight.svelte';
  import Icon from '../lib/Icon.svelte';
  import { changesText, markTitle, relativeTime, sparkPath, tabMark } from '../lib/format';
  import type { GitChanges } from '../lib/ipc';
  import { providerName } from '../lib/agents';
  import StatusDot from '../lib/StatusDot.svelte';
  import { appState } from '../lib/stores.svelte';
  import { isWaiting, peekLine, stateWord, triageGroup, triageOrder } from '../lib/triage';
  import { activate, focusActiveTerminal, markDone, outputHistory, queuePrompt, screenLines, sendText } from '../terminal/manager';
  import type { TabKey, TabSummary } from '../types';

  /** The sidebar's Open view: every tab, most urgent first, under a heading per state (#132). */
  let { tabs, activeKey, query, contextFill, changes, onClose }: {
    tabs: TabSummary[];
    activeKey: TabKey | null;
    query: string;
    /** How full each agent tab's context window is, 0..1. */
    contextFill: Map<TabKey, number>;
    /** What each tab's agent has changed in its working tree; null outside git. */
    changes: Record<TabKey, GitChanges | null>;
    /** Asks first when something is still running in the tab. */
    onClose: (key: TabKey) => void;
  } = $props();

  // Screen text and output history are read on this tick rather than on every chunk.
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 5_000);
    return () => clearInterval(timer);
  });

  const peekRows = $derived(appState.settings?.ui.peek ?? 'all');
  const graph = $derived(appState.settings?.ui.outputGraph !== false);

  const projectName = (key: string | null) => (key ? appState.index.projects.find((p) => p.key === key)?.name ?? '' : '');

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const hits = q ? tabs.filter((t) => `${t.title} ${projectName(t.projectKey)}`.toLowerCase().includes(q)) : tabs;
    return triageOrder(hits.map((t) => ({ ...t, mark: tabMark(t), group: triageGroup(tabMark(t), t.done) })));
  });

  // --- queue: a message for a working agent, typed in when it stops (#158).
  let queuing = $state<TabKey | null>(null);
  let draft = $state('');
  export async function startQueue(key: TabKey) {
    queuing = key;
    draft = tabs.find((t) => t.key === key)?.queued ?? '';
    await tick();
    document.getElementById(`queue-${key}`)?.focus();
  }
  function saveQueue(e: SubmitEvent) {
    e.preventDefault();
    if (queuing) queuePrompt(queuing, draft);
    queuing = null;
    // After the Enter's keypress, or the tab on screen gets an Enter too.
    setTimeout(focusActiveTerminal);
  }

  // --- broadcast: Ctrl+click picks tabs, the bar below types into all of them.
  let picked = $state(new Set<TabKey>());
  let line = $state('');
  const live = $derived([...picked].filter((k) => tabs.some((t) => t.key === k && !t.exited)));
  function pick(e: MouseEvent, key: TabKey) {
    if (!e.ctrlKey) {
      picked = new Set();
      activate(key);
      return;
    }
    const next = new Set(picked);
    if (!next.delete(key)) next.add(key);
    picked = next;
  }
  function broadcast(e: SubmitEvent) {
    e.preventDefault();
    if (!line.trim()) return;
    for (const k of live) sendText(k, line);
    line = '';
  }
</script>

{#if tabs.length === 0}
  <div class="hint">No tabs open.</div>
{:else if shown.length === 0}
  <div class="hint">Nothing matches “{query.trim()}”.</div>
{/if}
{#each shown as tab, i (tab.key)}
  {@const s = markTitle(tab.mark, providerName(tab.provider ?? 'claude'))}
  {@const wait = isWaiting(tab.mark) && !tab.done}
  {@const fill = contextFill.get(tab.key)}
  {@const showPeek = peekRows === 'all' || (peekRows === 'waiting' && wait)}
  {@const peek = showPeek ? peekLine((void now, screenLines(tab.key)), wait ? 3 : 1) : null}
  {#if i === 0 || shown[i - 1].group !== tab.group}
    <div class="section">{tab.group} <span class="n">{shown.filter((t) => t.group === tab.group).length}</span></div>
  {/if}
  <div class="item">
  <button
    class="row {tab.mark}"
    class:wait
    class:active={tab.key === activeKey}
    class:picked={picked.has(tab.key)}
    class:exited={tab.exited}
    data-row
    data-tab-key={tab.key}
    tabindex="-1"
    onclick={(e) => pick(e, tab.key)}
    onmousedown={(e) => { if (e.button === 1) e.preventDefault(); }}
    onauxclick={(e) => { if (e.button === 1) onClose(tab.key); }}
    title={[`${tab.title} · ${s}`, changes[tab.key] && changesText(changes[tab.key]!), '(Ctrl+click to pick for broadcast, middle-click to close)'].filter(Boolean).join('\n')}
  >
    <StatusDot mark={tab.mark} title={s} />
    <span class="icon">{#if tab.provider}<ProviderIcon provider={tab.provider} />{:else}<Icon name="terminal" size={12} />{/if}</span>
    <span class="text"><Highlight text={tab.title} {query} />{#if projectName(tab.projectKey)}<small><Highlight text={projectName(tab.projectKey)} {query} /></small>{/if}</span>
    <time>{stateWord(tab.mark)} {relativeTime(tab.since, now)}{#if fill !== undefined}<span class="ctx" class:full={fill >= 0.8} title="Context window {Math.round(fill * 100)}% full">{Math.round(fill * 100)}%</span>{/if}</time>
    {#if peek}<span class="peek">{peek}</span>{/if}
    {#if !wait && graph}<svg class="spark" viewBox="0 0 60 10" preserveAspectRatio="none" aria-hidden="true"><path d={sparkPath((void now, outputHistory(tab.key)))} /></svg>{/if}
  </button>
  {#if wait && !tab.exited}
    <button class="hover-btn" onclick={() => markDone(tab.key)} aria-label="Mark {tab.title} done" title="Done: move it out of Waiting on you until it works again"><Icon name="check" size={12} /></button>
  {:else if tab.mark === 'working' && queuing !== tab.key}
    <button class="hover-btn" onclick={() => startQueue(tab.key)} aria-label="Queue a message for {tab.title}" title="Type the next message; it is sent when the agent stops">Queue</button>
  {/if}
  </div>
  {#if queuing === tab.key}
    <form class="queue" onsubmit={saveQueue}>
      <input
        id="queue-{tab.key}"
        bind:value={draft}
        placeholder="Sent when {tab.provider ? providerName(tab.provider) : 'it'} stops, Enter to queue"
        aria-label="Queue a message for {tab.title}"
        spellcheck="false"
        autocomplete="off"
        onkeydown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); queuing = null; focusActiveTerminal(); } }}
        onblur={() => (queuing = null)}
      />
    </form>
  {:else if tab.queued}
    <div class="queued">
      <span title={tab.queued}>Next: {tab.queued}</span>
      <button onclick={() => startQueue(tab.key)} aria-label="Edit the queued message" title="Edit"><Icon name="pencil" size={11} /></button>
      <button onclick={() => queuePrompt(tab.key, null)} aria-label="Cancel the queued message" title="Cancel"><Icon name="close" size={11} /></button>
    </div>
  {/if}
{/each}

{#if live.length > 0}
  <form class="broadcast" onsubmit={broadcast}>
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={line} placeholder="Send to {live.length} tab{live.length === 1 ? '' : 's'}, Enter to send" aria-label="Broadcast" spellcheck="false" autocomplete="off" autofocus />
    <button type="button" onclick={() => (picked = new Set())} aria-label="Clear the picked tabs" title="Clear the picked tabs"><Icon name="close" size={12} /></button>
  </form>
{/if}

<style>
  .hint {
    padding: 10px 12px;
    color: var(--fg-faint);
    font-size: 11px;
  }
  .section {
    padding: 10px 10px 4px;
    color: var(--fg-faint);
    font-size: 11px;
  }
  .section .n {
    margin-left: 2px;
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: grid;
    grid-template-columns: 10px 16px minmax(0, 1fr) auto;
    column-gap: 6px;
    row-gap: 1px;
    align-items: center;
    width: 100%;
    padding: 5px 10px;
    border: none;
    background: transparent;
    color: var(--fg-dim);
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .row.active {
    background: color-mix(in srgb, var(--accent-strong) 16%, transparent);
    color: var(--fg-bright);
  }
  .row.picked {
    box-shadow: inset 3px 0 0 var(--warn);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
  .row.exited .text {
    opacity: 0.6;
    text-decoration: line-through;
  }
  .icon {
    display: grid;
    place-items: center;
    color: var(--fg-faint);
  }
  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  small {
    margin-left: 6px;
    color: var(--fg-faint);
    font-size: 11px;
  }
  time {
    color: var(--fg-faint);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .attention time {
    color: var(--accent);
  }
  .ctx {
    margin-left: 6px;
    color: var(--fg-faint);
  }
  .ctx.full {
    color: var(--warn);
  }
  .peek {
    grid-column: 3 / 4;
    min-width: 0;
    overflow: hidden;
    color: var(--fg-faint);
    font-family: ui-monospace, monospace;
    font-size: 10px;
    line-height: 1.4;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* A waiting agent's question gets the row's full width and its last three lines: the
     text sits at the bottom of the box and any overflow is cut off the top. */
  .wait .peek {
    display: flex;
    max-height: 4.2em;
    flex-direction: column;
    justify-content: flex-end;
    grid-column: 3 / 5;
    white-space: normal;
  }
  .attention .peek {
    color: var(--fg);
  }
  .spark {
    grid-column: 4;
    grid-row: 2;
    justify-self: end;
    width: 60px;
    height: 10px;
    stroke: var(--fg-faint);
    stroke-width: 1.5;
  }
  .working .spark {
    stroke: var(--warn);
  }
  .item {
    position: relative;
  }
  .hover-btn {
    position: absolute;
    top: 3px;
    right: 6px;
    display: grid;
    place-items: center;
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg-chrome);
    color: var(--fg-dim);
    font: inherit;
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
    opacity: 0;
  }
  .item:hover .hover-btn,
  .hover-btn:focus-visible {
    opacity: 1;
  }
  .hover-btn:hover {
    border-color: var(--accent);
    color: var(--fg-bright);
  }
  .queue {
    padding: 0 10px 6px 42px;
  }
  .queued {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 10px 6px 42px;
    color: var(--accent);
    font-size: 11px;
  }
  .queued span {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .queued button {
    display: grid;
    place-items: center;
    padding: 2px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-faint);
    cursor: pointer;
  }
  .queued button:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
  }
  input:focus {
    border-color: var(--accent);
    outline: none;
  }
  .broadcast {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 4px;
    padding: 6px 8px;
    border-top: 1px solid var(--warn);
    background: var(--bg-chrome);
  }
  .broadcast button {
    display: grid;
    place-items: center;
    border: none;
    background: transparent;
    color: var(--fg-faint);
    cursor: pointer;
  }
  .broadcast button:hover {
    color: var(--fg-bright);
  }
</style>
