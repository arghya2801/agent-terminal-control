<script lang="ts">
  import { untrack } from 'svelte';
  import ConfirmDialog from '../lib/ConfirmDialog.svelte';
  import { appState, saveSettings, themeState } from '../lib/stores.svelte';

  let { path, name, onClose }: { path: string; name: string; onClose: () => void } = $props();

  const own = untrack(() => appState.settings?.ui.projectThemes?.[path]);
  let theme = $state(own?.theme ?? '');
  let accent = $state(own?.accent ?? '');

  async function save() {
    const s = appState.settings;
    if (!s) return onClose();
    const { [path]: _, ...rest } = s.ui.projectThemes ?? {};
    const projectThemes = theme || accent ? { ...rest, [path]: { theme, accent } } : rest;
    await saveSettings({ ...s, ui: { ...s.ui, projectThemes } });
    onClose();
  }
</script>

<ConfirmDialog confirmLabel="Save" danger={false} onConfirm={save} onCancel={onClose}>
  <strong>Theme for {name}</strong>
  <div class="row">
    <label for="pt-theme">Theme</label>
    <select id="pt-theme" bind:value={theme}>
      <option value="">Same as global</option>
      {#each themeState.themes as t (t.name)}<option value={t.name}>{t.name}</option>{/each}
    </select>
  </div>
  <div class="row">
    <label for="pt-accent">Accent</label>
    <input id="pt-accent" type="color" value={accent || '#539bf5'} oninput={(e) => (accent = e.currentTarget.value)} />
    <button class="none" disabled={!accent} onclick={() => (accent = '')}>None</button>
  </div>
</ConfirmDialog>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  label {
    width: 56px;
  }
  select,
  .none {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: calc(6px * var(--radius-scale, 1));
    background: var(--bg);
    color: var(--fg-bright);
    font: inherit;
  }
  .none:disabled {
    opacity: 0.6;
  }
</style>
