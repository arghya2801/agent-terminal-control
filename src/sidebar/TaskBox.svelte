<script lang="ts">
  import { tick } from 'svelte';
  import ProviderIcon from '../lib/ProviderIcon.svelte';
  import Icon from '../lib/Icon.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import { providerName } from '../lib/agents';
  import { appState } from '../lib/stores.svelte';
  import { getTab } from '../terminal/manager';
  import type { AgentProvider, Project, TabKey } from '../types';

  /** One field that starts an agent on a task in the background, in the Open view. */
  let { activeKey, onDispatch }: {
    activeKey: TabKey | null;
    onDispatch: (p: Project, provider: AgentProvider, task: string) => void;
  } = $props();

  const projects = $derived(appState.index.projects.filter((p) => p.path && p.exists));
  let task = $state('');
  let agent = $state<AgentProvider>('claude');
  /** A project picked in the box; empty follows the focused tab's project. */
  let pinned = $state('');
  let focused = $state(false);
  let input: HTMLInputElement;
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  const here = $derived(activeKey ? (getTab(activeKey)?.projectKey ?? null) : null);
  const target = $derived(projects.find((p) => p.key === (pinned || here)) ?? projects[0]);
  const other = $derived<AgentProvider>(agent === 'claude' ? 'codex' : 'claude');

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!task.trim() || !target) return;
    onDispatch(target, agent, task.trim());
    task = '';
  }

  function pickProject(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pick = (key: string) => () => {
      pinned = key;
      void tick().then(() => input.focus());
    };
    menu = {
      x: r.left,
      y: r.bottom + 4,
      items: [
        { label: "This tab's project", checked: !pinned, run: pick('') },
        ...projects.map((p, i) => ({ label: p.name, checked: pinned === p.key, sep: i === 0, run: pick(p.key) })),
      ],
    };
  }
</script>

<form
  class="task"
  onsubmit={submit}
  onfocusin={() => (focused = true)}
  onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focused = false; }}
>
  <div class="field">
    <button
      type="button"
      class="agent"
      onclick={() => (agent = other)}
      title="Agent: {providerName(agent)}. Click for {providerName(other)}"
      aria-label="Agent: {providerName(agent)}. Click for {providerName(other)}"
    ><ProviderIcon provider={agent} /></button>
    <input
      bind:this={input}
      bind:value={task}
      placeholder={target ? `Task for ${providerName(agent)} in ${target.name}` : 'Open a project to give agents tasks'}
      disabled={!target}
      aria-label="Task"
      spellcheck="false"
      autocomplete="off"
    />
  </div>
  {#if target && (focused || task || menu)}
    <button type="button" class="where" onclick={pickProject} title="Where the task runs">
      in {target.name} <Icon name="chevronDown" size={10} />
    </button>
  {/if}
</form>
{#if menu}
  <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
{/if}

<style>
  .task {
    padding: 0 8px 8px;
    border-bottom: 1px solid var(--border);
  }
  .field {
    display: flex;
    align-items: center;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
  }
  .field:focus-within {
    border-color: var(--accent);
  }
  .agent {
    display: grid;
    width: 26px;
    height: 24px;
    flex: none;
    place-items: center;
    border: none;
    border-right: 1px solid var(--border);
    border-radius: 5px 0 0 5px;
    background: transparent;
    cursor: pointer;
  }
  .agent:hover {
    background: var(--bg-hover);
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--fg-bright);
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  .where {
    display: flex;
    align-items: center;
    gap: 3px;
    margin: 4px 0 0 2px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--fg-faint);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .where:hover,
  .where:focus-visible {
    color: var(--fg);
  }
</style>
