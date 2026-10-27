<script lang="ts">
  import type { ChatItem } from '../types';

  let { item }: { item: ChatItem } = $props();
  let open = $state(false);

  const diff = $derived(/^(Edit|MultiEdit|apply_patch)$/.test(item.tool ?? '') || !!item.body?.startsWith('*** Begin Patch'));
  const lines = $derived(item.body?.replace(/\n$/, '').split('\n') ?? []);
  const counts = $derived(diff ? { add: lines.filter((l) => l.startsWith('+')).length, del: lines.filter((l) => l.startsWith('-')).length } : null);
  const status = $derived(!item.done ? 'running' : item.error ? 'failed' : 'done');
</script>

<div class="tool" class:open>
  <button class="line" onclick={() => (open = !open)} aria-expanded={open} title={item.input}>
    <span class="dot {status}" aria-hidden="true">⏺</span>
    <span class="name">{item.tool}</span>
    <span class="input">{item.input}</span>
    {#if counts}<span class="counts"><span class="add">+{counts.add}</span> <span class="del">−{counts.del}</span></span>{/if}
    <span class="status {status}">{status === 'running' ? '…' : status === 'failed' ? '✗' : '✓'}<span class="sr">{status}</span></span>
  </button>
  {#if open}
    <div class="detail">
      {#if item.body}
        <pre class="body">{#each lines as l}<span class:add={diff && l.startsWith('+')} class:del={diff && l.startsWith('-')}>{l}</span>{'\n'}{/each}</pre>
      {/if}
      {#if item.output}<pre class="output" class:error={item.error}>{item.output}</pre>{/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    font-family: var(--mono);
    font-size: var(--mono-size);
    color: var(--fg-dim);
  }
  .line {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: baseline;
    gap: 1ch;
    width: 100%;
    padding: 1px 4px;
    margin-left: -4px;
    border-radius: 3px;
    cursor: pointer;
    white-space: nowrap;
  }
  .line:hover {
    background: var(--bg-hover);
  }
  .line:focus-visible {
    outline: 1px solid var(--accent);
  }
  .dot {
    color: var(--fg-faint);
  }
  .dot.done {
    color: var(--ok);
  }
  .dot.failed {
    color: var(--danger);
  }
  .name {
    color: var(--fg);
  }
  .input {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  .counts .add,
  .status.done {
    color: var(--ok);
  }
  .counts .del,
  .status.failed {
    color: var(--danger);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .detail {
    margin: 2px 0 6px 2ch;
    border-left: 1px solid var(--border);
    padding-left: 1ch;
  }
  pre {
    margin: 0;
    padding: 4px 0;
    max-height: 24em;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
  }
  .body .add {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }
  .body .del {
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .output {
    color: var(--fg-faint);
  }
  .output.error {
    color: var(--danger);
  }
</style>
