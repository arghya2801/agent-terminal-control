<script lang="ts">
  import Markdown from './Markdown.svelte';
  import type { AgentRequest, Answer } from '../../sidecar/protocol';

  let { request, name, onAnswer }: { request: AgentRequest; name: string; onAnswer: (a: Answer) => void } = $props();

  let reason = $state('');
  let chosen = $state<Record<string, string[]>>({});
  let other = $state<Record<string, string>>({});

  const title = $derived(
    request.kind === 'question' ? `${name} is asking` : request.kind === 'plan' ? `${name} has a plan for you to approve` : `${name} wants to use ${request.tool}`,
  );
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
</script>

<section class="card {request.kind}" role="group" aria-label={title}>
  <h3>{title}</h3>

  {#if request.kind === 'question'}
    {#each request.questions ?? [] as q (q.id)}
      <div class="question">
        <p>{q.question}{#if q.multi}<span class="muted"> Pick any.</span>{/if}</p>
        <div class="options">
          {#each q.options as o (o.label)}
            <button class="option" class:on={chosen[q.id]?.includes(o.label)} aria-pressed={!!chosen[q.id]?.includes(o.label)} onclick={() => toggle(q, o.label)}>
              <b>{o.label}</b>{#if o.description}<span>{o.description}</span>{/if}
            </button>
          {/each}
        </div>
        <input class="other" placeholder="Something else" bind:value={other[q.id]} oninput={() => !q.multi && (chosen[q.id] = [])} />
      </div>
    {/each}
    <div class="actions">
      <button class="btn primary" disabled={!complete} onclick={() => onAnswer({ allow: true, answers })}>Answer</button>
      <button class="btn" onclick={deny}>Skip</button>
    </div>
  {:else}
    {#if request.kind === 'plan'}
      <div class="plan"><Markdown text={request.body ?? ''} /></div>
    {:else}
      <p class="input">{request.input}</p>
      {#if request.body && request.body !== request.input}
        <pre class="body">{#each lines as l}<span class:add={diff && l.startsWith('+')} class:del={diff && l.startsWith('-')}>{l}</span>{'\n'}{/each}</pre>
      {/if}
    {/if}
    <input class="reason" placeholder={request.kind === 'plan' ? 'What to change, if you keep planning' : `Tell ${name} why, if you deny`} bind:value={reason} />
    <div class="actions">
      {#if request.kind === 'plan'}
        <button class="btn primary" onclick={() => onAnswer({ allow: true })}>Approve plan</button>
        <button class="btn" onclick={deny}>Keep planning</button>
      {:else}
        <button class="btn primary" onclick={() => onAnswer({ allow: true })}>Allow</button>
        {#if request.always}<button class="btn" onclick={() => onAnswer({ allow: true, always: true })}>Always allow</button>{/if}
        <button class="btn" onclick={deny}>Deny</button>
      {/if}
    </div>
  {/if}
</section>

<style>
  .card {
    border-left: 3px solid var(--warn);
    background: var(--bg-chrome);
    padding: 10px 14px 12px;
    animation: card-in var(--enter) var(--ease-out);
  }
  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--fg-bright);
  }
  .input,
  pre {
    font-family: var(--mono);
    font-size: var(--mono-size);
    margin: 0 0 8px;
    color: var(--fg);
    overflow-wrap: anywhere;
  }
  pre {
    max-height: 14em;
    overflow: auto;
    white-space: pre-wrap;
    color: var(--fg-dim);
  }
  .add {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }
  .del {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .plan {
    max-height: 20em;
    overflow: auto;
    margin-bottom: 8px;
  }
  .question p {
    margin: 0 0 6px;
  }
  .muted {
    color: var(--fg-faint);
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
  }
  .option {
    all: unset;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .option span {
    color: var(--fg-dim);
    font-size: 12px;
  }
  .option:hover {
    background: var(--bg-hover);
  }
  .option.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .option:focus-visible {
    outline: 1px solid var(--accent);
  }
  input {
    box-sizing: border-box;
    width: 100%;
    font: inherit;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 5px 8px;
    margin-bottom: 8px;
  }
  input:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .actions {
    display: flex;
    gap: 8px;
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
