<script lang="ts">
  import { applyProfile, pickProfile } from '../lib/profiles';
  import { appState } from '../lib/stores.svelte';
  import type { Settings } from '../types';

  let { ui = $bindable() }: { ui: Settings['ui'] } = $props();

  let sel = $state('');
  let naming = $state(false);
  let name = $state('');
  let note = $state('');
  const names = $derived(Object.keys(ui.profiles ?? {}).sort());

  function save() {
    const n = name.trim();
    if (!n) return;
    ui.profiles = { ...ui.profiles, [n]: pickProfile($state.snapshot(ui)) };
    sel = n;
    naming = false;
    name = '';
  }

  function remove() {
    const { [sel]: _, ...rest } = ui.profiles;
    ui.profiles = rest;
    sel = '';
  }

  async function exportIt() {
    const text = JSON.stringify($state.snapshot(ui.profiles[sel]), null, 2);
    note = (await navigator.clipboard.writeText(text).then(() => true, () => false)) ? 'Copied' : 'Could not copy';
  }

  async function importIt() {
    try {
      const p = pickProfile(JSON.parse(await navigator.clipboard.readText()));
      if (!Object.keys(p).length) throw new Error();
      const n = `Imported ${names.length + 1}`;
      ui.profiles = { ...ui.profiles, [n]: p };
      sel = n;
      note = `Imported as ${n}`;
    } catch {
      appState.error = 'The clipboard does not hold a profile';
    }
  }
</script>

<div class="row">
  <select id="pf" bind:value={sel}>
    <option value="">No profile</option>
    {#each names as n (n)}<option value={n}>{n}</option>{/each}
  </select>
  <button class="btn" disabled={!sel} onclick={() => applyProfile(ui, ui.profiles[sel])}>Apply</button>
  {#if naming}
    <input placeholder="Profile name" bind:value={name} onkeydown={(e) => e.key === 'Enter' && save()} />
    <button class="btn" onclick={save}>Save</button>
    <button class="btn" onclick={() => (naming = false)}>Cancel</button>
  {:else}
    <button class="btn" onclick={() => ((naming = true), (name = sel))}>Save current as…</button>
  {/if}
  <button class="btn" disabled={!sel} onclick={remove}>Delete</button>
  <button class="btn" disabled={!sel} onclick={exportIt}>Export</button>
  <button class="btn" onclick={importIt}>Import</button>
  {#if note}<span class="muted">{note}</span>{/if}
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
</style>
