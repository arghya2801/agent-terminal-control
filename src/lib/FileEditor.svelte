<script lang="ts">
  import { onMount } from 'svelte';
  import CodeEditor from './CodeEditor.svelte';
  import { jsonError, langOf, restoreEol } from '../agent/work';
  import { readTextFile, writeTextFile } from './ipc';

  let { path, onClose }: { path: string; onClose: () => void } = $props();
  let draft = $state<string | null>(null);
  let original = '';
  let error = $state('');
  const lang = $derived(langOf(path));

  onMount(async () => {
    try {
      original = await readTextFile(path);
      draft = original.replace(/\r\n/g, '\n');
    } catch (e) {
      error = String(e);
    }
  });

  async function save() {
    error = lang === 'json' ? jsonError(draft ?? '') : '';
    if (error) return;
    try {
      if ((await readTextFile(path)) !== original) {
        error = 'File changed on disk, reopen it';
        return;
      }
      await writeTextFile(path, restoreEol(original, draft ?? ''));
      onClose();
    } catch (e) {
      error = String(e);
    }
  }
</script>

<div class="file">
  {#if draft !== null}
    <CodeEditor bind:value={draft} {lang} />
    <button class="btn primary" onclick={save}>Save</button>
  {/if}
  <button class="btn" onclick={onClose}>{draft === null ? 'Close' : 'Cancel'}</button>
  {#if error}<span class="ferr">{error}</span>{/if}
</div>

<style>
  .file {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
  }
  .btn {
    flex: none;
    height: 32px;
    padding: 0 14px;
    font: inherit;
    font-size: calc(13px * var(--ui-scale, 1));
    font-weight: 500;
    color: var(--fg);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: calc(8px * var(--radius-scale, 1));
    cursor: pointer;
  }
  .btn:hover {
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
  .btn.primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, var(--fg-bright));
    color: var(--on-accent);
  }
  .ferr {
    color: var(--danger);
  }
</style>
