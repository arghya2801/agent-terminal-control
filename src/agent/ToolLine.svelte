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
  import Tokens from './Tokens.svelte';
  import { cleanCommand, relativePaths, toolVerb } from './work';
  import FileEditor from '../lib/FileEditor.svelte';
  import { readTextFile } from '../lib/ipc';
  import { clippedLines } from '../../sidecar/clip';
  import { formatTokens } from '../lib/costs';
  import Markdown from './Markdown.svelte';
  import ToolLine from './ToolLine.svelte';

  /** `cwd`: paths under it show relative to it. `children`: a subagent call's own steps. */
  let { item, live, cwd = null, children = [] }: { item: ChatItem; live: boolean; cwd?: string | null; children?: ChatItem[] } = $props();
  let open = $state(false);
  const command = $derived(toolAction(item.tool) === 'command');
  const input = $derived(command ? cleanCommand(item.input ?? '', cwd) : relativePaths(item.input ?? '', cwd));

  const lang = $derived(
    command ? (/powershell/i.test(item.tool ?? '') ? 'powershell' : 'sh')
    : /^(Edit|MultiEdit|Write)$/.test(item.tool ?? '') ? (/\.(\w+)$/.exec((item.input ?? '').trim().split(/\s/)[0])?.[1] ?? null)
    : null,
  );
  const diff = $derived(/^(Edit|MultiEdit|apply_patch)$/.test(item.tool ?? '') || !!item.body?.startsWith('*** Begin Patch'));
  const lines = $derived((command ? cleanCommand(item.body ?? '', cwd) : (item.body ?? '')).replace(/\n$/, '').split('\n'));
  const counts = $derived(diff ? { add: lines.filter((l: string) => l.startsWith('+')).length, del: lines.filter((l: string) => l.startsWith('-')).length } : null);
  const status = $derived(toolStatus(item, live));
  const verb = $derived(toolVerb(item.tool, status === 'running'));
  // While it runs, the last lines of its output, so a long command shows it is alive.
  const tail = $derived(status === 'running' && item.output ? item.output.trimEnd().split('\n').slice(-3).join('\n') : '');
  const expandable = $derived(!!(item.body || item.output));
  // Long output says how long, counting what the sidecar left out of the middle.
  const outLines = $derived(clippedLines(item.output?.trimEnd() ?? ''));
  // A failed call says why under its row: the user's reason, or the error's first line.
  const first = $derived(
    (item.output ?? '')
      .replace(/^The user declined this[.:]?\s*/, '')
      .split('\n')
      .find((l) => l.trim())
      ?.trim()
      .slice(0, 200) ?? '',
  );
  const secs = (n: number) => (n < 60 ? `${Math.round(n)}s` : `${Math.floor(n / 60)}m ${String(Math.round(n % 60)).padStart(2, '0')}s`);
  const why = $derived(item.declined && first ? `You declined: “${first}”` : item.declined ? 'You declined this' : first);

  const path = $derived(/^(Edit|MultiEdit|Write)$/.test(item.tool ?? '') && status === 'done' && !(item.input ?? '').includes(', ') ? (item.input ?? '').trim() : '');
  const previewable = $derived(/\.(html?|svg)$/i.test(path));
  let editing = $state(false);
  let preview = $state<string | null>(null);
  let wide = $state(false);
  let fileError = $state('');

  async function load(): Promise<string | null> {
    fileError = '';
    try {
      return await readTextFile(path);
    } catch (e) {
      fileError = String(e);
      return null;
    }
  }
  async function togglePreview() {
    if (preview !== null) return (preview = null);
    const text = await load();
    if (text !== null) preview = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'">${text}`;
  }
</script>

<div class="tool {status}" class:open class:declined={item.declined}>
  <!-- Nothing to open: a plain row, not a button that does nothing. -->
  <svelte:element this={expandable ? 'button' : 'div'} class="line" role={expandable ? undefined : 'group'} onclick={() => expandable && (open = !open)} aria-expanded={expandable ? open : undefined} title={item.input} class:static={!expandable}>
    <span class="icon"><Icon name={toolIcon(item.tool)} size={14} /></span>
    <span class="verb">{verb}</span>
    {#if input}<code class="target"><Tokens text={input} lang={command ? lang : null} /></code>{/if}
    {#if expandable}<span class="chev" aria-hidden="true"><Icon name="chevron" size={12} /></span>{/if}
    {#if status === 'failed'}<span class="badge" class:declined={item.declined}>{item.declined ? 'Declined' : 'Failed'}</span>{/if}
    <span class="meta">
      {#if counts}<span class="add">+{counts.add}</span><span class="del">−{counts.del}</span>{/if}
      {#if item.agentModel}<span>{item.agentModel}</span>{/if}
      {#if item.agentTokens}<span>{formatTokens(item.agentTokens)} tokens</span>{/if}
      {#if item.agentMs && status !== 'running'}<span>{secs(item.agentMs / 1000)}</span>{/if}
      <!-- Finished calls keep their time only when it was long enough to matter. -->
      {#if status !== 'running' && outLines >= 20}<span>{outLines.toLocaleString()} lines</span>{/if}
      {#if item.seconds && (status === 'running' || item.seconds >= 5)}<span>{secs(item.seconds)}</span>{/if}
      {#if status === 'stopped'}<span>Stopped</span>{/if}
    </span>
  </svelte:element>
  {#if tail && !open}<pre class="tail">{tail}</pre>{/if}
  {#if children.length}
    <details class="steps">
      <summary>{children.filter((c) => c.kind === 'tool').length} subagent steps</summary>
      {#each children as c (c.id)}
        {#if c.kind === 'tool'}<ToolLine item={c} {live} {cwd} />{:else if c.kind === 'assistant' && c.text}<div class="said"><Markdown text={c.text} /></div>{/if}
      {/each}
    </details>
  {/if}
  {#if status === 'failed' && !open && why}<p class="why">{why}</p>{/if}
  {#if open}
    <div class="detail">
      {#if item.body}
        <pre class="body" class:cmd={command}>{#each lines as l}<span class:add={diff && l.startsWith('+')} class:del={diff && l.startsWith('-')}><Tokens text={l} {lang} /></span>{'\n'}{/each}</pre>
      {/if}
      {#if item.output}<pre class="output" class:error={item.error}>{item.output}</pre>{/if}
      {#if path}
        {#if editing}
          <div class="editing"><FileEditor {path} onClose={() => ((editing = false), (preview = null))} /></div>
        {:else}
          <div class="file">
            <button class="btn" onclick={() => (editing = true)}>Edit file</button>
            {#if previewable}<button class="btn" onclick={togglePreview}>{preview === null ? 'Preview' : 'Hide preview'}</button>{/if}
            {#if fileError}<span class="ferr">{fileError}</span>{/if}
          </div>
        {/if}
        {#if preview !== null}
          <iframe title="Preview" sandbox="allow-scripts" srcdoc={preview} class:wide></iframe>
          <button class="btn" onclick={() => (wide = !wide)}>{wide ? 'Shrink' : 'Expand'}</button>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .tool {
    color: var(--fg-dim);
    font-size: calc(13px * var(--chat-scale, 1));
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
    font-size: calc(12px * var(--chat-scale, 1));
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
    font-size: calc(11px * var(--chat-scale, 1));
  }
  .badge.declined {
    color: var(--fg-dim);
    background: transparent;
    border-color: var(--border);
  }
  .chev {
    display: grid;
    color: var(--fg-faint);
    opacity: 0.5;
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
  .file {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
  }
  .editing {
    border-top: 1px solid var(--border);
  }
  .btn {
    flex: none;
    height: 32px;
    padding: 0 14px;
    font: inherit;
    font-size: calc(13px * var(--chat-scale, 1));
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
  .ferr {
    color: var(--danger);
  }
  iframe {
    display: block;
    width: 100%;
    height: 60vh;
    border: 0;
    border-top: 1px solid var(--border);
    background: #fff;
  }
  iframe.wide {
    height: 90vh;
  }
  .tail {
    margin: 0 0 4px 7px;
    padding: 0 0 0 16px;
    border-left: 1px solid var(--border);
    max-height: 4.65em;
    overflow: hidden;
    /* One visual line per output line, so the newest of the three is never wrapped out of view. */
    white-space: pre;
    color: var(--fg-dim);
    font-size: calc(var(--mono-size) - 1px);
  }
  .steps {
    margin: 0 0 4px 7px;
    padding-left: 16px;
    border-left: 1px solid var(--border);
  }
  .steps summary {
    cursor: pointer;
    color: var(--fg-faint);
    font-size: calc(12px * var(--chat-scale, 1));
  }
  .said {
    color: var(--fg-dim);
  }
  .why {
    margin: 0 0 4px 24px;
    font-size: calc(13px * var(--chat-scale, 1));
    color: var(--fg-dim);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  @media (prefers-reduced-motion: reduce) {
    .chev {
      transition: none;
    }
  }
</style>
