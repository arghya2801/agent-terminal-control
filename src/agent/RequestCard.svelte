<script lang="ts">
  import Icon from '../lib/Icon.svelte';
  import Markdown from './Markdown.svelte';
  import { toolAction } from './work';
  import type { AgentRequest, Answer } from '../../sidecar/protocol';

  let { request, name, onAnswer }: { request: AgentRequest; name: string; onAnswer: (a: Answer) => void } = $props();

  let reason = $state('');
  let chosen = $state<Record<string, string[]>>({});
  let other = $state<Record<string, string>>({});

  const action = $derived(toolAction(request.tool));
  const title = $derived(
    request.kind === 'question'
      ? `${name} has a question`
      : request.kind === 'plan'
        ? `${name} has a plan for you to approve`
        : action === 'command'
          ? `${name} wants to run a command`
          : action === 'edit'
            ? `${name} wants to edit a file`
            : action === 'web'
              ? `${name} wants to go online`
              : `${name} wants to use ${request.tool}`,
  );
  const icon = $derived(request.kind === 'question' ? 'question' : request.kind === 'plan' ? 'list' : action === 'edit' ? 'pencil' : action === 'web' ? 'globe' : 'terminal');
  const lines = $derived((request.body ?? '').split('\n'));
  const diff = $derived(request.tool === 'Edit' || request.tool === 'MultiEdit');
  const answers = $derived(
    Object.fromEntries((request.questions ?? []).map((q) => [q.id, [...(chosen[q.id] ?? []), ...(other[q.id]?.trim() ? [other[q.id].trim()] : [])]])),
  );
  const complete = $derived((request.questions ?? []).every((q) => answers[q.id]?.length));

  function toggle(q: { id: string; multi?: boolean }, label: string) {
    const now = chosen[q.id] ?? [];
    chosen[q.id] = q.multi ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label];
    if (!q.multi) other[q.id] = '';
  }
  const deny = () => onAnswer({ allow: false, message: reason.trim() || undefined });

  /** With focus in the card and not in a text box: 1-9 pick an option of a lone question. */
  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const q = request.questions?.length === 1 ? request.questions[0] : null;
    const n = Number(e.key);
    if (q && n >= 1 && n <= q.options.length) {
      e.preventDefault();
      toggle(q, q.options[n - 1].label);
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (keys for the options and buttons inside) -->
<section class="card {request.kind}" role="group" aria-label={title} onkeydown={onKey}>
  <header>
    <span class="badge"><Icon name={icon} size={14} /></span>
    <h3>{title}</h3>
  </header>

  {#if request.kind === 'question'}
    {#each request.questions ?? [] as q (q.id)}
      <div class="question">
        <p>{q.question}{#if q.multi}<span class="muted"> Pick any.</span>{/if}</p>
        <div class="options" role={q.multi ? 'group' : 'radiogroup'}>
          {#each q.options as o, oi (o.label)}
            {@const on = !!chosen[q.id]?.includes(o.label)}
            <button class="option" class:on role={q.multi ? 'checkbox' : 'radio'} aria-checked={on} onclick={() => toggle(q, o.label)}>
              <span class="mark" class:square={q.multi}>{#if on}<Icon name="check" size={10} />{/if}</span>
              <span class="label"><b>{o.label}</b>{#if o.description}<span>{o.description}</span>{/if}</span>
              {#if (request.questions?.length ?? 0) === 1 && oi < 9}<kbd class="num" title="Press {oi + 1}">{oi + 1}</kbd>{/if}
            </button>
          {/each}
        </div>
        <input class="field" placeholder="Or type your own answer" bind:value={other[q.id]} oninput={() => !q.multi && (chosen[q.id] = [])} />
      </div>
    {/each}
    <div class="actions">
      <span class="grow"></span>
      <button class="btn" onclick={deny}>Skip</button>
      <button class="btn primary" disabled={!complete} onclick={() => onAnswer({ allow: true, answers })}>Answer</button>
    </div>
  {:else}
    {#if request.kind === 'plan'}
      <div class="well plan"><Markdown text={request.body ?? ''} /></div>
    {:else}
      <pre class="well" class:cmd={action === 'command'}>{#if request.body && request.body !== request.input}{#each lines as l}<span class:add={diff && l.startsWith('+')} class:del={diff && l.startsWith('-')}>{l}</span>{'\n'}{/each}{:else}{request.input}{/if}</pre>
    {/if}
    <div class="actions">
      <input class="field grow" placeholder={request.kind === 'plan' ? 'What to change (optional)' : `Why not? (optional, sent with Deny)`} bind:value={reason} />
      {#if request.kind === 'plan'}
        <button class="btn" onclick={deny}>Keep planning</button>
        <button class="btn primary" onclick={() => onAnswer({ allow: true })}>Approve plan</button>
      {:else}
        <button class="btn deny" onclick={deny}>Deny</button>
        {#if request.always}<button class="btn" onclick={() => onAnswer({ allow: true, always: true })} title="Allow this and the same kind of call for the rest of the session">Always allow</button>{/if}
        <button class="btn primary" onclick={() => onAnswer({ allow: true })}>Allow</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .card {
    --tone: var(--accent);
    padding: 12px 14px 12px;
    border: 1px solid color-mix(in srgb, var(--tone) 35%, var(--border));
    border-radius: 14px;
    background: var(--bg-chrome);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.22);
    animation: card-in var(--enter) var(--ease-out);
  }
  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: none;
    }
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    color: var(--tone);
    background: color-mix(in srgb, var(--tone) 14%, transparent);
  }
  h3 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--fg-bright);
  }
  .well {
    margin: 0 0 10px;
    padding: 9px 12px;
    max-height: 14em;
    overflow: auto;
    border-radius: 9px;
    border: 1px solid var(--border);
    background: var(--bg);
    font-family: var(--mono);
    font-size: var(--mono-size);
    line-height: 1.55;
    color: var(--fg-bright);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .well.cmd::before {
    content: '$ ';
    color: var(--fg-faint);
  }
  .well.plan {
    max-height: 20em;
    font-family: inherit;
    font-size: inherit;
    white-space: normal;
    color: var(--fg);
  }
  .add {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }
  .del {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .question p {
    margin: 0 0 8px;
    color: var(--fg-bright);
  }
  .muted {
    color: var(--fg-faint);
  }
  .options {
    display: grid;
    gap: 6px;
    margin-bottom: 8px;
  }
  .option {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
    transition: border-color var(--fast) var(--ease-out), background var(--fast) var(--ease-out);
  }
  .option:hover {
    background: var(--bg-hover);
  }
  .option.on {
    border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
    background: color-mix(in srgb, var(--accent) 9%, transparent);
  }
  .option:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: 1px;
  }
  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: 16px;
    height: 16px;
    margin-top: 2px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1.5px solid var(--fg-faint);
    color: var(--on-accent);
  }
  .mark.square {
    border-radius: 4px;
  }
  .on .mark {
    border-color: var(--accent);
    background: var(--accent);
  }
  .label {
    display: grid;
    gap: 1px;
  }
  .label b {
    font-weight: 600;
    color: var(--fg-bright);
  }
  .label span {
    font-size: 12.5px;
    color: var(--fg-dim);
  }
  .field {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: 32px;
    font: inherit;
    font-size: 13px;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 10px;
  }
  .question .field {
    margin-bottom: 10px;
  }
  .field::placeholder {
    color: var(--fg-faint);
  }
  .field:focus-visible {
    outline: none;
    border-color: color-mix(in srgb, var(--accent) 70%, var(--border));
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .btn {
    flex: none;
    height: 32px;
    padding: 0 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    color: var(--fg);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
  .btn:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: 1px;
  }
  .btn.deny {
    background: transparent;
    color: var(--danger);
  }
  .btn.deny:hover {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }
  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .btn.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 85%, var(--fg-bright));
    color: var(--on-accent);
  }
  .btn:disabled,
  .btn.primary:disabled {
    background: var(--bg-surface);
    border-color: var(--border);
    color: var(--fg-faint);
    cursor: not-allowed;
  }
  .num {
    margin-left: auto;
    align-self: center;
    font-size: 11px;
    color: var(--fg-faint);
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 5px;
  }
</style>
