<script lang="ts">
  import { onMount } from 'svelte';
  import Composer from './Composer.svelte';
  import Markdown from './Markdown.svelte';
  import RequestCard from './RequestCard.svelte';
  import ToolLine, { toolIcon, toolStatus } from './ToolLine.svelte';
  import ChipMenu, { type MenuSection } from './ChipMenu.svelte';
  import Icon from '../lib/Icon.svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import ConfirmDialog from '../lib/ConfirmDialog.svelte';
  import { agents, answer, catalog, interrupt, listFiles, resume, rewind, send, wake, setEffort, setMode, setModel, switchProvider } from './agent.svelte';
  import { activity, blocks, summarize, thoughtLine, type Block } from './work';
  import { families, keptEffort, versionOf } from './models';
  import { getActiveKey, queuePrompt } from '../terminal/manager';
  import { providerName } from '../lib/agents';
  import { appState } from '../lib/stores.svelte';
  import type { ChatItem, Model } from '../../sidecar/protocol';
  import type { AgentProvider, TabKey } from '../types';

  /** `queued`: a message waiting for the turn to end (the tab's queue, shared with the Open view). */
  let { tabKey, provider, cwd, queued, onTerminal }: { tabKey: TabKey; provider: AgentProvider; cwd: string | null; queued: string | null; onTerminal: () => void } = $props();

  const name = $derived(providerName(provider));
  const s = $derived(agents[tabKey]);
  const request = $derived(s?.requests[0]);
  const MODES: Record<string, string> = {
    default: 'Ask first',
    acceptEdits: 'Accept edits',
    plan: 'Plan',
    auto: 'Auto',
    bypassPermissions: 'Bypass',
    dontAsk: "Don't ask",
    'read-only': 'Read only',
    workspace: 'Auto',
    'full-access': 'Full access',
  };
  // The CLI reports the full model id; the picker lists aliases that resolve to one.
  // Claude's `default` alias is shown as the family it stands for, so prefer that alias.
  const model = $derived.by(() => {
    if (!s) return '';
    const exact = s.models.find((m) => m.id === s.model);
    const resolved = exact?.resolved ?? s.model;
    const named = s.models.find((m) => m.id !== 'default' && /^[a-z]+$/.test(m.id) && m.resolved === resolved);
    return (exact?.id === 'default' || !exact ? named?.id : exact.id) ?? exact?.id ?? s.model ?? s.models[0]?.id ?? '';
  });
  const current = $derived(s?.models.find((m) => m.id === model));
  const chipLabel = $derived(current?.label ?? model);

  // Until the first message the picker offers both providers' models; picking the other
  // provider's moves the tab to it. After that the conversation belongs to one CLI.
  const other = $derived<AgentProvider>(provider === 'claude' ? 'codex' : 'claude');
  let others = $state<Model[]>([]);
  $effect(() => {
    const p = other;
    if (!s?.fresh || !s.ready) return;
    catalog(p).then((m) => (others = m), () => (others = []));
  });
  function pick(value: string) {
    const at = value.indexOf(':');
    const [p, id] = [value.slice(0, at) as AgentProvider, value.slice(at + 1)];
    if (p !== provider) return switchProvider(tabKey, p, id);
    setModel(tabKey, id);
    // An effort the new model does not take would fail its next request.
    if (s && s.effort !== keptEffort(s.effort, s.models.find((m) => m.id === id))) setEffort(tabKey, null);
  }
  /** The picker: Claude, then Codex, one row per family (Opus, Sonnet, Sol...). A row picks
   *  the family's latest; its arrow lists the older versions. */
  const modelSections = $derived.by((): MenuSection[] => {
    const lists = { [provider]: s?.models ?? [], [other]: s?.fresh ? others : [] } as Record<AgentProvider, Model[]>;
    return (['claude', 'codex'] as const).filter((p) => lists[p].length).map((p) => ({
      title: providerName(p),
      icon: p === 'claude' ? claudeIcon : codexIcon,
      items: families(p, lists[p]).map((f) => ({
        value: `${p}:${f.latest.id}`,
        label: f.name,
        description: f.latest.description,
        badge: f.version,
        sub: f.older.map((o) => ({ value: `${p}:${o.id}`, label: o.label, description: o.description, badge: versionOf(p, o) })),
      })),
    }));
  });
  const MODE_HELP: Record<string, string> = {
    default: 'Asks before edits and commands',
    acceptEdits: 'Edits files without asking; asks before commands',
    plan: 'Reads and plans; changes nothing until you approve',
    auto: 'Approves safe actions itself and asks about the rest',
    bypassPermissions: 'Never asks',
    'read-only': 'Reads files; asks before editing or running anything',
    workspace: 'Edits and runs commands in the project; asks before going outside it',
    'full-access': 'Edits and runs anything, anywhere, without asking',
  };
  const EFFORTS: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
  const effortName = (e: string) => EFFORTS[e] ?? e;

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
    const all = b.items.filter((it) => !it.declined).map((it) => toolStatus(it, !s?.exited));
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
    !s || s.exited ? '' : request ? 'Waiting on you' : s.working || s.ready || s.dormant ? '' : 'Starting',
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

  let draft = $state('');
  // Names starting `__` are the CLI's own plumbing, not something to type.
  const commands = $derived([...(s?.commands ?? []).filter((c) => !c.name.startsWith('/__')), ...(s?.files ?? []).map((f) => ({ name: `@${f}`, description: '' }))]);
  const plan = $derived(s?.plan ?? []);
  const doneSteps = $derived(plan.filter((p) => p.status === 'done').length);
  let planOpen = $state(true);
  let rewinding = $state<ChatItem | null>(null);
  // Codex commands such as /undo start no turn, so there is nothing to go back to.
  const canRewind = (p: ChatItem) => !!s && !s.working && !s.exited && (provider === 'claude' || !!p.turn);

  let copied = $state<string | null>(null);
  async function copy(text: string, id: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    copied = id;
    setTimeout(() => copied === id && (copied = null), 1500);
  }
</script>

{#if rewinding}
  {@const p = rewinding}
  <ConfirmDialog
    confirmLabel="Rewind"
    onConfirm={() => {
      rewind(tabKey, p);
      draft = p.text ?? '';
      rewinding = null;
    }}
    onCancel={() => (rewinding = null)}
  >
    {#if provider === 'claude'}
      Rewind to before this message? Files Claude changed since then go back to how they were, and the conversation after it is dropped.
    {:else}
      Rewind to before this message? The conversation after it is dropped. Files stay as they are, since Codex can't undo its edits.
    {/if}
    The message goes back in the box.
  </ConfirmDialog>
{/if}

{#snippet claudeIcon()}<ProviderIcon provider="claude" />{/snippet}
{#snippet codexIcon()}<ProviderIcon provider="codex" />{/snippet}
{#snippet modelFooter()}
  {#if s && current?.efforts?.length}
    <div class="effort" role="group" aria-label="Reasoning effort">
      <span class="lbl">Effort{provider === 'codex' ? ', from the next message' : ''}</span>
      <div class="seg">
        <button class:on={!s.effort} onclick={() => setEffort(tabKey, null)} title="The model's own default">{current.defaultEffort ? `Default (${effortName(current.defaultEffort).toLowerCase()})` : 'Default'}</button>
        {#each current.efforts as e (e)}
          <button class:on={s.effort === e} onclick={() => setEffort(tabKey, e)}>{effortName(e)}</button>
        {/each}
      </div>
    </div>
  {/if}
  {#if s && !s.fresh}<p class="locked">This conversation stays on {name}. A new tab can use {providerName(other)}.</p>{/if}
{/snippet}

<div
  class="agent"
  style:--mono={appState.settings?.terminal.fontFamily}
  style:--mono-size="{Math.max(11, (appState.settings?.terminal.fontSize ?? 13) - 1)}px"
>
  <div class="list" bind:this={list} onscroll={(e) => (stuck = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
    <div class="column">
      {#if (s?.ready || s?.dormant) && !turns.length}
        <div class="empty">
          <span class="mark"><ProviderIcon {provider} /></span>
          <p class="lead">Ask {name} anything</p>
          <p>Type <kbd>/</kbd> for {provider === 'codex' ? 'commands, ' : 'commands and skills, '}{#if provider === 'codex'}<kbd>$</kbd> for skills, {/if}<kbd>@</kbd> for files. <kbd>Enter</kbd> sends, <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line.</p>
        </div>
      {:else if !s?.ready && !s?.dormant && !s?.exited && !turns.length}
        <div class="empty"><p class="lead">Starting {name}</p></div>
      {/if}

      {#each turns as turn, i (i)}
        {@const live = i === turns.length - 1 && !!s?.working}
        {@const reply = turn.steps.filter((x) => x.kind === 'assistant' && x.text && !x.parent).map((x) => x.text).join('\n\n')}
        <section class="turn">
          {#if turn.prompt}
            {@const p = turn.prompt}
            <div class="you">
              <div class="actions">
                {#if p.text}<button class="act" onclick={() => copy(p.text ?? '', p.id)} title="Copy message" aria-label="Copy message"><Icon name={copied === p.id ? 'check' : 'copy'} size={13} /></button>{/if}
                {#if canRewind(p)}<button class="act" onclick={() => (rewinding = p)} title="Go back to before this message"><Icon name="rewind" size={13} /><span>Rewind</span></button>{/if}
              </div>
              <div class="bubble">
                {#if p.images?.length}
                  <div class="pics">{#each p.images as src, k (k)}<img {src} alt="Sent with the message" />{/each}</div>
                {/if}
                {#if p.text}<div class="said">{p.text}</div>{/if}
              </div>
            </div>
          {/if}
          {#if turn.steps.length || turn.end || live}
            {@const all = blocks(turn.steps)}
            <div class="work">
              {#each all as b, bi (b.kind === 'group' ? `g:${b.id}` : b.item.id)}
                {#if b.kind === 'group'}
                  {@const open = opened[b.id] ?? (live && bi === all.length - 1)}
                  {@const st = groupStatus(b)}
                  {@const failed = b.items.filter((x) => x.done && x.error && !x.declined).length}
                  {@const declined = b.items.filter((x) => x.declined).length}
                  <div class="step group {st}" class:sub={!!b.items[0].parent}>
                    <button class="row" aria-expanded={open} onclick={() => (opened[b.id] = !open)}>
                      <span class="icon"><Icon name={toolIcon(b.items[0].tool)} size={14} /></span>
                      <span class="what">{summarize(b.items)}</span>
                      <span class="chev" class:turned={open} aria-hidden="true"><Icon name="chevron" size={12} /></span>
                      {#if failed}<span class="badge">{failed} failed</span>{:else if declined}<span class="badge declined">{declined} declined</span>{/if}
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
                    <div class="step tool" class:sub={!!it.parent}><ToolLine item={it} live={!s?.exited} {cwd} /></div>
                  {:else if it.kind === 'assistant'}
                    {#if it.text}<div class="step text" class:sub={!!it.parent}><Markdown text={it.text} /></div>{/if}
                  {:else if it.kind === 'thinking'}
                    {#if it.text}
                      <details class="step thinking" class:sub={!!it.parent}>
                        <summary class="row">
                          <span class="icon"><Icon name="sparkle" size={14} /></span>
                          <span class="what">{thoughtLine(it.text) || 'Thought'}</span>
                          <span class="chev" aria-hidden="true"><Icon name="chevron" size={12} /></span>
                        </summary>
                        <div class="thought"><Markdown text={it.text} /></div>
                      </details>
                    {/if}
                  {:else if it.error}
                    <p class="step alert"><Icon name="alert" size={14} /><span>{it.text}</span></p>
                  {:else}
                    <p class="step notice" class:long={(it.text ?? '').length > 90 || !!it.text?.includes('\n')}><span>{it.text}</span></p>
                  {/if}
                {/if}
              {/each}
              {#if live && !request}
                <div class="step live">
                  <span class="icon"><span class="spinner"></span></span>
                  <span class="shimmer">{turn.steps.at(-1)?.kind === 'tool' && !turn.steps.at(-1)?.done ? 'Working' : activity(turn.steps, cwd)}</span>
                  <span class="secs">{clock(now - (s?.since ?? now))}</span>
                </div>
              {/if}
              {#if !live && (turn.end || reply)}
                <div class="end" class:bare={!turn.end?.durationMs && !turn.end?.costUsd}>
                  {#if turn.end?.durationMs}<span>Worked for {clock(turn.end.durationMs)}</span>{/if}
                  {#if turn.end?.costUsd}<span>{cost(turn.end.costUsd)}</span>{/if}
                  {#if reply}<button class="act" onclick={() => copy(reply, `r${i}`)} title="Copy the reply as Markdown"><Icon name={copied === `r${i}` ? 'check' : 'copy'} size={13} /><span>{copied === `r${i}` ? 'Copied' : 'Copy'}</span></button>{/if}
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
    {#if doneSteps < plan.length}
      <div class="tasks">
        <button class="head" aria-expanded={planOpen && !request} onclick={() => (planOpen = !planOpen)}>
          <span class="icon"><Icon name="list" size={14} /></span>
          <span>{doneSteps} of {plan.length} {provider === 'claude' ? 'tasks' : 'steps'} done</span>
          <span class="progress" aria-hidden="true"><span style:width="{(doneSteps / plan.length) * 100}%"></span></span>
          <span class="chev" class:turned={planOpen && !request} aria-hidden="true"><Icon name="chevron" size={12} /></span>
        </button>
        {#if planOpen && !request}
          <ul>
            {#each plan as step, i (i)}
              <li class={step.status}><span class="box" aria-hidden="true">{#if step.status === 'done'}<Icon name="check" size={10} />{/if}</span><span>{step.text}</span></li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
    {#if s?.exited}
      <p class="aside stopped">
        <span>{name} stopped. The conversation is saved.</span>
        <button class="resume" onclick={() => resume(tabKey)}>Resume</button>
      </p>
    {/if}
    {#if queued}
      <p class="aside queued">
        <span>Sends when {name} finishes: {queued}</span>
        <button class="link" onclick={() => queuePrompt(tabKey, null)}>Cancel</button>
      </p>
    {/if}
    <Composer
      bind:text={draft}
      {name}
      {history}
      sigils={provider === 'claude' ? ['/', '@'] : ['/', '$', '@']}
      {commands}
      onFiles={() => listFiles(tabKey)}
      onInput={() => wake(tabKey)}
      working={!!s?.working}
      waiting={!!request}
      disabled={!s || s.exited}
      onSend={(text, images) => send(tabKey, text, images)}
      onStop={() => interrupt(tabKey)}
    >
      {#snippet toolbar()}
        {#if s?.models.length}
          <ChipMenu title="Model and effort" sections={modelSections} value="{provider}:{model}" onPick={pick} footer={modelFooter} width={380}>
            {#snippet label()}
              <ProviderIcon {provider} />
              <span>{chipLabel}</span>
              {#if s?.effort}<span class="faint">{effortName(s.effort).toLowerCase()}</span>{/if}
            {/snippet}
          </ChipMenu>
        {/if}
        {#if s?.modes.length && s.mode}
          <ChipMenu title={provider === 'codex' ? 'Sandbox and approvals, from the next message' : 'Permission mode'} sections={[{ items: s.modes.map((m) => ({ value: m, label: MODES[m] ?? m, description: MODE_HELP[m] })) }]} value={s.mode ?? 'default'} onPick={(m) => setMode(tabKey, m)} width={340}>
            {#snippet label()}<span class:plan={s?.mode === 'plan'}>{MODES[s?.mode ?? 'default'] ?? s?.mode}</span>{/snippet}
          </ChipMenu>
        {/if}
        {#if status}<span class="status" class:waiting={!!request}>{status}</span>{/if}
        <button class="tbtn" onclick={onTerminal} title="Open in terminal: resume this session in {name}'s own TUI" aria-label="Open in terminal"><Icon name="terminal" size={14} /></button>
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
    font-size: 14px;
    line-height: 1.6;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 32px 24px 16px;
  }
  .column,
  .dock {
    width: 100%;
    max-width: 680px;
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
    margin-top: 32px;
  }
  /* Whole turns skip layout offscreen. */
  .turn {
    content-visibility: auto;
    contain-intrinsic-size: auto 160px;
  }

  /* Your message: on the right, the only filled shape in the conversation. */
  .you {
    display: flex;
    justify-content: flex-end;
    align-items: flex-end;
    gap: 6px;
    margin-bottom: 16px;
  }
  .bubble {
    max-width: 85%;
    box-sizing: border-box;
    padding: 9px 15px;
    border-radius: 18px 18px 6px 18px;
    background: var(--bg-surface);
    color: var(--fg-bright);
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  /* On the text alone: on the box, the template's own whitespace shows as a blank line. */
  .said {
    white-space: pre-wrap;
  }
  .pics {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    margin: 4px 0 8px;
  }
  .pics:last-child {
    margin-bottom: 4px;
  }
  .pics img {
    max-height: 180px;
    max-width: 280px;
    border-radius: 10px;
    object-fit: cover;
  }
  .actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--enter) var(--ease-out);
  }
  .you:hover .actions,
  .actions:focus-within {
    opacity: 1;
  }
  .act {
    all: unset;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 7px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--fg-faint);
    cursor: pointer;
  }
  .act:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .act:focus-visible,
  .row:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: -2px;
  }

  /* The agent's side: prose, and one quiet row per thing it did. */
  .work {
    display: flex;
    flex-direction: column;
  }
  .step.text {
    color: var(--fg);
  }
  .step + .step.text,
  .step.text + .step {
    margin-top: 10px;
  }
  .step.sub {
    margin-left: 7px;
    padding-left: 15px;
    border-left: 1px solid var(--border);
  }
  .row {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: calc(100% + 16px);
    min-height: 28px;
    padding: 0 8px;
    margin-left: -8px;
    border-radius: 7px;
    font-size: 13px;
    color: var(--fg-dim);
    cursor: pointer;
    white-space: nowrap;
  }
  .row:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .row::-webkit-details-marker {
    display: none;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 16px;
    flex: none;
    color: var(--fg-faint);
  }
  .group.running .icon {
    color: var(--warn);
  }
  .group.failed > .row .icon {
    color: var(--danger);
  }
  .what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    padding: 0 7px;
    line-height: 18px;
    border-radius: 9px;
    font-size: 11px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
  }
  .badge.declined {
    color: var(--fg-dim);
    background: transparent;
    border-color: var(--border);
  }
  .chev {
    display: grid;
    color: var(--fg-faint);
    opacity: 0;
    transition: transform var(--enter) var(--ease-out);
  }
  .group .chev {
    opacity: 0.5;
  }
  .row:hover .chev,
  .row:focus-visible .chev,
  .turned,
  details[open] .chev {
    opacity: 1;
  }
  .turned,
  details[open] .chev {
    transform: rotate(90deg);
  }
  .calls {
    margin: 2px 0 4px 7px;
    padding-left: 15px;
    border-left: 1px solid var(--border);
  }
  .thinking .row {
    color: var(--fg-faint);
  }
  .thought {
    margin: 2px 0 8px 7px;
    padding-left: 15px;
    border-left: 1px solid var(--border);
    font-size: 13px;
    color: var(--fg-dim);
  }

  /* What happened to the session itself: a divider, or a block when it has a lot to say. */
  .notice {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 14px 0;
    font-size: 12px;
    color: var(--fg-faint);
  }
  .notice::before,
  .notice::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }
  .notice.long {
    display: block;
    margin: 8px 0;
    padding: 10px 14px;
    border-radius: 10px;
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    font-family: var(--mono);
    font-size: var(--mono-size);
    white-space: pre-wrap;
    color: var(--fg-dim);
  }
  .notice.long::before,
  .notice.long::after {
    display: none;
  }
  .alert {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin: 8px 0;
    padding: 9px 12px;
    border-radius: 10px;
    font-size: 13px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 9%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 22%, transparent);
  }
  .alert :global(svg) {
    margin-top: 3px;
  }
  .alert span {
    color: var(--fg);
    white-space: pre-wrap;
  }

  /* The one moving thing: what the agent is doing right now. */
  .live {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    margin-top: 2px;
    font-size: 13px;
  }
  .spinner {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid color-mix(in srgb, var(--warn) 30%, transparent);
    border-top-color: var(--warn);
    animation: spin 0.8s linear infinite;
  }
  .shimmer {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: linear-gradient(90deg, var(--fg-dim) 35%, var(--fg-bright) 50%, var(--fg-dim) 65%) 0 0 / 300% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    animation: shimmer 2.4s linear infinite;
  }
  .secs {
    flex: none;
    color: var(--fg-faint);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: 0 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner,
    .shimmer {
      animation: none;
    }
    .shimmer {
      color: var(--fg-dim);
      background: none;
    }
  }

  .end {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 24px;
    margin-top: 6px;
    font-size: 12px;
    color: var(--fg-faint);
    font-variant-numeric: tabular-nums;
  }
  .end .act {
    margin-left: -4px;
    opacity: 0;
    transition: opacity var(--enter) var(--ease-out);
  }
  .turn:hover .end .act,
  .end .act:focus-visible {
    opacity: 1;
  }
  /* Only Copy, which shows on hover: it hangs in the gap below instead of widening it. */
  .end.bare {
    position: relative;
    min-height: 0;
    height: 0;
    margin: 0;
  }
  .end.bare .act {
    position: absolute;
    top: 4px;
    left: 0;
    margin: 0;
  }

  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 8px 24px 18px;
    max-width: calc(680px + 48px);
  }
  /* Text scrolling under the dock fades out instead of being cut off. */
  .dock::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 28px;
    background: linear-gradient(to bottom, transparent, var(--bg));
    pointer-events: none;
  }
  .aside {
    display: flex;
    gap: 1ch;
    margin: 0 6px;
    font-size: 12px;
    color: var(--fg-dim);
  }
  .tasks {
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg-chrome);
    font-size: 13px;
  }
  .head {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 30px;
    padding: 0 9px;
    border-radius: 9px;
    color: var(--fg);
    cursor: pointer;
  }
  .head:hover {
    background: var(--bg-hover);
  }
  .head:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: -2px;
  }
  .head .chev {
    margin-left: 0;
  }
  .progress {
    flex: 0 0 72px;
    height: 4px;
    margin-left: auto;
    border-radius: 2px;
    background: var(--border);
    overflow: hidden;
  }
  .progress span {
    display: block;
    height: 100%;
    border-radius: 2px;
    background: var(--ok);
    transition: width var(--enter) var(--ease-out);
  }
  .tasks ul {
    list-style: none;
    display: grid;
    gap: 6px;
    max-height: 10.5em;
    overflow-y: auto;
    margin: 2px 0 6px;
    padding: 0 10px;
  }
  .tasks li {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--fg-dim);
  }
  .tasks li.active {
    color: var(--fg-bright);
  }
  .tasks li.done span:last-child {
    color: var(--fg-faint);
  }
  .box {
    display: grid;
    place-items: center;
    flex: none;
    width: 14px;
    height: 14px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1.5px solid var(--fg-faint);
  }
  .active .box {
    border-color: var(--warn);
    background: var(--warn);
    box-shadow: inset 0 0 0 2.5px var(--bg-chrome);
  }
  .done .box {
    border-color: var(--ok);
    background: var(--ok);
    color: var(--bg);
  }
  .stopped {
    align-items: center;
    padding: 8px 12px;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-chrome);
    font-size: 13px;
  }
  .stopped span {
    flex: 1;
  }
  .resume {
    height: 28px;
    padding: 0 12px;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    border: none;
    border-radius: 7px;
    background: var(--accent);
    color: var(--on-accent);
    cursor: pointer;
  }
  .resume:hover {
    background: color-mix(in srgb, var(--accent) 85%, var(--fg-bright));
  }
  .resume:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: 1px;
  }
  .queued {
    align-items: center;
    padding: 6px 10px;
    margin: 0;
    border: 1px dashed var(--border);
    border-radius: 10px;
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
  .faint {
    color: var(--fg-faint);
  }
  .plan {
    color: var(--info);
  }
  .effort {
    display: grid;
    gap: 5px;
  }
  .lbl {
    font-size: 11px;
    font-weight: 600;
    color: var(--fg-faint);
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .seg button {
    font: inherit;
    font-size: 11px;
    color: var(--fg-dim);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .seg button:hover {
    color: var(--fg-bright);
  }
  .seg button.on {
    color: var(--fg-bright);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .seg button:focus-visible {
    outline: 1px solid var(--accent);
  }
  .locked {
    margin: 6px 0 0;
    font-size: 11px;
    color: var(--fg-faint);
  }
  .status {
    margin-left: 4px;
  }
  .status.working {
    color: var(--fg-dim);
  }
  .status.waiting {
    color: var(--accent);
  }
  .tbtn {
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
  .tbtn:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .tbtn:focus-visible {
    outline: 1px solid var(--accent);
  }
</style>
