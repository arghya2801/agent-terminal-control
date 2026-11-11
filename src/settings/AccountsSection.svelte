<script lang="ts">
  import { onMount } from 'svelte';
  import { accountRemove, accountSave, accountSecret } from '../lib/ipc';
  import { accountState, loadAccounts } from '../lib/stores.svelte';
  import type { Account } from '../types';

  /** The default account, from the panel's draft; '' is the ~/.claude login. `onSignIn`
   *  runs `claude setup-token` in a tab, which brings the token back here. */
  let { account = $bindable(), onSignIn }: { account: string; onSignIn: (a: Account) => void } = $props();

  const KIND = { oauth: 'Subscription', apiKey: 'API key' };
  let editing = $state<Account | null>(null);
  let shown = $state<Record<string, string>>({});
  let removing = $state<string | null>(null);
  let error = $state('');
  let busy = $state(false);
  let root = $state<HTMLElement>();

  onMount(() => {
    if (!accountState.draft) return;
    editing = accountState.draft;
    accountState.draft = null;
    root?.scrollIntoView({ block: 'center' });
  });

  const fail = (e: unknown) => (error = e instanceof Error ? e.message : String(e));
  async function secret(id: string) {
    return shown[id] ?? accountSecret(id);
  }
  async function reveal(id: string) {
    if (shown[id]) return void delete shown[id];
    try {
      shown[id] = await accountSecret(id);
    } catch (e) {
      fail(e);
    }
  }
  async function copy(id: string) {
    try {
      await navigator.clipboard.writeText(await secret(id));
    } catch (e) {
      fail(e);
    }
  }
  async function edit(a: Account) {
    try {
      editing = { ...a, secret: await secret(a.id) };
    } catch (e) {
      fail(e);
    }
  }
  async function save() {
    if (!editing) return;
    busy = true;
    error = '';
    try {
      await accountSave(editing);
      editing = null;
      shown = {};
      await loadAccounts();
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
    }
  }
  async function remove(a: Account) {
    removing = null;
    try {
      await accountRemove(a.id);
      if (account === a.id) account = '';
      await loadAccounts();
    } catch (e) {
      fail(e);
    }
  }
</script>

<div class="accounts" bind:this={root}>
  <label class="row">
    <input type="radio" name="default-account" value="" bind:group={account} />
    <span class="name">Claude login</span>
    <span class="muted">Whoever is signed in to Claude Code in <code>~/.claude</code></span>
  </label>
  {#each accountState.list as a (a.id)}
    <div class="row">
      <input type="radio" name="default-account" value={a.id} bind:group={account} aria-label="Make {a.label} the default" />
      <span class="name">{a.label}</span>
      <span class="muted">{KIND[a.kind]}</span>
      <code class="secret" title={shown[a.id]}>{shown[a.id] ?? a.secret}</code>
      <span class="acts">
        <button class="btn" onclick={() => reveal(a.id)}>{shown[a.id] ? 'Hide' : 'Show'}</button>
        <button class="btn" onclick={() => copy(a.id)}>Copy</button>
        <button class="btn" onclick={() => edit(a)}>Edit</button>
        <button class="btn" onclick={() => (removing === a.id ? remove(a) : (removing = a.id))}>{removing === a.id ? 'Remove?' : 'Remove'}</button>
      </span>
    </div>
  {/each}
  {#if editing}
    {@const e = editing}
    <form class="edit" onsubmit={(ev) => (ev.preventDefault(), void save())}>
      <input placeholder="Name, e.g. Work" aria-label="Account name" bind:value={editing.label} />
      <input
        class="key"
        placeholder={e.kind === 'oauth' ? 'sk-ant-oat01-…' : 'sk-ant-api03-…'}
        aria-label={e.kind === 'oauth' ? 'Subscription token' : 'API key'}
        spellcheck="false"
        autocomplete="off"
        bind:value={editing.secret}
      />
      {#if e.kind === 'oauth'}<button type="button" class="btn" onclick={() => onSignIn({ ...e, label: e.label.trim() || 'Claude' })}>Get a token</button>{/if}
      <button class="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Save'}</button>
      <button type="button" class="btn" onclick={() => ((editing = null), (error = ''))}>Cancel</button>
    </form>
    <p class="muted hint">
      {#if e.kind === 'oauth'}
        Get a token runs <code>claude setup-token</code> in a new tab. Sign in there as this account; the token it prints comes back to this box.
      {:else}
        An Anthropic Console key. It is checked before it is saved.
      {/if}
    </p>
  {:else}
    <div class="add">
      <button class="btn" onclick={() => (editing = { id: '', label: '', kind: 'oauth', secret: '' })}>Add subscription</button>
      <button class="btn" onclick={() => (editing = { id: '', label: '', kind: 'apiKey', secret: '' })}>Add API key</button>
    </div>
  {/if}
  {#if error}<p class="err">{error}</p>{/if}
  <p class="muted hint">The default runs new Claude tabs; a resumed session keeps the account it last ran as. Pick another for a tab from the chat's account chip, or Open in Claude as in a project's menu. Secrets are kept in <code>accounts.dat</code> in ATC's config folder, encrypted for your Windows user.</p>
</div>

<style>
  .accounts {
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: auto minmax(80px, 160px) 90px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    font-size: 12px;
  }
  label.row {
    grid-template-columns: auto minmax(80px, 160px) minmax(0, 1fr);
  }
  .name {
    overflow: hidden;
    color: var(--fg-bright);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .secret {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .acts,
  .add,
  .edit {
    display: flex;
    gap: 6px;
  }
  .edit input {
    width: 160px;
  }
  .edit .key {
    flex: 1;
    min-width: 0;
    font-family: var(--mono, monospace);
  }
  .hint {
    margin: 0;
    font-size: 11px;
  }
  code {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--bg-chrome);
  }
</style>
