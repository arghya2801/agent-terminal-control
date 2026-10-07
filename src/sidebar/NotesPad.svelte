<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor, defaultValueCtx, editorViewCtx, remarkStringifyOptionsCtx, rootCtx } from '@milkdown/core';
  import { commonmark } from '@milkdown/preset-commonmark';
  import { gfm } from '@milkdown/preset-gfm';
  import { history } from '@milkdown/plugin-history';
  import { listener, listenerCtx } from '@milkdown/plugin-listener';
  import { replaceAll } from '@milkdown/utils';
  import { openUrl } from '../lib/ipc';
  import { appState, saveNotes } from '../lib/stores.svelte';
  import { focusActiveTerminal } from '../terminal/manager';

  /** notes.md under the Open view (#132), edited in place as formatted text (#150). */
  let root: HTMLDivElement;
  let editor: Editor | undefined;
  /** The Markdown the editor last produced or was given, so an echo is not re-applied. */
  let shown = appState.notes;
  let empty = $state(!appState.notes.trim());

  onMount(() => {
    let alive = true;
    void Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, appState.notes);
        // `-` bullets, as people write them by hand and the old notes used.
        ctx.update(remarkStringifyOptionsCtx, (o) => ({ ...o, bullet: '-' as const }));
        ctx.get(listenerCtx).markdownUpdated((_, md) => {
          shown = md;
          empty = !md.trim();
          saveNotes(md);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .create()
      .then((e) => (alive ? (editor = e) : void e.destroy()));
    return () => {
      alive = false;
      void editor?.destroy();
    };
  });

  // notes.md changed on disk. Not while typing: the save's own echo can lag the keyboard.
  $effect(() => {
    const md = appState.notes;
    if (!editor || md === shown || root.contains(document.activeElement)) return;
    shown = md;
    empty = !md.trim();
    editor.action(replaceAll(md));
  });

  function onMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    // The checkbox is drawn in the task item's left padding.
    const task = target.closest<HTMLElement>('li[data-item-type="task"]');
    if (task && editor && e.offsetX < 18 && target === task) {
      e.preventDefault();
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const pos = view.posAtDOM(task, 0) - 1;
        const node = view.state.doc.nodeAt(pos);
        if (node) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: !node.attrs.checked }));
      });
      return;
    }
    // Ctrl+click opens a link in the browser; a plain click edits its text.
    const link = target.closest('a');
    if (link && e.ctrlKey) {
      e.preventDefault();
      void openUrl(link.href).catch((err) => (appState.error = String(err)));
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="notes"
  class:empty
  bind:this={root}
  onmousedown={onMouseDown}
  onfocusout={() => saveNotes(shown, true)}
  onkeydown={(e) => {
    if (e.key === 'Escape') focusActiveTerminal();
  }}
></div>

<style>
  .notes {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
    color: var(--fg);
    font-size: 12px;
    line-height: 1.6;
    cursor: text;
  }
  .notes :global(.ProseMirror) {
    min-height: 100%;
    box-sizing: border-box;
    padding: 6px 12px 12px;
    outline: none;
    white-space: pre-wrap;
  }
  .notes:focus-within {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .empty :global(.ProseMirror > p:only-child::before) {
    content: 'Write notes. Type - [ ] for a checkbox.';
    color: var(--fg-faint);
    pointer-events: none;
    position: absolute;
  }
  .notes :global(:is(p, ul, ol, blockquote, pre)) {
    margin: 0 0 4px;
  }
  .notes :global(:is(h1, h2, h3, h4)) {
    margin: 8px 0 4px;
    color: var(--fg-bright);
    line-height: 1.3;
  }
  .notes :global(h1) {
    font-size: 15px;
  }
  .notes :global(h2) {
    font-size: 13.5px;
  }
  .notes :global(:is(h3, h4)) {
    font-size: 12px;
  }
  .notes :global(:is(ul, ol)) {
    padding-left: 18px;
  }
  /* A single newline in notes.md is a line, not a space: migrated task notes rely on it. */
  .notes :global(span[data-type='hardbreak']) {
    display: block;
    height: 0;
    overflow: hidden;
  }
  .notes :global(li > p) {
    margin: 0;
  }
  .notes :global(li[data-item-type='task']) {
    position: relative;
    margin-left: -18px;
    padding-left: 20px;
    list-style: none;
  }
  .notes :global(li[data-item-type='task']::before) {
    position: absolute;
    top: 4px;
    left: 1px;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    border: 1px solid var(--fg-faint);
    border-radius: 3px;
    content: '';
    cursor: pointer;
  }
  .notes :global(li[data-checked='true']::before) {
    border-color: var(--accent);
    background: var(--accent)
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6.2l2.3 2.3 4.7-5' fill='none' stroke='white' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
      center / 10px no-repeat;
  }
  .notes :global(li[data-checked='true'] > p) {
    color: var(--fg-faint);
    text-decoration: line-through;
  }
  .notes :global(blockquote) {
    padding-left: 8px;
    border-left: 2px solid var(--border);
    color: var(--fg-dim);
  }
  .notes :global(code) {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--bg-surface);
    font-family: ui-monospace, monospace;
  }
  .notes :global(pre) {
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--bg-surface);
    white-space: pre-wrap;
  }
  .notes :global(pre code) {
    padding: 0;
    background: none;
  }
  .notes :global(a) {
    color: var(--accent);
  }
  .notes :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
  }
</style>
