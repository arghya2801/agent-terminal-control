<script lang="ts">
  // Markdown as Svelte elements, never {@html}: transcripts hold tool output and fetched
  // pages, which must not be able to put markup in the app.
  import { fromMarkdown } from 'mdast-util-from-markdown';
  import { gfm } from 'micromark-extension-gfm';
  import { gfmFromMarkdown } from 'mdast-util-gfm';
  import type { Nodes } from 'mdast';
  import { openUrl } from '../lib/ipc';
  import { appState } from '../lib/stores.svelte';

  let { text }: { text: string } = $props();
  const tree = $derived(fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }));

  function open(e: MouseEvent, url: string) {
    e.preventDefault();
    void openUrl(url).catch((err) => (appState.error = String(err)));
  }
</script>

{#snippet kids(n: Nodes)}
  {#if 'children' in n}{#each n.children as c}{@render node(c)}{/each}{/if}
{/snippet}

{#snippet node(n: Nodes)}
  {#if n.type === 'paragraph'}<p>{@render kids(n)}</p>
  {:else if n.type === 'heading'}
    <svelte:element this={n.depth === 1 ? 'h3' : n.depth === 2 ? 'h4' : 'h5'}>{@render kids(n)}</svelte:element>
  {:else if n.type === 'text'}{n.value}
  {:else if n.type === 'strong'}<strong>{@render kids(n)}</strong>
  {:else if n.type === 'emphasis'}<em>{@render kids(n)}</em>
  {:else if n.type === 'delete'}<del>{@render kids(n)}</del>
  {:else if n.type === 'inlineCode'}<code>{n.value}</code>
  {:else if n.type === 'code'}<pre><code>{n.value}</code></pre>
  {:else if n.type === 'break'}<br />
  {:else if n.type === 'thematicBreak'}<hr />
  {:else if n.type === 'blockquote'}<blockquote>{@render kids(n)}</blockquote>
  {:else if n.type === 'link'}<a href={n.url} title={n.url} onclick={(e) => open(e, n.url)}>{@render kids(n)}</a>
  {:else if n.type === 'image'}<a href={n.url} onclick={(e) => open(e, n.url)}>{n.alt || n.url}</a>
  {:else if n.type === 'list'}
    <svelte:element this={n.ordered ? 'ol' : 'ul'} start={n.start ?? undefined}>{@render kids(n)}</svelte:element>
  {:else if n.type === 'listItem'}
    <li class:task={n.checked != null}>{#if n.checked != null}<input type="checkbox" checked={n.checked} disabled />{/if}{@render kids(n)}</li>
  {:else if n.type === 'table'}
    <div class="table"><table><tbody>
      {#each n.children as row, r}
        <tr>
          {#each row.children as cell, i}
            <svelte:element this={r === 0 ? 'th' : 'td'} style:text-align={n.align?.[i] ?? undefined}>{@render kids(cell)}</svelte:element>
          {/each}
        </tr>
      {/each}
    </tbody></table></div>
  {:else if n.type === 'html'}{n.value}
  {:else}{@render kids(n)}
  {/if}
{/snippet}

<div class="md">{@render kids(tree)}</div>

<style>
  .md {
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .md :global(:is(p, ul, ol, pre, blockquote, .table, h3, h4, h5)) {
    margin: 0 0 0.6em;
  }
  .md :global(:last-child) {
    margin-bottom: 0;
  }
  .md :global(:is(h3, h4, h5)) {
    color: var(--fg-bright);
    font-weight: 600;
    line-height: 1.3;
    margin-top: 1em;
  }
  .md :global(h3) { font-size: 17px; }
  .md :global(h4) { font-size: 15px; }
  .md :global(h5) { font-size: 13px; }
  .md :global(:is(ul, ol)) {
    padding-left: 1.4em;
  }
  .md :global(li.task) {
    list-style: none;
    margin-left: -1.4em;
    display: flex;
    gap: 0.5em;
    align-items: baseline;
  }
  .md :global(li.task > input) {
    margin: 0;
  }
  .md :global(code) {
    font-family: var(--mono);
    font-size: 0.92em;
    background: var(--bg-surface);
    border-radius: 3px;
    padding: 0 0.25em;
  }
  .md :global(pre) {
    background: var(--bg-chrome);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 10px;
    overflow-x: auto;
  }
  .md :global(pre code) {
    background: none;
    padding: 0;
  }
  .md :global(blockquote) {
    border-left: 2px solid var(--border);
    color: var(--fg-dim);
    padding-left: 10px;
    margin-left: 0;
  }
  .md :global(a) {
    color: var(--accent);
  }
  .md :global(hr) {
    border: 0;
    border-top: 1px solid var(--border);
  }
  .md :global(.table) {
    overflow-x: auto;
  }
  .md :global(table) {
    border-collapse: collapse;
  }
  .md :global(:is(th, td)) {
    border: 1px solid var(--border);
    padding: 3px 8px;
  }
  .md :global(th) {
    color: var(--fg-bright);
    font-weight: 600;
  }
</style>
