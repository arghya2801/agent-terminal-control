<script lang="ts">
  import { onMount } from 'svelte';
  import FileEditor from '../lib/FileEditor.svelte';
  import { configFiles, createConfigFile, readTextFile } from '../lib/ipc';
  import type { ConfigFile } from '../types';

  let { extra = $bindable([]), project = '' }: { extra: string[]; project?: string } = $props();
  let found = $state<ConfigFile[]>([]);
  let exists = $state<Record<string, boolean>>({});
  let editing = $state('');
  let adding = $state('');
  let error = $state('');

  async function refresh() {
    found = await configFiles(project).catch(() => []);
    for (const p of extra) exists[p] = await readTextFile(p).then(() => true, () => false);
  }
  onMount(() => void refresh());

  const rows = $derived([
    ...found,
    ...extra.map((path) => ({ label: path.split(/[\\/]/).pop() ?? path, path, exists: exists[path] ?? true, global: false, extra: true })),
  ] as (ConfigFile & { extra?: boolean })[]);

  async function create(path: string) {
    try {
      error = '';
      await createConfigFile(path);
      await refresh();
      editing = path;
    } catch (e) {
      error = String(e);
    }
  }
  function add() {
    const p = adding.trim();
    if (p && !extra.includes(p)) extra = [...extra, p];
    adding = '';
    void refresh();
  }
</script>

<div class="config">
  {#each rows as f (f.path)}
    <div class="row">
      <span class="label">{f.label}</span>
      <span class="muted path" title={f.path}>{f.path}</span>
      {#if f.exists}
        <button class="btn" onclick={() => (editing = editing === f.path ? '' : f.path)}>{editing === f.path ? 'Close' : 'Edit'}</button>
      {:else}
        <span class="muted">Missing</span>
        {#if f.global}<button class="btn" onclick={() => create(f.path)}>Create</button>{/if}
      {/if}
      {#if f.extra}<button class="btn" onclick={() => (extra = extra.filter((p) => p !== f.path))} title="Remove from this list">Remove</button>{/if}
    </div>
    {#if editing === f.path}
      {#key f.path}<FileEditor path={f.path} onClose={() => (editing = '')} />{/key}
    {/if}
  {/each}
  <div class="row">
    <input class="wide" placeholder="Add a file by its full path" aria-label="Add a config file" bind:value={adding} onkeydown={(e) => e.key === 'Enter' && add()} />
    <button class="btn" onclick={add}>Add</button>
  </div>
  {#if error}<p class="err">{error}</p>{/if}
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }
  .label {
    flex: none;
    width: 170px;
    color: var(--fg);
    font-size: calc(12px * var(--ui-scale, 1));
  }
  .path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wide {
    flex: 1;
    max-width: 460px;
  }
  .err {
    color: var(--danger);
  }
  .btn {
    flex: none;
    padding: 4px 12px;
    font: inherit;
    font-size: calc(12px * var(--ui-scale, 1));
    color: var(--fg);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: calc(6px * var(--radius-scale, 1));
    cursor: pointer;
  }
  .btn:hover {
    background: var(--bg-hover);
    color: var(--fg-bright);
  }
</style>
