<script lang="ts" module>
  import type { ChatItem } from '../../sidecar/protocol';

  export type ToolStatus = 'running' | 'done' | 'failed' | 'stopped';
  /** `live`: the session still runs, so a call without a result is in progress. */
  export function toolStatus(item: ChatItem, live: boolean): ToolStatus {
    return item.done ? (item.error ? 'failed' : 'done') : live ? 'running' : 'stopped';
  }
</script>

<script lang="ts">
  import { relativePaths } from './work';

  /** `cwd`: paths under it show relative to it. */
  let { item, live, cwd = null }: { item: ChatItem; live: boolean; cwd?: string | null } = $props();
  let open = $state(false);
  const input = $derived(relativePaths(item.input ?? '', cwd));

  const diff = $derived(/^(Edit|MultiEdit|apply_patch)$/.test(item.tool ?? '') || !!item.body?.startsWith('*** Begin Patch'));
  const lines = $derived(item.body?.replace(/\n$/, '').split('\n') ?? []);
  const counts = $derived(diff ? { add: lines.filter((l: string) => l.startsWith('+')).length, del: lines.filter((l: string) => l.startsWith('-')).length } : null);
  const status = $derived(toolStatus(item, live));
  // While it runs, the last lines of its output, so a long command shows it is alive.
  const tail = $derived(status === 'running' && item.output ? item.output.trimEnd().split('\n').slice(-3).join('\n') : '');
</script>

<div class="tool" class:open>
  <button class="line" onclick={() => (open = !open)} aria-expanded={open} title={item.input}>
    <span class="name">{item.tool}</span>
    <span class="input">{input}</span>
    {#if counts}<span class="counts"><span class="add">+{counts.add}</span> <span class="del">−{counts.del}</span></span>{/if}
    {#if status === 'running' && item.seconds}<span class="secs">{Math.round(item.seconds)}s</span>{/if}
    {#if status === 'failed'}<span class="failed">failed</span>{:else if status === 'stopped'}<span class="secs">stopped</span>{/if}
    <span class="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
  </button>
  {#if tail && !open}<pre class="tail">{tail}</pre>{/if}
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
    gap: 1.2ch;
    width: 100%;
    padding: 3px 8px;
    margin-left: -8px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .line:hover {
    background: var(--bg-hover);
  }
  .line:focus-visible {
    outline: 1px solid var(--accent);
  }
  .name {
    color: var(--fg-bright);
    font-weight: 600;
  }
  .input {
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }
  .chev {
    color: var(--fg-faint);
    opacity: 0;
  }
  .line:hover .chev,
  .open .chev,
  .line:focus-visible .chev {
    opacity: 1;
  }
  .counts .add {
    color: var(--ok);
  }
  .counts .del,
  .failed {
    color: var(--danger);
  }
  .secs {
    color: var(--fg-faint);
  }
  .detail {
    margin: 4px 0 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-chrome);
    overflow: hidden;
  }
  pre {
    margin: 0;
    padding: 8px 12px;
    max-height: 24em;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
  }
  .body + .output {
    border-top: 1px solid var(--border);
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
  .tail {
    color: var(--fg-faint);
    padding: 2px 0 4px;
    max-height: 4.5em;
    overflow: hidden;
  }
</style>
