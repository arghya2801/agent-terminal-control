<script lang="ts" module>
  import type { ChatItem } from '../../sidecar/protocol';
  import type { IconName } from '../lib/Icon.svelte';
  import { toolAction, type Action } from './work';

  export type ToolStatus = 'running' | 'done' | 'failed' | 'stopped';
  /** `live`: the session still runs, so a call without a result is in progress. */
  export function toolStatus(item: ChatItem, live: boolean): ToolStatus {
    return item.done ? (item.error ? 'failed' : 'done') : live ? 'running' : 'stopped';
  }

  const ICONS: Record<Action, IconName> = { read: 'file', edit: 'pencil', command: 'terminal', 'code-search': 'search', web: 'globe', agent: 'agent', tasks: 'list', other: 'tool' };
  export function toolIcon(tool = ''): IconName {
    if (/^(AskUserQuestion|Question)$/.test(tool)) return 'question';
    if (/^(TaskCreate|TaskUpdate|TodoWrite|ExitPlanMode)$/.test(tool)) return 'list';
    return ICONS[toolAction(tool)];
  }
</script>

<script lang="ts">
  import Icon from '../lib/Icon.svelte';
  import { cleanCommand, relativePaths, toolVerb } from './work';

  /** `cwd`: paths under it show relative to it. */
  let { item, live, cwd = null }: { item: ChatItem; live: boolean; cwd?: string | null } = $props();
  let open = $state(false);
  const command = $derived(toolAction(item.tool) === 'command');
  const input = $derived(command ? cleanCommand(item.input ?? '', cwd) : relativePaths(item.input ?? '', cwd));

  const diff = $derived(/^(Edit|MultiEdit|apply_patch)$/.test(item.tool ?? '') || !!item.body?.startsWith('*** Begin Patch'));
  const lines = $derived((command ? cleanCommand(item.body ?? '', cwd) : (item.body ?? '')).replace(/\n$/, '').split('\n'));
  const counts = $derived(diff ? { add: lines.filter((l: string) => l.startsWith('+')).length, del: lines.filter((l: string) => l.startsWith('-')).length } : null);
  const status = $derived(toolStatus(item, live));
  const verb = $derived(toolVerb(item.tool, status === 'running'));
  // While it runs, the last lines of its output, so a long command shows it is alive.
  const tail = $derived(status === 'running' && item.output ? item.output.trimEnd().split('\n').slice(-3).join('\n') : '');
  const expandable = $derived(!!(item.body || item.output));
  // A failed call says why under its row: the user's reason, or the error's first line.
  const first = $derived(
    (item.output ?? '')
      .replace(/^The user declined this[.:]?\s*/, '')
      .split('\n')
      .find((l) => l.trim())
      ?.trim()
      .slice(0, 200) ?? '',
  );
  const why = $derived(item.declined && first ? `You declined: “${first}”` : item.declined ? 'You declined this' : first);
</script>

<div class="tool {status}" class:open class:declined={item.declined}>
  <button class="line" onclick={() => expandable && (open = !open)} aria-expanded={expandable ? open : undefined} title={item.input} class:static={!expandable}>
    <span class="icon"><Icon name={toolIcon(item.tool)} size={14} /></span>
    <span class="verb">{verb}</span>
    {#if input}<code class="target">{input}</code>{/if}
    {#if expandable}<span class="chev" aria-hidden="true"><Icon name="chevron" size={12} /></span>{/if}
    {#if status === 'failed'}<span class="badge" class:declined={item.declined}>{item.declined ? 'Declined' : 'Failed'}</span>{/if}
    <span class="meta">
      {#if counts}<span class="add">+{counts.add}</span><span class="del">−{counts.del}</span>{/if}
      {#if status === 'running' && item.seconds}<span>{Math.round(item.seconds)}s</span>{/if}
      {#if status === 'stopped'}<span>Stopped</span>{/if}
    </span>
  </button>
  {#if tail && !open}<pre class="tail">{tail}</pre>{/if}
  {#if status === 'failed' && !open && why}<p class="why">{why}</p>{/if}
  {#if open}
    <div class="detail">
      {#if item.body}
        <pre class="body" class:cmd={command}>{#each lines as l}<span class:add={diff && l.startsWith('+')} class:del={diff && l.startsWith('-')}>{l}</span>{'\n'}{/each}</pre>
      {/if}
      {#if item.output}<pre class="output" class:error={item.error}>{item.output}</pre>{/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    color: var(--fg-dim);
    font-size: 13px;
  }
  .line {
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
    cursor: pointer;
    white-space: nowrap;
  }
  .line.static {
    cursor: default;
  }
  .line:not(.static):hover {
    background: var(--bg-hover);
    color: var(--fg);
  }
  .line:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--accent) 70%, transparent);
    outline-offset: -2px;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 16px;
    color: var(--fg-faint);
  }
  .running .icon {
    color: var(--warn);
  }
  .verb {
    flex: none;
    color: var(--fg);
  }
  .target {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--mono);
    font-size: calc(var(--mono-size) - 0.5px);
    color: var(--fg-dim);
  }
  .meta {
    display: flex;
    flex: none;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    padding-left: 8px;
    font-size: 12px;
    color: var(--fg-faint);
    font-variant-numeric: tabular-nums;
  }
  .add {
    color: var(--ok);
  }
  .del {
    color: var(--danger);
  }
  .badge {
    flex: none;
    padding: 0 7px;
    line-height: 18px;
    border-radius: 9px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
    font-size: 11px;
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
  .line:hover .chev,
  .line:focus-visible .chev,
  .open .chev {
    opacity: 1;
  }
  .open .chev {
    transform: rotate(90deg);
  }
  .detail {
    margin: 4px 0 8px 24px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-chrome);
    overflow: hidden;
  }
  pre {
    margin: 0;
    padding: 10px 14px;
    max-height: 24em;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--mono);
    font-size: var(--mono-size);
    line-height: 1.55;
  }
  .body {
    color: var(--fg);
  }
  .body.cmd::before {
    content: '$ ';
    color: var(--fg-faint);
  }
  .body + .output {
    border-top: 1px solid var(--border);
  }
  .body .add {
    background: color-mix(in srgb, var(--ok) 12%, transparent);
  }
  .body .del {
    background: color-mix(in srgb, var(--danger) 12%, transparent);
  }
  .output {
    color: var(--fg-dim);
  }
  .output.error {
    color: var(--danger);
  }
  .tail {
    margin: 0 0 4px 7px;
    padding: 0 0 0 16px;
    border-left: 1px solid var(--border);
    max-height: 4.65em;
    overflow: hidden;
    color: var(--fg-dim);
    font-size: calc(var(--mono-size) - 1px);
  }
  .why {
    margin: 0 0 4px 24px;
    font-size: 13px;
    color: var(--fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
