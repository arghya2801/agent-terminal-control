<script lang="ts">
  import { tick } from 'svelte';
  import { openUrl } from '../lib/ipc';
  import { renderMarkdown, toggleCheckbox } from '../lib/markdown';
  import { appState, saveNotes } from '../lib/stores.svelte';

  /** notes.md under the Open view (#132): raw while editing, rendered otherwise. */
  let editing = $state(false);
  let editor = $state<HTMLTextAreaElement>();

  async function edit() {
    editing = true;
    await tick();
    editor?.focus();
  }

  function onPreviewClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const box = target.closest<HTMLInputElement>('input[data-box]');
    if (box) {
      saveNotes(toggleCheckbox(appState.notes, Number(box.dataset.box)), true);
      return;
    }
    const link = target.closest('a');
    if (link) {
      // The webview would try to open it in-app; hand it to the default browser.
      e.preventDefault();
      void openUrl(link.href).catch((err) => (appState.error = String(err)));
      return;
    }
    void edit();
  }
</script>

<div class="notes">
  {#if editing}
    <textarea
      bind:this={editor}
      value={appState.notes}
      spellcheck="false"
      aria-label="Notes"
      oninput={(e) => saveNotes(e.currentTarget.value)}
      onblur={(e) => {
        saveNotes(e.currentTarget.value, true);
        editing = false;
      }}
      onkeydown={(e) => {
        if (e.key === 'Escape') e.currentTarget.blur();
      }}
    ></textarea>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="md"
      role="button"
      tabindex="0"
      aria-label="Notes (Enter to edit)"
      onclick={onPreviewClick}
      onkeydown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) void edit();
      }}
    >
      {#if appState.notes.trim()}
        <!-- Safe: renderMarkdown escapes the source before adding its own tags. -->
        {@html renderMarkdown(appState.notes)}
      {:else}
        <p class="empty">Click to write notes. Markdown; <code>- [ ]</code> makes a checkbox.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .notes {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  textarea,
  .md {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    padding: 6px 12px 12px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  textarea {
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    background: var(--bg);
    color: var(--fg-bright);
    font: 12px/1.6 ui-monospace, monospace;
  }
  .md {
    color: var(--fg);
    font-size: 12px;
    line-height: 1.6;
    cursor: text;
  }
  .md:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .md :global(:is(p, ul, ol, blockquote, pre)) {
    margin: 0 0 4px;
  }
  .md :global(:is(h1, h2, h3)) {
    margin: 6px 0 4px;
    color: var(--fg-bright);
    font-size: 12px;
  }
  .md :global(ul) {
    padding-left: 16px;
  }
  .md :global(li.check),
  .md :global(li.sub) {
    list-style: none;
    margin-left: -16px;
  }
  .md :global(li.sub) {
    padding-left: 20px;
    color: var(--fg-dim);
  }
  .md :global(input[type='checkbox']) {
    margin: 0 4px 0 0;
    accent-color: var(--accent);
    cursor: pointer;
    transform: translateY(2px);
  }
  .md :global(li.check:has(input:checked)) {
    color: var(--fg-faint);
    text-decoration: line-through;
  }
  .md :global(code) {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--bg-surface);
    font-family: ui-monospace, monospace;
  }
  .md :global(a) {
    color: var(--accent);
  }
  .empty {
    color: var(--fg-faint);
  }
</style>
